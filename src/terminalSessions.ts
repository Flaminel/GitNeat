import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { gitneat } from "./api";

export const TERMINAL_EVENT = "gitneat:terminal";

export interface TerminalSession {
  term: Terminal;
  fit: FitAddon;
  host: HTMLDivElement;
  id: number | null;
  ended: boolean;
}

const sessions = new Map<string, TerminalSession>();
const byId = new Map<number, string>();
let listening = false;

const color = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

function listen() {
  if (listening) {
    return;
  }
  listening = true;
  gitneat().onTermData((id, data) => {
    const cwd = byId.get(id);
    if (cwd) {
      sessions.get(cwd)?.term.write(data);
    }
  });
  gitneat().onTermExit((id) => {
    const cwd = byId.get(id);
    const session = cwd ? sessions.get(cwd) : undefined;
    if (cwd && session) {
      byId.delete(id);
      session.id = null;
      session.ended = true;
      session.term.write("\r\n[Process completed. Press any key to restart.]\r\n");
    }
  });
}

async function start(cwd: string, session: TerminalSession) {
  session.ended = false;
  session.id = await gitneat().termOpen(cwd, session.term.cols, session.term.rows);
  byId.set(session.id, cwd);
}

export interface TerminalLook {
  font: string;
  fontSize: number;
  lineHeight: number;
  cursor: "block" | "underline" | "bar";
}

const DEFAULT_FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

const apply = (term: Terminal, look: TerminalLook) => {
  term.options.fontFamily = look.font.trim() ? `${look.font.trim()}, ${DEFAULT_FONT}` : DEFAULT_FONT;
  term.options.fontSize = look.fontSize;
  term.options.lineHeight = look.lineHeight;
  term.options.cursorStyle = look.cursor;
};

export function getSession(cwd: string, look: TerminalLook): TerminalSession {
  listen();
  const existing = sessions.get(cwd);
  if (existing) {
    apply(existing.term, look);
    return existing;
  }
  const host = document.createElement("div");
  host.className = "terminal-host";
  const term = new Terminal({
    cursorBlink: true,
    scrollback: 5000,
    theme: { background: color("--bg-deep", "#16181c"), foreground: color("--text", "#d8d8d8"), cursor: color("--accent", "#4d88ff"), selectionBackground: "rgba(77, 136, 255, 0.35)" },
  });
  apply(term, look);
  const fit = new FitAddon();
  term.loadAddon(fit);
  const session: TerminalSession = { term, fit, host, id: null, ended: false };
  sessions.set(cwd, session);
  term.onData((data) => {
    if (session.ended) {
      void start(cwd, session);
    } else if (session.id !== null) {
      void gitneat().termWrite(session.id, data);
    }
  });
  term.onResize(({ cols, rows }) => {
    if (session.id !== null) {
      void gitneat().termResize(session.id, cols, rows);
    }
  });
  return session;
}

export async function ensureStarted(cwd: string, session: TerminalSession) {
  if (session.id === null && !session.ended) {
    await start(cwd, session);
  }
}

export const terminalPaths = () => [...sessions.keys()];

export function closeSession(cwd: string) {
  const session = sessions.get(cwd);
  if (!session) {
    return;
  }
  if (session.id !== null) {
    byId.delete(session.id);
    void gitneat().termClose(session.id);
  }
  session.term.dispose();
  sessions.delete(cwd);
}
