import { MouseEvent, ReactNode, useEffect, useState } from "react";
import * as A from "../actions";
import { krill } from "../api";
import { Ctx } from "../actions";
import * as M from "../menus";
import { Ref } from "../repo";
import { showMenu } from "../ui";
import { Icon } from "./icons";

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

function Section(props: {
  title: string;
  icon: ReactNode;
  count: string | number;
  children: ReactNode;
  actions?: ReactNode;
  open: boolean;
  grow: boolean;
  toggle(): void;
  onMenu?(e: MouseEvent): void;
}) {
  return (
    <div className={`section${props.open ? " open" : ""}${props.grow ? " grow" : ""}`}>
      <div className="section-head" onClick={props.toggle} onContextMenu={props.onMenu}>
        <span className={`chevron${props.open ? " open" : ""}`}>›</span>
        <span className="section-icon">{props.icon}</span>
        <span className="section-title">{props.title}</span>
        <span className="section-actions" onClick={(e) => e.stopPropagation()}>
          {props.actions}
        </span>
        <span className="section-count">{props.count}</span>
      </div>
      {props.open && <div className="section-body">{props.children}</div>}
    </div>
  );
}

const SECTIONS = ["LOCAL", "REMOTE", "WORKTREES", "STASHES", "TAGS", "SUBMODULES"];

