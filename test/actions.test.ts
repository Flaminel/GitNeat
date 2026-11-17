import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import type * as ActionsModule from "../src/actions";
import type { Commit, Ref } from "../src/repo";
import type { GitResult } from "../src/api";

type Ctx = ActionsModule.Ctx;
type UndoEntry = ActionsModule.UndoEntry;

const enabled = process.env.GITNEAT_RUST_COMPARE === "1";
const rustDir = path.resolve(process.cwd(), "rust");

function runGit(cwd: string, args: string[], env?: Record<string, string>, input?: string): Promise<GitResult> {
  return new Promise((resolve) => {
    const child = execFile(
      "git",
      args,
      { cwd, maxBuffer: 512 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C", ...env } },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        resolve({ code, stdout, stderr: stderr || (error && code !== 0 ? error.message : "") });
      },
    );
    if (input !== undefined) {
      child.stdin?.end(input);
    }
  });
}

interface Dirs {
  root: string;
  repo: string;
  remote: string;
  other: string;
  wt: string;
}

interface Harness {
  log: string[];
  recorded: UndoEntry[];
}

interface Scenario {
  name: string;
  setup: (d: Dirs) => void;
  run: (ctx: Ctx, d: Dirs, h: Harness) => Promise<unknown>;
  prompt?: Record<string, string> | null | ((d: Dirs) => Record<string, string>);
  confirm?: boolean | ((title: string) => boolean);
  expect?: RegExp;
}

let runRoot = "";
let example = "";
let A: typeof ActionsModule;
let loadRepo: typeof import("../src/repo").loadRepo;

