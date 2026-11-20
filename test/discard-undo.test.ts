import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const enabled = process.env.GITNEAT_RUST_COMPARE === "1";
const rustDir = path.resolve(process.cwd(), "rust");

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function action(example: string, cwd: string, name: string, args: unknown): Promise<{ record?: { discard?: unknown } | null } & Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    execFile(example, [cwd, name, JSON.stringify(args)], { encoding: "utf8" }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      const result = JSON.parse(stdout) as { ok?: never; err?: string };
      if (result.err !== undefined) {
        reject(new Error(result.err));
      } else {
        resolve(result.ok as never);
      }
    });
  });
}

test("discard undo: undo restores, redo discards again", { skip: !enabled, timeout: 300000 }, async () => {
  execFileSync("cargo", ["build", "-q", "-p", "gitneat-core", "--example", "action"], { cwd: rustDir, stdio: "inherit" });
  const example = path.join(rustDir, "target", "debug", "examples", process.platform === "win32" ? "action.exe" : "action");
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gitneat-discard-")));
  try {
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.email", "t@x");
    git(dir, "config", "user.name", "t");
    git(dir, "config", "core.autocrlf", "false");
    fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
    fs.writeFileSync(path.join(dir, "b.txt"), "b\n");
    git(dir, "add", ".");
    git(dir, "commit", "-qm", "init");
    fs.writeFileSync(path.join(dir, "a.txt"), "a2\n");
    fs.writeFileSync(path.join(dir, "new.txt"), "new\n");
    fs.writeFileSync(path.join(dir, "b.txt"), "b2\n");
    git(dir, "add", "new.txt");
    const files = [
      { path: "a.txt", untracked: false, conflicted: false },
      { path: "new.txt", untracked: false, conflicted: false, staged: true, added: true },
    ];
    const done = await action(example, dir, "discardFiles", { files });
    const entry = { label: "Discard", before: { head: null, branch: "main" }, after: { head: null, branch: "main" }, discard: (done.record as { discard: unknown }).discard };
    assert.ok(entry.discard);
    assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "a\n");
    assert.equal(fs.existsSync(path.join(dir, "new.txt")), false);
    assert.equal(fs.readFileSync(path.join(dir, "b.txt"), "utf8"), "b2\n");

    fs.writeFileSync(path.join(dir, "a.txt"), "typed after\n");
    await action(example, dir, "undo", { entry });
    assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "a2\n");
    assert.equal(fs.readFileSync(path.join(dir, "new.txt"), "utf8"), "new\n");
    assert.match(git(dir, "stash", "list"), /Auto stash before Undo Discard changes/);

    await action(example, dir, "redo", { entry });
    assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "a\n");
    assert.equal(fs.existsSync(path.join(dir, "new.txt")), false);
    assert.equal(git(dir, "status", "--porcelain"), " M b.txt\n");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
