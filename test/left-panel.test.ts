import assert from "node:assert/strict";
import { test } from "node:test";
import { boundedYs, limitsFor, resizableHandles, sectionHeights } from "../src/leftPanel";

const keys = ["A", "B", "C"];

test("default ys use 162 for each section", () => {
  const limits = [true, true, true].map(limitsFor);
  const ys = boundedYs(keys, limits, 600, {});
  assert.deepEqual(ys, { A: 162, B: 324, C: 600 });
  assert.deepEqual(sectionHeights(keys, ys), { A: 162, B: 162, C: 276 });
});

test("a drag below the minimum clamps to 138", () => {
  const limits = [true, true, true].map(limitsFor);
  const ys = boundedYs(keys, limits, 600, { A: 50, B: 324 });
  assert.equal(ys.A, 138);
});

test("a drag pushes the later section", () => {
  const limits = [true, true, true].map(limitsFor);
  const ys = boundedYs(keys, limits, 600, { A: 300, B: 324 });
  assert.deepEqual(ys, { A: 300, B: 438, C: 600 });
});

test("a drag stops where the later sections keep their minimum", () => {
  const limits = [true, true, true].map(limitsFor);
  const ys = boundedYs(keys, limits, 600, { A: 500, B: 324 });
  assert.deepEqual(ys, { A: 324, B: 462, C: 600 });
});

test("a collapsed section has the header height", () => {
  const limits = [true, false, true].map(limitsFor);
  const ys = boundedYs(keys, limits, 600, {});
  assert.deepEqual(sectionHeights(keys, ys), { A: 162, B: 30, C: 408 });
});

test("handles skip the last section and fixed edge sections", () => {
  assert.deepEqual(resizableHandles([true, true, true].map(limitsFor)), [true, true, false]);
  assert.deepEqual(resizableHandles([true, true, false].map(limitsFor)), [true, false, false]);
  assert.deepEqual(resizableHandles([false, true, true, true].map(limitsFor)), [false, true, true, false]);
  assert.deepEqual(resizableHandles([true, false, true].map(limitsFor)), [true, true, false]);
});
