import { gitneat } from "./api";
import { Commit, GitError, Operation, Ref, RepoData, samePath } from "./repo";
import { Field, Layout, Ui } from "./ui";

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
  setHidden(fulls: string[], hide: boolean): void;
  setSolo(fulls: string[], on: boolean): void;
  toggleSolo(full: string): void;
  hidden: string[];
  solo: string[];
  record(entry: UndoEntry): void;
  prune: boolean;
  layout: Layout;
  setLayout(key: string, value: number | boolean | string): void;
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

const short = (sha: string) => sha.slice(0, 7);

interface Plan {
  base: string | null;
  entries: TodoEntry[];
}

interface Done {
  record: { before: HeadState; after: HeadState } | null;
  toast?: string;
  notice?: string;
}

async function act<T = Done>(cwd: string, name: string, args: unknown): Promise<T> {
  try {
    return (await gitneat().action(cwd, name, args)) as T;
  } catch (error) {
    throw new GitError(error instanceof Error ? error.message : String(error));
  }
}

const failTitle = (label: string) => `${label.replace(/^(Checkout|Merge|Pull|Fetch|Rebase onto|Cherry pick|Undo|Redo|Continue|Abort) .+$/, "$1")} Failed`;

async function runNative(ctx: Ctx, label: string, fn: () => Promise<Done>): Promise<boolean> {
  const box: { done?: Done } = {};
  const ok = await ctx.ui.task(
    label,
    async () => {
      box.done = await fn();
    },
    failTitle(label),
  );
  if (ok && box.done?.record) {
    ctx.record({ label, ...box.done.record });
  }
  if (ok && box.done?.notice) {
    ctx.ui.toast(box.done.notice);
  }
  ctx.refresh();
  return ok;
}

const go = (ctx: Ctx, label: string, name: string, args: unknown) => runNative(ctx, label, () => act(ctx.cwd, name, args));

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

export type PullMode = "ff" | "ff-only" | "rebase" | "fetch";

export const PULL_OPTIONS: { mode: PullMode; label: string }[] = [
  { mode: "fetch", label: "Fetch All" },
  { mode: "ff", label: "Pull (fast-forward if possible)" },
  { mode: "ff-only", label: "Pull (fast-forward only)" },
  { mode: "rebase", label: "Pull (rebase)" },
];

const FORCE_WARNING = "Force push is a destructive action and cannot be undone. Are you sure?";
const SKIP_FORCE_WARNING = "push.skipForceWarning";
const PUSH_RETRIES = 4;

export const pullDefault = (ctx: Ctx): PullMode => {
  const stored = ctx.layout["pull.default"];
  return PULL_OPTIONS.some((o) => o.mode === stored) ? (stored as PullMode) : "ff";
};

async function choosePullMode(ctx: Ctx): Promise<PullMode | null> {
  const mode = pullDefault(ctx);
  if (mode !== "fetch") {
    return mode;
  }
  const options = PULL_OPTIONS.filter((o) => o.mode !== "fetch");
  const answer = await ctx.ui.choose("", options.map((o) => ({ label: o.label, value: o.mode })));
  return answer ? (answer.choice as PullMode) : null;
}

async function confirmForce(ctx: Ctx, skippable: boolean): Promise<boolean> {
  if (skippable && ctx.layout[SKIP_FORCE_WARNING] === true) {
    return true;
  }
  const fields: Field[] = skippable ? [{ name: "skip", label: "Don't ask again", kind: "checkbox" }] : [];
  const answer = await ctx.ui.choose(FORCE_WARNING, [{ label: "Force Push", value: "force", danger: true }], fields);
  if (!answer) {
    return false;
  }
  if (skippable && answer.skip === "true") {
    ctx.setLayout(SKIP_FORCE_WARNING, true);
  }
  return true;
}

export async function undo(ctx: Ctx, entry: UndoEntry): Promise<boolean> {
  const ok = await ctx.ui.task(`Undo ${entry.label}`, () => act(ctx.cwd, "undo", { entry }));
  ctx.refresh();
  return ok;
}

export async function redo(ctx: Ctx, entry: UndoEntry): Promise<boolean> {
  const ok = await ctx.ui.task(`Redo ${entry.label}`, () => act(ctx.cwd, "redo", { entry }));
  ctx.refresh();
  return ok;
}

