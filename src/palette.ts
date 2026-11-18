import type { Commit, Ref, StatusEntry } from "./repo";

export type Domain = "top" | "checkout" | "openRepo" | "searchCommits" | "blame" | "history" | "editFile" | "openFile" | "viewFile" | "deleteFile" | "createFile";

export interface Item {
  id: string;
  label: string;
  prefix?: string;
  hidden?: string;
  alias?: string;
  domain?: Domain;
  run?: () => unknown;
}

export interface Meta {
  t: number[];
  total: number;
}

export interface Frecency {
  items: Record<string, Record<string, Meta>>;
  queries: Record<string, Record<string, Record<string, Meta>>>;
}

export const PLACEHOLDERS: Record<Domain, string> = {
  top: "Search for commands and actions (e.g., Open Repo)",
  checkout: "Search for a branch to checkout",
  openRepo: "Search for a repository to open",
  searchCommits: "Search commits by message, sha, or author",
  blame: "Search for a file to view who did what (i.e. its blame)",
  history: "Search for a file to view its history / blame",
  editFile: "Search for a file to edit",
  openFile: "Search for a file to open",
  viewFile: "Search for a file to view",
  deleteFile: "Search for a file to delete",
  createFile: "Enter a new file name",
};

export const DOMAIN_LABELS: Record<Exclude<Domain, "top">, string> = {
  blame: "Blame",
  checkout: "Checkout",
  createFile: "Create File",
  deleteFile: "Delete File",
  editFile: "Edit File",
  history: "History",
  openFile: "Open File",
  openRepo: "Open Repo",
  searchCommits: "Search Commits",
  viewFile: "View File",
};

const HOUR = 36e5;
const DAY = 864e5;
const CUTOFFS = [
  { max: 4 * HOUR, weight: 100 },
  { max: DAY, weight: 80 },
  { max: 3 * DAY, weight: 60 },
  { max: 7 * DAY, weight: 45 },
  { max: 15 * DAY, weight: 30 },
  { max: 30 * DAY, weight: 10 },
];
const TIMESTAMPS = 10;
const FRECENCY_DOMAINS: Domain[] = ["top", "openRepo"];

export const EMPTY_FRECENCY: Frecency = { items: {}, queries: {} };

export function frecencyScore(now: number, meta: Meta | undefined): number {
  if (!meta || meta.t.length === 0) {
    return 0;
  }
  const sum = meta.t.reduce((acc, t) => acc + (CUTOFFS.find((c) => c.max >= now - t)?.weight ?? 0), 0);
  return (meta.total * sum) / Math.max(1, meta.t.length);
}

function bump(meta: Meta | undefined, now: number): Meta {
  return { t: [...(meta?.t ?? []).slice(-(TIMESTAMPS - 1)), now], total: (meta?.total ?? 0) + 1 };
}

export function record(frecency: Frecency, domain: Domain, id: string, query: string, now: number): Frecency {
  if (!FRECENCY_DOMAINS.includes(domain)) {
    return frecency;
  }
  const items = { ...frecency.items, [domain]: { ...frecency.items[domain], [id]: bump(frecency.items[domain]?.[id], now) } };
  if (!query) {
    return { ...frecency, items };
  }
  const byQuery = frecency.queries[domain] ?? {};
  const queries = {
    ...frecency.queries,
    [domain]: { ...byQuery, [query]: { ...byQuery[query], [id]: bump(byQuery[query]?.[id], now) } },
  };
  return { items, queries };
}

export function parseFrecency(raw: unknown): Frecency {
  try {
    const value = JSON.parse(String(raw));
    return value && typeof value.items === "object" && typeof value.queries === "object" ? value : EMPTY_FRECENCY;
  } catch {
    return EMPTY_FRECENCY;
  }
}

const isBoundary = (text: string, i: number) => i === 0 || /[\s/\\_.\-:]/.test(text[i - 1]);

export function matchPositions(text: string, query: string): number[] | null {
  const lower = text.toLowerCase();
  const wanted = query.toLowerCase().replace(/\s+/g, "");
  const positions: number[] = [];
  let from = 0;
  for (const ch of wanted) {
    const at = lower.indexOf(ch, from);
    if (at < 0) {
      return null;
    }
    positions.push(at);
    from = at + 1;
  }
  return positions;
}

