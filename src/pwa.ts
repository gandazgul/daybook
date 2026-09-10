interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
declare global {
  interface ImportMeta {
    readonly env: { readonly PROD: boolean };
  }
}
const standalone = matchMedia("(display-mode: standalone)");
export const pwa = {
  enabled: import.meta.env.PROD && "serviceWorker" in navigator && isSecureContext,
  ready: false,
  failed: false,
  updateWaiting: false,
  installed: standalone.matches || !!(navigator as Navigator & { standalone?: boolean }).standalone,
  prompt: null as InstallPrompt | null,
};
function changed() {
  globalThis.dispatchEvent(new Event("daybook:pwa"));
}
globalThis.addEventListener("beforeinstallprompt", (event) => {
  if (!pwa.enabled) return;
  event.preventDefault();
  pwa.prompt = event as InstallPrompt;
  changed();
});
globalThis.addEventListener("appinstalled", () => {
  pwa.installed = true;
  pwa.prompt = null;
  changed();
});
standalone.addEventListener("change", () => {
  pwa.installed = standalone.matches;
  changed();
});
export async function installDaybook() {
  const prompt = pwa.prompt;
  if (!prompt) return;
  pwa.prompt = null;
  try {
    await prompt.prompt();
    await prompt.userChoice;
  } finally {
    changed();
  }
}
let started = false;
export function startPwa() {
  if (!pwa.enabled || started) return;
  started = true;
  let hadController = !!navigator.serviceWorker.controller;
  let refreshPending = false, refreshing = false;
  const refresh = () => {
    if (!refreshPending || refreshing || document.hidden) return;
    // The game synchronously saves the open puzzle (including practice) before navigation.
    if (!globalThis.dispatchEvent(new Event("daybook:before-update", { cancelable: true }))) {
      pwa.updateWaiting = true;
      changed();
      return;
    }
    refreshing = true;
    location.reload();
  };
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController) {
      refreshPending = true;
      refresh();
    }
    hadController = true;
  });
  document.addEventListener("visibilitychange", refresh);
  // An already installed worker remains ready even when an offline update check fails.
  void navigator.serviceWorker.ready.then(() => {
    pwa.ready = true;
    pwa.failed = false;
    changed();
  });
  navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
    .then((registration) => {
      const activate = () => {
        pwa.updateWaiting = !!registration.waiting;
        registration.waiting?.postMessage({ type: "ACTIVATE_UPDATE" });
        changed();
      };
      activate();
      const watch = () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && registration.active) {
            activate();
          }
          if (worker.state === "redundant" && !registration.active) {
            pwa.failed = true;
            changed();
          }
        });
      };
      watch();
      registration.addEventListener("updatefound", watch);
      let checking = false;
      const check = async () => {
        if (checking || document.hidden || !navigator.onLine) return;
        checking = true;
        try {
          await registration.update();
        } catch {
          /* Keep the working offline copy. */
        } finally {
          checking = false;
        }
      };
      globalThis.addEventListener("online", () => void check());
      globalThis.addEventListener("pageshow", () => void check());
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) void check();
      });
      setInterval(() => void check(), 60_000);
      void check();
    })
    .catch(() => {
      pwa.failed = !pwa.ready;
      changed();
    });
}
