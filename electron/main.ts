import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, MenuItemConstructorOptions, shell } from "electron";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface MenuSpec {
  label?: string;
  id?: string;
  type?: "separator";
  enabled?: boolean;
  submenu?: MenuSpec[];
}

interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

const storePath = (): string => path.join(app.getPath("userData"), "gitneat-state.json");
const watchers = new Map<string, fs.FSWatcher>();
let win: BrowserWindow | null = null;

function createWindow(): void {
  const isMac = process.platform === "darwin";
  const [width, height] = (process.env.GITNEAT_WINDOW_SIZE ?? "1500x940").split("x").map(Number);
  win = new BrowserWindow({
    width,
    height,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#1c1e23",
    show: !process.env.GITNEAT_SCREENSHOT,
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    titleBarOverlay: isMac ? false : { color: "#14161b", symbolColor: "#c9ccd3", height: 36 },
    trafficLightPosition: { x: 12, y: 11 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: !process.env.GITNEAT_SCREENSHOT,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  const shot = process.env.GITNEAT_SCREENSHOT;
  if (shot) {
    win.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        if (process.env.GITNEAT_SCREENSHOT_JS) {
          try {
            await win?.webContents.executeJavaScript(process.env.GITNEAT_SCREENSHOT_JS);
          } catch (error) {
            console.error("GITNEAT_SCREENSHOT_JS failed:", error);
          }
          await new Promise((r) => setTimeout(r, 1200));
        }
        const image = await win?.webContents.capturePage(undefined, { stayHidden: true });
        if (image) {
          await fs.promises.writeFile(shot, image.toPNG());
        }
        app.quit();
      }, Number(process.env.GITNEAT_SCREENSHOT_DELAY ?? 2500));
    });
  }
  if (process.env.VITE_DEV) {
    void win.loadURL("http://localhost:5173");
  } else {
    void win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

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

function toMenu(items: MenuSpec[], pick: (id: string) => void): MenuItemConstructorOptions[] {
  return items.map((item) => {
    if (item.type === "separator") {
      return { type: "separator" };
    }
    return {
      label: item.label,
      enabled: item.enabled !== false,
      submenu: item.submenu ? toMenu(item.submenu, pick) : undefined,
      click: item.id ? () => pick(item.id as string) : undefined,
    };
  });
}

function openTerminal(cwd: string): void {
  if (process.platform === "darwin") {
    spawn("open", ["-a", "Terminal", cwd], { detached: true });
  } else if (process.platform === "win32") {
    spawn("cmd.exe", ["/c", "start", "cmd.exe"], { cwd, detached: true, shell: false });
  } else {
    spawn("x-terminal-emulator", [], { cwd, detached: true });
  }
}

const BLOCKED_ARGS = /^(--upload-pack|--receive-pack|--exec|--exec-path|--config-env)(=|$)/;

ipcMain.handle("git", (_e, cwd: string, args: string[], env?: Record<string, string>, input?: string) => {
  if (args.some((a) => BLOCKED_ARGS.test(a)) || args[0] === "-c") {
    return { code: 1, stdout: "", stderr: "GitNeat blocked a git option that can run commands." };
  }
  return runGit(cwd, args, env, input);
});

const insideOpenRepo = (target: string) =>
  [...watchers.keys()].some((root) => {
    const rel = path.relative(root, target);
    return !rel.startsWith("..") && !path.isAbsolute(rel);
  });

ipcMain.handle("open-repo-dialog", async () => {
  const result = await dialog.showOpenDialog(win as BrowserWindow, { properties: ["openDirectory"] });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  const top = await runGit(result.filePaths[0], ["rev-parse", "--show-toplevel"]);
  return top.code === 0 ? path.normalize(top.stdout.trim()) : { error: `Not a git repository: ${result.filePaths[0]}` };
});

ipcMain.handle("pick-directory", async () => {
  const result = await dialog.showOpenDialog(win as BrowserWindow, { properties: ["openDirectory", "createDirectory"] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("save-file", async (_e, defaultName: string, content: string) => {
  const result = await dialog.showSaveDialog(win as BrowserWindow, { defaultPath: defaultName });
  if (result.canceled || !result.filePath) {
    return false;
  }
  await fs.promises.writeFile(result.filePath, content);
  return true;
});

ipcMain.handle("write-temp", async (_e, content: string) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "gitneat-"));
  const file = path.join(dir, "data");
  await fs.promises.writeFile(file, content);
  return file.split(path.sep).join("/");
});

ipcMain.handle("menu", (e, items: MenuSpec[]) => {
  return new Promise<string | null>((resolve) => {
    let chosen: string | null = null;
    const menu = Menu.buildFromTemplate(toMenu(items, (id) => (chosen = id)));
    const owner = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    menu.popup({ window: owner, callback: () => setTimeout(() => resolve(chosen), 0) });
  });
});

ipcMain.handle("clipboard", (_e, text: string) => clipboard.writeText(text));

ipcMain.handle("open-external", (_e, url: string) => {
  if (/^https?:\/\//.test(url)) {
    return shell.openExternal(url);
  }
});

ipcMain.handle("read-file", async (_e, cwd: string, rel: string) => {
  const target = path.resolve(cwd, rel);
  if (!insideOpenRepo(target)) {
    return null;
  }
  try {
    return await fs.promises.readFile(target, "utf8");
  } catch {
    return null;
  }
});

ipcMain.handle("write-file", async (_e, cwd: string, rel: string, content: string) => {
  const target = path.resolve(cwd, rel);
  if (!insideOpenRepo(target)) {
    return false;
  }
  await fs.promises.writeFile(target, content);
  return true;
});

ipcMain.handle("open-path", (_e, target: string) => (insideOpenRepo(target) ? shell.openPath(target) : "GitNeat opens only files inside an open repository."));
ipcMain.handle("show-item", (_e, target: string) => (insideOpenRepo(target) ? shell.showItemInFolder(target) : undefined));
ipcMain.handle("open-terminal", (_e, cwd: string) => openTerminal(cwd));

ipcMain.handle("store-get", async () => {
  try {
    return JSON.parse(await fs.promises.readFile(storePath(), "utf8"));
  } catch {
    return {};
  }
});

ipcMain.handle("store-set", (_e, data: unknown) => fs.promises.writeFile(storePath(), JSON.stringify(data, null, 2)));

ipcMain.handle("watch", (e, cwd: string) => {
  if (watchers.has(cwd)) {
    return;
  }
  let timer: NodeJS.Timeout | undefined;
  try {
    const watcher = fs.watch(cwd, { recursive: true }, (_event, file) => {
      const name = String(file ?? "").split(path.sep).join("/");
      if (name.includes("node_modules/") || name.startsWith(".git/objects/") || name.endsWith(".lock")) {
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!e.sender.isDestroyed()) {
          e.sender.send("repo-changed", cwd);
        }
      }, 400);
    });
    watcher.on("error", () => {
      watcher.close();
      watchers.delete(cwd);
    });
    watchers.set(cwd, watcher);
  } catch {
    return;
  }
});

ipcMain.handle("unwatch", (_e, cwd: string) => {
  watchers.get(cwd)?.close();
  watchers.delete(cwd);
});

if (process.env.GITNEAT_USER_DATA) {
  app.setPath("userData", process.env.GITNEAT_USER_DATA);
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
