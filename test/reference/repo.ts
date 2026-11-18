import { gitneat } from "../../src/api";
import type { BlameLine, Commit, CommitDetail, DiffSides, DiffSource, FileChange, Operation, Ref, RepoData, Remote, StatusEntry, Stash, Worktree } from "../../src/repo";

export class GitError extends Error {}

export async function git(cwd: string, args: string[], env?: Record<string, string>): Promise<string> {
  const result = await gitneat().git(cwd, args, env);
  if (result.code !== 0) {
    throw new GitError((result.stderr || result.stdout).trim() || `git ${args[0]} failed`);
  }
  return result.stdout;
}

async function tryGit(cwd: string, args: string[], input?: string): Promise<string> {
  const result = await gitneat().git(cwd, args, undefined, input);
  return result.code === 0 ? result.stdout : "";
}

const FS = "\x1f";
const RS = "\x1e";

export async function loadRepo(cwd: string, hidden: string[], solo: string[], limit: number): Promise<RepoData> {
  const [refOut, headOut, branchOut, stashOut, wtOut, remoteOut, statusOut, subOut] = await Promise.all([
    tryGit(cwd, [
      "for-each-ref",
      `--format=%(refname)${FS}%(objectname)${FS}%(*objectname)${FS}%(upstream:short)${FS}%(upstream:track,nobracket)${FS}%(HEAD)${FS}%(worktreepath)`,
      "refs/heads",
      "refs/remotes",
      "refs/tags",
    ]),
    tryGit(cwd, ["rev-parse", "--verify", "-q", "HEAD"]),
    tryGit(cwd, ["symbolic-ref", "-q", "--short", "HEAD"]),
    tryGit(cwd, ["stash", "list", `--format=%H${FS}%gd${FS}%P${FS}%gs`]),
    tryGit(cwd, ["worktree", "list", "--porcelain"]),
    tryGit(cwd, ["remote", "-v"]),
    tryGit(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    tryGit(cwd, ["config", "-f", ".gitmodules", "--get-regexp", "^submodule\\..*\\.path$"]),
  ]);

  const refs = parseRefs(refOut);
  const head = headOut.trim() || null;
  const stashes: Stash[] = stashOut
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, ref, parents, message] = line.split(FS);
      return { sha, ref, base: parents.split(" ")[0], message };
    });

  let revs: string[];
  if (solo.length > 0) {
    revs = refs.filter((r) => solo.includes(r.full)).map((r) => r.full);
  } else if (hidden.length > 0) {
    revs = refs.filter((r) => !hidden.includes(r.full)).map((r) => r.full);
  } else {
    revs = ["--branches", "--remotes", "--tags"];
  }
  if (head) {
    revs.push("HEAD");
  }

  const logOut = revs.length
    ? await tryGit(
        cwd,
        [
          "log",
          "--date-order",
          `-n${limit}`,
          `--format=%H${FS}%P${FS}%an${FS}%ae${FS}%at${FS}%s${RS}`,
          ...revs.filter((r) => r.startsWith("--")),
          "--stdin",
          "--",
        ],
        revs.filter((r) => !r.startsWith("--")).join("\n") + "\n",
      )
    : "";
  const commits = parseLog(logOut);
  insertStashes(commits, stashes, await stashTimes(cwd, stashes));

  return {
    cwd,
    name: cwd.split(/[\\/]/).pop() ?? cwd,
    head,
    branch: branchOut.trim() || null,
    commits,
    refs,
    stashes,
    worktrees: parseWorktrees(wtOut),
    remotes: parseRemotes(remoteOut),
    submodules: subOut
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split(" ").slice(1).join(" ")),
    status: parseStatus(statusOut),
    operation: await detectOperation(cwd),
  };
}

async function stashTimes(cwd: string, stashes: Stash[]): Promise<Map<string, Commit>> {
  const map = new Map<string, Commit>();
  if (stashes.length === 0) {
    return map;
  }
  const out = await tryGit(cwd, ["show", "-s", `--format=%H${FS}%P${FS}%an${FS}%ae${FS}%at${FS}%s${RS}`, ...stashes.map((s) => s.sha)]);
  for (const c of parseLog(out)) {
    map.set(c.sha, c);
  }
  return map;
}

