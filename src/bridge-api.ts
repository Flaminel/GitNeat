import type { AskpassRequest, CloneProgress, GitNeatApi } from "./api";

export interface Transport {
  invoke<T>(name: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(event: string, fn: (payload: T) => void): () => void;
  setZoom(factor: number): Promise<void>;
  toggleFullscreen(): Promise<void>;
  windowAction(action: "minimize" | "maximize" | "close"): Promise<void>;
}

function platform(): string {
  const agent = navigator.userAgent;
  if (agent.includes("Mac")) {
    return "darwin";
  }
  return agent.includes("Windows") ? "win32" : "linux";
}

export function bridgeApi(t: Transport): GitNeatApi {
  return {
    platform: platform(),
    windowControls: platform() !== "darwin",
    action: (cwd, name, args) => t.invoke("action", { cwd, name, args }),
    loadRepo: (cwd, hidden, solo, limit) => t.invoke("load_repo", { cwd, hidden, solo, limit }),
    loadCommits: (cwd, hidden, solo, skip, limit, lanes) => t.invoke("load_commits", { cwd, hidden, solo, skip, limit, lanes }),
    loadCommit: (cwd, sha) => t.invoke("load_commit", { cwd, sha }),
    loadAllFiles: (cwd, sha) => t.invoke("load_all_files", { cwd, sha }),
    loadCompare: (cwd, shas, wip) => t.invoke("load_compare", { cwd, shas, wip }),
    loadDiff: (cwd, source, file, ignoreWhitespace, orig) => t.invoke("load_diff", { cwd, source, file, ignoreWhitespace, orig }),
    loadSides: (cwd, source, file, orig) => t.invoke("load_sides", { cwd, source, file, orig }),
    loadImages: (cwd, source, file, orig) => t.invoke("load_images", { cwd, source, file, orig }),
    loadBlame: (cwd, file, rev) => t.invoke("load_blame", { cwd, file, rev }),
    loadFileHistory: (cwd, file, limit) => t.invoke("load_file_history", { cwd, file, limit }),
    loadFileHistoryPage: (cwd, file, pages) => t.invoke("load_file_history_page", { cwd, file, pages }),
    loadOperation: (cwd, operation) => t.invoke("load_operation", { cwd, operation }),
    loadMerge: (cwd, path, operation) => t.invoke("load_merge", { cwd, path, operation }),
    loadSubmodules: (cwd) => t.invoke("load_submodules", { cwd }),
    loadHeadMessage: (cwd) => t.invoke("load_head_message", { cwd }),
    hasCommitHook: (cwd) => t.invoke("has_commit_hook", { cwd }),
    openRepoDialog: () => t.invoke("open_repo_dialog"),
    pickDirectory: () => t.invoke("pick_directory"),
    repoTemplates: () => t.invoke("repo_templates"),
    cloneRepo: (parent, url, target, shallow) => t.invoke("clone_repo", { parent, url, target, shallow }),
    initRepo: (parent, name, branch, gitignore, license, lfs) => t.invoke("init_repo", { parent, name, branch, gitignore, license, lfs }),
    onCloneProgress: (fn) => t.listen<CloneProgress>("clone-progress", fn),
    missingPaths: (paths) => t.invoke("missing_paths", { paths }),
    repoSummaries: (paths, wip) => t.invoke("repo_summaries", { paths, wip }),
    findRepos: (dirs) => t.invoke("find_repos", { dirs }),
    pickDirectories: () => t.invoke("pick_directories"),
    importCodeWorkspace: () => t.invoke("import_code_workspace"),
    externalEditors: () => t.invoke("external_editors"),
    openInEditor: (editor, customPath, paths) => t.invoke("open_in_editor", { editor, customPath, paths }),
    repoReadme: (path) => t.invoke("repo_readme", { path }),
    createReadme: (path) => t.invoke("create_readme", { path }),
    pickIcon: () => t.invoke("pick_icon"),
    iconData: (name) => t.invoke("icon_data", { name }),
    saveFile: (defaultName, content) => t.invoke("save_file", { defaultName, content }),
    openPatch: () => t.invoke("open_patch"),
    writeTemp: (content) => t.invoke("write_temp", { content }),
    readFile: (cwd, rel) => t.invoke("read_file", { cwd, rel }),
    writeFile: (cwd, rel, content) => t.invoke("write_file", { cwd, rel, content }),
    menu: (items) => t.invoke("menu", { items }),
    contextMenu: (cwd, kind, args) => t.invoke("context_menu", { cwd, kind, args }),
    copy: (text) => t.invoke("clipboard", { text }),
    openExternal: (url) => t.invoke("open_external", { url }),
    openPath: (target) => t.invoke("open_path", { target }),
    showItem: (target) => t.invoke("show_item", { target }),
    openTerminal: (cwd) => t.invoke("open_terminal", { cwd }),
    storeGet: () => t.invoke("store_get"),
    storeSet: (data) => t.invoke("store_set", { data }),
    watch: (cwd) => t.invoke("watch", { cwd }),
    unwatch: (cwd) => t.invoke("unwatch", { cwd }),
    onRepoChanged: (fn) => t.listen<string>("repo-changed", fn),
    onAppMenu: (fn) => t.listen<string>("app-menu", fn),
    onAskpass: (fn) => t.listen<AskpassRequest>("askpass", fn),
    askpassReply: (request, reply) => t.invoke("askpass_reply", { request, reply }),
    setZoom: (factor) => t.setZoom(factor),
    appMenu: () => t.invoke("app_menu"),
    setPanelChecks: (left, details, terminal) => t.invoke("set_panel_checks", { left, details, terminal }),
    termOpen: (cwd, cols, rows) => t.invoke("term_open", { cwd, cols, rows }),
    termWrite: (id, data) => t.invoke("term_write", { id, data }),
    termResize: (id, cols, rows) => t.invoke("term_resize", { id, cols, rows }),
    termClose: (id) => t.invoke("term_close", { id }),
    onTermData: (fn) => t.listen<{ id: number; data: string }>("term-data", (e) => fn(e.id, e.data)),
    onTermExit: (fn) => t.listen<number>("term-exit", fn),
    toggleFullscreen: () => t.toggleFullscreen(),
    windowAction: (action) => t.windowAction(action),
  };
}
