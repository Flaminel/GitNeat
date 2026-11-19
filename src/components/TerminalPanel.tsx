import { useEffect, useRef } from "react";
import { gitneat } from "../api";
import type { Settings } from "../RepoView";
import { ensureStarted, getSession } from "../terminalSessions";
import { showMenu } from "../ui";

interface Props {
  cwd: string;
  settings: Settings;
  height: number;
  onClose(): void;
}

export function TerminalPanel({ cwd, settings, height, onClose }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const look = { font: settings.terminalFont, fontSize: settings.terminalFontSize, lineHeight: settings.terminalLineHeight, cursor: settings.terminalCursor };
  const session = getSession(cwd, look);

  useEffect(() => {
    const el = box.current;
    if (!el) {
      return;
    }
    el.appendChild(session.host);
    if (!session.term.element) {
      session.term.open(session.host);
    }
    const refit = () => {
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        session.fit.fit();
      }
    };
    refit();
    void ensureStarted(cwd, session).then(() => {
      refit();
      session.term.focus();
    });
    const observer = new ResizeObserver(refit);
    observer.observe(el);
    return () => {
      observer.disconnect();
      session.host.remove();
    };
  }, [cwd, session]);

  useEffect(() => {
    session.fit.fit();
  }, [height, settings.terminalFont, settings.terminalFontSize, settings.terminalLineHeight, session]);

  const write = (data: string) => session.id !== null && void gitneat().termWrite(session.id, data);

  const menu = () =>
    void showMenu([
      { label: "Copy", enabled: session.term.hasSelection(), run: () => gitneat().copy(session.term.getSelection()) },
      { label: "Paste", run: async () => session.term.paste(await navigator.clipboard.readText()) },
      { label: "Select All", run: () => session.term.selectAll() },
      "-",
      { label: "Delete Line", run: () => write("\x15") },
      { label: "Clear", run: () => session.term.clear() },
      "-",
      { label: "Close Terminal", run: onClose },
    ]);

  return <div ref={box} className="terminal-panel" style={{ height }} onContextMenu={(e) => {
    e.preventDefault();
    menu();
  }} />;
}
