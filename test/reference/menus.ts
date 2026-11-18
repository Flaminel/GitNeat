import * as A from "../../src/actions";
import type { Ctx, RangeInfo } from "../../src/actions";
import { gitneat } from "./api";
import { Commit, commitWebUrl, compareWebUrl, Ref, remoteWebUrl, samePath, Worktree } from "../../src/repo";
import { MenuItem, showMenu } from "../../src/ui";
import { rangeInfo } from "./actions";

type MenuKind = "commit" | "ref" | "wip" | "stash" | "tag" | "remote" | "worktree" | "file" | "drop" | "multi";

const short = (sha: string) => sha.slice(0, 7);

function scoped(items: MenuItem[], prefix: string): MenuItem[] {
  return items.map((item) =>
    item && item !== "-" ? { ...item, id: item.id && `${prefix}${item.id}`, submenu: item.submenu && scoped(item.submenu, prefix) } : item,
  );
}

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

async function present(_cwd: string, _kind: MenuKind, _args: object, build: () => MenuItem[] | Promise<MenuItem[]>): Promise<void> {
  await showMenu(await build());
}

function groups(...list: MenuItem[][]): MenuItem[] {
  return list.flatMap((g) => ["-", ...g] as MenuItem[]);
}

function currentName(ctx: Ctx): string {
  return ctx.data.branch ?? "HEAD";
}

function commitFor(ctx: Ctx, sha: string): Commit {
  return ctx.data.commits.find((c) => c.sha === sha) ?? { sha, parents: [], author: "", email: "", time: 0, subject: "" };
}

function resetItem(ctx: Ctx, sha: string): MenuItem {
  return (
    !!ctx.data.head && {
      label: `Reset ${currentName(ctx)} to this commit`,
      submenu: [
        { id: "reset:soft", label: "Soft - keep all changes", run: () => A.reset(ctx, "soft", sha) },
        { id: "reset:mixed", label: "Mixed - keep working copy but reset index", run: () => A.reset(ctx, "mixed", sha) },
        { id: "reset:hard", label: "Hard - discard all changes", run: () => A.reset(ctx, "hard", sha) },
      ],
    }
  );
}

function commitActions(ctx: Ctx, commit: Commit, info: RangeInfo, variant: "commit" | "branch"): MenuItem[] {
  const editHead: MenuItem = info.isHead && { id: "editHeadMessage", label: "Edit commit message", run: () => A.editMessage(ctx, commit.sha, true) };
  const revert: MenuItem = { id: "revert", label: "Revert commit", run: () => A.revert(ctx, commit) };
  return [
    { id: "createBranch", label: "Create branch here", run: () => A.createBranch(ctx, commit.sha) },
    !info.isHead && { id: "cherryPick", label: "Cherry pick commit", run: () => A.cherryPick(ctx, commit) },
    resetItem(ctx, commit.sha),
    ...(variant === "branch" ? [editHead, revert] : [revert, editHead]),
  ];
}

function rebaseActions(ctx: Ctx, commit: Commit, info: RangeInfo): MenuItem[] {
  if (!info.ancestor || info.hasMerges || ctx.data.operation === "rebase") {
    return [];
  }
  const below = commit.parents.length === 1;
  return [
    !info.isHead && {
      id: "rebaseInteractiveCommit",
      label: `Interactive Rebase ${info.children} children of ${short(commit.sha)}`,
      run: () => A.startInteractiveRebase(ctx, commit.sha),
    },
    !info.isHead && { id: "editMessage", label: "Edit commit message", run: () => A.editMessage(ctx, commit.sha, false) },
    { id: "dropCommit", label: "Drop commit", run: () => A.dropCommit(ctx, commit.sha) },
    !info.isHead && { id: "moveUp", label: "Move commit up", run: () => A.moveCommit(ctx, commit.sha, "up") },
    below && { id: "moveDown", label: "Move commit down", run: () => A.moveCommit(ctx, commit.sha, "down") },
  ];
}

