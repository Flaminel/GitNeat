import React from "react";
import * as A from "../actions";
import { Ctx } from "../actions";
import { gitneat } from "../api";
import { showMenu } from "../ui";
import { Icon } from "./icons";

interface Props {
  ctx: Ctx;
  recent: string[];
  undoLabel?: string;
  redoLabel?: string;
  onUndo(): void;
  onRedo(): void;
}

function ToolButton(props: { label: string; icon: React.ReactNode; onClick(): void; disabled?: boolean; badge?: number; onMenu?(): void; title?: string }) {
  return (
    <div className="tool">
      <button className="tool-btn" disabled={props.disabled} onClick={props.onClick} title={props.title ?? props.label}>
        <span className="tool-label">{props.label}</span>
        <span className="tool-icon">
          {props.icon}
          {!!props.badge && <span className="tool-badge">{props.badge}</span>}
        </span>
      </button>
      {props.onMenu && (
        <button className="tool-caret" onClick={props.onMenu}>
          ▾
        </button>
      )}
    </div>
  );
}

export function Toolbar({ ctx, recent, undoLabel, redoLabel, onUndo, onRedo }: Props) {
  const data = ctx.data;
  const current = data.refs.find((r) => r.current);
  const locals = data.refs.filter((r) => r.kind === "local");
  return (
    <div className="toolbar">
      <div className="repo-switch">
        <button
          className="crumb"
          onClick={() => showMenu(recent.filter((p) => p !== data.cwd).map((p) => ({ label: p, run: () => ctx.openTab(p) })))}
        >
          <small>repository</small>
          <b>{data.name} ▾</b>
        </button>
        <span className="crumb-sep">›</span>
        <button
          className="crumb"
          onClick={() =>
            showMenu(locals.map((r) => ({ label: r.current ? `✓ ${r.name}` : r.name, run: () => !r.current && A.checkoutRef(ctx, r.name) })))
          }
        >
          <small>branch</small>
          <b>{data.branch ?? `${data.head?.slice(0, 7) ?? "no commits"} (detached)`} ▾</b>
        </button>
      </div>
      <div className="tools">
        <ToolButton label="Undo" icon={Icon.undo} onClick={onUndo} disabled={!undoLabel} title={undoLabel && `Undo ${undoLabel}`} />
        <ToolButton label="Redo" icon={Icon.redo} onClick={onRedo} disabled={!redoLabel} title={redoLabel && `Redo ${redoLabel}`} />
        <ToolButton
          label="Pull"
          icon={Icon.pull}
          badge={current?.behind}
          onClick={() => A.pull(ctx, "ff")}
          onMenu={() =>
            showMenu([
              { label: "Fetch All", run: () => A.pull(ctx, "fetch") },
              { label: "Pull (fast-forward if possible)", run: () => A.pull(ctx, "ff") },
              { label: "Pull (fast-forward only)", run: () => A.pull(ctx, "ff-only") },
              { label: "Pull (rebase)", run: () => A.pull(ctx, "rebase") },
            ])
          }
        />
        <ToolButton label="Push" icon={Icon.push} badge={current?.ahead} onClick={() => A.push(ctx)} />
        <ToolButton label="Branch" icon={Icon.branchTool} onClick={() => A.createBranch(ctx, "HEAD")} disabled={!data.head} />
        <ToolButton label="Stash" icon={Icon.stashTool} onClick={() => A.stashSave(ctx)} disabled={data.status.length === 0} />
        <ToolButton label="Pop" icon={Icon.popTool} onClick={() => A.stashPop(ctx)} disabled={data.stashes.length === 0} />
        <span className="tool-divider" />
        <ToolButton label="Terminal" icon={Icon.terminal} onClick={() => gitneat().openTerminal(data.cwd)} />
      </div>
      <div className="busy">
        {ctx.ui.busy && <span className="spinner">{ctx.ui.busy}…</span>}
        <ToolButton
          label="Search"
          icon={Icon.searchTool}
          onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true, ctrlKey: true }))}
        />
      </div>
    </div>
  );
}
