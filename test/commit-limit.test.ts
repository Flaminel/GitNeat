import assert from "node:assert/strict";
import { test } from "node:test";
import { canLoadMore, COMMIT_CEILING, pageSize, showsFooter } from "../src/commitLimit";

test("a page has 200 commits and stops at the ceiling", () => {
  assert.equal(pageSize(2000), 200);
  assert.equal(pageSize(COMMIT_CEILING - 50), 50);
  assert.equal(pageSize(COMMIT_CEILING), 0);
});

test("load more needs lazy loading, a full load and room below the ceiling", () => {
  assert.equal(canLoadMore(true, 2000, 2000), true);
  assert.equal(canLoadMore(true, 1500, 2000), false);
  assert.equal(canLoadMore(false, 2000, 2000), false);
  assert.equal(canLoadMore(true, COMMIT_CEILING, COMMIT_CEILING), false);
});

test("the footer shows only when lazy loading is off", () => {
  assert.equal(showsFooter(false), true);
  assert.equal(showsFooter(true), false);
});