export function Sidebar({ ctx, onSelectSha, showAll }: Props) {
  const [filter, setFilter] = useState("");
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [openSections, setOpenSections] = useState<string[]>(["LOCAL", "REMOTE"]);
  const lastOpen = SECTIONS.filter((s) => openSections.includes(s)).pop();
  const sectionProps = (title: string) => ({
    open: openSections.includes(title),
    grow: title === lastOpen,
    toggle: () => setOpenSections((list) => (list.includes(title) ? list.filter((x) => x !== title) : [...list, title])),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.code === "KeyF") {
        e.preventDefault();
        document.getElementById("sidebar-filter")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const data = ctx.data;
  const match = (name: string) => name.toLowerCase().includes(filter.toLowerCase());
  const locals = data.refs.filter((r) => r.kind === "local" && match(r.name));
  const remotes = data.refs.filter((r) => r.kind === "remote" && match(r.name));
  const tags = data.refs.filter((r) => r.kind === "tag" && match(r.name));
  const allBranches = data.refs;
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
        style={{ paddingLeft: 26 + depth * 14 }}
        onClick={() => onSelectSha(ref.sha)}
        onDoubleClick={() => (ref.kind === "remote" ? A.checkoutRemote(ctx, ref.name) : ref.kind === "local" ? A.checkoutRef(ctx, ref.name) : A.checkoutCommit(ctx, ref.sha))}
        onContextMenu={() => M.refMenu(ctx, ref)}
      >
        <span
          className={`gutter${ref.current ? " checked" : hidden ? " off" : ""}`}
          title={hidden ? "Show in graph" : "Hide from graph"}
          onClick={(e) => {
            e.stopPropagation();
            ctx.toggleHidden(ref.full);
          }}
        >
          {ref.current ? <span className="checkbox">{Icon.check}</span> : hidden ? Icon.eyeOff : <span className="eye">{Icon.eye}</span>}
        </span>
        <span className="item-icon">{ref.kind === "tag" ? Icon.tag : Icon.branch}</span>
        <span className="item-name">{label}</span>
        {(!!ref.ahead || !!ref.behind) && (
          <span className="badge">
            {!!ref.behind && `${ref.behind}↓`}
            {!!ref.ahead && `${ref.ahead}↑`}
          </span>
        )}
      </div>
    );
  };

  const renderTree = (node: TreeNode, depth: number, prefix: string): ReactNode[] =>
    [...node.children.entries()]
      .sort(([a], [b]) => a.replace("\0", "").localeCompare(b.replace("\0", ""), undefined, { numeric: true }))
      .map(([key, child]) => {
        if (child.ref && child.children.size === 0) {
          return renderRef(child.ref, child.name, depth);
        }
        const id = `${prefix}/${key}`;
        return (
          <div key={id}>
            <div className="item folder" style={{ paddingLeft: 26 + depth * 14 }} onClick={() => toggleFolder(id)}>
              <span className={`chevron${closed.has(id) ? "" : " open"}`}>›</span>
              <span className="item-icon">{Icon.folder}</span>
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
          {Icon.eye} Viewing <b>{visible}/{allBranches.length}</b>
        </span>
        <button className="link" onClick={showAll}>
          Show All
        </button>
      </div>
      <div className="filter">
        <input
          id="sidebar-filter"
          placeholder={krill().platform === "darwin" ? "Filter (⌘ + Option + f)" : "Filter (Ctrl + Alt + f)"}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {Icon.search}
      </div>
      <div className="sections">
        <Section
          {...sectionProps("LOCAL")}
          title="LOCAL"
          icon={Icon.local}
          count={`${locals.filter((r) => (ctx.solo.length ? ctx.solo.includes(r.full) : !ctx.hidden.includes(r.full))).length}/${locals.length}`}
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
          {...sectionProps("REMOTE")}
          title="REMOTE"
          icon={Icon.remote}
          count={data.refs.filter((r) => r.kind === "remote").length}
          actions={
            <button className="icon-btn" title="Add remote" onClick={() => A.addRemote(ctx)}>
              {Icon.plus}
            </button>
          }
        >
          {data.remotes.map((remote) => {
            const id = `remote/${remote.name}`;
            const own = remotes.filter((r) => r.name.startsWith(remote.name + "/"));
            return (
              <div key={remote.name}>
                <div className="item folder" style={{ paddingLeft: 26 }} onClick={() => toggleFolder(id)} onContextMenu={() => M.remoteMenu(ctx, remote.name, remote.url)}>
                  <span className={`chevron${closed.has(id) ? "" : " open"}`}>›</span>
                  <span className="item-icon">{Icon.remote}</span>
                  <span className="item-name">{remote.name}</span>
                </div>
                {!closed.has(id) && renderTree(buildTree(own, 1), 1, id)}
              </div>
            );
          })}
        </Section>
        <Section {...sectionProps("WORKTREES")} title="WORKTREES" icon={Icon.worktree} count={data.worktrees.length}>
          {data.worktrees.map((wt) => (
            <div
              key={wt.path}
              className={`item${wt.path === data.cwd ? " current" : ""}`}
              style={{ paddingLeft: 26 }}
              title={wt.path}
              onDoubleClick={() => wt.path !== data.cwd && ctx.openTab(wt.path)}
              onClick={() => onSelectSha(wt.sha)}
              onContextMenu={() => M.worktreeMenu(ctx, wt)}
            >
              <span className="item-icon">{Icon.worktree}</span>
              <span className="item-name">{wt.branch ?? wt.sha.slice(0, 7)}</span>
              <span className="item-sub">{wt.path.split(/[\\/]/).pop()}</span>
            </div>
          ))}
        </Section>
        <Section {...sectionProps("STASHES")} title="STASHES" icon={Icon.stash} count={data.stashes.length}>
          {data.stashes.map((s) => (
            <div
              key={s.ref}
              className="item"
              style={{ paddingLeft: 26 }}
              onClick={() => onSelectSha(s.sha)}
              onDoubleClick={() => A.stashApply(ctx, s.ref)}
              onContextMenu={() => M.stashMenu(ctx, s.ref, s.sha)}
            >
              <span className="item-icon">{Icon.stash}</span>
              <span className="item-name">{s.message}</span>
            </div>
          ))}
        </Section>
        <Section {...sectionProps("TAGS")} title="TAGS" icon={Icon.tag} count={tags.length}>
          {renderTree(buildTree(tags), 0, "tags")}
        </Section>
        <Section {...sectionProps("SUBMODULES")} title="SUBMODULES" icon={Icon.submodule} count={data.submodules.length}>
          {data.submodules.map((path) => (
            <div key={path} className="item" style={{ paddingLeft: 26 }} onDoubleClick={() => ctx.openTab(`${data.cwd}/${path}`)}>
              <span className="item-icon">{Icon.submodule}</span>
              <span className="item-name">{path}</span>
            </div>
          ))}
        </Section>
      </div>
    </aside>
  );
}
