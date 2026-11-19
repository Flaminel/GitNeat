import { MouseEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { hunkPatch, Hunk, linesInRange, linesPatch, ParsedDiff } from "../diff";
import { gitneat } from "../api";
import { languageFor, monaco } from "../monaco";
import { BlameLine, Commit, DiffSides, FileHistoryPage, ImageData, ImageSides, isImagePath, loadBlame, loadDiff, loadImages, loadFileHistoryPage, loadSides } from "../repo";
import { showMenu, useStored } from "../ui";
import { OpenFile, StatusIcon } from "./DetailPanel";
import { relativeTime } from "./GraphView";

export type DiffMode = "hunk" | "inline" | "split";
type View = "diff" | "file" | "blame" | "history";
export type PatchAction = "stage" | "unstage" | "discard" | "revert";

interface Props {
  cwd: string;
  file: OpenFile;
  refreshKey: number;
  syntaxHighlighting?: boolean;
  onClose(): void;
  onPatch(patch: string, action: PatchAction): Promise<unknown>;
  onShowCommit(sha: string): void;
  onOpenInCommit(commit: Commit, path: string): void;
}

export const MONO = "Menlo, Consolas, 'DejaVu Sans Mono', monospace";
const I = {
  up: <path d="M8 13V3 M4 7l4-4 4 4" />,
  down: <path d="M8 3v10 M4 9l4 4 4-4" />,
  hunk: <path d="M2.5 2.5h11v11h-11z M5 5.5h6 M5 8h6 M5 10.5h6" />,
  inline: <path d="M2.5 4h.01 M2.5 8h.01 M2.5 12h.01 M5.5 4h8 M5.5 8h8 M5.5 12h8" />,
  split: <path d="M2.5 2.5h11v11h-11z M8 2.5v11" />,
  ws: <path d="M10 13V3 M12.5 13V3 M13.5 3H7.5a3 3 0 0 0 0 6H10" />,
  wrap: <path d="M2.5 3.5h11 M2.5 6.5h8 M2.5 9.5h11 M2.5 12.5h8" />,
  blame: <path d="M3 2.5h7l3 3v8H3z M5.5 7h5 M5.5 9.5h5 M5.5 12h3" />,
  history: <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9 M2.5 2.5v2.6h2.6 M8 5v3.2l2 1.3" />,
  image: <path d="M2.5 2.5h11v11h-11z M2.5 10.5l3.5-3.5 3 3 2-2 2.5 2.5 M10.5 5.5h.01" />,
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

interface Bracket {
  range: monaco.IRange;
  nestingLevel: number;
  isInvalid: boolean;
}

interface InternalModel {
  tokenization: {
    forceTokenization(line: number): void;
    getLineTokens(line: number): { getCount(): number; getEndOffset(i: number): number; getClassName(i: number): string };
  };
  bracketPairs: { getBracketsInRange(range: monaco.IRange): { toArray(): Bracket[] } };
}

const escapeHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function renderModelLine(model: monaco.editor.ITextModel, line: number, mark?: [number, number]): string {
  const text = model.getLineContent(line);
  const inner = model as unknown as InternalModel;
  const cls: string[] = new Array(text.length).fill("mtk1");
  try {
    inner.tokenization.forceTokenization(line);
    const tokens = inner.tokenization.getLineTokens(line);
    let start = 0;
    for (let i = 0; i < tokens.getCount(); i++) {
      const end = tokens.getEndOffset(i);
      cls.fill(tokens.getClassName(i), start, end);
      start = end;
    }
    inner.bracketPairs.getBracketsInRange({ startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: text.length + 1 }).toArray().forEach((b) => {
      if (!b.isInvalid && b.range.startLineNumber === line) {
        cls[b.range.startColumn - 1] = `bracket-${b.nestingLevel % 3}`;
      }
    });
  } catch {
    return escapeHtml(text);
  }
  let out = "";
  let i = 0;
  while (i < text.length) {
    const hl = !!mark && i >= mark[0] && i < mark[1];
    let j = i + 1;
    while (j < text.length && cls[j] === cls[i] && (!!mark && j >= mark[0] && j < mark[1]) === hl) {
      j++;
    }
    out += `<span class="${cls[i]}${hl ? " hl" : ""}">${escapeHtml(text.slice(i, j))}</span>`;
    i = j;
  }
  return out;
}

function changedRange(a: string, b: string): [[number, number], [number, number]] | null {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) {
    p++;
  }
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) {
    s++;
  }
  if (p === 0 && s === 0) {
    return null;
  }
  return [
    [p, a.length - s],
    [p, b.length - s],
  ];
}

