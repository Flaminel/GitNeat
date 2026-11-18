import * as A from "./actions";
import { Ctx } from "./actions";
import { gitneat } from "./api";
import { Commit, commitWebUrl, compareWebUrl, DiffSource, Ref, remoteWebUrl, Submodule, Worktree } from "./repo";

type MenuKind = "commit" | "ref" | "wip" | "stash" | "tag" | "remote" | "worktree" | "submodule" | "file" | "drop" | "multi" | "refs" | "folder";

type Handlers = Record<string, () => unknown>;

const baseName = (ref: Ref) => (ref.kind === "remote" ? ref.name.split("/").slice(1).join("/") : ref.name);

function env(ctx: Ctx, shas: string[] = []) {
  return {
    platform: gitneat().platform,
    head: ctx.data.head,
    branch: ctx.data.branch,
    operation: ctx.data.operation,
    refs: ctx.data.refs,
    remotes: ctx.data.remotes,
    hidden: ctx.hidden,
    solo: ctx.solo,
    commits: ctx.data.commits.filter((c) => shas.includes(c.sha)).map((c) => ({ sha: c.sha, parents: c.parents.length })),
  };
}

async function present(ctx: Ctx, kind: MenuKind, args: object, handlers: Handlers): Promise<void> {
  const chosen = await gitneat().contextMenu(ctx.cwd, kind, args);
  if (chosen) {
    await handlers[chosen]?.();
  }
}

function prefixed(handlers: Handlers, prefix: string): Handlers {
  return Object.fromEntries(Object.entries(handlers).map(([id, run]) => [prefix + id, run]));
}

function currentName(ctx: Ctx): string {
  return ctx.data.branch ?? "HEAD";
}

function commitFor(ctx: Ctx, sha: string): Commit {
  return ctx.data.commits.find((c) => c.sha === sha) ?? { sha, parents: [], author: "", email: "", time: 0, subject: "" };
}

function refGroups(refs: Ref[]): Ref[][] {
  const map = new Map<string, Ref[]>();
  for (const ref of refs) {
    const key = `${ref.sha} ${baseName(ref)}`;
    map.set(key, [...(map.get(key) ?? []), ref]);
  }
  return [...map.values()].map((g) => g.sort((a, b) => Number(a.kind !== "local") - Number(b.kind !== "local")));
}

function commitHandlers(ctx: Ctx, commit: Commit): Handlers {
  const sha = commit.sha;
  return {
    checkoutCommit: () => A.checkoutCommit(ctx, sha),
    createWorktreeCommit: () => A.createWorktree(ctx, sha),
    createBranch: () => A.createBranch(ctx, sha),
    cherryPick: () => A.cherryPick(ctx, commit),
    "reset:soft": () => A.reset(ctx, "soft", sha),
    "reset:mixed": () => A.reset(ctx, "mixed", sha),
    "reset:hard": () => A.reset(ctx, "hard", sha),
    revert: () => A.revert(ctx, commit),
    editHeadMessage: () => A.editMessage(ctx, sha, true),
    rebaseInteractiveCommit: () => A.startInteractiveRebase(ctx, sha),
    editMessage: () => A.editMessage(ctx, sha, false),
    dropCommit: () => A.dropCommit(ctx, sha),
    moveUp: () => A.moveCommit(ctx, sha, "up"),
    moveDown: () => A.moveCommit(ctx, sha, "down"),
    copySha: () => gitneat().copy(sha),
    ...Object.fromEntries(ctx.data.remotes.map((r, i) => [`copyLink:${i}`, () => gitneat().copy(commitWebUrl(r.url, sha) as string)])),
    savePatch: () => A.savePatch(ctx, sha),
    createTag: () => A.createTag(ctx, sha, false),
    createAnnotatedTag: () => A.createTag(ctx, sha, true),
  };
}

function soloHandlers(ctx: Ctx, group: Ref[]): Handlers {
  return {
    toggleHidden: () => ctx.toggleHidden(group[0].full),
    solo: () => ctx.toggleSolo(group[0].full),
    ...Object.fromEntries(group.map((r, i) => [`solo:${i}`, () => ctx.toggleSolo(r.full)])),
  };
}

