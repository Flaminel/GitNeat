import type { ParsedDiff } from "./diff";
import type { BlameLine, Commit, CommitDetail, CommitPage, CompareFile, Lanes, DiffSides, DiffSource, ImageSides, FileHistoryPage, HeadMessage, MergeLoad, Operation, OperationInfo, RepoData, Submodule } from "./repo";

import type { AppMenu } from "./keymap";

export interface MenuSpec {
  label?: string;
  id?: string;
  type?: "separator";
  enabled?: boolean;
  submenu?: MenuSpec[];
  accelerator?: string;
  checked?: boolean;
}

export interface AskpassRequest {
  request: number;
  kind: "username" | "password" | "passphrase" | "other";
  target: string;
  user: string;
  retry: boolean;
}

export interface AskpassReply {
  username: string;
  password: string;
  remember: boolean;
}

export interface RepoTemplates {
  home: string;
  lfs: boolean;
  gitignore: string[];
  licenses: { key: string; title: string }[];
}

export interface ShallowOptions {
  branch: string;
  depth: string;
  since: string;
  flags: string;
}

export interface CloneProgress {
  target: string;
  percent: number;
}

export interface RepoSummary {
  path: string;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  remote: string | null;
  remoteUrl: string | null;
  wip: WipSummary | null;
  error: string | null;
}

export interface WipSummary {
  added: number;
  deleted: number;
  modified: number;
  renamed: number;
}

export interface ExternalEditor {
  id: string;
  label: string;
}

export interface RepoReadme {
  name: string;
  html: string;
}

export interface GitNeatApi {
  platform: string;
  windowControls?: boolean;
  action(cwd: string, name: string, args: unknown): Promise<unknown>;
  loadRepo(cwd: string, hidden: string[], solo: string[], limit: number): Promise<RepoData>;
  loadCommits(cwd: string, hidden: string[], solo: string[], skip: number, limit: number, lanes: Lanes): Promise<CommitPage>;
  loadCommit(cwd: string, sha: string): Promise<CommitDetail>;
  loadAllFiles(cwd: string, sha: string): Promise<string[]>;
  loadCompare(cwd: string, shas: string[], wip: boolean): Promise<CompareFile[]>;
  loadDiff(cwd: string, source: DiffSource, file: string, ignoreWhitespace: boolean, orig?: string): Promise<ParsedDiff>;
  loadSides(cwd: string, source: DiffSource, file: string, orig?: string): Promise<DiffSides>;
  loadImages(cwd: string, source: DiffSource, file: string, orig?: string): Promise<ImageSides>;
  loadBlame(cwd: string, file: string, rev?: string): Promise<BlameLine[]>;
  loadFileHistory(cwd: string, file: string, limit: number): Promise<Commit[]>;
  loadFileHistoryPage(cwd: string, file: string, pages: number): Promise<FileHistoryPage>;
  loadMerge(cwd: string, path: string, operation: Operation): Promise<MergeLoad>;
  loadOperation(cwd: string, operation: Operation): Promise<OperationInfo>;
  loadSubmodules(cwd: string): Promise<Submodule[]>;
  loadHeadMessage(cwd: string): Promise<HeadMessage>;
  hasCommitHook(cwd: string): Promise<boolean>;
  openRepoDialog(): Promise<string | { error: string } | null>;
  pickDirectory(): Promise<string | null>;
  repoTemplates(): Promise<RepoTemplates>;
  cloneRepo(parent: string, url: string, target: string, shallow: ShallowOptions | null): Promise<string>;
  initRepo(parent: string, name: string, branch: string, gitignore: string, license: string, lfs: boolean): Promise<string>;
  onCloneProgress(fn: (progress: CloneProgress) => void): () => void;
  missingPaths(paths: string[]): Promise<string[]>;
  repoSummaries(paths: string[], wip: boolean): Promise<RepoSummary[]>;
  findRepos(dirs: string[]): Promise<string[]>;
  pickDirectories(): Promise<string[]>;
  importCodeWorkspace(): Promise<string[]>;
  externalEditors(): Promise<ExternalEditor[]>;
  openInEditor(editor: string, customPath: string, paths: string[]): Promise<void>;
  repoReadme(path: string): Promise<RepoReadme | null>;
  createReadme(path: string): Promise<void>;
  pickIcon(): Promise<string | null>;
  iconData(name: string): Promise<string | null>;
  saveFile(name: string, content: string): Promise<boolean>;
  openPatch(): Promise<string | null>;
  writeTemp(content: string): Promise<string>;
  readFile(cwd: string, rel: string): Promise<string | null>;
  writeFile(cwd: string, rel: string, content: string): Promise<boolean>;
  menu(items: MenuSpec[]): Promise<string | null>;
  contextMenu(cwd: string, kind: string, args: unknown): Promise<string | null>;
  copy(text: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  openPath(target: string): Promise<string>;
  showItem(target: string): Promise<void>;
  openTerminal(cwd: string): Promise<void>;
  storeGet(): Promise<Record<string, unknown>>;
  storeSet(data: unknown): Promise<void>;
  watch(cwd: string): Promise<void>;
  unwatch(cwd: string): Promise<void>;
  onRepoChanged(fn: (cwd: string) => void): () => void;
  onAppMenu(fn: (id: string) => void): () => void;
  onAskpass(fn: (request: AskpassRequest) => void): () => void;
  askpassReply(request: number, reply: AskpassReply | null): Promise<void>;
  setZoom(factor: number): Promise<void>;
  appMenu(): Promise<AppMenu[]>;
  setPanelChecks(left: boolean | null, details: boolean | null): Promise<void>;
  toggleFullscreen(): Promise<void>;
}

declare global {
  interface Window {
    gitneat: GitNeatApi;
  }
}

export const gitneat = (): GitNeatApi => window.gitneat;