interface LineLook {
  pure: boolean;
  mark?: [number, number];
}

function lineLooks(hunk: Hunk): LineLook[] {
  const looks: LineLook[] = hunk.lines.map(() => ({ pure: true }));
  let i = 0;
  while (i < hunk.lines.length) {
    if (hunk.lines[i].kind === "ctx") {
      i++;
      continue;
    }
    const dels: number[] = [];
    const adds: number[] = [];
    while (i < hunk.lines.length && hunk.lines[i].kind !== "ctx") {
      (hunk.lines[i].kind === "del" ? dels : adds).push(i);
      i++;
    }
    if (dels.length === 0 || adds.length === 0) {
      continue;
    }
    for (const k of [...dels, ...adds]) {
      looks[k].pure = false;
    }
    for (let k = 0; k < Math.min(dels.length, adds.length); k++) {
      const r = changedRange(hunk.lines[dels[k]].text.replace(/\r$/, ""), hunk.lines[adds[k]].text.replace(/\r$/, ""));
      if (r) {
        looks[dels[k]].mark = r[0];
        looks[adds[k]].mark = r[1];
      }
    }
  }
  return looks;
}

function useModels(sides: DiffSides, language: string) {
  const models = useMemo(() => ({ next: monaco.editor.createModel(sides.modified, language) }), [sides, language]);
  useEffect(() => () => models.next.dispose(), [models]);
  return models;
}

