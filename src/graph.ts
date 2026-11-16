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
  const colors: number[] = [];
  let nextColor = 0;
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

  for (const commit of commits) {
    const segments: Segment[] = [];
    const top = lanes.slice();
    const incoming: number[] = [];
    top.forEach((sha, i) => {
      if (sha === commit.sha) {
        incoming.push(i);
      }
    });

    let col: number;
    if (incoming.length === 0) {
      col = freeSlot(-1);
      colors[col] = nextColor++;
    } else {
      col = incoming[0];
    }
    const color = colors[col];

    for (const i of incoming) {
      segments.push({ x1: i, y1: "top", x2: col, y2: "mid", color: colors[i] });
      if (i !== col) {
        lanes[i] = null;
      }
    }

    const [first, ...rest] = commit.parents;
    lanes[col] = first ?? null;
    if (first !== undefined) {
      segments.push({ x1: col, y1: "mid", x2: col, y2: "bottom", color });
    }

    for (const parent of rest) {
      let slot = lanes.indexOf(parent);
      if (slot < 0) {
        slot = freeSlot(col);
        lanes[slot] = parent;
        colors[slot] = nextColor++;
      }
      segments.push({ x1: col, y1: "mid", x2: slot, y2: "bottom", color: colors[slot] });
    }

    top.forEach((sha, i) => {
      if (sha !== null && sha !== commit.sha) {
        segments.push({ x1: i, y1: "top", x2: i, y2: "bottom", color: colors[i] });
      }
    });

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop();
    }
    rows.push({ col, color, segments, width: Math.max(top.length, lanes.length, col + 1) });
  }
  return rows;
}
