import { gitneat } from "./api";
import { Commit, git, GitError, Operation, Ref, RepoData } from "./repo";
import { Field, Ui } from "./ui";

export type TodoAction = "pick" | "reword" | "squash" | "fixup" | "drop";

export interface TodoEntry {
  sha: string;
  subject: string;
  action: TodoAction;
  message?: string;
}

export interface Ctx {
  cwd: string;
  data: RepoData;
  ui: Ui;
  refresh(): void;
  openTab(path: string): void;
  openRebase(base: string | null, entries: TodoEntry[]): void;
  toggleHidden(full: string): void;
  toggleSolo(full: string): void;
  hidden: string[];
  solo: string[];
  record(entry: UndoEntry): void;
}

export interface HeadState {
  head: string | null;
  branch: string | null;
}

export interface UndoEntry {
  label: string;
  before: HeadState;
  after: HeadState;
}

export interface RangeInfo {
  ancestor: boolean;
  isHead: boolean;
  children: number;
  hasMerges: boolean;
  descendant: boolean;
}

const short = (sha: string) => sha.slice(0, 7);

interface Plan {
  base: string | null;
  entries: TodoEntry[];
}

interface Done {
  record: { before: HeadState; after: HeadState } | null;
  toast?: string;
}

async function act<T = Done>(cwd: string, name: string, args: unknown): Promise<T> {
  try {
    return (await gitneat().action?.(cwd, name, args)) as T;
  } catch (error) {
    throw new GitError(error instanceof Error ? error.message : String(error));
  }
}

async function runNative(ctx: Ctx, label: string, fn: () => Promise<Done>): Promise<boolean> {
  const box: { done?: Done } = {};
  const ok = await ctx.ui.task(label, async () => {
    box.done = await fn();
  });
  if (ok && box.done?.record) {
    ctx.record({ label, ...box.done.record });
  }
  ctx.refresh();
  return ok;
}

const go = (ctx: Ctx, label: string, name: string, args: unknown) => runNative(ctx, label, () => act(ctx.cwd, name, args));

const via = (ctx: Ctx, label: string, name: string, args: unknown, fallback: () => Promise<unknown>, undoable = true) =>
  gitneat().action ? go(ctx, label, name, args) : run(ctx, label, fallback, undoable);

const needsConfirm = (error: unknown, kind: string) => error instanceof Error && error.message.startsWith(`needs-confirm:${kind}:`);

async function forceable(ctx: Ctx, name: string, args: object, kind: string, ask: () => Promise<boolean>): Promise<Done> {
  try {
    return await act(ctx.cwd, name, { ...args, force: false });
  } catch (error) {
    if (!needsConfirm(error, kind)) {
      throw error;
    }
    return (await ask()) ? act(ctx.cwd, name, { ...args, force: true }) : { record: null };
  }
}

const confirmForceDelete = (ctx: Ctx, name: string) =>
  ctx.ui.confirm("Branch not merged", `${name} is not fully merged. Delete anyway?`, "Force delete", true);

const confirmForcePush = (ctx: Ctx) =>
  ctx.ui.confirm("Push rejected", "The remote has commits that your branch does not have. Force push with lease?", "Force push", true);

async function headState(cwd: string): Promise<HeadState> {
  const [head, branch] = await Promise.all([
    gitneat().git(cwd, ["rev-parse", "-q", "--verify", "HEAD"]),
    gitneat().git(cwd, ["symbolic-ref", "-q", "--short", "HEAD"]),
  ]);
  return { head: head.stdout.trim() || null, branch: branch.stdout.trim() || null };
}

async function run(ctx: Ctx, label: string, fn: () => Promise<unknown>, undoable = true): Promise<boolean> {
  const before = await headState(ctx.cwd);
  const ok = await ctx.ui.task(label, fn);
  const after = await headState(ctx.cwd);
  if (undoable && ok && before.head && (before.head !== after.head || before.branch !== after.branch)) {
    ctx.record({ label, before, after });
  }
  ctx.refresh();
  return ok;
}

async function moveTo(ctx: Ctx, from: HeadState, to: HeadState, soft: boolean): Promise<void> {
  const now = await headState(ctx.cwd);
  if (now.head !== from.head || now.branch !== from.branch) {
    throw new GitError("The repository changed since this action. GitNeat cannot undo it.");
  }
  if (from.branch !== to.branch) {
    await g(ctx, to.branch ? ["switch", to.branch] : ["switch", "--detach", to.head as string]);
    return;
  }
  await g(ctx, ["reset", soft ? "--soft" : "--keep", to.head as string]);
}

