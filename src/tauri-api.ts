import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { bridgeApi } from "./bridge-api";

if ("__TAURI_INTERNALS__" in window) {
  window.gitneat = bridgeApi({
    invoke: (name, args) => invoke("dispatch", { name, args: args ?? {} }),
    listen: (event, fn) => {
      const stop = listen<never>(event, (e) => fn(e.payload));
      return () => void stop.then((off) => off());
    },
    setZoom: (factor) => getCurrentWebview().setZoom(factor),
    toggleFullscreen: async () => {
      const win = getCurrentWindow();
      await win.setFullscreen(!(await win.isFullscreen()));
    },
    windowAction: async (action) => {
      const win = getCurrentWindow();
      if (action === "minimize") {
        await win.minimize();
      } else if (action === "maximize") {
        await win.toggleMaximize();
      } else {
        await win.close();
      }
    },
  });
}