function g(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function out(cwd: string, ...args: string[]): string {
  try {
    return g(cwd, ...args);
  } catch (error) {
    return `ERR ${(error as Error).message}`;
  }
}

function tryGit(cwd: string, ...args: string[]): void {
  try {
    g(cwd, ...args);
  } catch {
    return;
  }
}

function write(dir: string, name: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
  fs.writeFileSync(path.join(dir, name), text);
}

function commit(dir: string, name: string, text: string, message: string): void {
  write(dir, name, text);
  g(dir, "add", "-A");
  g(dir, "commit", "-q", "-m", message);
}

function base(d: Dirs): void {
  fs.mkdirSync(d.repo, { recursive: true });
  g(d.repo, "init", "-q", "-b", "main");
  commit(d.repo, "a.txt", "one\n", "first");
  commit(d.repo, "b.txt", "two\n", "second");
}

function branches(d: Dirs): void {
  base(d);
  g(d.repo, "branch", "merged");
  g(d.repo, "checkout", "-q", "-b", "unmerged");
  commit(d.repo, "u.txt", "u\n", "unmerged work");
  g(d.repo, "checkout", "-q", "-b", "side", "main");
  commit(d.repo, "s.txt", "s\n", "side work");
  g(d.repo, "checkout", "-q", "main");
}

function conflict(d: Dirs): void {
  base(d);
  g(d.repo, "checkout", "-q", "-b", "side", "main~1");
  commit(d.repo, "a.txt", "side\n", "side change");
  g(d.repo, "checkout", "-q", "main");
  commit(d.repo, "a.txt", "main\n", "main change");
}

function linear(d: Dirs): void {
  base(d);
  commit(d.repo, "c.txt", "c\n", "third");
  commit(d.repo, "d.txt", "d\n", "fourth");
  commit(d.repo, "c.txt", "c2\n", "fifth");
}

function merges(d: Dirs): void {
  base(d);
  g(d.repo, "checkout", "-q", "-b", "feat");
  commit(d.repo, "f.txt", "f\n", "feature work");
  g(d.repo, "checkout", "-q", "main");
  commit(d.repo, "m.txt", "m\n", "main work");
  g(d.repo, "merge", "-q", "--no-ff", "-m", "merge feat", "feat");
}

function remote(d: Dirs): void {
  base(d);
  g(d.root, "clone", "-q", "--bare", d.repo, d.remote);
  g(d.repo, "remote", "add", "origin", d.remote);
  g(d.repo, "fetch", "-q", "origin");
  g(d.repo, "branch", "--set-upstream-to=origin/main", "main");
  g(d.repo, "checkout", "-q", "-b", "topic");
  commit(d.repo, "t.txt", "t\n", "topic work");
  g(d.repo, "push", "-q", "-u", "origin", "topic");
  g(d.repo, "checkout", "-q", "main");
}

function remoteWork(d: Dirs): void {
  g(d.root, "clone", "-q", d.remote, d.other);
  commit(d.other, "r.txt", "r\n", "remote work");
  g(d.other, "push", "-q", "origin", "main");
}

function behind(d: Dirs): void {
  remote(d);
  remoteWork(d);
  g(d.repo, "fetch", "-q", "origin");
}

function diverged(d: Dirs, fetch: boolean): void {
  remote(d);
  remoteWork(d);
  commit(d.repo, "l.txt", "l\n", "local work");
  if (fetch) {
    g(d.repo, "fetch", "-q", "origin");
  }
}

function dirty(d: Dirs): void {
  base(d);
  write(d.repo, "a.txt", "dirty\n");
  write(d.repo, "new.txt", "new\n");
}

function stashed(d: Dirs): void {
  base(d);
  write(d.repo, "a.txt", "stashed\n");
  write(d.repo, "u.txt", "untracked\n");
  g(d.repo, "stash", "push", "-q", "--include-untracked");
}

function merging(d: Dirs): void {
  conflict(d);
  tryGit(d.repo, "merge", "side");
}

function rebasing(d: Dirs): void {
  conflict(d);
  tryGit(d.repo, "rebase", "side");
}

function picking(d: Dirs): void {
  conflict(d);
  tryGit(d.repo, "cherry-pick", "side");
}

const lref = (ctx: Ctx, name: string): Ref => ctx.data.refs.find((r) => r.kind === "local" && r.name === name) as Ref;
const rref = (ctx: Ctx, name: string): Ref => ctx.data.refs.find((r) => r.kind === "remote" && r.name === name) as Ref;
const by = (ctx: Ctx, subject: string): Commit => ctx.data.commits.find((c) => c.subject === subject) as Commit;
const sha = (ctx: Ctx, subject: string): string => by(ctx, subject).sha;

const scenarios: Scenario[] = [];

function S(name: string, setup: Scenario["setup"], run: Scenario["run"], options: Partial<Scenario> = {}): void {
  scenarios.push({ name, setup, run, ...options });
}

S("checkoutRef", branches, (ctx) => A.checkoutRef(ctx, "side"));
S("checkoutRef-error", (d) => {
  conflict(d);
  write(d.repo, "a.txt", "dirty\n");
}, (ctx) => A.checkoutRef(ctx, "side"), { expect: /overwritten/ });
S("checkoutCommit", branches, (ctx) => A.checkoutCommit(ctx, sha(ctx, "first")));
S("checkoutCommit-error", base, (ctx) => A.checkoutCommit(ctx, "nope"), { expect: /toast error/ });
S("checkoutRemote-new", (d) => {
  remote(d);
  g(d.repo, "branch", "-D", "topic");
}, (ctx) => A.checkoutRemote(ctx, "origin/topic"));
S("checkoutRemote-existing", remote, (ctx) => A.checkoutRemote(ctx, "origin/topic"));
S("createBranch", branches, (ctx) => A.createBranch(ctx, "main~1"), { prompt: { name: " feature/x " } });
S("createBranch-exists", branches, (ctx) => A.createBranch(ctx, "main"), { prompt: { name: "side" }, expect: /already exists/ });
S("createWorktree-new", base, (ctx) => A.createWorktree(ctx, sha(ctx, "first")), { prompt: { name: "wt-b" } });
S("createWorktree-detached", base, (ctx) => A.createWorktree(ctx, sha(ctx, "first")), { prompt: { name: "" } });
S("createWorktree-branch", branches, (ctx) => A.createWorktree(ctx, sha(ctx, "first"), "side"));
S("createWorktree-error", base, (ctx) => A.createWorktree(ctx, sha(ctx, "first"), "main"), { expect: /toast error/ });
S("cherryPick", branches, (ctx) => A.cherryPick(ctx, by(ctx, "side work")));
S("cherryPick-merge", (d) => {
  merges(d);
  g(d.repo, "checkout", "-q", "-b", "target", "main~2");
}, (ctx) => A.cherryPick(ctx, by(ctx, "merge feat")));
S("cherryPick-conflict", conflict, (ctx) => A.cherryPick(ctx, by(ctx, "side change")), { expect: /toast error/ });
S("cherryPickMany", (d) => {
  linear(d);
  g(d.repo, "checkout", "-q", "-b", "target", "main~3");
}, (ctx) => A.cherryPickMany(ctx, [by(ctx, "fourth"), by(ctx, "third")]));
S("cherryPickMany-conflict", (d) => {
  linear(d);
  g(d.repo, "checkout", "-q", "-b", "target", "main~3");
}, (ctx) => A.cherryPickMany(ctx, [by(ctx, "fifth")]), { expect: /toast error/ });
S("revert", base, (ctx) => A.revert(ctx, by(ctx, "second")));
S("revert-merge", merges, (ctx) => A.revert(ctx, by(ctx, "merge feat")));
S("revert-conflict", (d) => {
  conflict(d);
  commit(d.repo, "a.txt", "main2\n", "main again");
}, (ctx) => A.revert(ctx, by(ctx, "main change")), { expect: /toast error/ });
S("reset-soft", base, (ctx) => A.reset(ctx, "soft", sha(ctx, "first")));
S("reset-mixed", base, (ctx) => A.reset(ctx, "mixed", sha(ctx, "first")));
S("reset-hard", dirty, (ctx) => A.reset(ctx, "hard", sha(ctx, "first")));
S("reset-hard-declined", dirty, (ctx) => A.reset(ctx, "hard", sha(ctx, "first")), { confirm: false });
S("reset-error", base, (ctx) => A.reset(ctx, "mixed", "nope"), { expect: /toast error/ });
S("createTag", base, (ctx) => A.createTag(ctx, sha(ctx, "first"), false), { prompt: { name: " v1 " } });
S("createTag-annotated", base, (ctx) => A.createTag(ctx, sha(ctx, "first"), true), { prompt: { name: "v1", message: "release one" } });
S("createTag-annotated-default", base, (ctx) => A.createTag(ctx, sha(ctx, "first"), true), { prompt: { name: "v1", message: "" } });
S("createTag-exists", (d) => {
  base(d);
  g(d.repo, "tag", "v1");
}, (ctx) => A.createTag(ctx, sha(ctx, "first"), false), { prompt: { name: "v1" }, expect: /already exists/ });
S("deleteBranch-merged", branches, (ctx) => A.deleteBranch(ctx, lref(ctx, "merged")));
S("deleteBranch-unmerged-yes", branches, (ctx) => A.deleteBranch(ctx, lref(ctx, "unmerged")), { expect: /Branch not merged/ });
S("deleteBranch-unmerged-no", branches, (ctx) => A.deleteBranch(ctx, lref(ctx, "unmerged")), { confirm: (title) => title !== "Branch not merged", expect: /Branch not merged/ });
S("deleteBranch-current", base, (ctx) => A.deleteBranch(ctx, lref(ctx, "main")), { expect: /toast error/ });
S("deleteBranch-remote", (d) => {
  remote(d);
  g(d.repo, "merge", "-q", "topic");
}, (ctx) => A.deleteBranch(ctx, lref(ctx, "topic"), true));
S("deleteBranch-remote-unmerged", (d) => {
  remote(d);
  g(d.repo, "checkout", "-q", "-b", "extra", "topic");
  commit(d.repo, "e.txt", "e\n", "extra work");
  g(d.repo, "branch", "--set-upstream-to=origin/topic", "extra");
  g(d.repo, "checkout", "-q", "main");
}, (ctx) => A.deleteBranch(ctx, lref(ctx, "extra"), true), { expect: /Branch not merged/ });
S("deleteRemoteBranch", remote, (ctx) => A.deleteRemoteBranch(ctx, "origin/topic"));
S("deleteRemoteBranch-error", remote, (ctx) => A.deleteRemoteBranch(ctx, "origin/nope"), { expect: /toast error/ });
S("renameBranch", branches, (ctx) => A.renameBranch(ctx, "side"), { prompt: { name: "renamed" } });
S("renameBranch-exists", branches, (ctx) => A.renameBranch(ctx, "side"), { prompt: { name: "merged" }, expect: /toast error/ });
S("merge-ff", branches, (ctx) => A.merge(ctx, "side"));
S("merge-conflict", conflict, (ctx) => A.merge(ctx, "side"), { expect: /toast error/ });
S("merge-error", base, (ctx) => A.merge(ctx, "nope"), { expect: /toast error/ });
S("mergeNoFf", branches, (ctx) => A.mergeNoFf(ctx, "side"));
S("rebaseOnto", (d) => {
  branches(d);
  commit(d.repo, "m.txt", "m\n", "main work");
  g(d.repo, "checkout", "-q", "side");
}, (ctx) => A.rebaseOnto(ctx, "main"));
S("rebaseOnto-autostash", (d) => {
  branches(d);
  commit(d.repo, "m.txt", "m\n", "main work");
  g(d.repo, "checkout", "-q", "side");
  write(d.repo, "a.txt", "dirty\n");
}, (ctx) => A.rebaseOnto(ctx, "main"));
S("rebaseOnto-conflict", (d) => {
  conflict(d);
  g(d.repo, "checkout", "-q", "side");
}, (ctx) => A.rebaseOnto(ctx, "main"), { expect: /toast error/ });
S("fastForward-current", behind, (ctx) => A.fastForward(ctx, lref(ctx, "main"), "origin/main"));
S("fastForward-other", (d) => {
  behind(d);
  g(d.repo, "checkout", "-q", "topic");
}, (ctx) => A.fastForward(ctx, lref(ctx, "main"), "origin/main"));
S("fastForward-error", (d) => diverged(d, true), (ctx) => A.fastForward(ctx, lref(ctx, "main"), "origin/main"), { expect: /toast error/ });
S("fastForward-other-error", (d) => {
  diverged(d, true);
  g(d.repo, "checkout", "-q", "topic");
}, (ctx) => A.fastForward(ctx, lref(ctx, "main"), "origin/main"), { expect: /toast error/ });
S("pull-ff", (d) => {
  behind(d);
  g(d.repo, "reset", "-q", "--hard", "origin/main~1");
}, (ctx) => A.pull(ctx, "ff"));
S("pull-ff-only-error", (d) => diverged(d, true), (ctx) => A.pull(ctx, "ff-only"), { expect: /toast error/ });
S("pull-rebase", (d) => {
  diverged(d, true);
  write(d.repo, "a.txt", "dirty\n");
}, (ctx) => A.pull(ctx, "rebase"));
S("pull-fetch", behind, (ctx) => A.pull(ctx, "fetch"));
S("pull-fetch-error", (d) => {
  remote(d);
  fs.rmSync(d.remote, { recursive: true, force: true });
}, (ctx) => A.pull(ctx, "fetch"), { expect: /toast error/ });
S("pullBranch-current", (d) => {
  behind(d);
  g(d.repo, "reset", "-q", "--hard", "origin/main~1");
}, (ctx) => A.pullBranch(ctx, lref(ctx, "main")));
S("pullBranch-other", (d) => {
  remote(d);
  remoteWork(d);
  g(d.repo, "checkout", "-q", "topic");
}, (ctx) => A.pullBranch(ctx, lref(ctx, "main")));
S("pullBranch-other-error", (d) => {
  diverged(d, true);
  g(d.repo, "checkout", "-q", "topic");
}, (ctx) => A.pullBranch(ctx, lref(ctx, "main")), { expect: /toast error/ });
S("pullBranch-no-upstream", branches, (ctx) => A.pullBranch(ctx, lref(ctx, "side")), { expect: /has no upstream/ });
S("push-upstream", (d) => {
  remote(d);
  commit(d.repo, "l.txt", "l\n", "local work");
}, (ctx) => A.push(ctx));
S("push-branch-remote", (d) => {
  remote(d);
  g(d.repo, "checkout", "-q", "-b", "fresh");
  commit(d.repo, "f.txt", "f\n", "fresh work");
}, (ctx) => A.push(ctx, "fresh", "origin"));
S("push-prompt", (d) => {
  remote(d);
  g(d.repo, "checkout", "-q", "-b", "fresh");
  commit(d.repo, "f.txt", "f\n", "fresh work");
}, (ctx) => A.push(ctx), { prompt: { remote: "origin", branch: "fresh-remote" } });
S("push-prompt-cancel", (d) => {
  remote(d);
  g(d.repo, "checkout", "-q", "-b", "fresh");
}, (ctx) => A.push(ctx), { prompt: null });
S("push-no-branch", (d) => {
  base(d);
  g(d.repo, "checkout", "-q", "--detach");
}, (ctx) => A.push(ctx), { expect: /Checkout a branch/ });
S("push-no-remotes", base, (ctx) => A.push(ctx), { expect: /no remotes/ });
S("push-rejected-stale-yes", (d) => diverged(d, false), (ctx) => A.push(ctx), { expect: /Push rejected/ });
S("push-rejected-fetched-yes", (d) => diverged(d, true), (ctx) => A.push(ctx), { expect: /Push rejected/ });
S("push-rejected-no", (d) => diverged(d, true), (ctx) => A.push(ctx), { confirm: false, expect: /Push rejected/ });
S("push-error", (d) => {
  remote(d);
  commit(d.repo, "l.txt", "l\n", "local work");
  fs.rmSync(d.remote, { recursive: true, force: true });
}, (ctx) => A.push(ctx), { expect: /toast error/ });
S("pushTo", (d) => {
  remote(d);
  commit(d.repo, "l.txt", "l\n", "local work");
}, (ctx) => A.pushTo(ctx, "main", "origin", "other-name"));
S("pushTag", (d) => {
  remote(d);
  g(d.repo, "tag", "v1");
}, (ctx) => A.pushTag(ctx, "v1", "origin"));
S("deleteTag-local", (d) => {
  base(d);
  g(d.repo, "tag", "v1");
}, (ctx) => A.deleteTag(ctx, "v1"));
S("deleteTag-remote", (d) => {
  remote(d);
  g(d.repo, "tag", "v1");
  g(d.repo, "push", "-q", "origin", "v1");
}, (ctx) => A.deleteTag(ctx, "v1", "origin"));
S("deleteTag-error", base, (ctx) => A.deleteTag(ctx, "nope"), { expect: /toast error/ });
S("setUpstream", (d) => {
  remote(d);
  g(d.repo, "branch", "other", "main");
}, (ctx) => A.setUpstream(ctx, lref(ctx, "other")), { prompt: { up: "origin/main" } });
S("addRemote", (d) => {
  base(d);
  g(d.root, "clone", "-q", "--bare", d.repo, d.remote);
}, (ctx) => A.addRemote(ctx), { prompt: (d) => ({ name: "origin", url: d.remote }) });
S("addRemote-error", base, (ctx) => A.addRemote(ctx), { prompt: { name: "origin", url: "/nowhere/else.git" }, expect: /toast error/ });
S("editRemote", remote, (ctx, d) => A.editRemote(ctx, "origin", d.remote), { prompt: { url: "/nowhere/else.git" } });
S("removeRemote", remote, (ctx) => A.removeRemote(ctx, "origin"));
S("removeRemote-error", base, (ctx) => A.removeRemote(ctx, "origin"), { expect: /toast error/ });
S("fetchRemote", behind, (ctx) => A.fetchRemote(ctx, "origin"));
S("stashSave", dirty, (ctx) => A.stashSave(ctx), { prompt: { message: "my stash" } });
S("stashSave-nomsg", dirty, (ctx) => A.stashSave(ctx), { prompt: { message: "" } });
S("stashSave-nothing", base, (ctx) => A.stashSave(ctx), { prompt: { message: "" }, expect: /task Stash/ });
S("stashApply", stashed, (ctx) => A.stashApply(ctx));
S("stashPop", stashed, (ctx) => A.stashPop(ctx));
S("stashDrop", stashed, (ctx) => A.stashDrop(ctx, "stash@{0}"));
S("stashApply-error", base, (ctx) => A.stashApply(ctx), { expect: /toast error/ });
S("removeWorktree", (d) => {
  base(d);
  g(d.repo, "worktree", "add", "-q", d.wt, "-b", "wtb");
}, (ctx, d) => A.removeWorktree(ctx, d.wt));
S("removeWorktree-error", base, (ctx, d) => A.removeWorktree(ctx, d.wt), { expect: /toast error/ });
S("lockWorktree", (d) => {
  base(d);
  g(d.repo, "worktree", "add", "-q", d.wt, "-b", "wtb");
}, (ctx, d) => A.lockWorktree(ctx, d.wt, true));
S("unlockWorktree", (d) => {
  base(d);
  g(d.repo, "worktree", "add", "-q", d.wt, "-b", "wtb");
  g(d.repo, "worktree", "lock", d.wt);
}, (ctx, d) => A.lockWorktree(ctx, d.wt, false));
S("pruneWorktrees", (d) => {
  base(d);
  g(d.repo, "worktree", "add", "-q", d.wt, "-b", "wtb");
  fs.rmSync(d.wt, { recursive: true, force: true });
}, (ctx) => A.pruneWorktrees(ctx));
S("savePatch", base, (ctx) => A.savePatch(ctx, sha(ctx, "second")));
S("startInteractiveRebase", linear, (ctx) => A.startInteractiveRebase(ctx, sha(ctx, "second")), { expect: /openRebase/ });
S("runTodo", linear, async (ctx) => {
  const entries: ActionsModule.TodoEntry[] = [
    { sha: sha(ctx, "third"), subject: "third", action: "reword", message: "third reworded\n" },
    { sha: sha(ctx, "fourth"), subject: "fourth", action: "drop" },
    { sha: sha(ctx, "fifth"), subject: "fifth", action: "squash" },
  ];
  await A.runTodo(ctx, sha(ctx, "second"), entries);
});
S("runTodo-root", linear, async (ctx) => {
  const entries: ActionsModule.TodoEntry[] = [
    { sha: sha(ctx, "first"), subject: "first", action: "reword" },
    { sha: sha(ctx, "second"), subject: "second", action: "fixup" },
    { sha: sha(ctx, "third"), subject: "third", action: "pick" },
    { sha: sha(ctx, "fourth"), subject: "fourth", action: "pick" },
    { sha: sha(ctx, "fifth"), subject: "fifth", action: "pick" },
  ];
  await A.runTodo(ctx, null, entries);
});
S("dropCommit", linear, (ctx) => A.dropCommit(ctx, sha(ctx, "fourth")));
S("dropCommit-declined", linear, (ctx) => A.dropCommit(ctx, sha(ctx, "fourth")), { confirm: false });
S("dropCommit-root", linear, (ctx) => A.dropCommit(ctx, sha(ctx, "first")), { expect: /record/ });
S("dropCommit-conflict", linear, (ctx) => A.dropCommit(ctx, sha(ctx, "third")), { expect: /toast error/ });
S("moveCommit-up", linear, (ctx) => A.moveCommit(ctx, sha(ctx, "fourth"), "up"));
S("moveCommit-down", linear, (ctx) => A.moveCommit(ctx, sha(ctx, "third"), "down"));
S("moveCommit-conflict", (d) => {
  base(d);
  commit(d.repo, "c.txt", "c\n", "third");
  commit(d.repo, "c.txt", "c2\n", "fifth");
}, (ctx) => A.moveCommit(ctx, sha(ctx, "fifth"), "down"), { expect: /toast error/ });
S("moveCommit-top", linear, (ctx) => A.moveCommit(ctx, sha(ctx, "fifth"), "down"));
S("moveCommit-last", linear, (ctx) => A.moveCommit(ctx, sha(ctx, "fifth"), "up"));
S("editMessage-head", linear, (ctx) => A.editMessage(ctx, sha(ctx, "fifth"), true), { prompt: { message: "fifth edited\n\nbody" } });
S("editMessage-old", linear, (ctx) => A.editMessage(ctx, sha(ctx, "third"), false), { prompt: { message: "third edited" } });
S("editMessage-same", linear, (ctx) => A.editMessage(ctx, sha(ctx, "fifth"), true), { prompt: { message: "fifth" } });
S("rewriteMany-drop", linear, (ctx) => A.rewriteMany(ctx, [sha(ctx, "fourth"), sha(ctx, "fifth")], "drop"));
S("rewriteMany-squash", linear, (ctx) => A.rewriteMany(ctx, [sha(ctx, "third"), sha(ctx, "fourth")], "squash"));
S("rewriteMany-squash-gap", linear, (ctx) => A.rewriteMany(ctx, [sha(ctx, "third"), sha(ctx, "fifth")], "squash"), { expect: /adjacent/ });
S("rewriteMany-outside", (d) => {
  linear(d);
  g(d.repo, "checkout", "-q", "-b", "other", "main~3");
  commit(d.repo, "o.txt", "o\n", "other work");
}, (ctx) => A.rewriteMany(ctx, [sha(ctx, "other work"), sha(ctx, "fourth")], "drop"), { expect: /history of the current branch/ });
S("rewriteMany-declined", linear, (ctx) => A.rewriteMany(ctx, [sha(ctx, "third"), sha(ctx, "fourth")], "squash"), { confirm: false });
S("rewriteMany-conflict", linear, (ctx) => A.rewriteMany(ctx, [sha(ctx, "third")], "drop"), { expect: /toast error/ });
S("stageFile", dirty, (ctx) => A.stageFile(ctx, "a.txt"));
S("stageAll", dirty, (ctx) => A.stageAll(ctx));
S("stageFile-error", base, (ctx) => A.stageFile(ctx, "missing.txt"), { expect: /toast error/ });
S("unstageFile", (d) => {
  dirty(d);
  g(d.repo, "add", "-A");
}, (ctx) => A.unstageFile(ctx, "a.txt"));
S("unstageAll", (d) => {
  dirty(d);
  g(d.repo, "add", "-A");
}, (ctx) => A.unstageAll(ctx));
S("unstageFile-unborn", (d) => {
  fs.mkdirSync(d.repo, { recursive: true });
  g(d.repo, "init", "-q", "-b", "main");
  write(d.repo, "a.txt", "a\n");
  write(d.repo, "b.txt", "b\n");
  g(d.repo, "add", "-A");
}, (ctx) => A.unstageFile(ctx, "a.txt"));
S("unstageAll-unborn", (d) => {
  fs.mkdirSync(d.repo, { recursive: true });
  g(d.repo, "init", "-q", "-b", "main");
  write(d.repo, "a.txt", "a\n");
  g(d.repo, "add", "-A");
}, (ctx) => A.unstageAll(ctx));
S("discardFile", dirty, (ctx) => A.discardFile(ctx, "a.txt", false));
S("discardFile-untracked", dirty, (ctx) => A.discardFile(ctx, "new.txt", true));
S("discardFile-declined", dirty, (ctx) => A.discardFile(ctx, "a.txt", false), { confirm: false });
S("discardFile-conflicted", merging, (ctx) => A.discardFile(ctx, "a.txt", false));
S("discardFile-error", base, (ctx) => A.discardFile(ctx, "missing.txt", false), { expect: /toast error/ });
S("discardAll", dirty, (ctx) => A.discardAll(ctx));
S("applyPatch-stage", dirty, (ctx) => A.applyPatch(ctx, g(ctx.cwd, "diff"), "stage"));
S("applyPatch-unstage", (d) => {
  dirty(d);
  g(d.repo, "add", "a.txt");
}, (ctx) => A.applyPatch(ctx, g(ctx.cwd, "diff", "--cached"), "unstage"));
S("applyPatch-discard", dirty, (ctx) => A.applyPatch(ctx, g(ctx.cwd, "diff"), "discard"));
S("applyPatch-discard-declined", dirty, (ctx) => A.applyPatch(ctx, g(ctx.cwd, "diff"), "discard"), { confirm: false });
S("applyPatch-revert", base, (ctx) => A.applyPatch(ctx, g(ctx.cwd, "diff", "HEAD~1", "HEAD"), "revert"));
S("applyPatch-error", base, (ctx) => A.applyPatch(ctx, "not a patch\n", "stage"), { expect: /toast error/ });
S("commit", (d) => {
  dirty(d);
  g(d.repo, "add", "-A");
}, (ctx) => A.commit(ctx, "third commit", false));
S("commit-amend", (d) => {
  dirty(d);
  g(d.repo, "add", "-A");
}, (ctx) => A.commit(ctx, "amended", true));
S("commit-nothing", base, (ctx) => A.commit(ctx, "nothing", false), { expect: /toast error/ });
S("commit-initial", (d) => {
  fs.mkdirSync(d.repo, { recursive: true });
  g(d.repo, "init", "-q", "-b", "main");
  write(d.repo, "a.txt", "a\n");
  g(d.repo, "add", "-A");
}, (ctx) => A.commit(ctx, "initial", false));
S("resolveFile-ours", merging, (ctx) => A.resolveFile(ctx, "a.txt", "ours"));
S("resolveFile-theirs", merging, (ctx) => A.resolveFile(ctx, "a.txt", "theirs"));
S("resolveFile-delete", merging, (ctx) => A.resolveFile(ctx, "a.txt", "delete"));
S("resolveFile-error", base, (ctx) => A.resolveFile(ctx, "missing.txt", "ours"), { expect: /toast error/ });
S("saveResolved", merging, (ctx) => A.saveResolved(ctx, "a.txt", "merged\n"));
S("continue-merge", merging, async (ctx) => {
  await A.resolveFile(ctx, "a.txt", "ours");
  await A.continueOperation(ctx, "merge");
});
S("continue-merge-unresolved", merging, (ctx) => A.continueOperation(ctx, "merge"), { expect: /toast error/ });
S("abort-merge", merging, (ctx) => A.abortOperation(ctx, "merge"));
S("continue-rebase", rebasing, async (ctx) => {
  await A.resolveFile(ctx, "a.txt", "theirs");
  await A.continueOperation(ctx, "rebase");
});
S("abort-rebase", rebasing, (ctx) => A.abortOperation(ctx, "rebase"));
S("continue-cherry-pick", picking, async (ctx) => {
  await A.resolveFile(ctx, "a.txt", "theirs");
  await A.continueOperation(ctx, "cherry-pick");
});
S("abort-cherry-pick", picking, (ctx) => A.abortOperation(ctx, "cherry-pick"));
S("abort-revert", (d) => {
  conflict(d);
  commit(d.repo, "a.txt", "main2\n", "main again");
  tryGit(d.repo, "revert", "--no-edit", "main~1");
}, (ctx) => A.abortOperation(ctx, "revert"));
S("continue-revert", (d) => {
  conflict(d);
  commit(d.repo, "a.txt", "main2\n", "main again");
  tryGit(d.repo, "revert", "--no-edit", "main~1");
}, async (ctx) => {
  await A.resolveFile(ctx, "a.txt", "ours");
  await A.continueOperation(ctx, "revert");
});
S("abort-none", base, (ctx) => A.abortOperation(ctx, "merge"), { expect: /toast error/ });
S("undo-commit", (d) => {
  dirty(d);
  g(d.repo, "add", "-A");
}, async (ctx, _d, h) => {
  await A.commit(ctx, "third commit", false);
  await A.undo(ctx, h.recorded[0]);
  await A.redo(ctx, h.recorded[0]);
  await A.undo(ctx, h.recorded[0]);
});
S("undo-reset", base, async (ctx, _d, h) => {
  await A.reset(ctx, "hard", sha(ctx, "first"));
  await A.undo(ctx, h.recorded[0]);
  await A.redo(ctx, h.recorded[0]);
});
S("undo-checkout", branches, async (ctx, _d, h) => {
  await A.checkoutRef(ctx, "side");
  await A.undo(ctx, h.recorded[0]);
  await A.redo(ctx, h.recorded[0]);
});
S("undo-detach", branches, async (ctx, _d, h) => {
  await A.checkoutCommit(ctx, sha(ctx, "first"));
  await A.undo(ctx, h.recorded[0]);
  await A.redo(ctx, h.recorded[0]);
});
S("undo-changed", base, async (ctx, d, h) => {
  await A.reset(ctx, "hard", sha(ctx, "first"));
  commit(d.repo, "x.txt", "x\n", "elsewhere");
  await A.undo(ctx, h.recorded[0]);
}, { expect: /cannot undo/ });
S("undo-dirty", base, async (ctx, d, h) => {
  await A.reset(ctx, "hard", sha(ctx, "first"));
  write(d.repo, "b.txt", "untracked\n");
  await A.undo(ctx, h.recorded[0]);
}, { expect: /toast error/ });
S("rangeInfo-head", linear, async (ctx) => [
  await A.rangeInfo(ctx.cwd, sha(ctx, "fifth")),
  await A.rangeInfo(ctx.cwd, sha(ctx, "third")),
  await A.rangeInfo(ctx.cwd, sha(ctx, "first")),
]);
S("rangeInfo-merges", merges, async (ctx) => [
  await A.rangeInfo(ctx.cwd, sha(ctx, "feature work")),
  await A.rangeInfo(ctx.cwd, sha(ctx, "second")),
  await A.rangeInfo(ctx.cwd, sha(ctx, "merge feat")),
]);
S("rangeInfo-other", (d) => {
  linear(d);
  g(d.repo, "checkout", "-q", "-b", "other", "main~3");
  commit(d.repo, "o.txt", "o\n", "other work");
}, async (ctx) => [
  await A.rangeInfo(ctx.cwd, sha(ctx, "fifth")),
  await A.rangeInfo(ctx.cwd, sha(ctx, "other work")),
  await A.rangeInfo(ctx.cwd, "nope"),
]);
S("rangeInfo-descendant", (d) => {
  linear(d);
  g(d.repo, "checkout", "-q", "--detach", "main~2");
}, async (ctx) => [await A.rangeInfo(ctx.cwd, sha(ctx, "fifth"))]);
S("rangeInfo-unborn", (d) => {
  fs.mkdirSync(d.repo, { recursive: true });
  g(d.repo, "init", "-q", "-b", "main");
}, async (ctx) => [await A.rangeInfo(ctx.cwd, "0".repeat(40))]);

function makeUi(s: Scenario, d: Dirs, h: Harness): Ctx["ui"] {
  const ui: Ctx["ui"] = {
    busy: null,
    prompt: async (title, fields) => {
      h.log.push(`prompt ${title} ${JSON.stringify(fields)}`);
      if (s.prompt === undefined) {
        return null;
      }
      return typeof s.prompt === "function" ? s.prompt(d) : s.prompt;
    },
    confirm: async (title, message, ok, danger) => {
      h.log.push(`confirm ${title} | ${message} | ${ok} | ${danger}`);
      return typeof s.confirm === "function" ? s.confirm(title) : (s.confirm ?? true);
    },
    toast: (text, kind) => {
      h.log.push(`toast ${kind ?? "info"} ${text}`);
    },
    task: async (label, fn) => {
      h.log.push(`task ${label}`);
      try {
        await fn();
        return true;
      } catch (error) {
        ui.toast(error instanceof Error ? error.message : String(error), "error");
        return false;
      }
    },
  };
  return ui;
}

async function runAction(cwd: string, name: string, args: unknown): Promise<unknown> {
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(example, [cwd, name, JSON.stringify(args)], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, env: process.env }, (error, text) => {
      if (error) {
        reject(error);
      } else {
        resolve(text);
      }
    });
  });
  const result = JSON.parse(stdout) as { ok?: unknown; err?: string };
  if (result.err !== undefined) {
    throw result.err;
  }
  return result.ok;
}