function copyActions(ctx: Ctx, sha: string): MenuItem[] {
  return [
    { id: "copySha", label: "Copy commit sha", run: () => gitneat().copy(sha) },
    ...ctx.data.remotes.map((r, i): MenuItem => {
      const url = commitWebUrl(r.url, sha);
      return url && { id: `copyLink:${i}`, label: `Copy link to this commit on remote: ${r.name}`, run: () => gitneat().copy(url) };
    }),
    { id: "savePatch", label: "Create patch from commit", run: () => A.savePatch(ctx, sha) },
  ];
}

function tagActions(ctx: Ctx, sha: string): MenuItem[] {
  return [
    { id: "createTag", label: "Create tag here", run: () => A.createTag(ctx, sha, false) },
    { id: "createAnnotatedTag", label: "Create annotated tag here", run: () => A.createTag(ctx, sha, true) },
  ];
}

function prItem(ctx: Ctx, branch: string, remoteName?: string): MenuItem {
  const remote = ctx.data.remotes.find((r) => r.name === remoteName) ?? ctx.data.remotes.find((r) => r.name === "origin") ?? ctx.data.remotes[0];
  const url = remote && compareWebUrl(remote.url, branch);
  return url && { id: "pullRequest", label: `Start a pull request from ${branch}`, run: () => gitneat().openExternal(url) };
}

const baseName = (ref: Ref) => (ref.kind === "remote" ? ref.name.split("/").slice(1).join("/") : ref.name);

export function refGroups(refs: Ref[]): Ref[][] {
  const map = new Map<string, Ref[]>();
  for (const ref of refs) {
    const key = `${ref.sha} ${baseName(ref)}`;
    map.set(key, [...(map.get(key) ?? []), ref]);
  }
  return [...map.values()].map((g) => g.sort((a, b) => Number(a.kind !== "local") - Number(b.kind !== "local")));
}

function mergeItems(ctx: Ctx, ref: Ref, info: RangeInfo): MenuItem[] {
  const cur = currentName(ctx);
  const rebase: MenuItem[] = [
    { id: "rebaseOnto", label: `Rebase ${cur} onto ${ref.name}`, run: () => A.rebaseOnto(ctx, ref.name) },
    !info.descendant && { id: "rebaseInteractive", label: `Interactive Rebase ${cur} onto ${ref.name}`, run: () => A.startInteractiveRebase(ctx, ref.name) },
  ];
  if (info.descendant) {
    return [
      { id: "fastForwardHead", label: `Fast-forward ${cur} to ${ref.name}`, run: () => A.merge(ctx, ref.name) },
      { id: "mergeNoFf", label: `Merge ${ref.name} into ${cur}`, run: () => A.mergeNoFf(ctx, ref.name) },
      ...rebase,
    ];
  }
  if (info.ancestor) {
    return [ref.kind === "local" && { id: "fastForwardRef", label: `Fast-forward ${ref.name} to ${cur}`, run: () => A.fastForward(ctx, ref, cur) }, ...rebase];
  }
  return [{ id: "merge", label: `Merge ${ref.name} into ${cur}`, run: () => A.merge(ctx, ref.name) }, ...rebase];
}

function checkoutItems(ctx: Ctx, group: Ref[], panel: boolean): MenuItem[] {
  const sha = group[0].sha;
  const others = group.filter((r) => !r.current);
  const open: MenuItem[] = others
    .filter((r) => r.worktree)
    .map((r, i) => ({ id: `openWorktree:${i}`, label: `Open worktree from ${r.name}`, run: () => ctx.openTab(r.worktree as string) }));
  const refs = others
    .filter((r) => !r.worktree)
    .map((r, i) => ({ id: `checkout:${i}`, name: r.name, run: () => (r.kind === "local" ? A.checkoutRef(ctx, r.name) : A.checkoutRemote(ctx, r.name)) }));
  const detach = () => A.checkoutCommit(ctx, sha);
  if (refs.length + (panel ? 0 : 1) > 1) {
    return [
      { label: "Checkout", submenu: [...refs.map((r) => ({ id: r.id, label: r.name, run: r.run })), { id: "checkoutCommit", label: "this commit", run: detach }] },
      ...open,
    ];
  }
  return [
    ...refs.map((r) => ({ id: r.id, label: `Checkout ${r.name}`, run: r.run })),
    ...open,
    !panel && { id: "checkoutCommit", label: "Checkout this commit", run: detach },
  ];
}

