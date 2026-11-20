import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";

const update = process.env.UPDATE_GOLDEN === "1";
const temps = [...new Set([fs.realpathSync(os.tmpdir()), os.tmpdir()])].filter((t) => t.length > 1);

function scrub(value: unknown): unknown {
  let text = JSON.stringify(value === undefined ? null : value);
  for (const dir of temps) {
    text = text.split(dir.replace(/\/$/, "")).join("<tmp>");
  }
  return JSON.parse(text);
}

export const enabled = process.env.GITNEAT_RUST_COMPARE === "1" && process.platform !== "win32";

export function golden(name: string): (key: string, actual: unknown) => void {
  const file = path.resolve(process.cwd(), "test", "golden", `${name}.json`);
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    data = {};
  }
  after(() => {
    if (!update) {
      return;
    }
    const sorted = Object.fromEntries(Object.entries(data).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(sorted, null, 1)}\n`);
  });
  const seen = new Map<string, number>();
  return (base, actual) => {
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const key = count === 0 ? base : `${base}#${count}`;
    const value = scrub(actual);
    if (update) {
      data[key] = value;
      return;
    }
    assert.ok(key in data, `no golden value for ${key}. Run with UPDATE_GOLDEN=1`);
    assert.deepStrictEqual(value, data[key], key);
  };
}