function snapshot(d: Dirs): Record<string, string> {
  const gitDir = path.join(d.repo, ".git");
  const marks = ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"].filter((n) => fs.existsSync(path.join(gitDir, n)));
  const state: Record<string, string> = {
    refs: out(d.repo, "for-each-ref", "--format=%(refname) %(objectname) %(upstream) %(contents:subject)"),
    log: out(d.repo, "log", "--all", "--format=%H %P %an %ae %ad %cd %B"),
    status: out(d.repo, "status", "--porcelain=v1", "-z"),
    stash: out(d.repo, "stash", "list", "--format=%H %gs"),
    worktrees: out(d.repo, "worktree", "list", "--porcelain"),
    head: out(d.repo, "rev-parse", "-q", "--verify", "HEAD"),
    branch: out(d.repo, "symbolic-ref", "-q", "HEAD"),
    diff: out(d.repo, "diff"),
    cached: out(d.repo, "diff", "--cached"),
    config: out(d.repo, "config", "--get-regexp", "^(branch|remote)\\."),
    marks: marks.join(","),
  };
  if (fs.existsSync(d.remote)) {
    state.remoteRefs = out(d.remote, "for-each-ref", "--format=%(refname) %(objectname)");
  }
  return state;
}

async function execute(s: Scenario, tag: string, native: boolean): Promise<unknown> {
  const tagged = path.join(runRoot, tag);
  const root = path.join(tagged, s.name);
  const d: Dirs = { root, repo: path.join(root, "repo"), remote: path.join(root, "remote.git"), other: path.join(root, "other"), wt: path.join(root, "wt") };
  fs.mkdirSync(root, { recursive: true });
  s.setup(d);
  const h: Harness = { log: [], recorded: [] };
  const api = {
    platform: "darwin",
    git: runGit,
    writeTemp: async (content: string) => {
      const dir = fs.mkdtempSync(path.join(runRoot, "tmp-"));
      fs.writeFileSync(path.join(dir, "data"), content);
      return path.join(dir, "data");
    },
    pickDirectory: async () => d.wt,
    saveFile: async (name: string, content: string) => {
      h.log.push(`saveFile ${name} ${content}`);
      return true;
    },
    writeFile: async (cwd: string, rel: string, content: string) => {
      fs.writeFileSync(path.join(cwd, rel), content);
      return true;
    },
    ...(native ? { action: runAction } : {}),
  };
  (globalThis as { window?: unknown }).window = { gitneat: api };
  const data = await loadRepo(d.repo, [], [], 1000);
  const ctx: Ctx = {
    cwd: d.repo,
    data,
    ui: makeUi(s, d, h),
    refresh: () => {
      h.log.push("refresh");
    },
    openTab: (p) => {
      h.log.push(`openTab ${p}`);
    },
    openRebase: (b, e) => {
      h.log.push(`openRebase ${JSON.stringify([b, e])}`);
    },
    toggleHidden: () => undefined,
    toggleSolo: () => undefined,
    hidden: [],
    solo: [],
    record: (entry) => {
      h.recorded.push(entry);
      h.log.push(`record ${JSON.stringify(entry)}`);
    },
  };
  let ret: unknown;
  try {
    ret = await s.run(ctx, d, h);
  } catch (error) {
    ret = { thrown: error instanceof Error ? error.message : String(error) };
  }
  return JSON.parse(JSON.stringify({ ret: ret ?? null, log: h.log, state: snapshot(d) }).split(tagged).join("<R>"));
}

