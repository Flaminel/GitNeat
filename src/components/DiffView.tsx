import { MouseEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { hunkPatch, Hunk, linesInRange, linesPatch, parseDiff, ParsedDiff } from "../diff";
import { krill } from "../api";
import { languageFor, monaco } from "../monaco";
import { BlameLine, Commit, DiffSides, loadBlame, loadDiff, loadFileHistory, loadSides } from "../repo";
import { showMenu } from "../ui";
import { OpenFile } from "./DetailPanel";
import { relativeTime } from "./GraphView";

export type DiffMode = "hunk" | "inline" | "split";
type View = "diff" | "blame" | "history";
export type PatchAction = "stage" | "unstage" | "discard" | "revert";

interface Props {
  cwd: string;
  file: OpenFile;
  refreshKey: number;
  onClose(): void;
  onPatch(patch: string, action: PatchAction): Promise<unknown>;
  onShowCommit(sha: string): void;
  onOpenInCommit(commit: Commit, path: string): void;
}

const MODE_KEY = "krill.diffMode";
const WS_KEY = "krill.diffIgnoreWhitespace";
const WRAP_KEY = "krill.diffWordWrap";

function stored<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    return;
  }
}

const I = {
  up: <path d="M8 13V3 M4 7l4-4 4 4" />,
  down: <path d="M8 3v10 M4 9l4 4 4-4" />,
  hunk: <path d="M2.5 2.5h11v11h-11z M5 5.5h6 M5 8h6 M5 10.5h6" />,
  inline: <path d="M2 3.5h12 M2 6.5h12 M2 9.5h12 M2 12.5h12" />,
  split: <path d="M2.5 2.5h11v11h-11z M8 2.5v11" />,
  ws: <path d="M10 13V3 M12.5 13V3 M13.5 3H7.5a3 3 0 0 0 0 6H10" />,
  wrap: <path d="M2 4h12 M2 8h9.5a2.5 2.5 0 0 1 0 5H8 M9.5 11.5L8 13l1.5 1.5 M2 12h3" />,
  blame: <path d="M3 2.5h7l3 3v8H3z M5.5 7h5 M5.5 9.5h5 M5.5 12h3" />,
  history: <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9 M2.5 2.5v2.6h2.6 M8 5v3.2l2 1.3" />,
  edit: <path d="M10.5 2.5l3 3-8 8H2.5v-3z" />,
};

function TbButton(props: { icon: ReactNode; title: string; on?: boolean; disabled?: boolean; onClick(): void; label?: string }) {
  return (
    <button className={`tb-btn${props.on ? " on" : ""}`} title={props.title} disabled={props.disabled} onClick={props.onClick}>
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        {props.icon}
      </svg>
      {props.label && <span>{props.label}</span>}
    </button>
  );
}

function useColorized(lines: string[], language: string): string[] | null {
  const [html, setHtml] = useState<string[] | null>(null);
  const key = lines.join("\n");
  useEffect(() => {
    let live = true;
    setHtml(null);
    if (lines.length === 0 || lines.length > 20000) {
      return;
    }
    monaco.editor.colorize(key, language, { tabSize: 4 }).then((out) => {
      if (live) {
        setHtml(out.split("<br/>"));
      }
    });
    return () => {
      live = false;
    };
  }, [key, language]);
  return html;
}

