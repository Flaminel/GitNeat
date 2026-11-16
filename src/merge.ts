export type Segment = { kind: "common"; lines: string[] } | { kind: "conflict"; a: string[]; base: string[]; b: string[] };

export interface Pick {
  side: "a" | "b";
  line: number;
}

export type Selection = Pick[] | undefined;

export interface Built {
  text: string;
  ranges: { start: number; end: number }[];
}

export function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

export function parseMerge(text: string): Segment[] {
  const segments: Segment[] = [];
  let part: "common" | "a" | "base" | "b" = "common";
  let common: string[] = [];
  let a: string[] = [];
  let base: string[] = [];
  let b: string[] = [];
  for (const line of splitLines(text)) {
    if (part === "common" && line.startsWith("<<<<<<< ")) {
      if (common.length) {
        segments.push({ kind: "common", lines: common });
      }
      common = [];
      a = [];
      base = [];
      b = [];
      part = "a";
    } else if (part === "a" && line.startsWith("||||||| ")) {
      part = "base";
    } else if ((part === "a" || part === "base") && line === "=======") {
      part = "b";
    } else if (part === "b" && line.startsWith(">>>>>>> ")) {
      segments.push({ kind: "conflict", a, base, b });
      part = "common";
    } else {
      (part === "common" ? common : part === "a" ? a : part === "base" ? base : b).push(line);
    }
  }
  if (common.length) {
    segments.push({ kind: "common", lines: common });
  }
  return segments;
}

export function sideLines(segments: Segment[], side: "a" | "b"): { lines: string[]; starts: number[] } {
  const lines: string[] = [];
  const starts: number[] = [];
  for (const s of segments) {
    if (s.kind === "common") {
      lines.push(...s.lines);
    } else {
      starts.push(lines.length + 1);
      lines.push(...s[side]);
    }
  }
  return { lines, starts };
}

export function buildOutput(segments: Segment[], selections: Selection[], markers = false): Built {
  const out: string[] = [];
  const ranges: { start: number; end: number }[] = [];
  let n = 0;
  for (const s of segments) {
    if (s.kind === "common") {
      out.push(...s.lines);
      continue;
    }
    const pick = selections[n++];
    const start = out.length + 1;
    if (pick) {
      out.push(...pick.map((p) => s[p.side][p.line]));
    } else if (markers) {
      out.push("<<<<<<< A", ...s.a, "=======", ...s.b, ">>>>>>> B");
    }
    ranges.push({ start, end: out.length });
  }
  return { text: out.length ? out.join("\n") + "\n" : "", ranges };
}

export function togglePick(sel: Selection, p: Pick): Selection {
  const cur = sel ?? [];
  const at = cur.findIndex((x) => x.side === p.side && x.line === p.line);
  const next = at >= 0 ? cur.filter((_, i) => i !== at) : [...cur, p];
  return next.length ? next : undefined;
}

function removeSide(sel: Selection, side: "a" | "b"): Selection {
  const next = (sel ?? []).filter((x) => x.side !== side);
  return next.length ? next : undefined;
}

export const sideTaken = (sel: Selection, side: "a" | "b", count: number): boolean =>
  count > 0 && !!sel && sel.filter((x) => x.side === side).length === count;

export function toggleSide(sel: Selection, side: "a" | "b", count: number): Selection {
  if (sideTaken(sel, side, count)) {
    return removeSide(sel, side);
  }
  const cur = sel ?? [];
  const missing = Array.from({ length: count }, (_, line) => line).filter((line) => !cur.some((x) => x.side === side && x.line === line));
  return [...cur, ...missing.map((line) => ({ side, line }))];
}

const counts = (segments: Segment[], side: "a" | "b") => segments.flatMap((s) => (s.kind === "conflict" ? [s[side].length] : []));

export function allTaken(segments: Segment[], sels: Selection[], side: "a" | "b"): boolean {
  const n = counts(segments, side);
  return n.some((c) => c > 0) && n.every((c, i) => c === 0 || sideTaken(sels[i], side, c));
}

export function takeAll(segments: Segment[], sels: Selection[], side: "a" | "b"): Selection[] {
  const full = allTaken(segments, sels, side);
  return counts(segments, side).map((c, i) => (full ? removeSide(sels[i], side) : toggleSide(sels[i], side, c)));
}
