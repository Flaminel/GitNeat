import assert from "node:assert/strict";
import test, { before } from "node:test";
import type { Ctx } from "../src/actions";
import type { MenuSpec } from "../src/api";
import type { Commit, Ref, RepoData } from "../src/repo";

const HEAD = "h".repeat(40);
const OLD = "a".repeat(40);
let shown: MenuSpec[] = [];
let ancestorCode = 0;

(globalThis as { window?: unknown }).window = {
  gitneat: {
    platform: "darwin",
    menu: async (items: MenuSpec[]) => {
      shown = items;
      return null;
    },
    git: async (_cwd: string, args: string[]) => {
      if (args[0] === "merge-base") {
        return { code: ancestorCode, stdout: "", stderr: "" };
      }
      if (args[0] === "rev-parse") {
        return { code: 0, stdout: `${HEAD}\n`, stderr: "" };
      }
      if (args[0] === "rev-list") {
        return { code: 0, stdout: args.includes("--merges") ? "0\n" : "11\n", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
  },
};

let M: typeof import("./reference/menus");

before(async () => {
  M = await import("./reference/menus");
});

function labels(items: MenuSpec[]): string[] {
  return items.map((i) => (i.type === "separator" ? "|" : (i.label as string)));
}

function makeCtx(refs: Ref[]): Ctx {
  const data: RepoData = {
    cwd: "/repo",
    name: "repo",
    head: HEAD,
    branch: "fix_e2e_failures",
    commits: [],
    refs,
    stashes: [],
    worktrees: [],
    remotes: [{ name: "origin", url: "git@github.com:owner/repo.git" }],
    submodules: [],
    status: [],
    operation: null,
  };
  return {
    cwd: "/repo",
    data,
    ui: {} as Ctx["ui"],
    refresh: () => undefined,
    openTab: () => undefined,
    openRebase: () => undefined,
    toggleHidden: () => undefined,
    setHidden: () => undefined,
    setSolo: () => undefined,
    toggleSolo: () => undefined,
    hidden: [],
    solo: [],
    record: () => undefined,
  };
}

const commit = (sha: string): Commit => ({ sha, parents: ["p".repeat(40)], author: "A", email: "a@x", time: 0, subject: "s" });

test("commit menu for an older commit matches the Source order", async () => {
  ancestorCode = 0;
  await M.commitMenu(makeCtx([]), commit(OLD));
  assert.deepEqual(labels(shown), [
    "Checkout this commit",
    "|",
    "Create worktree from this commit",
    "|",
    "Create branch here",
    "Cherry pick commit",
    "Reset fix_e2e_failures to this commit",
    "Revert commit",
    "|",
    "Interactive Rebase 11 children of aaaaaaa",
    "Edit commit message",
    "Drop commit",
    "Move commit up",
    "Move commit down",
    "|",
    "Copy commit sha",
    "Copy link to this commit on remote: origin",
    "Create patch from commit",
    "|",
    "Create tag here",
    "Create annotated tag here",
  ]);
  assert.deepEqual(labels(shown[6].submenu as MenuSpec[]), [
    "Soft - keep all changes",
    "Mixed - keep working copy but reset index",
    "Hard - discard all changes",
  ]);
});

test("commit menu for HEAD hides cherry pick and puts edit message after revert", async () => {
  ancestorCode = 0;
  await M.commitMenu(makeCtx([]), commit(HEAD));
  const l = labels(shown);
  assert.ok(!l.includes("Cherry pick commit"));
  assert.equal(l[l.indexOf("Revert commit") + 1], "Edit commit message");
  assert.ok(!l.some((x) => x.startsWith("Interactive Rebase")));
  assert.ok(!l.includes("Move commit up"));
});

test("commit menu for a commit outside the HEAD history has no rebase items", async () => {
  ancestorCode = 1;
  await M.commitMenu(makeCtx([]), commit(OLD));
  const l = labels(shown);
  assert.ok(l.includes("Cherry pick commit"));
  assert.ok(!l.includes("Drop commit"));
  assert.ok(!l.includes("Edit commit message"));
});

test("commit with one branch matches the Source branch menu", async () => {
  ancestorCode = 1;
  const ref: Ref = { kind: "local", name: "fix_session_revocation", full: "refs/heads/fix_session_revocation", sha: OLD, upstream: "origin/fix_session_revocation" };
  await M.commitMenu(makeCtx([ref]), commit(OLD));
  assert.deepEqual(labels(shown), [
    "Pull (fast-forward if possible)",
    "Push",
    "Set Upstream",
    "|",
    "Merge fix_session_revocation into fix_e2e_failures",
    "Rebase fix_e2e_failures onto fix_session_revocation",
    "Interactive Rebase fix_e2e_failures onto fix_session_revocation",
    "|",
    "Checkout",
    "|",
    "Create worktree from",
    "|",
    "Create branch here",
    "Cherry pick commit",
    "Reset fix_e2e_failures to this commit",
    "Revert commit",
    "|",
    "Rename fix_session_revocation",
    "Delete fix_session_revocation",
    "|",
    "Copy branch name",
    "Copy commit sha",
    "Create patch from commit",
    "|",
    "Solo",
    "|",
    "Create tag here",
    "Create annotated tag here",
  ]);
  assert.deepEqual(labels(shown[8].submenu as MenuSpec[]), ["fix_session_revocation", "this commit"]);
  assert.deepEqual(labels(shown[10].submenu as MenuSpec[]), ["fix_session_revocation", "this commit"]);
});

test("local and remote branch on one commit form one group", async () => {
  ancestorCode = 1;
  const local: Ref = { kind: "local", name: "main", full: "refs/heads/main", sha: OLD, upstream: "origin/main" };
  const remote: Ref = { kind: "remote", name: "origin/main", full: "refs/remotes/origin/main", sha: OLD };
  await M.commitMenu(makeCtx([remote, local]), commit(OLD));
  const l = labels(shown);
  assert.equal(l[0], "Pull (fast-forward if possible)");
  assert.ok(l.includes("Delete main and origin/main"));
  assert.ok(l.includes("Start a pull request from main"));
  assert.deepEqual(labels(shown[l.indexOf("Checkout")].submenu as MenuSpec[]), ["main", "origin/main", "this commit"]);
});

test("left panel branch menu has Hide and no commit checkout", async () => {
  ancestorCode = 1;
  const ref: Ref = { kind: "local", name: "feature", full: "refs/heads/feature", sha: OLD };
  await M.refMenu(makeCtx([ref]), ref, true);
  const l = labels(shown);
  assert.ok(l.includes("Checkout feature"));
  assert.ok(l.includes("Create worktree from feature"));
  assert.ok(!l.includes("Create patch from commit"));
  assert.deepEqual(l.slice(-2), ["Hide", "Solo"]);
});
