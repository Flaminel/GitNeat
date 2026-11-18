import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as A from "./actions";
import { Ctx, TodoEntry, UndoEntry } from "./actions";
import { gitneat } from "./api";
import { DetailPanel, OpenFile } from "./components/DetailPanel";
import { DiffView } from "./components/DiffView";
import { GraphView, SelectMode, WIP } from "./components/GraphView";
import { MergeView } from "./components/MergeView";
import { RebaseModal } from "./components/RebaseModal";
import { Sidebar } from "./components/Sidebar";
import { Toolbar } from "./components/Toolbar";
import * as M from "./menus";
import { setRepoApi } from "./paletteCommands";
import { Commit, Lanes, loadCommits, loadRepo, RepoData, samePath } from "./repo";
import { canLoadMore, pageSize, showsFooter } from "./commitLimit";
import { LayoutContext, Splitter, useStoredFlag, useStoredWidth, useUi } from "./ui";

export interface RepoPrefs {
  hidden: string[];
  solo: string[];
  closed?: string[];
  openSections?: string[];
  sectionYsByKey?: Record<string, number>;
  commitDefaults?: CommitDefaults;
  autoUpdateSubmodules?: SubmoduleAutoUpdate;
}

export type SubmoduleAutoUpdate = "default" | "enabled" | "disabled";

export interface CommitDefaults {
  push: boolean;
  skipHooks: boolean;
}

export interface Settings {
  autoFetch: number;
  lazyLoad: boolean;
  maxCommits: number;
  autoPrune: boolean;
  defaultBranch: string;
  rememberTabs: boolean;
  toolbarLabels: boolean;
  syntaxHighlighting: boolean;
  autoUpdateSubmodules: boolean;
}

export const DEFAULT_SETTINGS: Settings = { autoFetch: 1, lazyLoad: true, maxCommits: 2000, autoPrune: true, defaultBranch: "", rememberTabs: true, toolbarLabels: true, syntaxHighlighting: true, autoUpdateSubmodules: true };
export const MAX_COMMITS_MIN = 500;
export const AUTO_FETCH_MAX = 60;

interface Props {
  path: string;
  settings: Settings;
  onPreferences(): void;
  prefs: RepoPrefs;
  setPrefs(prefs: Partial<RepoPrefs>): void;
  mainSections(mainPath: string): Partial<RepoPrefs> | undefined;
  openTab(path: string): void;
  recent: string[];
  favorites: string[];
  aliases: Record<string, string>;
  onViewAll(): void;
  onPalette(): void;
}

interface Cached {
  data: RepoData;
  selected: string | null;
  multi: string[];
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];
}

const DEFAULT_SECTIONS = ["LOCAL", "REMOTE"];

const cache = new Map<string, Cached>();

export function forgetRepos(open: string[]) {
  for (const key of [...cache.keys()]) {
    if (!open.includes(key)) {
      cache.delete(key);
    }
  }
}

