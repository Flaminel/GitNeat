import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import type { GitResult } from "../src/api";
import type { DiffSource } from "../src/repo";
import { parseDiff } from "./reference/diff";
import { loadAllFiles, loadBlame, loadCommit, loadDiff, loadFileHistory, loadSides } from "./reference/repo";

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

async function readFile(cwd: string, rel: string): Promise<string | null> {
  try {
    return await fs.promises.readFile(path.join(cwd, rel), "utf8");
  } catch {
    return null;
  }
}

(globalThis as { window?: unknown }).window = { gitneat: { platform: "darwin", git: runGit, readFile } };

const IDENT = ["-c", "user.name=t", "-c", "user.email=t@x", "-c", "commit.gpgsign=false"];
let root = "";
let example = "";
let compared = 0;
let failed = 0;

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

function write(dir: string, name: string, data: string | Buffer): void {
  fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
  fs.writeFileSync(path.join(dir, name), data);
}

function commit(dir: string, name: string, data: string | Buffer, message = `edit ${name}`): void {
  write(dir, name, data);
  g(dir, "add", "-A");
  g(dir, "commit", "-q", "-m", message);
}

function init(name: string): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  g(dir, "init", "-q", "-b", "main");
  return dir;
}

const fixtures: Record<string, () => string> = {
  renames: () => {
    const dir = init("renames");
    commit(dir, "old.txt", "one\ntwo\nthree\nfour\nfive\n", "add old");
    commit(dir, "keep.txt", "k\n", "add keep");
    g(dir, "mv", "old.txt", "new.txt");
    write(dir, "new.txt", "one\ntwo\nthree\nfour\nfive\nsix\n");
    g(dir, "add", "-A");
    g(dir, "commit", "-q", "-m", "rename old");
    fs.mkdirSync(path.join(dir, "dir"));
    g(dir, "mv", "keep.txt", "dir/kept.txt");
    return dir;
  },
  binary: () => {
    const dir = init("binary");
    commit(dir, "img.bin", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 0xff, 0xfe, 10]), "add binary");
    commit(dir, "img.bin", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 3, 4, 0xc3, 10]), "change binary");
    commit(dir, "latin.txt", Buffer.from([0x63, 0x61, 0x66, 0xe9, 10]), "invalid utf8");
    write(dir, "img.bin", Buffer.from([0, 0, 0, 9]));
    write(dir, "new.bin", Buffer.from([1, 0, 2]));
    return dir;
  },
  unicode: () => {
    const dir = init("unicode");
    commit(dir, "héllo wörld.txt", "a\n", "accent");
    commit(dir, "\u{1F600} smile.txt", "b\n", "emoji");
    commit(dir, "日本語/ファイル.txt", "c\n", "japanese");
    commit(dir, "héllo wörld.txt", "a\nmore\n", "accent edit");
    write(dir, "\u{1F600} smile.txt", "b\nchanged\n");
    g(dir, "add", "-A");
    write(dir, "\u{1F600} smile.txt", "b\nchanged\nagain\n");
    write(dir, "新しい \u{1F680}.txt", "new\n");
    return dir;
  },
  crlf: () => {
    const dir = init("crlf");
    commit(dir, "raw.txt", "one\r\ntwo\r\n", "raw crlf");
    commit(dir, "raw.txt", "one\r\ntwo  \r\nthree\n", "mixed endings");
    g(dir, "config", "core.autocrlf", "true");
    commit(dir, "auto.txt", "a\r\nb\r\n", "auto crlf");
    write(dir, "raw.txt", "one\ntwo\r\nthree\r\n");
    write(dir, "auto.txt", "a\r\nb\r\nc\r\n");
    return dir;
  },
  merges: () => {
    const dir = init("merges");
    commit(dir, "a.txt", "one\n", "first");
    g(dir, "checkout", "-q", "-b", "feature");
    commit(dir, "f.txt", "f\n", "feature work");
    commit(dir, "a.txt", "one\nfeature\n", "feature edit");
    g(dir, "checkout", "-q", "main");
    commit(dir, "m.txt", "m\n", "main work");
    g(dir, "merge", "-q", "--no-ff", "-m", "merge feature", "feature");
    return dir;
  },
  rootonly: () => {
    const dir = init("rootonly");
    write(dir, "x.txt", "x\n");
    write(dir, "sub/y.txt", "y\n");
    g(dir, "add", "-A");
    g(dir, "commit", "-q", "-m", "root commit\n\nwith body\n");
    return dir;
  },
  conflict: () => {
    const dir = init("conflict");
    commit(dir, "a.txt", "base\n", "base");
    g(dir, "checkout", "-q", "-b", "side");
    commit(dir, "a.txt", "side\n", "side change");
    g(dir, "checkout", "-q", "main");
    commit(dir, "a.txt", "main\n", "main change");
    gTry(dir, "merge", "side");
    return dir;
  },
  history: () => {
    const dir = init("history");
    for (let i = 0; i < 230; i++) {
      commit(dir, "long.txt", Array.from({ length: (i % 7) + 1 }, (_, n) => `line ${n} rev ${i}`).join("\n") + "\n", `rev ${i}`);
    }
    g(dir, "mv", "long.txt", "moved.txt");
    g(dir, "commit", "-q", "-m", "move long");
    commit(dir, "moved.txt", "after move\n", "after move");
    return dir;
  },
};

type Call = { name: string; args: Record<string, unknown> };

