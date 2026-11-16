import React, { ReactNode, useEffect, useState } from "react";
import * as A from "../actions";
import { Ctx } from "../actions";
import { krill } from "../api";
import * as M from "../menus";
import { CommitDetail, DiffSource, FileChange, loadAllFiles, loadCommit, StatusEntry } from "../repo";
import { WIP } from "./GraphView";
import { Icon } from "./icons";

export interface OpenFile {
  source: DiffSource;
  path: string;
  orig?: string;
  merge?: boolean;
}

interface Props {
  ctx: Ctx;
  sha: string;
  openFile: OpenFile | null;
  onOpenFile(file: OpenFile): void;
  onSelectSha(sha: string): void;
}

const STATUS_CLASS: Record<string, string> = { A: "added", D: "deleted", R: "renamed", C: "renamed", "?": "added", U: "conflict" };

export function StatusIcon({ status }: { status: string }) {
  const symbol = status === "A" || status === "?" ? "+" : status === "D" ? "−" : status === "R" || status === "C" ? "→" : status === "U" ? "!" : "✎";
  return <span className={`file-status ${STATUS_CLASS[status] ?? "modified"}`}>{symbol}</span>;
}

function FileList(props: {
  files: { path: string; status: string; key?: string }[];
  tree: boolean;
  isOpen(path: string): boolean;
  onOpen(path: string): void;
  onMenu?(path: string): void;
  extra?(path: string): ReactNode;
}) {
  const row = (f: { path: string; status: string }, label: ReactNode, depth: number) => (
    <div
      key={f.path}
      className={`file${props.isOpen(f.path) ? " active" : ""}`}
      style={{ paddingLeft: 10 + depth * 14 }}
      title={f.path}
      onClick={() => props.onOpen(f.path)}
      onContextMenu={() => props.onMenu?.(f.path)}
    >
      <StatusIcon status={f.status} />
      <span className="file-path">{label}</span>
      {props.extra?.(f.path)}
    </div>
  );
  if (!props.tree) {
    return (
      <>
        {props.files.map((f) => {
          const i = f.path.lastIndexOf("/");
          return row(
            f,
            <>
              {i >= 0 && <span className="dir">{f.path.slice(0, i + 1)}</span>}
              {f.path.slice(i + 1)}
            </>,
            0,
          );
        })}
      </>
    );
  }
  const out: ReactNode[] = [];
  const seen = new Set<string>();
  for (const f of [...props.files].sort((a, b) => a.path.localeCompare(b.path))) {
    const parts = f.path.split("/");
    for (let d = 0; d < parts.length - 1; d++) {
      const dir = parts.slice(0, d + 1).join("/");
      if (!seen.has(dir)) {
        seen.add(dir);
        out.push(
          <div key={`dir:${dir}`} className="file folder" style={{ paddingLeft: 10 + d * 14 }}>
            ▾ {parts[d]}
          </div>,
        );
      }
    }
    out.push(row(f, parts[parts.length - 1], parts.length - 1));
  }
  return <>{out}</>;
}

