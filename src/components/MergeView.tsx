import { useEffect, useMemo, useRef, useState } from "react";
import * as A from "../actions";
import { Ctx } from "../actions";
import { allTaken, buildOutput, Segment, Selection, sideLines, sideTaken, takeAll, togglePick, toggleSide } from "../merge";
import { languageFor, monaco } from "../monaco";
import { loadMerge, MergeLoad } from "../repo";
import { showMenu } from "../ui";
import { StatusIcon } from "./DetailPanel";
import { MONO } from "./DiffView";

type Conflict = Extract<Segment, { kind: "conflict" }>;

const COLORS = { a: "merge-a", b: "merge-b" };

function Editors(props: { ctx: Ctx; path: string; segments: Segment[]; bName: string; onClose(): void }) {
  const { ctx, path, segments } = props;
  const [sels, setSels] = useState<Selection[]>(() => segments.flatMap((s) => (s.kind === "conflict" ? [undefined] : [])));
  const [cur, setCur] = useState(0);
  const hosts = { a: useRef<HTMLDivElement>(null), b: useRef<HTMLDivElement>(null), out: useRef<HTMLDivElement>(null) };
  const eds = useRef<{ a: monaco.editor.IStandaloneCodeEditor; b: monaco.editor.IStandaloneCodeEditor; out: monaco.editor.IStandaloneCodeEditor } | null>(null);
  const zones = useRef<string[]>([]);
  const decos = useRef<Record<"a" | "b" | "out", monaco.editor.IEditorDecorationsCollection | null>>({ a: null, b: null, out: null });
  const lines = useMemo(() => ({ a: sideLines(segments, "a"), b: sideLines(segments, "b") }), [segments]);
  const conflicts = useMemo(() => segments.filter((s): s is Conflict => s.kind === "conflict"), [segments]);
  const built = useMemo(() => buildOutput(segments, sels), [segments, sels]);
  const language = useMemo(() => languageFor(path), [path]);
  const latest = useRef({ sels, conflicts, lines, built });
  latest.current = { sels, conflicts, lines, built };
  const save = useRef<() => void>(() => undefined);

  const mouse = (side: "a" | "b") => (e: monaco.editor.IEditorMouseEvent) => {
    const t = e.target;
    if (t.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || !t.position) {
      return;
    }
    const { conflicts: list, lines: ls } = latest.current;
    const line = t.position.lineNumber;
    const i = ls[side].starts.findIndex((start, k) => line >= start && line < start + list[k][side].length);
    if (i < 0) {
      return;
    }
    const start = ls[side].starts[i];
    const count = list[i][side].length;
    const hunk = t.detail.glyphMarginLane === monaco.editor.GlyphMarginLane.Left;
    setSels((all) => all.map((s, k) => (k !== i ? s : hunk ? toggleSide(s, side, count) : togglePick(s, { side, line: line - start }))));
    setCur(i);
  };

  useEffect(() => {
    const make = (host: HTMLDivElement | null, readOnly: boolean) =>
      monaco.editor.create(host as HTMLDivElement, {
        theme: "gitneat",
        language,
        readOnly,
        automaticLayout: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        fontSize: 12,
        lineHeight: 16,
        fontFamily: MONO,
        glyphMargin: true,
        renderLineHighlight: "none",
      });
    const a = make(hosts.a.current, true);
    const b = make(hosts.b.current, true);
    const out = make(hosts.out.current, false);
    eds.current = { a, b, out };
    decos.current = { a: a.createDecorationsCollection(), b: b.createDecorationsCollection(), out: out.createDecorationsCollection() };
    let syncing = false;
    const sync = (from: monaco.editor.ICodeEditor, to: monaco.editor.ICodeEditor) =>
      from.onDidScrollChange((e) => {
        if (syncing || !e.scrollTopChanged) {
          return;
        }
        syncing = true;
        to.setScrollTop(e.scrollTop);
        syncing = false;
      });
    const subs = [sync(a, b), sync(b, a), a.onMouseDown(mouse("a")), b.onMouseDown(mouse("b"))];
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        save.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      subs.forEach((s) => s.dispose());
      [a, b, out].forEach((ed) => {
        ed.getModel()?.dispose();
        ed.dispose();
      });
    };
  }, [language]);

  useEffect(() => {
    const e = eds.current;
    if (!e) {
      return;
    }
    for (const side of ["a", "b"] as const) {
      const ed = e[side];
      if (ed.getValue() !== lines[side].lines.join("\n")) {
        ed.setValue(lines[side].lines.join("\n"));
      }
      const items: monaco.editor.IModelDeltaDecoration[] = [];
      conflicts.forEach((c, i) => {
        const list = c[side];
        const start = lines[side].starts[i];
        const taken = sels[i]?.filter((p) => p.side === side).map((p) => p.line) ?? [];
        list.forEach((_, j) => {
          const first = j === 0;
          const hunkOn = sideTaken(sels[i], side, list.length);
          items.push({
            range: new monaco.Range(start + j, 1, start + j, 1),
            options: {
              isWholeLine: true,
              className: `${COLORS[side]}-fill`,
              linesDecorationsClassName: `${COLORS[side]}-bar`,
              glyphMarginClassName: `merge-cb${taken.includes(j) ? " on" : ""}`,
              glyphMargin: { position: monaco.editor.GlyphMarginLane.Right },
              glyphMarginHoverMessage: { value: taken.includes(j) ? "Don't take this line" : "Take this line" },
            },
          });
          if (first) {
            items.push({
              range: new monaco.Range(start, 1, start, 1),
              options: {
                glyphMarginClassName: `merge-cb hunk${hunkOn ? " on" : ""}`,
                glyphMargin: { position: monaco.editor.GlyphMarginLane.Left },
                glyphMarginHoverMessage: { value: hunkOn ? "Don't take this hunk" : "Take this hunk" },
              },
            });
          }
        });
      });
      decos.current[side]?.set(items);
    }
  }, [lines, conflicts, sels]);

  useEffect(() => {
    const e = eds.current;
    if (!e) {
      return;
    }
    e.out.setValue(built.text);
    decos.current.out?.set(
      built.ranges.flatMap((r) =>
        r.end >= r.start
          ? [
              {
                range: new monaco.Range(r.start, 1, r.end, 1),
                options: { isWholeLine: true, className: "merge-out-fill", linesDecorationsClassName: "merge-out-bar" },
              },
            ]
          : [],
      ),
    );
    e.out.changeViewZones((acc) => {
      zones.current.forEach((id) => acc.removeZone(id));
      zones.current = built.ranges.flatMap((r, i) => {
        if (sels[i]) {
          return [];
        }
        const node = document.createElement("div");
        node.className = "merge-placeholder";
        node.textContent = "Unresolved conflict";
        return [acc.addZone({ afterLineNumber: r.start - 1, heightInPx: 18, domNode: node })];
      });
    });
  }, [built, sels]);

  const go = (i: number) => {
    const e = eds.current;
    const n = (i + conflicts.length) % conflicts.length;
    setCur(n);
    e?.a.revealLineInCenter(lines.a.starts[n]);
    e?.out.revealLineInCenter(Math.max(1, built.ranges[n].start));
  };

  const finish = async () => {
    const e = eds.current;
    if (!e) {
      return;
    }
    let text = e.out.getValue();
    if (sels.some((s) => !s)) {
      let choice = "";
      await showMenu([
        { label: "You have unresolved conflicts. How would you like to proceed?", enabled: false },
        "-",
        { label: "Save Output", run: () => (choice = "save") },
        { label: "Create Conflict Chunks", run: () => (choice = "chunks") },
        { label: "Cancel" },
      ]);
      if (!choice) {
        return;
      }
      if (choice === "chunks") {
        text = buildOutput(segments, sels, true).text;
      }
    }
    if (await A.saveResolved(ctx, path, text)) {
      props.onClose();
    }
  };
  save.current = () => void finish();

  const head = (side: "a" | "b", name: string) => {
    const on = allTaken(segments, sels, side);
    return (
      <div className="merge-head">
        <span className={`merge-badge ${side}`}>{side.toUpperCase()}</span>
        <span className="merge-name" title={name}>
          {name}
        </span>
        <label className="merge-take" title={on ? "Untake all" : "Take all"}>
          <input type="checkbox" checked={on} onChange={() => setSels(takeAll(segments, sels, side))} />
          {on ? "Untake all" : "Take all"}
        </label>
      </div>
    );
  };

  return (
    <div className="merge-body">
      <div className="merge-top">
        <div className="merge-pane">
          {head("a", ctx.data.branch ?? "A")}
          <div className="merge-host" ref={hosts.a} />
        </div>
        <div className="merge-pane merge-right">
          {head("b", props.bName)}
          <div className="merge-host" ref={hosts.b} />
        </div>
      </div>
      <div className="merge-pane merge-output">
        <div className="merge-head">
          <span className="merge-title">Output</span>
          <span className="merge-count">
            conflict {conflicts.length ? cur + 1 : 0} of {conflicts.length}
          </span>
          <button className="icon-btn" title="Previous conflict" disabled={!conflicts.length} onClick={() => go(cur - 1)}>
            ↑
          </button>
          <button className="icon-btn" title="Next conflict" disabled={!conflicts.length} onClick={() => go(cur + 1)}>
            ↓
          </button>
          <span className="merge-spacer" />
          {sels.some(Boolean) && (
            <button className="primary btn-xs" onClick={() => setSels(sels.map(() => undefined))}>
              Reset
            </button>
          )}
          <button className="success btn-xs" onClick={finish}>
            Save Output
          </button>
        </div>
        <div className="merge-host" ref={hosts.out} />
      </div>
    </div>
  );
}

