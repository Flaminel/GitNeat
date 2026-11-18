import { FormEvent, useContext, useEffect, useMemo, useState } from "react";
import { gitneat, RepoSummary } from "../api";
import { PULL_OPTIONS, PullMode } from "../actions";
import {
  ALL,
  allRepos,
  countCaption,
  DEFAULT_GROUPS,
  FAVORITES,
  GroupPrefs,
  groupOrder,
  isDefaultGroup,
  matchRepo,
  newWorkspaceId,
  OPEN,
  RECENT,
  Workspace,
} from "../repoManagement";
import { LayoutContext, MenuItem, showMenu, useUi } from "../ui";
import { Icon } from "./icons";
import { repoLabel, repoName } from "./Tabs";

interface Props {
  open: string[];
  favorites: string[];
  recent: string[];
  aliases: Record<string, string>;
  workspaces: Workspace[];
  groups: Record<string, GroupPrefs>;
  prune: boolean;
  recurse: boolean;
  onOpenTabs(paths: string[]): void;
  onCloseRepos(paths: string[]): void;
  onFavorite(path: string): void;
  onRemoveRecent(paths: string[]): void;
  onWorkspaces(fn: (list: Workspace[]) => Workspace[]): void;
  onGroups(fn: (groups: Record<string, GroupPrefs>) => Record<string, GroupPrefs>): void;
  onOpenDialog(): void;
  onClone(): void;
  onInit(): void;
}

type Batch = "fetch" | "pull";

const COLORS = Array.from({ length: 10 }, (_, i) => i);
const WIP_KEY = "repoManagement.wip";

interface Group {
  id: string;
  name: string;
  repos: string[];
  workspace?: Workspace;
}