function branchHandlers(ctx: Ctx, group: Ref[]): Handlers {
  const ref = group[0];
  const local = group.find((r) => r.kind === "local");
  const remote = group.find((r) => r.kind === "remote");
  const cur = currentName(ctx);
  const others = group.filter((r) => !r.current);
  const prRemote = remote && (ctx.data.remotes.find((r) => r.name === remote.name.split("/")[0]) ?? ctx.data.remotes.find((r) => r.name === "origin") ?? ctx.data.remotes[0]);
  return {
    ...commitHandlers(ctx, commitFor(ctx, ref.sha)),
    ...soloHandlers(ctx, group),
    pull: () => local && A.pullBranch(ctx, local),
    push: () => local && A.push(ctx, local.name),
    setUpstream: () => local && A.setUpstream(ctx, local),
    rebaseOnto: () => A.rebaseOnto(ctx, ref.name),
    rebaseInteractive: () => A.startInteractiveRebase(ctx, ref.name),
    fastForwardHead: () => A.merge(ctx, ref.name),
    mergeNoFf: () => A.mergeNoFf(ctx, ref.name),
    fastForwardRef: () => A.fastForward(ctx, ref, cur),
    merge: () => A.merge(ctx, ref.name),
    ...Object.fromEntries(
      others.filter((r) => r.worktree).map((r, i) => [`openWorktree:${i}`, () => ctx.openTab(r.worktree as string)]),
    ),
    ...Object.fromEntries(
      others.filter((r) => !r.worktree).map((r, i) => [`checkout:${i}`, () => (r.kind === "local" ? A.checkoutRef(ctx, r.name) : A.checkoutRemote(ctx, r.name))]),
    ),
    ...Object.fromEntries(
      group
        .filter((r) => !r.worktree && !r.current)
        .map((r, i) => [`createWorktree:${i}`, () => A.createWorktree(ctx, ref.sha, r.kind === "local" ? r.name : undefined)]),
    ),
    pullRequest: () =>
      gitneat().openExternal(compareWebUrl((prRemote as { url: string }).url, baseName(remote as Ref)) as string),
    renameBranch: () => local && A.renameBranch(ctx, local.name),
    ...Object.fromEntries(others.map((r, i) => [`delete:${i}`, () => (r.kind === "local" ? A.deleteBranch(ctx, r) : A.deleteRemoteBranch(ctx, r.name))])),
    deleteWithUpstream: () => local && A.deleteBranch(ctx, local, true),
    copyBranchName: () => gitneat().copy(ref.name),
  };
}

export async function commitMenu(ctx: Ctx, commit: Commit): Promise<void> {
  if (commit.stash) {
    return stashMenu(ctx, commit.stash, commit.sha);
  }
  const found = refGroups(ctx.data.refs.filter((r) => r.sha === commit.sha && r.kind !== "tag"));
  await present(
    ctx,
    "commit",
    { ...env(ctx, [commit.sha]), commit: { sha: commit.sha, parents: commit.parents.length } },
    Object.assign(commitHandlers(ctx, commit), ...found.map((g, i) => prefixed(branchHandlers(ctx, g), found.length === 1 ? "" : `g${i}:`))),
  );
}

export async function refMenu(ctx: Ctx, ref: Ref, panel = false): Promise<void> {
  if (ref.kind === "tag") {
    return tagMenu(ctx, ref, panel);
  }
  const group = panel ? [ref] : (refGroups(ctx.data.refs.filter((r) => r.sha === ref.sha && r.kind !== "tag")).find((g) => g.includes(ref)) ?? [ref]);
  await present(ctx, "ref", { ...env(ctx, [ref.sha]), ref, panel }, branchHandlers(ctx, group));
}

export function wipMenu(ctx: Ctx): Promise<void> {
  return present(ctx, "wip", {}, { stashAll: () => A.stashSave(ctx), discardAll: () => A.discardAll(ctx) });
}

export function stashMenu(ctx: Ctx, ref: string, sha: string): Promise<void> {
  return present(ctx, "stash", { hidden: ctx.hidden }, {
    stashEdit: () => A.editStash(ctx, ref),
    toggleHidden: () => ctx.setHidden(["refs/stash"], !ctx.hidden.includes("refs/stash")),
    stashApply: () => A.stashApply(ctx, ref),
    stashPop: () => A.stashPop(ctx, ref),
    stashDrop: () => A.stashDrop(ctx, ref),
    copySha: () => gitneat().copy(sha),
  });
}

