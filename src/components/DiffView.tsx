import { ReactElement, useEffect, useMemo, useState } from "react";
import { loadDiff } from "../repo";
import { OpenFile } from "./DetailPanel";

type Mode = "unified" | "split";
type Kind = "add" | "del" | "ctx";

type Row =
  | { t: "hunk"; text: string }
  | { t: "meta"; text: string }
  | { t: "line"; kind: Kind; old?: number; next?: number; text: string };

const MODE_KEY = "krill.diffMode";
const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/;

function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === "split" ? "split" : "unified";
  } catch {
    return "unified";
  }
}

export type HunkAction = "stage" | "unstage" | "discard";

function hunkPatches(text: string): string[] {
  const lines = text.split("\n");
  const first = lines.findIndex((l) => HUNK_RE.test(l));
  if (first < 0) {
    return [];
  }
  const header = lines.slice(0, first).join("\n");
  const patches: string[] = [];
  let current: string[] = [];
  for (const line of lines.slice(first)) {
    if (HUNK_RE.test(line) && current.length) {
      patches.push(`${header}\n${current.join("\n")}\n`);
      current = [];
    }
    if (line !== "" || current.length === 0) {
      current.push(line);
    }
  }
  if (current.length) {
    patches.push(`${header}\n${current.join("\n")}\n`);
  }
  return patches;
}

function parseDiff(text: string): Row[] | "binary" {
  const rows: Row[] = [];
  let started = false;
  let old = 0;
  let next = 0;
  for (const line of text.split("\n")) {
    const m = HUNK_RE.exec(line);
    if (m) {
      started = true;
      old = Number(m[1]);
      next = Number(m[2]);
      rows.push({ t: "hunk", text: line });
      continue;
    }
    if (!started) {
      if (line.startsWith("Binary files")) {
        return "binary";
      }
      continue;
    }
    const c = line[0];
    if (c === "+") {
      rows.push({ t: "line", kind: "add", next: next++, text: line.slice(1) });
    } else if (c === "-") {
      rows.push({ t: "line", kind: "del", old: old++, text: line.slice(1) });
    } else if (c === " ") {
      rows.push({ t: "line", kind: "ctx", old: old++, next: next++, text: line.slice(1) });
    } else if (c === "\\") {
      rows.push({ t: "meta", text: line });
    }
  }
  return rows;
}

type Line = Extract<Row, { t: "line" }>;
type SplitRow = { t: "hunk"; text: string } | { t: "meta"; text: string } | { t: "pair"; left?: Line; right?: Line };

function toSplit(rows: Row[]): SplitRow[] {
  const out: SplitRow[] = [];
  let dels: Line[] = [];
  let adds: Line[] = [];
  const flush = () => {
    const n = Math.max(dels.length, adds.length);
    for (let i = 0; i < n; i++) {
      out.push({ t: "pair", left: dels[i], right: adds[i] });
    }
    dels = [];
    adds = [];
  };
  for (const r of rows) {
    if (r.t === "line" && r.kind === "del") {
      dels.push(r);
    } else if (r.t === "line" && r.kind === "add") {
      adds.push(r);
    } else {
      flush();
      if (r.t === "line") {
        out.push({ t: "pair", left: r, right: r });
      } else {
        out.push(r);
      }
    }
  }
  flush();
  return out;
}

function Side({ line, side }: { line?: Line; side: "left" | "right" }) {
  const n = line ? (side === "left" ? line.old : line.next) : undefined;
  return (
    <>
      <td className="ln">{n}</td>
      <td className={"code " + (line ? line.kind : "empty")}>{line?.text}</td>
    </>
  );
}

export function DiffView(props: { cwd: string; file: OpenFile; onClose(): void; refreshKey: number; onHunk?(patch: string, action: HunkAction): void }) {
  const { cwd, file, onClose, refreshKey, onHunk } = props;
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(readMode);
  const source = JSON.stringify(file.source);

  useEffect(() => {
    let live = true;
    setError(null);
    loadDiff(cwd, file.source, file.path).then(
      (t) => {
        if (live) {
          setText(t);
        }
      },
      (e) => {
        if (live) {
          setError(e instanceof Error ? e.message : String(e));
        }
      },
    );
    return () => {
      live = false;
    };
  }, [cwd, source, file.path, refreshKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (e.key !== "Escape" || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pick = (m: Mode) => {
    setMode(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {}
  };

  const parsed = useMemo(() => (text === null ? null : parseDiff(text)), [text]);
  const split = useMemo(() => (parsed && parsed !== "binary" ? toSplit(parsed) : []), [parsed]);
  const patches = useMemo(() => (text ? hunkPatches(text) : []), [text]);
  const kind = file.source.kind;
  let hunkIndex = -1;
  const hunkButtons = (index: number) => {
    const patch = patches[index];
    if (!onHunk || !patch || kind === "commit") {
      return null;
    }
    return (
      <span className="hunk-actions">
        {kind === "unstaged" && (
          <button className="hunk-btn discard" onClick={() => onHunk(patch, "discard")}>
            Discard Hunk
          </button>
        )}
        <button className="hunk-btn" onClick={() => onHunk(patch, kind === "staged" ? "unstage" : "stage")}>
          {kind === "staged" ? "Unstage Hunk" : "Stage Hunk"}
        </button>
      </span>
    );
  };

  let body: ReactElement;
  if (error) {
    body = <div className="diff-empty">{error}</div>;
  } else if (parsed === null) {
    body = <div className="diff-empty">Loading…</div>;
  } else if (parsed === "binary") {
    body = <div className="diff-empty">Binary file not shown</div>;
  } else if (parsed.length === 0) {
    body = <div className="diff-empty">No changes</div>;
  } else if (mode === "unified") {
    body = (
      <table className="diff-table">
        <tbody>
          {parsed.map((r, i) => {
            if (r.t === "hunk") {
              return (
                <tr key={i} className="hunk">
                  <td colSpan={3}>
                    {r.text}
                    {hunkButtons(++hunkIndex)}
                  </td>
                </tr>
              );
            }
            if (r.t === "meta") {
              return (
                <tr key={i} className="line meta">
                  <td className="ln"></td>
                  <td className="ln"></td>
                  <td className="code">{r.text}</td>
                </tr>
              );
            }
            return (
              <tr key={i} className={"line " + r.kind}>
                <td className="ln">{r.old}</td>
                <td className="ln">{r.next}</td>
                <td className="code">
                  <span className="sign">{r.kind === "add" ? "+" : r.kind === "del" ? "-" : " "}</span>
                  {r.text}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  } else {
    body = (
      <table className="diff-table split">
        <tbody>
          {split.map((r, i) => {
            if (r.t === "hunk") {
              return (
                <tr key={i} className="hunk">
                  <td colSpan={4}>
                    {r.text}
                    {hunkButtons(++hunkIndex)}
                  </td>
                </tr>
              );
            }
            if (r.t === "meta") {
              return (
                <tr key={i} className="line meta">
                  <td colSpan={4} className="code">
                    {r.text}
                  </td>
                </tr>
              );
            }
            return (
              <tr key={i} className="line">
                <Side line={r.left} side="left" />
                <Side line={r.right} side="right" />
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  return (
    <div className="diff-view">
      <div className="diff-header">
        <span className="diff-path">{file.path}</span>
        <span className="segmented small">
          <button className={mode === "unified" ? "on" : ""} onClick={() => pick("unified")}>
            Hunk
          </button>
          <button className={mode === "split" ? "on" : ""} onClick={() => pick("split")}>
            Split
          </button>
        </span>
        <button className="icon-btn diff-close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="diff-body">{body}</div>
    </div>
  );
}
