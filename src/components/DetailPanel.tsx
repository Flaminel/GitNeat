import React, { ReactNode, useEffect, useState } from "react";
import * as A from "../actions";
import { Ctx } from "../actions";
import { gitneat } from "../api";
import * as M from "../menus";
import { showMenu, Splitter, useStoredWidth } from "../ui";
import { CommitDetail, CompareFile, DiffSource, FileChange, hasCommitHook, loadAllFiles, loadCommit, loadCompare, loadHeadMessage, loadOperation, OperationInfo, StatusEntry } from "../repo";
import { WIP } from "./GraphView";
import { Icon } from "./icons";

export interface OpenFile {
  source: DiffSource;
  path: string;
  orig?: string;
  merge?: boolean;
  view?: "blame" | "history";
}

interface Props {
  ctx: Ctx;
  sha: string;
  multi: string[];
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
  picked?: string[];
  onPick?(path: string, range: boolean): void;
}) {
  const row = (f: { path: string; status: string }, label: ReactNode, depth: number) => (
    <div
      key={f.path}
      className={`file${props.isOpen(f.path) ? " active" : ""}${props.picked?.includes(f.path) ? " picked" : ""}`}
      style={{ paddingLeft: 10 + depth * 14 }}
      title={f.path}
      onClick={(e) => (props.onPick && (e.metaKey || e.ctrlKey || e.shiftKey) ? props.onPick(f.path, e.shiftKey) : props.onOpen(f.path))}
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

const SUMMARY_SOFT_LIMIT = 72;

function SummaryCounter({ value }: { value: string }) {
  const left = SUMMARY_SOFT_LIMIT - [...value].length;
  return (
    <span
      className={left < 0 ? "summary-chars-left is-exceeded" : "summary-chars-left"}
      title={`Commit summaries no longer than ${SUMMARY_SOFT_LIMIT} characters will be fully displayed in most websites and CLI tools.`}
    >
      {left}
    </span>
  );
}

function Avatar({ name }: { name: string }) {
  const parts = name.trim().split(/\s+/);
  const text = ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  return <div className="avatar">{text}</div>;
}

function FileSummary({ files }: { files: FileChange[] }) {
  const counts = files.reduce<Record<string, number>>((acc, f) => ({ ...acc, [f.status]: (acc[f.status] ?? 0) + 1 }), {});
  return (
    <div className="file-summary">
      {counts.M && <span><b className="modified">✎</b> {counts.M} modified</span>}
      {counts.A && <span><b className="added">+</b> {counts.A} added</span>}
      {counts.D && <span><b className="deleted">−</b> {counts.D} deleted</span>}
      {counts.R && <span><b className="renamed">→</b> {counts.R} renamed</span>}
    </div>
  );
}

function FileToolbar(props: {
  desc: boolean;
  setDesc(value: boolean): void;
  tree: boolean;
  setTree(value: boolean): void;
  showAll?: boolean;
  setShowAll?(value: boolean): void;
}) {
  return (
    <div className="file-toolbar">
      <button className="icon-btn sort-btn" title={props.desc ? "Sort A to Z" : "Sort Z to A"} onClick={() => props.setDesc(!props.desc)}>
        {Icon.sort}
      </button>
      <div className="segmented">
        <button className={!props.tree ? "on" : ""} onClick={() => props.setTree(false)}>
          ☰ Path
        </button>
        <button className={props.tree ? "on" : ""} onClick={() => props.setTree(true)}>
          ⊞ Tree
        </button>
      </div>
      {props.setShowAll && (
        <label className="check">
          <input type="checkbox" checked={props.showAll} onChange={(e) => props.setShowAll?.(e.target.checked)} /> View all files
        </label>
      )}
    </div>
  );
}

function compareSource(f: CompareFile): DiffSource {
  if (f.untracked) {
    return { kind: "unstaged", untracked: true };
  }
  return f.head ? { kind: "commit", sha: f.head, parent: f.base } : { kind: "worktree", base: f.base };
}

function compareTitle(count: number, wip: boolean): string {
  if (count === 1) {
    return "Viewing diff between a commit and the WIP";
  }
  const suffix = wip ? " and the WIP" : "";
  return count === 2 ? `Viewing diff between 2 commits${suffix}` : `Viewing merged diff of ${count} commits${suffix}`;
}

function CompareInfo({ ctx, multi, openFile, onOpenFile }: Props) {
  const [loaded, setLoaded] = useState<{ key: string; files: CompareFile[] } | null>(null);
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
  const [tree, setTree] = useState(false);
  const [desc, setDesc] = useState(false);
  const wip = multi.includes(WIP);
  const shas = multi.filter((s) => s !== WIP);
  const key = JSON.stringify([shas, wip]);
  const cards = ctx.data.commits.filter((c) => shas.includes(c.sha));

  useEffect(() => {
    let live = true;
    loadCompare(ctx.cwd, shas, wip).then(
      (files) => live && setLoaded({ key, files }),
      (e) => live && setFailed({ key, message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [ctx.cwd, ctx.data, key]);

  const files = loaded?.key === key ? loaded.files : null;
  const error = failed?.key === key ? failed.message : null;
  const sorted = [...(files ?? [])].sort((a, b) => (desc ? b.path.localeCompare(a.path) : a.path.localeCompare(b.path)));
  const byPath = new Map(sorted.map((f) => [f.path, f]));
  const same = (a: DiffSource, b: DiffSource) => JSON.stringify(a) === JSON.stringify(b);

  return (
    <div className="detail">
      <div className="detail-head">
        {shas.length === 1 ? (
          <>
            commit: <b className="sha">{shas[0].slice(0, 6)}</b>
          </>
        ) : (
          `${shas.length} commits selected`
        )}
      </div>
      <div className="multi-commit-section">
        <div className="multi-commit-title">{compareTitle(shas.length, wip)}</div>
        <div className="multi-commits">
          {wip && (
            <div className="multi-commit">
              <Avatar name="WIP" />
              <div className="multi-commit-text">
                <div className="author-name">Working directory</div>
                <div className="author-date">{ctx.data.status.length} changes</div>
              </div>
            </div>
          )}
          {cards.map((c) => (
            <div key={c.sha} className="multi-commit">
              <Avatar name={c.author} />
              <div className="multi-commit-text">
                <div className="author-name" title={c.email || undefined}>{c.author}</div>
                <div className="author-date">
                  {formatDate(c.time)} <b className="sha">{c.sha.slice(0, 6)}</b>
                </div>
                <div className="multi-commit-subject" title={c.subject}>{c.subject}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {error && <div className="detail-empty">{error}</div>}
      {!files && !error && <div className="detail-empty">Loading…</div>}
      {files && (
        <>
          <FileSummary files={files} />
          <FileToolbar desc={desc} setDesc={setDesc} tree={tree} setTree={setTree} />
          <div className="files">
            <FileList
              files={sorted}
              tree={tree}
              isOpen={(p) => {
                const f = byPath.get(p);
                return Boolean(f && openFile?.path === p && same(openFile.source, compareSource(f)));
              }}
              onOpen={(p) => {
                const f = byPath.get(p);
                if (f) {
                  onOpenFile({ source: compareSource(f), path: p, orig: f.orig });
                }
              }}
              onMenu={(p) => {
                const f = byPath.get(p);
                const source = f && compareSource(f);
                return M.fileMenu(ctx, p, undefined, undefined, undefined, (view) => f && onOpenFile({ source: compareSource(f), path: p, orig: f.orig, view }), source);
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

function CommitInfo({ ctx, sha, openFile, onOpenFile, onSelectSha }: Props) {
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tree, setTree] = useState(false);
  const [all, setAll] = useState<string[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [desc, setDesc] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState<{ summary: string; description: string } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [messageHeight, setMessageHeight] = useStoredWidth("message", 130);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), 1000);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    let live = true;
    setDetail(null);
    setAll(null);
    setLoadError(null);
    setEditing(null);
    setPicked([]);
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
  const source: DiffSource = { kind: "commit", sha: detail.sha, parent: detail.parents[0] };
  const changed = new Map(detail.files.map((f) => [f.path, f]));
  const listed: FileChange[] = showAll && all ? all.map((p) => changed.get(p) ?? { path: p, status: " " }) : detail.files;
  const extra = detail.untracked ?? [];
  const withUntracked: FileChange[] = [...listed, ...extra.filter((p) => !listed.some((f) => f.path === p)).map((p) => ({ path: p, status: "A" }))];
  const files = [...withUntracked].sort((a, b) => (desc ? b.path.localeCompare(a.path) : a.path.localeCompare(b.path)));
  const stash = ctx.data.stashes.find((s) => s.sha === detail.sha);
  const isHead = detail.sha === ctx.data.head;
  const depth = stash ? 0 : A.rewordDepth(ctx.data, detail.sha);
  const saveMessage = async () => {
    if (!editing) {
      return;
    }
    const message = editing.description.trim() ? `${editing.summary.trim()}\n\n${editing.description.trim()}` : editing.summary.trim();
    if (message === detail.message.trim()) {
      setEditing(null);
      return;
    }
    try {
      if (stash ? await A.editStash(ctx, stash.ref, message) : await A.saveMessage(ctx, detail.sha, isHead, message)) {
        setEditing(null);
      }
    } catch (error) {
      ctx.ui.toast(error instanceof Error ? error.message : String(error), "error");
    }
  };

  return (
    <div className="detail">
      <div className="detail-head">
        {stash ? "stash" : "commit"}:{" "}
        <b className="sha" onClick={() => gitneat().copy(detail.sha).then(() => setCopied(true))} title="Copy">
          {detail.sha.slice(0, 6)}
        </b>
        {copied && <span className="copied">Copied!</span>}
      </div>
      {stash && (
        <div className="stash-actions">
          <button onClick={() => A.stashApply(ctx, stash.ref)}>Apply</button>
          <button onClick={() => A.stashPop(ctx, stash.ref)}>Pop</button>
          <button className="danger" onClick={() => A.stashDrop(ctx, stash.ref)}>Delete</button>
        </div>
      )}
      {editing ? (
        <div className="message-edit">
          <div className="summary-row">
            <input
              className="summary"
              autoFocus
              maxLength={200}
              value={editing.summary}
              onChange={(e) => setEditing({ ...editing, summary: e.target.value })}
            />
            <SummaryCounter value={editing.summary} />
          </div>
          <textarea
            className="description"
            placeholder="Description"
            rows={4}
            value={editing.description}
            onChange={(e) => setEditing({ ...editing, description: e.target.value })}
          />
          {!stash && !isHead && depth !== null && (
            <div className="reword-note">Rewording this commit message will cause {depth + 1} commits to be rebased.</div>
          )}
          <button className="commit-btn" disabled={!editing.summary.trim()} onClick={saveMessage}>
            Update Message
          </button>
          <button onClick={() => setEditing(null)}>{isHead || stash ? "Cancel Amend" : "Cancel Reword"}</button>
        </div>
      ) : (
        <>
          <div
            style={{ height: messageHeight }}
            className={`message-box${depth !== null ? " editable-message" : ""}`}
            title={depth === null ? undefined : stash ? "Click to amend your stash message" : isHead ? "Click to amend your commit message" : "Click to reword your commit message"}
            onClick={() => {
              if (depth !== null) {
                setEditing({ summary: subject, description: body.join("\n").trim() });
              }
            }}
          >
            <div className="subject">{subject}</div>
            {body.join("\n").trim() && <pre className="body">{body.join("\n").trim()}</pre>}
          </div>
          <Splitter vertical value={messageHeight} set={setMessageHeight} min={60} max={600} />
        </>
      )}
      <div className="author">
        <Avatar name={detail.author} />
        <div>
          <div className="author-name" title={detail.email || undefined}>{detail.author}</div>
          <div className="author-date">authored {formatDate(detail.authorTime)}</div>
        </div>
        <div className="parents">
          {(stash ? detail.parents.slice(0, 1) : detail.parents).map((p) => (
            <div key={p}>
              parent:{" "}
              <a
                className="sha"
                onClick={() => onSelectSha(p)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  void showMenu([{ label: "Copy sha", run: () => gitneat().copy(p) }]);
                }}
              >
                {p.slice(0, 6)}
              </a>
            </div>
          ))}
        </div>
      </div>
      {(detail.committer !== detail.author || detail.committerEmail !== detail.email) && (
        <div className="author">
          <Avatar name={detail.committer} />
          <div>
            <div className="author-name" title={detail.committerEmail || undefined}>{detail.committer}</div>
            <div className="author-date">committed {formatDate(detail.commitTime)}</div>
          </div>
        </div>
      )}
      {detail.coAuthors.length > 0 && (
        <div className="co-authors">
          <span>Co-authors:</span>
          {detail.coAuthors.map((c) => {
            const match = /^(.*?)\s*<([^>]*)>$/.exec(c);
            const name = match ? match[1] || match[2] : c;
            return (
              <span key={c} className="co-author" title={match?.[2] || undefined}>
                <Avatar name={name} />
                {name}
              </span>
            );
          })}
        </div>
      )}
      <FileSummary files={detail.files} />
      <FileToolbar desc={desc} setDesc={setDesc} tree={tree} setTree={setTree} showAll={showAll} setShowAll={setShowAll} />
      <div className="files">
        <FileList
          files={files}
          tree={tree}
          isOpen={(p) => openFile?.path === p && openFile.source.kind === "commit"}
          picked={stash ? picked : undefined}
          onPick={
            stash
              ? (p, range) => {
                  const names = files.map((f) => f.path);
                  if (range && picked.length) {
                    const a = names.indexOf(picked[picked.length - 1]);
                    const b = names.indexOf(p);
                    setPicked(names.slice(Math.min(a, b), Math.max(a, b) + 1));
                  } else {
                    setPicked(picked.includes(p) ? picked.filter((x) => x !== p) : [...picked, p]);
                  }
                }
              : undefined
          }
          onOpen={(p) =>
            onOpenFile(
              extra.includes(p) && !changed.has(p)
                ? { source: { kind: "commit", sha: detail.parents[2], parent: "" }, path: p }
                : { source, path: p, orig: changed.get(p)?.orig },
            )
          }
          onMenu={(p) => {
            const chosen = picked.length > 1 && picked.includes(p) ? picked : [p];
            const origins = [...changed.values()].filter((f) => f.orig && chosen.includes(f.path)).map((f) => f.orig as string);
            const original = extra.includes(p) && !changed.has(p) ? { kind: "commit" as const, sha: detail.parents[2], parent: "" } : source;
            return M.fileMenu(
              ctx,
              p,
              undefined,
              undefined,
              stash ? { ref: stash.ref, paths: chosen, origins } : undefined,
              (view) => onOpenFile({ source: original, path: p, orig: changed.get(p)?.orig, view }),
              original,
            );
          }}
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
  const [pendingPush, setPendingPush] = useState<boolean | null>(null);
  const [pendingSkip, setPendingSkip] = useState<boolean | null>(null);
  const pushAfter = pendingPush ?? ctx.commitDefaults.push;
  const skipHooks = pendingSkip ?? ctx.commitDefaults.skipHooks;
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [picked, setPicked] = useState<{ staged: boolean; paths: string[] }>({ staged: false, paths: [] });
  const [hook, setHook] = useState(false);
  const status = ctx.data.status;
  const conflicted = status.filter((e) => statusCode(e, false) === "U");
  const unstaged = status.filter((e) => (e.work !== " " || e.index === "?") && statusCode(e, false) !== "U");
  const staged = status.filter((e) => e.index !== " " && e.index !== "?" && statusCode(e, true) !== "U");

  const unstagedPaths = unstaged.map((e) => e.path);
  const stagedPaths = staged.map((e) => e.path);

  const operation = ctx.data.operation === "merge" || ctx.data.operation === "rebase" ? ctx.data.operation : null;
  const [opInfo, setOpInfo] = useState<OperationInfo | null>(null);
  useEffect(() => {
    setOpInfo(null);
    if (!operation) {
      return;
    }
    let live = true;
    void loadOperation(ctx.cwd, operation).then((info) => live && setOpInfo(info));
    return () => {
      live = false;
    };
  }, [operation, ctx.cwd, ctx.data.head]);

  useEffect(() => {
    if (amend && !summary && ctx.data.head) {
      loadHeadMessage(ctx.cwd).then((m) => {
        setSummary(m.summary);
        setDescription(m.description);
      });
    }
  }, [amend, summary, ctx.cwd, ctx.data.head]);

  useEffect(() => {
    let live = true;
    void hasCommitHook(ctx.cwd).then((found) => live && setHook(found));
    return () => {
      live = false;
    };
  }, [ctx.cwd, ctx.data.head]);

  const skip = hook && skipHooks;
  const doCommit = async () => {
    const message = description.trim() ? `${summary.trim()}\n\n${description.trim()}` : summary.trim();
    if (await A.commit(ctx, message, amend, { push: pushAfter, noVerify: skip })) {
      setSummary("");
      setDescription("");
      setAmend(false);
    }
  };

  const baseLabel = !staged.length && !amend ? "Stage files/changes to commit" : amend ? "Amend previous commit" : `Commit changes to ${staged.length} file${staged.length === 1 ? "" : "s"}`;
  const commitLabel = staged.length || amend ? `${baseLabel}${pushAfter ? " and Push" : ""}${skip ? " (Skip Hooks)" : ""}` : baseLabel;
  const canCommit = !!summary.trim() && (staged.length > 0 || amend);
  const commitKey = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canCommit) {
      e.preventDefault();
      void doCommit();
    }
  };

  const pick = (list: string[], isStaged: boolean) => (p: string, range: boolean) => {
    const current = picked.staged === isStaged ? picked.paths.filter((x) => list.includes(x)) : [];
    if (range && current.length) {
      const a = list.indexOf(current[current.length - 1]);
      const b = list.indexOf(p);
      setPicked({ staged: isStaged, paths: list.slice(Math.min(a, b), Math.max(a, b) + 1) });
    } else {
      setPicked({ staged: isStaged, paths: current.includes(p) ? current.filter((x) => x !== p) : [...current, p] });
    }
  };
  const pickedIn = (list: string[], isStaged: boolean) => (picked.staged === isStaged ? picked.paths.filter((x) => list.includes(x)) : []);
  const selection = (list: string[], isStaged: boolean, p: string): M.FileSelection => {
    const chosen = pickedIn(list, isStaged);
    return {
      stash: ctx.data.operation !== "merge",
      paths: chosen.length > 1 && chosen.includes(p) ? chosen : [p],
      message: description.trim() ? `${summary.trim()}\n\n${description.trim()}` : summary.trim(),
      done: () => {
        setSummary("");
        setDescription("");
        setPicked({ staged: false, paths: [] });
      },
    };
  };

  const open = (path: string, isStaged: boolean, untracked: boolean, view?: "blame" | "history") => {
    setPicked({ staged: false, paths: [] });
    onOpenFile({
      source: isStaged ? { kind: "staged" } : { kind: "unstaged", untracked },
      path,
      merge: !view && status.some((e) => e.path === path && statusCode(e, false) === "U"),
      view,
    });
  };

  const isOpen = (isStaged: boolean) => (p: string) =>
    openFile?.path === p && openFile.source.kind === (isStaged ? "staged" : "unstaged");

  return (
    <div className="detail wip-detail">
      <div className="detail-head">
        {operation && conflicted.length > 0 ? (
          <span>
            <span className="detached-icon">⚠</span>
            {operation === "rebase" ? "Rebase conflicts detected" : "Merge conflicts detected"}
          </span>
        ) : (
          <span>
            {ctx.data.status.length} file changes on <b>{ctx.data.branch ?? "detached HEAD"}</b>
          </span>
        )}
        <span className="segmented small">
          <button className={!tree ? "on" : ""} onClick={() => setTree(false)}>☰</button>
          <button className={tree ? "on" : ""} onClick={() => setTree(true)}>⊞</button>
        </span>
      </div>
      {operation && conflicted.length > 0 && opInfo && opInfo.from && opInfo.to && (
        <div className="conflicts-header">
          {operation === "rebase" ? `Rebasing ${opInfo.from} onto ${opInfo.to}` : `Merging ${opInfo.from} into ${opInfo.to}`}
        </div>
      )}
      {!ctx.data.branch && ctx.data.head && ctx.data.operation !== "rebase" && (
        <div className="detached-warning" title="If you checkout another branch or commit, you might lose any commits created in a detached HEAD state">
          <span className="detached-icon">⚠</span>
          You are in a detached HEAD state
        </div>
      )}
      {conflicted.length > 0 && (
        <div className="stage-section">
          <div className="stage-head">
            <span>Conflicted Files ({conflicted.length})</span>
            <button className="stage-btn" onClick={() => A.markResolved(ctx, conflicted.map((e) => e.path))}>
              Mark all resolved
            </button>
          </div>
          <div className="files">
            <FileList
              files={conflicted.map((e) => ({ path: e.path, status: "U" }))}
              tree={tree}
              isOpen={isOpen(false)}
              onOpen={(p) => open(p, false, false)}
              onMenu={(p) =>
                M.fileMenu(ctx, p, {
                  staged: false,
                  untracked: false,
                  conflict: { current: opInfo?.to || ctx.data.head?.slice(0, 7) || "", incoming: opInfo?.from || "Applied patch or stash" },
                })
              }
            />
          </div>
        </div>
      )}
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
            picked={pickedIn(unstagedPaths, false)}
            onPick={pick(unstagedPaths, false)}
            onMenu={(p) => M.fileMenu(ctx, p, { staged: false, untracked: unstaged.find((e) => e.path === p)?.index === "?" }, selection(unstagedPaths, false, p), undefined, (view) => open(p, false, unstaged.find((e) => e.path === p)?.index === "?", view))}
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
          <span>{ctx.data.operation ? "Resolved Files" : "Staged Files"} ({staged.length})</span>
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
            picked={pickedIn(stagedPaths, true)}
            onPick={pick(stagedPaths, true)}
            onMenu={(p) => M.fileMenu(ctx, p, { staged: true, untracked: false }, selection(stagedPaths, true, p), undefined, (view) => open(p, true, false, view))}
            extra={(p) => (
              <button className="file-action" onClick={(e) => { e.stopPropagation(); A.unstageFile(ctx, p); }}>
                Unstage File
              </button>
            )}
          />
        </div>
      </div>
      {operation ? (
        <div className="commit-box">
          <button
            className="commit-btn"
            disabled={operation === "merge" && !staged.length}
            onClick={() => (staged.length ? A.continueOperation(ctx, operation) : A.skipOperation(ctx))}
          >
            {operation === "merge"
              ? staged.length
                ? "Commit and Merge"
                : "No Changes to Merge"
              : staged.length
                ? "Continue Rebase"
                : "Skip Commit"}
          </button>
          <button className="commit-btn danger" onClick={() => A.abortOperation(ctx, operation)}>
            {operation === "merge" ? "Abort Merge" : "Abort Rebase"}
          </button>
        </div>
      ) : (
        <div className="commit-box">
          <div className="commit-box-head">
            <span>Commit</span>
            <label className="check">
              <input type="checkbox" checked={amend} disabled={!ctx.data.head} onChange={(e) => setAmend(e.target.checked)} /> Amend
            </label>
          </div>
          <div className="summary-row">
            <input className="summary" placeholder="Commit summary" maxLength={200} value={summary} onChange={(e) => setSummary(e.target.value)} onKeyDown={commitKey} />
            <SummaryCounter value={summary} />
          </div>
          <textarea className="description" placeholder="Description" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} onKeyDown={commitKey} />
          <button
            className="commit-btn"
            disabled={!canCommit}
            onClick={doCommit}
          >
            {commitLabel}
          </button>
          <button className="commit-options-toggle" onClick={() => setOptionsOpen(!optionsOpen)}>
            Commit options {optionsOpen ? "▾" : "▸"}
          </button>
          {optionsOpen && (
            <div className="commit-options">
              <label className="check">
                <input type="checkbox" checked={pushAfter} onChange={(e) => setPendingPush(e.target.checked)} /> Push after committing
              </label>
              {hook && (
                <label className="check">
                  <input type="checkbox" checked={skipHooks} onChange={(e) => setPendingSkip(e.target.checked)} /> Skip Git hooks
                </label>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function DetailPanel(props: Props) {
  const body = props.multi.length > 1 ? <CompareInfo {...props} /> : props.sha === WIP ? <WipInfo {...props} /> : <CommitInfo {...props} />;
  return <section className="right-panel">{body}</section>;
}
