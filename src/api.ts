import type { ParsedDiff } from "./diff";
import type { BlameLine, Commit, CommitDetail, CommitPage, Lanes, DiffSides, DiffSource, FileHistoryPage, HeadMessage, MergeLoad, Operation, OperationInfo, RepoData } from "./repo";

export interface MenuSpec {
  label?: string;
  id?: string;
  type?: "separator";
  enabled?: boolean;
  submenu?: MenuSpec[];
}

export interface GitNeatApi {
  platform: string;
  windowControls?: boolean;
  action(cwd: string, name: string, args: unknown): Promise<unknown>;
  loadRepo(cwd: string, hidden: string[], solo: string[], limit: number): Promise<RepoData>;
  loadCommits(cwd: string, hidden: string[], solo: string[], skip: number, limit: number, lanes: Lanes): Promise<CommitPage>;
  loadCommit(cwd: string, sha: string): Promise<CommitDetail>;
  loadAllFiles(cwd: string, sha: string): Promise<string[]>;
  loadDiff(cwd: string, source: DiffSource, file: string, ignoreWhitespace: boolean, orig?: string): Promise<ParsedDiff>;
  loadSides(cwd: string, source: DiffSource, file: string, orig?: string): Promise<DiffSides>;
  loadBlame(cwd: string, file: string, rev?: string): Promise<BlameLine[]>;
  loadFileHistory(cwd: string, file: string, limit: number): Promise<Commit[]>;
  loadFileHistoryPage(cwd: string, file: string, pages: number): Promise<FileHistoryPage>;
  loadMerge(cwd: string, path: string, operation: Operation): Promise<MergeLoad>;
  loadOperation(cwd: string, operation: Operation): Promise<OperationInfo>;
  loadHeadMessage(cwd: string): Promise<HeadMessage>;
  openRepoDialog(): Promise<string | { error: string } | null>;
  pickDirectory(): Promise<string | null>;
  missingPaths(paths: string[]): Promise<string[]>;
  saveFile(name: string, content: string): Promise<boolean>;
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
}

declare global {
  interface Window {
    gitneat: GitNeatApi;
  }
}

export const gitneat = (): GitNeatApi => window.gitneat;