function formatDate(seconds: number): string {
  const d = new Date(seconds * 1000);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} @ ${time}`;
}

function Avatar({ name }: { name: string }) {
  const parts = name.trim().split(/\s+/);
  const text = ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  return <div className="avatar">{text}</div>;
}

function CommitInfo({ ctx, sha, openFile, onOpenFile, onSelectSha }: Props) {
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tree, setTree] = useState(false);
  const [all, setAll] = useState<string[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [desc, setDesc] = useState(false);

  useEffect(() => {
    let live = true;
    setDetail(null);
    setAll(null);
    setLoadError(null);
    loadCommit(ctx.cwd, sha).then(
      (d) => live && setDetail(d),
      (e) => live && setLoadError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [ctx.cwd, sha]);

  useEffect(() => {
    if (showAll && !all) {
      loadAllFiles(ctx.cwd, sha).then(setAll, () => undefined);
    }
  }, [showAll, all, ctx.cwd, sha]);

  if (!detail) {
    return <div className="detail-empty">{loadError ?? "Loading…"}</div>;
  }
  const [subject, ...body] = detail.message.split("\n");
  const counts = detail.files.reduce<Record<string, number>>((acc, f) => ({ ...acc, [f.status]: (acc[f.status] ?? 0) + 1 }), {});
  const source: DiffSource = { kind: "commit", sha: detail.sha, parent: detail.parents[0] };
  const changed = new Map(detail.files.map((f) => [f.path, f]));
  const listed: FileChange[] = showAll && all ? all.map((p) => changed.get(p) ?? { path: p, status: " " }) : detail.files;
  const files = [...listed].sort((a, b) => (desc ? b.path.localeCompare(a.path) : a.path.localeCompare(b.path)));

  return (
    <div className="detail">
      <div className="detail-head">
        commit: <b className="sha" onClick={() => krill().copy(detail.sha)} title="Copy commit sha">{detail.sha.slice(0, 6)}</b>
      </div>
      <div className="message-box">
        <div className="subject">{subject}</div>
        {body.join("\n").trim() && <pre className="body">{body.join("\n").trim()}</pre>}
      </div>
      <div className="author">
        <Avatar name={detail.author} />
        <div>
          <div className="author-name">{detail.author}</div>
          <div className="author-date">authored {formatDate(detail.authorTime)}</div>
        </div>
        <div className="parents">
          {detail.parents.map((p) => (
            <div key={p}>
              parent:{" "}
              <a className="sha" onClick={() => onSelectSha(p)}>
                {p.slice(0, 6)}
              </a>
            </div>
          ))}
        </div>
      </div>
      {detail.committer !== detail.author && (
        <div className="author">
          <Avatar name={detail.committer} />
          <div>
            <div className="author-name">{detail.committer}</div>
            <div className="author-date">committed {formatDate(detail.commitTime)}</div>
          </div>
        </div>
      )}
      <div className="file-summary">
        {counts.M && <span><b className="modified">✎</b> {counts.M} modified</span>}
        {counts.A && <span><b className="added">+</b> {counts.A} added</span>}
        {counts.D && <span><b className="deleted">−</b> {counts.D} deleted</span>}
        {counts.R && <span><b className="renamed">→</b> {counts.R} renamed</span>}
      </div>
      <div className="file-toolbar">
        <button className="icon-btn sort-btn" title={desc ? "Sort A to Z" : "Sort Z to A"} onClick={() => setDesc(!desc)}>
          {Icon.sort}
        </button>
        <div className="segmented">
          <button className={!tree ? "on" : ""} onClick={() => setTree(false)}>
            ☰ Path
          </button>
          <button className={tree ? "on" : ""} onClick={() => setTree(true)}>
            ⊞ Tree
          </button>
        </div>
        <label className="check">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> View all files
        </label>
      </div>
      <div className="files">
        <FileList
          files={files}
          tree={tree}
          isOpen={(p) => openFile?.path === p && openFile.source.kind === "commit"}
          onOpen={(p) => onOpenFile({ source, path: p, orig: changed.get(p)?.orig })}
          onMenu={(p) => M.fileMenu(ctx, p)}
        />
      </div>
    </div>
  );
}

function statusCode(e: StatusEntry, staged: boolean): string {
  if (e.index === "?") {
    return "?";
  }
  if (e.index === "U" || e.work === "U" || (e.index === "A" && e.work === "A") || (e.index === "D" && e.work === "D")) {
    return "U";
  }
  return staged ? e.index : e.work;
}

function WipInfo({ ctx, openFile, onOpenFile }: Props) {
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [amend, setAmend] = useState(false);
  const [tree, setTree] = useState(false);
  const status = ctx.data.status;
  const unstaged = status.filter((e) => e.work !== " " || e.index === "?");
  const staged = status.filter((e) => e.index !== " " && e.index !== "?" && statusCode(e, true) !== "U");

  useEffect(() => {
    if (amend && !summary && ctx.data.head) {
      krill()
        .git(ctx.cwd, ["show", "-s", "--format=%B", "HEAD"])
        .then((r) => {
          const [s, ...rest] = r.stdout.trim().split("\n");
          setSummary(s);
          setDescription(rest.join("\n").trim());
        });
    }
  }, [amend, summary, ctx.cwd, ctx.data.head]);

  const doCommit = async () => {
    const message = description.trim() ? `${summary.trim()}\n\n${description.trim()}` : summary.trim();
    if (await A.commit(ctx, message, amend)) {
      setSummary("");
      setDescription("");
      setAmend(false);
    }
  };

  const canCommit = !!summary.trim() && (staged.length > 0 || amend);
  const commitKey = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canCommit) {
      e.preventDefault();
      void doCommit();
    }
  };

  const open = (path: string, isStaged: boolean, untracked: boolean) =>
    onOpenFile({
      source: isStaged ? { kind: "staged" } : { kind: "unstaged", untracked },
      path,
      merge: status.some((e) => e.path === path && statusCode(e, false) === "U"),
    });

  const isOpen = (isStaged: boolean) => (p: string) =>
    openFile?.path === p && openFile.source.kind === (isStaged ? "staged" : "unstaged");

  return (
    <div className="detail wip-detail">
      <div className="detail-head">
        {ctx.data.status.length} file changes on <b>{ctx.data.branch ?? "detached HEAD"}</b>
        <span className="segmented small">
          <button className={!tree ? "on" : ""} onClick={() => setTree(false)}>☰</button>
          <button className={tree ? "on" : ""} onClick={() => setTree(true)}>⊞</button>
        </span>
      </div>
      <div className="stage-section">
        <div className="stage-head">
          <span>Unstaged Files ({unstaged.length})</span>
          <button className="stage-btn" disabled={!unstaged.length} onClick={() => A.stageAll(ctx)}>
            Stage all changes
          </button>
        </div>
        <div className="files">
          <FileList
            files={unstaged.map((e) => ({ path: e.path, status: statusCode(e, false) }))}
            tree={tree}
            isOpen={isOpen(false)}
            onOpen={(p) => open(p, false, unstaged.find((e) => e.path === p)?.index === "?")}
            onMenu={(p) => M.fileMenu(ctx, p, { staged: false, untracked: unstaged.find((e) => e.path === p)?.index === "?" })}
            extra={(p) => (
              <button className="file-action" onClick={(e) => { e.stopPropagation(); A.stageFile(ctx, p); }}>
                Stage File
              </button>
            )}
          />
        </div>
      </div>
      <div className="stage-section">
        <div className="stage-head">
          <span>Staged Files ({staged.length})</span>
          <button className="stage-btn unstage" disabled={!staged.length} onClick={() => A.unstageAll(ctx)}>
            Unstage all changes
          </button>
        </div>
        <div className="files">
          <FileList
            files={staged.map((e) => ({ path: e.path, status: statusCode(e, true) }))}
            tree={tree}
            isOpen={isOpen(true)}
            onOpen={(p) => open(p, true, false)}
            onMenu={(p) => M.fileMenu(ctx, p, { staged: true, untracked: false })}
            extra={(p) => (
              <button className="file-action" onClick={(e) => { e.stopPropagation(); A.unstageFile(ctx, p); }}>
                Unstage File
              </button>
            )}
          />
        </div>
      </div>
      <div className="commit-box">
        <div className="commit-box-head">
          <span>Commit</span>
          <label className="check">
            <input type="checkbox" checked={amend} disabled={!ctx.data.head} onChange={(e) => setAmend(e.target.checked)} /> Amend
          </label>
        </div>
        <input className="summary" placeholder="Commit summary" maxLength={200} value={summary} onChange={(e) => setSummary(e.target.value)} onKeyDown={commitKey} />
        <textarea className="description" placeholder="Description" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} onKeyDown={commitKey} />
        <button
          className="commit-btn"
          disabled={!canCommit}
          onClick={doCommit}
        >
          {!staged.length && !amend ? "Stage files/changes to commit" : amend ? "Amend previous commit" : `Commit changes to ${staged.length} file${staged.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}

export function DetailPanel(props: Props) {
  return <section className="right-panel">{props.sha === WIP ? <WipInfo {...props} /> : <CommitInfo {...props} />}</section>;
}
