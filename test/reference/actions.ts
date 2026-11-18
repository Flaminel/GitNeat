import type { Ctx, HeadState, RangeInfo, TodoAction, TodoEntry, UndoEntry } from "../../src/actions";
import { gitneat } from "./api";
import type { Commit, Operation, Ref } from "../../src/repo";
import type { Field } from "../../src/ui";
import { git, GitError } from "./repo";

const short = (sha: string) => sha.slice(0, 7);

const confirmForceDelete = (ctx: Ctx, name: string) =>
  ctx.ui.confirm("Branch not merged", `${name} is not fully merged. Delete anyway?`, "Force delete", true);

const PULL_OPTIONS: { mode: PullMode; label: string }[] = [
  { mode: "fetch", label: "Fetch All" },
  { mode: "ff", label: "Pull (fast-forward if possible)" },
  { mode: "ff-only", label: "Pull (fast-forward only)" },
  { mode: "rebase", label: "Pull (rebase)" },
];

const FORCE_WARNING = "Force push is a destructive action and cannot be undone. Are you sure?";
const SKIP_FORCE_WARNING = "push.skipForceWarning";
const PUSH_RETRIES = 4;

const pullDefault = (ctx: Ctx): PullMode => {
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
  const ok = await ctx.ui.task(`Undo ${entry.label}`, () => moveTo(ctx, entry.after, entry.before, entry.label === "Commit"));
  ctx.refresh();
  return ok;
}

export async function redo(ctx: Ctx, entry: UndoEntry): Promise<boolean> {
  const ok = await ctx.ui.task(`Redo ${entry.label}`, () => moveTo(ctx, entry.before, entry.after, entry.label === "Commit"));
  ctx.refresh();
  return ok;
}

const g = (ctx: Ctx, args: string[], env?: Record<string, string>) => git(ctx.cwd, args, env);

