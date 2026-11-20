import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const source = JSON.parse(readFileSync("package.json", "utf8"));

rmSync("bundle", { recursive: true, force: true });
mkdirSync("bundle/native", { recursive: true });
cpSync("dist", "bundle/dist", { recursive: true });
cpSync("dist-electron", "bundle/dist-electron", { recursive: true });
cpSync("native/gitneat.node", "bundle/native/gitneat.node");
writeFileSync(
  "bundle/package.json",
  JSON.stringify(
    {
      name: source.name,
      productName: source.productName,
      version: source.version,
      main: "dist-electron/main.js",
      scripts: { start: "electron ." },
      dependencies: { electron: source.devDependencies.electron },
    },
    null,
    2,
  ),
);
