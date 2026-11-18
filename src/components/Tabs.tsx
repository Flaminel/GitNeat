import { getCurrentWindow } from "@tauri-apps/api/window";
import { useState } from "react";
import { gitneat } from "../api";
import { showMenu } from "../ui";

export interface Tab {
  path?: string;
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

export const tabTitle = (tab: Tab) => tab.title || tab.path?.split(/[\\/]/).pop() || tab.path || "New Tab";

export function Tabs(props: Props) {
  const [dragging, setDragging] = useState<number | null>(null);
  const isMac = gitneat().platform === "darwin";
  const controls = gitneat().windowControls === true;
  return (
    <div className={`tabbar${isMac ? " mac" : " win"}${controls ? " controls" : ""}`} data-tauri-drag-region>
      {props.tabs.map((tab, i) => (
        <div
          key={tab.path ?? `new-${i}`}
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
              { label: "Rename tab", enabled: !!tab.path, run: () => props.onRename(i) },
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
      <button className="tab-new" title="New tab" onClick={props.onNew}>
        +
      </button>
      <div className="tabbar-drag" data-tauri-drag-region />
      {controls && <WindowControls />}
    </div>
  );
}

function WindowControls() {
  const win = getCurrentWindow();
  return (
    <div className="window-controls">
      <button title="Minimize" onClick={() => void win.minimize()}>
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M0 5h10" stroke="currentColor" />
        </svg>
      </button>
      <button title="Maximize" onClick={() => void win.toggleMaximize()}>
        <svg width="10" height="10" viewBox="0 0 10 10">
          <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" />
        </svg>
      </button>
      <button className="close" title="Close" onClick={() => void win.close()}>
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" />
        </svg>
      </button>
    </div>
  );
}
