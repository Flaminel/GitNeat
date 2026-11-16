import { useState } from "react";
import { krill } from "../api";
import { showMenu } from "../ui";

export interface Tab {
  path: string;
  title?: string;
}

interface Props {
  tabs: Tab[];
  active: number;
  canReopen: boolean;
  onActivate(i: number): void;
  onClose(i: number): void;
  onCloseOthers(i: number): void;
  onCloseRight(i: number): void;
  onRename(i: number): void;
  onReopen(): void;
  onMove(from: number, to: number): void;
  onNew(): void;
}

export const tabTitle = (tab: Tab) => tab.title || tab.path.split(/[\\/]/).pop() || tab.path;

export function Tabs(props: Props) {
  const [dragging, setDragging] = useState<number | null>(null);
  const isMac = krill().platform === "darwin";
  return (
    <div className={`tabbar${isMac ? " mac" : " win"}`}>
      {props.tabs.map((tab, i) => (
        <div
          key={tab.path}
          className={`tab${i === props.active ? " active" : ""}`}
          title={tab.path}
          draggable
          onDragStart={() => setDragging(i)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragging !== null && dragging !== i) {
              props.onMove(dragging, i);
            }
            setDragging(null);
          }}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              props.onClose(i);
            } else if (e.button === 0) {
              props.onActivate(i);
            }
          }}
          onContextMenu={() =>
            showMenu([
              { label: "Close tab", run: () => props.onClose(i) },
              { label: "Close other tabs", enabled: props.tabs.length > 1, run: () => props.onCloseOthers(i) },
              { label: "Close tabs to the right", enabled: i < props.tabs.length - 1, run: () => props.onCloseRight(i) },
              { label: "Rename tab", run: () => props.onRename(i) },
              "-",
              { label: "Reopen Closed Tab", enabled: props.canReopen, run: props.onReopen },
            ])
          }
        >
          <span className="tab-icon">▸</span>
          <span className="tab-title">{tabTitle(tab)}</span>
          <button
            className="tab-close"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => props.onClose(i)}
          >
            ×
          </button>
        </div>
      ))}
      <button className="tab-new" title="Open repository" onClick={props.onNew}>
        +
      </button>
      <div className="tabbar-drag" />
    </div>
  );
}
