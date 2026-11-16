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

export interface KrillApi {
  platform: string;
  git(cwd: string, args: string[], env?: Record<string, string>, input?: string): Promise<GitResult>;
  openRepoDialog(): Promise<string | { error: string } | null>;
  pickDirectory(): Promise<string | null>;
  saveFile(name: string, content: string): Promise<boolean>;
  writeTemp(content: string): Promise<string>;
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
    krill: KrillApi;
  }
}

export const krill = (): KrillApi => window.krill;