before(
  async () => {
    if (!enabled) {
      return;
    }
    runRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gitneat-actions-")));
    const config = path.join(runRoot, "gitconfig");
    fs.writeFileSync(config, "[user]\n\tname = t\n\temail = t@x\n[commit]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n[advice]\n\tdetachedHead = false\n");
    Object.assign(process.env, {
      GIT_CONFIG_GLOBAL: config,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z",
      GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z",
    });
    execFileSync("cargo", ["build", "-q", "-p", "gitneat", "--example", "action"], { cwd: rustDir, stdio: "inherit" });
    example = path.join(rustDir, "target", "debug", "examples", process.platform === "win32" ? "action.exe" : "action");
    (globalThis as { window?: unknown }).window = { gitneat: { platform: "darwin", git: runGit } };
    A = await import("../src/actions");
    ({ loadRepo } = await import("../src/repo"));
  },
  { timeout: 600000 },
);

after(() => {
  if (runRoot) {
    fs.rmSync(runRoot, { recursive: true, force: true });
  }
});

for (const s of scenarios) {
  test(`actions: rust equals ts on ${s.name}`, { skip: !enabled, timeout: 120000 }, async () => {
    const expected = await execute(s, "ts", false);
    const actual = await execute(s, "rs", true);
    if (s.expect) {
      assert.match(JSON.stringify(expected), s.expect, `${s.name} did not reach its path`);
    }
    assert.deepStrictEqual(actual, expected, s.name);
  });
}