export function fuzzyScore(text: string, query: string): number {
  const wanted = query.toLowerCase().replace(/\s+/g, "");
  if (!wanted) {
    return 1;
  }
  const lower = text.toLowerCase();
  const exact = lower.indexOf(wanted);
  if (exact >= 0) {
    return 100 + (isBoundary(text, exact) ? 50 : 0) + (exact === 0 ? 25 : 0) + wanted.length * 2 - text.length / 100;
  }
  const positions = matchPositions(text, wanted);
  if (!positions) {
    return 0;
  }
  let score = 10;
  positions.forEach((at, i) => {
    score += isBoundary(text, at) ? 8 : 1;
    if (i > 0 && at === positions[i - 1] + 1) {
      score += 5;
    }
  });
  return Math.max(1, score - (positions[positions.length - 1] - positions[0]) / 4 - text.length / 100);
}

const haystack = (item: Item) => [item.prefix, item.label, item.hidden, item.alias].filter(Boolean).join(" ");

export function rank(items: Item[], domain: Domain, query: string, frecency: Frecency, now: number, limit = 100): Item[] {
  const scored = items
    .map((item) => ({ item, fuzzy: query ? fuzzyScore(haystack(item), query) : 0 }))
    .filter((s) => !query || s.fuzzy > 0);
  if (!FRECENCY_DOMAINS.includes(domain)) {
    return scored.sort((a, b) => b.fuzzy - a.fuzzy).slice(0, limit).map((s) => s.item);
  }
  const queryMeta = frecency.queries[domain]?.[query] ?? {};
  const rows = scored.map((s) => ({
    ...s,
    own: frecencyScore(now, frecency.items[domain]?.[s.item.id]),
    byQuery: frecencyScore(now, queryMeta[s.item.id]),
  }));
  const norm = (pick: (r: (typeof rows)[number]) => number) => {
    const max = Math.max(0, ...rows.map(pick));
    return (r: (typeof rows)[number]) => (max ? pick(r) / max : 1);
  };
  const fuzzy = norm((r) => r.fuzzy);
  const own = norm((r) => r.own);
  const byQuery = norm((r) => r.byQuery);
  const total = (r: (typeof rows)[number]) => 3 * fuzzy(r) + 2 * byQuery(r) + own(r);
  const name = (r: (typeof rows)[number]) => `${r.item.prefix ?? ""}${r.item.label}`;
  return rows
    .sort((a, b) => total(b) - total(a) || (domain === "top" ? name(a).localeCompare(name(b)) : 0))
    .slice(0, limit)
    .map((r) => r.item);
}

export interface Flags {
  repo?: boolean;
  detached?: boolean;
  busy?: boolean;
}

export interface Command extends Item {
  flags?: Flags;
}

export interface Situation {
  hasRepo: boolean;
  detached: boolean;
  busy: boolean;
}

export const available = (command: Command, s: Situation): boolean => {
  const f = command.flags ?? {};
  return !(f.repo && !s.hasRepo) && !(f.detached === false && s.detached) && !(f.busy === false && s.busy);
};

export function refItems(refs: Ref[], run: (ref: Ref) => unknown): Item[] {
  return refs
    .filter((r) => r.kind !== "tag")
    .map((r) => ({ id: `checkoutRef-${r.full}`, label: r.name, run: () => run(r) }));
}

export function commitItems(commits: Commit[], run: (commit: Commit) => unknown): Item[] {
  return commits
    .filter((c) => !c.stash)
    .map((c) => ({
      id: c.sha,
      label: c.subject,
      hidden: `${c.sha} ${c.author}`,
      alias: c.sha.slice(0, 7),
      run: () => run(c),
    }));
}

export function fileItems(files: string[], run: (file: string) => unknown): Item[] {
  return files.map((f) => ({ id: f, label: f, run: () => run(f) }));
}

export function workingFiles(tracked: string[], status: StatusEntry[]): string[] {
  const files = new Set(tracked);
  for (const entry of status) {
    for (const code of [entry.index, entry.work]) {
      if (code === "A" || code === "?") {
        files.add(entry.path);
      } else if (code === "D") {
        files.delete(entry.path);
      } else if (code === "R") {
        files.add(entry.path);
        if (entry.orig) {
          files.delete(entry.orig);
        }
      }
    }
  }
  return [...files];
}