export async function undo(ctx: Ctx, entry: UndoEntry): Promise<boolean> {
  if (gitneat().action) {
    const ok = await ctx.ui.task(`Undo ${entry.label}`, () => act(ctx.cwd, "undo", { entry }));
    ctx.refresh();
    return ok;
  }
  const ok = await ctx.ui.task(`Undo ${entry.label}`, () => moveTo(ctx, entry.after, entry.before, entry.label === "Commit"));
  ctx.refresh();
  return ok;
}

export async function redo(ctx: Ctx, entry: UndoEntry): Promise<boolean> {
  if (gitneat().action) {
    const ok = await ctx.ui.task(`Redo ${entry.label}`, () => act(ctx.cwd, "redo", { entry }));
    ctx.refresh();
    return ok;
  }
  const ok = await ctx.ui.task(`Redo ${entry.label}`, () => moveTo(ctx, entry.before, entry.after, entry.label === "Commit"));
  ctx.refresh();
  return ok;
}

const g = (ctx: Ctx, args: string[], env?: Record<string, string>) => git(ctx.cwd, args, env);

export async function rangeInfo(cwd: string, sha: string): Promise<RangeInfo> {
  if (gitneat().action) {
    return act<RangeInfo>(cwd, "rangeInfo", { sha });
  }
  const anc = await gitneat().git(cwd, ["merge-base", "--is-ancestor", sha, "HEAD"]);
  const head = (await gitneat().git(cwd, ["rev-parse", "-q", "--verify", "HEAD"])).stdout.trim();
  if (anc.code !== 0) {
    const desc = head ? await gitneat().git(cwd, ["merge-base", "--is-ancestor", "HEAD", sha]) : { code: 1 };
    return { ancestor: false, isHead: false, children: 0, hasMerges: false, descendant: desc.code === 0 };
  }
  const [count, merges] = await Promise.all([
    git(cwd, ["rev-list", "--count", `${sha}..HEAD`]),
    git(cwd, ["rev-list", "--count", "--merges", `${sha}~1..HEAD`]).catch(() => git(cwd, ["rev-list", "--count", "--merges", "HEAD"])),
  ]);
  return { ancestor: true, isHead: head === sha, children: Number(count), hasMerges: Number(merges) > 0, descendant: head === sha };
}

export const checkoutRef = (ctx: Ctx, name: string) => via(ctx, `Checkout ${name}`, "checkoutRef", { name }, () => g(ctx, ["switch", name]));

export const checkoutCommit = (ctx: Ctx, sha: string) =>
  via(ctx, `Checkout ${short(sha)}`, "checkoutCommit", { sha }, () => g(ctx, ["switch", "--detach", sha]));

export async function checkoutRemote(ctx: Ctx, remoteBranch: string): Promise<void> {
  const local = remoteBranch.split("/").slice(1).join("/");
  const existing = ctx.data.refs.find((r) => r.kind === "local" && r.name === local);
  if (existing) {
    await checkoutRef(ctx, local);
    return;
  }
  await via(ctx, `Checkout ${remoteBranch}`, "checkoutRemote", { remoteBranch, localExists: false }, () =>
    g(ctx, ["switch", "-c", local, "--track", remoteBranch]),
  );
}

export async function createBranch(ctx: Ctx, from: string): Promise<void> {
  const v = await ctx.ui.prompt("Create branch", [{ name: "name", label: "Branch name", ref: true, placeholder: "feature/my-branch" }], "Create branch");
  if (v?.name.trim()) {
    await via(ctx, "Create branch", "createBranch", { name: v.name, from }, () => g(ctx, ["switch", "-c", v.name.trim(), from]));
  }
}

export async function createWorktree(ctx: Ctx, from: string, branch?: string): Promise<void> {
  const dir = await gitneat().pickDirectory();
  if (!dir) {
    return;
  }
  const fields = branch ? [] : [{ name: "name", label: "New branch name (empty for detached HEAD)", ref: true }];
  const v = fields.length ? await ctx.ui.prompt("Create worktree", fields, "Create worktree") : {};
  if (!v) {
    return;
  }
  const args = ["worktree", "add"];
  if (v.name?.trim()) {
    args.push("-b", v.name.trim());
  }
  args.push(dir, branch ?? from);
  if (await via(ctx, "Create worktree", "createWorktree", { dir, name: v.name, branch, from }, () => g(ctx, args))) {
    ctx.openTab(dir);
  }
}

