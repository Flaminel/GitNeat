import { useEffect, useState } from "react";
import { Tab, tabTitle } from "./Tabs";

interface Props {
  tabs: Tab[];
  closed: Tab[];
  aliases: Record<string, string>;
  onSelect(i: number): void;
  onClose(i: number): void;
  onReopen(i: number): void;
  onDismiss(): void;
}

export function TabsList({ tabs, closed, aliases, onSelect, onClose, onReopen, onDismiss }: Props) {
  const [query, setQuery] = useState("");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onDismiss();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);
  const needle = query.trim().toLowerCase();
  const match = (tab: Tab) => tabTitle(tab, aliases).toLowerCase().includes(needle);
  const open = tabs.map((tab, i) => ({ tab, i })).filter((r) => match(r.tab));
  const recent = closed.map((tab, i) => ({ tab, i })).filter((r) => match(r.tab));
  const first = open[0] ? () => onSelect(open[0].i) : recent[0] ? () => onReopen(recent[0].i) : undefined;
  return (
    <>
      <div className="tabs-list-backdrop" onMouseDown={onDismiss} />
      <div className="tabs-list">
        <input
          autoFocus
          placeholder="Search Tabs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              first?.();
            }
          }}
        />
        <div className="tabs-list-body">
          {open.length > 0 && <div className="tabs-list-group">Open Tabs</div>}
          {open.map(({ tab, i }) => (
            <div key={`open-${i}`} className="tabs-list-row" onClick={() => onSelect(i)}>
              <span className="truncate">{tabTitle(tab, aliases)}</span>
              <button
                title="Close"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(i);
                }}
              >
                ×
              </button>
            </div>
          ))}
          {recent.length > 0 && <div className="tabs-list-group">Closed Recently</div>}
          {recent.map(({ tab, i }) => (
            <div key={`closed-${i}`} className="tabs-list-row" onClick={() => onReopen(i)}>
              <span className="truncate">{tabTitle(tab, aliases)}</span>
            </div>
          ))}
          {!open.length && !recent.length && <div className="keymap-empty">No tabs match.</div>}
        </div>
      </div>
    </>
  );
}
