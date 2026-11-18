import React from "react";
import * as A from "../actions";
import { Ctx } from "../actions";
import { gitneat } from "../api";
import { showMenu, useStored } from "../ui";
import { Icon } from "./icons";
import { repoLabel } from "./Tabs";

interface Props {
  ctx: Ctx;
  recent: string[];
  favorites: string[];
  aliases: Record<string, string>;
  onViewAll(): void;
  undoLabel?: string;
  redoLabel?: string;
  onUndo(): void;
  onRedo(): void;
}

function ToolButton(props: { label: string; icon: React.ReactNode; onClick(): void; disabled?: boolean; badge?: number; onMenu?(): void; title?: string }) {
  return (
    <div className="tool" title={props.title ?? props.label}>
      <button className="tool-btn" disabled={props.disabled} onClick={props.onClick}>
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

const RECENT_BREADCRUMBS = 4;

const PULL_OPTIONS = A.PULL_OPTIONS;

const detachedText = (label: string) => `${label} is not available when in a detached HEAD state`;

export function Toolbar({ ctx, recent, favorites, aliases, onViewAll, undoLabel, redoLabel, onUndo, onRedo }: Props) {
  const data = ctx.data;
  const current = data.refs.find((r) => r.current);
  const locals = data.refs.filter((r) => r.kind === "local");
  const detached = !data.branch;
  const [pullDefault, setPullDefault] = useStored<A.PullMode>("pull.default", "ff", (v) => PULL_OPTIONS.some((o) => o.mode === v));
  const pullLabel = PULL_OPTIONS.find((o) => o.mode === pullDefault)?.label ?? "Pull";
  const pullBlocked = detached && pullDefault !== "fetch";
  const pushTitle = detached ? detachedText("Push") : current?.upstream ? `Push to ${current.upstream}` : "Push";
  return (
    <div className="toolbar">
      <div className="repo-switch">
        <button
          className="crumb"
          onClick={() => {
            const MOD = gitneat().platform === "darwin" ? "⌘" : "Ctrl+";
            const open = (p: string) => ({ run: () => ctx.openTab(p) });
            const favs = favorites.slice(0, 9);
            showMenu([
              favs.length > 0 && { label: "Favorites", enabled: false },
              ...favs.map((p, i) => ({ label: `${repoLabel(p, aliases)}    ${MOD}${i + 1}`, ...open(p) })),
              favs.length > 0 && "-",
              { label: "Recently opened", enabled: false },
              ...recent
                .filter((p) => p !== data.cwd && !favorites.includes(p))
                .slice(0, RECENT_BREADCRUMBS)
                .map((p) => ({ label: repoLabel(p, aliases), ...open(p) })),
              "-",
              { label: "View all repositories", run: onViewAll },
            ]);
          }}
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
          onClick={() => A.pull(ctx, pullDefault)}
          disabled={pullBlocked}
          title={pullBlocked ? detachedText(pullLabel) : pullLabel}
          onMenu={() =>
            showMenu([
              ...PULL_OPTIONS.map((o) => ({ label: o.label, enabled: o.mode === "fetch" || !detached, run: () => A.pull(ctx, o.mode) })),
              "-" as const,
              {
                label: "Select a default pull/fetch operation to execute when clicking this button",
                submenu: PULL_OPTIONS.map((o) => ({ label: o.mode === pullDefault ? `✓ ${o.label}` : o.label, run: () => setPullDefault(o.mode) })),
              },
            ])
          }
        />
        <ToolButton label="Push" icon={Icon.push} badge={current?.ahead} onClick={() => A.push(ctx)} disabled={detached} title={pushTitle} />
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
