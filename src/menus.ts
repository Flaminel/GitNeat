import * as A from "./actions";
import { Ctx, RangeInfo } from "./actions";
import { krill } from "./api";
import { Commit, commitWebUrl, compareWebUrl, Ref, remoteWebUrl, samePath, Worktree } from "./repo";
import { MenuItem, showMenu } from "./ui";

const short = (sha: string) => sha.slice(0, 7);

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
        { label: "Soft - keep all changes", run: () => A.reset(ctx, "soft", sha) },
        { label: "Mixed - keep working copy but reset index", run: () => A.reset(ctx, "mixed", sha) },
        { label: "Hard - discard all changes", run: () => A.reset(ctx, "hard", sha) },
      ],
    }
  );
}

function commitActions(ctx: Ctx, commit: Commit, info: RangeInfo, variant: "commit" | "branch"): MenuItem[] {
  const editHead: MenuItem = info.isHead && { label: "Edit commit message", run: () => A.editMessage(ctx, commit.sha, true) };
  const revert: MenuItem = { label: "Revert commit", run: () => A.revert(ctx, commit) };
  return [
    { label: "Create branch here", run: () => A.createBranch(ctx, commit.sha) },
    !info.isHead && { label: "Cherry pick commit", run: () => A.cherryPick(ctx, commit) },
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
    !info.isHead && { label: `Interactive Rebase ${info.children} children of ${short(commit.sha)}`, run: () => A.startInteractiveRebase(ctx, commit.sha) },
    !info.isHead && { label: "Edit commit message", run: () => A.editMessage(ctx, commit.sha, false) },
    { label: "Drop commit", run: () => A.dropCommit(ctx, commit.sha) },
    !info.isHead && { label: "Move commit up", run: () => A.moveCommit(ctx, commit.sha, "up") },
    below && { label: "Move commit down", run: () => A.moveCommit(ctx, commit.sha, "down") },
  ];
}

function copyActions(ctx: Ctx, sha: string): MenuItem[] {
  return [
    { label: "Copy commit sha", run: () => krill().copy(sha) },
    ...ctx.data.remotes.map((r): MenuItem => {
      const url = commitWebUrl(r.url, sha);
      return url && { label: `Copy link to this commit on remote: ${r.name}`, run: () => krill().copy(url) };
    }),
    { label: "Create patch from commit", run: () => A.savePatch(ctx, sha) },
  ];
}

function tagActions(ctx: Ctx, sha: string): MenuItem[] {
  return [
    { label: "Create tag here", run: () => A.createTag(ctx, sha, false) },
    { label: "Create annotated tag here", run: () => A.createTag(ctx, sha, true) },
  ];
}

function prItem(ctx: Ctx, branch: string, remoteName?: string): MenuItem {
  const remote = ctx.data.remotes.find((r) => r.name === remoteName) ?? ctx.data.remotes.find((r) => r.name === "origin") ?? ctx.data.remotes[0];
  const url = remote && compareWebUrl(remote.url, branch);
  return url && { label: `Start a pull request from ${branch}`, run: () => krill().openExternal(url) };
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
    { label: `Rebase ${cur} onto ${ref.name}`, run: () => A.rebaseOnto(ctx, ref.name) },
    !info.descendant && { label: `Interactive Rebase ${cur} onto ${ref.name}`, run: () => A.startInteractiveRebase(ctx, ref.name) },
  ];
  if (info.descendant) {
    return [
      { label: `Fast-forward ${cur} to ${ref.name}`, run: () => A.merge(ctx, ref.name) },
      { label: `Merge ${ref.name} into ${cur}`, run: () => A.mergeNoFf(ctx, ref.name) },
      ...rebase,
    ];
  }
  if (info.ancestor) {
    return [ref.kind === "local" && { label: `Fast-forward ${ref.name} to ${cur}`, run: () => A.fastForward(ctx, ref, cur) }, ...rebase];
  }
  return [{ label: `Merge ${ref.name} into ${cur}`, run: () => A.merge(ctx, ref.name) }, ...rebase];
}