export function RepoManagement(props: Props) {
  const { open, favorites, recent, aliases, workspaces, groups } = props;
  const ui = useUi();
  const { layout, set: setLayout } = useContext(LayoutContext);
  const wip = layout[WIP_KEY] === true;
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState<Record<string, string[]>>({});
  const [synced, setSynced] = useState<Record<string, string[]>>({});
  const [summaries, setSummaries] = useState<Record<string, RepoSummary>>({});
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<Workspace | "new" | null>(null);

  const syncKey = workspaces.map((w) => `${w.id}=${w.syncPath ?? ""}`).join("\n");
  useEffect(() => {
    let live = true;
    void Promise.all(
      workspaces.filter((w) => w.syncPath).map(async (w) => [w.id, await gitneat().findRepos([w.syncPath!])] as const),
    ).then((pairs) => live && setSynced(Object.fromEntries(pairs)));
    return () => {
      live = false;
    };
  }, [syncKey, reload]);

  const workspaceRepos = (w: Workspace) => (w.syncPath ? (synced[w.id] ?? []) : w.repos);
  const failed = (path: string) => !!summaries[path]?.error;
  const everything = allRepos(open, favorites, recent, workspaces.map(workspaceRepos), failed);
  const key = [...everything, ...workspaces.flatMap(workspaceRepos)].join("\n");
  useEffect(() => {
    let live = true;
    const paths = [...new Set(key ? key.split("\n") : [])];
    setLoading(true);
    void gitneat()
      .repoSummaries(paths, wip)
      .then((list) => {
        if (live) {
          setSummaries(Object.fromEntries(list.map((s) => [s.path, s])));
          setLoading(false);
        }
      });
    return () => {
      live = false;
    };
  }, [key, wip, reload]);

  const byId = useMemo(() => Object.fromEntries(workspaces.map((w) => [w.id, w])), [workspaces]);
  const allGroups: Group[] = groupOrder(workspaces).map((id) => {
    if (id === OPEN) {
      return { id, name: DEFAULT_GROUPS[id], repos: open };
    }
    if (id === FAVORITES) {
      return { id, name: DEFAULT_GROUPS[id], repos: favorites };
    }
    if (id === RECENT) {
      return { id, name: DEFAULT_GROUPS[id], repos: recent };
    }
    if (id === ALL) {
      return { id, name: DEFAULT_GROUPS[id], repos: everything };
    }
    return { id, name: byId[id].name, repos: workspaceRepos(byId[id]), workspace: byId[id] };
  });
  const hiddenGroups = allGroups.filter((g) => groups[g.id]?.hidden);
  const setGroup = (id: string, prefs: GroupPrefs) => props.onGroups((all) => ({ ...all, [id]: { ...all[id], ...prefs } }));
  const label = (path: string) => repoLabel(path, aliases);

  const runBatch = async (kind: Batch, paths: string[], mode?: PullMode) => {
    const usable = paths.filter((p) => !summaries[p]?.error);
    if (!usable.length) {
      ui.toast(kind === "fetch" ? "No repositories to fetch" : "No repositories to pull", "error");
      return;
    }
    const errors: { path: string; message: string }[] = [];
    const pullMode = mode && mode !== "fetch" ? mode : "ff";
    await ui.task(`${kind === "fetch" ? "Fetching" : "Pulling"} ${usable.length} ${usable.length === 1 ? "repository" : "repositories"}`, async () => {
      for (const path of usable) {
        const remote = summaries[path]?.remote;
        try {
          if (!remote) {
            throw new Error("Could not find a remote");
          }
          if (kind === "fetch") {
            await gitneat().action(path, "fetchRemote", { name: remote, prune: props.prune, recurse: props.recurse });
          } else {
            await gitneat().action(path, "pull", { mode: pullMode, prune: props.prune, recurse: props.recurse });
          }
        } catch (error) {
          errors.push({ path, message: error instanceof Error ? error.message : String(error) });
        }
      }
    });
    if (errors.length) {
      const verb = kind === "fetch" ? "fetch" : "pull";
      ui.toast(`Repository "${label(errors[0].path)}" had the following error: ${errors[0].message}`, "error", `GitNeat could not ${verb} ${errors.length} repositories`);
    } else {
      ui.toast(`GitNeat successfully ${kind === "fetch" ? "fetched" : "pulled"} ${usable.length} repositories`);
    }
    setReload((n) => n + 1);
  };

  const pullMenu = (paths: string[]) =>
    showMenu(PULL_OPTIONS.map((o) => ({ label: o.label, run: () => (o.mode === "fetch" ? runBatch("fetch", paths) : runBatch("pull", paths, o.mode)) })));

  const defaultPull = (): PullMode => {
    const stored = layout["pull.default"];
    return PULL_OPTIONS.some((o) => o.mode === stored) ? (stored as PullMode) : "ff";
  };

  const removeFromWorkspace = (w: Workspace, paths: string[]) =>
    props.onWorkspaces((list) => list.map((x) => (x.id === w.id ? { ...x, repos: x.repos.filter((p) => !paths.includes(p)) } : x)));

  const addToWorkspace = async (w: Workspace) => {
    const dirs = await gitneat().pickDirectories();
    if (!dirs.length) {
      return;
    }
    const found = await gitneat().findRepos(dirs);
    if (!found.length) {
      ui.toast(`The following repositories could not be added to the workspace: ${dirs.join(", ")}`, "error", "Failed to add repositories");
      return;
    }
    props.onWorkspaces((list) => list.map((x) => (x.id === w.id ? { ...x, repos: [...x.repos, ...found.filter((p) => !x.repos.includes(p))] } : x)));
  };

  const deleteWorkspace = async (w: Workspace) => {
    const v = await ui.prompt(
      "Delete Workspace",
      [{ name: "name", label: `Please type the name of your workspace ${w.name} to confirm`, placeholder: "Name of the workspace" }],
      "Delete Workspace",
      `Are you sure you want to DELETE this workspace?\nTHIS ACTION CANNOT BE UNDONE. This will permanently delete the ${w.name} workspace`,
    );
    if (!v || v.name.trim() !== w.name) {
      return;
    }
    props.onWorkspaces((list) => list.filter((x) => x.id !== w.id));
    props.onGroups(({ [w.id]: _, ...rest }) => rest);
    ui.toast(`Workspace ${w.name} deleted successfully.`);
  };

  const colorMenu = (id: string): MenuItem => ({
    label: "Change color",
    submenu: [
      { label: "Default", run: () => setGroup(id, { color: undefined }) },
      ...COLORS.map((c) => ({ label: `Color ${c + 1}`, run: () => setGroup(id, { color: c }) })),
    ],
  });

  const groupMenu = (g: Group, selected: string[]) => {
    const n = selected.length;
    const total = g.repos.length;
    const usable = selected.filter((p) => !failed(p));
    const w = g.workspace;
    const items: MenuItem[] = [
      { label: "Hide", run: () => setGroup(g.id, { hidden: true }) },
      g.id !== ALL && { label: "Select All", enabled: total > 0, run: () => setChecked((c) => ({ ...c, [g.id]: [...g.repos] })) },
      g.id !== ALL && { label: "Unselect All", enabled: total > 0, run: () => setChecked((c) => ({ ...c, [g.id]: [] })) },
      g.id !== OPEN && {
        label: countCaption(usable.length, total, "Open repository", "Open all repos in new tabs", "Open {0} repositories"),
        enabled: usable.length > 0,
        run: () => openAll(g.id, usable),
      },
      g.id === OPEN && { label: countCaption(n, total, "Close repository", "Close all tabs", "Close {0} repositories"), enabled: n > 0, run: () => props.onCloseRepos(selected) },
      g.id === RECENT && { label: countCaption(n, total, "Remove repository", "Remove all", "Remove {0} repositories"), enabled: n > 0, run: () => props.onRemoveRecent(selected) },
      w && "-",
      w && { label: "Add repositories", enabled: !w.syncPath, run: () => void addToWorkspace(w) },
      w && { label: countCaption(n, total, "Remove repository", "Remove all repositories", "Remove {0} repositories"), enabled: n > 0 && !w.syncPath, run: () => removeFromWorkspace(w, selected) },
      w && { label: "Edit Workspace", run: () => setEditing(w) },
      w && { label: "Delete Workspace", run: () => void deleteWorkspace(w) },
      "-",
      colorMenu(g.id),
    ];
    void showMenu(items);
  };

  const openAll = (id: string, paths: string[]) => {
    props.onOpenTabs(paths);
    setChecked((c) => ({ ...c, [id]: [] }));
  };

  const rowMenu = (g: Group, path: string) => {
    const broken = failed(path);
    const w = g.workspace;
    void showMenu([
      { label: "Open repository", enabled: !broken, run: () => props.onOpenTabs([path]) },
      { label: "Fetch repository", enabled: !broken, run: () => void runBatch("fetch", [path]) },
      { label: "Pull repository", enabled: !broken, run: () => void runBatch("pull", [path], defaultPull()) },
      "-",
      { label: favorites.includes(path) ? "Remove repository from favorites" : "Add repository to favorites", run: () => props.onFavorite(path) },
      g.id === OPEN && { label: "Close repository", run: () => props.onCloseRepos([path]) },
      g.id === RECENT && { label: "Remove repository", run: () => props.onRemoveRecent([path]) },
      w && { label: "Remove repository", enabled: !w.syncPath, run: () => removeFromWorkspace(w, [path]) },
    ]);
  };

  const toggleCheck = (id: string, path: string, on: boolean) =>
    setChecked((c) => ({ ...c, [id]: on ? [...(c[id] ?? []), path] : (c[id] ?? []).filter((p) => p !== path) }));

  const branchText = (s: RepoSummary | undefined) => {
    if (!s) {
      return "";
    }
    if (s.error) {
      return s.error;
    }
    const parts = [s.branch ?? "(detached HEAD)"];
    if (s.upstream) {
      parts.push(`${s.upstream}${s.behind ? ` ↓${s.behind}` : ""}${s.ahead ? ` ↑${s.ahead}` : ""}`);
    }
    if (s.changes !== null) {
      parts.push(s.changes ? `${s.changes} ${s.changes === 1 ? "change" : "changes"}${s.conflicts ? `, ${s.conflicts} conflicted` : ""}` : "No changes");
    }
    return parts.join(" · ");
  };

  const renderGroup = (g: Group) => {
    const prefs = groups[g.id] ?? {};
    const shown = g.repos.filter((p) => matchRepo(label(p), query));
    if (prefs.hidden || (query && !shown.length)) {
      return null;
    }
    const collapsed = !query && !!prefs.collapsed;
    const mine = (checked[g.id] ?? []).filter((p) => g.repos.includes(p));
    const selected = mine.length ? mine : g.repos;
    const usable = selected.filter((p) => !failed(p));
    const color = prefs.color === undefined ? undefined : `var(--lane-${prefs.color})`;
    const fetchCaption = usable.length ? countCaption(usable.length, g.repos.length, "Fetch repository", "Fetch all repositories", "Fetch {0} repositories") : "No repositories to fetch";
    const pullCaption = usable.length ? countCaption(usable.length, g.repos.length, "Pull repository", "Pull all repositories", "Pull {0} repositories") : "No repositories to pull";
    return (
      <section key={g.id} className="rm-group" style={color ? { borderLeftColor: color } : undefined}>
        <header className="rm-group-header" onClick={() => !query && setGroup(g.id, { collapsed: !collapsed })}>
          <span className={`rm-caret${collapsed ? "" : " open"}`}>▸</span>
          <span className="rm-group-title" style={color ? { color } : undefined}>
            {g.name}
          </span>
          <span className="rm-badge">{g.repos.length}</span>
          {g.workspace?.syncPath && <span className="rm-sync" title={g.workspace.syncPath}>Local - synced</span>}
          <span className="rm-fill" />
          <span className="rm-tools" onClick={(e) => e.stopPropagation()}>
            <button disabled={!usable.length || !!ui.busy} title={fetchCaption} onClick={() => void runBatch("fetch", usable)}>
              Fetch
            </button>
            <span className="rm-split">
              <button disabled={!usable.length || !!ui.busy} title={pullCaption} onClick={() => void runBatch("pull", usable, defaultPull())}>
                {Icon.pull} Pull
              </button>
              <button className="rm-caret-btn" disabled={!usable.length || !!ui.busy} title="Select a default pull/fetch operation to execute when clicking this button" onClick={() => void pullMenu(usable)}>
                ▾
              </button>
            </span>
            <button className="rm-icon" title="More options" onClick={() => groupMenu(g, mine)}>
              {Icon.more}
            </button>
          </span>
        </header>
        {!collapsed && (
          <div className="rm-rows">
            {shown.length === 0 && <div className="rm-empty">{g.workspace && !g.workspace.syncPath ? "No repositories. Use Add repositories in the menu." : "No repositories"}</div>}
            {shown.map((p) => {
              const s = summaries[p];
              const broken = !!s?.error;
              return (
                <div
                  key={p}
                  className={`rm-row${broken ? " missing" : ""}`}
                  title={p}
                  onClick={() => !broken && props.onOpenTabs([p])}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    rowMenu(g, p);
                  }}
                >
                  <button
                    className={`rm-star${favorites.includes(p) ? " on" : ""}`}
                    title={favorites.includes(p) ? "Remove repository from favorites" : "Add repository to favorites"}
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onFavorite(p);
                    }}
                  >
                    {Icon.star}
                  </button>
                  {g.id !== ALL && (
                    <input type="checkbox" checked={mine.includes(p)} onClick={(e) => e.stopPropagation()} onChange={(e) => toggleCheck(g.id, p, e.target.checked)} />
                  )}
                  <span className="rm-name">{label(p)}</span>
                  <span className="rm-remote" title={s?.remoteUrl ?? undefined}>
                    {s?.remote ? `${s.remote}${s.remoteUrl ? ` (${s.remoteUrl})` : ""}` : ""}
                  </span>
                  <span className="rm-branch">{branchText(s)}</span>
                  {g.id === OPEN && (
                    <button
                      className="rm-icon"
                      title="Close repository"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onCloseRepos([p]);
                      }}
                    >
                      ×
                    </button>
                  )}
                  <button
                    className="rm-icon"
                    title="More options"
                    onClick={(e) => {
                      e.stopPropagation();
                      rowMenu(g, p);
                    }}
                  >
                    {Icon.more}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  };

  const anyCollapsed = allGroups.some((g) => !groups[g.id]?.hidden && !groups[g.id]?.collapsed);
  const shownGroups = allGroups.map(renderGroup).filter(Boolean);

  return (
    <div className="repo-management">
      <div className="rm-toolbar">
        <h2>Repository Management</h2>
        <input className="rm-search" placeholder="Search repositories" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQuery("")} />
        <label className="check" title="Display WIP summary for all repos. Note: large repos may take longer to load this data.">
          <input type="checkbox" checked={wip} onChange={(e) => setLayout(WIP_KEY, e.target.checked)} />
          WIP summary
        </label>
        <span className="rm-fill" />
        {loading && <span className="rm-loading">Loading…</span>}
        <button onClick={() => setEditing("new")}>New Workspace</button>
        <button onClick={props.onOpenDialog}>Browse</button>
        <button onClick={props.onClone}>Clone</button>
        <button onClick={props.onInit}>Init</button>
        <button
          disabled={!!query}
          onClick={() => props.onGroups((all) => Object.fromEntries(allGroups.map((g) => [g.id, { ...all[g.id], collapsed: anyCollapsed }])))}
        >
          {anyCollapsed ? "Collapse" : "Expand"}
        </button>
        <button
          disabled={!hiddenGroups.length}
          title={hiddenGroups.length === 1 ? "1 group is hidden" : `${hiddenGroups.length} groups are hidden`}
          onClick={() =>
            void showMenu([
              ...hiddenGroups.map((g) => ({ label: g.name, run: () => setGroup(g.id, { hidden: false }) })),
              "-",
              { label: "Unhide all", run: () => props.onGroups((all) => Object.fromEntries(Object.entries(all).map(([id, p]) => [id, { ...p, hidden: false }]))) },
            ])
          }
        >
          {Icon.eyeOff} {hiddenGroups.length}
        </button>
        <button
          className="rm-icon"
          title="More options"
          onClick={() =>
            void showMenu([
              {
                label: "Reset all workspaces to default color",
                run: () => {
                  props.onGroups((all) => Object.fromEntries(Object.entries(all).map(([id, p]) => [id, isDefaultGroup(id) ? p : { ...p, color: undefined }])));
                  ui.toast("All workspaces groups successfully reset to default color");
                },
              },
              {
                label: "Reset all default groups to default color",
                run: () => {
                  props.onGroups((all) => Object.fromEntries(Object.entries(all).map(([id, p]) => [id, isDefaultGroup(id) ? { ...p, color: undefined } : p])));
                  ui.toast("All default groups successfully reset to default color");
                },
              },
            ])
          }
        >
          {Icon.more}
        </button>
      </div>
      <div className="rm-groups">
        {shownGroups.length ? shownGroups : <div className="rm-empty">{query ? "No results found" : "All repository groups are hidden. Use the hidden groups button to un-hide groups."}</div>}
      </div>
      {editing && (
        <WorkspaceModal
          workspace={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(w) => {
            props.onWorkspaces((list) => (list.some((x) => x.id === w.id) ? list.map((x) => (x.id === w.id ? w : x)) : [...list, w]));
            ui.toast(editing === "new" ? "Workspace created successfully." : "Workspace updated successfully.");
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function WorkspaceModal({ workspace, onClose, onSave }: { workspace: Workspace | null; onClose(): void; onSave(w: Workspace): void }) {
  const [name, setName] = useState(workspace?.name ?? "");
  const [description, setDescription] = useState(workspace?.description ?? "");
  const [sync, setSync] = useState(!!workspace?.syncPath);
  const [syncPath, setSyncPath] = useState(workspace?.syncPath ?? "");
  const [repos, setRepos] = useState<string[]>(workspace?.repos ?? []);
  const browse = async (pick: () => Promise<string[]>) => {
    const dirs = await pick();
    if (!dirs.length) {
      return;
    }
    const found = await gitneat().findRepos(dirs);
    setRepos((list) => [...list, ...found.filter((p) => !list.includes(p))]);
  };
  const valid = !!name.trim() && (!sync || !!syncPath.trim());
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) {
      return;
    }
    onSave({
      id: workspace?.id ?? newWorkspaceId(),
      name: name.trim(),
      description: description.trim(),
      repos: sync ? [] : repos,
      ...(sync ? { syncPath: syncPath.trim() } : {}),
    });
  };
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="modal rm-modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <h3>{workspace ? "Edit Workspace" : "Create a Workspace"}</h3>
        {!workspace && (
          <p className="modal-message">Local Workspaces give you quick access to repos you use the most on this machine, display statuses like current branch and commits ahead/behind, allow multi-repo Git actions, and more!</p>
        )}
        <label className="field">
          <span>Workspace Name *</span>
          <input autoFocus value={name} placeholder="Name of the workspace" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Description</span>
          <input value={description} placeholder="Describe the purpose of the workspace" onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="check" title="Select a directory that contains repos to create a local synced Workspace">
          <input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} />
          Sync with local directory
        </label>
        {sync ? (
          <div className="field">
            <span>Select the directory you keep your repos to sync with your Local Workspace</span>
            <div className="path-row">
              <input value={syncPath} spellCheck={false} onChange={(e) => setSyncPath(e.target.value)} />
              <button type="button" onClick={() => void gitneat().pickDirectory().then((d) => d && setSyncPath(d))}>
                Browse for Directory
              </button>
            </div>
            <small className="field-help">Any repos you add to the selected directory will automatically be added to the workspace</small>
          </div>
        ) : (
          <div className="field">
            <span>Select individual repos, a directory of repos, or an existing VS Code Workspace (.code-workspace)</span>
            <div className="path-row">
              <button type="button" title="Browse your machine for repos to add to this Workspace" onClick={() => void browse(gitneat().pickDirectories)}>
                Browse Repositories
              </button>
              <button type="button" onClick={() => void browse(gitneat().importCodeWorkspace)}>
                Import VS Code Workspace
              </button>
              <button type="button" disabled={!repos.length} onClick={() => setRepos([])}>
                Clear current selection
              </button>
            </div>
            <div className="rm-picked">
              {repos.map((p) => (
                <div key={p} title={p}>
                  <b>{repoName(p)}</b> <span>{p}</span>
                  <button type="button" className="recent-remove" title="Remove repository" onClick={() => setRepos((list) => list.filter((x) => x !== p))}>
                    ×
                  </button>
                </div>
              ))}
            </div>
            <small className="field-help">{repos.length === 1 ? "1 repository will be added to this workspace" : `${repos.length} repositories will be added to this workspace`}</small>
          </div>
        )}
        <div className="modal-buttons">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!valid}>
            {workspace ? "Save Changes" : "Create Local Workspace"}
          </button>
        </div>
      </form>
    </div>
  );
}
