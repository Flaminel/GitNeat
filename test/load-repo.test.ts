import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { enabled as goldenEnabled, golden } from "./golden";

const enabled = goldenEnabled && process.env.GITNEAT_SLOW === "1";

const rustDir = path.resolve(process.cwd(), "rust");

interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

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
let example = "";
const backends = ["cli", "gix"];

let extraEnv: Record<string, string> = {};
let rowCount = 0;

let clock = 0;

function stamp(): string {
  clock += 1;
  return `${1577836800 + clock * 60} +0000`;
}

function g(cwd: string, ...args: string[]): string {
  const date = stamp();
  return execFileSync("git", [...IDENT, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LC_ALL: "C", GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, ...extraEnv } });
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
  clock = 0;
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
  tagoftag: () => {
    const dir = base("tagoftag");
    g(dir, "tag", "-a", "inner", "-m", "inner tag");
    g(dir, "tag", "-a", "outer", "-m", "outer tag", "inner");
    g(dir, "tag", "-a", "outermost", "-m", "outermost tag", "outer");
    commit(dir, "c.txt", "c\n", "third");
    g(dir, "tag", "-a", "treetag", "-m", "tree tag", "HEAD^{tree}");
    return dir;
  },
  localupstream: () => {
    const dir = base("localupstream");
    g(dir, "checkout", "-q", "-b", "topic");
    commit(dir, "t1.txt", "t\n", "topic one");
    commit(dir, "t2.txt", "t\n", "topic two");
    g(dir, "branch", "--set-upstream-to=main", "topic");
    g(dir, "checkout", "-q", "main");
    commit(dir, "m1.txt", "m\n", "main one");
    g(dir, "branch", "gone", "main");
    g(dir, "config", "branch.gone.remote", "origin");
    g(dir, "config", "branch.gone.merge", "refs/heads/missing");
    return dir;
  },
  ties: () => {
    const dir = base("ties");
    const stamps = ["2020-01-01T00:00:00Z", "2020-01-01T00:00:01Z"];
    let n = 0;
    const tick = (): void => {
      extraEnv = { GIT_COMMITTER_DATE: stamps[n % 2], GIT_AUTHOR_DATE: stamps[(n + 1) % 2] };
      n += 1;
    };
    try {
      for (const branch of ["b1", "b2", "b3", "b4"]) {
        g(dir, "checkout", "-q", "-b", branch, "main");
        for (let i = 0; i < 6; i++) {
          tick();
          commit(dir, `${branch}-${i}.txt`, `${i}\n`, `${branch} commit ${i}`);
          if (i % 3 === 2) {
            g(dir, "checkout", "-q", "-b", `${branch}-side${i}`);
            tick();
            commit(dir, `${branch}-side${i}.txt`, "s\n", `${branch} side ${i}`);
            g(dir, "checkout", "-q", branch);
          }
        }
      }
      g(dir, "checkout", "-q", "main");
      for (const branch of ["b1", "b2", "b3"]) {
        tick();
        g(dir, "merge", "-q", "--no-ff", "-m", `merge ${branch}`, branch);
      }
      g(dir, "tag", "-a", "tie-tag", "-m", "tie", "b4");
    } finally {
      extraEnv = {};
    }
    return dir;
  },
  subjectspaces: () => {
    const dir = base("subjectspaces");
    write(dir, "c.txt", "c\n");
    g(dir, "add", "-A");
    g(dir, "commit", "-q", "--cleanup=verbatim", "-m", "   leading spaces subject");
    write(dir, "d.txt", "d\n");
    g(dir, "add", "-A");
    g(dir, "commit", "-q", "--cleanup=verbatim", "-m", "\n\n  blank first\nsecond line\n\nbody");
    write(dir, "e.txt", "e\n");
    g(dir, "add", "-A");
    g(dir, "commit", "-q", "--cleanup=verbatim", "-m", "subject\n\npara one\nline two\n \t\n\n\npara three\n\nSigned-off-by: A <a@x>\n");
    return dir;
  },
  crlf: () => {
    const dir = base("crlf");
    g(dir, "config", "core.autocrlf", "true");
    commit(dir, "win.txt", "one\r\ntwo\r\n", "crlf file");
    write(dir, "win.txt", "one\r\ntwo\r\nthree\r\n");
    commit(dir, "clean.txt", "x\r\ny\r\n", "crlf clean");
    return dir;
  },
  intentadd: () => {
    const dir = base("intentadd");
    write(dir, "new.txt", "n\n");
    g(dir, "add", "-N", "new.txt");
    return dir;
  },
  ignored: () => {
    const dir = base("ignored");
    commit(dir, ".gitignore", "*.log\nbuild/\n", "ignore");
    write(dir, "x.log", "l\n");
    write(dir, "build/out.txt", "o\n");
    write(dir, "keep.txt", "k\n");
    return dir;
  },
  nesteduntracked: () => {
    const dir = base("nesteduntracked");
    write(dir, "deep/er/est/file.txt", "f\n");
    write(dir, "deep/er/other.txt", "o\n");
    write(dir, "deep/top.txt", "t\n");
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
    execFileSync("cargo", ["build", "-q", "-p", "gitneat-core", "--example", "load_repo"], { cwd: rustDir, stdio: "inherit" });
    example = path.join(rustDir, "target", "debug", "examples", process.platform === "win32" ? "load_repo.exe" : "load_repo");
  },
  { timeout: 600000 },
);

after(() => {
  if (enabled) {
    console.log(`loadRepo: ${rowCount} graph rows checked`);
  }
  if (root) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const record = golden("load-repo");

function check(key: string, value: unknown): void {
  record(key, JSON.parse(JSON.stringify(value).split(root).join("<root>")));
}

for (const [name, build] of Object.entries(fixtures)) {
  test(`loadRepo: ${name}`, { skip: !enabled, timeout: 120000 }, async () => {
    const dir = build();
    for (const v of variants) {
      const runs = v.limit === 1000 ? [[String(v.limit)], ["1", "1"], ["2", "3"]] : [[String(v.limit)]];
      for (const run of runs) {
        const label = `${name} / ${v.name} / ${run.join(" ")}`;
        let first: { submodules?: unknown; rows: unknown[] } | undefined;
        for (const backend of backends) {
          const out = execFileSync(example, [dir, JSON.stringify(v.hidden), JSON.stringify(v.solo), ...run], {
            encoding: "utf8",
            maxBuffer: 512 * 1024 * 1024,
            env: { ...process.env, GITNEAT_BACKEND: backend === "cli" ? "cli" : "" },
          });
          const actual = JSON.parse(out);
          delete actual.lanes;
          if (!first) {
            first = actual;
            check(label, actual);
            rowCount += actual.rows.length;
          } else {
            assert.deepStrictEqual(actual, first, `${label} / ${backend}`);
          }
        }
        if (name === "submodules") {
          assert.deepStrictEqual(first?.submodules, ["libs/a", "my lib/b", "vendor/pu"]);
        }
      }
    }
  });
}