function checkoutItems(ctx: Ctx, group: Ref[], panel: boolean): MenuItem[] {
  const sha = group[0].sha;
  const others = group.filter((r) => !r.current);
  const open: MenuItem[] = others
    .filter((r) => r.worktree)
    .map((r) => ({ label: `Open worktree from ${r.name}`, run: () => ctx.openTab(r.worktree as string) }));
  const refs = others
    .filter((r) => !r.worktree)
    .map((r) => ({ name: r.name, run: () => (r.kind === "local" ? A.checkoutRef(ctx, r.name) : A.checkoutRemote(ctx, r.name)) }));
  const detach = () => A.checkoutCommit(ctx, sha);
  if (refs.length + (panel ? 0 : 1) > 1) {
    return [{ label: "Checkout", submenu: [...refs.map((r) => ({ label: r.name, run: r.run })), { label: "this commit", run: detach }] }, ...open];
  }
  return [...refs.map((r) => ({ label: `Checkout ${r.name}`, run: r.run })), ...open, !panel && { label: "Checkout this commit", run: detach }];
}

function worktreeItems(ctx: Ctx, group: Ref[], panel: boolean): MenuItem[] {
  const sha = group[0].sha;
  const refs = group
    .filter((r) => !r.worktree && !r.current)
    .map((r) => ({ name: r.name, run: () => A.createWorktree(ctx, sha, r.kind === "local" ? r.name : undefined) }));
  const fromCommit = () => A.createWorktree(ctx, sha);
  if (refs.length + (panel ? 0 : 1) > 1) {
    return [{ label: "Create worktree from", submenu: [...refs.map((r) => ({ label: r.name, run: r.run })), { label: "this commit", run: fromCommit }] }];
  }
  return [...refs.map((r) => ({ label: `Create worktree from ${r.name}`, run: r.run })), !panel && { label: "Create worktree from this commit", run: fromCommit }];
}

function deleteItems(ctx: Ctx, group: Ref[], local?: Ref): MenuItem[] {
  const upstream = local?.upstream ? group.find((r) => r.name === local.upstream) : undefined;
  return [
    ...group
      .filter((r) => !r.current)
      .map((r): MenuItem => ({ label: `Delete ${r.name}`, run: () => (r.kind === "local" ? A.deleteBranch(ctx, r) : A.deleteRemoteBranch(ctx, r.name)) })),
    !!local && !local.current && !!upstream && { label: `Delete ${local.name} and ${upstream.name}`, run: () => A.deleteBranch(ctx, local, true) },
  ];
}

function soloItems(ctx: Ctx, group: Ref[], panel: boolean): MenuItem[] {
  const solo = (r: Ref) => (ctx.solo.includes(r.full) ? "Stop soloing" : "Solo");
  if (group.length === 1) {
    const ref = group[0];
    return [
      panel && { label: ctx.hidden.includes(ref.full) ? "Show" : "Hide", run: () => ctx.toggleHidden(ref.full) },
      { label: solo(ref), run: () => ctx.toggleSolo(ref.full) },
    ];
  }
  return [{ label: "Solo", submenu: group.map((r) => ({ label: `${solo(r)} ${r.name}`, run: () => ctx.toggleSolo(r.full) })) }];
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
          { label: "Pull (fast-forward if possible)", run: () => A.pullBranch(ctx, local) },
          { label: "Push", run: () => A.push(ctx, local.name) },
          { label: "Set Upstream", run: () => A.setUpstream(ctx, local) },
        ]
      : [],
    !inGroup && !!ctx.data.branch ? mergeItems(ctx, ref, info) : [],
    checkoutItems(ctx, group, panel),
    worktreeItems(ctx, group, panel),
    submenu ? [] : commitActions(ctx, commit, info, "branch"),
    rebaseActions(ctx, commit, info),
    [prFrom !== undefined && remote ? prItem(ctx, prFrom, remote.name.split("/")[0]) : false],
    [local && { label: `Rename ${local.name}`, run: () => A.renameBranch(ctx, local.name) }, ...deleteItems(ctx, group, local)],
    [
      { label: "Copy branch name", run: () => krill().copy(ref.name) },
      { label: "Copy commit sha", run: () => krill().copy(ref.sha) },
      !panel && { label: "Create patch from commit", run: () => A.savePatch(ctx, ref.sha) },
    ],
    soloItems(ctx, group, panel),
  );
}

