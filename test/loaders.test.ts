import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { enabled, golden } from "./golden";

const rustDir = path.resolve(process.cwd(), "rust");

const IDENT = ["-c", "user.name=t", "-c", "user.email=t@x", "-c", "commit.gpgsign=false"];
let root = "";
let example = "";
let compared = 0;
let failed = 0;
const perName: Record<string, number> = {};

let clock = 0;

function stamp(): string {
  clock += 1;
  return `${1577836800 + clock * 60} +0000`;
}

function g(cwd: string, ...args: string[]): string {
  const date = stamp();
  return execFileSync("git", [...IDENT, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LC_ALL: "C", GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
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
  clock = 0;
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
  conflictkinds: () => {
    const dir = init("conflictkinds");
    commit(dir, "mod.txt", "one\ntwo\nthree\n", "base mod");
    commit(dir, "gone.txt", "g\n", "base gone");
    commit(dir, "kept.txt", "k\n", "base kept");
    commit(dir, "img.bin", Buffer.from([0, 1, 2]), "base bin");
    commit(dir, "win.txt", "a\r\nb\r\nc\r\n", "base crlf");
    g(dir, "checkout", "-q", "-b", "side");
    commit(dir, "mod.txt", "one\nside\nthree\nfour\n", "side mod");
    g(dir, "rm", "-q", "kept.txt");
    commit(dir, "gone.txt", "g side\n", "side gone");
    commit(dir, "img.bin", Buffer.from([0, 9, 9]), "side bin");
    commit(dir, "both.txt", "side add\n", "side add");
    commit(dir, "win.txt", "a\r\nside\r\nc\r\n", "side crlf");
    commit(dir, "extra.txt", "e\n", "side extra");
    g(dir, "checkout", "-q", "main");
    commit(dir, "mod.txt", "one\nmain\nthree\n", "main mod");
    g(dir, "rm", "-q", "gone.txt");
    g(dir, "commit", "-q", "-m", "main gone");
    commit(dir, "kept.txt", "k main\n", "main kept");
    commit(dir, "img.bin", Buffer.from([0, 7, 7]), "main bin");
    commit(dir, "both.txt", "main add\n", "main add");
    commit(dir, "win.txt", "a\r\nmain\r\nc\r\n", "main crlf");
    g(dir, "update-ref", "refs/remotes/origin/feature", "side");
    gTry(dir, "merge", "side~1");
    return dir;
  },
  remotemerge: () => {
    const dir = init("remotemerge");
    commit(dir, "a.txt", "base\n", "base");
    g(dir, "checkout", "-q", "-b", "side");
    commit(dir, "a.txt", "side\n", "side change");
    g(dir, "checkout", "-q", "main");
    commit(dir, "a.txt", "main\n", "main change");
    g(dir, "update-ref", "refs/remotes/origin/feature", "side");
    g(dir, "branch", "-q", "-D", "side");
    gTry(dir, "merge", "origin/feature");
    return dir;
  },
  picking: () => {
    const dir = init("picking");
    commit(dir, "a.txt", "base\n", "base");
    g(dir, "checkout", "-q", "-b", "side");
    commit(dir, "a.txt", "side\n", "side change");
    g(dir, "checkout", "-q", "main");
    commit(dir, "a.txt", "main\n", "main change");
    gTry(dir, "cherry-pick", "side");
    return dir;
  },
  rebasing: () => {
    const dir = init("rebasing");
    commit(dir, "a.txt", "base\n", "base");
    g(dir, "checkout", "-q", "-b", "side");
    commit(dir, "a.txt", "side\n", "side change");
    g(dir, "checkout", "-q", "main");
    commit(dir, "a.txt", "main\n", "main change");
    gTry(dir, "rebase", "side");
    return dir;
  },
  reverting: () => {
    const dir = init("reverting");
    commit(dir, "a.txt", "base\n", "base");
    commit(dir, "a.txt", "changed\n", "change");
    commit(dir, "a.txt", "changed again\n", "change again");
    gTry(dir, "revert", "--no-edit", "HEAD~1");
    return dir;
  },
  empty: () => init("empty"),
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

type DiffSource = Record<string, unknown>;

function commitDetail(dir: string, sha: string): { files: { path: string; orig?: string }[]; parents: string[] } {
  const input = JSON.stringify([{ name: "loadCommit", args: { cwd: dir, sha } }]);
  const out = execFileSync(example, [], { input, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  return (JSON.parse(out) as { ok: { files: { path: string; orig?: string }[]; parents: string[] } }[])[0].ok;
}

async function calls(dir: string): Promise<Call[]> {
  const list: Call[] = [];
  const add = (name: string, args: Record<string, unknown>) => list.push({ name, args: { cwd: dir, ...args } });
  const shas = g(dir, "rev-list", "--all").split("\n").filter(Boolean);
  const touched = new Set<string>();
  for (const sha of shas) {
    add("loadCommit", { sha });
    add("loadAllFiles", { sha });
    const detail = commitDetail(dir, sha);
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
  for (const e of statusEntries(dir)) {
    if (e.index === "U" || e.work === "U" || (e.index === "A" && e.work === "A") || (e.index === "D" && e.work === "D")) {
      for (const operation of [null, "merge", "rebase", "cherry-pick", "revert"]) {
        add("loadMerge", { file: e.path, operation });
      }
    }
  }
  add("loadMerge", { file: "missing.txt", operation: "merge" });
  add("loadHeadMessage", {});
  add("loadCommit", { sha: "nope" });
  add("loadAllFiles", { sha: "nope" });
  add("loadBlame", { file: "missing.txt" });
  add("loadFileHistory", { file: "missing.txt" });
  add("loadDiff", { source: { kind: "commit", sha: "nope", parent: "nope2" }, file: "x" });
  add("loadSides", { source: { kind: "commit", sha: "nope" }, file: "x" });
  return list;
}

before(
  () => {
    if (!enabled) {
      return;
    }
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gitneat-loaders-")));
    execFileSync("cargo", ["build", "-q", "-p", "gitneat-core", "--example", "loaders"], { cwd: rustDir, stdio: "inherit" });
    const exe = process.platform === "win32" ? ".exe" : "";
    example = path.join(rustDir, "target", "debug", "examples", `loaders${exe}`);
  },
  { timeout: 600000 },
);

after(() => {
  if (enabled) {
    console.log(`loaders: ${compared} comparisons, ${failed} of them errors`, perName);
  }
  if (root) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const record = golden("loaders");

function check(key: string, value: unknown): void {
  record(key, JSON.parse(JSON.stringify(value).split(root).join("<root>")));
}

function steady(call: Call, value: unknown): unknown {
  const rows = (value as { ok?: { sha: string; time: number }[] }).ok;
  if (call.name === "loadBlame" && Array.isArray(rows)) {
    for (const row of rows) {
      if (/^0{40}$/.test(row.sha)) {
        row.time = 0;
      }
    }
  }
  return value;
}

for (const [name, build] of Object.entries(fixtures)) {
  test(`loaders: ${name}`, { skip: !enabled, timeout: 300000 }, async () => {
    const dir = build();
    const list = await calls(dir);
    const out = execFileSync(example, [], { input: JSON.stringify(list), encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
    const actual = JSON.parse(out) as unknown[];
    assert.equal(actual.length, list.length);
    list.forEach((call, i) => {
      check(`${name} / ${call.name} / ${JSON.stringify({ ...call.args, cwd: undefined })}`, steady(call, actual[i]));
      compared += 1;
      failed += "err" in (actual[i] as object) ? 1 : 0;
      const kind = (actual[i] as { ok?: { kind?: string } }).ok?.kind;
      const key = call.name === "loadMerge" ? `${call.name}:${kind ?? "err"}` : call.name;
      perName[key] = (perName[key] ?? 0) + 1;
    });
  });
}
