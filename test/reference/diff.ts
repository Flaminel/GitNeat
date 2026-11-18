import type { Hunk, ParsedDiff } from "../../src/diff";

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
