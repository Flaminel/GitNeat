import assert from "node:assert/strict";
import test from "node:test";
import { layoutGraph } from "../src/graph.ts";

test("linear history stays in one lane", () => {
  const rows = layoutGraph([
    { sha: "c", parents: ["b"] },
    { sha: "b", parents: ["a"] },
    { sha: "a", parents: [] },
  ]);
  assert.deepEqual(rows.map((r) => r.col), [0, 0, 0]);
  assert.equal(rows[2].segments.length, 1);
});

test("branch and merge use a second lane then rejoin", () => {
  const rows = layoutGraph([
    { sha: "m", parents: ["a", "f"] },
    { sha: "f", parents: ["base"] },
    { sha: "a", parents: ["base"] },
    { sha: "base", parents: [] },
  ]);
  assert.deepEqual(rows.map((r) => r.col), [0, 1, 0, 0]);
  const baseRow = rows[3];
  assert.ok(baseRow.segments.some((s) => s.x1 === 1 && s.y1 === "top" && s.x2 === 0 && s.y2 === "mid"));
  assert.notEqual(rows[1].color, rows[0].color);
});

test("two unrelated tips get separate lanes", () => {
  const rows = layoutGraph([
    { sha: "x", parents: ["base"] },
    { sha: "y", parents: ["base"] },
    { sha: "base", parents: [] },
  ]);
  assert.deepEqual(rows.map((r) => r.col), [0, 1, 0]);
  assert.equal(rows[1].width, 2);
});
