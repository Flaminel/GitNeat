import type { RepoData } from "./repo";

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface MenuSpec {
  label?: string;
  id?: string;
  type?: "separator";
  enabled?: boolean;
  submenu?: MenuSpec[];
}

export interface GitNeatApi {
  platform: string;
  windowControls?: boolean;
  git(cwd: string, args: string[], env?: Record<string, string>, input?: string): Promise<GitResult>;
  loadRepo?(cwd: string, hidden: string[], solo: string[], limit: number): Promise<RepoData>;
  openRepoDialog(): Promise<string | { error: string } | null>;
  pickDirectory(): Promise<string | null>;
  saveFile(name: string, content: string): Promise<boolean>;
  writeTemp(content: string): Promise<string>;
  readFile(cwd: string, rel: string): Promise<string | null>;
  writeFile(cwd: string, rel: string, content: string): Promise<boolean>;
  menu(items: MenuSpec[]): Promise<string | null>;
  copy(text: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  openPath(target: string): Promise<string>;
  showItem(target: string): Promise<void>;
  openTerminal(cwd: string): Promise<void>;
  storeGet(): Promise<Record<string, unknown>>;
  storeSet(data: unknown): Promise<void>;
  watch(cwd: string): Promise<void>;
  unwatch(cwd: string): Promise<void>;
  onRepoChanged(fn: (cwd: string) => void): () => void;
}

declare global {
  interface Window {
    gitneat: GitNeatApi;
  }
}

export const gitneat = (): GitNeatApi => window.gitneat;
