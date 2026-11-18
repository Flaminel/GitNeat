import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import type { Ctx } from "../src/actions";
import type { MenuSpec } from "../src/api";
import type { GitResult } from "./reference/api";
import type { Commit, Ref, RepoData } from "../src/repo";

const enabled = process.env.GITNEAT_RUST_COMPARE === "1";
const rustDir = path.resolve(process.cwd(), "rust");

function runGit(cwd: string, args: string[], env?: Record<string, string>, input?: string): Promise<GitResult> {
  return new Promise((resolve) => {
    const child = execFile(
      "git",
      args,
      { cwd, maxBuffer: 512 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C", ...env } },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        resolve({ code, stdout, stderr: stderr || (error && code !== 0 ? error.message : "") });
      },
    );
    if (input !== undefined) {
      child.stdin?.end(input);
    }
  });
}

interface Dirs {
  root: string;
  repo: string;
  remote: string;
  other: string;
  wt: string;
}

interface Call {
  label: string;
  platformSensitive: boolean;
  run: (ctx: Ctx) => Promise<void>;
}

interface Scenario {
  name: string;
  setup: (d: Dirs) => void;
  platform?: string;
  marks?: (data: RepoData) => { hidden: string[]; solo: string[] };
}

type Api = Record<string, unknown>;

let runRoot = "";
let menuExample = "";
let M: typeof import("../src/menus");
let tsMenus: typeof import("../src/menus");
let rsMenus: typeof import("../src/menus");
let loadRepo: typeof import("./reference/repo").loadRepo;

function setApi(api: Api): void {
  (globalThis as { window?: unknown }).window = { gitneat: api };
}

