import { MouseEvent, ReactNode, useState } from "react";
import * as A from "../actions";
import { Ctx } from "../actions";
import * as M from "../menus";
import { Ref } from "../repo";
import { showMenu } from "../ui";

interface Props {
  ctx: Ctx;
  onSelectSha(sha: string): void;
  showAll(): void;
}

interface TreeNode {
  name: string;
  children: Map<string, TreeNode>;
  ref?: Ref;
}

function buildTree(refs: Ref[], strip = 0): TreeNode {
  const root: TreeNode = { name: "", children: new Map() };
  for (const ref of refs) {
    const parts = ref.name.split("/").slice(strip);
    let node = root;
    parts.forEach((part, i) => {
      const key = i === parts.length - 1 ? `\0${part}` : part;
      if (!node.children.has(key)) {
        node.children.set(key, { name: part, children: new Map() });
      }
      node = node.children.get(key) as TreeNode;
    });
    node.ref = ref;
  }
  return root;
}

function Section(props: { title: string; count: string | number; children: ReactNode; actions?: ReactNode; defaultOpen?: boolean; onMenu?(e: MouseEvent): void }) {
  const [open, setOpen] = useState(props.defaultOpen ?? true);
  return (
    <div className="section">
      <div className="section-head" onClick={() => setOpen(!open)} onContextMenu={props.onMenu}>
        <span className={`chevron${open ? " open" : ""}`}>›</span>
        <span className="section-title">{props.title}</span>
        <span className="section-actions" onClick={(e) => e.stopPropagation()}>
          {props.actions}
        </span>
        <span className="section-count">{props.count}</span>
      </div>
      {open && <div className="section-body">{props.children}</div>}
    </div>
  );
}