function worktreeItems(ctx: Ctx, group: Ref[], panel: boolean): MenuItem[] {
  const sha = group[0].sha;
  const refs = group
    .filter((r) => !r.worktree && !r.current)
    .map((r, i) => ({ id: `createWorktree:${i}`, name: r.name, run: () => A.createWorktree(ctx, sha, r.kind === "local" ? r.name : undefined) }));
  const fromCommit = () => A.createWorktree(ctx, sha);
  if (refs.length + (panel ? 0 : 1) > 1) {
    return [
      {
        label: "Create worktree from",
        submenu: [...refs.map((r) => ({ id: r.id, label: r.name, run: r.run })), { id: "createWorktreeCommit", label: "this commit", run: fromCommit }],
      },
    ];
  }
  return [
    ...refs.map((r) => ({ id: r.id, label: `Create worktree from ${r.name}`, run: r.run })),
    !panel && { id: "createWorktreeCommit", label: "Create worktree from this commit", run: fromCommit },
  ];
}

function deleteItems(ctx: Ctx, group: Ref[], local?: Ref): MenuItem[] {
  const upstream = local?.upstream ? group.find((r) => r.name === local.upstream) : undefined;
  return [
    ...group
      .filter((r) => !r.current)
      .map(
        (r, i): MenuItem => ({
          id: `delete:${i}`,
          label: `Delete ${r.name}`,
          run: () => (r.kind === "local" ? A.deleteBranch(ctx, r) : A.deleteRemoteBranch(ctx, r.name)),
        }),
      ),
    !!local &&
      !local.current &&
      !!upstream && { id: "deleteWithUpstream", label: `Delete ${local.name} and ${upstream.name}`, run: () => A.deleteBranch(ctx, local, true) },
  ];
}

function soloItems(ctx: Ctx, group: Ref[], panel: boolean): MenuItem[] {
  const solo = (r: Ref) => (ctx.solo.includes(r.full) ? "Stop soloing" : "Solo");
  if (group.length === 1) {
    const ref = group[0];
    return [
      panel && { id: "toggleHidden", label: ctx.hidden.includes(ref.full) ? "Show" : "Hide", run: () => ctx.toggleHidden(ref.full) },
      { id: "solo", label: solo(ref), run: () => ctx.toggleSolo(ref.full) },
    ];
  }
  return [{ label: "Solo", submenu: group.map((r, i) => ({ id: `solo:${i}`, label: `${solo(r)} ${r.name}`, run: () => ctx.toggleSolo(r.full) })) }];
}

function branchGroups(ctx: Ctx, group: Ref[], info: RangeInfo, submenu: boolean, panel = false): MenuItem[] {
  const ref = group[0];
  const local = group.find((r) => r.kind === "local");
  const remote = group.find((r) => r.kind === "remote");
  const commit = commitFor(ctx, ref.sha);
  const inGroup = group.some((r) => r.current) || ref.sha === ctx.data.head;
  const prFrom = remote ? baseName(remote) : undefined;
  return groups(
    local && ctx.data.remotes.length > 0
      ? [
          { id: "pull", label: "Pull (fast-forward if possible)", run: () => A.pullBranch(ctx, local) },
          { id: "push", label: "Push", run: () => A.push(ctx, local.name) },
          { id: "setUpstream", label: "Set Upstream", run: () => A.setUpstream(ctx, local) },
        ]
      : [],
    !inGroup && !!ctx.data.branch ? mergeItems(ctx, ref, info) : [],
    checkoutItems(ctx, group, panel),
    worktreeItems(ctx, group, panel),
    submenu ? [] : commitActions(ctx, commit, info, "branch"),
    rebaseActions(ctx, commit, info),
    [prFrom !== undefined && remote ? prItem(ctx, prFrom, remote.name.split("/")[0]) : false],
    [local && { id: "renameBranch", label: `Rename ${local.name}`, run: () => A.renameBranch(ctx, local.name) }, ...deleteItems(ctx, group, local)],
    [
      { id: "copyBranchName", label: "Copy branch name", run: () => gitneat().copy(ref.name) },
      { id: "copySha", label: "Copy commit sha", run: () => gitneat().copy(ref.sha) },
      !panel && { id: "savePatch", label: "Create patch from commit", run: () => A.savePatch(ctx, ref.sha) },
    ],
    soloItems(ctx, group, panel),
  );
}

