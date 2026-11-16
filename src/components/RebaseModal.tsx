import { useEffect, useState } from "react";
import { TodoAction, TodoEntry } from "../actions";

const ACTIONS: TodoAction[] = ["pick", "reword", "squash", "fixup", "drop"];
const KEYS: Record<string, TodoAction> = { p: "pick", r: "reword", s: "squash", f: "fixup", d: "drop" };

function normalize(list: TodoEntry[]): TodoEntry[] {
  const first = list[0];
  if (first && (first.action === "squash" || first.action === "fixup")) {
    return [{ ...first, action: "pick" }, ...list.slice(1)];
  }
  return list;
}

export function RebaseModal(props: { base: string | null; entries: TodoEntry[]; onCancel(): void; onStart(entries: TodoEntry[]): void }) {
  const { base, onCancel, onStart } = props;
  const [entries, setEntries] = useState<TodoEntry[]>(() => normalize(props.entries));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const patch = (i: number, change: Partial<TodoEntry>) => {
    setEntries((list) => normalize(list.map((e, j) => (j === i ? { ...e, ...change } : e))));
  };

  const move = (i: number, delta: number) => {
    setEntries((list) => {
      const j = i + delta;
      if (j < 0 || j >= list.length) {
        return list;
      }
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return normalize(next);
    });
  };

  const order = entries.map((_, i) => i).reverse();

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div className="modal rebase-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Interactive Rebase</h3>
        <p className="modal-message">
          onto {base?.slice(0, 7) ?? "root"} · {entries.length} commits
        </p>
        {order.map((i) => {
          const e = entries[i];
          return (
            <div key={e.sha}>
              <div
                className={"rebase-row " + e.action + (e.action === "drop" ? " dropped" : "")}
                tabIndex={0}
                onKeyDown={(ev) => {
                  if (ev.target !== ev.currentTarget) {
                    return;
                  }
                  if (ev.altKey && ev.key === "ArrowUp") {
                    ev.preventDefault();
                    move(i, 1);
                  } else if (ev.altKey && ev.key === "ArrowDown") {
                    ev.preventDefault();
                    move(i, -1);
                  } else if (!ev.altKey && !ev.ctrlKey && !ev.metaKey && KEYS[ev.key]) {
                    if (i === 0 && (ev.key === "s" || ev.key === "f")) {
                      return;
                    }
                    patch(i, { action: KEYS[ev.key] });
                  }
                }}
              >
                <select value={e.action} onChange={(ev) => patch(i, { action: ev.target.value as TodoAction })}>
                  {ACTIONS.map((a) => (
                    <option key={a} value={a} disabled={i === 0 && (a === "squash" || a === "fixup")}>
                      {a}
                    </option>
                  ))}
                </select>
                <span className="rebase-sha">{e.sha.slice(0, 7)}</span>
                <span className="rebase-subject">{(e.message ?? e.subject).split("\n")[0]}</span>
                <button className="rebase-move" disabled={i === entries.length - 1} onClick={() => move(i, 1)}>
                  ▲
                </button>
                <button className="rebase-move" disabled={i === 0} onClick={() => move(i, -1)}>
                  ▼
                </button>
              </div>
              {e.action === "reword" && (
                <textarea
                  className="rebase-message"
                  rows={3}
                  value={e.message ?? e.subject}
                  onChange={(ev) => patch(i, { message: ev.target.value })}
                />
              )}
            </div>
          );
        })}
        <div className="modal-buttons">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={() => onStart(entries)}>
            Start Rebase
          </button>
        </div>
      </div>
    </div>
  );
}