function g(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function tryGit(cwd: string, ...args: string[]): void {
  try {
    g(cwd, ...args);
  } catch {
    return;
  }
}

function write(dir: string, name: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
  fs.writeFileSync(path.join(dir, name), text);
}

function commit(dir: string, name: string, text: string, message: string): void {
  write(dir, name, text);
  g(dir, "add", "-A");
  g(dir, "commit", "-q", "-m", message);
}

function base(d: Dirs): void {
  fs.mkdirSync(d.repo, { recursive: true });
  g(d.repo, "init", "-q", "-b", "main");
  commit(d.repo, "a.txt", "one\n", "first");
  commit(d.repo, "b.txt", "two\n", "second");
}

function linear(d: Dirs): void {
  base(d);
  commit(d.repo, "c.txt", "c\n", "third");
  commit(d.repo, "d.txt", "d\n", "fourth");
  commit(d.repo, "c.txt", "c2\n", "fifth");
}

function branches(d: Dirs): void {
  base(d);
  g(d.repo, "branch", "merged");
  g(d.repo, "checkout", "-q", "-b", "unmerged");
  commit(d.repo, "u.txt", "u\n", "unmerged work");
  g(d.repo, "checkout", "-q", "-b", "feature/deep", "main");
  commit(d.repo, "s.txt", "s\n", "side work");
  g(d.repo, "checkout", "-q", "main");
}

function remote(d: Dirs): void {
  base(d);
  g(d.root, "clone", "-q", "--bare", d.repo, d.remote);
  g(d.repo, "remote", "add", "origin", d.remote);
  g(d.repo, "fetch", "-q", "origin");
  g(d.repo, "branch", "--set-upstream-to=origin/main", "main");
  g(d.repo, "checkout", "-q", "-b", "topic");
  commit(d.repo, "t.txt", "t\n", "topic work");
  g(d.repo, "push", "-q", "-u", "origin", "topic");
  g(d.repo, "checkout", "-q", "main");
}

function remoteWork(d: Dirs): void {
  g(d.root, "clone", "-q", d.remote, d.other);
  commit(d.other, "r.txt", "r\n", "remote work");
  g(d.other, "push", "-q", "origin", "main");
}

function behind(d: Dirs): void {
  remote(d);
  remoteWork(d);
  g(d.repo, "fetch", "-q", "origin");
}

function diverged(d: Dirs): void {
  remote(d);
  remoteWork(d);
  commit(d.repo, "l.txt", "l\n", "local work");
  g(d.repo, "fetch", "-q", "origin");
}

function web(d: Dirs): void {
  remote(d);
  g(d.repo, "remote", "add", "mirror", d.remote);
  g(d.repo, "remote", "add", "bb", d.remote);
  g(d.repo, "fetch", "-q", "--all");
  g(d.repo, "remote", "set-url", "origin", "git@github.com:owner/repo.git");
  g(d.repo, "remote", "set-url", "mirror", "https://gitlab.com/group/project.git");
  g(d.repo, "remote", "set-url", "bb", "ssh://git@bitbucket.org/team/repo.git");
  g(d.repo, "tag", "v1", "main~1");
  g(d.repo, "tag", "-a", "v2", "-m", "release");
}

function slashes(d: Dirs): void {
  remote(d);
  g(d.repo, "push", "-q", "origin", "main:release/v1");
  g(d.repo, "checkout", "-q", "-b", "feature/x");
  commit(d.repo, "x.txt", "x\n", "x work");
  g(d.repo, "checkout", "-q", "main");
  g(d.repo, "fetch", "-q", "origin");
}

function detached(d: Dirs): void {
  linear(d);
  g(d.repo, "tag", "v1", "main~3");
  g(d.repo, "checkout", "-q", "--detach", "main~1");
}

function ffHead(d: Dirs): void {
  base(d);
  g(d.repo, "checkout", "-q", "-b", "feature");
  commit(d.repo, "f1.txt", "f\n", "feature one");
  commit(d.repo, "f2.txt", "f\n", "feature two");
  g(d.repo, "checkout", "-q", "main");
}

function ffBehind(d: Dirs): void {
  ffHead(d);
  g(d.repo, "checkout", "-q", "feature");
}

function worktrees(d: Dirs): void {
  base(d);
  g(d.repo, "worktree", "add", "-q", d.wt, "-b", "wtb");
  g(d.repo, "worktree", "add", "-q", `${d.wt}-locked`, "-b", "wtl");
  g(d.repo, "worktree", "lock", "--reason", "busy", `${d.wt}-locked`);
  g(d.repo, "worktree", "add", "-q", `${d.wt}-gone`, "-b", "wtg");
  fs.rmSync(`${d.wt}-gone`, { recursive: true, force: true });
}

function stashed(d: Dirs): void {
  base(d);
  write(d.repo, "a.txt", "stashed\n");
  write(d.repo, "u.txt", "untracked\n");
  g(d.repo, "stash", "push", "-q", "--include-untracked");
  commit(d.repo, "c.txt", "c\n", "third");
}

function dirty(d: Dirs): void {
  base(d);
  write(d.repo, "a.txt", "dirty\n");
  write(d.repo, "b.txt", "dirty\n");
  g(d.repo, "add", "b.txt");
  write(d.repo, "b.txt", "dirtier\n");
  write(d.repo, "new.txt", "new\n");
  write(d.repo, "staged.txt", "staged\n");
  g(d.repo, "add", "staged.txt");
}

function conflict(d: Dirs): void {
  base(d);
  g(d.repo, "checkout", "-q", "-b", "side", "main~1");
  commit(d.repo, "a.txt", "side\n", "side change");
  g(d.repo, "checkout", "-q", "main");
  commit(d.repo, "a.txt", "main\n", "main change");
}

function merging(d: Dirs): void {
  conflict(d);
  tryGit(d.repo, "merge", "side");
  write(d.repo, "untracked.txt", "u\n");
  write(d.repo, "ok.txt", "ok\n");
  g(d.repo, "add", "ok.txt");
}

function rebasing(d: Dirs): void {
  conflict(d);
  tryGit(d.repo, "rebase", "side");
}

function picking(d: Dirs): void {
  conflict(d);
  tryGit(d.repo, "cherry-pick", "side");
}

function merges(d: Dirs): void {
  base(d);
  g(d.repo, "checkout", "-q", "-b", "feat");
  commit(d.repo, "f.txt", "f\n", "feature work");
  g(d.repo, "checkout", "-q", "main");
  commit(d.repo, "m.txt", "m\n", "main work");
  g(d.repo, "merge", "-q", "--no-ff", "-m", "merge feat", "feat");
  commit(d.repo, "n.txt", "n\n", "after merge");
}

function tags(d: Dirs): void {
  base(d);
  g(d.repo, "tag", "light", "main~1");
  g(d.repo, "tag", "twin", "main~1");
  g(d.repo, "tag", "-a", "annotated", "-m", "release");
  g(d.repo, "branch", "onTag", "main~1");
  commit(d.repo, "c.txt", "c\n", "third");
  g(d.repo, "tag", "-a", "head-tag", "-m", "release 2");
}

function tagsRemote(d: Dirs): void {
  remote(d);
  g(d.repo, "tag", "v1", "main");
  g(d.repo, "tag", "-a", "v0", "-m", "old", "main~1");
  g(d.repo, "push", "-q", "origin", "v1");
}

function unborn(d: Dirs): void {
  fs.mkdirSync(d.repo, { recursive: true });
  g(d.repo, "init", "-q", "-b", "main");
  write(d.repo, "a.txt", "a\n");
  write(d.repo, "b.txt", "b\n");
  g(d.repo, "add", "a.txt");
}

function orphan(d: Dirs): void {
  linear(d);
  g(d.repo, "checkout", "-q", "-b", "other", "main~3");
  commit(d.repo, "o.txt", "o\n", "other work");
  g(d.repo, "checkout", "-q", "main");
}

const marksOf = (data: RepoData) => {
  const locals = data.refs.filter((r) => r.kind !== "tag");
  return { hidden: locals.slice(0, 1).map((r) => r.full), solo: locals.slice(1, 3).map((r) => r.full) };
};

const scenarios: Scenario[] = [
  { name: "linear", setup: linear },
  { name: "branches", setup: branches },
  { name: "remote", setup: remote, marks: marksOf },
  { name: "remote-win32", setup: remote, platform: "win32", marks: marksOf },
  { name: "behind", setup: behind },
  { name: "diverged", setup: diverged },
  { name: "web", setup: web, marks: marksOf },
  { name: "slashes", setup: slashes },
  { name: "detached", setup: detached },
  { name: "ff-head", setup: ffHead },
  { name: "ff-behind", setup: ffBehind },
  { name: "worktrees", setup: worktrees },
  { name: "worktrees-win32", setup: worktrees, platform: "win32" },
  { name: "stashed", setup: stashed },
  { name: "dirty", setup: dirty },
  { name: "dirty-win32", setup: dirty, platform: "win32" },
  { name: "merging", setup: merging },
  { name: "rebasing", setup: rebasing },
  { name: "picking", setup: picking },
  { name: "merges", setup: merges },
  { name: "tags", setup: tags, marks: marksOf },
  { name: "tags-remote", setup: tagsRemote },
  { name: "unborn", setup: unborn },
  { name: "orphan", setup: orphan },
];

function runExample(file: string, args: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, env: process.env }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      const result = JSON.parse(stdout) as { ok?: unknown; err?: string };
      if (result.err !== undefined) {
        reject(new Error(result.err));
      } else {
        resolve(result.ok);
      }
    });
  });
}

