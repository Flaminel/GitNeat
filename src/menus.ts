import * as A from "./actions";
import { Ctx, RangeInfo } from "./actions";
import { krill } from "./api";
import { Commit, commitWebUrl, compareWebUrl, Ref, remoteWebUrl, Worktree } from "./repo";
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

function hideSolo(ctx: Ctx, full: string): MenuItem[] {
  return [
    { label: ctx.hidden.includes(full) ? "Show" : "Hide", run: () => ctx.toggleHidden(full) },
    { label: ctx.solo.includes(full) ? "Stop soloing" : "Solo", run: () => ctx.toggleSolo(full) },
  ];
}

function prItem(ctx: Ctx, branch: string, remoteName?: string): MenuItem {
  const remote = ctx.data.remotes.find((r) => r.name === remoteName) ?? ctx.data.remotes.find((r) => r.name === "origin") ?? ctx.data.remotes[0];
  const url = remote && compareWebUrl(remote.url, branch);
  return url && { label: `Start a pull request from ${branch}`, run: () => krill().openExternal(url) };
}

function branchGroups(ctx: Ctx, ref: Ref, info: RangeInfo, submenu: boolean): MenuItem[] {
  const cur = currentName(ctx);
  const local = ref.kind === "local";
  const isCurrent = !!ref.current;
  const commit = commitFor(ctx, ref.sha);
  const [remoteName, ...rest] = ref.name.split("/");
  const sameCommit = ref.sha === ctx.data.head;
  return groups(
    local
      ? [
          isCurrent && ref.upstream && { label: "Pull (fast-forward if possible)", run: () => A.pull(ctx, "ff") },
          { label: isCurrent ? "Push" : `Push ${ref.name}`, run: () => A.push(ctx, ref.name) },
          { label: "Set Upstream", run: () => A.setUpstream(ctx, ref) },
        ]
      : [],
    !isCurrent && !sameCommit && !!ctx.data.head
      ? [
          local && ref.upstream && (ref.behind ?? 0) > 0 && (ref.ahead ?? 0) === 0 && {
            label: `Fast-forward ${ref.name} to ${ref.upstream}`,
            run: () => A.fastForward(ctx, ref, ref.upstream as string),
          },
          { label: `Merge ${ref.name} into ${cur}`, run: () => A.merge(ctx, ref.name) },
          { label: `Rebase ${cur} onto ${ref.name}`, run: () => A.rebaseOnto(ctx, ref.name) },
          { label: `Interactive Rebase ${cur} onto ${ref.name}`, run: () => A.startInteractiveRebase(ctx, ref.name) },
        ]
      : [],
    [
      !isCurrent && {
        label: `Checkout ${ref.name}`,
        run: () => (local ? A.checkoutRef(ctx, ref.name) : A.checkoutRemote(ctx, ref.name)),
      },
    ],
    [
      !ref.worktree && { label: `Create worktree from ${ref.name}`, run: () => A.createWorktree(ctx, ref.sha, local ? ref.name : undefined) },
      ref.worktree && !isCurrent && { label: `Open worktree from ${ref.name}`, run: () => ctx.openTab(ref.worktree as string) },
    ],
    submenu ? [] : commitActions(ctx, commit, info, "branch"),
    rebaseActions(ctx, commit, info),
    [local ? prItem(ctx, ref.name, ref.upstream?.split("/")[0]) : prItem(ctx, rest.join("/"), remoteName)],
    local
      ? [
          { label: `Rename ${ref.name}`, run: () => A.renameBranch(ctx, ref.name) },
          !isCurrent && { label: `Delete ${ref.name}`, run: () => A.deleteBranch(ctx, ref) },
          !isCurrent && ref.upstream && { label: `Delete ${ref.name} and ${ref.upstream}`, run: () => A.deleteBranch(ctx, ref, true) },
        ]
      : [{ label: `Delete ${ref.name}`, run: () => A.deleteRemoteBranch(ctx, ref.name) }],
    [
      { label: "Copy branch name", run: () => krill().copy(ref.name) },
      { label: "Copy commit sha", run: () => krill().copy(ref.sha) },
    ],
    hideSolo(ctx, ref.full),
  );
}

export async function commitMenu(ctx: Ctx, commit: Commit): Promise<void> {
  if (commit.stash) {
    return stashMenu(ctx, commit.stash, commit.sha);
  }
  const info = await A.rangeInfo(ctx.cwd, commit.sha);
  const branches = ctx.data.refs.filter((r) => r.sha === commit.sha && r.kind !== "tag");
  if (branches.length === 1) {
    await showMenu([...branchGroups(ctx, branches[0], info, false), "-", ...tagActions(ctx, commit.sha)]);
    return;
  }
  await showMenu(
    groups(
      [{ label: "Checkout this commit", run: () => A.checkoutCommit(ctx, commit.sha) }],
      [{ label: "Create worktree from this commit", run: () => A.createWorktree(ctx, commit.sha) }],
      commitActions(ctx, commit, info, "commit"),
      rebaseActions(ctx, commit, info),
      branches.map((ref) => ({ label: ref.name, submenu: branchGroups(ctx, ref, info, true) })),
      branches.length === 0 ? copyActions(ctx, commit.sha) : [],
      tagActions(ctx, commit.sha),
    ),
  );
}

export async function refMenu(ctx: Ctx, ref: Ref): Promise<void> {
  if (ref.kind === "tag") {
    return tagMenu(ctx, ref);
  }
  const info = await A.rangeInfo(ctx.cwd, ref.sha);
  await showMenu(branchGroups(ctx, ref, info, false));
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

export function tagMenu(ctx: Ctx, ref: Ref): Promise<void> {
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
      hideSolo(ctx, ref.full),
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
  const isSelf = wt.path === ctx.cwd;
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
