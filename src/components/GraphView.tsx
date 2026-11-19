import { memo, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { topologicalStep } from "../graphNav";
import { Commit, GraphRow, Ref, Segment } from "../repo";
import { cap, showMenu, Splitter, useStored, useStoredWidth } from "../ui";
import { Icon } from "./icons";

export const ROW_HEIGHT = 28;
const LOAD_MORE_ROWS = 20;
const LANE = 22;
const GUTTER = 28;
const ZONE_MARGIN = 3;
const ARC = 8;
export const LANE_COLORS = 10;
export const WIP = "WIP";

export type SelectMode = "toggle" | "range";

type DescMode = "always" | "hover" | "never";

type ColumnKey = "ref" | "graph" | "message" | "author" | "date" | "sha";

const COLUMNS: { key: ColumnKey; head: string; label: string }[] = [
  { key: "ref", head: "BRANCH / TAG", label: "Branch / Tag" },
  { key: "graph", head: "GRAPH", label: "Graph" },
  { key: "message", head: "COMMIT MESSAGE", label: "Commit message" },
  { key: "author", head: "AUTHOR", label: "Author" },
  { key: "date", head: "COMMIT DATE / TIME", label: "Date / Time" },
  { key: "sha", head: "SHA", label: "Sha" },
];

const MESSAGE_SHOWN = 120;
const AUTHOR_MIN = 32;
const AUTHOR_MAX = 175;
const DATE_MIN = 50;
const DATE_MAX = 175;
const SHA_MIN = 50;
const SHA_MAX = 100;
const SHA_LENGTH = 6;
const REF_DEFAULT = 130;
const REF_COMPACT = 32;
const GRAPH_COMPACT = 150;
const AUTHOR_DEFAULT = 130;

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" });

type Columns = Record<ColumnKey, boolean>;

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
  hasMore: boolean;
  footerCount: number | null;
  onPreferences(): void;
  onLoadMore(): void;
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

function authorColor(email: string, name: string): string {
  const key = (email || name).toLowerCase();
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return `var(--lane-${hash % LANE_COLORS}-bg50)`;
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

const REF_ZONE_MAX_REFS = 100;

function upstreamTitle(behind: number, ahead: number, upstream: string): string {
  if (behind > 0 && ahead > 0) {
    return `${cap(behind)} commit(s) behind and ${cap(ahead)} commit(s) ahead of ${upstream}\n Double-click to pull changes`;
  }
  return behind > 0
    ? `${cap(behind)} commit(s) behind ${upstream}\n Double-click to pull changes`
    : `${cap(ahead)} commit(s) ahead of ${upstream}\n Double-click to push changes`;
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
  cols: Columns;
  authorWidth: number;
  dateWidth: number;
  shaWidth: number;
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
  const { commit, row, pills, cols } = props;
  const lane = `--lane-${row.color % LANE_COLORS}`;
  const color = `var(${lane})`;
  const cx = laneX(row.col);
  const cy = ROW_HEIGHT / 2;
  const isWip = commit.sha === WIP;
  const isMerge = commit.parents.length > 1;
  const first = pills[0];
  const [zoneRect, setZoneRect] = useState<DOMRect | null>(null);
  const menuOpen = useRef(false);
  const expanded = zoneRect !== null && pills.length > 1;
  const leaveZone = () => {
    if (!menuOpen.current) {
      setZoneRect(null);
    }
  };
  const renderPill = (p: Pill) => {
    const ref = p.ref;
    const behind = p.local && ref.upstream ? ref.behind ?? 0 : 0;
    const ahead = p.local && ref.upstream ? ref.ahead ?? 0 : 0;
    return (
      <span
        key={p.key}
        className={`pill${p.current ? " current" : ""}`}
        title={expanded ? undefined : pills.map((x) => x.label).join("\n")}
        onContextMenu={(e) => {
          e.stopPropagation();
          menuOpen.current = true;
          setTimeout(() => {
            menuOpen.current = false;
          }, 250);
          props.onSelect(commit.sha);
          props.onRefMenu(ref, e);
        }}
        onDoubleClick={() => props.onRefOpen(ref)}
        draggable={!p.tag}
        onDragStart={(e) => e.dataTransfer.setData("text/gitneat-ref", ref.full)}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("text/gitneat-ref")) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onDrop={(e) => {
          const source = e.dataTransfer.getData("text/gitneat-ref");
          if (source) {
            e.stopPropagation();
            if (source !== ref.full) {
              props.onRefDrop(source, ref);
            }
          }
        }}
      >
        {p.current && Icon.check}
        <span className="pill-label">{p.label}</span>
        {p.local && Icon.local}
        {p.remote && Icon.remote}
        {p.tag && Icon.tag}
        {(behind > 0 || ahead > 0) && (
          <span className="pill-upstream" title={upstreamTitle(behind, ahead, ref.upstream ?? "")}>
            {behind > 0 && <span>{cap(behind)}↓</span>}
            {ahead > 0 && <span>{cap(ahead)}↑</span>}
          </span>
        )}
      </span>
    );
  };
  return (
    <div
      className={`row${props.selected || props.inMulti ? " selected" : ""}${isWip ? " wip" : ""}${commit.stash ? " stash" : ""}${props.isHead ? " head" : ""}${props.dim ? " dim" : ""}${props.dateLabel ? " date-break" : ""}`}
      style={{ top: props.index * ROW_HEIGHT, ["--row-color" as string]: color,
        ["--row-bg25" as string]: `var(${lane}-bg25)`,
        ["--row-bg45" as string]: `var(${lane}-bg45)`,
        ["--row-bg50" as string]: `var(${lane}-bg50)`,
        ["--tint-x" as string]: `${(cols.ref ? props.refsWidth : 0) + cx}px` }}
      onMouseDown={(e) => {
        if (e.button === 0) {
          if (e.shiftKey) {
            e.preventDefault();
          }
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
      {cols.ref && (
      <div
        className="cell refs"
        style={{ width: props.refsWidth }}
        onMouseEnter={(e) => setZoneRect(e.currentTarget.getBoundingClientRect())}
        onMouseLeave={leaveZone}
        onWheel={leaveZone}
      >
        {first && (
          <>
            {!expanded && (
              <>
                {renderPill(first)}
                {pills.length > 1 && <span className="pill more">+{pills.length - 1}</span>}
              </>
            )}
            {expanded &&
              createPortal(
                <div
                  className="ref-overlay"
                  style={{ left: zoneRect.left + 4, top: zoneRect.top + ROW_HEIGHT / 2 - 15, ["--row-bg25" as string]: `var(${lane}-bg25)`, ["--row-bg45" as string]: `var(${lane}-bg45)`, ["--row-bg50" as string]: `var(${lane}-bg50)` }}
                  onMouseLeave={leaveZone}
                  onWheel={leaveZone}
                >
                  {pills.slice(0, REF_ZONE_MAX_REFS).map(renderPill)}
                </div>,
                document.body,
              )}
            <span className="pill-line" />
          </>
        )}
      </div>
      )}
      {cols.graph && (
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
              <circle cx={cx} cy={cy} r={9} fill={authorColor(commit.email, commit.author)} />
              <text x={cx} y={cy + 3} textAnchor="middle" className="avatar-text">
                {initials(commit.author)}
              </text>
            </g>
          )}
        </svg>
      </div>
      )}
      {cols.message ? (
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
      ) : (
        <div className="cell grow" />
      )}
      {cols.author && (
        <div className="cell author" style={{ width: props.authorWidth }} title={isWip ? undefined : `${commit.author} <${commit.email}>`}>
          {!isWip &&
            (props.authorWidth <= AUTHOR_MIN ? (
              <span className="author-avatar" style={{ background: authorColor(commit.email, commit.author) }}>
                {initials(commit.author)}
              </span>
            ) : (
              commit.author
            ))}
        </div>
      )}
      {cols.date && (
        <div className="cell date" style={{ width: props.dateWidth }}>
          {!isWip && dateFormat.format(commit.time * 1000)}
        </div>
      )}
      {cols.sha && (
        <div className="cell sha" style={{ width: props.shaWidth }}>
          {!isWip && commit.sha.slice(0, SHA_LENGTH)}
        </div>
      )}
    </div>
  );
});

export function GraphView(props: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const cursor = useRef<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(800);
  const [width, setWidth] = useState(0);
  const [refsWidth, setRefsWidth] = useStoredWidth("refs", 220);
  const [graphUser, setGraphUser] = useStoredWidth("graph", -1);
  const [authorWidth, setAuthorWidth] = useStoredWidth("author", AUTHOR_DEFAULT);
  const [dateWidth, setDateWidth] = useStoredWidth("date", 130);
  const [shaWidth, setShaWidth] = useStoredWidth("sha", SHA_MAX);
  const [showRef, setShowRef] = useStored<boolean>("col.ref", true);
  const [showGraph, setShowGraph] = useStored<boolean>("col.graph", true);
  const [showMessage, setShowMessage] = useStored<boolean>("col.message", true);
  const [showAuthor, setShowAuthor] = useStored<boolean>("col.author", true);
  const [showDate, setShowDate] = useStored<boolean>("col.date", true);
  const [showSha, setShowSha] = useStored<boolean>("col.sha", true);
  const userCols = useMemo<Columns>(
    () => ({ ref: showRef, graph: showGraph, message: showMessage, author: showAuthor, date: showDate, sha: showSha }),
    [showRef, showGraph, showMessage, showAuthor, showDate, showSha],
  );
  const setters: Record<ColumnKey, (v: boolean) => void> = { ref: setShowRef, graph: setShowGraph, message: setShowMessage, author: setShowAuthor, date: setShowDate, sha: setShowSha };
  const [desc, setDesc] = useStored<DescMode>("graph.description", "always", (v) => DESC_MODES.some((m) => m.value === v));
  const resetColumns = (compact: boolean) => {
    setShowRef(true);
    setShowGraph(true);
    setShowMessage(true);
    setShowAuthor(true);
    setShowDate(!compact);
    setShowSha(true);
    setRefsWidth(compact ? REF_COMPACT : REF_DEFAULT);
    setGraphUser(compact ? GRAPH_COMPACT : -1);
    setAuthorWidth(compact ? AUTHOR_MIN : AUTHOR_DEFAULT);
    setDateWidth(130);
    setShaWidth(SHA_MAX);
  };
  const visibleCount = COLUMNS.filter((c) => userCols[c.key]).length;
  const columnsMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    return showMenu([
      ...COLUMNS.map((c) => ({
        label: `${userCols[c.key] ? "✓ " : ""}${c.label}`,
        enabled: !(userCols[c.key] && visibleCount === 1),
        run: () => setters[c.key](!userCols[c.key]),
      })),
      "-",
      { label: "Reset columns to default layout", run: () => resetColumns(false) },
      { label: "Reset columns to compact layout", run: () => resetColumns(true) },
      "-",
      {
        label: "Show commit description in graph",
        submenu: DESC_MODES.map((m) => ({ label: `${m.value === desc ? "✓ " : ""}${m.label}`, run: () => setDesc(m.value) })),
      },
    ]);
  };

  useEffect(() => {
    const el = scroller.current;
    if (!el) {
      return;
    }
    const observer = new ResizeObserver(() => {
      setHeight(el.clientHeight);
      setWidth(el.clientWidth);
    });
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
  const cols = useMemo<Columns>(() => {
    const next = { ...userCols };
    let used = (next.ref ? refsWidth : 0) + (next.graph ? graphWidth : 0) + (next.author ? authorWidth : 0) + (next.date ? dateWidth : 0) + (next.sha ? shaWidth : 0);
    const widths = { date: dateWidth, sha: shaWidth, author: authorWidth };
    for (const key of ["date", "sha", "author"] as const) {
      if (width > 0 && next.message && next[key] && width - used < MESSAGE_SHOWN) {
        next[key] = false;
        used -= widths[key];
      }
    }
    return next;
  }, [userCols, width, refsWidth, graphWidth, authorWidth, dateWidth, shaWidth]);

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
      const letter = { KeyJ: "ArrowDown", KeyK: "ArrowUp" }[e.code];
      if (letter) {
        const i = props.commits.findIndex((c) => c.sha === props.selected);
        const next = e.shiftKey
          ? topologicalStep(props.commits, props.selected, letter === "ArrowUp")
          : props.commits[Math.max(0, Math.min(props.commits.length - 1, i + (letter === "ArrowDown" ? 1 : -1)))];
        if (next) {
          e.preventDefault();
          cursor.current = next.sha;
          props.onSelect(next.sha);
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
    const next = i < 0 && step < 0 ? matchList.length - 1 : (i + step + matchList.length) % matchList.length;
    props.onSelect(matchList[next]);
  };

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 10);
  const end = Math.min(props.commits.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + 10);

  return (
    <div className={`graph-view desc-${desc}`}>
      <div className="graph-header" onContextMenu={columnsMenu}>
        {cols.ref && (
          <div style={{ width: refsWidth }} className="col-head">
            {refsWidth > AUTHOR_MIN && "BRANCH / TAG"}
            <Splitter className="col-resize" value={refsWidth} set={setRefsWidth} min={32} max={300} />
          </div>
        )}
        {cols.graph && (
          <div style={{ width: graphWidth }} className="col-head" onDoubleClick={() => setGraphUser(-1)}>
            GRAPH
            <Splitter className="col-resize" value={graphWidth} set={setGraphUser} min={56} max={800} />
          </div>
        )}
        {cols.message ? (
          <div className="col-head grow">
            COMMIT MESSAGE
          </div>
        ) : (
          <div className="col-head grow" />
        )}
        {cols.author && (
          <div style={{ width: authorWidth }} className="col-head">
            {authorWidth > AUTHOR_MIN && "AUTHOR"}
            <Splitter className="col-resize left" value={authorWidth} set={setAuthorWidth} min={AUTHOR_MIN} max={AUTHOR_MAX} invert />
          </div>
        )}
        {cols.date && (
          <div style={{ width: dateWidth }} className="col-head">
            COMMIT DATE / TIME
            <Splitter className="col-resize left" value={dateWidth} set={setDateWidth} min={DATE_MIN} max={DATE_MAX} invert />
          </div>
        )}
        {cols.sha && (
          <div style={{ width: shaWidth }} className="col-head">
            SHA
            <Splitter className="col-resize left" value={shaWidth} set={setShaWidth} min={SHA_MIN} max={SHA_MAX} invert />
          </div>
        )}
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
        <button className="icon-btn columns-btn" title="Columns settings" onClick={columnsMenu}>
          {Icon.gear}
        </button>
      </div>
      <div className="graph-scroll" ref={scroller} onScroll={(e) => {
          const el = e.currentTarget;
          setScrollTop(el.scrollTop);
          if (props.hasMore && el.scrollTop + el.clientHeight > el.scrollHeight - LOAD_MORE_ROWS * ROW_HEIGHT) {
            props.onLoadMore();
          }
        }}>
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
                cols={cols}
                authorWidth={authorWidth}
                dateWidth={dateWidth}
                shaWidth={shaWidth}
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
        {props.footerCount !== null && (
          <div className="graph-footer">
            Displaying {props.footerCount} commits. Adjust this setting in{" "}
            <a href="#" onClick={(e) => { e.preventDefault(); props.onPreferences(); }}>
              Preferences
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