export async function commitMenu(ctx: Ctx, commit: Commit): Promise<void> {
  if (commit.stash) {
    return stashMenu(ctx, commit.stash, commit.sha);
  }
  const info = await A.rangeInfo(ctx.cwd, commit.sha);
  const found = refGroups(ctx.data.refs.filter((r) => r.sha === commit.sha && r.kind !== "tag"));
  if (found.length === 1) {
    await showMenu([...branchGroups(ctx, found[0], info, false), "-", ...tagActions(ctx, commit.sha)]);
    return;
  }
  await showMenu(
    groups(
      [{ label: "Checkout this commit", run: () => A.checkoutCommit(ctx, commit.sha) }],
      [{ label: "Create worktree from this commit", run: () => A.createWorktree(ctx, commit.sha) }],
      commitActions(ctx, commit, info, "commit"),
      rebaseActions(ctx, commit, info),
      found.map((g) => ({ label: g[0].name, submenu: branchGroups(ctx, g, info, true) })),
      found.length === 0 ? copyActions(ctx, commit.sha) : [],
      tagActions(ctx, commit.sha),
    ),
  );
}

export async function refMenu(ctx: Ctx, ref: Ref, panel = false): Promise<void> {
  if (ref.kind === "tag") {
    return tagMenu(ctx, ref, panel);
  }
  const info = await A.rangeInfo(ctx.cwd, ref.sha);
  const group = panel ? [ref] : (refGroups(ctx.data.refs.filter((r) => r.sha === ref.sha && r.kind !== "tag")).find((g) => g.includes(ref)) ?? [ref]);
  await showMenu(branchGroups(ctx, group, info, false, panel));
}

export function wipMenu(ctx: Ctx): Promise<void> {
  return showMenu([
    { label: "Stash all changes", run: () => A.stashSave(ctx) },
    "-",
    { label: "Discard all changes", run: () => A.discardAll(ctx) },
  ]);
}

export function stashMenu(ctx: Ctx, ref: string, sha: string): Promise<void> {
  return showMenu(
    groups(
      [
        { label: "Apply Stash", run: () => A.stashApply(ctx, ref) },
        { label: "Pop Stash", run: () => A.stashPop(ctx, ref) },
        { label: "Delete Stash", run: () => A.stashDrop(ctx, ref) },
      ],
      [{ label: "Copy commit sha", run: () => krill().copy(sha) }],
    ),
  );
}

export function tagMenu(ctx: Ctx, ref: Ref, panel = false): Promise<void> {
  const remotes = ctx.data.remotes;
  const commit = commitFor(ctx, ref.sha);
  const isHead = ref.sha === ctx.data.head;
  return showMenu(
    groups(
      remotes.length === 1
        ? [{ label: `Push ${ref.name} to ${remotes[0].name}`, run: () => A.pushTag(ctx, ref.name, remotes[0].name) }]
        : remotes.length > 1
          ? [{ label: "Push tag to remote", submenu: remotes.map((r) => ({ label: r.name, run: () => A.pushTag(ctx, ref.name, r.name) })) }]
          : [],
      [{ label: `Checkout the commit at ${ref.name}`, run: () => A.checkoutCommit(ctx, ref.sha) }],
      [{ label: "Create worktree from this commit", run: () => A.createWorktree(ctx, ref.sha) }],
      [
        { label: "Create branch here", run: () => A.createBranch(ctx, ref.sha) },
        !isHead && { label: "Cherry pick commit", run: () => A.cherryPick(ctx, commit) },
        resetItem(ctx, ref.sha),
        { label: "Revert commit", run: () => A.revert(ctx, commit) },
      ],
      [
        { label: `Delete ${ref.name} locally`, run: () => A.deleteTag(ctx, ref.name) },
        remotes.length > 0 && {
          label: "Delete tag from remote",
          submenu: remotes.map((r) => ({ label: `Delete ${ref.name} from ${r.name}`, run: () => A.deleteTag(ctx, ref.name, r.name) })),
        },
      ],
      [{ label: "Copy tag name", run: () => krill().copy(ref.name) }],
      soloItems(ctx, [ref], panel),
    ),
  );
}

export function remoteMenu(ctx: Ctx, name: string, url: string): Promise<void> {
  const web = remoteWebUrl(url);
  return showMenu(
    groups(
      [{ label: `Fetch ${name}`, run: () => A.fetchRemote(ctx, name) }],
      [
        { label: `Edit ${name}`, run: () => A.editRemote(ctx, name, url) },
        { label: `Remove ${name}`, run: () => A.removeRemote(ctx, name) },
      ],
      [
        web && { label: `View ${name} on ${new URL(web).host}`, run: () => krill().openExternal(web) },
        { label: "Copy remote URL", run: () => krill().copy(url) },
      ],
    ),
  );
}

