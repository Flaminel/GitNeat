import { memo, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { GraphRow, Segment } from "../graph";
import { Commit, Ref } from "../repo";

export const ROW_HEIGHT = 28;
const LANE = 18;
const PAD = 14;
export const LANE_COLORS = 10;
export const WIP = "WIP";

interface Props {
  commits: Commit[];
  rows: GraphRow[];
  refs: Ref[];
  head: string | null;
  selected: string | null;
  onSelect(sha: string): void;
  onCommitMenu(commit: Commit, e: MouseEvent): void;
  onRefMenu(ref: Ref, e: MouseEvent): void;
  onRefOpen(ref: Ref): void;
  wipCount: number;
}

const laneX = (i: number) => PAD + i * LANE;

function path(s: Segment): string {
  const y1 = s.y1 === "top" ? 0 : ROW_HEIGHT / 2;
  const y2 = s.y2 === "mid" ? ROW_HEIGHT / 2 : ROW_HEIGHT;
  const x1 = laneX(s.x1);
  const x2 = laneX(s.x2);
  if (x1 === x2) {
    return `M${x1} ${y1}V${y2}`;
  }
  const ym = (y1 + y2) / 2;
  return `M${x1} ${y1}C${x1} ${ym} ${x2} ${ym} ${x2} ${y2}`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

export function relativeTime(seconds: number): string {
  const diff = Date.now() / 1000 - seconds;
  const day = 86400;
  if (diff < 3600) {
    return "an hour ago";
  }
  if (diff < day) {
    return `${Math.round(diff / 3600)} hours ago`;
  }
  if (diff < 2 * day) {
    return "yesterday";
  }
  if (diff < 7 * day) {
    return `${Math.round(diff / day)} days ago`;
  }
  if (diff < 14 * day) {
    return "a week ago";
  }
  if (diff < 30 * day) {
    return `${Math.round(diff / (7 * day))} weeks ago`;
  }
  if (diff < 60 * day) {
    return "a month ago";
  }
  if (diff < 365 * day) {
    return `${Math.round(diff / (30 * day))} months ago`;
  }
  return diff < 730 * day ? "a year ago" : `${Math.round(diff / (365 * day))} years ago`;
}

const Icon = {
  local: (
    <svg viewBox="0 0 16 16" className="icon">
      <path d="M3 3h10v7H3z M1 12h14v1H1z" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  ),
  remote: (
    <svg viewBox="0 0 16 16" className="icon">
      <path d="M4.5 12.5h7a3 3 0 0 0 .3-6 4 4 0 0 0-7.6-1A3.5 3.5 0 0 0 4.5 12.5z" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  ),
  tag: (
    <svg viewBox="0 0 16 16" className="icon">
      <path d="M2 2h6l6 6-6 6-6-6z" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="5.5" cy="5.5" r="1.2" fill="currentColor" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 16 16" className="icon">
      <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  ),
};

interface Pill {
  key: string;
  label: string;
  ref: Ref;
  local: boolean;
  remote: boolean;
  tag: boolean;
  current: boolean;
}

function pillsFor(refs: Ref[]): Pill[] {
  const pills: Pill[] = [];
  const locals = refs.filter((r) => r.kind === "local");
  const remotes = refs.filter((r) => r.kind === "remote");
  const used = new Set<string>();
  for (const l of locals) {
    const twin = remotes.find((r) => r.name === l.upstream || r.name.split("/").slice(1).join("/") === l.name);
    if (twin) {
      used.add(twin.full);
    }
    pills.push({ key: l.full, label: l.name, ref: l, local: true, remote: !!twin, tag: false, current: !!l.current });
  }
  for (const r of remotes) {
    if (!used.has(r.full)) {
      pills.push({ key: r.full, label: r.name, ref: r, local: false, remote: true, tag: false, current: false });
    }
  }
  for (const t of refs.filter((r) => r.kind === "tag")) {
    pills.push({ key: t.full, label: t.name, ref: t, local: false, remote: false, tag: true, current: false });
  }
  return pills.sort((a, b) => Number(b.current) - Number(a.current));
}

const RowView = memo(function RowView(props: {
  commit: Commit;
  row: GraphRow;
  index: number;
  pills: Pill[];
  graphWidth: number;
  refsWidth: number;
  selected: boolean;
  isHead: boolean;
  dateLabel: string | null;
  wipCount: number;
  onSelect(sha: string): void;
  onCommitMenu(commit: Commit, e: MouseEvent): void;
  onRefMenu(ref: Ref, e: MouseEvent): void;
  onRefOpen(ref: Ref): void;
}) {
  const { commit, row, pills } = props;
  const color = `var(--lane-${row.color % LANE_COLORS})`;
  const cx = laneX(row.col);
  const cy = ROW_HEIGHT / 2;
  const isWip = commit.sha === WIP;
  const isMerge = commit.parents.length > 1;
  const first = pills[0];
  return (
    <div
      className={`row${props.selected ? " selected" : ""}${isWip ? " wip" : ""}`}
      style={{ top: props.index * ROW_HEIGHT, ["--row-color" as string]: color }}
      onMouseDown={() => props.onSelect(commit.sha)}
      onContextMenu={(e) => {
        props.onSelect(commit.sha);
        props.onCommitMenu(commit, e);
      }}
    >
      <div className="cell refs" style={{ width: props.refsWidth }}>
        {first && (
          <>
            <span
              className={`pill${first.current ? " current" : ""}`}
              title={pills.map((p) => p.label).join("\n")}
              onContextMenu={(e) => {
                e.stopPropagation();
                props.onSelect(commit.sha);
                props.onRefMenu(first.ref, e);
              }}
              onDoubleClick={() => props.onRefOpen(first.ref)}
            >
              {first.current && Icon.check}
              <span className="pill-label">{first.label}</span>
              {first.local && Icon.local}
              {first.remote && Icon.remote}
              {first.tag && Icon.tag}
            </span>
            {pills.length > 1 && <span className="pill more">+{pills.length - 1}</span>}
            <span className="pill-line" />
          </>
        )}
      </div>
      <div className="cell graph" style={{ width: props.graphWidth }}>
        <svg width={props.graphWidth} height={ROW_HEIGHT}>
          {first && <line x1={0} y1={cy} x2={cx} y2={cy} stroke={color} strokeWidth={2} />}
          {row.segments.map((s, i) => (
            <path
              key={i}
              d={path(s)}
              stroke={`var(--lane-${s.color % LANE_COLORS})`}
              strokeWidth={2}
              fill="none"
              strokeDasharray={isWip && s.y1 === "mid" ? "3 3" : undefined}
            />
          ))}
          {isWip ? (
            <circle cx={cx} cy={cy} r={8} fill="var(--bg)" stroke={color} strokeWidth={2} strokeDasharray="3 2" />
          ) : commit.stash ? (
            <rect x={cx - 7} y={cy - 7} width={14} height={14} rx={3} fill="var(--bg)" stroke={color} strokeWidth={2} strokeDasharray="3 2" />
          ) : isMerge ? (
            <circle cx={cx} cy={cy} r={5} fill={color} />
          ) : (
            <g>
              <circle cx={cx} cy={cy} r={10} fill={color} />
              <circle cx={cx} cy={cy} r={8} fill="var(--avatar-bg)" />
              <text x={cx} y={cy + 3} textAnchor="middle" className="avatar-text">
                {initials(commit.author)}
              </text>
            </g>
          )}
        </svg>
      </div>
      <div className="cell message">
        {isWip ? (
          <span className="wip-label">
            // WIP <span className="wip-count">{props.wipCount}</span>
          </span>
        ) : (
          <span className={props.isHead ? "head-msg" : undefined}>{commit.subject}</span>
        )}
        {props.dateLabel && <span className="date-pill">{props.dateLabel}</span>}
      </div>
    </div>
  );
});

export function GraphView(props: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(800);
  const [refsWidth, setRefsWidth] = useState(220);

  useEffect(() => {
    const el = scroller.current;
    if (!el) {
      return;
    }
    const observer = new ResizeObserver(() => setHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const refsBySha = useMemo(() => {
    const map = new Map<string, Ref[]>();
    for (const ref of props.refs) {
      map.set(ref.sha, [...(map.get(ref.sha) ?? []), ref]);
    }
    return map;
  }, [props.refs]);

  const graphWidth = useMemo(() => {
    const lanes = props.rows.reduce((max, r) => Math.max(max, r.width), 1);
    return Math.min(PAD * 2 + (lanes - 1) * LANE, 360);
  }, [props.rows]);

  const dateLabels = useMemo(() => {
    let previous = "";
    return props.commits.map((c) => {
      if (c.sha === WIP) {
        return null;
      }
      const label = relativeTime(c.time);
      const show = label !== previous;
      previous = label;
      return show ? label : null;
    });
  }, [props.commits]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!["ArrowUp", "ArrowDown"].includes(e.key) || (e.target as HTMLElement).closest("input, textarea")) {
        return;
      }
      const i = props.commits.findIndex((c) => c.sha === props.selected);
      const next = props.commits[Math.max(0, Math.min(props.commits.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next) {
        e.preventDefault();
        props.onSelect(next.sha);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);

  const selectedIndex = props.commits.findIndex((c) => c.sha === props.selected);
  useEffect(() => {
    const el = scroller.current;
    if (!el || selectedIndex < 0) {
      return;
    }
    const y = selectedIndex * ROW_HEIGHT;
    if (y < el.scrollTop || y + ROW_HEIGHT > el.scrollTop + el.clientHeight) {
      el.scrollTop = y - el.clientHeight / 2;
    }
  }, [selectedIndex]);

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 10);
  const end = Math.min(props.commits.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + 10);

  const startDrag = (e: MouseEvent) => {
    const x0 = e.clientX;
    const w0 = refsWidth;
    const move = (ev: globalThis.MouseEvent) => setRefsWidth(Math.max(80, Math.min(500, w0 + ev.clientX - x0)));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div className="graph-view">
      <div className="graph-header">
        <div style={{ width: refsWidth }} className="col-head">
          BRANCH / TAG
          <span className="col-resize" onMouseDown={startDrag} />
        </div>
        <div style={{ width: graphWidth }} className="col-head">
          GRAPH
        </div>
        <div className="col-head">COMMIT MESSAGE</div>
      </div>
      <div className="graph-scroll" ref={scroller} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        <div style={{ height: props.commits.length * ROW_HEIGHT, position: "relative" }}>
          {props.commits.slice(start, end).map((commit, k) => {
            const i = start + k;
            return (
              <RowView
                key={commit.sha + (commit.stash ?? "")}
                commit={commit}
                row={props.rows[i]}
                index={i}
                pills={commit.stash ? [] : pillsFor(refsBySha.get(commit.sha) ?? [])}
                graphWidth={graphWidth}
                refsWidth={refsWidth}
                selected={commit.sha === props.selected}
                isHead={commit.sha === props.head}
                dateLabel={dateLabels[i]}
                wipCount={props.wipCount}
                onSelect={props.onSelect}
                onCommitMenu={props.onCommitMenu}
                onRefMenu={props.onRefMenu}
                onRefOpen={props.onRefOpen}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