export function cherryPick(ctx: Ctx, commit: Commit) {
  const args = commit.parents.length > 1 ? ["cherry-pick", "-m", "1", commit.sha] : ["cherry-pick", commit.sha];
  return via(ctx, "Cherry pick", "cherryPick", { sha: commit.sha, parents: commit.parents.length }, () => g(ctx, args));
}

export function revert(ctx: Ctx, commit: Commit) {
  const args = ["revert", "--no-edit", ...(commit.parents.length > 1 ? ["-m", "1"] : []), commit.sha];
  return via(ctx, "Revert", "revert", { sha: commit.sha, parents: commit.parents.length }, () => g(ctx, args));
}

export async function reset(ctx: Ctx, mode: "soft" | "mixed" | "hard", sha: string): Promise<void> {
  if (mode === "hard") {
    const ok = await ctx.ui.confirm("Hard reset", `Reset ${ctx.data.branch ?? "HEAD"} to ${short(sha)} and discard all changes?`, "Reset", true);
    if (!ok) {
      return;
    }
  }
  await via(ctx, "Reset", "reset", { mode, sha }, () => g(ctx, ["reset", `--${mode}`, sha]));
}

export async function createTag(ctx: Ctx, sha: string, annotated: boolean): Promise<void> {
  const fields: Field[] = [{ name: "name", label: "Tag name", ref: true }];
  if (annotated) {
    fields.push({ name: "message", label: "Message", kind: "textarea" } as never);
  }
  const v = await ctx.ui.prompt(annotated ? "Create annotated tag" : "Create tag", fields, "Create tag");
  if (!v?.name.trim()) {
    return;
  }
  const args = annotated ? ["tag", "-a", v.name.trim(), "-m", v.message || v.name.trim(), sha] : ["tag", v.name.trim(), sha];
  await via(ctx, "Create tag", "createTag", { sha, annotated, name: v.name, message: v.message }, () => g(ctx, args));
}

export async function deleteBranch(ctx: Ctx, ref: Ref, alsoRemote = false): Promise<void> {
  const ok = await ctx.ui.confirm("Delete branch", `Delete ${ref.name}${alsoRemote && ref.upstream ? ` and ${ref.upstream}` : ""}?`, "Delete", true);
  if (!ok) {
    return;
  }
  if (gitneat().action) {
    await runNative(ctx, "Delete branch", () =>
      forceable(ctx, "deleteBranch", { name: ref.name, upstream: ref.upstream, alsoRemote }, "force-delete", () => confirmForceDelete(ctx, ref.name)),
    );
    return;
  }
  await run(ctx, "Delete branch", async () => {
    try {
      await g(ctx, ["branch", "-d", ref.name]);
    } catch (error) {
      if (!(error instanceof GitError) || !/not fully merged/.test(error.message)) {
        throw error;
      }
      const force = await confirmForceDelete(ctx, ref.name);
      if (!force) {
        return;
      }
      await g(ctx, ["branch", "-D", ref.name]);
    }
    if (alsoRemote && ref.upstream) {
      const [remote, ...rest] = ref.upstream.split("/");
      await g(ctx, ["push", remote, "--delete", rest.join("/")]);
    }
  });
}

export async function deleteRemoteBranch(ctx: Ctx, remoteBranch: string): Promise<void> {
  const ok = await ctx.ui.confirm("Delete remote branch", `Delete ${remoteBranch} on the remote?`, "Delete", true);
  if (ok) {
    const [remote, ...rest] = remoteBranch.split("/");
    await via(ctx, "Delete remote branch", "deleteRemoteBranch", { remoteBranch }, () => g(ctx, ["push", remote, "--delete", rest.join("/")]));
  }
}

export async function renameBranch(ctx: Ctx, name: string): Promise<void> {
  const v = await ctx.ui.prompt(`Rename ${name}`, [{ name: "name", label: "New name", ref: true, value: name }], "Rename");
  if (v?.name.trim() && v.name.trim() !== name) {
    await via(ctx, "Rename branch", "renameBranch", { name, newName: v.name }, () => g(ctx, ["branch", "-m", name, v.name.trim()]), false);
  }
}