export function worktreeMenu(ctx: Ctx, wt: Worktree): Promise<void> {
  const isSelf = samePath(wt.path, ctx.cwd);
  return showMenu(
    groups(
      [
        !wt.locked && !wt.prunable && !isSelf && { label: "Open this worktree", run: () => ctx.openTab(wt.path) },
        !wt.main && !isSelf && { label: "Remove this worktree", run: () => A.removeWorktree(ctx, wt.path) },
      ],
      [
        !wt.main && !wt.locked && { label: "Lock this worktree", run: () => A.lockWorktree(ctx, wt.path, true) },
        wt.locked && { label: "Unlock this worktree", run: () => A.lockWorktree(ctx, wt.path, false) },
      ],
      [wt.prunable && { label: "Prune worktrees", run: () => A.pruneWorktrees(ctx) }],
      [
        { label: "Copy path", run: () => krill().copy(wt.path) },
        { label: krill().platform === "darwin" ? "Show in Finder" : "Show in Explorer", run: () => krill().showItem(wt.path) },
      ],
    ),
  );
}

export function fileMenu(ctx: Ctx, path: string, wip?: { staged: boolean; untracked: boolean }): Promise<void> {
  const abs = `${ctx.cwd}/${path}`;
  return showMenu(
    groups(
      wip
        ? [
            !wip.staged && { label: "Stage", run: () => A.stageFile(ctx, path) },
            wip.staged && { label: "Unstage", run: () => A.unstageFile(ctx, path) },
            !wip.staged && { label: "Discard changes", run: () => A.discardFile(ctx, path, wip.untracked) },
          ]
        : [],
      [
        { label: "Open file", run: () => krill().openPath(abs) },
        { label: krill().platform === "darwin" ? "Show in Finder" : "Show in Explorer", run: () => krill().showItem(abs) },
      ],
      [{ label: "Copy file path", run: () => krill().copy(path) }],
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
  return showMenu([
    targetIsCurrent && { label: `Merge ${source.name} into ${cur}`, run: () => A.merge(ctx, source.name) },
    targetIsCurrent && { label: `Rebase ${cur} onto ${source.name}`, run: () => A.rebaseOnto(ctx, source.name) },
    targetIsCurrent && { label: `Interactive Rebase ${cur} onto ${source.name}`, run: () => A.startInteractiveRebase(ctx, source.name) },
    sourceIsCurrent && { label: `Merge ${target.name} into ${cur}`, run: () => A.merge(ctx, target.name) },
    sourceIsCurrent && { label: `Rebase ${cur} onto ${target.name}`, run: () => A.rebaseOnto(ctx, target.name) },
    sourceIsCurrent && { label: `Interactive Rebase ${cur} onto ${target.name}`, run: () => A.startInteractiveRebase(ctx, target.name) },
    target.kind === "local" && !targetIsCurrent && { label: `Fast-forward ${target.name} to ${source.name}`, run: () => A.fastForward(ctx, target, source.name) },
    source.kind === "local" && target.kind === "remote" && {
      label: `Push ${source.name} to ${target.name}`,
      run: () => A.pushTo(ctx, source.name, remote, rest.join("/")),
    },
  ]);
}

export async function multiMenu(ctx: Ctx, commits: Commit[]): Promise<void> {
  const n = commits.length;
  const shas = commits.map((c) => c.sha);
  const infos = await Promise.all(shas.map((sha) => A.rangeInfo(ctx.cwd, sha)));
  const allInHistory = infos.every((i) => i.ancestor && !i.hasMerges) && ctx.data.operation !== "rebase";
  await showMenu(
    groups(
      [{ label: `Cherry pick ${n} commits`, run: () => A.cherryPickMany(ctx, commits) }],
      allInHistory
        ? [
            { label: `Squash ${n} commits`, run: () => A.rewriteMany(ctx, shas, "squash") },
            { label: `Drop ${n} commits`, run: () => A.rewriteMany(ctx, shas, "drop") },
          ]
        : [],
      [{ label: "Copy commit shas", run: () => krill().copy(shas.join("\n")) }],
    ),
  );
}
