import assert from "node:assert/strict";
import { test } from "node:test";
import { allRepos, countCaption, groupOrder, matchRepo, sortWorkspaces, Workspace } from "../src/repoManagement";

const ws = (id: string, name: string, syncPath?: string): Workspace => ({ id, name, description: "", repos: [], syncPath });

test("groups order synced workspaces after plain ones", () => {
  const list = [ws("s", "A sync", "/d"), ws("b", "beta"), ws("a", "Alpha")];
  assert.deepEqual(sortWorkspaces(list).map((w) => w.id), ["a", "b", "s"]);
  assert.deepEqual(groupOrder(list), ["open", "favorites", "recent", "a", "b", "s", "all"]);
});

test("all repositories have no duplicates and no failed workspace repos", () => {
  const out = allRepos(["/o"], ["/f", "/o"], ["/r"], [["/w", "/f", "/bad"]], (p) => p === "/bad");
  assert.deepEqual(out, ["/o", "/f", "/r", "/w"]);
});

test("the action caption follows the selection count", () => {
  assert.equal(countCaption(1, 5, "one", "all", "{0} many"), "one");
  assert.equal(countCaption(5, 5, "one", "all", "{0} many"), "all");
  assert.equal(countCaption(3, 5, "one", "all", "{0} many"), "3 many");
  assert.equal(matchRepo("GitNeat", "neat"), true);
  assert.equal(matchRepo("GitNeat", "source"), false);
});
