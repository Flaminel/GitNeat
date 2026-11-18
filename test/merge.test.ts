import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildOutput, sideLines } from "../src/merge";
import { parseMerge } from "./reference/merge";

function segments() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gitneat-merge-"));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@x", ...args], { cwd: dir, encoding: "utf8" });
  const write = (text: string) => fs.writeFileSync(path.join(dir, "f.txt"), text);
  git("init", "-q", "-b", "main");
  write("top\nx1\nx2\nmid\ny1\nbottom\n");
  git("add", "f.txt");
  git("commit", "-q", "-m", "base");
  git("checkout", "-q", "-b", "other");
  write("top\nB1\nB2\nmid\nB-y\nbottom\nB-extra\n");
  git("commit", "-qam", "other");
  git("checkout", "-q", "main");
  write("top\nA1\nA2\nA3\nmid\nA-y\nbottom\n");
  git("commit", "-qam", "main");
  spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@x", "merge", "other"], { cwd: dir });
  const show = (stage: number) => {
    const file = path.join(dir, `stage${stage}`);
    fs.writeFileSync(file, git("show", `:${stage}:f.txt`));
    return file;
  };
  const merged = spawnSync("git", ["merge-file", "-p", "--diff3", "-L", "A", "-L", "base", "-L", "B", show(2), show(1), show(3)], { encoding: "utf8" });
  assert.equal(merged.status, 2);
  return parseMerge(merged.stdout);
}

test("parseMerge splits common and conflict segments", () => {
  const s = segments();
  assert.deepEqual(
    s.map((x) => x.kind),
    ["common", "conflict", "common", "conflict", "common"],
  );
  assert.deepEqual(s[1], { kind: "conflict", a: ["A1", "A2", "A3"], base: ["x1", "x2"], b: ["B1", "B2"] });
  assert.deepEqual(s[3], { kind: "conflict", a: ["A-y"], base: ["y1"], b: ["B-y"] });
});

test("sideLines gives full side text and conflict starts", () => {
  const s = segments();
  const a = sideLines(s, "a");
  assert.deepEqual(a.starts, [2, 6]);
  assert.equal(a.lines[5], "A-y");
});

test("buildOutput takes sides and lines in pick order", () => {
  const s = segments();
  const all = (side: "a" | "b", n: number) => Array.from({ length: n }, (_, line) => ({ side, line }));
  const a = buildOutput(s, [all("a", 3), all("a", 1)]);
  assert.equal(a.text, "top\nA1\nA2\nA3\nmid\nA-y\nbottom\nB-extra\n");
  assert.deepEqual(a.ranges, [
    { start: 2, end: 4 },
    { start: 6, end: 6 },
  ]);
  assert.equal(buildOutput(s, [all("b", 2), all("b", 1)]).text, "top\nB1\nB2\nmid\nB-y\nbottom\nB-extra\n");
  const both = buildOutput(s, [[...all("b", 2), ...all("a", 3)], []]);
  assert.equal(both.text, "top\nB1\nB2\nA1\nA2\nA3\nmid\nbottom\nB-extra\n");
  assert.deepEqual(both.ranges[1], { start: 8, end: 7 });
  assert.equal(buildOutput(s, [[{ side: "a", line: 2 }, { side: "b", line: 0 }], undefined]).text, "top\nA3\nB1\nmid\nbottom\nB-extra\n");
});

test("buildOutput writes markers for unresolved conflicts", () => {
  const s = segments();
  const out = buildOutput(s, [[{ side: "b", line: 0 }], undefined], true);
  assert.equal(out.text, "top\nB1\nmid\n<<<<<<< A\nA-y\n=======\nB-y\n>>>>>>> B\nbottom\nB-extra\n");
  assert.deepEqual(out.ranges[1], { start: 4, end: 8 });
  assert.equal(buildOutput(s, [undefined, undefined]).text, "top\nmid\nbottom\nB-extra\n");
});