export const merge = (ctx: Ctx, name: string) =>
  via(ctx, `Merge ${name}`, "merge", { name, noFf: false }, () => g(ctx, ["merge", "--no-edit", name]));

export const rebaseOnto = (ctx: Ctx, name: string) =>
  via(ctx, `Rebase onto ${name}`, "rebaseOnto", { name }, () => g(ctx, ["rebase", "--autostash", name], { GIT_EDITOR: ":" }));

export function fastForward(ctx: Ctx, local: Ref, target: string) {
  if (gitneat().action) {
    return go(ctx, "Fast-forward", "fastForward", { name: local.name, current: !!local.current, target });
  }
  if (local.current) {
    return run(ctx, "Fast-forward", () => g(ctx, ["merge", "--ff-only", target]));
  }
  return run(ctx, "Fast-forward", () => g(ctx, ["fetch", ".", `${target}:refs/heads/${local.name}`]));
}

export function pullBranch(ctx: Ctx, ref: Ref) {
  if (ref.current) {
    return pull(ctx, "ff");
  }
  if (!ref.upstream) {
    ctx.ui.toast(`${ref.name} has no upstream.`, "error");
    return Promise.resolve();
  }
  const [remote, ...rest] = ref.upstream.split("/");
  return via(ctx, `Pull ${ref.name}`, "pullBranch", { name: ref.name, current: false, upstream: ref.upstream }, () =>
    g(ctx, ["fetch", remote, `${rest.join("/")}:refs/heads/${ref.name}`]),
  );
}

export const mergeNoFf = (ctx: Ctx, name: string) =>
  via(ctx, `Merge ${name}`, "merge", { name, noFf: true }, () => g(ctx, ["merge", "--no-ff", "--no-edit", name]));

export type PullMode = "ff" | "ff-only" | "rebase" | "fetch";

export function pull(ctx: Ctx, mode: PullMode = "ff") {
  if (mode === "fetch") {
    return via(ctx, "Fetch", "pull", { mode }, () => g(ctx, ["fetch", "--all", "--prune"]));
  }
  const args = mode === "rebase" ? ["pull", "--rebase", "--autostash"] : ["pull", `--${mode}`];
  return via(ctx, "Pull", "pull", { mode }, () => g(ctx, args));
}

export async function push(ctx: Ctx, branch?: string, remote?: string): Promise<void> {
  const name = branch ?? ctx.data.branch;
  if (!name) {
    ctx.ui.toast("Checkout a branch to push.", "error");
    return;
  }
  const ref = ctx.data.refs.find((r) => r.kind === "local" && r.name === name);
  let args: string[];
  let answer: { remote: string; branch: string } | undefined;
  if (remote) {
    args = ["push", remote, name];
  } else if (ref?.upstream) {
    const [up, ...rest] = ref.upstream.split("/");
    args = ["push", up, `${name}:${rest.join("/")}`];
  } else {
    const remotes = ctx.data.remotes.map((r) => r.name);
    if (remotes.length === 0) {
      ctx.ui.toast("This repository has no remotes.", "error");
      return;
    }
    const v = await ctx.ui.prompt(
      `Push ${name}`,
      [
        { name: "remote", label: "Remote", kind: "select", options: remotes.includes("origin") ? ["origin", ...remotes.filter((r) => r !== "origin")] : remotes },
        { name: "branch", label: "Remote branch", ref: true, value: name },
      ],
      "Push",
    );
    if (!v) {
      return;
    }
    args = ["push", "-u", v.remote, `${name}:${v.branch}`];
    answer = { remote: v.remote, branch: v.branch };
  }
  if (gitneat().action) {
    await runNative(ctx, "Push", () => forceable(ctx, "push", { name, remote, upstream: ref?.upstream, answer }, "force-push", () => confirmForcePush(ctx)));
    return;
  }
  await run(ctx, "Push", async () => {
    try {
      await g(ctx, args);
    } catch (error) {
      if (!(error instanceof GitError) || !/rejected|non-fast-forward|fetch first/.test(error.message)) {
        throw error;
      }
      const force = await confirmForcePush(ctx);
      if (force) {
        await g(ctx, [...args.slice(0, 1), "--force-with-lease", ...args.slice(1)]);
      }
    }
  });
}

export const pushTo = (ctx: Ctx, local: string, remote: string, branch: string) =>
  via(ctx, "Push", "pushTo", { local, remote, branch }, () => g(ctx, ["push", remote, `${local}:${branch}`]));