const rustTree = (cwd: string, kind: string, args: unknown) => runExample(menuExample, [cwd, kind, JSON.stringify(args)]);

const plain = (value: unknown) => (value === undefined ? null : JSON.parse(JSON.stringify(value)));

function idsOf(items: MenuSpec[], out: string[] = []): string[] {
  for (const item of items) {
    if (item.id) {
      out.push(item.id);
    }
    if (item.submenu) {
      idsOf(item.submenu, out);
    }
  }
  return out;
}

function makeCtx(d: Dirs, data: RepoData, log: string[], marks: { hidden: string[]; solo: string[] }): Ctx {
  const ui: Ctx["ui"] = {
    busy: null,
    prompt: async (title) => {
      log.push(`prompt ${title}`);
      return null;
    },
    confirm: async (title, message) => {
      log.push(`confirm ${title} | ${message}`);
      return false;
    },
    choose: async (title, message) => {
      log.push(`choose ${title} | ${message}`);
      return null;
    },
    toast: (text, kind) => {
      log.push(`toast ${kind ?? "info"} ${text}`);
    },
    task: async (label, fn) => {
      log.push(`task ${label}`);
      try {
        await fn();
        return true;
      } catch (error) {
        log.push(`error ${error instanceof Error ? error.message : String(error)}`);
        return false;
      }
    },
  };
  return {
    cwd: d.repo,
    data,
    ui,
    refresh: () => {
      log.push("refresh");
    },
    openTab: (p) => {
      log.push(`openTab ${p}`);
    },
    openRebase: (b, e) => {
      log.push(`openRebase ${JSON.stringify([b, e])}`);
    },
    toggleHidden: (full) => {
      log.push(`toggleHidden ${full}`);
    },
    setHidden: (fulls, hide) => {
      log.push(`setHidden ${JSON.stringify([fulls, hide])}`);
    },
    setSolo: (fulls, on) => {
      log.push(`setSolo ${JSON.stringify([fulls, on])}`);
    },
    toggleSolo: (full) => {
      log.push(`toggleSolo ${full}`);
    },
    hidden: marks.hidden,
    solo: marks.solo,
    record: (entry) => {
      log.push(`record ${JSON.stringify(entry)}`);
    },
  };
}

