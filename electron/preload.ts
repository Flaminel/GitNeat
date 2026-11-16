import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("krill", {
  platform: process.platform,
  git: (cwd: string, args: string[], env?: Record<string, string>, input?: string) =>
    ipcRenderer.invoke("git", cwd, args, env, input),
  openRepoDialog: () => ipcRenderer.invoke("open-repo-dialog"),
  pickDirectory: () => ipcRenderer.invoke("pick-directory"),
  saveFile: (name: string, content: string) => ipcRenderer.invoke("save-file", name, content),
  writeTemp: (content: string) => ipcRenderer.invoke("write-temp", content),
  readFile: (cwd: string, rel: string) => ipcRenderer.invoke("read-file", cwd, rel),
  writeFile: (cwd: string, rel: string, content: string) => ipcRenderer.invoke("write-file", cwd, rel, content),
  menu: (items: unknown) => ipcRenderer.invoke("menu", items),
  copy: (text: string) => ipcRenderer.invoke("clipboard", text),
  openExternal: (url: string) => ipcRenderer.invoke("open-external", url),
  openPath: (target: string) => ipcRenderer.invoke("open-path", target),
  showItem: (target: string) => ipcRenderer.invoke("show-item", target),
  openTerminal: (cwd: string) => ipcRenderer.invoke("open-terminal", cwd),
  storeGet: () => ipcRenderer.invoke("store-get"),
  storeSet: (data: unknown) => ipcRenderer.invoke("store-set", data),
  watch: (cwd: string) => ipcRenderer.invoke("watch", cwd),
  unwatch: (cwd: string) => ipcRenderer.invoke("unwatch", cwd),
  onRepoChanged: (fn: (cwd: string) => void) => {
    const listener = (_e: unknown, cwd: string) => fn(cwd);
    ipcRenderer.on("repo-changed", listener);
    return () => ipcRenderer.removeListener("repo-changed", listener);
  },
});
