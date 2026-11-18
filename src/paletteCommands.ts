import * as A from "./actions";
import { Ctx } from "./actions";
import { gitneat } from "./api";
import type { OpenFile } from "./components/DetailPanel";
import { Command, commitItems, DOMAIN_LABELS, Domain, fileItems, Item, refItems, Situation, workingFiles } from "./palette";
import { loadAllFiles } from "./repo";
import { repoLabel } from "./components/Tabs";

export interface RepoApi {
  ctx: Ctx;
  undo(): unknown;
  redo(): unknown;
  canUndo: boolean;
  canRedo: boolean;
  select(sha: string): void;
  showWip(): void;
  openFile(file: OpenFile): void;
  toggleLeft(): void;
  toggleDetails(): void;
  openInTool(): unknown;
  editFile(path: string): void;
  createFile(path: string): unknown;
}

export interface AppApi {
  newTab(): void;
  clone(): unknown;
  init(): unknown;
  closeTab(): void;
  preferences(): unknown;
  zoom(step: number): void;
  toggleSetting(key: "toolbarLabels" | "syntaxHighlighting"): void;
  openRepo(path: string): void;
  recent: string[];
  favorites: string[];
  aliases: Record<string, string>;
}

let current: RepoApi | null = null;

export const setRepoApi = (api: RepoApi | null) => {
  current = api;
};

export const getRepoApi = (): RepoApi | null => current;

export const situation = (repo: RepoApi | null): Situation => ({
  hasRepo: !!repo,
  detached: !!repo && !repo.ctx.data.branch,
  busy: !!repo && repo.ctx.data.operation === "rebase",
});

function command(id: string, label: string, run: () => unknown, extra: Partial<Command> = {}): Command {
  return { id, label, run, ...extra };
}