function effectApi(platform: string, log: string[], chosen: string | null, native: boolean): Api {
  return {
    platform,
    git: runGit,
    action: async (_cwd: string, name: string, args: unknown) => {
      log.push(`action ${name} ${JSON.stringify(args)}`);
      if (name === "rebaseRange") {
        return [];
      }
      return name === "formatPatch" ? "patch" : { record: null };
    },
    pickDirectory: async () => {
      log.push("pickDirectory");
      return null;
    },
    saveFile: async (name: string, content: string) => {
      log.push(`saveFile ${name} ${content}`);
      return true;
    },
    copy: async (text: string) => {
      log.push(`copy ${text}`);
    },
    openExternal: async (url: string) => {
      log.push(`openExternal ${url}`);
    },
    openPath: async (target: string) => {
      log.push(`openPath ${target}`);
      return "";
    },
    showItem: async (target: string) => {
      log.push(`showItem ${target}`);
    },
    menu: async () => chosen,
    ...(native ? { contextMenu: async () => chosen } : {}),
  };
}

function calls(data: RepoData): Call[] {
  const list: Call[] = [];
  const add = (label: string, platformSensitive: boolean, run: (ctx: Ctx) => Promise<void>) => list.push({ label, platformSensitive, run });
  const refName = (r: Ref) => `${r.kind}:${r.name}`;
  add("wip", false, (ctx) => M.wipMenu(ctx));
  for (const c of data.commits) {
    add(`commit ${c.subject}${c.stash ? " (stash)" : ""}`, false, (ctx) => M.commitMenu(ctx, ctx.data.commits.find((x) => x.sha === c.sha) as Commit));
  }
  for (const r of data.refs) {
    for (const panel of [false, true]) {
      add(`ref ${refName(r)} panel=${panel}`, false, (ctx) => M.refMenu(ctx, ctx.data.refs.find((x) => x.full === r.full) as Ref, panel));
    }
  }
  for (const s of data.stashes) {
    add(`stash ${s.ref}`, false, (ctx) => M.stashMenu(ctx, s.ref, s.sha));
  }
  for (const r of data.remotes) {
    add(`remote ${r.name}`, false, (ctx) => M.remoteMenu(ctx, r.name, r.url));
  }
  add("remote no web url", false, (ctx) => M.remoteMenu(ctx, "local", "/some/where.git"));
  add("remote https", false, (ctx) => M.remoteMenu(ctx, "Up", "https://Example.COM/a/b.git"));
  for (const w of data.worktrees) {
    add(`worktree ${path.basename(w.path)}`, true, (ctx) => M.worktreeMenu(ctx, w));
  }
  add("worktree self", true, (ctx) => M.worktreeMenu(ctx, { path: `${ctx.cwd}/`, sha: "", main: true, locked: false, prunable: false }));
  for (const e of data.status) {
    const untracked = e.index === "?";
    add(`file ${e.path} unstaged`, true, (ctx) => M.fileMenu(ctx, e.path, { staged: false, untracked }));
    add(`file ${e.path} staged`, true, (ctx) => M.fileMenu(ctx, e.path, { staged: true, untracked: false }));
    add(`file ${e.path} plain`, true, (ctx) => M.fileMenu(ctx, e.path));
  }
  add("file commit", true, (ctx) => M.fileMenu(ctx, "dir/a.txt"));
  const droppable = data.refs.filter((r) => r.kind !== "tag");
  for (const s of droppable) {
    for (const t of droppable) {
      if (s !== t) {
        add(`drop ${refName(s)} onto ${refName(t)}`, false, (ctx) =>
          M.dropMenu(ctx, s.full, ctx.data.refs.find((x) => x.full === t.full) as Ref),
        );
      }
    }
  }
  if (droppable[0]) {
    add("drop missing source", false, (ctx) => M.dropMenu(ctx, "refs/heads/nope", ctx.data.refs.find((x) => x.full === droppable[0].full) as Ref));
  }
  const shas = data.commits.filter((c) => !c.stash).map((c) => c.sha);
  const picks: [string, string[]][] = [
    ["adjacent", shas.slice(0, 2)],
    ["gap", [shas[0], shas[shas.length - 1]]],
    ["all", shas],
    ["single", shas.slice(0, 1)],
  ];
  for (const [name, set] of picks) {
    if (set.length > 0 && set.every(Boolean)) {
      add(`multi ${name}`, false, (ctx) => M.multiMenu(ctx, ctx.data.commits.filter((x) => set.includes(x.sha))));
    }
  }
  return list;
}

