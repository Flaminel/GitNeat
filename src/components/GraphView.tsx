import { memo, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { Commit, GraphRow, Ref, Segment } from "../repo";
import { showMenu, Splitter, useStored, useStoredWidth } from "../ui";
import { Icon } from "./icons";

export const ROW_HEIGHT = 28;
const LANE = 22;
const GUTTER = 28;
const ZONE_MARGIN = 3;
const ARC = 8;
export const LANE_COLORS = 10;
export const WIP = "WIP";

export type SelectMode = "toggle" | "range";

type DescMode = "always" | "hover" | "never";

const DESC_MODES: { value: DescMode; label: string }[] = [
  { value: "always", label: "Always" },
  { value: "hover", label: "On hover" },
  { value: "never", label: "Never" },
];

interface Props {
  commits: Commit[];
  rows: GraphRow[];
  refs: Ref[];
  head: string | null;
  selected: string | null;
  multi: string[];
  onSelect(sha: string, mode?: SelectMode): void;
  onCommitMenu(commit: Commit, e: MouseEvent): void;
  onRefMenu(ref: Ref, e: MouseEvent): void;
  onRefOpen(ref: Ref): void;
  onRefDrop(source: string, target: Ref): void;
  wipCount: number;
}

const laneX = (i: number) => GUTTER + i * LANE + LANE / 2;

function path(s: Segment): string {
  const mid = ROW_HEIGHT / 2;
  const y1 = s.y1 === "top" ? 0 : mid;
  const y2 = s.y2 === "mid" ? mid : ROW_HEIGHT;
  const x1 = laneX(s.x1);
  const x2 = laneX(s.x2);
  if (x1 === x2) {
    return `M${x1} ${y1}V${y2}`;
  }
  const d = Math.sign(x2 - x1);
  let out = `M${x1} ${y1}`;
  if (s.y1 === "top") {
    out += `V${mid - ARC}A${ARC} ${ARC} 0 0 ${d > 0 ? 0 : 1} ${x1 + d * ARC} ${mid}`;
  }
  if (s.y2 === "bottom") {
    out += `H${x2 - d * ARC}A${ARC} ${ARC} 0 0 ${d > 0 ? 1 : 0} ${x2} ${mid + ARC}V${ROW_HEIGHT}`;
  } else {
    out += `H${x2}`;
  }
  return out;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

export function relativeTime(seconds: number): string | null {
  const then = new Date(seconds * 1000);
  const now = new Date();
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(then)) / 86400000);
  if (days <= 0) {
    return null;
  }
  if (days === 1) {
    return "yesterday";
  }
  if (days < 7) {
    return `${days} days ago`;
  }
  if (days < 11) {
    return "a week ago";
  }
  if (days < 26) {
    return `${Math.round(days / 7)} weeks ago`;
  }
  if (days < 46) {
    return "a month ago";
  }
  if (days < 320) {
    return `${Math.round(days / 30.4)} months ago`;
  }
  if (days < 548) {
    return "a year ago";
  }
  return `${Math.round(days / 365)} years ago`;
}

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
      pills.push({ key: r.full, label: r.name.split("/").slice(1).join("/"), ref: r, local: false, remote: true, tag: false, current: false });
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
  inMulti: boolean;
  isHead: boolean;
  dateLabel: string | null;
  wipCount: number;
  onSelect(sha: string, mode?: SelectMode): void;
  onCommitMenu(commit: Commit, e: MouseEvent): void;
  onRefMenu(ref: Ref, e: MouseEvent): void;
  onRefOpen(ref: Ref): void;
  onRefDrop(source: string, target: Ref): void;
  dim: boolean;
}) {
  const { commit, row, pills } = props;
  const lane = `--lane-${row.color % LANE_COLORS}`;
  const color = `var(${lane})`;
  const cx = laneX(row.col);
  const cy = ROW_HEIGHT / 2;
  const isWip = commit.sha === WIP;
  const isMerge = commit.parents.length > 1;
  const first = pills[0];
  return (
    <div
      className={`row${props.selected || props.inMulti ? " selected" : ""}${isWip ? " wip" : ""}${commit.stash ? " stash" : ""}${props.isHead ? " head" : ""}${props.dim ? " dim" : ""}${props.dateLabel ? " date-break" : ""}`}
      style={{ top: props.index * ROW_HEIGHT, ["--row-color" as string]: color,
        ["--row-bg25" as string]: `var(${lane}-bg25)`,
        ["--row-bg45" as string]: `var(${lane}-bg45)`,
        ["--row-bg50" as string]: `var(${lane}-bg50)`,
        ["--tint-x" as string]: `${props.refsWidth + cx}px` }}
      onMouseDown={(e) => {
        if (e.button === 0) {
          props.onSelect(commit.sha, e.metaKey || e.ctrlKey ? "toggle" : e.shiftKey ? "range" : undefined);
        }
      }}
      onDragOver={(e) => {
        if (first && e.dataTransfer.types.includes("text/gitneat-ref")) {
          e.preventDefault();
        }
      }}
      onDrop={(e) => {
        const source = e.dataTransfer.getData("text/gitneat-ref");
        if (first && source && source !== first.ref.full) {
          props.onRefDrop(source, first.ref);
        }
      }}
      onContextMenu={(e) => {
        if (!props.inMulti) {
          props.onSelect(commit.sha);
        }
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
              draggable={!first.tag}
              onDragStart={(e) => e.dataTransfer.setData("text/gitneat-ref", first.ref.full)}
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
          {first && <line x1={0} y1={cy} x2={cx} y2={cy} stroke={color} strokeWidth={props.isHead ? 2 : 1} strokeOpacity={props.isHead ? 1 : 0.25} />}
          {row.segments.map((s, i) => (
            <path
              key={i}
              d={path(s)}
              stroke={`var(--lane-${s.color % LANE_COLORS})`}
              strokeWidth={2}
              strokeLinejoin="round"
              fill="none"
              strokeDasharray={isWip && s.y1 === "mid" ? "2" : undefined}
            />
          ))}
          {isWip ? (
            <circle cx={cx} cy={cy} r={10} fill="var(--bg)" stroke={color} strokeWidth={2} strokeDasharray="2" />
          ) : commit.stash ? (
            <rect x={cx - 10} y={cy - 10} width={20} height={20} fill="var(--bg)" stroke={color} strokeWidth={2} strokeDasharray="2" />
          ) : isMerge ? (
            <circle cx={cx} cy={cy} r={6} fill={color} />
          ) : (
            <g>
              <circle cx={cx} cy={cy} r={11} fill={color} />
              <circle cx={cx} cy={cy} r={9} fill="var(--avatar-bg)" />
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
          <span>
            {commit.subject}
            {commit.body && <span className="message-body">{commit.body}</span>}
          </span>
        )}
        {props.dateLabel && <span className="date-pill">{props.dateLabel}</span>}
      </div>
    </div>
  );
});

export function GraphView(props: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const cursor = useRef<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(800);
  const [refsWidth, setRefsWidth] = useStoredWidth("refs", 220);
  const [graphUser, setGraphUser] = useStoredWidth("graph", -1);
  const [desc, setDesc] = useStored<DescMode>("graph.description", "always", (v) => DESC_MODES.some((m) => m.value === v));
  const descMenu = () =>
    showMenu([
      {
        label: "Show commit description in graph",
        submenu: DESC_MODES.map((m) => ({ label: `${m.value === desc ? "✓ " : ""}${m.label}`, run: () => setDesc(m.value) })),
      },
    ]);

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

  const autoGraphWidth = useMemo(() => {
    const lanes = props.rows.reduce((max, r) => Math.max(max, r.width), 1);
    return Math.min(lanes * LANE + 2 * GUTTER + 2 * ZONE_MARGIN, 360);
  }, [props.rows]);
  const graphWidth = graphUser > 0 ? graphUser : autoGraphWidth;

  const dateLabels = useMemo(() => {
    let previous: string | null = null;
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
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest("input, textarea, select, .monaco-editor")) {
        return;
      }
      if (e.code === "KeyH" && !e.shiftKey) {
        if (props.head) {
          e.preventDefault();
          props.onSelect(props.head);
        }
        return;
      }
      if (!["ArrowUp", "ArrowDown"].includes(e.key)) {
        return;
      }
      const extend = e.shiftKey && props.multi.length > 1 && cursor.current !== null && props.multi.includes(cursor.current);
      const i = props.commits.findIndex((c) => c.sha === (extend ? cursor.current : props.selected));
      const next = props.commits[Math.max(0, Math.min(props.commits.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next) {
        e.preventDefault();
        cursor.current = next.sha;
        props.onSelect(next.sha, e.shiftKey ? "range" : undefined);
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

  const [query, setQuery] = useState<string | null>(null);
  const matches = useMemo(() => {
    const q = query?.trim().toLowerCase();
    if (!q) {
      return null;
    }
    return new Set(
      props.commits
        .filter((c) => c.subject.toLowerCase().includes(q) || c.sha.startsWith(q) || c.author.toLowerCase().includes(q))
        .map((c) => c.sha),
    );
  }, [query, props.commits]);
  const matchList = useMemo(() => props.commits.filter((c) => matches?.has(c.sha)).map((c) => c.sha), [matches, props.commits]);
  const matchIndex = matchList.indexOf(props.selected ?? "");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key === "f") {
        e.preventDefault();
        setQuery((q) => q ?? "");
        setTimeout(() => document.getElementById("graph-search")?.focus(), 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const jump = (step: number) => {
    if (!matches || matches.size === 0) {
      return;
    }
    const i = matchList.indexOf(props.selected ?? "");
    props.onSelect(matchList[(i + step + matchList.length) % matchList.length]);
  };

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 10);
  const end = Math.min(props.commits.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + 10);

  return (
    <div className={`graph-view desc-${desc}`}>
      <div className="graph-header" onContextMenu={descMenu}>
        <div style={{ width: refsWidth }} className="col-head">
          Branch / Tag
          <Splitter className="col-resize" value={refsWidth} set={setRefsWidth} min={60} max={600} />
        </div>
        <div style={{ width: graphWidth }} className="col-head" onDoubleClick={() => setGraphUser(-1)}>
          Graph
          <Splitter className="col-resize" value={graphWidth} set={setGraphUser} min={30} max={800} />
        </div>
        <div className="col-head">
          Commit message
          {query !== null && (
            <span className="graph-search">
              {Icon.search}
              <input
                id="graph-search"
                placeholder="Search commits"
                value={query}
                spellCheck={false}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    jump(e.shiftKey ? -1 : 1);
                  } else if (e.key === "Escape") {
                    setQuery(null);
                  }
                }}
              />
              <span className="search-count">{matches === null ? "" : matchList.length === 0 ? "0 results" : `${matchIndex + 1} of ${matchList.length}`}</span>
              <button className="icon-btn" onClick={() => setQuery(null)}>
                ×
              </button>
            </span>
          )}
        </div>
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
                inMulti={props.multi.includes(commit.sha)}
                isHead={commit.sha === props.head}
                dateLabel={dateLabels[i]}
                wipCount={props.wipCount}
                onSelect={props.onSelect}
                onCommitMenu={props.onCommitMenu}
                onRefMenu={props.onRefMenu}
                onRefOpen={props.onRefOpen}
                onRefDrop={props.onRefDrop}
                dim={matches !== null && !matches.has(commit.sha)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