function tagMenu(ctx: Ctx, ref: Ref, panel: boolean): Promise<void> {
  const remotes = ctx.data.remotes;
  return present(ctx, "tag", { ...env(ctx), ref, panel }, {
    ...commitHandlers(ctx, commitFor(ctx, ref.sha)),
    ...soloHandlers(ctx, [ref]),
    ...Object.fromEntries(remotes.map((r, i) => [`pushTag:${i}`, () => A.pushTag(ctx, ref.name, r.name)])),
    pushTagAll: () => A.pushTagAll(ctx, ref.name),
    deleteTag: () => A.deleteTag(ctx, ref.name),
    ...Object.fromEntries(remotes.map((r, i) => [`deleteTagRemote:${i}`, () => A.deleteTag(ctx, ref.name, r.name)])),
    copyTagName: () => gitneat().copy(ref.name),
  });
}

export function remoteMenu(ctx: Ctx, name: string, url: string): Promise<void> {
  const own = ctx.data.refs.filter((r) => r.kind === "remote" && r.name.startsWith(`${name}/`)).map((r) => r.full);
  return present(ctx, "remote", { ...env(ctx), name, url }, {
    toggleHidden: () => ctx.setHidden(own, !own.every((f) => ctx.hidden.includes(f))),
    solo: () => ctx.setSolo(own, !own.every((f) => ctx.solo.includes(f))),
    fetchRemote: () => A.fetchRemote(ctx, name),
    editRemote: () => A.editRemote(ctx, name, url),
    removeRemote: () => A.removeRemote(ctx, name),
    openRemoteWeb: () => gitneat().openExternal(remoteWebUrl(url) as string),
    copyRemoteUrl: () => gitneat().copy(url),
  });
}

export function worktreeMenu(ctx: Ctx, wt: Worktree): Promise<void> {
  return present(ctx, "worktree", { platform: gitneat().platform, wt }, {
    openWorktree: () => ctx.openTab(wt.path),
    removeWorktree: () => A.removeWorktree(ctx, wt.path),
    lockWorktree: () => A.lockWorktree(ctx, wt.path, true),
    unlockWorktree: () => A.lockWorktree(ctx, wt.path, false),
    pruneWorktrees: () => A.pruneWorktrees(ctx),
    copyPath: () => gitneat().copy(wt.path),
    showItem: () => gitneat().showItem(wt.path),
  });
}

export function submoduleMenu(ctx: Ctx, sm: Submodule): Promise<void> {
  return present(ctx, "submodule", { sm }, {
    submoduleReset: () => A.resetSubmodule(ctx, sm),
    submoduleCommit: () => A.commitSubmodule(ctx, sm),
    submoduleInit: () => A.updateSubmodule(ctx, sm),
    submoduleUpdate: () => A.updateSubmodule(ctx, sm),
    submoduleEdit: () => A.editSubmodule(ctx, sm),
    submoduleOpen: () => ctx.openTab(`${ctx.cwd}/${sm.path}`),
    submoduleRemove: () => A.removeSubmodule(ctx, sm),
  });
}

export interface FileSelection {
  paths: string[];
  message: string;
  stash: boolean;
  done(): void;
}

