export interface Workspace {
  id: string;
  name: string;
  description: string;
  repos: string[];
  syncPath?: string;
  icon?: string;
}

export interface GroupPrefs {
  collapsed?: boolean;
  hidden?: boolean;
  color?: number;
}

export const OPEN = "open";
export const FAVORITES = "favorites";
export const RECENT = "recent";
export const ALL = "all";

export const DEFAULT_GROUPS: Record<string, string> = {
  [OPEN]: "Open repositories",
  [FAVORITES]: "Favorites",
  [RECENT]: "Recent repositories",
  [ALL]: "All repositories",
};

export const isDefaultGroup = (id: string) => id in DEFAULT_GROUPS;

export function sortWorkspaces(list: Workspace[]): Workspace[] {
  return [...list].sort((a, b) => {
    if (!!a.syncPath !== !!b.syncPath) {
      return a.syncPath ? 1 : -1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: "accent" });
  });
}

export function groupOrder(workspaces: Workspace[], saved: string[] = []): string[] {
  const sorted = sortWorkspaces(workspaces).map((w) => w.id);
  const exists = new Set([OPEN, FAVORITES, RECENT, ALL, ...sorted]);
  const out = saved.filter((id, i) => exists.has(id) && saved.indexOf(id) === i);
  for (const id of [RECENT, FAVORITES, OPEN]) {
    if (!out.includes(id)) {
      out.unshift(id);
    }
  }
  for (const id of sorted) {
    if (!out.includes(id)) {
      out.push(id);
    }
  }
  if (!out.includes(ALL)) {
    out.push(ALL);
  }
  return out;
}

export function moveGroup(ids: string[], from: string, to: string): string[] {
  const out = ids.filter((id) => id !== from);
  out.splice(ids.indexOf(to), 0, from);
  return out;
}

export function editorCaption(count: number, total: number, name: string | null): string {
  if (!name) {
    return "Open in external editor";
  }
  if (count <= 1) {
    return `Open in ${name}`;
  }
  return count === total ? `Open all in ${name} workspace` : `Open ${count} in ${name} workspace`;
}

export function allRepos(open: string[], favorites: string[], recent: string[], workspaces: string[][], failed: (path: string) => boolean): string[] {
  const out: string[] = [];
  for (const path of [...open, ...favorites, ...recent]) {
    if (!out.includes(path)) {
      out.push(path);
    }
  }
  for (const list of workspaces) {
    for (const path of list) {
      if (!out.includes(path) && !failed(path)) {
        out.push(path);
      }
    }
  }
  return out;
}

export const matchRepo = (label: string, query: string) => !query || label.toLowerCase().includes(query.toLowerCase());

export function countCaption(count: number, total: number, one: string, all: string, many: string): string {
  if (count <= 1) {
    return one;
  }
  return count === total ? all : many.replace("{0}", String(count));
}

export const newWorkspaceId = () => `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
