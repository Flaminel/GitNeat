import assert from "node:assert/strict";
import { test } from "node:test";
import { available, Command, EMPTY_FRECENCY, frecencyScore, fuzzyScore, matchPositions, parseFrecency, rank, record, workingFiles } from "../src/palette";
import { pullRequestUrl } from "../src/repo";

const item = (id: string, label: string, extra: Partial<Command> = {}): Command => ({ id, label, ...extra });
const NOW = 1_700_000_000_000;

test("a query matches only a subsequence", () => {
  assert.deepEqual(matchPositions("Open Repo", "opr"), [0, 1, 5]);
  assert.equal(matchPositions("Open Repo", "xyz"), null);
  assert.equal(fuzzyScore("Open Repo", "zz"), 0);
});

test("an exact word match scores above a scattered match", () => {
  assert.ok(fuzzyScore("Create Branch", "branch") > fuzzyScore("Rename Branch Cursor", "cbr"));
});

test("an empty query keeps all items and sorts the top list by name", () => {
  const items = [item("b", "Pull"), item("a", "Fetch All"), item("c", "Undo", { prefix: "" })];
  assert.deepEqual(
    rank(items, "top", "", EMPTY_FRECENCY, NOW).map((i) => i.id),
    ["a", "b", "c"],
  );
});

test("hidden text is searchable", () => {
  const items = [item("a", "Discard all changes", { hidden: "reset hard all" }), item("b", "Pull")];
  assert.deepEqual(
    rank(items, "top", "reset", EMPTY_FRECENCY, NOW).map((i) => i.id),
    ["a"],
  );
});

test("a recent choice ranks first for the same query", () => {
  const items = [item("a", "Pull"), item("b", "Push")];
  const used = record(EMPTY_FRECENCY, "top", "b", "pu", NOW - 1000);
  assert.deepEqual(
    rank(items, "top", "pu", used, NOW).map((i) => i.id),
    ["b", "a"],
  );
});

test("frecency keeps ten timestamps and ignores other domains", () => {
  let f = EMPTY_FRECENCY;
  for (let i = 0; i < 12; i++) {
    f = record(f, "top", "a", "", NOW + i);
  }
  assert.equal(f.items.top.a.t.length, 10);
  assert.equal(f.items.top.a.total, 12);
  assert.equal(record(f, "checkout", "a", "", NOW), f);
  assert.equal(frecencyScore(NOW + 100, f.items.top.a), 12 * 100);
  assert.equal(frecencyScore(NOW + 40 * 864e5, f.items.top.a), 0);
});

test("a bad stored value gives an empty record", () => {
  assert.deepEqual(parseFrecency("{"), EMPTY_FRECENCY);
  assert.deepEqual(parseFrecency(5), EMPTY_FRECENCY);
});

test("commands follow the repository, detached head and operation flags", () => {
  const repoOnly = item("a", "Fetch All", { flags: { repo: true } });
  const attached = item("b", "Push", { flags: { repo: true, detached: false, busy: false } });
  const none = { hasRepo: false, detached: false, busy: false };
  assert.equal(available(repoOnly, none), false);
  assert.equal(available(repoOnly, { ...none, hasRepo: true }), true);
  assert.equal(available(attached, { hasRepo: true, detached: true, busy: false }), false);
  assert.equal(available(attached, { hasRepo: true, detached: false, busy: true }), false);
  assert.equal(available(item("c", "Clone"), none), true);
});

test("the working file list adds new files and drops deleted and renamed ones", () => {
  const status = [
    { path: "new.ts", index: "A", work: " " },
    { path: "loose.ts", index: "?", work: "?" },
    { path: "gone.ts", index: " ", work: "D" },
    { path: "moved.ts", orig: "old.ts", index: "R", work: " " },
  ];
  assert.deepEqual(workingFiles(["gone.ts", "old.ts", "keep.ts"], status).sort(), ["keep.ts", "loose.ts", "moved.ts", "new.ts"]);
});

test("the pull request address follows the hosting service", () => {
  assert.equal(pullRequestUrl("https://github.com/o/r", "feat/x"), "https://github.com/o/r/compare/feat/x?expand=1");
  assert.equal(pullRequestUrl("https://gitlab.com/o/r", "feat/x"), "https://gitlab.com/o/r/-/merge_requests/new?merge_request[source_branch]=feat%2Fx");
  assert.equal(pullRequestUrl("https://bitbucket.org/o/r", "x"), "https://bitbucket.org/o/r/pull-requests/new?source=x");
  assert.equal(pullRequestUrl("https://example.com/o/r", "x"), "https://example.com/o/r");
});
