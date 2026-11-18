export interface GraphCommit {
  sha: string;
  parents: string[];
}

export interface Segment {
  x1: number;
  y1: "top" | "mid";
  x2: number;
  y2: "mid" | "bottom";
  color: number;
}

export interface GraphRow {
  col: number;
  color: number;
  segments: Segment[];
  width: number;
}

export function layoutGraph(commits: GraphCommit[]): GraphRow[] {
  const lanes: (string | null)[] = [];
  const rows: GraphRow[] = [];

  const freeSlot = (exclude: number): number => {
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === null && i !== exclude) {
        return i;
      }
    }
    lanes.push(null);
    return lanes.length - 1;
  };

  const seg = (x1: number, y1: Segment["y1"], x2: number, y2: Segment["y2"]): Segment => ({ x1, y1, x2, y2, color: Math.max(x1, x2) });

  for (const commit of commits) {
    const segments: Segment[] = [];
    const top = lanes.slice();
    const incoming: number[] = [];
    top.forEach((sha, i) => {
      if (sha === commit.sha) {
        incoming.push(i);
      }
    });

    const col = incoming.length === 0 ? freeSlot(-1) : incoming[0];

    for (const i of incoming) {
      segments.push(seg(i, "top", col, "mid"));
      if (i !== col) {
        lanes[i] = null;
      }
    }

    const [first, ...rest] = commit.parents;
    lanes[col] = first ?? null;
    if (first !== undefined) {
      segments.push(seg(col, "mid", col, "bottom"));
    }

    for (const parent of rest) {
      let slot = lanes.indexOf(parent);
      if (slot < 0) {
        slot = freeSlot(col);
        lanes[slot] = parent;
      }
      segments.push(seg(col, "mid", slot, "bottom"));
    }

    top.forEach((sha, i) => {
      if (sha !== null && sha !== commit.sha) {
        segments.push(seg(i, "top", i, "bottom"));
      }
    });

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop();
    }
    rows.push({ col, color: col, segments, width: Math.max(top.length, lanes.length, col + 1) });
  }
  return rows;
}