export const checkoutRef = (ctx: Ctx, name: string) => go(ctx, `Checkout ${name}`, "checkoutRef", { name });

export const checkoutCommit = (ctx: Ctx, sha: string) => go(ctx, `Checkout ${short(sha)}`, "checkoutCommit", { sha });

export const autoFetch = (cwd: string, prune: boolean): Promise<boolean> =>
  act(cwd, "pull", { mode: "fetch", prune }).then(
    () => true,
    () => false,
  );

export const cloneRepo = (parent: string, url: string, target: string): Promise<string> => act<string>(parent, "clone", { url, target });

export const initRepo = (dir: string, branch: string): Promise<string> => act<string>(dir, "init", { branch });

interface RemoteChoice {
  mode: "create" | "reset";
  newName?: string;
}

async function askRemoteChoice(ctx: Ctx, local: string, inWorktree: boolean): Promise<RemoteChoice | null> {
  const choices = [
    { label: inWorktree ? "Open Worktree and create Branch Here" : "Create Branch Here", value: "create" },
    { label: inWorktree ? "Open Worktree and reset Local to Here" : "Reset Local to Here", value: "reset", danger: true },
  ];
  const fields: Field[] = [{ name: "newName", label: "", placeholder: "branch name", ref: true }];
  for (;;) {
    const answer = await ctx.ui.choose(`A local '${local}' already exists${inWorktree ? " in a worktree" : ""}.`, choices, fields);
    if (!answer) {
      return null;
    }
    if (answer.choice === "reset") {
      return { mode: "reset" };
    }
    if (answer.newName?.trim()) {
      return { mode: "create", newName: answer.newName };
    }
  }
}

export async function checkoutRemote(ctx: Ctx, remoteBranch: string): Promise<void> {
  const local = remoteBranch.split("/").slice(1).join("/");
  const localRef = ctx.data.refs.find((r) => r.kind === "local" && r.name === local);
  const holder = localRef?.worktree && !samePath(localRef.worktree, ctx.cwd) ? localRef.worktree : null;
  const cwd = holder ?? ctx.cwd;
  const base = { remoteBranch, localExists: Boolean(localRef), inWorktree: Boolean(holder) };
  let choice: RemoteChoice | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const box: { pending: boolean } = { pending: false };
    const ok = await ctx.ui.task(
      `Checkout ${remoteBranch}`,
      async () => {
        try {
          const done = await act(cwd, "checkoutRemote", { ...base, ...choice });
          if (!holder && done.record) {
            ctx.record({ label: `Checkout ${remoteBranch}`, ...done.record });
          }
        } catch (error) {
          if (!needsConfirm(error, "remote-diverged")) {
            throw error;
          }
          box.pending = true;
        }
      },
      "Checkout Failed",
    );
    ctx.refresh();
    if (!ok) {
      return;
    }
    if (!box.pending) {
      if (holder) {
        ctx.openTab(holder);
      }
      return;
    }
    choice = await askRemoteChoice(ctx, local, Boolean(holder));
    if (!choice) {
      return;
    }
  }
}

export function openRef(ctx: Ctx, ref: Ref): Promise<unknown> | void {
  if (ref.kind === "remote") {
    return checkoutRemote(ctx, ref.name);
  }
  if (ref.kind !== "local") {
    return checkoutCommit(ctx, ref.sha);
  }
  if (ref.worktree && !samePath(ref.worktree, ctx.cwd)) {
    return ctx.openTab(ref.worktree);
  }
  return checkoutRef(ctx, ref.name);
}