export async function commitMenu(ctx: Ctx, commit: Commit): Promise<void> {
  if (commit.stash) {
    return stashMenu(ctx, commit.stash, commit.sha);
  }
  await present(ctx.cwd, "commit", { ...env(ctx, [commit.sha]), commit: { sha: commit.sha, parents: commit.parents.length } }, async () => {
    const info = await rangeInfo(ctx.cwd, commit.sha);
    const found = refGroups(ctx.data.refs.filter((r) => r.sha === commit.sha && r.kind !== "tag"));
    if (found.length === 1) {
      return [...branchGroups(ctx, found[0], info, false), "-", ...tagActions(ctx, commit.sha)];
    }
    return groups(
      [{ id: "checkoutCommit", label: "Checkout this commit", run: () => A.checkoutCommit(ctx, commit.sha) }],
      [{ id: "createWorktreeCommit", label: "Create worktree from this commit", run: () => A.createWorktree(ctx, commit.sha) }],
      commitActions(ctx, commit, info, "commit"),
      rebaseActions(ctx, commit, info),
      found.map((g, i) => ({ label: g[0].name, submenu: scoped(branchGroups(ctx, g, info, true), `g${i}:`) })),
      found.length === 0 ? copyActions(ctx, commit.sha) : [],
      tagActions(ctx, commit.sha),
    );
  });
}

export async function refMenu(ctx: Ctx, ref: Ref, panel = false): Promise<void> {
  if (ref.kind === "tag") {
    return tagMenu(ctx, ref, panel);
  }
  await present(ctx.cwd, "ref", { ...env(ctx, [ref.sha]), ref, panel }, async () => {
    const info = await rangeInfo(ctx.cwd, ref.sha);
    const group = panel ? [ref] : (refGroups(ctx.data.refs.filter((r) => r.sha === ref.sha && r.kind !== "tag")).find((g) => g.includes(ref)) ?? [ref]);
    return branchGroups(ctx, group, info, false, panel);
  });
}

export function wipMenu(ctx: Ctx): Promise<void> {
  return present(ctx.cwd, "wip", {}, () => [
    { id: "stashAll", label: "Stash all changes", run: () => A.stashSave(ctx) },
    "-",
    { id: "discardAll", label: "Discard all changes", run: () => A.discardAll(ctx) },
  ]);
}

export function stashMenu(ctx: Ctx, ref: string, sha: string): Promise<void> {
  return present(ctx.cwd, "stash", {}, () =>
    groups(
      [
        { id: "stashApply", label: "Apply Stash", run: () => A.stashApply(ctx, ref) },
        { id: "stashPop", label: "Pop Stash", run: () => A.stashPop(ctx, ref) },
        { id: "stashDrop", label: "Delete Stash", run: () => A.stashDrop(ctx, ref) },
      ],
      [{ id: "copySha", label: "Copy commit sha", run: () => gitneat().copy(sha) }],
    ),
  );
}