function toggle(list: string[], item: string): string[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export function RepoView({ path, settings, onPreferences, prefs, setPrefs, mainSections, openTab, recent, favorites, aliases, onViewAll, onPalette }: Props) {
  const ui = useUi();
  const { layout, set: setLayout } = useContext(LayoutContext);
  const cached = cache.get(path);
  const [data, setData] = useState<RepoData | null>(cached?.data ?? null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(cached?.selected ?? null);
  const [multi, setMulti] = useState<string[]>(cached?.multi ?? []);
  const [openFile, setOpenFile] = useState<OpenFile | null>(null);
  const [rebase, setRebase] = useState<{ base: string | null; entries: TodoEntry[] } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>(cached?.undoStack ?? []);
  const [redoStack, setRedoStack] = useState<UndoEntry[]>(cached?.redoStack ?? []);
  const closed = prefs.closed ?? [];
  const openSections = prefs.openSections ?? DEFAULT_SECTIONS;
  const [leftWidth, setLeftWidth] = useStoredWidth("left", 296);
  const [leftCollapsed, setLeftCollapsed] = useStoredFlag("left.collapsed", false);
  const [rightCollapsed, setRightCollapsed] = useStoredFlag("right.collapsed", false);
  const [rightWidth, setRightWidth] = useStoredWidth("right", Math.max(380, Math.round(window.innerWidth * 0.325)));

  const loadSeq = useRef(0);
  const limit = useRef(settings.maxCommits);
  const loadingMore = useRef(false);
  const loadedSeq = useRef(-1);
  const lanes = useRef<Lanes>([]);
  const [hasMore, setHasMore] = useState(true);
  const [shown, setShown] = useState(selected);
  const held = useRef(false);
  const copied = useRef(false);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const next = await loadRepo(path, prefs.hidden, prefs.solo, limit.current);
      if (seq !== loadSeq.current) {
        return;
      }
      loadedSeq.current = seq;
      lanes.current = next.lanes;
      setHasMore(canLoadMore(settings.lazyLoad, next.commits.filter((c) => !c.stash).length, limit.current));
      setData(next);
      setMulti((list) => list.filter((sha) => (sha === WIP ? next.status.length > 0 : next.commits.some((c) => c.sha === sha))));
      setSelected((s) => (s && s !== WIP && !next.commits.some((c) => c.sha === s) ? next.head : s));
      setError(null);
      setRefreshKey((k) => k + 1);
      setSelected((s) => s ?? (next.status.length ? WIP : next.head));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [path, prefs.hidden, prefs.solo, settings.lazyLoad]);

  useEffect(() => {
    limit.current = settings.maxCommits;
    void load();
  }, [load, settings.maxCommits]);

  const loadMore = useCallback(async () => {
    const seq = loadSeq.current;
    if (loadingMore.current || loadedSeq.current !== seq) {
      return;
    }
    const step = pageSize(limit.current);
    if (!step) {
      return;
    }
    loadingMore.current = true;
    try {
      const page = await loadCommits(path, prefs.hidden, prefs.solo, limit.current, step, lanes.current);
      if (seq !== loadSeq.current) {
        return;
      }
      limit.current += step;
      lanes.current = page.lanes;
      setHasMore(canLoadMore(settings.lazyLoad, page.commits.filter((c) => !c.stash).length + limit.current - step, limit.current));
      setData((d) => d && { ...d, commits: [...d.commits, ...page.commits], rows: [...d.rows, ...page.rows], lanes: page.lanes });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      loadingMore.current = false;
    }
  }, [path, prefs.hidden, prefs.solo, settings.lazyLoad]);

  useEffect(() => {
    if (!data || copied.current) {
      return;
    }
    copied.current = true;
    const self = data.worktrees.find((w) => samePath(w.path, path));
    const main = data.worktrees.find((w) => w.main);
    const copy = self && !self.main && main ? mainSections(main.path) : undefined;
    if (copy) {
      setPrefs(copy);
    }
  }, [data, path, mainSections, setPrefs]);

  useEffect(() => {
    void gitneat().watch(path);
    const off = gitneat().onRepoChanged((cwd) => {
      if (cwd === path) {
        void load();
      }
    });
    return () => {
      off();
      void gitneat().unwatch(path);
    };
  }, [path, load]);

  useEffect(() => {
    if (settings.autoFetch <= 0) {
      return;
    }
    let running = false;
    const timer = setInterval(async () => {
      if (running) {
        return;
      }
      running = true;
      await A.autoFetch(path, settings.autoPrune, settings.autoUpdateSubmodules);
      running = false;
      void load();
    }, settings.autoFetch * 60000);
    return () => clearInterval(timer);
  }, [path, settings.autoFetch, settings.autoPrune, load]);

  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const commits = useMemo<Commit[]>(() => {
    if (!data) {
      return [];
    }
    if (data.status.length === 0) {
      return data.commits;
    }
    const wip: Commit = { sha: WIP, parents: data.head ? [data.head] : [], author: "", email: "", time: Date.now() / 1000, subject: "" };
    return [wip, ...data.commits];
  }, [data]);

  const rows = data?.rows ?? [];

  const ctx = useMemo<Ctx | null>(
    () =>
      data && {
        cwd: path,
        data,
        ui,
        refresh: () => void load(),
        openTab,
        openRebase: (base, entries) => setRebase({ base, entries }),
        toggleHidden: (full) => setPrefs({ hidden: toggle(prefs.hidden, full), solo: prefs.solo }),
        setHidden: (fulls, hide) =>
          setPrefs({
            hidden: hide ? [...prefs.hidden, ...fulls.filter((f) => !prefs.hidden.includes(f))] : prefs.hidden.filter((f) => !fulls.includes(f)),
            solo: prefs.solo,
          }),
        setSolo: (fulls, on) =>
          setPrefs({
            hidden: prefs.hidden,
            solo: on ? [...prefs.solo, ...fulls.filter((f) => !prefs.solo.includes(f))] : prefs.solo.filter((f) => !fulls.includes(f)),
          }),
        toggleSolo: (full) => setPrefs({ hidden: prefs.hidden, solo: toggle(prefs.solo, full) }),
        hidden: prefs.hidden,
        solo: prefs.solo,
        prune: settings.autoPrune,
        autoUpdateSubmodules: prefs.autoUpdateSubmodules === "enabled" || (prefs.autoUpdateSubmodules !== "disabled" && settings.autoUpdateSubmodules),
        commitDefaults: prefs.commitDefaults ?? { push: false, skipHooks: false },
        layout,
        setLayout,
        record: (entry) => {
          setUndoStack((list) => [...list.slice(-49), entry]);
          setRedoStack([]);
        },
      },
    [data, path, ui, load, openTab, prefs, setPrefs, layout, setLayout, settings.autoPrune, settings.autoUpdateSubmodules],
  );

  const undo = async () => {
    const entry = undoStack[undoStack.length - 1];
    if (ctx && entry && (await A.undo(ctx, entry))) {
      setUndoStack((list) => list.filter((x) => x !== entry));
      setRedoStack((list) => [...list, entry]);
    }
  };

  const redo = async () => {
    const entry = redoStack[redoStack.length - 1];
    if (ctx && entry && (await A.redo(ctx, entry))) {
      setRedoStack((list) => list.filter((x) => x !== entry));
      setUndoStack((list) => [...list, entry]);
    }
  };

  const openInTool = () => {
    if (!ctx) {
      return;
    }
    if (!openFile) {
      ctx.ui.toast("No file is selected in the Commit Panel or open in the merge resolution panel", "error", "Failed to open diff tool");
      return;
    }
    return openFile.merge ? A.openMergeTool(ctx, openFile.path) : A.openDiffTool(ctx, openFile.path, openFile.source);
  };

  const focusMessage = () => {
    if (!data?.status.length) {
      return;
    }
    setSelected(WIP);
    setOpenFile(null);
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".commit-box .summary")?.focus());
  };

  useEffect(() => {
    if (!ctx) {
      return;
    }
    setRepoApi({
      ctx,
      undo,
      redo,
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
      select: (sha) => {
        setOpenFile(null);
        setMulti([]);
        setSelected(sha);
      },
      showWip: () => {
        setOpenFile(null);
        setMulti([]);
        setSelected(WIP);
      },
      openFile: (file) => {
        setMulti([]);
        setOpenFile(file);
      },
      toggleLeft: () => setLeftCollapsed(!leftCollapsed),
      toggleDetails: () => setRightCollapsed(!rightCollapsed),
      openInTool,
      editFile: (file) => {
        const entry = ctx.data.status.find((e) => e.path === file);
        const changed = !!entry && entry.work !== " " && entry.work !== "?";
        setMulti([]);
        if (changed) {
          setSelected(WIP);
        }
        setOpenFile({ source: { kind: "unstaged", untracked: entry?.index === "?" }, path: file, view: "file", edit: true });
      },
      createFile: async (file) => {
        if (await A.createFile(ctx, file)) {
          setMulti([]);
          setSelected(WIP);
          setOpenFile({ source: { kind: "unstaged", untracked: true }, path: file, view: "file", edit: true });
        }
      },
    });
    return () => setRepoApi(null);
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (!(e.metaKey || e.ctrlKey) || e.altKey || !ctx || target.closest("input, textarea, select, .monaco-editor")) {
        return;
      }
      const key = `${e.shiftKey ? "Shift+" : ""}${e.code}`;
      const run: Record<string, () => unknown> = {
        KeyJ: () => setLeftCollapsed(!leftCollapsed),
        KeyK: () => setRightCollapsed(!rightCollapsed),
        KeyZ: undo,
        KeyY: redo,
        "Shift+KeyZ": redo,
        KeyB: () => ctx.data.head && A.createBranch(ctx, "HEAD"),
        KeyL: () => A.pull(ctx, "fetch"),
        "Shift+KeyS": () => ctx.data.status.some((s) => s.work !== " " || s.index === "?") && A.stageAll(ctx),
        "Shift+KeyU": () => ctx.data.status.some((s) => s.index !== " " && s.index !== "?") && A.unstageAll(ctx),
        "Shift+KeyM": focusMessage,
        KeyD: () => openInTool(),
      };
      if (run[key]) {
        e.preventDefault();
        void run[key]();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!held.current) {
      setShown(selected);
    }
  }, [selected]);

  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (e.key !== "Escape" || multi.length < 2 || openFile || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el?.closest(".monaco-editor")) {
        return;
      }
      setMulti([]);
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [multi, openFile]);

  useEffect(() => {
    const arrow = (e: KeyboardEvent) => e.key === "ArrowUp" || e.key === "ArrowDown";
    const onDown = (e: KeyboardEvent) => {
      if (arrow(e) && e.repeat) {
        held.current = true;
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (arrow(e) && held.current) {
        held.current = false;
        setShown(selected);
      }
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [selected]);

  useEffect(() => {
    if (selected === WIP && data && data.status.length === 0) {
      setSelected(data.head);
    }
  }, [data, selected]);

  useEffect(() => {
    if (data) {
      cache.set(path, { data, selected, multi, undoStack, redoStack });
    }
  }, [path, data, selected, multi, undoStack, redoStack]);

  if (error && !data) {
    return <div className="repo-error">{error}</div>;
  }
  if (!data || !ctx) {
    return <div className="repo-loading">Loading {path}…</div>;
  }

  const select = (sha: string, mode?: SelectMode) => {
    if (mode && selected) {
      let next: string[];
      if (mode === "toggle") {
        const base = multi.length ? multi : [selected];
        next = base.includes(sha) ? base.filter((x) => x !== sha) : [...base, sha];
      } else {
        const a = commits.findIndex((c) => c.sha === selected);
        const b = commits.findIndex((c) => c.sha === sha);
        next = commits.slice(Math.min(a, b), Math.max(a, b) + 1).filter((c) => !c.stash).map((c) => c.sha);
      }
      setOpenFile(null);
      if (next.length < 2) {
        setMulti([]);
        setSelected(next[0] ?? selected);
      } else {
        setMulti(next);
      }
      return;
    }
    setMulti([]);
    if (sha !== selected) {
      setSelected(sha);
      setOpenFile(null);
    }
  };

  return (
    <div className="repo-view">
      <Toolbar
        ctx={ctx}
        recent={recent}
        favorites={favorites}
        aliases={aliases}
        onViewAll={onViewAll}
        undoLabel={undoStack[undoStack.length - 1]?.label}
        redoLabel={redoStack[redoStack.length - 1]?.label}
        onUndo={undo}
        onRedo={redo}
        onPalette={onPalette}
      />
      {(data.operation === "cherry-pick" || data.operation === "revert") && (
        <div className="op-banner">
          <span>
            A {data.operation} is in progress.
            {data.status.some((e) => e.index === "U" || e.work === "U") ? " Resolve the conflicts and stage the files." : ""}
          </span>
          <button className="primary" onClick={() => A.continueOperation(ctx, data.operation)}>
            Continue {data.operation}
          </button>
          <button className="danger" onClick={() => A.abortOperation(ctx, data.operation)}>
            Abort {data.operation}
          </button>
        </div>
      )}
      <div className="panes">
        <div className="pane" style={{ width: leftCollapsed ? 32 : leftWidth }}>
          <Sidebar
            ctx={ctx}
            onSelectSha={select}
            showAll={() => setPrefs({ hidden: [], solo: [] })}
            collapsed={leftCollapsed}
            setCollapsed={setLeftCollapsed}
            closed={closed}
            setClosed={(list) => setPrefs({ closed: list })}
            openSections={openSections}
            setOpenSections={(list) => setPrefs({ openSections: list })}
            sectionYs={prefs.sectionYsByKey ?? {}}
            setSectionYs={(ys) => setPrefs({ sectionYsByKey: ys })}
            selectedSha={selected}
          />
        </div>
        {!leftCollapsed && <Splitter value={leftWidth} set={setLeftWidth} min={180} max={600} />}
        <main className="center">
          {openFile?.merge ? (
            <MergeView ctx={ctx} path={openFile.path} onClose={() => setOpenFile(null)} />
          ) : openFile ? (
            <DiffView
              cwd={path}
              file={openFile}
              refreshKey={refreshKey}
              syntaxHighlighting={settings.syntaxHighlighting}
              onClose={() => setOpenFile(null)}
              onPatch={(patch, action) => A.applyPatch(ctx, patch, action)}
              onShowCommit={(sha) => {
                setOpenFile(null);
                select(sha);
              }}
              onOpenInCommit={(c, file) => {
                setSelected(c.sha);
                setMulti([]);
                setOpenFile({ source: { kind: "commit", sha: c.sha, parent: c.parents[0] }, path: file });
              }}
            />
          ) : (
            <GraphView
              commits={commits}
              rows={rows}
              refs={data.refs.filter((r) => (prefs.solo.length ? prefs.solo.includes(r.full) : !prefs.hidden.includes(r.full)))}
              head={data.head}
              selected={selected}
              multi={multi}
              wipCount={data.status.length}
              hasMore={hasMore}
              footerCount={showsFooter(settings.lazyLoad) ? data.commits.filter((c) => !c.stash).length : null}
              onPreferences={onPreferences}
              onLoadMore={() => void loadMore()}
              onSelect={select}
              onCommitMenu={(c) =>
                c.sha === WIP
                  ? M.wipMenu(ctx)
                  : multi.length > 1 && multi.includes(c.sha)
                    ? M.multiMenu(ctx, commits.filter((x) => x.sha !== WIP && multi.includes(x.sha)), multi.includes(WIP))
                    : M.commitMenu(ctx, c)
              }
              onRefMenu={(r) => M.refMenu(ctx, r)}
              onRefDrop={(source, target) => M.canDrop(ctx, source, target) && M.dropMenu(ctx, source, target)}
              onRefOpen={(r) => A.openRef(ctx, r)}
            />
          )}
        </main>
        {selected && !rightCollapsed && (
          <>
            <Splitter value={rightWidth} set={setRightWidth} min={260} max={900} invert />
            <div className="pane" style={{ width: rightWidth }}>
              <DetailPanel ctx={ctx} sha={shown ?? selected} multi={multi} openFile={openFile} onOpenFile={setOpenFile} onSelectSha={select} />
            </div>
          </>
        )}
      </div>
      {rebase && (
        <RebaseModal
          base={rebase.base}
          entries={rebase.entries}
          onCancel={() => setRebase(null)}
          onStart={(entries) => {
            setRebase(null);
            void A.runTodo(ctx, rebase.base, entries);
          }}
        />
      )}
    </div>
  );
}