function HunkView(props: {
  diff: ParsedDiff;
  sides: DiffSides;
  language: string;
  kind: OpenFile["source"]["kind"];
  wrap: boolean;
  canStage: boolean;
  canRevert: boolean;
  onPatch(patch: string, action: PatchAction): Promise<unknown>;
}) {
  const { diff, kind } = props;
  const [selected, setSelected] = useState<Map<number, Set<number>>>(new Map());
  const anchor = useRef<{ hunk: number; line: number } | null>(null);
  const models = useModels(props.sides, props.language);
  const looks = useMemo(() => diff.hunks.map(lineLooks), [diff]);
  const [ready, setReady] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    monaco.editor.colorize("", props.language, {}).then(() => live && setReady(props.language));
    return () => {
      live = false;
    };
  }, [props.language]);
  const html = useMemo(() => {
    const total = diff.hunks.reduce((n, h) => n + h.lines.length, 0);
    return diff.hunks.map((hunk, h) =>
      hunk.lines.map((line, i) => {
        const model = models.next;
        const n = line.next;
        const text = line.text.replace(/\r$/, "");
        const mark = looks[h][i].mark;
        if (line.kind === "del") {
          return mark ? escapeHtml(text.slice(0, mark[0])) + `<span class="hl">${escapeHtml(text.slice(mark[0], mark[1]))}</span>` + escapeHtml(text.slice(mark[1])) : escapeHtml(text);
        }
        if (ready !== props.language || total > 20000 || !n || n > model.getLineCount() || model.getLineContent(n) !== text) {
          return escapeHtml(text);
        }
        return renderModelLine(model, n, mark);
      }),
    );
  }, [diff, models, looks, ready, props.language]);

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

  return (
    <div className={`hunk-view${props.wrap ? " wrap" : ""}`}>
      {diff.hunks.map((hunk: Hunk, h) => {
        const patch = () => hunkPatch(diff, hunk);
        return (
          <div className="hunk-block" key={hunk.header + h} data-hunk={h}>
            <div className="hunk-strip">
              <span className="hunk-title">{hunk.header.replace(/^(@@[^@]*@@).*$/, "$1")}</span>
              {props.canStage && kind === "unstaged" && (
                <>
                  <button className="hunk-btn" onClick={() => props.onPatch(patch(), "discard")}>
                    Discard Hunk
                  </button>
                  <button className="hunk-btn stage" onClick={() => props.onPatch(patch(), "stage")}>
                    Stage Hunk
                  </button>
                </>
              )}
              {props.canStage && kind === "staged" && (
                <button className="hunk-btn" onClick={() => props.onPatch(patch(), "unstage")}>
                  Unstage Hunk
                </button>
              )}
              {props.canRevert && (
                <button className="hunk-btn" title="Apply the inverse of this hunk to your working directory" onClick={() => props.onPatch(patch(), "revert")}>
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
                  const look = looks[h][i];
                  return (
                    <tr key={i} className={`line ${line.kind}${look.pure ? " pure" : ""}${isSel ? " sel" : ""}`} onContextMenu={() => lineMenu(h, i)}>
                      <td className="ln old" onMouseDown={pick}>
                        {line.old}
                      </td>
                      <td className="ln new" onMouseDown={pick}>
                        {line.next}
                      </td>
                      <td className="sign" onMouseDown={pick}>
                        {line.kind === "add" ? "+" : line.kind === "del" ? "\u2013" : ""}
                      </td>
                      <td className="code" dangerouslySetInnerHTML={{ __html: html[h][i] }} />
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

const imageSrc = (image: ImageData) => `data:${image.mime};base64,${image.data}`;

function ImageView(props: { images: ImageSides }) {
  const { original, modified } = props.images;
  const [overlay, setOverlay] = useState(false);
  const [pos, setPos] = useState({ left: 10, top: 10 });
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  const start = (e: React.PointerEvent<HTMLImageElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, left: pos.left, top: pos.top };
  };
  const move = (e: React.PointerEvent<HTMLImageElement>) => {
    const from = drag.current;
    if (from) {
      setPos({ left: from.left + e.clientX - from.x, top: from.top + e.clientY - from.y });
    }
  };
  const stop = () => {
    drag.current = null;
  };

  return (
    <div className="diff-image">
      {modified && (
        <div>
          <div className="diff-image-header">
            <span>New image</span>
            {original && (
              <span
                className={`diff-image-overlay-button${overlay ? "" : " off"}`}
                title="Diff overlay old image"
                onClick={() => setOverlay(!overlay)}
              >
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">{I.image}</svg>
              </span>
            )}
          </div>
          <div className="diff-image-container">
            <img className="diff-image-img" src={imageSrc(modified)} />
            {overlay && original && (
              <img
                className="diff-image-overlay"
                src={imageSrc(original)}
                style={{ left: pos.left, top: pos.top }}
                draggable={false}
                onPointerDown={start}
                onPointerMove={move}
                onPointerUp={stop}
                onPointerCancel={stop}
              />
            )}
          </div>
        </div>
      )}
      {original && (
        <div>
          <div className="diff-image-header">
            <span>Old image</span>
          </div>
          <div className="diff-image-container">
            <img className="diff-image-img" src={imageSrc(original)} />
          </div>
        </div>
      )}
    </div>
  );
}

function FileView(props: {
  text: string;
  language: string;
  wrap: boolean;
  editing: boolean;
  editorRef: React.MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);
  useEffect(() => {
    const editor = monaco.editor.create(host.current as HTMLDivElement, {
      theme: "gitneat",
      automaticLayout: true,
      readOnly: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 12,
      lineHeight: 16,
      fontFamily: MONO,
    });
    props.editorRef.current = editor;
    return () => {
      editor.getModel()?.dispose();
      editor.dispose();
      props.editorRef.current = null;
    };
  }, []);
  useEffect(() => {
    const editor = props.editorRef.current;
    if (!editor) {
      return;
    }
    const model = editor.getModel();
    if (!model) {
      editor.setModel(monaco.editor.createModel(props.text, props.language));
    } else if ((!props.editing || !loaded.current) && model.getValue() !== props.text) {
      model.setValue(props.text);
    }
    loaded.current = true;
    if (model) {
      monaco.editor.setModelLanguage(model, props.language);
    }
  }, [props.text, props.language, props.editing]);
  useEffect(() => {
    props.editorRef.current?.updateOptions({ readOnly: !props.editing, wordWrap: props.wrap ? "on" : "off" });
  }, [props.editing, props.wrap]);
  return <div className="monaco-host" ref={host} />;
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
      theme: "gitneat",
      automaticLayout: true,
      readOnly: true,
      originalEditable: false,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 12,
      lineHeight: 16,
      fontFamily: MONO,
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
      const unstaged = ed.createContextKey<boolean>(`gitneatUnstaged${side}`, false);
      const staged = ed.createContextKey<boolean>(`gitneatStaged${side}`, false);
      const sync = () => {
        unstaged.set(latest.current.canStage && latest.current.kind === "unstaged");
        staged.set(latest.current.canStage && latest.current.kind === "staged");
      };
      sync();
      ed.onDidFocusEditorWidget(sync);
      ed.onContextMenu(sync);
      ed.addAction({ id: `gitneat.stage.${side}`, label: "Stage selected lines", contextMenuGroupId: "1_gitneat", precondition: `gitneatUnstaged${side}`, run: linesAction(side, "stage") });
      ed.addAction({ id: `gitneat.discard.${side}`, label: "Discard selected lines", contextMenuGroupId: "1_gitneat", precondition: `gitneatUnstaged${side}`, run: linesAction(side, "discard") });
      ed.addAction({ id: `gitneat.unstage.${side}`, label: "Unstage selected lines", contextMenuGroupId: "1_gitneat", precondition: `gitneatStaged${side}`, run: linesAction(side, "unstage") });
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
  const [history, setHistory] = useState<FileHistoryPage | null>(null);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const current = props.file.source.kind === "commit" ? props.file.source.sha : null;
  useEffect(() => {
    setPages(1);
    setHistory(null);
  }, [props.cwd, props.file.path]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    loadFileHistoryPage(props.cwd, props.file.path, pages).then(
      (h) => live && (setHistory(h), setLoading(false)),
      () => live && (setHistory({ commits: [], end: true, next: null }), setLoading(false)),
    );
    return () => {
      live = false;
    };
  }, [props.cwd, props.file.path, pages]);
  if (!history) {
    return <div className="diff-empty">Loading history…</div>;
  }
  let footer;
  if (loading) {
    footer = <div className="file-history-end">Loading…</div>;
  } else if (history.end || !history.next) {
    footer = <div className="file-history-end">End of History</div>;
  } else {
    footer = (
      <div className="file-history-end">
        <span>
          Searched until {new Date(history.next.time * 1000).toLocaleDateString()} ({history.next.sha.slice(0, 6)})
        </span>
        <button className="file-history-more" onClick={() => setPages(pages + 1)}>
          Go Deeper
        </button>
      </div>
    );
  }
  return (
    <div className="file-history">
      <div className="file-history-title">File History</div>
      {history.commits.map((c) => (
        <div key={c.sha} className={`history-row${c.sha === current ? " active" : ""}`} onClick={() => props.onOpenInCommit(c, props.file.path)}>
          <span className="history-sha">{c.sha.slice(0, 6)}</span>
          <span className="history-subject">{c.subject}</span>
          <span className="history-author">{c.author}</span>
          <span className="history-date">{new Date(c.time * 1000).toLocaleDateString()}</span>
        </div>
      ))}
      {footer}
    </div>
  );
}

export function DiffView(props: Props) {
  const { cwd, file, onClose, refreshKey } = props;
  const [mode, setMode] = useStored<DiffMode>("diff.mode", "hunk", (v) => v === "hunk" || v === "inline" || v === "split");
  const [view, setView] = useState<View>("diff");
  const [ignoreWs, setIgnoreWs] = useStored<boolean>("diff.ignoreWhitespace", false);
  const [wrap, setWrap] = useStored<boolean>("diff.wordWrap", false);
  const [diff, setDiff] = useState<ParsedDiff | null>(null);
  const [sides, setSides] = useState<DiffSides | null>(null);
  const [images, setImages] = useState<ImageSides | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const fileEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const sourceKey = JSON.stringify(file.source);
  const language = useMemo(() => (props.syntaxHighlighting === false ? "plaintext" : languageFor(file.path)), [file.path, props.syntaxHighlighting]);
  const kind = file.source.kind;

  useEffect(() => {
    setView(file.view ?? "diff");
    setEditing(!!file.edit);
    setWorking(null);
  }, [sourceKey, file.path, file.view, file.edit]);

  useEffect(() => {
    let live = true;
    setError(null);
    const imagePromise = isImagePath(file.path) ? loadImages(cwd, file.source, file.path, file.orig) : Promise.resolve(null);
    Promise.all([loadDiff(cwd, file.source, file.path, ignoreWs, file.orig), loadSides(cwd, file.source, file.path, file.orig), imagePromise]).then(
      ([t, s, i]) => {
        if (live) {
          setDiff(t);
          setSides(s);
          setImages(i);
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
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const binary = !!(diff?.binary || sides?.binary || isImagePath(file.path));
  const canStage = !ignoreWs && (kind === "unstaged" || kind === "staged");
  const status = !sides ? "M" : file.orig && file.orig !== file.path ? "R" : sides.original === "" && sides.modified !== "" ? "A" : sides.modified === "" && kind !== "unstaged" ? "D" : "M";

  const pickMode = (m: DiffMode) => {
    setMode(m);
    setView("diff");
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

  const editWorking = async () => {
    if (kind === "unstaged") {
      if (mode === "hunk") {
        pickMode("inline");
      }
      setView("diff");
      setEditing(true);
      return;
    }
    const content = await gitneat().readFile(cwd, file.path);
    setWorking(content ?? "");
    setView("file");
    setEditing(true);
  };

  const save = async () => {
    const value = view === "file" ? fileEditorRef.current?.getValue() : editorRef.current?.getModifiedEditor().getValue();
    if (value !== undefined && (await gitneat().writeFile(cwd, file.path, value))) {
      setEditing(false);
      setWorking(null);
    }
  };

  const cancel = () => {
    setEditing(false);
    setWorking(null);
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
  } else if (images && (images.original || images.modified)) {
    body = <ImageView images={images} />;
  } else if (binary) {
    body = <div className="diff-empty">Binary file</div>;
  } else if (view === "file") {
    body = (
      <FileView
        text={working ?? (status === "D" ? sides.original : sides.modified)}
        language={language}
        wrap={wrap}
        editing={editing}
        editorRef={fileEditorRef}
      />
    );
  } else if (mode === "hunk" && !editing) {
    body =
      diff.hunks.length === 0 ? (
        <div className="diff-empty">{status === "D" ? "File was deleted" : "File contents are unchanged"}</div>
      ) : (
        <HunkView diff={diff} sides={sides} language={language} kind={kind} wrap={wrap} canStage={canStage} canRevert={(kind === "commit" || kind === "worktree") && status === "M"} onPatch={props.onPatch} />
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
        <StatusIcon status={status} />
        <span className="diff-path">
          {slash >= 0 && <span className="dir">{file.path.slice(0, slash + 1)}</span>}
          {file.path.slice(slash + 1)}
          {file.orig && file.orig !== file.path && <span className="dir"> (renamed from {file.orig})</span>}
        </span>
        {!binary && <span className="diff-encoding">UTF-8</span>}
        <button className="icon-btn diff-close" title="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="diff-toolbar">
        <div className="tb-region tb-left">
          {!binary && !editing && view !== "blame" && view !== "history" && status !== "D" && (
            <button className="tb-btn edit" onClick={editWorking}>
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
                {I.edit}
              </svg>
              <span>{kind === "unstaged" ? "Edit This File" : "Edit in Working Directory"}</span>
            </button>
          )}
          {editing && (
            <span className="tb-group">
              <button className="tb-btn" onClick={cancel}>
                Cancel
              </button>
              <button className="tb-btn on" onClick={save}>
                Save Changes
              </button>
            </span>
          )}
        </div>
        <div className="tb-region tb-center">
          <span className="tb-group">
            <button className={`tb-btn${view === "file" ? " on" : ""}`} disabled={binary || (editing && view !== "file")} onClick={() => setView("file")}>
              File View
            </button>
            <button className={`tb-btn${view === "diff" ? " on" : ""}`} disabled={binary || (editing && view === "file")} onClick={() => setView("diff")}>
              Diff View
            </button>
          </span>
        </div>
        <div className="tb-region tb-right" data-testid="diff-options">
          <span className="tb-group">
            <button className={`tb-btn${view === "blame" ? " on" : ""}`} disabled={editing} onClick={() => setView(view === "blame" ? "diff" : "blame")}>
              Blame
            </button>
            <button className={`tb-btn${view === "history" ? " on" : ""}`} disabled={editing} onClick={() => setView(view === "history" ? "diff" : "history")}>
              History
            </button>
          </span>
          <span className="tb-group">
            <TbButton icon={I.up} title="Previous Change" disabled={disabled} onClick={() => jump(-1)} />
            <TbButton icon={I.down} title="Next Change" disabled={disabled} onClick={() => jump(1)} />
          </span>
          <span className="tb-group">
            <TbButton icon={I.hunk} title="Hunk View" on={view === "diff" && mode === "hunk" && !editing} disabled={binary || editing} onClick={() => pickMode("hunk")} />
            <TbButton icon={I.inline} title="Inline View" on={view === "diff" && mode === "inline"} disabled={binary || (editing && view === "file")} onClick={() => pickMode("inline")} />
            <TbButton icon={I.split} title="Split View" on={view === "diff" && mode === "split"} disabled={binary || (editing && view === "file")} onClick={() => pickMode("split")} />
          </span>
          <span className="tb-group">
            <TbButton
              icon={I.ws}
              title="Ignore Leading/Trailing Whitespace"
              on={ignoreWs}
              disabled={disabled}
              onClick={() => {
                setIgnoreWs(!ignoreWs);
              }}
            />
            <TbButton
              icon={I.wrap}
              title="Word Wrap"
              on={wrap}
              disabled={binary}
              onClick={() => {
                setWrap(!wrap);
              }}
            />
          </span>
        </div>
      </div>
      <div className="diff-body" ref={bodyRef}>
        {body}
      </div>
    </div>
  );
}
