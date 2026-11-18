import type { Segment } from "../../src/merge";

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

