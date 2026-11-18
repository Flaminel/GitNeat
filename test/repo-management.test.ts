import assert from "node:assert/strict";
import { test } from "node:test";
import { allRepos, countCaption, editorCaption, groupOrder, moveGroup, matchRepo, sortWorkspaces, Workspace } from "../src/repoManagement";

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

test("saved group order keeps known ids and adds missing ones", () => {
  const list = [ws("b", "beta"), ws("a", "Alpha")];
  assert.deepEqual(groupOrder(list, ["all", "gone", "b", "recent"]), ["open", "favorites", "all", "b", "recent", "a"]);
  assert.deepEqual(groupOrder(list, ["a", "b"]), ["open", "favorites", "recent", "a", "b", "all"]);
  assert.deepEqual(moveGroup(["x", "y", "z"], "x", "z"), ["y", "z", "x"]);
  assert.deepEqual(moveGroup(["x", "y", "z"], "z", "x"), ["z", "x", "y"]);
});

test("the editor caption follows the selection count", () => {
  assert.equal(editorCaption(3, 3, null), "Open in external editor");
  assert.equal(editorCaption(1, 3, "Code"), "Open in Code");
  assert.equal(editorCaption(3, 3, "Code"), "Open all in Code workspace");
  assert.equal(editorCaption(2, 3, "Code"), "Open 2 in Code workspace");
});