export async function setUpstream(ctx: Ctx, ref: Ref): Promise<void> {
  const options = ctx.data.refs.filter((r) => r.kind === "remote").map((r) => r.name);
  if (options.length === 0) {
    ctx.ui.toast("No remote branches.", "error");
    return;
  }
  const preferred = options.find((o) => o.endsWith(`/${ref.name}`));
  const v = await ctx.ui.prompt(
    `Set upstream for ${ref.name}`,
    [{ name: "up", label: "Upstream", kind: "select", options: preferred ? [preferred, ...options.filter((o) => o !== preferred)] : options }],
    "Set upstream",
  );
  if (v) {
    await via(ctx, "Set upstream", "setUpstream", { up: v.up, name: ref.name }, () => g(ctx, ["branch", `--set-upstream-to=${v.up}`, ref.name]));
  }
}

export async function stashSave(ctx: Ctx): Promise<void> {
  const v = await ctx.ui.prompt("Stash changes", [{ name: "message", label: "Message (optional)" }], "Stash");
  if (v) {
    await via(ctx, "Stash", "stashSave", { message: v.message }, () =>
      g(ctx, ["stash", "push", "--include-untracked", ...(v.message ? ["-m", v.message] : [])]),
    );
  }
}

export const stashApply = (ctx: Ctx, ref = "stash@{0}") => via(ctx, "Apply stash", "stashApply", { ref }, () => g(ctx, ["stash", "apply", ref]));
export const stashPop = (ctx: Ctx, ref = "stash@{0}") => via(ctx, "Pop stash", "stashPop", { ref }, () => g(ctx, ["stash", "pop", ref]));

export async function stashDrop(ctx: Ctx, ref: string): Promise<void> {
  if (await ctx.ui.confirm("Delete stash", `Delete ${ref}?`, "Delete", true)) {
    await via(ctx, "Delete stash", "stashDrop", { ref }, () => g(ctx, ["stash", "drop", ref]));
  }
}

export const pushTag = (ctx: Ctx, tag: string, remote: string) =>
  via(ctx, "Push tag", "pushTag", { tag, remote }, () => g(ctx, ["push", remote, `refs/tags/${tag}`]));

export async function deleteTag(ctx: Ctx, tag: string, remote?: string): Promise<void> {
  if (!(await ctx.ui.confirm("Delete tag", `Delete ${tag}${remote ? ` from ${remote}` : " locally"}?`, "Delete", true))) {
    return;
  }
  await via(ctx, "Delete tag", "deleteTag", { tag, remote }, () =>
    g(ctx, remote ? ["push", remote, "--delete", `refs/tags/${tag}`] : ["tag", "-d", tag]),
  );
}

export async function addRemote(ctx: Ctx): Promise<void> {
  const v = await ctx.ui.prompt("Add remote", [
    { name: "name", label: "Name", value: ctx.data.remotes.length ? "" : "origin", ref: true },
    { name: "url", label: "URL" },
  ], "Add remote");
  if (v?.name && v.url) {
    await via(ctx, "Add remote", "addRemote", { name: v.name, url: v.url }, async () => {
      await g(ctx, ["remote", "add", v.name, v.url]);
      await g(ctx, ["fetch", v.name]);
    });
  }
}

export async function editRemote(ctx: Ctx, name: string, url: string): Promise<void> {
  const v = await ctx.ui.prompt(`Edit ${name}`, [{ name: "url", label: "URL", value: url }], "Save");
  if (v?.url && v.url !== url) {
    await via(ctx, "Edit remote", "editRemote", { name, url: v.url }, () => g(ctx, ["remote", "set-url", name, v.url]));
  }
}

export async function removeRemote(ctx: Ctx, name: string): Promise<void> {
  if (await ctx.ui.confirm("Remove remote", `Remove ${name}?`, "Remove", true)) {
    await via(ctx, "Remove remote", "removeRemote", { name }, () => g(ctx, ["remote", "remove", name]));
  }
}

export const fetchRemote = (ctx: Ctx, name: string) =>
  via(ctx, `Fetch ${name}`, "fetchRemote", { name }, () => g(ctx, ["fetch", "--prune", name]));

export async function removeWorktree(ctx: Ctx, path: string): Promise<void> {
  if (await ctx.ui.confirm("Delete worktree", `Delete the worktree at ${path}?`, "Delete", true)) {
    await via(ctx, "Delete worktree", "removeWorktree", { path }, () => g(ctx, ["worktree", "remove", path]));
  }
}

