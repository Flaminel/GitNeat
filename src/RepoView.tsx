import { useCallback, useEffect, useMemo, useState } from "react";
import * as A from "./actions";
import { Ctx, TodoEntry, UndoEntry } from "./actions";
import { krill } from "./api";
import { DetailPanel, OpenFile } from "./components/DetailPanel";
import { DiffView } from "./components/DiffView";
import { GraphView, SelectMode, WIP } from "./components/GraphView";
import { RebaseModal } from "./components/RebaseModal";
import { Sidebar } from "./components/Sidebar";
import { Toolbar } from "./components/Toolbar";
import { layoutGraph } from "./graph";
import * as M from "./menus";
import { Commit, loadRepo, RepoData } from "./repo";
import { Splitter, useStoredWidth, useUi } from "./ui";

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
  const [rightWidth, setRightWidth] = useStoredWidth("right", Math.max(380, Math.round(window.innerWidth * 0.325)));

  const load = useCallback(async () => {
    try {
      const next = await loadRepo(path, prefs.hidden, prefs.solo, COMMIT_LIMIT);
      setData(next);
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
    void krill().watch(path);
    const off = krill().onRepoChanged((cwd) => {
      if (cwd === path) {
        void load();
      }
    });
    return () => {
      off();
      void krill().unwatch(path);
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

  const rows = useMemo(() => layoutGraph(commits), [commits]);

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
          setUndoStack((list) => list.slice(0, -1));
          if (entry && (await A.undo(ctx, entry))) {
            setRedoStack((list) => [...list, entry]);
          }
        }}
        onRedo={async () => {
          const entry = redoStack[redoStack.length - 1];
          setRedoStack((list) => list.slice(0, -1));
          if (entry && (await A.redo(ctx, entry))) {
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
        <div className="pane" style={{ width: leftWidth }}>
          <Sidebar ctx={ctx} onSelectSha={select} showAll={() => setPrefs({ hidden: [], solo: [] })} />
        </div>
        <Splitter value={leftWidth} set={setLeftWidth} min={180} max={600} />
        <main className="center">
          {openFile ? (
            <DiffView
              cwd={path}
              file={openFile}
              refreshKey={refreshKey}
              onClose={() => setOpenFile(null)}
              onHunk={(patch, action) => A.applyHunk(ctx, patch, action)}
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
