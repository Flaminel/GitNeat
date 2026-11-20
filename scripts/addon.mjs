import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";

const names = { win32: "addon.dll", darwin: "libaddon.dylib", linux: "libaddon.so" };

execFileSync("cargo", ["build", "--release", "-p", "addon"], { cwd: "rust", stdio: "inherit" });
mkdirSync("native", { recursive: true });
copyFileSync(`rust/target/release/${names[process.platform]}`, "native/gitneat.node");