async function execute(s: Scenario, tag: string): Promise<number> {
  const root = path.join(runRoot, tag, s.name);
  const d: Dirs = { root, repo: path.join(root, "repo"), remote: path.join(root, "remote.git"), other: path.join(root, "other"), wt: path.join(root, "wt") };
  fs.mkdirSync(root, { recursive: true });
  s.setup(d);
  setApi({ platform: "darwin", git: runGit });
  const data = await loadRepo(d.repo, [], [], 1000);
  const marks = s.marks ? s.marks(data) : { hidden: [], solo: [] };
  const platforms = s.platform ? [s.platform] : ["darwin", "win32"];
  let checked = 0;
  for (const call of calls(data)) {
    for (const platform of platforms) {
      if (platform !== "darwin" && !call.platformSensitive) {
        continue;
      }
      const where = `${s.name} / ${call.label} / ${platform}`;
      let shown: MenuSpec[] | null = null;
      setApi({
        platform,
        git: runGit,
        menu: async (items: MenuSpec[]) => {
          shown = items;
          return null;
        },
      });
      M = tsMenus;
      await call.run(makeCtx(d, data, [], marks));
      const expected = plain(shown);

      let actual: unknown = null;
      setApi({
        platform,
        git: runGit,
        menu: async () => {
          throw new Error("native path must not use menu");
        },
        contextMenu: async (cwd: string, kind: string, args: unknown) => {
          actual = plain(await rustTree(cwd, kind, args));
          return null;
        },
      });
      M = rsMenus;
      await call.run(makeCtx(d, data, [], marks));
      assert.deepStrictEqual(actual, expected, where);
      checked += 1;

      const ids = idsOf((actual ?? []) as MenuSpec[]);
      assert.equal(new Set(ids).size, ids.length, `${where}: ids are not unique`);
      for (const id of ids) {
        const tsLog: string[] = [];
        setApi(effectApi(platform, tsLog, id, false));
        M = tsMenus;
        await call.run(makeCtx(d, data, tsLog, marks));
        const rsLog: string[] = [];
        setApi(effectApi(platform, rsLog, id, true));
        M = rsMenus;
        await call.run(makeCtx(d, data, rsLog, marks));
        assert.ok(rsLog.length > 0, `${where}: id ${id} ran nothing`);
        assert.deepStrictEqual(rsLog, tsLog, `${where}: id ${id}`);
        checked += 1;
      }
    }
  }
  return checked;
}

before(
  async () => {
    if (!enabled) {
      return;
    }
    runRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gitneat-menus-")));
    const config = path.join(runRoot, "gitconfig");
    fs.writeFileSync(config, "[user]\n\tname = t\n\temail = t@x\n[commit]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n[advice]\n\tdetachedHead = false\n");
    Object.assign(process.env, {
      GIT_CONFIG_GLOBAL: config,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z",
      GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z",
    });
    execFileSync("cargo", ["build", "-q", "-p", "gitneat", "--example", "menu"], { cwd: rustDir, stdio: "inherit" });
    const dir = path.join(rustDir, "target", "debug", "examples");
    menuExample = path.join(dir, process.platform === "win32" ? "menu.exe" : "menu");
    setApi({ platform: "darwin", git: runGit });
    tsMenus = await import("./reference/menus");
    rsMenus = await import("../src/menus");
    ({ loadRepo } = await import("./reference/repo"));
  },
  { timeout: 600000 },
);

after(() => {
  if (runRoot) {
    fs.rmSync(runRoot, { recursive: true, force: true });
  }
});

for (const s of scenarios) {
  test(`menus: rust equals ts on ${s.name}`, { skip: !enabled, timeout: 900000 }, async () => {
    const checked = await execute(s, "run");
    assert.ok(checked > 0, `${s.name} compared nothing`);
  });
}
