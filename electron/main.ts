import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { MenuSpec, popup } from "./menu";

interface Addon {
  init(sink: (event: string, payload: string) => void): void;
  invoke(name: string, args: string): Promise<string>;
}

type Args = Record<string, unknown>;

let win: BrowserWindow | null = null;

function loadAddon(): Addon {
  const file = process.env.GITNEAT_ADDON ?? path.join(__dirname, "..", "native", "gitneat.node");
  return require(file) as Addon;
}

const addon = loadAddon();

async function call<T>(name: string, args: Args = {}): Promise<T> {
  return JSON.parse(await addon.invoke(name, JSON.stringify(args))) as T;
}

function askpassShim(): string {
  const script = path.join(__dirname, "askpass.js");
  const windows = process.platform === "win32";
  const file = path.join(app.getPath("userData"), windows ? "askpass.cmd" : "askpass.sh");
  const text = windows
    ? `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" "${script}" %*\r\n`
    : `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "${script}" "$@"\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, { mode: 0o755 });
  return file;
}

function createWindow(): void {
  const isMac = process.platform === "darwin";
  const [width, height] = (process.env.GITNEAT_WINDOW_SIZE ?? "1500x940").split("x").map(Number);
  win = new BrowserWindow({
    width: width || 1500,
    height: height || 940,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#1c1e23",
    frame: isMac,
    titleBarStyle: isMac ? "hiddenInset" : undefined,
    trafficLightPosition: { x: 12, y: 11 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  if (process.env.VITE_DEV) {
    void win.loadURL("http://localhost:5173");
  } else {
    void win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

function parent(): BrowserWindow {
  return win as BrowserWindow;
}

async function pickPaths(options: Electron.OpenDialogOptions): Promise<string[]> {
  const result = await dialog.showOpenDialog(parent(), options);
  return result.canceled ? [] : result.filePaths;
}

const ui: Record<string, (args: Args) => Promise<unknown>> = {
  open_repo_dialog: async () => {
    const [dir] = await pickPaths({ properties: ["openDirectory"] });
    return dir ? call("resolve_repo", { dir }) : null;
  },
  pick_directory: async () => {
    const [dir] = await pickPaths({ properties: ["openDirectory", "createDirectory"] });
    return dir ?? null;
  },
  pick_directories: () => pickPaths({ properties: ["openDirectory", "multiSelections"] }),
  import_code_workspace: async () => {
    const [file] = await pickPaths({
      properties: ["openFile"],
      filters: [{ name: "Workspaces", extensions: ["code-workspace"] }],
    });
    return file ? call("import_code_workspace", { file }) : [];
  },
  pick_icon: async () => {
    const [source] = await pickPaths({
      title: "Select Workspace Icon",
      properties: ["openFile"],
      filters: [{ name: "Image File", extensions: ["png", "jpg", "jpeg"] }],
    });
    return source ? call("copy_icon", { source }) : null;
  },
  save_file: async (args) => {
    const result = await dialog.showSaveDialog(parent(), { defaultPath: String(args.defaultName) });
    if (result.canceled || !result.filePath) {
      return false;
    }
    await fs.promises.writeFile(result.filePath, String(args.content));
    return true;
  },
  open_patch: async () => {
    const [file] = await pickPaths({
      properties: ["openFile"],
      filters: [{ name: "Patch", extensions: ["patch", "diff"] }],
    });
    return file ? fs.promises.readFile(file, "utf8") : null;
  },
  menu: (args) => popup(parent(), args.items as MenuSpec[]),
  context_menu: async (args) => {
    const items = await call<MenuSpec[] | null>("context_menu_items", args);
    return items ? popup(parent(), items) : null;
  },
  clipboard: async (args) => {
    clipboard.writeText(String(args.text));
  },
  open_external: async (args) => {
    const url = String(args.url);
    if (/^https?:\/\//.test(url)) {
      await shell.openExternal(url);
    }
  },
  open_path: async (args) => {
    const target = String(args.target);
    if (!(await call<boolean>("inside_roots", { target }))) {
      return "GitNeat opens only files inside an open repository.";
    }
    return shell.openPath(target);
  },
  show_item: async (args) => {
    const target = String(args.target);
    if (await call<boolean>("inside_roots", { target })) {
      shell.showItemInFolder(target);
    }
  },
  set_panel_checks: async () => undefined,
};

ipcMain.handle("gitneat:invoke", (_event, name: string, args: Args) => {
  const handler = ui[name];
  return handler ? handler(args) : call(name, args);
});

ipcMain.handle("gitneat:zoom", (_event, factor: number) => {
  parent().webContents.setZoomFactor(factor);
});

ipcMain.handle("gitneat:fullscreen", () => {
  parent().setFullScreen(!parent().isFullScreen());
});

ipcMain.handle("gitneat:window", (_event, action: string) => {
  if (action === "minimize") {
    parent().minimize();
  } else if (action === "maximize") {
    parent().isMaximized() ? parent().unmaximize() : parent().maximize();
  } else {
    parent().close();
  }
});

void app.whenReady().then(async () => {
  addon.init((event, payload) => {
    win?.webContents.send("gitneat:event", event, JSON.parse(payload));
  });
  await call("init", { askpass: askpassShim() });
  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});