function HunkView(props: {
  diff: ParsedDiff;
  language: string;
  kind: OpenFile["source"]["kind"];
  wrap: boolean;
  canStage: boolean;
  onPatch(patch: string, action: PatchAction): Promise<unknown>;
}) {
  const { diff, kind } = props;
  const [selected, setSelected] = useState<Map<number, Set<number>>>(new Map());
  const anchor = useRef<{ hunk: number; line: number } | null>(null);
  const flat = useMemo(() => diff.hunks.flatMap((h) => h.lines.map((l) => l.text)), [diff]);
  const html = useColorized(flat, props.language);

  useEffect(() => setSelected(new Map()), [diff]);

  const toggle = (h: number, i: number, e: MouseEvent) => {
    const keep = e.metaKey || e.ctrlKey || e.shiftKey;
    const set = new Set(keep ? selected.get(h) ?? [] : []);
    if (e.shiftKey && anchor.current?.hunk === h) {
      const [a, b] = [Math.min(anchor.current.line, i), Math.max(anchor.current.line, i)];
      for (let k = a; k <= b; k++) {
        if (diff.hunks[h].lines[k].kind !== "ctx") {
          set.add(k);
        }
      }
    } else if (set.has(i)) {
      set.delete(i);
    } else {
      set.add(i);
    }
    anchor.current = { hunk: h, line: i };
    setSelected(new Map([[h, set]]));
  };

  const lineMenu = (h: number, i: number) => {
    if (!props.canStage || diff.hunks[h].lines[i].kind === "ctx") {
      return;
    }
    const set = selected.get(h)?.has(i) ? (selected.get(h) as Set<number>) : new Set([i]);
    const many = set.size > 1;
    const hunk = diff.hunks[h];
    const apply = (action: PatchAction) => {
      const patch = linesPatch(diff, hunk, set, action !== "stage");
      return patch ? props.onPatch(patch, action) : undefined;
    };
    void showMenu([
      kind === "unstaged" && { label: many ? "Stage selected lines" : "Stage this line", run: () => apply("stage") },
      kind === "staged" && { label: many ? "Unstage selected lines" : "Unstage this line", run: () => apply("unstage") },
      kind === "unstaged" && { label: many ? "Discard selected lines" : "Discard this line", run: () => apply("discard") },
    ]);
  };

  let flatIndex = 0;
  return (
    <div className={`hunk-view${props.wrap ? " wrap" : ""}`}>
      {diff.hunks.map((hunk: Hunk, h) => {
        const base = flatIndex;
        flatIndex += hunk.lines.length;
        const patch = () => hunkPatch(diff, hunk);
        return (
          <div className="hunk-block" key={hunk.header + h} data-hunk={h}>
            <div className="hunk-strip">
              <span className="hunk-title">{hunk.header}</span>
              {props.canStage && kind === "unstaged" && (
                <>
                  <button className="btn-xs danger" onClick={() => props.onPatch(patch(), "discard")}>
                    Discard Hunk
                  </button>
                  <button className="btn-xs success" onClick={() => props.onPatch(patch(), "stage")}>
                    Stage Hunk
                  </button>
                </>
              )}
              {props.canStage && kind === "staged" && (
                <button className="btn-xs danger" onClick={() => props.onPatch(patch(), "unstage")}>
                  Unstage Hunk
                </button>
              )}
              {kind === "commit" && (
                <button className="btn-xs" title="Apply the inverse of this hunk to your working directory" onClick={() => props.onPatch(patch(), "revert")}>
                  Revert Hunk
                </button>
              )}
            </div>
            <table className="diff-table">
              <tbody>
                {hunk.lines.map((line, i) => {
                  const isSel = selected.get(h)?.has(i);
                  const pick = (e: MouseEvent) => {
                    if (line.kind !== "ctx" && props.canStage) {
                      toggle(h, i, e);
                    }
                  };
                  return (
                    <tr key={i} className={`line ${line.kind}${isSel ? " sel" : ""}`} onContextMenu={() => lineMenu(h, i)}>
                      <td className="ln" onMouseDown={pick}>
                        {line.old}
                      </td>
                      <td className="ln" onMouseDown={pick}>
                        {line.next}
                      </td>
                      <td className="sign">{line.kind === "add" ? "+" : line.kind === "del" ? "-" : ""}</td>
                      {html ? (
                        <td className="code" dangerouslySetInnerHTML={{ __html: html[base + i] ?? "" }} />
                      ) : (
                        <td className="code">{line.text}</td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function MonacoDiff(props: {
  sides: DiffSides;
  diff: ParsedDiff | null;
  language: string;
  split: boolean;
  ignoreWs: boolean;
  wrap: boolean;
  editing: boolean;
  kind: OpenFile["source"]["kind"];
  canStage: boolean;
  editorRef: React.MutableRefObject<monaco.editor.IStandaloneDiffEditor | null>;
  onPatch(patch: string, action: PatchAction): Promise<unknown>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const editor = monaco.editor.createDiffEditor(host.current as HTMLDivElement, {
      theme: "krill",
      automaticLayout: true,
      readOnly: true,
      originalEditable: false,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 12,
      fontFamily: "Menlo, Consolas, 'DejaVu Sans Mono', monospace",
      useInlineViewWhenSpaceIsLimited: false,
      renderOverviewRuler: true,
    });
    props.editorRef.current = editor;
    const original = monaco.editor.createModel("", props.language);
    const modified = monaco.editor.createModel("", props.language);
    editor.setModel({ original, modified });

    const linesAction = (side: "old" | "new", action: PatchAction) => (ed: monaco.editor.ICodeEditor) => {
      const { diff } = latest.current;
      const sel = ed.getSelection();
      if (!diff || !sel) {
        return;
      }
      for (const hunk of diff.hunks) {
        const picked = linesInRange(hunk, side, sel.startLineNumber, sel.endLineNumber);
        const patch = picked.length ? linesPatch(diff, hunk, new Set(picked), action !== "stage") : null;
        if (patch) {
          void latest.current.onPatch(patch, action);
          return;
        }
      }
    };
    const addActions = (ed: monaco.editor.IStandaloneCodeEditor, side: "old" | "new") => {
      const unstaged = ed.createContextKey<boolean>(`krillUnstaged${side}`, false);
      const staged = ed.createContextKey<boolean>(`krillStaged${side}`, false);
      const sync = () => {
        unstaged.set(latest.current.canStage && latest.current.kind === "unstaged");
        staged.set(latest.current.canStage && latest.current.kind === "staged");
      };
      sync();
      ed.onDidFocusEditorWidget(sync);
      ed.onContextMenu(sync);
      ed.addAction({ id: `krill.stage.${side}`, label: "Stage selected lines", contextMenuGroupId: "1_krill", precondition: `krillUnstaged${side}`, run: linesAction(side, "stage") });
      ed.addAction({ id: `krill.discard.${side}`, label: "Discard selected lines", contextMenuGroupId: "1_krill", precondition: `krillUnstaged${side}`, run: linesAction(side, "discard") });
      ed.addAction({ id: `krill.unstage.${side}`, label: "Unstage selected lines", contextMenuGroupId: "1_krill", precondition: `krillStaged${side}`, run: linesAction(side, "unstage") });
    };
    addActions(editor.getModifiedEditor() as monaco.editor.IStandaloneCodeEditor, "new");
    addActions(editor.getOriginalEditor() as monaco.editor.IStandaloneCodeEditor, "old");
    return () => {
      editor.dispose();
      original.dispose();
      modified.dispose();
      props.editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = props.editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) {
      return;
    }
    monaco.editor.setModelLanguage(model.original, props.language);
    monaco.editor.setModelLanguage(model.modified, props.language);
    if (model.original.getValue() !== props.sides.original) {
      model.original.setValue(props.sides.original);
    }
    if (!props.editing && model.modified.getValue() !== props.sides.modified) {
      model.modified.setValue(props.sides.modified);
    }
  }, [props.sides, props.language, props.editing]);

  useEffect(() => {
    props.editorRef.current?.updateOptions({
      renderSideBySide: props.split,
      ignoreTrimWhitespace: props.ignoreWs,
      wordWrap: props.wrap ? "on" : "off",
      diffWordWrap: props.wrap ? "on" : "off",
    });
    props.editorRef.current?.getModifiedEditor().updateOptions({ readOnly: !props.editing });
  }, [props.split, props.ignoreWs, props.wrap, props.editing]);

  return <div className="monaco-host" ref={host} />;
}

function BlameView(props: { cwd: string; file: OpenFile; language: string; onShowCommit(sha: string): void }) {
  const [lines, setLines] = useState<BlameLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rev = props.file.source.kind === "commit" ? props.file.source.sha : undefined;
  useEffect(() => {
    let live = true;
    loadBlame(props.cwd, props.file.path, rev).then(
      (l) => live && setLines(l),
      (e) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [props.cwd, props.file.path, rev]);
  const html = useColorized(lines?.map((l) => l.text) ?? [], props.language);
  if (error) {
    return <div className="diff-empty">{error}</div>;
  }
  if (!lines) {
    return <div className="diff-empty">Loading blame…</div>;
  }
  return (
    <table className="diff-table blame-table">
      <tbody>
        {lines.map((l, i) => {
          const first = i === 0 || lines[i - 1].sha !== l.sha;
          return (
            <tr key={i} className={first ? "blame-start" : undefined}>
              <td className="blame-info" onClick={() => props.onShowCommit(l.sha)}>
                {first && (
                  <>
                    <span className="blame-author">{l.author}</span>
                    <span className="blame-date">{relativeTime(l.time) ?? "today"}</span>
                    <span className="blame-summary">{l.summary}</span>
                  </>
                )}
              </td>
              <td className="ln">{i + 1}</td>
              {html ? <td className="code" dangerouslySetInnerHTML={{ __html: html[i] ?? "" }} /> : <td className="code">{l.text}</td>}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function HistoryView(props: { cwd: string; file: OpenFile; onOpenInCommit(commit: Commit, path: string): void }) {
  const [commits, setCommits] = useState<Commit[] | null>(null);
  const current = props.file.source.kind === "commit" ? props.file.source.sha : null;
  useEffect(() => {
    let live = true;
    loadFileHistory(props.cwd, props.file.path).then(
      (c) => live && setCommits(c),
      () => live && setCommits([]),
    );
    return () => {
      live = false;
    };
  }, [props.cwd, props.file.path]);
  if (!commits) {
    return <div className="diff-empty">Loading history…</div>;
  }
  return (
    <div className="file-history">
      <div className="file-history-title">File History</div>
      {commits.map((c) => (
        <div key={c.sha} className={`history-row${c.sha === current ? " active" : ""}`} onClick={() => props.onOpenInCommit(c, props.file.path)}>
          <span className="history-sha">{c.sha.slice(0, 6)}</span>
          <span className="history-subject">{c.subject}</span>
          <span className="history-author">{c.author}</span>
          <span className="history-date">{new Date(c.time * 1000).toLocaleDateString()}</span>
        </div>
      ))}
      <div className="file-history-end">End of History</div>
    </div>
  );
}

export function DiffView(props: Props) {
  const { cwd, file, onClose, refreshKey } = props;
  const [mode, setMode] = useState<DiffMode>(() => stored<DiffMode>(MODE_KEY, "hunk"));
  const [view, setView] = useState<View>("diff");
  const [ignoreWs, setIgnoreWs] = useState(() => stored<string>(WS_KEY, "false") === "true");
  const [wrap, setWrap] = useState(() => stored<string>(WRAP_KEY, "false") === "true");
  const [text, setText] = useState<string | null>(null);
  const [sides, setSides] = useState<DiffSides | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const sourceKey = JSON.stringify(file.source);
  const language = useMemo(() => languageFor(file.path), [file.path]);
  const kind = file.source.kind;

  useEffect(() => {
    setView("diff");
    setEditing(false);
  }, [sourceKey, file.path]);

  useEffect(() => {
    let live = true;
    setError(null);
    Promise.all([loadDiff(cwd, file.source, file.path, ignoreWs, file.orig), loadSides(cwd, file.source, file.path, file.orig)]).then(
      ([t, s]) => {
        if (live) {
          setText(t);
          setSides(s);
        }
      },
      (e) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [cwd, sourceKey, file.path, file.orig, refreshKey, ignoreWs]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (e.key !== "Escape" || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el?.closest(".monaco-editor")) {
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const diff = useMemo(() => (text === null ? null : parseDiff(text)), [text]);
  const binary = !!(diff?.binary || sides?.binary);
  const canStage = !ignoreWs && (kind === "unstaged" || kind === "staged");

  const pickMode = (m: DiffMode) => {
    setMode(m);
    setView("diff");
    store(MODE_KEY, m);
  };

  const jump = (dir: 1 | -1) => {
    if (mode !== "hunk" || editing) {
      editorRef.current?.goToDiff(dir === 1 ? "next" : "previous");
      return;
    }
    const el = bodyRef.current;
    if (!el) {
      return;
    }
    const blocks = [...el.querySelectorAll<HTMLElement>(".hunk-block")];
    const top = el.scrollTop + 4;
    const target = dir === 1 ? blocks.find((b) => b.offsetTop > top) : [...blocks].reverse().find((b) => b.offsetTop < top - 8);
    if (target) {
      el.scrollTop = target.offsetTop;
    }
  };

  const save = async () => {
    const value = editorRef.current?.getModifiedEditor().getValue();
    if (value !== undefined && (await krill().writeFile(cwd, file.path, value))) {
      setEditing(false);
    }
  };

  const slash = file.path.lastIndexOf("/");
  let body: ReactNode;
  if (error) {
    body = <div className="diff-empty">{error}</div>;
  } else if (view === "blame") {
    body = <BlameView cwd={cwd} file={file} language={language} onShowCommit={props.onShowCommit} />;
  } else if (view === "history") {
    body = <HistoryView cwd={cwd} file={file} onOpenInCommit={props.onOpenInCommit} />;
  } else if (!diff || !sides) {
    body = <div className="diff-empty">Loading diff...</div>;
  } else if (binary) {
    body = <div className="diff-empty">Binary file</div>;
  } else if (mode === "hunk" && !editing) {
    body =
      diff.hunks.length === 0 ? (
        <div className="diff-empty">{sides.modified === "" && kind !== "unstaged" ? "File was deleted" : "File contents are unchanged"}</div>
      ) : (
        <HunkView diff={diff} language={language} kind={kind} wrap={wrap} canStage={canStage} onPatch={props.onPatch} />
      );
  } else {
    body = (
      <MonacoDiff
        sides={sides}
        diff={diff}
        language={language}
        split={mode === "split"}
        ignoreWs={ignoreWs}
        wrap={wrap}
        editing={editing}
        kind={kind}
        canStage={canStage}
        editorRef={editorRef}
        onPatch={props.onPatch}
      />
    );
  }

  const disabled = binary || view !== "diff";
  return (
    <div className="diff-view">
      <div className="diff-path-bar">
        <span className="diff-path">
          {slash >= 0 && <span className="dir">{file.path.slice(0, slash + 1)}</span>}
          {file.path.slice(slash + 1)}
          {file.orig && file.orig !== file.path && <span className="dir"> (renamed from {file.orig})</span>}
        </span>
        <button className="icon-btn diff-close" title="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="diff-toolbar">
        <div className="tb-region tb-left">
          {kind === "unstaged" && !binary && view === "diff" && !editing && (
            <TbButton
              icon={I.edit}
              title="Edit This File"
              label="Edit This File"
              onClick={() => {
                if (mode === "hunk") {
                  pickMode("inline");
                }
                setEditing(true);
              }}
            />
          )}
          {editing && (
            <>
              <button className="btn-xs" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button className="btn-xs success" onClick={save}>
                Save Changes
              </button>
            </>
          )}
        </div>
        <div className="tb-region tb-center" data-testid="diff-options">
          <span className="tb-group">
            <TbButton icon={I.up} title="Previous Change" disabled={disabled} onClick={() => jump(-1)} />
            <TbButton icon={I.down} title="Next Change" disabled={disabled} onClick={() => jump(1)} />
          </span>
          <span className="tb-group">
            <TbButton icon={I.hunk} title="Hunk View" on={view === "diff" && mode === "hunk"} disabled={binary || editing} onClick={() => pickMode("hunk")} />
            <TbButton icon={I.inline} title="Inline View" on={view === "diff" && mode === "inline"} disabled={binary} onClick={() => pickMode("inline")} />
            <TbButton icon={I.split} title="Split View" on={view === "diff" && mode === "split"} disabled={binary} onClick={() => pickMode("split")} />
          </span>
          <span className="tb-group">
            <TbButton
              icon={I.ws}
              title="Ignore Leading/Trailing Whitespace"
              on={ignoreWs}
              disabled={disabled}
              onClick={() => {
                setIgnoreWs(!ignoreWs);
                store(WS_KEY, String(!ignoreWs));
              }}
            />
            <TbButton
              icon={I.wrap}
              title="Word Wrap"
              on={wrap}
              disabled={binary}
              onClick={() => {
                setWrap(!wrap);
                store(WRAP_KEY, String(!wrap));
              }}
            />
          </span>
        </div>
        <div className="tb-region tb-right">
          <span className="tb-group">
            <TbButton icon={I.blame} title="Blame" label="Blame" on={view === "blame"} onClick={() => setView(view === "blame" ? "diff" : "blame")} />
            <TbButton icon={I.history} title="History" label="History" on={view === "history"} onClick={() => setView(view === "history" ? "diff" : "history")} />
          </span>
        </div>
      </div>
      <div className="diff-body" ref={bodyRef}>
        {body}
      </div>
    </div>
  );
}