export const lockWorktree = (ctx: Ctx, path: string, lock: boolean) =>
  via(ctx, lock ? "Lock worktree" : "Unlock worktree", "lockWorktree", { path, lock }, () => g(ctx, ["worktree", lock ? "lock" : "unlock", path]));

export const pruneWorktrees = (ctx: Ctx) => via(ctx, "Prune worktrees", "pruneWorktrees", {}, () => g(ctx, ["worktree", "prune"]));

export async function savePatch(ctx: Ctx, sha: string): Promise<void> {
  await ctx.ui.task("Create patch", async () => {
    const patch = gitneat().action ? await act<string>(ctx.cwd, "formatPatch", { sha }) : await g(ctx, ["format-patch", "-1", "--stdout", sha]);
    await gitneat().saveFile(`${short(sha)}.patch`, patch);
  });
}

async function rebaseRange(ctx: Ctx, base: string | null): Promise<TodoEntry[]> {
  if (gitneat().action) {
    return act<TodoEntry[]>(ctx.cwd, "rebaseRange", { base });
  }
  const out = await g(ctx, ["log", "--reverse", "--format=%H%x1f%s", base ? `${base}..HEAD` : "HEAD"]);
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, subject] = line.split("\x1f");
      return { sha, subject, action: "pick" as TodoAction };
    });
}

async function parentOf(ctx: Ctx, sha: string): Promise<string | null> {
  const r = await gitneat().git(ctx.cwd, ["rev-parse", "-q", "--verify", `${sha}~1`]);
  return r.code === 0 ? r.stdout.trim() : null;
}

export async function runTodo(ctx: Ctx, base: string | null, entries: TodoEntry[]): Promise<void> {
  await via(ctx, "Rebase", "runTodo", { base, entries }, async () => {
    const lines: string[] = [];
    for (const entry of entries) {
      if (entry.action === "reword" && entry.message !== undefined) {
        lines.push(`pick ${entry.sha}`);
        const file = await gitneat().writeTemp(entry.message);
        lines.push(`exec git commit --amend --only --allow-empty -F "${file}"`);
      } else {
        lines.push(`${entry.action === "reword" ? "pick" : entry.action} ${entry.sha}`);
      }
    }
    const todo = await gitneat().writeTemp(lines.join("\n") + "\n");
    await g(ctx, ["rebase", "-i", "--autostash", ...(base ? [base] : ["--root"])], {
      GIT_SEQUENCE_EDITOR: `cp "${todo}"`,
      GIT_EDITOR: ":",
    });
  });
}

export async function dropCommit(ctx: Ctx, sha: string): Promise<void> {
  if (!(await ctx.ui.confirm("Drop commit", `Remove commit ${short(sha)} from the history of ${ctx.data.branch ?? "HEAD"}?`, "Drop", true))) {
    return;
  }
  if (gitneat().action) {
    const plan = await act<Plan>(ctx.cwd, "dropPlan", { sha });
    await runTodo(ctx, plan.base, plan.entries);
    return;
  }
  const base = await parentOf(ctx, sha);
  const entries = await rebaseRange(ctx, base);
  await runTodo(ctx, base, entries.map((e) => (e.sha === sha ? { ...e, action: "drop" } : e)));
}

export async function moveCommit(ctx: Ctx, sha: string, direction: "up" | "down"): Promise<void> {
  if (gitneat().action) {
    const plan = await act<Plan | null>(ctx.cwd, "movePlan", { sha, direction });
    if (plan) {
      await runTodo(ctx, plan.base, plan.entries);
    }
    return;
  }
  const target = direction === "up" ? sha : await parentOf(ctx, sha);
  if (!target) {
    return;
  }
  const base = await parentOf(ctx, target);
  const entries = await rebaseRange(ctx, base);
  const i = entries.findIndex((e) => e.sha === target);
  if (i < 0 || i + 1 >= entries.length) {
    return;
  }
  [entries[i], entries[i + 1]] = [entries[i + 1], entries[i]];
  await runTodo(ctx, base, entries);
}

