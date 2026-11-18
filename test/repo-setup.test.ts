import assert from "node:assert/strict";
import { test } from "node:test";
import { cloneName, isAbsolutePath, joinPath, validBranchName, validDepth, validFolderName, validSince } from "../src/repoSetup";

test("derives the clone folder from the url", () => {
  assert.equal(cloneName("https://github.com/owner/repo.git"), "repo");
  assert.equal(cloneName("git@github.com:owner/tool.git/"), "tool");
  assert.equal(cloneName(""), "repo");
});

test("joins paths with the separator of the parent", () => {
  assert.equal(joinPath("/home/a/", "x"), "/home/a/x");
  assert.equal(joinPath("C:\\Users\\a", "x"), "C:\\Users\\a\\x");
  assert.equal(isAbsolutePath("C:\\x"), true);
  assert.equal(isAbsolutePath("rel/x"), false);
});

test("validates the form values", () => {
  assert.equal(validFolderName("a/b"), false);
  assert.equal(validFolderName(" demo "), true);
  assert.equal(validBranchName("bad name"), false);
  assert.equal(validBranchName("feature/x"), true);
  assert.equal(validSince("2024-01-31"), true);
  assert.equal(validSince("nope"), false);
  assert.equal(validDepth("0"), false);
  assert.equal(validDepth(""), true);
});
