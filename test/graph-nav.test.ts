import assert from "node:assert/strict";
import { test } from "node:test";
import { topologicalStep } from "../src/graphNav";

const commits = [
  { sha: "m", parents: ["a", "f"] },
  { sha: "f", parents: ["b"] },
  { sha: "a", parents: ["b"] },
  { sha: "b", parents: ["c"] },
  { sha: "c", parents: [] },
];

test("up follows the first parent", () => {
  assert.equal(topologicalStep(commits, "m", true)?.sha, "a");
  assert.equal(topologicalStep(commits, "a", true)?.sha, "b");
  assert.equal(topologicalStep(commits, "c", true), undefined);
});

test("down follows the nearest child that has the commit as first parent", () => {
  assert.equal(topologicalStep(commits, "b", false)?.sha, "a");
  assert.equal(topologicalStep(commits, "a", false)?.sha, "m");
  assert.equal(topologicalStep(commits, "f", false)?.sha, "m");
  assert.equal(topologicalStep(commits, "m", false), undefined);
});