function insertStashes(commits: Commit[], stashes: Stash[], details: Map<string, Commit>): void {
  for (const stash of stashes) {
    const parentIndex = commits.findIndex((c) => c.sha === stash.base);
    const detail = details.get(stash.sha);
    if (parentIndex < 0 || !detail) {
      continue;
    }
    commits.splice(parentIndex, 0, { ...detail, parents: [stash.base], subject: stash.message, stash: stash.ref });
  }
}

async function detectOperation(cwd: string): Promise<Operation> {
  const checks: [string, Operation][] = [
    ["REBASE_HEAD", "rebase"],
    ["MERGE_HEAD", "merge"],
    ["CHERRY_PICK_HEAD", "cherry-pick"],
    ["REVERT_HEAD", "revert"],
  ];
  const results = await Promise.all(checks.map(([ref]) => gitneat().git(cwd, ["rev-parse", "-q", "--verify", ref])));
  const hit = results.findIndex((r) => r.code === 0);
  if (hit >= 0) {
    return checks[hit][1];
  }
  const status = await gitneat().git(cwd, ["status", "--no-ahead-behind"]);
  return /rebase in progress|You are currently rebasing|You are currently editing a commit while rebasing/.test(status.stdout) ? "rebase" : null;
}

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

export function parseRefs(out: string): Ref[] {
  const refs: Ref[] = [];
  for (const line of out.split("\n")) {
    if (!line) {
      continue;
    }
    const [full, obj, peeled, upstream, track, headMark, worktree] = line.split(FS);
    const sha = peeled || obj;
    if (full.startsWith("refs/heads/")) {
      const ahead = /ahead (\d+)/.exec(track)?.[1];
      const behind = /behind (\d+)/.exec(track)?.[1];
      refs.push({
        kind: "local",
        name: full.slice(11),
        full,
        sha,
        upstream: upstream || undefined,
        ahead: ahead ? Number(ahead) : 0,
        behind: behind ? Number(behind) : 0,
        current: headMark === "*",
        worktree: worktree || undefined,
      });
    } else if (full.startsWith("refs/remotes/")) {
      if (full.endsWith("/HEAD")) {
        continue;
      }
      refs.push({ kind: "remote", name: full.slice(13), full, sha });
    } else if (full.startsWith("refs/tags/")) {
      refs.push({ kind: "tag", name: full.slice(10), full, sha });
    }
  }
  return refs;
}

export function parseStatus(out: string): StatusEntry[] {
  const parts = out.split("\0");
  const entries: StatusEntry[] = [];
  for (let i = 0; i < parts.length; i++) {
    const item = parts[i];
    if (item.length < 4) {
      continue;
    }
    const index = item[0];
    const work = item[1];
    const entry: StatusEntry = { index, work, path: item.slice(3) };
    if (index === "R" || index === "C") {
      entry.orig = parts[++i];
    }
    entries.push(entry);
  }
  return entries;
}

function parseWorktrees(out: string): Worktree[] {
  return out
    .split("\n\n")
    .filter((b) => b.trim())
    .map((block, i) => {
      const lines = block.split("\n");
      const get = (key: string) => lines.find((l) => l.startsWith(key + " "))?.slice(key.length + 1);
      return {
        path: get("worktree") ?? "",
        sha: get("HEAD") ?? "",
        branch: get("branch")?.replace("refs/heads/", ""),
        main: i === 0,
        locked: lines.some((l) => l === "locked" || l.startsWith("locked ")),
        prunable: lines.some((l) => l === "prunable" || l.startsWith("prunable ")),
      };
    });
}

function parseRemotes(out: string): Remote[] {
  const map = new Map<string, string>();
  for (const line of out.split("\n")) {
    const [name, url] = line.split(/\s+/);
    if (name && url && !map.has(name)) {
      map.set(name, url);
    }
  }
  return [...map].map(([name, url]) => ({ name, url }));
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
