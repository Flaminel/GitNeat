import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { GitNeatApi } from "./api";

function platform(): string {
  const agent = navigator.userAgent;
  if (agent.includes("Mac")) {
    return "darwin";
  }
  return agent.includes("Windows") ? "win32" : "linux";
}

export function tauriApi(): GitNeatApi {
  return {
    platform: platform(),
    windowControls: platform() !== "darwin",
    git: (cwd, args, env, input) => invoke("git", { cwd, args, env, input }),
    action: (cwd, name, args) => invoke("action", { cwd, name, args }),
    loadRepo: (cwd, hidden, solo, limit) => invoke("load_repo", { cwd, hidden, solo, limit }),
    openRepoDialog: () => invoke("open_repo_dialog"),
    pickDirectory: () => invoke("pick_directory"),
    saveFile: (defaultName, content) => invoke("save_file", { defaultName, content }),
    writeTemp: (content) => invoke("write_temp", { content }),
    readFile: (cwd, rel) => invoke("read_file", { cwd, rel }),
    writeFile: (cwd, rel, content) => invoke("write_file", { cwd, rel, content }),
    menu: (items) => invoke("menu", { items }),
    contextMenu: (cwd, kind, args) => invoke("context_menu", { cwd, kind, args }),
    copy: (text) => invoke("clipboard", { text }),
    openExternal: (url) => invoke("open_external", { url }),
    openPath: (target) => invoke("open_path", { target }),
    showItem: (target) => invoke("show_item", { target }),
    openTerminal: (cwd) => invoke("open_terminal", { cwd }),
    storeGet: () => invoke("store_get"),
    storeSet: (data) => invoke("store_set", { data }),
    watch: (cwd) => invoke("watch", { cwd }),
    unwatch: (cwd) => invoke("unwatch", { cwd }),
    onRepoChanged: (fn) => {
      const stop = listen<string>("repo-changed", (e) => fn(e.payload));
      return () => void stop.then((off) => off());
    },
  };
}

if ("__TAURI_INTERNALS__" in window) {
  window.gitneat = tauriApi();
}
