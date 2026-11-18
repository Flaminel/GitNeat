import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
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
    action: (cwd, name, args) => invoke("action", { cwd, name, args }),
    loadRepo: (cwd, hidden, solo, limit) => invoke("load_repo", { cwd, hidden, solo, limit }),
    loadCommits: (cwd, hidden, solo, skip, limit, lanes) => invoke("load_commits", { cwd, hidden, solo, skip, limit, lanes }),
    loadCommit: (cwd, sha) => invoke("load_commit", { cwd, sha }),
    loadAllFiles: (cwd, sha) => invoke("load_all_files", { cwd, sha }),
    loadDiff: (cwd, source, file, ignoreWhitespace, orig) => invoke("load_diff", { cwd, source, file, ignoreWhitespace, orig }),
    loadSides: (cwd, source, file, orig) => invoke("load_sides", { cwd, source, file, orig }),
    loadBlame: (cwd, file, rev) => invoke("load_blame", { cwd, file, rev }),
    loadFileHistory: (cwd, file, limit) => invoke("load_file_history", { cwd, file, limit }),
    loadFileHistoryPage: (cwd, file, pages) => invoke("load_file_history_page", { cwd, file, pages }),
    loadOperation: (cwd, operation) => invoke("load_operation", { cwd, operation }),
    loadMerge: (cwd, path, operation) => invoke("load_merge", { cwd, path, operation }),
    loadHeadMessage: (cwd) => invoke("load_head_message", { cwd }),
    hasCommitHook: (cwd) => invoke("has_commit_hook", { cwd }),
    openRepoDialog: () => invoke("open_repo_dialog"),
    pickDirectory: () => invoke("pick_directory"),
    missingPaths: (paths) => invoke("missing_paths", { paths }),
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
    onAppMenu: (fn) => {
      const stop = listen<string>("app-menu", (e) => fn(e.payload));
      return () => void stop.then((off) => off());
    },
    setZoom: (factor) => getCurrentWebview().setZoom(factor),
  };
}

if ("__TAURI_INTERNALS__" in window) {
  window.gitneat = tauriApi();
}
