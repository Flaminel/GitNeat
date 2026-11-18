import { useEffect, useRef, useState } from "react";
import { gitneat } from "../api";
import { filterKeymapGroups, keymapGroups } from "../keymap";

interface Props {
  onClose(): void;
}

export function KeyboardShortcuts({ onClose }: Props) {
  const mac = gitneat().platform === "darwin";
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const groups = filterKeymapGroups(keymapGroups(mac), query);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if ((e.metaKey || e.ctrlKey) && e.code === "KeyF") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const keys = (list: string[]) =>
    list.flatMap((combo, i) => [
      ...(i ? [<span key={`or${i}`} className="keymap-or">or</span>] : []),
      <span key={combo} className="keymap-combo">
        {combo.split(" ").map((token, j) => (
          <kbd key={j}>{token}</kbd>
        ))}
      </span>,
    ]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal keymaps" onMouseDown={(e) => e.stopPropagation()}>
        <div className="keymaps-head">
          <h3>Keyboard Shortcuts</h3>
          <span className="keymap-combo">{keys([`${mac ? "⌘" : "Ctrl"} /`])}</span>
          <input ref={input} autoFocus placeholder={`Filter shortcuts (${mac ? "Cmd" : "Ctrl"} + F)`} value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className="keymaps-close" title="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="keymaps-body">
          {groups.map((group) => (
            <div key={group.name}>
              <div className="keymap-group">{group.name}</div>
              {group.keymaps.map((k) => (
                <div key={k.label} className="keymap">
                  <span>{k.label}</span>
                  <span className="keymap-keys">{keys(k.keys)}</span>
                </div>
              ))}
            </div>
          ))}
          {!groups.length && <div className="keymap-empty">No shortcuts match.</div>}
        </div>
      </div>
    </div>
  );
}