export async function createBranch(ctx: Ctx, from: string): Promise<void> {
  const v = await ctx.ui.prompt("Create branch", [{ name: "name", label: "Branch name", ref: true, placeholder: "feature/my-branch" }], "Create branch");
  if (v?.name.trim()) {
    await go(ctx, "Create branch", "createBranch", { name: v.name, from });
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
  if (await go(ctx, "Create worktree", "createWorktree", { dir, name: v.name, branch, from })) {
    ctx.openTab(dir);
  }
}

export function cherryPick(ctx: Ctx, commit: Commit) {
  return go(ctx, "Cherry pick", "cherryPick", { sha: commit.sha, parents: commit.parents.length });
}

export function revert(ctx: Ctx, commit: Commit) {
  return go(ctx, "Revert", "revert", { sha: commit.sha, parents: commit.parents.length });
}

export async function reset(ctx: Ctx, mode: "soft" | "mixed" | "hard", sha: string): Promise<void> {
  if (mode === "hard") {
    const ok = await ctx.ui.confirm("Hard reset", `Reset ${ctx.data.branch ?? "HEAD"} to ${short(sha)} and discard all changes?`, "Reset", true);
    if (!ok) {
      return;
    }
  }
  await go(ctx, "Reset", "reset", { mode, sha });
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
  await go(ctx, "Create tag", "createTag", { sha, annotated, name: v.name, message: v.message });
}

export async function deleteBranch(ctx: Ctx, ref: Ref, alsoRemote = false): Promise<void> {
  const ok = await ctx.ui.confirm("Delete branch", `Delete ${ref.name}${alsoRemote && ref.upstream ? ` and ${ref.upstream}` : ""}?`, "Delete", true);
  if (!ok) {
    return;
  }
  await runNative(ctx, "Delete branch", () =>
    forceable(ctx, "deleteBranch", { name: ref.name, upstream: ref.upstream, alsoRemote }, "force-delete", () => confirmForceDelete(ctx, ref.name)),
  );
}

export async function deleteRemoteBranch(ctx: Ctx, remoteBranch: string): Promise<void> {
  const ok = await ctx.ui.confirm("Delete remote branch", `Delete ${remoteBranch} on the remote?`, "Delete", true);
  if (ok) {
    await go(ctx, "Delete remote branch", "deleteRemoteBranch", { remoteBranch });
  }
}

export async function renameBranch(ctx: Ctx, name: string): Promise<void> {
  const v = await ctx.ui.prompt(`Rename ${name}`, [{ name: "name", label: "New name", ref: true, value: name }], "Rename");
  if (v?.name.trim() && v.name.trim() !== name) {
    await go(ctx, "Rename branch", "renameBranch", { name, newName: v.name });
  }
}

export const merge = (ctx: Ctx, name: string) => go(ctx, `Merge ${name}`, "merge", { name, noFf: false });

export const rebaseOnto = (ctx: Ctx, name: string) => go(ctx, `Rebase onto ${name}`, "rebaseOnto", { name });

export function fastForward(ctx: Ctx, local: Ref, target: string) {
  return go(ctx, "Fast-forward", "fastForward", { name: local.name, current: !!local.current, target });
}

export function pullBranch(ctx: Ctx, ref: Ref) {
  if (ref.current) {
    return pull(ctx, "ff");
  }
  if (!ref.upstream) {
    ctx.ui.toast(`${ref.name} has no upstream.`, "error");
    return Promise.resolve();
  }
  return go(ctx, `Pull ${ref.name}`, "pullBranch", { name: ref.name, current: false, upstream: ref.upstream });
}

export const mergeNoFf = (ctx: Ctx, name: string) => go(ctx, `Merge ${name}`, "merge", { name, noFf: true });

export function pull(ctx: Ctx, mode: PullMode = "ff") {
  if (mode === "fetch") {
    return go(ctx, "Fetch", "pull", { mode, prune: ctx.prune });
  }
  return go(ctx, "Pull", "pull", { mode, prune: ctx.prune });
}

export async function push(ctx: Ctx, branch?: string, remote?: string): Promise<void> {
  const name = branch ?? ctx.data.branch;
  if (!name) {
    ctx.ui.toast("Checkout a branch to push.", "error");
    return;
  }
  const ref = ctx.data.refs.find((r) => r.kind === "local" && r.name === name);
  let answer: { remote: string; branch: string } | undefined;
  if (!remote && !ref?.upstream) {
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
    answer = { remote: v.remote, branch: v.branch };
  }
  const upstream = ref?.upstream ?? (remote ? `${remote}/${name}` : answer ? `${answer.remote}/${answer.branch}` : name);
  let mode: "plain" | "lease" | "hard" = "plain";
  for (let attempt = 0; attempt < PUSH_RETRIES; attempt += 1) {
    const box: { pending: "push-behind" | "push-remote-changed" | null } = { pending: null };
    await runNative(ctx, "Push", async () => {
      try {
        return await act(ctx.cwd, "push", { name, remote, upstream: ref?.upstream, answer, force: mode === "lease", hard: mode === "hard" });
      } catch (error) {
        if (needsConfirm(error, "push-behind")) {
          box.pending = "push-behind";
        } else if (needsConfirm(error, "push-remote-changed")) {
          box.pending = "push-remote-changed";
        } else {
          throw error;
        }
        return { record: null };
      }
    });
    if (!box.pending) {
      return;
    }
    if (box.pending === "push-behind") {
      const pullMode = pullDefault(ctx);
      const answerBehind = await ctx.ui.choose(`'${name}' is behind '${upstream}'. Update your branch by doing a Pull.`, [
        { label: pullMode === "fetch" ? "Pull" : (PULL_OPTIONS.find((o) => o.mode === pullMode)?.label ?? "Pull"), value: "pull" },
        { label: "Force Push", value: "force", danger: true },
      ]);
      if (!answerBehind) {
        return;
      }
      if (answerBehind.choice === "pull") {
        const chosen = await choosePullMode(ctx);
        if (!chosen || !(await pull(ctx, chosen))) {
          return;
        }
      } else if (await confirmForce(ctx, true)) {
        mode = "lease";
      } else {
        return;
      }
    } else {
      const answerChanged = await ctx.ui.choose(`WARNING! '${name}' has changed on the remote since the last fetch.`, [
        { label: "Fetch", value: "fetch" },
        { label: "Force Push Anyway", value: "force", danger: true },
      ]);
      if (!answerChanged) {
        return;
      }
      if (answerChanged.choice === "fetch") {
        await pull(ctx, "fetch");
        return;
      }
      if (!(await confirmForce(ctx, false))) {
        return;
      }
      mode = "hard";
    }
  }
  ctx.ui.toast("Maximum retry limit reached", "error", "Push Failed");
}

export const pushTo = (ctx: Ctx, local: string, remote: string, branch: string) => go(ctx, "Push", "pushTo", { local, remote, branch });

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
    await go(ctx, "Set upstream", "setUpstream", { up: v.up, name: ref.name });
  }
}

