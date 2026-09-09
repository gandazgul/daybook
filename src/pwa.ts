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
export function startPwa() {
  if (!pwa.enabled) return;
  // An already installed worker remains ready even when an offline update check fails.
  void navigator.serviceWorker.ready.then(() => {
    pwa.ready = true;
    pwa.failed = false;
    changed();
  });
  navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
    .then((registration) => {
      pwa.updateWaiting = !!registration.waiting;
      changed();
      const watch = () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && registration.active) {
            pwa.updateWaiting = true;
            changed();
          }
          if (worker.state === "redundant" && !registration.active) {
            pwa.failed = true;
            changed();
          }
        });
      };
      watch();
      registration.addEventListener("updatefound", watch);
      // Check again when returning to the app; a waiting worker activates after all tabs close.
      globalThis.addEventListener("online", () => void registration.update().catch(() => {}));
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) void registration.update().catch(() => {});
      });
    })
    .catch(() => {
      pwa.failed = !pwa.ready;
      changed();
    });
}
