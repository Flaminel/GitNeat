import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import type { GitResult } from "../src/api";
import { loadRepo } from "../src/repo";

const enabled = process.env.GITNEAT_RUST_COMPARE === "1";
const rustDir = path.resolve(process.cwd(), "rust");

function runGit(cwd: string, args: string[], env?: Record<string, string>, input?: string): Promise<GitResult> {
  return new Promise((resolve) => {
    const child = execFile(
      "git",
      args,
      { cwd, maxBuffer: 512 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C", ...env } },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        resolve({ code, stdout, stderr: stderr || (error && code !== 0 ? error.message : "") });
      },
    );
    if (input !== undefined) {
      child.stdin?.end(input);
    }
  });
}

(globalThis as { window?: unknown }).window = { gitneat: { platform: "darwin", git: runGit } };

const IDENT = ["-c", "user.name=t", "-c", "user.email=t@x", "-c", "commit.gpgsign=false", "-c", "protocol.file.allow=always"];
let root = "";

function g(cwd: string, ...args: string[]): string {
  return execFileSync("git", [...IDENT, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LC_ALL: "C" } });
}

function gTry(cwd: string, ...args: string[]): void {
  try {
    g(cwd, ...args);
  } catch {
    return;
  }
}

function write(dir: string, name: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
  fs.writeFileSync(path.join(dir, name), text);
}

function commit(dir: string, name: string, text: string, message = `edit ${name}`): void {
  write(dir, name, text);
  g(dir, "add", "-A");
  g(dir, "commit", "-q", "-m", message);
}

function init(name: string): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  g(dir, "init", "-q", "-b", "main");
  return dir;
}

function base(name: string): string {
  const dir = init(name);
  commit(dir, "a.txt", "one\n", "first");
  commit(dir, "b.txt", "two\n", "second");
  return dir;
}

function conflicted(name: string): string {
  const dir = base(name);
  g(dir, "checkout", "-q", "-b", "side");
  commit(dir, "a.txt", "side\n", "side change");
  g(dir, "checkout", "-q", "main");
  commit(dir, "a.txt", "main\n", "main change");
  return dir;
}