export async function stashSave(ctx: Ctx): Promise<void> {
  const v = await ctx.ui.prompt("Stash changes", [{ name: "message", label: "Message (optional)" }], "Stash");
  if (v) {
    await go(ctx, "Stash", "stashSave", { message: v.message });
  }
}

export const stashApply = (ctx: Ctx, ref = "stash@{0}") => go(ctx, "Apply stash", "stashApply", { ref });
export const stashPop = (ctx: Ctx, ref = "stash@{0}") => go(ctx, "Pop stash", "stashPop", { ref });

export async function stashDrop(ctx: Ctx, ref: string): Promise<void> {
  if (await ctx.ui.confirm("Delete stash", `Delete ${ref}?`, "Delete", true)) {
    await go(ctx, "Delete stash", "stashDrop", { ref });
  }
}

export async function editStash(ctx: Ctx, ref: string): Promise<void> {
  const current = ctx.data.stashes.find((s) => s.ref === ref)?.message ?? "";
  const v = await ctx.ui.prompt("Edit stash message", [{ name: "message", label: "Message", value: current }], "Save");
  if (v?.message.trim() && v.message !== current) {
    await go(ctx, "Edit stash message", "stashEdit", { ref, message: v.message });
  }
}

export const pushTag = (ctx: Ctx, tag: string, remote: string) => go(ctx, "Push tag", "pushTag", { tag, remote });

export async function pushTagAll(ctx: Ctx, tag: string): Promise<void> {
  for (const remote of ctx.data.remotes) {
    await pushTag(ctx, tag, remote.name);
  }
}

export async function deleteTag(ctx: Ctx, tag: string, remote?: string): Promise<void> {
  if (!(await ctx.ui.confirm("Delete tag", `Delete ${tag}${remote ? ` from ${remote}` : " locally"}?`, "Delete", true))) {
    return;
  }
  const ok = await go(ctx, "Delete tag", "deleteTag", { tag, remote });
  if (ok && !remote && ctx.data.remotes.length) {
    const message = `The tag was deleted locally. Would you also like to delete tags named "${tag}" from your remote repos?`;
    if (await ctx.ui.confirm("Delete tag from remotes", message, "Delete", true)) {
      for (const r of ctx.data.remotes) {
        await go(ctx, "Delete tag", "deleteTag", { tag, remote: r.name });
      }
    }
  }
}

