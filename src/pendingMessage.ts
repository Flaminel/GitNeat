import { useSyncExternalStore } from "react";

export interface Pending {
  summary: string;
  description: string;
}

const EMPTY: Pending = { summary: "", description: "" };
const store = new Map<string, Pending>();
const listeners = new Set<() => void>();

export const getPending = (cwd: string): Pending => store.get(cwd) ?? EMPTY;

export function setPending(cwd: string, value: Partial<Pending>): void {
  store.set(cwd, { ...getPending(cwd), ...value });
  listeners.forEach((l) => l());
}

export const resetPending = (cwd: string): void => setPending(cwd, EMPTY);

export function pendingText(cwd: string): string {
  const { summary, description } = getPending(cwd);
  return description.trim() ? `${summary.trim()}\n\n${description.trim()}` : summary.trim();
}

export function usePending(cwd: string): Pending {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => getPending(cwd),
  );
}
