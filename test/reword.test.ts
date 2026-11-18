import assert from "node:assert/strict";
import test from "node:test";
import { rewordDepth } from "../src/actions";
import type { Commit, RepoData } from "../src/repo";

const commit = (sha: string, parents: string[]): Commit => ({ sha, parents, author: "a", email: "a@a", time: 0, subject: sha });

const data = (commits: Commit[], operation: RepoData["operation"] = null) =>
  ({ head: commits[0].sha, commits, operation }) as RepoData;

const history = [commit("d", ["c"]), commit("c", ["m"]), commit("m", ["b", "x"]), commit("x", ["a"]), commit("b", ["a"]), commit("a", [])];

test("reword depth follows single-parent commits from HEAD", () => {
  const repo = data(history);
  assert.equal(rewordDepth(repo, "d"), 0);
  assert.equal(rewordDepth(repo, "c"), 1);
  assert.equal(rewordDepth(repo, "m"), null);
  assert.equal(rewordDepth(repo, "b"), null);
  assert.equal(rewordDepth(repo, "x"), null);
});

test("reword depth reaches the root commit and stops during an operation", () => {
  const linear = [commit("c", ["b"]), commit("b", ["a"]), commit("a", [])];
  assert.equal(rewordDepth(data(linear), "a"), 2);
  assert.equal(rewordDepth(data(linear, "rebase"), "c"), null);
});

test("a merge commit at HEAD stays amendable", () => {
  assert.equal(rewordDepth(data(history.slice(2)), "m"), 0);
});