export async function addRemote(ctx: Ctx): Promise<void> {
  const v = await ctx.ui.prompt("Add remote", [
    { name: "name", label: "Name", value: ctx.data.remotes.length ? "" : "origin", ref: true },
    { name: "url", label: "URL" },
  ], "Add remote");
  if (v?.name && v.url) {
    await go(ctx, "Add remote", "addRemote", { name: v.name, url: v.url });
  }
}

export async function editRemote(ctx: Ctx, name: string, url: string): Promise<void> {
  const v = await ctx.ui.prompt(`Edit ${name}`, [{ name: "url", label: "URL", value: url }], "Save");
  if (v?.url && v.url !== url) {
    await go(ctx, "Edit remote", "editRemote", { name, url: v.url });
  }
}

export async function removeRemote(ctx: Ctx, name: string): Promise<void> {
  if (await ctx.ui.confirm("Remove remote", `Remove ${name}?`, "Remove", true)) {
    await go(ctx, "Remove remote", "removeRemote", { name });
  }
}

export const fetchRemote = (ctx: Ctx, name: string) => go(ctx, `Fetch ${name}`, "fetchRemote", { name, prune: ctx.prune });

const confirmForceRemove = (ctx: Ctx) =>
  ctx.ui.confirm(
    "Force remove worktree",
    "Removing this worktree requires force, which is destructive and cannot be undone. Do you want to complete the removal?",
    "Force Remove Worktree",
    true,
  );

export async function removeWorktree(ctx: Ctx, path: string): Promise<void> {
  if (await ctx.ui.confirm("Delete worktree", `Delete the worktree at ${path}?`, "Delete", true)) {
    await runNative(ctx, "Delete worktree", () => forceable(ctx, "removeWorktree", { path }, "force-remove", () => confirmForceRemove(ctx)));
  }
}

export const lockWorktree = (ctx: Ctx, path: string, lock: boolean) => go(ctx, lock ? "Lock worktree" : "Unlock worktree", "lockWorktree", { path, lock });

export const pruneWorktrees = (ctx: Ctx) => go(ctx, "Prune worktrees", "pruneWorktrees", {});

export async function savePatch(ctx: Ctx, sha: string): Promise<void> {
  await ctx.ui.task("Create patch", async () => {
    const patch = await act<string>(ctx.cwd, "formatPatch", { sha });
    await gitneat().saveFile(`${short(sha)}.patch`, patch);
  });
}

export function runTodo(ctx: Ctx, base: string | null, entries: TodoEntry[]): Promise<boolean> {
  return go(ctx, "Rebase", "runTodo", { base, entries });
}

export async function dropCommit(ctx: Ctx, sha: string): Promise<void> {
  if (!(await ctx.ui.confirm("Drop commit", `Remove commit ${short(sha)} from the history of ${ctx.data.branch ?? "HEAD"}?`, "Drop", true))) {
    return;
  }
  const plan = await act<Plan>(ctx.cwd, "dropPlan", { sha });
  await runTodo(ctx, plan.base, plan.entries);
}

export async function moveCommit(ctx: Ctx, sha: string, direction: "up" | "down"): Promise<void> {
  const plan = await act<Plan | null>(ctx.cwd, "movePlan", { sha, direction });
  if (plan) {
    await runTodo(ctx, plan.base, plan.entries);
  }
}

export async function editMessage(ctx: Ctx, sha: string, isHead: boolean): Promise<void> {
  const current = await act<string>(ctx.cwd, "commitMessage", { sha });
  const v = await ctx.ui.prompt("Edit commit message", [{ name: "message", label: "Message", kind: "textarea", value: current }], "Save");
  if (!v?.message.trim() || v.message.trim() === current) {
    return;
  }
  await saveMessage(ctx, sha, isHead, v.message);
}

export async function saveMessage(ctx: Ctx, sha: string, isHead: boolean, message: string): Promise<boolean> {
  if (isHead) {
    return go(ctx, "Edit message", "amendMessage", { message });
  }
  const plan = await act<Plan>(ctx.cwd, "rewordPlan", { sha, message });
  return runTodo(ctx, plan.base, plan.entries);
}