const loaders: Record<string, (a: Record<string, unknown>) => Promise<unknown>> = {
  loadCommit: (a) => loadCommit(a.cwd as string, a.sha as string),
  loadAllFiles: (a) => loadAllFiles(a.cwd as string, a.sha as string),
  loadDiff: async (a) => parseDiff(await loadDiff(a.cwd as string, a.source as DiffSource, a.file as string, a.ignoreWhitespace as boolean, a.orig as string | undefined)),
  loadSides: (a) => loadSides(a.cwd as string, a.source as DiffSource, a.file as string, a.orig as string | undefined),
  loadBlame: (a) => loadBlame(a.cwd as string, a.file as string, a.rev as string | undefined),
  loadFileHistory: (a) => loadFileHistory(a.cwd as string, a.file as string, a.limit as number | undefined),
};

async function reference(call: Call): Promise<unknown> {
  try {
    return { ok: JSON.parse(JSON.stringify(await loaders[call.name](call.args))) };
  } catch (e) {
    return { err: e instanceof Error ? e.message : String(e) };
  }
}

function statusEntries(dir: string): { index: string; work: string; path: string; orig?: string }[] {
  const parts = g(dir, "status", "--porcelain=v1", "-z", "--untracked-files=all").split("\0");
  const entries: { index: string; work: string; path: string; orig?: string }[] = [];
  for (let i = 0; i < parts.length; i++) {
    const item = parts[i];
    if (item.length < 4) {
      continue;
    }
    const entry: { index: string; work: string; path: string; orig?: string } = { index: item[0], work: item[1], path: item.slice(3) };
    if (entry.index === "R" || entry.index === "C") {
      entry.orig = parts[++i];
    }
    entries.push(entry);
  }
  return entries;
}

async function calls(dir: string): Promise<Call[]> {
  const list: Call[] = [];
  const add = (name: string, args: Record<string, unknown>) => list.push({ name, args: { cwd: dir, ...args } });
  const shas = g(dir, "rev-list", "--all").split("\n").filter(Boolean);
  const touched = new Set<string>();
  for (const sha of shas) {
    add("loadCommit", { sha });
    add("loadAllFiles", { sha });
    const detail = await loadCommit(dir, sha);
    for (const f of detail.files) {
      touched.add(f.path);
      const sources: DiffSource[] = [{ kind: "commit", sha }];
      if (detail.parents[0]) {
        sources.push({ kind: "commit", sha, parent: detail.parents[0] });
      }
      for (const source of sources) {
        for (const ignoreWhitespace of [false, true]) {
          add("loadDiff", { source, file: f.path, ignoreWhitespace, orig: f.orig });
        }
        add("loadSides", { source, file: f.path, orig: f.orig });
      }
      add("loadBlame", { file: f.path, rev: sha });
    }
  }
  for (const file of touched) {
    add("loadFileHistory", { file });
    add("loadFileHistory", { file, limit: 5 });
    add("loadBlame", { file });
  }
  for (const e of statusEntries(dir)) {
    const untracked = e.index === "?";
    const sources: DiffSource[] = untracked ? [{ kind: "unstaged", untracked: true }] : [{ kind: "staged" }, { kind: "unstaged", untracked: false }];
    for (const source of sources) {
      for (const ignoreWhitespace of [false, true]) {
        add("loadDiff", { source, file: e.path, ignoreWhitespace, orig: e.orig });
      }
      add("loadSides", { source, file: e.path, orig: e.orig });
    }
    add("loadBlame", { file: e.path });
  }
  add("loadCommit", { sha: "nope" });
  add("loadAllFiles", { sha: "nope" });
  add("loadBlame", { file: "missing.txt" });
  add("loadFileHistory", { file: "missing.txt" });
  add("loadDiff", { source: { kind: "commit", sha: "nope", parent: "nope2" }, file: "x" });
  add("loadSides", { source: { kind: "commit", sha: "nope" }, file: "x" });
  return list;
}

type BlameRow = { sha: string; time: number };

function alignUncommitted(actual: unknown, expected: unknown): void {
  const a = (actual as { ok?: BlameRow[] }).ok;
  const e = (expected as { ok?: BlameRow[] }).ok;
  if (!a || !e || a.length !== e.length) {
    return;
  }
  a.forEach((row, i) => {
    if (/^0{40}$/.test(row.sha) && row.sha === e[i].sha && Math.abs(row.time - e[i].time) <= 2) {
      row.time = e[i].time;
    }
  });
}

before(
  () => {
    if (!enabled) {
      return;
    }
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gitneat-loaders-")));
    execFileSync("cargo", ["build", "-q", "-p", "gitneat", "--example", "loaders"], { cwd: rustDir, stdio: "inherit" });
    example = path.join(rustDir, "target", "debug", "examples", process.platform === "win32" ? "loaders.exe" : "loaders");
  },
  { timeout: 600000 },
);

after(() => {
  if (enabled) {
    console.log(`loaders: ${compared} comparisons, ${failed} of them errors`);
  }
  if (root) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

for (const [name, build] of Object.entries(fixtures)) {
  test(`loaders: rust equals ts on ${name}`, { skip: !enabled, timeout: 300000 }, async () => {
    const dir = build();
    const list = await calls(dir);
    const expected: unknown[] = [];
    for (const call of list) {
      expected.push(await reference(call));
    }
    const out = execFileSync(example, [], { input: JSON.stringify(list), encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
    const actual = JSON.parse(out) as unknown[];
    assert.equal(actual.length, list.length);
    list.forEach((call, i) => {
      if (call.name === "loadBlame") {
        alignUncommitted(actual[i], expected[i]);
      }
      assert.deepStrictEqual(actual[i], expected[i], `${name} / ${call.name} / ${JSON.stringify({ ...call.args, cwd: undefined })}`);
      compared += 1;
      failed += "err" in (expected[i] as object) ? 1 : 0;
    });
  });
}
