import { contextBridge, ipcRenderer } from "electron";

function plain(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^Error invoking remote method '[^']*': (Error: )?/, "");
}

contextBridge.exposeInMainWorld("gitneatBridge", {
  invoke: (name: string, args: Record<string, unknown>) =>
    ipcRenderer.invoke("gitneat:invoke", name, args).catch((error: unknown) => {
      throw plain(error);
    }),
  listen: (event: string, fn: (payload: unknown) => void) => {
    const listener = (_e: unknown, name: string, payload: unknown) => {
      if (name === event) {
        fn(payload);
      }
    };
    ipcRenderer.on("gitneat:event", listener);
    return () => ipcRenderer.removeListener("gitneat:event", listener);
  },
  setZoom: (factor: number) => ipcRenderer.invoke("gitneat:zoom", factor),
  toggleFullscreen: () => ipcRenderer.invoke("gitneat:fullscreen"),
  windowAction: (action: string) => ipcRenderer.invoke("gitneat:window", action),
});