export function Sidebar({ ctx, onSelectSha, showAll }: Props) {
  const [filter, setFilter] = useState("");
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const data = ctx.data;
  const match = (name: string) => name.toLowerCase().includes(filter.toLowerCase());
  const locals = data.refs.filter((r) => r.kind === "local" && match(r.name));
  const remotes = data.refs.filter((r) => r.kind === "remote" && match(r.name));
  const tags = data.refs.filter((r) => r.kind === "tag" && match(r.name));
  const allBranches = data.refs.filter((r) => r.kind !== "tag");
  const visible = allBranches.filter((r) =>
    ctx.solo.length ? ctx.solo.includes(r.full) : !ctx.hidden.includes(r.full),
  ).length;

  const toggleFolder = (key: string) => {
    const next = new Set(closed);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setClosed(next);
  };

  const renderRef = (ref: Ref, label: string, depth: number) => {
    const hidden = ctx.solo.length ? !ctx.solo.includes(ref.full) : ctx.hidden.includes(ref.full);
    return (
      <div
        key={ref.full}
        className={`item${ref.current ? " current" : ""}${hidden ? " hidden-ref" : ""}`}
        style={{ paddingLeft: 12 + depth * 14 }}
        onClick={() => onSelectSha(ref.sha)}
        onDoubleClick={() => (ref.kind === "remote" ? A.checkoutRemote(ctx, ref.name) : ref.kind === "local" ? A.checkoutRef(ctx, ref.name) : A.checkoutCommit(ctx, ref.sha))}
        onContextMenu={() => M.refMenu(ctx, ref)}
      >
        <span className="item-icon">{ref.current ? "✓" : ref.kind === "tag" ? "⌂" : "⑂"}</span>
        <span className="item-name">{label}</span>
        {!!ref.ahead && <span className="badge">{ref.ahead}↑</span>}
        {!!ref.behind && <span className="badge">{ref.behind}↓</span>}
        <span
          className="eye"
          title={hidden ? "Show in graph" : "Hide from graph"}
          onClick={(e) => {
            e.stopPropagation();
            ctx.toggleHidden(ref.full);
          }}
        >
          {hidden ? "◌" : "◉"}
        </span>
      </div>
    );
  };

  const renderTree = (node: TreeNode, depth: number, prefix: string): ReactNode[] =>
    [...node.children.entries()]
      .sort(([a], [b]) => Number(a.startsWith("\0")) - Number(b.startsWith("\0")) || a.localeCompare(b))
      .map(([key, child]) => {
        if (child.ref && child.children.size === 0) {
          return renderRef(child.ref, child.name, depth);
        }
        const id = `${prefix}/${key}`;
        return (
          <div key={id}>
            <div className="item folder" style={{ paddingLeft: 12 + depth * 14 }} onClick={() => toggleFolder(id)}>
              <span className={`chevron${closed.has(id) ? "" : " open"}`}>›</span>
              <span className="item-name">{child.name}</span>
            </div>
            {!closed.has(id) && renderTree(child, depth + 1, id)}
          </div>
        );
      });

  return (
    <aside className="sidebar">
      <div className="viewing">
        <span>
          Viewing <b>{visible}/{allBranches.length}</b>
        </span>
        <button className="link" onClick={showAll}>
          Show All
        </button>
      </div>
      <input className="filter" placeholder="Filter (⌘ + Option + f)" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="sections">
        <Section
          title="LOCAL"
          count={`${locals.length}`}
          onMenu={() =>
            showMenu([
              { label: "Hide all local branches", run: () => locals.forEach((r) => !ctx.hidden.includes(r.full) && ctx.toggleHidden(r.full)) },
              { label: "Show all local branches", run: showAll },
            ])
          }
        >
          {renderTree(buildTree(locals), 0, "local")}
        </Section>
        <Section
          title="REMOTE"
          count={data.remotes.length}
          actions={
            <button className="icon-btn" title="Add remote" onClick={() => A.addRemote(ctx)}>
              +
            </button>
          }
        >
          {data.remotes.map((remote) => {
            const id = `remote/${remote.name}`;
            const own = remotes.filter((r) => r.name.startsWith(remote.name + "/"));
            return (
              <div key={remote.name}>
                <div className="item folder" style={{ paddingLeft: 12 }} onClick={() => toggleFolder(id)} onContextMenu={() => M.remoteMenu(ctx, remote.name, remote.url)}>
                  <span className={`chevron${closed.has(id) ? "" : " open"}`}>›</span>
                  <span className="item-icon">☁</span>
                  <span className="item-name">{remote.name}</span>
                </div>
                {!closed.has(id) && renderTree(buildTree(own, 1), 1, id)}
              </div>
            );
          })}
        </Section>
        <Section title="WORKTREES" count={data.worktrees.length} defaultOpen={false}>
          {data.worktrees.map((wt) => (
            <div
              key={wt.path}
              className={`item${wt.path === data.cwd ? " current" : ""}`}
              style={{ paddingLeft: 12 }}
              title={wt.path}
              onDoubleClick={() => wt.path !== data.cwd && ctx.openTab(wt.path)}
              onClick={() => onSelectSha(wt.sha)}
              onContextMenu={() => M.worktreeMenu(ctx, wt)}
            >
              <span className="item-icon">▣</span>
              <span className="item-name">{wt.branch ?? wt.sha.slice(0, 7)}</span>
              <span className="item-sub">{wt.path.split(/[\\/]/).pop()}</span>
            </div>
          ))}
        </Section>
        <Section title="STASHES" count={data.stashes.length} defaultOpen={false}>
          {data.stashes.map((s) => (
            <div
              key={s.ref}
              className="item"
              style={{ paddingLeft: 12 }}
              onClick={() => onSelectSha(s.sha)}
              onDoubleClick={() => A.stashApply(ctx, s.ref)}
              onContextMenu={() => M.stashMenu(ctx, s.ref, s.sha)}
            >
              <span className="item-icon">▤</span>
              <span className="item-name">{s.message}</span>
            </div>
          ))}
        </Section>
        <Section title="TAGS" count={tags.length} defaultOpen={false}>
          {renderTree(buildTree(tags), 0, "tags")}
        </Section>
        <Section title="SUBMODULES" count={data.submodules.length} defaultOpen={false}>
          {data.submodules.map((path) => (
            <div key={path} className="item" style={{ paddingLeft: 12 }} onDoubleClick={() => ctx.openTab(`${data.cwd}/${path}`)}>
              <span className="item-icon">▦</span>
              <span className="item-name">{path}</span>
            </div>
          ))}
        </Section>
      </div>
    </aside>
  );
}
