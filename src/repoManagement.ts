export interface Workspace {
  id: string;
  name: string;
  description: string;
  repos: string[];
  syncPath?: string;
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

export function groupOrder(workspaces: Workspace[]): string[] {
  return [OPEN, FAVORITES, RECENT, ...sortWorkspaces(workspaces).map((w) => w.id), ALL];
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