export async function editMessage(ctx: Ctx, sha: string, isHead: boolean): Promise<void> {
  const current = gitneat().action ? await act<string>(ctx.cwd, "commitMessage", { sha }) : (await g(ctx, ["show", "-s", "--format=%B", sha])).trim();
  const v = await ctx.ui.prompt("Edit commit message", [{ name: "message", label: "Message", kind: "textarea", value: current }], "Save");
  if (!v?.message.trim() || v.message.trim() === current) {
    return;
  }
  if (gitneat().action) {
    if (isHead) {
      await go(ctx, "Edit message", "amendMessage", { message: v.message });
    } else {
      const plan = await act<Plan>(ctx.cwd, "rewordPlan", { sha, message: v.message });
      await runTodo(ctx, plan.base, plan.entries);
    }
    return;
  }
  if (isHead) {
    await run(ctx, "Edit message", () => g(ctx, ["commit", "--amend", "--only", "--allow-empty", "-m", v.message]));
    return;
  }
  const base = await parentOf(ctx, sha);
  const entries = await rebaseRange(ctx, base);
  await runTodo(ctx, base, entries.map((e) => (e.sha === sha ? { ...e, action: "reword", message: v.message } : e)));
}

export function cherryPickMany(ctx: Ctx, newestFirst: Commit[]) {
  const shas = [...newestFirst].reverse().map((c) => c.sha);
  return via(ctx, `Cherry pick ${shas.length} commits`, "cherryPickMany", { shas: newestFirst.map((c) => c.sha) }, () => g(ctx, ["cherry-pick", ...shas]));
}

const confirmRewrite = (ctx: Ctx, shas: string[], action: "drop" | "squash") => {
  const label = action === "drop" ? `Drop ${shas.length} commits` : `Squash ${shas.length} commits`;
  return ctx.ui.confirm(label, `${label} in ${ctx.data.branch ?? "HEAD"}? This rewrites history.`, action === "drop" ? "Drop" : "Squash", action === "drop");
};

async function rewriteNative(ctx: Ctx, shas: string[], action: "drop" | "squash"): Promise<void> {
  const send = (confirmed: boolean) => act(ctx.cwd, "rewriteMany", { shas, action, confirmed });
  try {
    const result = await send(false);
    if (result.toast) {
      ctx.ui.toast(result.toast, "error");
    }
    return;
  } catch (error) {
    if (!needsConfirm(error, "rewrite")) {
      throw error;
    }
  }
  if (!(await confirmRewrite(ctx, shas, action))) {
    return;
  }
  await runNative(ctx, "Rebase", async () => {
    const result = await send(true);
    if (result.toast) {
      ctx.ui.toast(result.toast, "error");
    }
    return result;
  });
}

export async function rewriteMany(ctx: Ctx, shas: string[], action: "drop" | "squash"): Promise<void> {
  if (gitneat().action) {
    return rewriteNative(ctx, shas, action);
  }
  const counts = await Promise.all(shas.map((sha) => git(ctx.cwd, ["rev-list", "--count", sha]).then(Number)));
  const oldest = shas[counts.indexOf(Math.min(...counts))];
  const base = await parentOf(ctx, oldest);
  const entries = await rebaseRange(ctx, base);
  const picked = entries.filter((e) => shas.includes(e.sha));
  if (picked.length !== shas.length) {
    ctx.ui.toast("All selected commits must be in the history of the current branch.", "error");
    return;
  }
  if (action === "squash") {
    const first = entries.findIndex((e) => e.sha === oldest);
    const contiguous = entries.slice(first, first + shas.length).every((e) => shas.includes(e.sha));
    if (!contiguous) {
      ctx.ui.toast("Squash needs adjacent commits.", "error");
      return;
    }
  }
  if (!(await confirmRewrite(ctx, shas, action))) {
    return;
  }
  await runTodo(
    ctx,
    base,
    entries.map((e) => (shas.includes(e.sha) && (action === "drop" || e.sha !== oldest) ? { ...e, action: action === "drop" ? "drop" : "squash" } : e)),
  );
}

export async function startInteractiveRebase(ctx: Ctx, base: string): Promise<void> {
  ctx.openRebase(base, await rebaseRange(ctx, base));
}

export const stageFile = (ctx: Ctx, path: string) => via(ctx, "Stage", "stageFile", { path }, () => g(ctx, ["add", "--", path]));
export const stageAll = (ctx: Ctx) => via(ctx, "Stage all", "stageAll", {}, () => g(ctx, ["add", "-A"]));

