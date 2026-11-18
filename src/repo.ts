import { gitneat } from "./api";
import type { ParsedDiff } from "./diff";
import type { Segment as MergeSegment } from "./merge";

export interface Commit {
  sha: string;
  parents: string[];
  author: string;
  email: string;
  time: number;
  subject: string;
  body?: string;
  stash?: string;
}

export type RefKind = "local" | "remote" | "tag";

export interface Ref {
  kind: RefKind;
  name: string;
  full: string;
  sha: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  current?: boolean;
  worktree?: string;
}

export interface Stash {
  sha: string;
  ref: string;
  base: string;
  message: string;
}

export interface Worktree {
  path: string;
  branch?: string;
  sha: string;
  main: boolean;
  locked: boolean;
  prunable: boolean;
}

export interface Remote {
  name: string;
  url: string;
}

export interface StatusEntry {
  path: string;
  orig?: string;
  index: string;
  work: string;
}

export type Operation = "merge" | "rebase" | "cherry-pick" | "revert" | null;

export interface RepoData {
  cwd: string;
  name: string;
  head: string | null;
  branch: string | null;
  commits: Commit[];
  refs: Ref[];
  stashes: Stash[];
  worktrees: Worktree[];
  remotes: Remote[];
  submodules: string[];
  status: StatusEntry[];
  operation: Operation;
  rows: GraphRow[];
  lanes: Lanes;
}

export type Lanes = (string | null)[];

export interface CommitPage {
  commits: Commit[];
  rows: GraphRow[];
  lanes: Lanes;
}

export interface Segment {
  x1: number;
  y1: "top" | "mid";
  x2: number;
  y2: "mid" | "bottom";
  color: number;
}

export interface GraphRow {
  col: number;
  color: number;
  segments: Segment[];
  width: number;
}

export interface FileChange {
  status: string;
  path: string;
  orig?: string;
}

export interface CompareFile extends FileChange {
  base: string;
  head: string;
  untracked: boolean;
}

export interface CommitDetail {
  sha: string;
  parents: string[];
  author: string;
  email: string;
  authorTime: number;
  committer: string;
  commitTime: number;
  message: string;
  committerEmail: string;
  coAuthors: string[];
  files: FileChange[];
  untracked?: string[];
}

export class GitError extends Error {}

export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    const s = p.replace(/\\/g, "/").replace(/\/+$/, "");
    return /^[a-zA-Z]:/.test(s) ? s.toLowerCase() : s;
  };
  return norm(a) === norm(b);
}

export const loadRepo = (cwd: string, hidden: string[], solo: string[], limit: number): Promise<RepoData> => gitneat().loadRepo(cwd, hidden, solo, limit);

export const loadCommits = (cwd: string, hidden: string[], solo: string[], skip: number, limit: number, lanes: Lanes): Promise<CommitPage> =>
  gitneat().loadCommits(cwd, hidden, solo, skip, limit, lanes);

export const loadCommit = (cwd: string, sha: string): Promise<CommitDetail> => gitneat().loadCommit(cwd, sha);

export const loadCompare = (cwd: string, shas: string[], wip: boolean): Promise<CompareFile[]> => gitneat().loadCompare(cwd, shas, wip);

export const loadAllFiles = (cwd: string, sha: string): Promise<string[]> => gitneat().loadAllFiles(cwd, sha);

export type DiffSource = { kind: "commit"; sha: string; parent?: string } | { kind: "staged" } | { kind: "unstaged"; untracked: boolean } | { kind: "worktree"; base: string };

export const loadDiff = (cwd: string, source: DiffSource, file: string, ignoreWhitespace = false, orig?: string): Promise<ParsedDiff> =>
  gitneat().loadDiff(cwd, source, file, ignoreWhitespace, orig);