export function fileMenu(
  ctx: Ctx,
  path: string,
  wip?: { staged: boolean; untracked: boolean; conflict?: { current: string; incoming: string } },
  selection?: FileSelection,
  stashed?: { ref: string; paths: string[]; origins: string[] },
  view?: (view: "blame" | "history") => void,
  source?: DiffSource,
): Promise<void> {
  const abs = `${ctx.cwd}/${path}`;
  const paths = selection?.paths ?? [path];
  const args =
    wip && selection
      ? { ...wip, panel: true, stash: selection.stash, count: paths.length, ignore: !paths.some((p) => p.split("/").pop() === ".gitignore") }
      : wip;
  const finish = async (work: Promise<boolean>) => {
    if ((await work) && selection) {
      selection.done();
    }
  };
  return present(ctx, "file", { platform: gitneat().platform, path, wip: args, stashApply: stashed?.paths.length ?? 0, history: Boolean(view) && !wip?.untracked }, {
    fileHistory: () => view?.("history"),
    fileBlame: () => view?.("blame"),
    stage: () => (selection ? finish(A.stageFiles(ctx, paths)) : A.stageFile(ctx, path)),
    unstage: () => (selection ? finish(A.unstageFiles(ctx, paths)) : A.unstageFile(ctx, path)),
    discard: () => (selection ? finish(A.discardFiles(ctx, paths, !!wip?.staged)) : A.discardFile(ctx, path, !!wip?.untracked)),
    stashFile: () => finish(A.stashPaths(ctx, paths, selection?.message)),
    ignoreFile: () => finish(A.ignoreFiles(ctx, paths)),
    ignoreExtension: () => finish(A.ignoreExtension(ctx, path)),
    ignoreFolder: () => finish(A.ignoreFolder(ctx, path)),
    exportPatch: () => A.savePatchWork(ctx, paths),
    applyStashed: () => (stashed ? A.stashApplyFiles(ctx, stashed.ref, [...stashed.paths, ...stashed.origins]) : undefined),
    openDiffTool: () => A.openDiffTool(ctx, path, source ?? (wip?.staged ? { kind: "staged" } : { kind: "unstaged", untracked: Boolean(wip?.untracked) })),
    openMergeTool: () => A.openMergeTool(ctx, path),
    takeCurrent: () => A.resolveFile(ctx, path, "ours"),
    takeIncoming: () => A.resolveFile(ctx, path, "theirs"),
    markResolved: () => A.markResolved(ctx, [path]),
    openFile: () => gitneat().openPath(abs),
    showItem: () => gitneat().showItem(abs),
    copyFilePath: () => gitneat().copy(path),
  });
}

export function canDrop(ctx: Ctx, sourceFull: string, target: Ref): boolean {
  const source = ctx.data.refs.find((r) => r.full === sourceFull);
  return !!source && source.sha !== target.sha && (source.kind === "local" || target.kind === "local");
}

export function dropMenu(ctx: Ctx, sourceFull: string, target: Ref): Promise<void> {
  const source = ctx.data.refs.find((r) => r.full === sourceFull);
  if (!source) {
    return Promise.resolve();
  }
  const [remote, ...rest] = target.name.split("/");
  return present(ctx, "drop", { ...env(ctx), sourceFull, target }, {
    merge: () => A.merge(ctx, source.name),
    rebaseOnto: () => A.rebaseOnto(ctx, source.name),
    rebaseInteractive: () => A.startInteractiveRebase(ctx, source.name),
    mergeTarget: () => A.merge(ctx, target.name),
    rebaseOntoTarget: () => A.rebaseOnto(ctx, target.name),
    rebaseInteractiveTarget: () => A.startInteractiveRebase(ctx, target.name),
    fastForward: () => A.fastForward(ctx, target, source.name),
    pushTo: () => A.pushTo(ctx, source.name, remote, rest.join("/")),
  });
}

export function refsMenu(ctx: Ctx, refs: Ref[], done: () => void): Promise<void> {
  const fulls = refs.map((r) => r.full);
  return present(ctx, "refs", { ...env(ctx), fulls }, {
    deleteMany: async () => {
      if (await A.deleteBranches(ctx, refs)) {
        done();
      }
    },
    showMany: () => ctx.setHidden(fulls, false),
    hideMany: () => ctx.setHidden(fulls, true),
    soloMany: () => ctx.setSolo(fulls, true),
    unsoloMany: () => ctx.setSolo(fulls, false),
  });
}

export function folderMenu(ctx: Ctx, name: string, refs: Ref[]): Promise<void> {
  return present(ctx, "folder", { name, count: refs.length }, { deleteFolder: () => A.deleteBranches(ctx, refs, name) });
}

export function multiMenu(ctx: Ctx, commits: Commit[], wip = false): Promise<void> {
  const shas = commits.map((c) => c.sha);
  return present(ctx, "multi", { ...env(ctx), shas, wip }, {
    cherryPickMany: () => A.cherryPickMany(ctx, commits),
    squash: () => A.rewriteMany(ctx, shas, "squash"),
    drop: () => A.rewriteMany(ctx, shas, "drop"),
    copyShas: () => gitneat().copy(shas.join("\n")),
  });
}
