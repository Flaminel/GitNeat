import { execFile, execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

const rustDir = path.resolve(process.cwd(), "rust");
const built = new Map<string, string>();

export const hasCargo = spawnSync("cargo", ["--version"]).status === 0;

export function example(name: string): string {
  const known = built.get(name);
  if (known) {
    return known;
  }
  execFileSync("cargo", ["build", "-q", "-p", "gitneat-core", "--example", name], { cwd: rustDir, stdio: "inherit" });
  const file = path.join(rustDir, "target", "debug", "examples", process.platform === "win32" ? `${name}.exe` : name);
  built.set(name, file);
  return file;
}

export function loadRepo(cwd: string, hidden: string[], solo: string[], limit: number): Promise<any> {
  return new Promise((resolve, reject) => {
    execFile(
      example("load_repo"),
      [cwd, JSON.stringify(hidden), JSON.stringify(solo), String(limit)],
      { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(JSON.parse(stdout))),
    );
  });
}

export function parse(kind: "diff" | "merge", text: string): any {
  return JSON.parse(execFileSync(example("parse"), [kind], { input: text, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }));
}