export function tagMenu(ctx: Ctx, ref: Ref, panel = false): Promise<void> {
  const remotes = ctx.data.remotes;
  const commit = commitFor(ctx, ref.sha);
  const isHead = ref.sha === ctx.data.head;
  return present(ctx.cwd, "tag", { ...env(ctx), ref, panel }, () =>
    groups(
      remotes.length === 1
        ? [{ id: "pushTag:0", label: `Push ${ref.name} to ${remotes[0].name}`, run: () => A.pushTag(ctx, ref.name, remotes[0].name) }]
        : remotes.length > 1
          ? [{ label: "Push tag to remote", submenu: remotes.map((r, i) => ({ id: `pushTag:${i}`, label: r.name, run: () => A.pushTag(ctx, ref.name, r.name) })) }]
          : [],
      [{ id: "checkoutCommit", label: `Checkout the commit at ${ref.name}`, run: () => A.checkoutCommit(ctx, ref.sha) }],
      [{ id: "createWorktreeCommit", label: "Create worktree from this commit", run: () => A.createWorktree(ctx, ref.sha) }],
      [
        { id: "createBranch", label: "Create branch here", run: () => A.createBranch(ctx, ref.sha) },
        !isHead && { id: "cherryPick", label: "Cherry pick commit", run: () => A.cherryPick(ctx, commit) },
        resetItem(ctx, ref.sha),
        { id: "revert", label: "Revert commit", run: () => A.revert(ctx, commit) },
      ],
      [
        { id: "deleteTag", label: `Delete ${ref.name} locally`, run: () => A.deleteTag(ctx, ref.name) },
        remotes.length > 0 && {
          label: "Delete tag from remote",
          submenu: remotes.map((r, i) => ({ id: `deleteTagRemote:${i}`, label: `Delete ${ref.name} from ${r.name}`, run: () => A.deleteTag(ctx, ref.name, r.name) })),
        },
      ],
      [{ id: "copyTagName", label: "Copy tag name", run: () => gitneat().copy(ref.name) }],
      soloItems(ctx, [ref], panel),
    ),
  );
}

export function remoteMenu(ctx: Ctx, name: string, url: string): Promise<void> {
  const web = remoteWebUrl(url);
  return present(ctx.cwd, "remote", { name, url }, () =>
    groups(
      [{ id: "fetchRemote", label: `Fetch ${name}`, run: () => A.fetchRemote(ctx, name) }],
      [
        { id: "editRemote", label: `Edit ${name}`, run: () => A.editRemote(ctx, name, url) },
        { id: "removeRemote", label: `Remove ${name}`, run: () => A.removeRemote(ctx, name) },
      ],
      [
        web && { id: "openRemoteWeb", label: `View ${name} on ${new URL(web).host}`, run: () => gitneat().openExternal(web) },
        { id: "copyRemoteUrl", label: "Copy remote URL", run: () => gitneat().copy(url) },
      ],
    ),
  );
}

export function worktreeMenu(ctx: Ctx, wt: Worktree): Promise<void> {
  const isSelf = samePath(wt.path, ctx.cwd);
  return present(ctx.cwd, "worktree", { platform: gitneat().platform, wt }, () =>
    groups(
      [
        !wt.locked && !wt.prunable && !isSelf && { id: "openWorktree", label: "Open this worktree", run: () => ctx.openTab(wt.path) },
        !wt.main && !isSelf && { id: "removeWorktree", label: "Remove this worktree", run: () => A.removeWorktree(ctx, wt.path) },
      ],
      [
        !wt.main && !wt.locked && { id: "lockWorktree", label: "Lock this worktree", run: () => A.lockWorktree(ctx, wt.path, true) },
        wt.locked && { id: "unlockWorktree", label: "Unlock this worktree", run: () => A.lockWorktree(ctx, wt.path, false) },
      ],
      [wt.prunable && { id: "pruneWorktrees", label: "Prune worktrees", run: () => A.pruneWorktrees(ctx) }],
      [
        { id: "copyPath", label: "Copy path", run: () => gitneat().copy(wt.path) },
        { id: "showItem", label: gitneat().platform === "darwin" ? "Show in Finder" : "Show in Explorer", run: () => gitneat().showItem(wt.path) },
      ],
    ),
  );
}

