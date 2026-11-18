import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Commit, loadRepo, RepoData } from "./repo";
import { Splitter, useStoredFlag, useStoredWidth, useUi } from "./ui";

export interface RepoPrefs {
  hidden: string[];
  solo: string[];
}

interface Props {
  path: string;
  prefs: RepoPrefs;
  setPrefs(prefs: RepoPrefs): void;
  openTab(path: string): void;
  recent: string[];
}

const COMMIT_LIMIT = 2000;

function toggle(list: string[], item: string): string[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export function RepoView({ path, prefs, setPrefs, openTab, recent }: Props) {
  const ui = useUi();
  const [data, setData] = useState<RepoData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [multi, setMulti] = useState<string[]>([]);
  const [openFile, setOpenFile] = useState<OpenFile | null>(null);
  const [rebase, setRebase] = useState<{ base: string | null; entries: TodoEntry[] } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [redoStack, setRedoStack] = useState<UndoEntry[]>([]);
  const [leftWidth, setLeftWidth] = useStoredWidth("left", 296);
  const [leftCollapsed, setLeftCollapsed] = useStoredFlag("left.collapsed", false);
  const [rightWidth, setRightWidth] = useStoredWidth("right", Math.max(380, Math.round(window.innerWidth * 0.325)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if ((e.metaKey || e.ctrlKey) && e.code === "KeyJ" && !target.closest("input, textarea, .monaco-editor")) {
        e.preventDefault();
        setLeftCollapsed(!leftCollapsed);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leftCollapsed, setLeftCollapsed]);

  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const next = await loadRepo(path, prefs.hidden, prefs.solo, COMMIT_LIMIT);
      if (seq !== loadSeq.current) {
        return;
      }
      setData(next);
      setMulti((list) => list.filter((sha) => next.commits.some((c) => c.sha === sha)));
      setSelected((s) => (s && s !== WIP && !next.commits.some((c) => c.sha === s) ? next.head : s));
      setError(null);
      setRefreshKey((k) => k + 1);
      setSelected((s) => s ?? (next.status.length ? WIP : next.head));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [path, prefs.hidden, prefs.solo]);

  useEffect(() => {
    void load();
  }, [load]);

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
        toggleSolo: (full) => setPrefs({ hidden: prefs.hidden, solo: toggle(prefs.solo, full) }),
        hidden: prefs.hidden,
        solo: prefs.solo,
        record: (entry) => {
          setUndoStack((list) => [...list.slice(-49), entry]);
          setRedoStack([]);
        },
      },
    [data, path, ui, load, openTab, prefs, setPrefs],
  );

  useEffect(() => {
    if (selected === WIP && data && data.status.length === 0) {
      setSelected(data.head);
    }
  }, [data, selected]);

  if (error && !data) {
    return <div className="repo-error">{error}</div>;
  }
  if (!data || !ctx) {
    return <div className="repo-loading">Loading {path}…</div>;
  }

  const select = (sha: string, mode?: SelectMode) => {
    const selectable = (c: Commit) => c.sha !== WIP && !c.stash;
    if (mode && selected && sha !== WIP) {
      if (mode === "toggle") {
        const base = multi.length ? multi : [selected];
        setMulti(base.includes(sha) ? base.filter((x) => x !== sha) : [...base, sha]);
      } else {
        const a = commits.findIndex((c) => c.sha === selected);
        const b = commits.findIndex((c) => c.sha === sha);
        setMulti(commits.slice(Math.min(a, b), Math.max(a, b) + 1).filter(selectable).map((c) => c.sha));
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
        undoLabel={undoStack[undoStack.length - 1]?.label}
        redoLabel={redoStack[redoStack.length - 1]?.label}
        onUndo={async () => {
          const entry = undoStack[undoStack.length - 1];
          if (entry && (await A.undo(ctx, entry))) {
            setUndoStack((list) => list.filter((x) => x !== entry));
            setRedoStack((list) => [...list, entry]);
          }
        }}
        onRedo={async () => {
          const entry = redoStack[redoStack.length - 1];
          if (entry && (await A.redo(ctx, entry))) {
            setRedoStack((list) => list.filter((x) => x !== entry));
            setUndoStack((list) => [...list, entry]);
          }
        }}
      />
      {data.operation && (
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
              onSelect={select}
              onCommitMenu={(c) =>
                c.sha === WIP
                  ? M.wipMenu(ctx)
                  : multi.length > 1 && multi.includes(c.sha)
                    ? M.multiMenu(ctx, commits.filter((x) => multi.includes(x.sha)))
                    : M.commitMenu(ctx, c)
              }
              onRefMenu={(r) => M.refMenu(ctx, r)}
              onRefDrop={(source, target) => M.dropMenu(ctx, source, target)}
              onRefOpen={(r) =>
                r.kind === "local" ? A.checkoutRef(ctx, r.name) : r.kind === "remote" ? A.checkoutRemote(ctx, r.name) : A.checkoutCommit(ctx, r.sha)
              }
            />
          )}
        </main>
        {selected && (
          <>
            <Splitter value={rightWidth} set={setRightWidth} min={260} max={900} invert />
            <div className="pane" style={{ width: rightWidth }}>
              <DetailPanel ctx={ctx} sha={selected} openFile={openFile} onOpenFile={setOpenFile} onSelectSha={select} />
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