export function pullRequestUrl(web: string, branch: string): string {
  const name = encodeURIComponent(branch).replace(/%2F/g, "/");
  const host = /^https:\/\/([^/]+)/.exec(web)?.[1] ?? "";
  if (host.includes("gitlab")) {
    return `${web}/-/merge_requests/new?merge_request[source_branch]=${encodeURIComponent(branch)}`;
  }
  if (host.includes("bitbucket")) {
    return `${web}/pull-requests/new?source=${encodeURIComponent(branch)}`;
  }
  return host.includes("github") ? `${web}/compare/${name}?expand=1` : web;
}

export function remoteWebUrl(url: string): string | null {
  const m = /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|[^@/]+@)([^/:]+)(?::\d+)?[:/](.+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? `https://${m[1]}/${m[2]}` : null;
}

export function commitWebUrl(remoteUrl: string, sha: string): string | null {
  const base = remoteWebUrl(remoteUrl);
  if (!base) {
    return null;
  }
  if (base.includes("bitbucket.org")) {
    return `${base}/commits/${sha}`;
  }
  if (base.includes("gitlab")) {
    return `${base}/-/commit/${sha}`;
  }
  return `${base}/commit/${sha}`;
}

export function compareWebUrl(remoteUrl: string, branch: string): string | null {
  const base = remoteWebUrl(remoteUrl);
  if (!base) {
    return null;
  }
  if (base.includes("gitlab")) {
    return `${base}/-/merge_requests/new?merge_request[source_branch]=${encodeURIComponent(branch)}`;
  }
  if (base.includes("bitbucket.org")) {
    return `${base}/pull-requests/new?source=${encodeURIComponent(branch)}`;
  }
  return `${base}/compare/${branch}?expand=1`;
}

export interface DiffSides {
  original: string;
  modified: string;
  binary: boolean;
}

export interface ImageData {
  mime: string;
  data: string;
}

export interface ImageSides {
  original: ImageData | null;
  modified: ImageData | null;
}

export const IMAGE_EXTENSIONS = ["tif", "jpeg", "jpg", "png", "gif", "webp", "bmp"];

export const isImagePath = (path: string): boolean => IMAGE_EXTENSIONS.includes(path.slice(path.lastIndexOf(".") + 1).toLowerCase()) && path.includes(".");

export const loadImages = (cwd: string, source: DiffSource, file: string, orig?: string): Promise<ImageSides> => gitneat().loadImages(cwd, source, file, orig);

export const loadSides = (cwd: string, source: DiffSource, file: string, orig?: string): Promise<DiffSides> => gitneat().loadSides(cwd, source, file, orig);

export interface BlameLine {
  sha: string;
  author: string;
  time: number;
  summary: string;
  text: string;
}

export const loadBlame = (cwd: string, file: string, rev?: string): Promise<BlameLine[]> => gitneat().loadBlame(cwd, file, rev);

export interface FileHistoryPage {
  commits: Commit[];
  end: boolean;
  next: { sha: string; time: number } | null;
}

export const loadFileHistoryPage = (cwd: string, file: string, pages: number): Promise<FileHistoryPage> => gitneat().loadFileHistoryPage(cwd, file, pages);

export type MergeLoad = { kind: "text"; segments: MergeSegment[]; bName: string } | { kind: "binary" } | { kind: "delete"; missing: "a" | "b" };

export const loadMerge = (cwd: string, path: string, operation: Operation): Promise<MergeLoad> => gitneat().loadMerge(cwd, path, operation);

export interface HeadMessage {
  summary: string;
  description: string;
}

export const hasCommitHook = (cwd: string): Promise<boolean> => gitneat().hasCommitHook(cwd);
export const loadHeadMessage = (cwd: string): Promise<HeadMessage> => gitneat().loadHeadMessage(cwd);

export interface OperationInfo {
  from: string;
  to: string;
}

export const loadOperation = (cwd: string, operation: Operation): Promise<OperationInfo> => gitneat().loadOperation(cwd, operation);
