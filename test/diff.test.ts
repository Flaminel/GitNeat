import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { hunkPatch, linesPatch } from "../src/diff";
import { parseDiff } from "./reference/diff";

function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gitneat-diff-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-q");
  git("config", "user.name", "t");
  git("config", "user.email", "t@example.com");
  fs.writeFileSync(path.join(dir, "f.txt"), Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n") + "\n");
  git("add", "f.txt");
  git("commit", "-q", "-m", "init");
  return dir;
}

const run = (dir: string, args: string[], input?: string) => execFileSync("git", args, { cwd: dir, encoding: "utf8", input });

test("parseDiff reads hunks and line numbers", () => {
  const d = parseDiff("diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n\\ No newline at end of file\n");
  assert.equal(d.hunks.length, 1);
  assert.deepEqual(
    d.hunks[0].lines.map((l) => [l.kind, l.old, l.next]),
    [
      ["ctx", 1, 1],
      ["del", 2, undefined],
      ["add", undefined, 2],
    ],
  );
  assert.equal(d.hunks[0].lines[2].noNewline, true);
});

test("hunk patch stages only one hunk", () => {
  const dir = repo();
  const file = path.join(dir, "f.txt");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("line 2\n", "two\n").replace("line 28\n", "twenty-eight\n"));
  const d = parseDiff(run(dir, ["diff", "--", "f.txt"]));
  assert.equal(d.hunks.length, 2);
  run(dir, ["apply", "--cached", "-"], hunkPatch(d, d.hunks[0]));
  assert.match(run(dir, ["diff", "--cached"]), /\+two/);
  assert.doesNotMatch(run(dir, ["diff", "--cached"]), /twenty-eight/);
});

test("line patch stages one added line and keeps the rest unstaged", () => {
  const dir = repo();
  const file = path.join(dir, "f.txt");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("line 5\n", "five\nextra\n"));
  const d = parseDiff(run(dir, ["diff", "--", "f.txt"]));
  const hunk = d.hunks[0];
  const extra = hunk.lines.findIndex((l) => l.text === "extra");
  const patch = linesPatch(d, hunk, new Set([extra]), false) as string;
  run(dir, ["apply", "--cached", "--recount", "-"], patch);
  const staged = run(dir, ["diff", "--cached"]);
  assert.match(staged, /\+extra/);
  assert.doesNotMatch(staged, /five/);
  assert.match(run(dir, ["diff"]), /\+five/);
});

test("reverse line patch unstages one line", () => {
  const dir = repo();
  const file = path.join(dir, "f.txt");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("line 5\n", "five\nextra\n"));
  run(dir, ["add", "f.txt"]);
  const d = parseDiff(run(dir, ["diff", "--cached", "--", "f.txt"]));
  const hunk = d.hunks[0];
  const extra = hunk.lines.findIndex((l) => l.text === "extra");
  run(dir, ["apply", "--cached", "-R", "--recount", "-"], linesPatch(d, hunk, new Set([extra]), true) as string);
  const staged = run(dir, ["diff", "--cached"]);
  assert.doesNotMatch(staged, /extra/);
  assert.match(staged, /\+five/);
});

test("line patch with nothing selected is null", () => {
  const d = parseDiff("--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n");
  assert.equal(linesPatch(d, d.hunks[0], new Set(), false), null);
});