const fixtures: Record<string, () => string> = {
  plain: () => base("plain"),
  merges: () => {
    const dir = base("merges");
    g(dir, "checkout", "-q", "-b", "feature");
    commit(dir, "f.txt", "f\n", "feature work");
    g(dir, "checkout", "-q", "main");
    commit(dir, "m.txt", "m\n", "main work");
    g(dir, "merge", "-q", "--no-ff", "-m", "merge feature", "feature");
    g(dir, "checkout", "-q", "-b", "other");
    commit(dir, "o.txt", "o\n", "other work");
    g(dir, "checkout", "-q", "main");
    g(dir, "merge", "-q", "--no-ff", "-m", "merge other", "other");
    return dir;
  },
  tags: () => {
    const dir = base("tags");
    g(dir, "tag", "light");
    g(dir, "tag", "-a", "annotated", "-m", "release");
    commit(dir, "c.txt", "c\n", "third");
    g(dir, "tag", "-a", "annotated2", "-m", "release 2");
    return dir;
  },
  upstream: () => {
    const seed = base("upstream-seed");
    const bare = path.join(root, "upstream-remote.git");
    g(root, "clone", "-q", "--bare", seed, bare);
    const work = path.join(root, "upstream");
    g(root, "clone", "-q", bare, work);
    const other = path.join(root, "upstream-other");
    g(root, "clone", "-q", bare, other);
    commit(other, "remote.txt", "r\n", "remote work");
    g(other, "push", "-q", "origin", "main");
    commit(work, "local.txt", "l\n", "local work");
    commit(work, "local2.txt", "l2\n", "local work 2");
    g(work, "fetch", "-q", "origin");
    g(work, "checkout", "-q", "-b", "topic");
    commit(work, "topic.txt", "t\n", "topic work");
    g(work, "checkout", "-q", "main");
    return work;
  },
  stashes: () => {
    const dir = base("stashes");
    write(dir, "a.txt", "changed\n");
    g(dir, "stash", "push", "-q");
    write(dir, "b.txt", "changed too\n");
    g(dir, "stash", "push", "-q", "-m", "named stash");
    return dir;
  },
  worktrees: () => {
    const dir = base("worktrees");
    g(dir, "worktree", "add", "-q", path.join(root, "worktrees-wt1"), "-b", "wt1");
    g(dir, "worktree", "add", "-q", path.join(root, "worktrees-wt2"), "-b", "wt2");
    g(dir, "worktree", "lock", "--reason", "busy", path.join(root, "worktrees-wt2"));
    return dir;
  },
  submodules: () => {
    const dir = base("submodules");
    g(dir, "config", "-f", ".gitmodules", "submodule.a.path", "libs/a");
    g(dir, "config", "-f", ".gitmodules", "submodule.a.url", "https://example.com/a.git");
    g(dir, "config", "-f", ".gitmodules", "submodule.b.path", "my lib/b");
    g(dir, "config", "-f", ".gitmodules", "submodule.b.url", "https://example.com/b.git");
    g(dir, "config", "-f", ".gitmodules", "submodule.path-utils.path", "vendor/pu");
    g(dir, "config", "-f", ".gitmodules", "submodule.path-utils.url", "https://example.com/pu.git");
    return dir;
  },
  files: () => {
    const dir = base("files");
    commit(dir, "old name.txt", "renamed\n", "rename source");
    commit(dir, "gone.txt", "gone\n", "to delete");
    commit(dir, "dir with space/in.txt", "x\n", "spaced");
    g(dir, "mv", "old name.txt", "new name.txt");
    write(dir, "a.txt", "one\nstaged\n");
    g(dir, "add", "a.txt");
    write(dir, "a.txt", "one\nstaged\nunstaged\n");
    fs.unlinkSync(path.join(dir, "gone.txt"));
    write(dir, "untracked file.txt", "u\n");
    write(dir, "héllo wörld.txt", "u\n");
    write(dir, "\u{1F600} smile.txt", "u\n");
    write(dir, "日本語/ファイル.txt", "u\n");
    write(dir, "dir with space/new.txt", "u\n");
    return dir;
  },
  merging: () => {
    const dir = conflicted("merging");
    gTry(dir, "merge", "side");
    return dir;
  },
  rebasing: () => {
    const dir = conflicted("rebasing");
    gTry(dir, "rebase", "side");
    return dir;
  },
  cherrypicking: () => {
    const dir = conflicted("cherrypicking");
    gTry(dir, "cherry-pick", "side");
    return dir;
  },
  empty: () => init("empty"),
  detached: () => {
    const dir = base("detached");
    g(dir, "tag", "mark");
    commit(dir, "c.txt", "c\n", "third");
    g(dir, "checkout", "-q", "--detach", "HEAD~1");
    return dir;
  },
};

const variants: { name: string; hidden: string[]; solo: string[]; limit: number }[] = [
  { name: "all", hidden: [], solo: [], limit: 1000 },
  { name: "limit", hidden: [], solo: [], limit: 2 },
  { name: "hidden", hidden: ["refs/heads/main"], solo: [], limit: 1000 },
  { name: "solo", hidden: [], solo: ["refs/heads/main"], limit: 1000 },
  { name: "solo-missing", hidden: [], solo: ["refs/heads/nope"], limit: 1000 },
  { name: "solo-over-hidden", hidden: ["refs/heads/main"], solo: ["refs/heads/side", "refs/tags/light"], limit: 1000 },
];

before(
  () => {
    if (!enabled) {
      return;
    }
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gitneat-load-")));
    execFileSync("cargo", ["build", "-q", "-p", "gitneat", "--example", "load_repo"], { cwd: rustDir, stdio: "inherit" });
  },
  { timeout: 600000 },
);

after(() => {
  if (root) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

for (const [name, build] of Object.entries(fixtures)) {
  test(`loadRepo: rust equals ts on ${name}`, { skip: !enabled, timeout: 120000 }, async () => {
    const dir = build();
    for (const v of variants) {
      const expected = JSON.parse(JSON.stringify(await loadRepo(dir, v.hidden, v.solo, v.limit)));
      if (name === "submodules") {
        assert.deepStrictEqual(expected.submodules, ["libs/a", "my lib/b", "vendor/pu"]);
      }
      const out = execFileSync("cargo", ["run", "-q", "-p", "gitneat", "--example", "load_repo", "--", dir, JSON.stringify(v.hidden), JSON.stringify(v.solo), String(v.limit)], {
        cwd: rustDir,
        encoding: "utf8",
        maxBuffer: 512 * 1024 * 1024,
      });
      assert.deepStrictEqual(JSON.parse(out), expected, `${name} / ${v.name}`);
    }
  });
}