export async function rangeInfo(cwd: string, sha: string): Promise<RangeInfo> {
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

const LOCAL_CHANGES = "Your local changes to the following files would be overwritten by checkout";

const checkoutError = (error: unknown): never => {
  const text = error instanceof Error ? error.message : String(error);
  const count = text.includes(LOCAL_CHANGES) ? text.split("\n").filter((l) => l.startsWith("\t")).length : 0;
  if (count === 0) {
    throw error;
  }
  const lead = count === 1 ? "1 conflict prevents checkout." : `${count} conflicts prevent checkout.`;
  throw new GitError(`${lead}\nCommit, stash, or discard your changes first.`);
};

async function autoStash(ctx: Ctx, target: string): Promise<void> {
  if (!(await g(ctx, ["status", "--porcelain"])).trim()) {
    return;
  }
  await g(ctx, ["stash", "push", "--include-untracked", "-m", `Auto stash before checking out "${target}"`]);
}

export const checkoutRef = (ctx: Ctx, name: string) => run(ctx, `Checkout ${name}`, () => g(ctx, ["switch", name]).catch(checkoutError));

export const checkoutCommit = (ctx: Ctx, sha: string) =>
  run(ctx, `Checkout ${short(sha)}`, async () => {
    await autoStash(ctx, "HEAD");
    await g(ctx, ["switch", "--detach", sha]);
  });

async function behindUpstream(ctx: Ctx, local: string, remote: string): Promise<boolean> {
  const tracks = await g(ctx, ["rev-parse", "--abbrev-ref", `${local}@{upstream}`]).catch(() => "");
  const [a, b] = await Promise.all([g(ctx, ["rev-parse", local]), g(ctx, ["rev-parse", remote])]);
  if (tracks.trim() !== remote || a === b) {
    return false;
  }
  return g(ctx, ["merge-base", "--is-ancestor", local, remote]).then(() => true, () => false);
}

export async function checkoutRemote(ctx: Ctx, remoteBranch: string): Promise<void> {
  const local = remoteBranch.split("/").slice(1).join("/");
  const existing = ctx.data.refs.find((r) => r.kind === "local" && r.name === local);
  await run(ctx, `Checkout ${remoteBranch}`, async () => {
    if (!existing) {
      await g(ctx, ["switch", "-c", local, "--track", remoteBranch]);
    } else if (await behindUpstream(ctx, local, remoteBranch)) {
      await autoStash(ctx, remoteBranch);
      await g(ctx, ["switch", "-C", local, remoteBranch]).catch(checkoutError);
    } else {
      await g(ctx, ["switch", local]).catch(checkoutError);
    }
  });
}

export async function createBranch(ctx: Ctx, from: string): Promise<void> {
  const v = await ctx.ui.prompt("Create branch", [{ name: "name", label: "Branch name", ref: true, placeholder: "feature/my-branch" }], "Create branch");
  if (v?.name.trim()) {
    await run(ctx, "Create branch", () => g(ctx, ["switch", "-c", v.name.trim(), from]));
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
  if (await run(ctx, "Create worktree", () => g(ctx, args))) {
    ctx.openTab(dir);
  }
}

export function cherryPick(ctx: Ctx, commit: Commit) {
  const args = commit.parents.length > 1 ? ["cherry-pick", "-m", "1", commit.sha] : ["cherry-pick", commit.sha];
  return run(ctx, "Cherry pick", () => g(ctx, args));
}

export function revert(ctx: Ctx, commit: Commit) {
  const args = ["revert", "--no-edit", ...(commit.parents.length > 1 ? ["-m", "1"] : []), commit.sha];
  return run(ctx, "Revert", () => g(ctx, args));
}

export async function reset(ctx: Ctx, mode: "soft" | "mixed" | "hard", sha: string): Promise<void> {
  if (mode === "hard") {
    const ok = await ctx.ui.confirm("Hard reset", `Reset ${ctx.data.branch ?? "HEAD"} to ${short(sha)} and discard all changes?`, "Reset", true);
    if (!ok) {
      return;
    }
  }
  await run(ctx, "Reset", () => g(ctx, ["reset", `--${mode}`, sha]));
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
  await run(ctx, "Create tag", () => g(ctx, args));
}

export async function deleteBranch(ctx: Ctx, ref: Ref, alsoRemote = false): Promise<void> {
  const ok = await ctx.ui.confirm("Delete branch", `Delete ${ref.name}${alsoRemote && ref.upstream ? ` and ${ref.upstream}` : ""}?`, "Delete", true);
  if (!ok) {
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
    await run(ctx, "Delete remote branch", () => g(ctx, ["push", remote, "--delete", rest.join("/")]));
  }
}

export async function renameBranch(ctx: Ctx, name: string): Promise<void> {
  const v = await ctx.ui.prompt(`Rename ${name}`, [{ name: "name", label: "New name", ref: true, value: name }], "Rename");
  if (v?.name.trim() && v.name.trim() !== name) {
    await run(ctx, "Rename branch", () => g(ctx, ["branch", "-m", name, v.name.trim()]), false);
  }
}

export const merge = (ctx: Ctx, name: string) =>
  run(ctx, `Merge ${name}`, () => g(ctx, ["merge", "--no-edit", name]));

export const rebaseOnto = (ctx: Ctx, name: string) =>
  run(ctx, `Rebase onto ${name}`, () => g(ctx, ["rebase", "--autostash", name], { GIT_EDITOR: ":" }));

export function fastForward(ctx: Ctx, local: Ref, target: string) {
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
  return run(ctx, `Pull ${ref.name}`, () =>
    g(ctx, ["fetch", remote, `${rest.join("/")}:refs/heads/${ref.name}`]),
  );
}

export const mergeNoFf = (ctx: Ctx, name: string) =>
  run(ctx, `Merge ${name}`, () => g(ctx, ["merge", "--no-ff", "--no-edit", name]));

export type PullMode = "ff" | "ff-only" | "rebase" | "fetch";

export function pull(ctx: Ctx, mode: PullMode = "ff") {
  if (mode === "fetch") {
    return run(ctx, "Fetch", () => g(ctx, ["fetch", "--all", "--prune"]));
  }
  const args = mode === "rebase" ? ["pull", "--rebase", "--autostash"] : ["pull", `--${mode}`];
  return run(ctx, "Pull", () => g(ctx, args));
}

export async function push(ctx: Ctx, branch?: string, remote?: string): Promise<void> {
  const name = branch ?? ctx.data.branch;
  if (!name) {
    ctx.ui.toast("Checkout a branch to push.", "error");
    return;
  }
  const ref = ctx.data.refs.find((r) => r.kind === "local" && r.name === name);
  let args: string[];
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
  }
  const upstream = ref?.upstream ?? (remote ? `${remote}/${name}` : args[2]?.replace(":", "/") ?? name);
  let mode: "plain" | "lease" | "hard" = "plain";
  for (let attempt = 0; attempt < PUSH_RETRIES; attempt += 1) {
    const box: { pending: "push-behind" | "push-remote-changed" | null } = { pending: null };
    await run(ctx, "Push", async () => {
      const flag = mode === "lease" ? ["--force-with-lease"] : mode === "hard" ? ["--force"] : [];
      try {
        await g(ctx, [args[0], ...flag, ...args.slice(1)]);
      } catch (error) {
        if (!(error instanceof GitError) || mode === "hard") {
          throw error;
        }
        if (/stale info|fetch first/.test(error.message)) {
          box.pending = "push-remote-changed";
        } else if (mode === "plain" && /rejected|non-fast-forward/.test(error.message)) {
          box.pending = "push-behind";
        } else {
          throw error;
        }
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

export const pushTo = (ctx: Ctx, local: string, remote: string, branch: string) =>
  run(ctx, "Push", () => g(ctx, ["push", remote, `${local}:${branch}`]));

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
    await run(ctx, "Set upstream", () => g(ctx, ["branch", `--set-upstream-to=${v.up}`, ref.name]));
  }
}

export async function stashSave(ctx: Ctx): Promise<void> {
  const v = await ctx.ui.prompt("Stash changes", [{ name: "message", label: "Message (optional)" }], "Stash");
  if (v) {
    await run(ctx, "Stash", () =>
      g(ctx, ["stash", "push", "--include-untracked", ...(v.message ? ["-m", v.message] : [])]),
    );
  }
}

export const stashApply = (ctx: Ctx, ref = "stash@{0}") => run(ctx, "Apply stash", () => g(ctx, ["stash", "apply", ref]));
export const stashPop = (ctx: Ctx, ref = "stash@{0}") => run(ctx, "Pop stash", () => g(ctx, ["stash", "pop", ref]));

export async function stashDrop(ctx: Ctx, ref: string): Promise<void> {
  if (await ctx.ui.confirm("Delete stash", `Delete ${ref}?`, "Delete", true)) {
    await run(ctx, "Delete stash", () => g(ctx, ["stash", "drop", ref]));
  }
}

export const pushTag = (ctx: Ctx, tag: string, remote: string) =>
  run(ctx, "Push tag", () => g(ctx, ["push", remote, `refs/tags/${tag}`]));

export async function deleteTag(ctx: Ctx, tag: string, remote?: string): Promise<void> {
  if (!(await ctx.ui.confirm("Delete tag", `Delete ${tag}${remote ? ` from ${remote}` : " locally"}?`, "Delete", true))) {
    return;
  }
  await run(ctx, "Delete tag", () =>
    g(ctx, remote ? ["push", remote, "--delete", `refs/tags/${tag}`] : ["tag", "-d", tag]),
  );
}

export async function addRemote(ctx: Ctx): Promise<void> {
  const v = await ctx.ui.prompt("Add remote", [
    { name: "name", label: "Name", value: ctx.data.remotes.length ? "" : "origin", ref: true },
    { name: "url", label: "URL" },
  ], "Add remote");
  if (v?.name && v.url) {
    await run(ctx, "Add remote", async () => {
      await g(ctx, ["remote", "add", v.name, v.url]);
      await g(ctx, ["fetch", v.name]);
    });
  }
}

export async function editRemote(ctx: Ctx, name: string, url: string): Promise<void> {
  const v = await ctx.ui.prompt(`Edit ${name}`, [{ name: "url", label: "URL", value: url }], "Save");
  if (v?.url && v.url !== url) {
    await run(ctx, "Edit remote", () => g(ctx, ["remote", "set-url", name, v.url]));
  }
}

export async function removeRemote(ctx: Ctx, name: string): Promise<void> {
  if (await ctx.ui.confirm("Remove remote", `Remove ${name}?`, "Remove", true)) {
    await run(ctx, "Remove remote", () => g(ctx, ["remote", "remove", name]));
  }
}

export const fetchRemote = (ctx: Ctx, name: string) =>
  run(ctx, `Fetch ${name}`, () => g(ctx, ["fetch", "--prune", name]));

export async function removeWorktree(ctx: Ctx, path: string): Promise<void> {
  if (await ctx.ui.confirm("Delete worktree", `Delete the worktree at ${path}?`, "Delete", true)) {
    await run(ctx, "Delete worktree", () => g(ctx, ["worktree", "remove", path]));
  }
}

export const lockWorktree = (ctx: Ctx, path: string, lock: boolean) =>
  run(ctx, lock ? "Lock worktree" : "Unlock worktree", () => g(ctx, ["worktree", lock ? "lock" : "unlock", path]));

export const pruneWorktrees = (ctx: Ctx) => run(ctx, "Prune worktrees", () => g(ctx, ["worktree", "prune"]));

export async function savePatch(ctx: Ctx, sha: string): Promise<void> {
  await ctx.ui.task("Create patch", async () => {
    const patch = await g(ctx, ["format-patch", "-1", "--stdout", sha]);
    await gitneat().saveFile(`${short(sha)}.patch`, patch);
  });
}

async function rebaseRange(ctx: Ctx, base: string | null): Promise<TodoEntry[]> {
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
  await run(ctx, "Rebase", async () => {
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
  const base = await parentOf(ctx, sha);
  const entries = await rebaseRange(ctx, base);
  await runTodo(ctx, base, entries.map((e) => (e.sha === sha ? { ...e, action: "drop" } : e)));
}

export async function moveCommit(ctx: Ctx, sha: string, direction: "up" | "down"): Promise<void> {
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
  const current = (await g(ctx, ["show", "-s", "--format=%B", sha])).trim();
  const v = await ctx.ui.prompt("Edit commit message", [{ name: "message", label: "Message", kind: "textarea", value: current }], "Save");
  if (!v?.message.trim() || v.message.trim() === current) {
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
  return run(ctx, `Cherry pick ${shas.length} commits`, () => g(ctx, ["cherry-pick", ...shas]));
}

const confirmRewrite = (ctx: Ctx, shas: string[], action: "drop" | "squash") => {
  const label = action === "drop" ? `Drop ${shas.length} commits` : `Squash ${shas.length} commits`;
  return ctx.ui.confirm(label, `${label} in ${ctx.data.branch ?? "HEAD"}? This rewrites history.`, action === "drop" ? "Drop" : "Squash", action === "drop");
};

export async function rewriteMany(ctx: Ctx, shas: string[], action: "drop" | "squash"): Promise<void> {
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

export const stageFile = (ctx: Ctx, path: string) => run(ctx, "Stage", () => g(ctx, ["add", "--", path]));
export const stageAll = (ctx: Ctx) => run(ctx, "Stage all", () => g(ctx, ["add", "-A"]));

export const unstageFile = (ctx: Ctx, path: string) =>
  run(ctx, "Unstage", () => (ctx.data.head ? g(ctx, ["reset", "-q", "HEAD", "--", path]) : g(ctx, ["rm", "--cached", "-q", "--", path])));

export const unstageAll = (ctx: Ctx) =>
  run(ctx, "Unstage all", () => (ctx.data.head ? g(ctx, ["reset", "-q"]) : g(ctx, ["rm", "-r", "--cached", "-q", "."])));

export async function discardFile(ctx: Ctx, path: string, untracked: boolean): Promise<void> {
  if (!(await ctx.ui.confirm("Discard changes", `Discard all changes to ${path}?`, "Discard", true))) {
    return;
  }
  const conflicted = ctx.data.status.some((e) => e.path === path && (e.index === "U" || e.work === "U"));
  await run(ctx, "Discard", () =>
    untracked ? g(ctx, ["clean", "-f", "--", path]) : g(ctx, conflicted ? ["checkout", "HEAD", "--", path] : ["checkout", "--", path]),
  );
}

export async function discardAll(ctx: Ctx): Promise<void> {
  if (!(await ctx.ui.confirm("Discard all changes", "Discard all changes, including untracked files?", "Discard all", true))) {
    return;
  }
  await run(ctx, "Discard all", async () => {
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
  await run(
    ctx,
    label,
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
  return run(ctx, "Commit", () => g(ctx, ["commit", ...(amend ? ["--amend"] : []), "-m", message]));
}

export function continueOperation(ctx: Ctx, op: Operation) {
  const env = { GIT_EDITOR: ":" };
  if (op === "merge") {
    return run(ctx, "Commit merge", () => g(ctx, ["commit", "--no-edit"], env));
  }
  return run(ctx, `Continue ${op}`, () => g(ctx, [op as string, "--continue"], env));
}

export const abortOperation = (ctx: Ctx, op: Operation) =>
  run(ctx, `Abort ${op}`, () => g(ctx, [op as string, "--abort"]));

export const resolveFile = (ctx: Ctx, path: string, how: "ours" | "theirs" | "delete") =>
  run(
    ctx,
    "Resolve",
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