export function buildCommands(app: AppApi, repo: RepoApi | null): Command[] {
  const ctx = repo?.ctx;
  const r = { repo: true };
  const live = { repo: true, busy: false };
  const attached = { repo: true, busy: false, detached: false };
  const need = <T,>(fn: (repo: RepoApi, ctx: Ctx) => T) => () => (repo && ctx ? fn(repo, ctx) : undefined);
  const domains: Command[] = (["blame", "checkout", "deleteFile", "editFile", "history", "openFile", "openRepo", "searchCommits", "viewFile"] as const).map((domain) => ({
    id: `domain-${domain}`,
    label: DOMAIN_LABELS[domain],
    domain,
    flags: domain === "openRepo" ? {} : domain === "checkout" ? live : r,
  }));
  return [
    ...domains,
    command("undo", "Undo", need((p) => p.undo()), { flags: live }),
    command("redo", "Redo", need((p) => p.redo()), { flags: live }),
    command("pull", "Pull", need((_, c) => A.pull(c, A.pullDefault(c))), { flags: attached }),
    command("push", "Push", need((_, c) => A.push(c)), { flags: attached }),
    command("fetchAll", "Fetch All", need((_, c) => A.pull(c, "fetch")), { flags: r }),
    command("createBranch", "Create Branch", need((_, c) => c.data.head && A.createBranch(c, "HEAD")), { hidden: "Branch", flags: live }),
    command("renameBranch", "Rename Branch", need((_, c) => c.data.branch && A.renameBranch(c, c.data.branch)), { flags: attached }),
    command("createTag", "Create Tag", need((_, c) => c.data.head && A.createTag(c, c.data.head, false)), { hidden: "Tag", flags: live }),
    command("createAnnotatedTag", "Create Annotated Tag", need((_, c) => c.data.head && A.createTag(c, c.data.head, true)), { hidden: "Annotated Tag", flags: live }),
    command("createStash", "Create", need((_, c) => c.data.status.length && A.stashSave(c)), { prefix: "Stash: ", hidden: "Stash", flags: live }),
    command("popStash", "Pop", need((_, c) => c.data.stashes.length && A.stashPop(c)), { prefix: "Stash: ", hidden: "Stash", flags: live }),
    command("applyStash", "Apply", need((_, c) => c.data.stashes.length && A.stashApply(c)), { prefix: "Stash: ", hidden: "Stash", flags: live }),
    command("stageAll", "Stage all changes", need((_, c) => A.stageAll(c)), { flags: r }),
    command("unstageAll", "Unstage all changes", need((_, c) => A.unstageAll(c)), { flags: r }),
    command("unstageAllAndReset", "Discard all changes", need((_, c) => A.discardAll(c)), { hidden: "reset hard all", flags: live }),
    command("exportToPatch", "Create patch from all working directory changes", need((_, c) => A.savePatchWork(c, c.data.status.map((s) => s.path))), { flags: r }),
    command("applyPatch", "Apply patch", need((_, c) => A.openAndApplyPatch(c)), { flags: live }),
    command("openFileInExternalView", "Open in External Diff/Merge Tool", need((p) => p.openInTool()), { flags: r }),
    command("openRepo", "Open Repository Management Tab", app.newTab),
    command("cloneRepo", "Clone", app.clone),
    command("initRepo", "Initialize a Repo", app.init, { hidden: "initialize" }),
    command("openInFileManager", "Open in File Manager", need((_, c) => gitneat().openPath(c.cwd)), { hidden: "folder explorer finder", flags: r }),
    command("openInTerminal", "Open in default terminal", need((_, c) => gitneat().openTerminal(c.cwd)), { hidden: "in-app terminal command line console", flags: r }),
    command("closeRepo", "Close Tab", app.closeTab),
    command("settings", "Settings", app.preferences, { hidden: "preferences options" }),
    command("viewWorkingDirChanges", "View Working Directory Changes", need((p, c) => c.data.status.length && p.showWip()), { hidden: "changes wip workdir working", flags: r }),
    command("createFile", "Create File", () => undefined, { domain: "createFile", hidden: "create new file", flags: r }),
    command("runRepoMaintenance", "Perform Repo Maintenance", need((_, c) => A.runMaintenance(c)), { flags: r }),
    command("startPullRequest", "Start Pull Request", need((_, c) => A.startPullRequest(c)), { hidden: "New Create Pull Request", flags: live }),
    command("toggleToolbarLabels", "Toggle Toolbar Labels", () => app.toggleSetting("toolbarLabels")),
    command("toggleSyntaxHighlighting", "Toggle Syntax Highlighting", () => app.toggleSetting("syntaxHighlighting")),
    command("toggleLeftPanel", "Toggle Left Panel", need((p) => p.toggleLeft()), { flags: r }),
    command("toggleDetailPanel", "Toggle Commit Details Panel", need((p) => p.toggleDetails()), { flags: r }),
    command("zoomUp", "Increase Zoom", () => app.zoom(1)),
    command("zoomDown", "Decrease Zoom", () => app.zoom(-1)),
    command("zoomReset", "Reset Zoom", () => app.zoom(0)),
  ];
}

export async function domainItems(domain: Domain, app: AppApi, repo: RepoApi | null): Promise<Item[]> {
  const ctx = repo?.ctx;
  if (domain === "openRepo") {
    const paths = [...new Set([...app.favorites, ...app.recent])];
    return paths.map((p) => ({ id: `openRepo-${p}`, label: p, alias: repoLabel(p, app.aliases), run: () => app.openRepo(p) }));
  }
  if (!repo || !ctx) {
    return [];
  }
  if (domain === "checkout") {
    return refItems(ctx.data.refs, (ref) => (ref.kind === "remote" ? A.checkoutRemote(ctx, ref.name) : A.checkoutRef(ctx, ref.name)));
  }
  if (domain === "searchCommits") {
    return commitItems(ctx.data.commits, (c) => repo.select(c.sha));
  }
  if (domain === "editFile" || domain === "openFile" || domain === "viewFile" || domain === "deleteFile") {
    const head = ctx.data.head;
    const tracked = head ? await loadAllFiles(ctx.cwd, head) : [];
    const run = domain === "deleteFile" ? (path: string) => A.deleteFile(ctx, path) : (path: string) => repo.editFile(path);
    return fileItems(workingFiles(tracked, ctx.data.status), run);
  }
  if (domain === "blame" || domain === "history") {
    const head = ctx.data.head;
    if (!head) {
      return [];
    }
    const files = await loadAllFiles(ctx.cwd, head);
    return fileItems(files, (path) => repo.openFile({ source: { kind: "commit", sha: head }, path, view: domain }));
  }
  return [];
}
