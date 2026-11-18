import { MouseEvent, ReactNode, useEffect, useRef, useState } from "react";
import * as A from "../actions";
import { gitneat } from "../api";
import { Ctx } from "../actions";
import * as M from "../menus";
import { boundedYs, limitsFor, resizableHandles, sectionHeights } from "../leftPanel";
import { Ref, samePath, Submodule } from "../repo";
import { cap, showMenu, Splitter } from "../ui";
import { Icon } from "./icons";

interface Props {
  ctx: Ctx;
  onSelectSha(sha: string): void;
  showAll(): void;
  collapsed: boolean;
  setCollapsed(collapsed: boolean): void;
  closed: string[];
  setClosed(closed: string[]): void;
  openSections: string[];
  setOpenSections(sections: string[]): void;
  sectionYs: Record<string, number>;
  setSectionYs(ys: Record<string, number>): void;
  selectedSha: string | null;
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

function sortedEntries(node: TreeNode): [string, TreeNode][] {
  return [...node.children.entries()].sort(([a], [b]) =>
    a.replace("\0", "").localeCompare(b.replace("\0", ""), undefined, { numeric: true }),
  );
}

function orderedRefs(node: TreeNode): Ref[] {
  return sortedEntries(node).flatMap(([, child]) => (child.ref && child.children.size === 0 ? [child.ref] : orderedRefs(child)));
}

function Section(props: {
  title: string;
  icon: ReactNode;
  count: string | number;
  children: ReactNode;
  actions?: ReactNode;
  open: boolean;
  height?: number;
  toggle(): void;
  onMenu?(e: MouseEvent): void;
}) {
  return (
    <div className={`section${props.open ? " open" : ""}`} style={{ height: props.height }}>
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


const STASH_REF = "refs/stash";

function submoduleStatus(sm: Submodule, base: string): string {
  if (sm.new && sm.uninitialized) {
    return "Your submodule has been added but needs to be initialized.";
  }
  if (sm.new) {
    return "Your submodule has been added and initialized but not committed.";
  }
  if (sm.deleted) {
    return "You have removed the submodule folder, but not the submodule in git.";
  }
  if (sm.uninitialized) {
    return "Your submodule directory has not been initialized.";
  }
  if (sm.outOfSync && sm.dirty) {
    return `This submodule has uncommitted changes and is out-of-sync with ${base}.`;
  }
  if (sm.outOfSync) {
    return `This submodule is out-of-sync with ${base}.`;
  }
  if (sm.dirty) {
    return "There are uncommitted changes in this submodule.";
  }
  return `This submodule is in-sync with your repository (${base}).`;
}

const SECTION_HEADER_HEIGHT = 30;
const SECTIONS = ["LOCAL", "REMOTE", "WORKTREES", "STASHES", "TAGS", "SUBMODULES"];

export function Sidebar({
  ctx,
  onSelectSha,
  showAll,
  collapsed,
  setCollapsed,
  closed: closedList,
  setClosed,
  openSections,
  setOpenSections,
  sectionYs,
  setSectionYs,
  selectedSha,
}: Props) {
  const [filter, setFilter] = useState("");
  const [selection, setSelection] = useState<string[]>([]);
  const [over, setOver] = useState<string | null>(null);
  const asked = useRef<string | null>(null);
  const [submodules, setSubmodules] = useState<Submodule[]>([]);
  const closed = new Set(closedList);
  const lastOpen = SECTIONS.filter((s) => openSections.includes(s)).pop();
  const [drag, setDrag] = useState<Record<string, number> | null>(null);
  const [panelHeight, setPanelHeight] = useState(0);
  const sectionsRef = useRef<HTMLDivElement>(null);
  const limits = SECTIONS.map((s) => limitsFor(openSections.includes(s)));
  const ys = panelHeight ? boundedYs(SECTIONS, limits, panelHeight, drag ?? sectionYs) : null;
  const heights = ys ? sectionHeights(SECTIONS, ys) : null;
  const handles = resizableHandles(limits);
  const sectionProps = (title: string) => ({
    open: openSections.includes(title),
    height: heights?.[title],
    toggle: () =>
      setOpenSections(openSections.includes(title) ? openSections.filter((x) => x !== title) : [...openSections, title]),
  });

  useEffect(() => {
    const el = sectionsRef.current;
    if (!el) {
      return;
    }
    const observer = new ResizeObserver(() => setPanelHeight(el.clientHeight));
    observer.observe(el);
    setPanelHeight(el.clientHeight);
    return () => observer.disconnect();
  }, [collapsed]);

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

  useEffect(() => {
    if (selectedSha !== asked.current) {
      setSelection([]);
    }
  }, [selectedSha]);

  useEffect(() => {
    let live = true;
    gitneat()
      .loadSubmodules(data.cwd)
      .then((list) => live && setSubmodules(list))
      .catch(() => live && setSubmodules([]));
    return () => {
      live = false;
    };
  }, [data]);
  const match = (name: string) => name.toLowerCase().includes(filter.toLowerCase());
  const locals = data.refs.filter((r) => r.kind === "local" && match(r.name));
  const remotes = data.refs.filter((r) => r.kind === "remote" && match(r.name));
  const tags = data.refs.filter((r) => r.kind === "tag" && match(r.name));
  const allBranches = data.refs;
  const visible = allBranches.filter((r) =>
    ctx.solo.length ? ctx.solo.includes(r.full) : !ctx.hidden.includes(r.full),
  ).length;

  const isClosed = (id: string) => !filter && closed.has(id);

  const hideGroup = (kind: Ref["kind"], hide: boolean) =>
    ctx.setHidden(data.refs.filter((r) => r.kind === kind).map((r) => r.full), hide);

  const groupMenu = (kind: Ref["kind"], noun: string) => () =>
    showMenu([
      { label: `Hide all ${noun}`, run: () => hideGroup(kind, true) },
      { label: `Show all ${noun}`, run: () => hideGroup(kind, false) },
    ]);

  const toggleFolder = (key: string) => {
    const next = new Set(closed);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setClosed([...next]);
  };

  const selected = selection.filter((full) => data.refs.some((r) => r.full === full && r.kind === "local"));

  const askSelect = (sha: string) => {
    asked.current = sha;
    onSelectSha(sha);
  };

  const clickRef = (e: MouseEvent, ref: Ref) => {
    const toggle = e.metaKey || e.ctrlKey;
    if (ref.kind !== "local") {
      if (!toggle && !e.shiftKey) {
        setSelection([]);
      }
      askSelect(ref.sha);
      return;
    }
    if (toggle) {
      if (!selected.includes(ref.full)) {
        askSelect(ref.sha);
      }
      setSelection(selected.includes(ref.full) ? selected.filter((f) => f !== ref.full) : [...selected, ref.full]);
      return;
    }
    const anchor = selected[selected.length - 1];
    if (e.shiftKey && anchor) {
      askSelect(ref.sha);
      if (selected.includes(ref.full)) {
        return;
      }
      const order = orderedRefs(buildTree(locals)).map((r) => r.full);
      const a = order.indexOf(anchor);
      const b = order.indexOf(ref.full);
      if (a < 0 || b < 0) {
        setSelection([ref.full]);
        return;
      }
      const range = order.slice(Math.min(a, b), Math.max(a, b) + 1).filter((f) => !selected.includes(f));
      setSelection([...selected, ...range]);
      return;
    }
    setSelection([ref.full]);
    askSelect(ref.sha);
  };

  const menuRef = (ref: Ref) => {
    if (ref.kind === "local" && selected.length > 1 && selected.includes(ref.full)) {
      return M.refsMenu(ctx, data.refs.filter((r) => selected.includes(r.full)), () => setSelection([]));
    }
    return M.refMenu(ctx, ref, true);
  };

  const renderRef = (ref: Ref, label: string, depth: number) => {
    const hidden = ctx.solo.length ? !ctx.solo.includes(ref.full) : ctx.hidden.includes(ref.full);
    const branch = ref.kind !== "tag";
    return (
      <div
        key={ref.full}
        className={`item${ref.current ? " current" : ""}${hidden ? " hidden-ref" : ""}${selected.includes(ref.full) ? " selected-row" : ""}${over === ref.full ? " drop-over" : ""}`}
        style={{ paddingLeft: 26 + depth * 14 }}
        draggable={branch}
        onDragStart={(e) => e.dataTransfer.setData("text/gitneat-ref", ref.full)}
        onDragOver={(e) => {
          if (branch && e.dataTransfer.types.includes("text/gitneat-ref")) {
            e.preventDefault();
            setOver(ref.full);
          }
        }}
        onDragLeave={() => setOver(null)}
        onDrop={(e) => {
          const source = e.dataTransfer.getData("text/gitneat-ref");
          setOver(null);
          if (branch && source && M.canDrop(ctx, source, ref)) {
            M.dropMenu(ctx, source, ref);
          }
        }}
        onClick={(e) => clickRef(e, ref)}
        onDoubleClick={(e) => !(e.metaKey || e.ctrlKey || e.shiftKey) && A.openRef(ctx, ref)}
        onContextMenu={() => menuRef(ref)}
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
            {!!ref.behind && <span title={`${cap(ref.behind)} behind`}>{cap(ref.behind)}↓</span>}
            {!!ref.ahead && <span title={`${cap(ref.ahead)} ahead`}>{cap(ref.ahead)}↑</span>}
          </span>
        )}
      </div>
    );
  };

  const renderTree = (node: TreeNode, depth: number, prefix: string, path = ""): ReactNode[] =>
    sortedEntries(node)
      .map(([key, child]) => {
        if (child.ref && child.children.size === 0) {
          return renderRef(child.ref, child.name, depth);
        }
        const id = `${prefix}/${key}`;
        const folderPath = path ? `${path}/${child.name}` : child.name;
        const inFolder = prefix.startsWith("local") ? data.refs.filter((r) => r.kind === "local" && r.full.startsWith(`refs/heads/${folderPath}/`)) : [];
        return (
          <div key={id}>
            <div
              className="item folder"
              style={{ paddingLeft: 26 + depth * 14 }}
              onClick={() => toggleFolder(id)}
              onContextMenu={inFolder.length ? () => M.folderMenu(ctx, folderPath, inFolder) : undefined}
            >
              <span className={`chevron${isClosed(id) ? "" : " open"}`}>›</span>
              <span className="item-icon">{Icon.folder}</span>
              <span className="item-name">{child.name}</span>
            </div>
            {!isClosed(id) && renderTree(child, depth + 1, id, folderPath)}
          </div>
        );
      });

  if (collapsed) {
    const railItems = [
      { title: "LOCAL", icon: Icon.local, count: data.refs.filter((r) => r.kind === "local").length },
      { title: "REMOTE", icon: Icon.remote, count: data.refs.filter((r) => r.kind === "remote").length },
      { title: "WORKTREES", icon: Icon.worktree, count: data.worktrees.length },
      { title: "STASHES", icon: Icon.stash, count: data.stashes.length },
      { title: "TAGS", icon: Icon.tag, count: data.refs.filter((r) => r.kind === "tag").length },
      { title: "SUBMODULES", icon: Icon.submodule, count: submodules.length },
    ];
    return (
      <aside className="sidebar rail">
        <button className="icon-btn" title="Expand Panel" onClick={() => setCollapsed(false)}>
          {Icon.collapseRight}
        </button>
        {railItems.map((item) => (
          <button
            key={item.title}
            className="rail-item"
            title={item.title}
            onClick={() => {
              setOpenSections(openSections.includes(item.title) ? openSections : [...openSections, item.title]);
              setCollapsed(false);
            }}
          >
            {item.icon}
            <span className="rail-count">{item.count}</span>
          </button>
        ))}
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <div className="viewing">
        <span>
          <button className="icon-btn" title="Collapse Panel" onClick={() => setCollapsed(true)}>
            {Icon.collapseLeft}
          </button>
          {Icon.eye} {ctx.solo.length ? "Soloing" : "Viewing"} <b>{visible}/{allBranches.length}</b>
        </span>
        <button className="link" onClick={showAll}>
          Show All
        </button>
      </div>
      <div className="filter">
        <input
          id="sidebar-filter"
          placeholder={gitneat().platform === "darwin" ? "Filter (⌘ + Option + f)" : "Filter (Ctrl + Alt + f)"}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {filter ? (
          <button className="icon-btn filter-clear" title="Clear" onClick={() => setFilter("")}>
            ×
          </button>
        ) : (
          Icon.search
        )}
      </div>
      <div className="sections" ref={sectionsRef}>
        <Section
          {...sectionProps("LOCAL")}
          title="LOCAL"
          icon={Icon.local}
          count={`${locals.filter((r) => (ctx.solo.length ? ctx.solo.includes(r.full) : !ctx.hidden.includes(r.full))).length}/${locals.length}`}
          onMenu={() =>
            showMenu([
              { label: "Hide all local branches", run: () => hideGroup("local", true) },
              { label: "Show all local branches", run: () => hideGroup("local", false) },
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
          onMenu={groupMenu("remote", "remotes")}
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
                  <span className={`chevron${isClosed(id) ? "" : " open"}`}>›</span>
                  <span className="item-icon">{Icon.remote}</span>
                  <span className="item-name">{remote.name}</span>
                </div>
                {!isClosed(id) && renderTree(buildTree(own, 1), 1, id)}
              </div>
            );
          })}
        </Section>
        <Section {...sectionProps("WORKTREES")} title="WORKTREES" icon={Icon.worktree} count={data.worktrees.length}>
          {data.worktrees.map((wt) => (
            <div
              key={wt.path}
              className={`item${samePath(wt.path, data.cwd) ? " current" : ""}`}
              style={{ paddingLeft: 26 }}
              title={wt.path}
              onDoubleClick={() => !samePath(wt.path, data.cwd) && ctx.openTab(wt.path)}
              onClick={() => onSelectSha(wt.sha)}
              onContextMenu={() => M.worktreeMenu(ctx, wt)}
            >
              <span className="item-icon">{Icon.worktree}</span>
              <span className="item-name">{wt.branch ?? wt.sha.slice(0, 7)}</span>
              <span className="item-sub">{wt.path.split(/[\\/]/).pop()}</span>
            </div>
          ))}
        </Section>
        <Section {...sectionProps("STASHES")} title="STASHES"
          icon={Icon.stash}
          count={data.stashes.length}
          onMenu={() =>
            showMenu([
              { label: "Hide all stashes", run: () => ctx.setHidden([STASH_REF], true) },
              { label: "Show all stashes", run: () => ctx.setHidden([STASH_REF], false) },
            ])
          }
        >
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
        <Section {...sectionProps("TAGS")} title="TAGS" icon={Icon.tag} count={tags.length} onMenu={groupMenu("tag", "tags")}>
          {renderTree(buildTree(tags), 0, "tags")}
        </Section>
        <Section
          {...sectionProps("SUBMODULES")}
          title="SUBMODULES"
          icon={Icon.submodule}
          count={submodules.length}
          actions={
            <button className="icon-btn" title="Add a new submodule" onClick={() => A.addSubmodule(ctx)}>
              {Icon.plus}
            </button>
          }
        >
          {submodules.map((sm) => (
            <div
              key={sm.path}
              className="item"
              style={{ paddingLeft: 26 }}
              title={`${sm.name}\n${submoduleStatus(sm, data.name)}`}
              onDoubleClick={() => !sm.uninitialized && !sm.deleted && ctx.openTab(`${data.cwd}/${sm.path}`)}
              onContextMenu={() => M.submoduleMenu(ctx, sm)}
            >
              <span className="item-icon">{Icon.submodule}</span>
              <span className="item-name">{sm.name}</span>
              {(sm.new || sm.deleted || sm.uninitialized || sm.outOfSync || sm.dirty) && <span className="item-sub">{sm.deleted ? "deleted" : sm.new ? "new" : sm.uninitialized ? "not initialized" : sm.outOfSync ? "out of sync" : "modified"}</span>}
            </div>
          ))}
        </Section>
        {ys &&
          SECTIONS.map(
            (title, i) =>
              handles[i] && (
                <div key={title} className="section-split-wrap" style={{ top: ys[title] }}>
                  <Splitter
                    vertical
                    className="section-split"
                    value={ys[title]}
                    min={0}
                    max={100000}
                    set={(n, save) => {
                      const next = { ...ys, [title]: Math.round(n) };
                      if (save === false) {
                        setDrag(next);
                      } else {
                        setDrag(null);
                        setSectionYs(next);
                      }
                    }}
                  />
                </div>
              ),
          )}
      </div>
    </aside>
  );
}
