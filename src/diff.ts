export type LineKind = "add" | "del" | "ctx";

export interface DiffLine {
  kind: LineKind;
  text: string;
  old?: number;
  next?: number;
  at?: number;
  noNewline?: boolean;
}

export interface Hunk {
  header: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export interface ParsedDiff {
  fileHeader: string;
  hunks: Hunk[];
  binary: boolean;
}

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

export function parseDiff(text: string): ParsedDiff {
  const lines = text.split("\n");
  const header: string[] = [];
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;
  let old = 0;
  let next = 0;
  let binary = false;
  for (const line of lines) {
    const m = HUNK_RE.exec(line);
    if (m) {
      old = Number(m[1]);
      next = Number(m[2]);
      current = { header: line, oldStart: old, newStart: next, lines: [] };
      hunks.push(current);
      continue;
    }
    if (!current) {
      if (line.startsWith("Binary files") || line.startsWith("GIT binary patch")) {
        binary = true;
      }
      if (line !== "") {
        header.push(line);
      }
      continue;
    }
    const c = line[0];
    if (c === "+") {
      current.lines.push({ kind: "add", text: line.slice(1), next: next++ });
    } else if (c === "-") {
      current.lines.push({ kind: "del", text: line.slice(1), old: old++, at: next });
    } else if (c === " ") {
      current.lines.push({ kind: "ctx", text: line.slice(1), old: old++, next: next++ });
    } else if (c === "\\" && current.lines.length) {
      current.lines[current.lines.length - 1].noNewline = true;
    }
  }
  return { fileHeader: header.join("\n"), hunks, binary };
}

function emit(line: DiffLine, sign: string): string {
  const out = `${sign}${line.text}`;
  return line.noNewline ? `${out}\n\\ No newline at end of file` : out;
}

export function hunkPatch(diff: ParsedDiff, hunk: Hunk): string {
  const body = hunk.lines.map((l) => emit(l, l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "));
  return `${diff.fileHeader}\n${hunk.header}\n${body.join("\n")}\n`;
}

export function linesPatch(diff: ParsedDiff, hunk: Hunk, selected: Set<number>, reverse: boolean): string | null {
  const body: string[] = [];
  let changes = 0;
  hunk.lines.forEach((line, i) => {
    if (line.kind === "ctx") {
      body.push(emit(line, " "));
      return;
    }
    if (selected.has(i)) {
      changes++;
      body.push(emit(line, line.kind === "add" ? "+" : "-"));
      return;
    }
    const keepAsContext = reverse ? line.kind === "add" : line.kind === "del";
    if (keepAsContext) {
      body.push(emit(line, " "));
    }
  });
  if (changes === 0) {
    return null;
  }
  return `${diff.fileHeader}\n${hunk.header}\n${body.join("\n")}\n`;
}

export function linesInRange(hunk: Hunk, side: "old" | "new", start: number, end: number): number[] {
  const picked: number[] = [];
  hunk.lines.forEach((line, i) => {
    if (line.kind === "ctx") {
      return;
    }
    const n = side === "old" ? line.old : line.kind === "add" ? line.next : line.at;
    if (n !== undefined && n >= start && n <= end && (side === "new" || line.kind === "del")) {
      picked.push(i);
    }
  });
  return picked;
}