export const unstageFile = (ctx: Ctx, path: string) =>
  via(ctx, "Unstage", "unstageFile", { path, hasHead: !!ctx.data.head }, () => (ctx.data.head ? g(ctx, ["reset", "-q", "HEAD", "--", path]) : g(ctx, ["rm", "--cached", "-q", "--", path])));

export const unstageAll = (ctx: Ctx) =>
  via(ctx, "Unstage all", "unstageAll", { hasHead: !!ctx.data.head }, () => (ctx.data.head ? g(ctx, ["reset", "-q"]) : g(ctx, ["rm", "-r", "--cached", "-q", "."])));

export async function discardFile(ctx: Ctx, path: string, untracked: boolean): Promise<void> {
  if (!(await ctx.ui.confirm("Discard changes", `Discard all changes to ${path}?`, "Discard", true))) {
    return;
  }
  const conflicted = ctx.data.status.some((e) => e.path === path && (e.index === "U" || e.work === "U"));
  await via(ctx, "Discard", "discardFile", { path, untracked, conflicted }, () =>
    untracked ? g(ctx, ["clean", "-f", "--", path]) : g(ctx, conflicted ? ["checkout", "HEAD", "--", path] : ["checkout", "--", path]),
  );
}

export async function discardAll(ctx: Ctx): Promise<void> {
  if (!(await ctx.ui.confirm("Discard all changes", "Discard all changes, including untracked files?", "Discard all", true))) {
    return;
  }
  await via(ctx, "Discard all", "discardAll", {}, async () => {
    await g(ctx, ["reset", "--hard"]);
    await g(ctx, ["clean", "-fd"]);
  });
}

export async function applyPatch(ctx: Ctx, patch: string, action: "stage" | "unstage" | "discard" | "revert"): Promise<void> {
  if (action === "discard" && !(await ctx.ui.confirm("Discard changes", "Discard the selected changes?", "Discard", true))) {
    return;
  }
  const args = {
    stage: ["apply", "--cached"],
    unstage: ["apply", "--cached", "-R"],
    discard: ["apply", "-R"],
    revert: ["apply", "-R", "--3way"],
  }[action];
  const label = { stage: "Stage", unstage: "Unstage", discard: "Discard", revert: "Revert hunk" }[action];
  await via(
    ctx,
    label,
    "applyPatch",
    { patch, action },
    async () => {
      const result = await gitneat().git(ctx.cwd, [...args, "--recount", "--whitespace=nowarn", "-"], undefined, patch);
      if (result.code !== 0) {
        throw new GitError(result.stderr.trim() || "git apply failed");
      }
    },
    false,
  );
}

export function commit(ctx: Ctx, message: string, amend: boolean) {
  return via(ctx, "Commit", "commit", { message, amend }, () => g(ctx, ["commit", ...(amend ? ["--amend"] : []), "-m", message]));
}

export function continueOperation(ctx: Ctx, op: Operation) {
  const env = { GIT_EDITOR: ":" };
  if (op === "merge") {
    return via(ctx, "Commit merge", "continueOperation", { op }, () => g(ctx, ["commit", "--no-edit"], env));
  }
  return via(ctx, `Continue ${op}`, "continueOperation", { op }, () => g(ctx, [op as string, "--continue"], env));
}

export const abortOperation = (ctx: Ctx, op: Operation) =>
  via(ctx, `Abort ${op}`, "abortOperation", { op }, () => g(ctx, [op as string, "--abort"]));

export const resolveFile = (ctx: Ctx, path: string, how: "ours" | "theirs" | "delete") =>
  via(
    ctx,
    "Resolve",
    "resolveFile",
    { path, how },
    async () => {
      if (how === "delete") {
        await g(ctx, ["rm", "-q", "--", path]);
        return;
      }
      await g(ctx, ["checkout", `--${how}`, "--", path]);
      await g(ctx, ["add", "--", path]);
    },
    false,
  );

export const saveResolved = (ctx: Ctx, path: string, content: string) => {
  const write = async () => {
    if (!(await gitneat().writeFile(ctx.cwd, path, content))) {
      throw new GitError(`Could not write ${path}`);
    }
  };
  if (gitneat().action) {
    return runNative(ctx, "Save output", async () => {
      await write();
      return act(ctx.cwd, "stageFile", { path });
    });
  }
  return run(
    ctx,
    "Save output",
    async () => {
      await write();
      await g(ctx, ["add", "--", path]);
    },
    false,
  );
};