export function fileMenu(ctx: Ctx, path: string, wip?: { staged: boolean; untracked: boolean }): Promise<void> {
  const abs = `${ctx.cwd}/${path}`;
  return present(ctx.cwd, "file", { platform: gitneat().platform, path, wip }, () =>
    groups(
      wip
        ? [
            !wip.staged && { id: "stage", label: "Stage", run: () => A.stageFile(ctx, path) },
            wip.staged && { id: "unstage", label: "Unstage", run: () => A.unstageFile(ctx, path) },
            !wip.staged && { id: "discard", label: "Discard changes", run: () => A.discardFile(ctx, path, wip.untracked) },
          ]
        : [],
      [
        { id: "openFile", label: "Open file", run: () => gitneat().openPath(abs) },
        { id: "showItem", label: gitneat().platform === "darwin" ? "Show in Finder" : "Show in Explorer", run: () => gitneat().showItem(abs) },
      ],
      [{ id: "copyFilePath", label: "Copy file path", run: () => gitneat().copy(path) }],
    ),
  );
}

export function dropMenu(ctx: Ctx, sourceFull: string, target: Ref): Promise<void> {
  const source = ctx.data.refs.find((r) => r.full === sourceFull);
  if (!source) {
    return Promise.resolve();
  }
  const cur = currentName(ctx);
  const targetIsCurrent = !!target.current;
  const sourceIsCurrent = !!source.current;
  const [remote, ...rest] = target.name.split("/");
  return present(ctx.cwd, "drop", { ...env(ctx), sourceFull, target }, () => [
    targetIsCurrent && { id: "merge", label: `Merge ${source.name} into ${cur}`, run: () => A.merge(ctx, source.name) },
    targetIsCurrent && { id: "rebaseOnto", label: `Rebase ${cur} onto ${source.name}`, run: () => A.rebaseOnto(ctx, source.name) },
    targetIsCurrent && { id: "rebaseInteractive", label: `Interactive Rebase ${cur} onto ${source.name}`, run: () => A.startInteractiveRebase(ctx, source.name) },
    sourceIsCurrent && { id: "mergeTarget", label: `Merge ${target.name} into ${cur}`, run: () => A.merge(ctx, target.name) },
    sourceIsCurrent && { id: "rebaseOntoTarget", label: `Rebase ${cur} onto ${target.name}`, run: () => A.rebaseOnto(ctx, target.name) },
    sourceIsCurrent && {
      id: "rebaseInteractiveTarget",
      label: `Interactive Rebase ${cur} onto ${target.name}`,
      run: () => A.startInteractiveRebase(ctx, target.name),
    },
    target.kind === "local" &&
      !targetIsCurrent && { id: "fastForward", label: `Fast-forward ${target.name} to ${source.name}`, run: () => A.fastForward(ctx, target, source.name) },
    source.kind === "local" &&
      target.kind === "remote" && {
        id: "pushTo",
        label: `Push ${source.name} to ${target.name}`,
        run: () => A.pushTo(ctx, source.name, remote, rest.join("/")),
      },
  ]);
}

export async function multiMenu(ctx: Ctx, commits: Commit[]): Promise<void> {
  const n = commits.length;
  const shas = commits.map((c) => c.sha);
  await present(ctx.cwd, "multi", { ...env(ctx), shas }, async () => {
    const infos = await Promise.all(shas.map((sha) => rangeInfo(ctx.cwd, sha)));
    const allInHistory = infos.every((i) => i.ancestor && !i.hasMerges) && ctx.data.operation !== "rebase";
    return groups(
      [{ id: "cherryPickMany", label: `Cherry pick ${n} commits`, run: () => A.cherryPickMany(ctx, commits) }],
      allInHistory
        ? [
            { id: "squash", label: `Squash ${n} commits`, run: () => A.rewriteMany(ctx, shas, "squash") },
            { id: "drop", label: `Drop ${n} commits`, run: () => A.rewriteMany(ctx, shas, "drop") },
          ]
        : [],
      [{ id: "copyShas", label: "Copy commit shas", run: () => gitneat().copy(shas.join("\n")) }],
    );
  });
}