export function rewordDepth(data: RepoData, sha: string): number | null {
  if (data.operation || !data.head) {
    return null;
  }
  const bySha = new Map(data.commits.map((c) => [c.sha, c]));
  let depth = 0;
  for (let c = bySha.get(data.head); c; c = bySha.get(c.parents[0])) {
    if (c.sha === sha) {
      return depth === 0 || c.parents.length <= 1 ? depth : null;
    }
    if (c.parents.length !== 1) {
      return null;
    }
    depth++;
  }
  return null;
}

export function cherryPickMany(ctx: Ctx, newestFirst: Commit[]) {
  const shas = [...newestFirst].reverse().map((c) => c.sha);
  return go(ctx, `Cherry pick ${shas.length} commits`, "cherryPickMany", { shas: newestFirst.map((c) => c.sha) });
}

const confirmRewrite = (ctx: Ctx, shas: string[], action: "drop" | "squash") => {
  const label = action === "drop" ? `Drop ${shas.length} commits` : `Squash ${shas.length} commits`;
  return ctx.ui.confirm(label, `${label} in ${ctx.data.branch ?? "HEAD"}? This rewrites history.`, action === "drop" ? "Drop" : "Squash", action === "drop");
};

export async function rewriteMany(ctx: Ctx, shas: string[], action: "drop" | "squash"): Promise<void> {
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

export async function startInteractiveRebase(ctx: Ctx, base: string): Promise<void> {
  ctx.openRebase(base, await act<TodoEntry[]>(ctx.cwd, "rebaseRange", { base }));
}

export const stageFile = (ctx: Ctx, path: string) => go(ctx, "Stage", "stageFile", { path });
export const stageAll = (ctx: Ctx) => go(ctx, "Stage all", "stageAll", {});

export const unstageFile = (ctx: Ctx, path: string) => go(ctx, "Unstage", "unstageFile", { path, hasHead: !!ctx.data.head });

export const unstageAll = (ctx: Ctx) => go(ctx, "Unstage all", "unstageAll", { hasHead: !!ctx.data.head });

export async function discardFile(ctx: Ctx, path: string, untracked: boolean): Promise<void> {
  if (!(await ctx.ui.confirm("Discard changes", `Discard all changes to ${path}?`, "Discard", true))) {
    return;
  }
  const conflicted = ctx.data.status.some((e) => e.path === path && (e.index === "U" || e.work === "U"));
  await go(ctx, "Discard", "discardFile", { path, untracked, conflicted });
}

export async function discardAll(ctx: Ctx): Promise<void> {
  if (!(await ctx.ui.confirm("Discard all changes", "Discard all changes, including untracked files?", "Discard all", true))) {
    return;
  }
  await go(ctx, "Discard all", "discardAll", {});
}

export async function applyPatch(ctx: Ctx, patch: string, action: "stage" | "unstage" | "discard" | "revert"): Promise<void> {
  if (action === "discard" && !(await ctx.ui.confirm("Discard changes", "Discard the selected changes?", "Discard", true))) {
    return;
  }
  const label = { stage: "Stage", unstage: "Unstage", discard: "Discard", revert: "Revert hunk" }[action];
  await go(ctx, label, "applyPatch", { patch, action });
}

export function commit(ctx: Ctx, message: string, amend: boolean) {
  return go(ctx, "Commit", "commit", { message, amend });
}

export function continueOperation(ctx: Ctx, op: Operation) {
  if (op === "merge") {
    return go(ctx, "Commit merge", "continueOperation", { op });
  }
  return go(ctx, `Continue ${op}`, "continueOperation", { op });
}

export const abortOperation = (ctx: Ctx, op: Operation) => go(ctx, `Abort ${op}`, "abortOperation", { op });

export const skipOperation = (ctx: Ctx) => go(ctx, "Skip commit", "skipOperation", {});

export const markResolved = (ctx: Ctx, paths: string[]) => go(ctx, "Mark resolved", "markResolved", { paths });

export const resolveFile = (ctx: Ctx, path: string, how: "ours" | "theirs" | "delete") => go(ctx, "Resolve", "resolveFile", { path, how });

export const saveResolved = (ctx: Ctx, path: string, content: string) =>
  runNative(ctx, "Save output", async () => {
    if (!(await gitneat().writeFile(ctx.cwd, path, content))) {
      throw new GitError(`Could not write ${path}`);
    }
    return act(ctx.cwd, "stageFile", { path });
  });