export function MergeView(props: { ctx: Ctx; path: string; onClose(): void }) {
  const { ctx, path, onClose } = props;
  const [loaded, setLoaded] = useState<MergeLoad | null>(null);
  const [error, setError] = useState<string | null>(null);
  const slash = path.lastIndexOf("/");

  useEffect(() => {
    let live = true;
    setLoaded(null);
    loadMerge(ctx.cwd, path, ctx.data.operation).then(
      (l) => live && setLoaded(l),
      (e) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [ctx.cwd, path]);

  const resolve = async (how: "ours" | "theirs" | "delete") => {
    if (await A.resolveFile(ctx, path, how)) {
      onClose();
    }
  };

  let body;
  if (error) {
    body = <div className="merge-center">{error}</div>;
  } else if (!loaded) {
    body = <div className="merge-center">Loading…</div>;
  } else if (loaded.kind === "text") {
    body = <Editors ctx={ctx} path={path} segments={loaded.segments} bName={loaded.bName} onClose={onClose} />;
  } else if (loaded.kind === "binary") {
    body = (
      <div className="merge-center">
        <h3>Binary File</h3>
        <div className="merge-actions">
          <button className="primary" onClick={() => resolve("ours")}>
            Take A
          </button>
          <button className="primary" onClick={() => resolve("theirs")}>
            Take B
          </button>
        </div>
      </div>
    );
  } else {
    const keep = loaded.missing === "a" ? "theirs" : "ours";
    body = (
      <div className="merge-center">
        <h3>{loaded.missing === "a" ? "Deleted in A, modified in B" : "Modified in A, deleted in B"}</h3>
        <div className="merge-actions">
          <button className="primary" onClick={() => resolve(keep)}>
            Keep Modified Version
          </button>
          <button className="danger" onClick={() => resolve("delete")}>
            Delete The File
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="diff-view merge-view">
      <div className="diff-path-bar">
        <StatusIcon status="U" />
        <span className="diff-path">
          {slash >= 0 && <span className="dir">{path.slice(0, slash + 1)}</span>}
          {path.slice(slash + 1)}
        </span>
        <button className="icon-btn diff-close" title="Close" onClick={onClose}>
          ×
        </button>
      </div>
      {body}
    </div>
  );
}
