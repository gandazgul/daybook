import { runInNewContext } from "node:vm";

const source = Deno.readTextFileSync(new URL("../src/service-worker.js", import.meta.url))
  .replace("__DAYBOOK_CACHE__", "daybook-shell-new")
  .replace("/* __DAYBOOK_ASSETS__ */", '"/", "/assets/game-new.js"');
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function harness(failDownload = false) {
  const handlers = new Map<string, (event: Record<string, unknown>) => void>();
  const names = new Set(["daybook-shell-old", "another-app"]);
  const events: string[] = [], requests: { url: string; cache: string }[] = [];
  let fullyCached = false;
  const cache = {
    addAll: async (items: typeof requests) => {
      requests.push(...items);
      await Promise.resolve();
      if (failDownload) throw new Error("download failed");
      fullyCached = true;
      events.push("downloaded");
    },
    match: (path: string) => Promise.resolve(path === "/" ? "cached-html" : undefined),
  };
  runInNewContext(source, {
    self: {
      location: { origin: "https://puzzle.test" },
      addEventListener: (type: string, handler: (event: Record<string, unknown>) => void) =>
        handlers.set(type, handler),
      skipWaiting: () => {
        assert(fullyCached, "Never activate before the full shell is cached");
        events.push("activate-now");
        return Promise.resolve();
      },
      clients: {
        claim: () => {
          events.push("claimed");
          return Promise.resolve();
        },
      },
    },
    caches: {
      open: (name: string) => {
        names.add(name);
        return Promise.resolve(cache);
      },
      keys: () => Promise.resolve([...names]),
      delete: (name: string) => Promise.resolve(names.delete(name)),
    },
    Request: class {
      constructor(public url: string, public options: { cache: string }) {}
      get cache() {
        return this.options.cache;
      }
    },
    URL,
    fetch: () => Promise.resolve("network"),
  });
  return {
    names,
    events,
    requests,
    async emit(type: string, extra: Record<string, unknown> = {}) {
      const pending: Promise<unknown>[] = [];
      handlers.get(type)?.({
        ...extra,
        waitUntil: (promise: Promise<unknown>) => pending.push(promise),
        respondWith: (promise: Promise<unknown>) => pending.push(promise),
      });
      return await Promise.all(pending);
    },
  };
}
Deno.test("Complete service-worker installs activate immediately after uncached downloads", async () => {
  const h = harness();
  await h.emit("install");
  assert(
    h.events.join(",") === "downloaded,activate-now",
    "Completed updates must not wait for tabs to close",
  );
  assert(
    h.requests.length === 2 && h.requests.every((r) => r.cache === "reload"),
    "Bypass browser cache during precache",
  );
});
Deno.test("Failed service-worker downloads preserve the previous working cache", async () => {
  const h = harness(true);
  let rejected = false;
  try {
    await h.emit("install");
  } catch {
    rejected = true;
  }
  assert(rejected && !h.events.includes("activate-now"), "Incomplete updates must not activate");
  assert(
    h.names.has("daybook-shell-old") && !h.names.has("daybook-shell-new"),
    "Only failed new cache is removed",
  );
});
Deno.test("Service-worker activation cleans only old Daybook caches and takes control", async () => {
  const h = harness();
  await h.emit("install");
  await h.emit("activate");
  assert(
    !h.names.has("daybook-shell-old") && h.names.has("daybook-shell-new") &&
      h.names.has("another-app"),
    "Preserve unrelated storage and the new build",
  );
  assert(h.events.at(-1) === "claimed", "New worker must control already-open app windows");
});
Deno.test("Service worker serves the offline shell without caching health or external requests", async () => {
  const h = harness();
  await h.emit("install");
  const fetch = (path: string) => h.emit("fetch", { request: { method: "GET", url: path } });
  assert(
    (await fetch("https://puzzle.test/?resume=1"))[0] === "cached-html",
    "Query strings must keep offline navigation working",
  );
  assert(!(await fetch("https://puzzle.test/healthz")).length, "Do not cache health checks");
  assert(!(await fetch("https://elsewhere.test/")).length, "Do not handle external requests");
});
