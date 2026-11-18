import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { AskpassRequest, CloneProgress, GitNeatApi } from "./api";

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
  loadCompare: (cwd, shas, wip) => invoke("load_compare", { cwd, shas, wip }),
    loadDiff: (cwd, source, file, ignoreWhitespace, orig) => invoke("load_diff", { cwd, source, file, ignoreWhitespace, orig }),
    loadSides: (cwd, source, file, orig) => invoke("load_sides", { cwd, source, file, orig }),
    loadImages: (cwd, source, file, orig) => invoke("load_images", { cwd, source, file, orig }),
    loadBlame: (cwd, file, rev) => invoke("load_blame", { cwd, file, rev }),
    loadFileHistory: (cwd, file, limit) => invoke("load_file_history", { cwd, file, limit }),
    loadFileHistoryPage: (cwd, file, pages) => invoke("load_file_history_page", { cwd, file, pages }),
    loadOperation: (cwd, operation) => invoke("load_operation", { cwd, operation }),
    loadMerge: (cwd, path, operation) => invoke("load_merge", { cwd, path, operation }),
    loadSubmodules: (cwd) => invoke("load_submodules", { cwd }),
    loadHeadMessage: (cwd) => invoke("load_head_message", { cwd }),
    hasCommitHook: (cwd) => invoke("has_commit_hook", { cwd }),
    openRepoDialog: () => invoke("open_repo_dialog"),
    pickDirectory: () => invoke("pick_directory"),
    repoTemplates: () => invoke("repo_templates"),
    cloneRepo: (parent, url, target, shallow) => invoke("clone_repo", { parent, url, target, shallow }),
    initRepo: (parent, name, branch, gitignore, license, lfs) => invoke("init_repo", { parent, name, branch, gitignore, license, lfs }),
    onCloneProgress: (fn) => {
      const stop = listen<CloneProgress>("clone-progress", (e) => fn(e.payload));
      return () => void stop.then((off) => off());
    },
    missingPaths: (paths) => invoke("missing_paths", { paths }),
    repoSummaries: (paths, wip) => invoke("repo_summaries", { paths, wip }),
    findRepos: (dirs) => invoke("find_repos", { dirs }),
    pickDirectories: () => invoke("pick_directories"),
    importCodeWorkspace: () => invoke("import_code_workspace"),
    externalEditors: () => invoke("external_editors"),
    openInEditor: (editor, customPath, paths) => invoke("open_in_editor", { editor, customPath, paths }),
    repoReadme: (path) => invoke("repo_readme", { path }),
    createReadme: (path) => invoke("create_readme", { path }),
    pickIcon: () => invoke("pick_icon"),
    iconData: (name) => invoke("icon_data", { name }),
    saveFile: (defaultName, content) => invoke("save_file", { defaultName, content }),
  openPatch: () => invoke("open_patch"),
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
    onAskpass: (fn) => {
      const stop = listen<AskpassRequest>("askpass", (e) => fn(e.payload));
      return () => void stop.then((off) => off());
    },
    askpassReply: (request, reply) => invoke("askpass_reply", { request, reply }),
    setZoom: (factor) => getCurrentWebview().setZoom(factor),
  };
}

if ("__TAURI_INTERNALS__" in window) {
  window.gitneat = tauriApi();
}
