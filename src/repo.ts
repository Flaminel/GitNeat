import { gitneat } from "./api";

export interface Commit {
  sha: string;
  parents: string[];
  author: string;
  email: string;
  time: number;
  subject: string;
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
}

export interface FileChange {
  status: string;
  path: string;
  orig?: string;
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
  files: FileChange[];
}

export class GitError extends Error {}

export async function git(cwd: string, args: string[], env?: Record<string, string>): Promise<string> {
  const result = await gitneat().git(cwd, args, env);
  if (result.code !== 0) {
    throw new GitError((result.stderr || result.stdout).trim() || `git ${args[0]} failed`);
  }
  return result.stdout;
}

export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    const s = p.replace(/\\/g, "/").replace(/\/+$/, "");
    return /^[a-zA-Z]:/.test(s) ? s.toLowerCase() : s;
  };
  return norm(a) === norm(b);
}

const FS = "\x1f";
const RS = "\x1e";

export const loadRepo = (cwd: string, hidden: string[], solo: string[], limit: number): Promise<RepoData> => gitneat().loadRepo(cwd, hidden, solo, limit);

export function parseLog(out: string): Commit[] {
  return out
    .split(RS)
    .map((r) => r.replace(/^\n/, ""))
    .filter(Boolean)
    .map((record) => {
      const [sha, parents, author, email, time, subject] = record.split(FS);
      return {
        sha,
        parents: parents ? parents.split(" ") : [],
        author,
        email,
        time: Number(time),
        subject: subject ?? "",
      };
    });
}

export async function loadCommit(cwd: string, sha: string): Promise<CommitDetail> {
  const meta = await git(cwd, ["show", "-s", `--format=%H${FS}%P${FS}%an${FS}%ae${FS}%at${FS}%cn${FS}%ct${FS}%B`, sha]);
  const [full, parents, author, email, at, committer, ct, message] = meta.split(FS);
  const parentList = parents ? parents.split(" ") : [];
  const diffArgs = parentList.length
    ? ["diff-tree", "-r", "-M", "--name-status", "-z", parentList[0], full]
    : ["diff-tree", "-r", "-M", "--name-status", "-z", "--root", full];
  const files = parseNameStatus(await git(cwd, diffArgs));
  return {
    sha: full,
    parents: parentList,
    author,
    email,
    authorTime: Number(at),
    committer,
    commitTime: Number(ct),
    message: message.trim(),
    files,
  };
}

export function parseNameStatus(out: string): FileChange[] {
  const parts = out.split("\0").filter((p, i, arr) => p !== "" || i < arr.length - 1);
  const files: FileChange[] = [];
  for (let i = 0; i < parts.length; i++) {
    const status = parts[i];
    if (!status || !/^[A-Z]/.test(status)) {
      continue;
    }
    if (status[0] === "R" || status[0] === "C") {
      files.push({ status: status[0], orig: parts[i + 1], path: parts[i + 2] });
      i += 2;
    } else {
      files.push({ status: status[0], path: parts[i + 1] });
      i += 1;
    }
  }
  return files;
}

export async function loadAllFiles(cwd: string, sha: string): Promise<string[]> {
  return (await git(cwd, ["ls-tree", "-r", "-z", "--name-only", sha])).split("\0").filter(Boolean);
}

export type DiffSource = { kind: "commit"; sha: string; parent?: string } | { kind: "staged" } | { kind: "unstaged"; untracked: boolean };

export async function loadDiff(cwd: string, source: DiffSource, file: string, ignoreWhitespace = false, orig?: string): Promise<string> {
  const ws = ignoreWhitespace ? ["--ignore-space-at-eol", "-b"] : [];
  const paths = orig && orig !== file ? [orig, file] : [file];
  if (source.kind === "commit") {
    const args = source.parent
      ? ["diff", "-M", ...ws, source.parent, source.sha, "--", ...paths]
      : ["show", "--format=", ...ws, source.sha, "--", file];
    return git(cwd, args);
  }
  if (source.kind === "staged") {
    return git(cwd, ["diff", "--cached", "-M", ...ws, "--", ...paths]);
  }
  if (source.untracked) {
    const result = await gitneat().git(cwd, ["diff", "--no-index", ...ws, "--", "/dev/null", file]);
    return result.stdout;
  }
  return git(cwd, ["diff", ...ws, "--", file]);
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

async function showBlob(cwd: string, spec: string): Promise<string> {
  const r = await gitneat().git(cwd, ["show", spec]);
  return r.code === 0 ? r.stdout : "";
}

export async function loadSides(cwd: string, source: DiffSource, file: string, orig?: string): Promise<DiffSides> {
  let original = "";
  let modified = "";
  const before = orig ?? file;
  if (source.kind === "commit") {
    [original, modified] = await Promise.all([source.parent ? showBlob(cwd, `${source.parent}:${before}`) : Promise.resolve(""), showBlob(cwd, `${source.sha}:${file}`)]);
  } else if (source.kind === "staged") {
    [original, modified] = await Promise.all([showBlob(cwd, `HEAD:${before}`), showBlob(cwd, `:${file}`)]);
  } else {
    const index = source.untracked ? Promise.resolve("") : showBlob(cwd, `:${file}`);
    [original, modified] = await Promise.all([index, gitneat().readFile(cwd, file).then((t) => t ?? "")]);
  }
  return { original, modified, binary: original.includes("\0") || modified.includes("\0") };
}

export interface BlameLine {
  sha: string;
  author: string;
  time: number;
  summary: string;
  text: string;
}

export async function loadBlame(cwd: string, file: string, rev?: string): Promise<BlameLine[]> {
  const out = await git(cwd, ["blame", "--porcelain", ...(rev ? [rev] : []), "--", file]);
  const info = new Map<string, { author: string; time: number; summary: string }>();
  const lines: BlameLine[] = [];
  let sha = "";
  for (const line of out.split("\n")) {
    const head = /^([0-9a-f]{40}) \d+ \d+/.exec(line);
    if (head) {
      sha = head[1];
      if (!info.has(sha)) {
        info.set(sha, { author: "", time: 0, summary: "" });
      }
    } else if (line.startsWith("author ")) {
      (info.get(sha) as { author: string }).author = line.slice(7);
    } else if (line.startsWith("author-time ")) {
      (info.get(sha) as { time: number }).time = Number(line.slice(12));
    } else if (line.startsWith("summary ")) {
      (info.get(sha) as { summary: string }).summary = line.slice(8);
    } else if (line.startsWith("\t")) {
      const meta = info.get(sha) as { author: string; time: number; summary: string };
      lines.push({ sha, ...meta, text: line.slice(1) });
    }
  }
  return lines;
}

export async function loadFileHistory(cwd: string, file: string, limit = 200): Promise<Commit[]> {
  return parseLog(await git(cwd, ["log", "--follow", `-n${limit}`, `--format=%H${FS}%P${FS}%an${FS}%ae${FS}%at${FS}%s${RS}`, "--", file]));
}
