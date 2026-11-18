export interface KeymapGroup {
  name: string;
  keymaps: { label: string; keys: string[] }[];
}

export interface AppMenuEntry {
  type: "item" | "check" | "sep" | "sub" | "native";
  id?: string;
  label?: string;
  accel?: string | null;
  items?: AppMenuEntry[];
  kind?: string;
}

export interface AppMenu {
  label: string;
  items: AppMenuEntry[];
}

export const keymapGroups = (mac: boolean): KeymapGroup[] => {
  const mod = mac ? "⌘" : "Ctrl";
  const alt = mac ? "⌥" : "Alt";
  const first = mac ? "↑" : "Home";
  const last = mac ? "↓" : "End";
  return [
    {
      name: "Repo Actions",
      keymaps: [
        { label: "Create Branch", keys: [`${mod} B`] },
        { label: "Fetch All", keys: [`${mod} L`] },
        { label: "Commit (when in message input)", keys: [`${mod} Enter`] },
        { label: "Stage All Files", keys: [`${mod} Shift S`] },
        { label: "Unstage All Files", keys: [`${mod} Shift U`] },
        { label: "Focus commit message", keys: [`${mod} Shift M`] },
        { label: "Open in default terminal", keys: [`${alt} T`] },
      ],
    },
    {
      name: "Navigation",
      keymaps: [
        { label: "Select Previous Item", keys: ["↑"] },
        { label: "Select Next Item", keys: ["↓"] },
        { label: "Select First Item", keys: [`${mod} ${first}`] },
        { label: "Select Last Item", keys: [`${mod} ${last}`] },
        { label: "Undo", keys: [`${mod} Z`] },
        { label: "Redo", keys: [`${mod} Y`, `${mod} Shift Z`] },
      ],
    },
    {
      name: "Command Palette",
      keymaps: [
        { label: "Toggle Command Palette", keys: [`${mod} P`] },
        { label: "Search commits", keys: [`${mod} F`] },
        { label: "Open Repo", keys: [`${mod} Shift O`] },
        { label: "Open Selected File in External Diff/Merge Tool", keys: [`${mod} D`] },
      ],
    },
    {
      name: "UI",
      keymaps: [
        { label: "Open a new tab", keys: [`${mod} T`] },
        { label: "Close File/Tab", keys: [`${mod} W`] },
        { label: "Jump to the next open tab", keys: ["Ctrl Tab"] },
        { label: "Jump to the previous open tab", keys: ["Ctrl Shift Tab"] },
        { label: "Jump to a specific tab", keys: [`${mod} 1 through 9`] },
        { label: "Toggle Left Panel", keys: [`${mod} J`] },
        { label: "Toggle Commit Details Panel", keys: [`${mod} K`] },
        { label: "Increase Zoom", keys: [`${mod} +`] },
        { label: "Decrease Zoom", keys: [`${mod} -`] },
        { label: "Reset Zoom", keys: [`${mod} 0`] },
        { label: "Toggle Full Screen", keys: mac ? ["Ctrl ⌘ F"] : ["Ctrl Shift F", "F11"] },
        { label: "Open tabs list", keys: [`${mod} Shift A`] },
        { label: "Keyboard Shortcuts", keys: [`${mod} /`] },
      ],
    },
  ];
};

export const filterKeymapGroups = (groups: KeymapGroup[], query: string): KeymapGroup[] => {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return groups;
  }
  return groups
    .map((g) => ({ ...g, keymaps: g.keymaps.filter((k) => k.label.toLowerCase().includes(needle) || k.keys.some((key) => key.toLowerCase().includes(needle))) }))
    .filter((g) => g.keymaps.length);
};

const CODES: Record<string, string> = { Tab: "Tab", "=": "Equal", "-": "Minus", ",": "Comma", "/": "Slash", F11: "F11" };

const codeOf = (key: string) => CODES[key] ?? (/^\d$/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`);

export function matchAccel(accel: string, e: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">): boolean {
  const parts = accel.split("+");
  const key = parts.pop() as string;
  const mods = new Set(parts);
  if (e.code !== codeOf(key)) {
    return false;
  }
  const modOk = mods.has("CmdOrCtrl") ? e.metaKey !== e.ctrlKey : mods.has("Cmd") === e.metaKey && mods.has("Ctrl") === e.ctrlKey;
  if (!modOk || mods.has("Alt") !== e.altKey) {
    return false;
  }
  return key === "=" || mods.has("Shift") === e.shiftKey;
}

export const menuAccels = (menus: AppMenu[]): { id: string; accel: string }[] => {
  const out: { id: string; accel: string }[] = [];
  const walk = (entries: AppMenuEntry[]) => {
    for (const entry of entries) {
      if (entry.items) {
        walk(entry.items);
      } else if (entry.id && entry.accel) {
        out.push({ id: entry.id, accel: entry.accel });
      }
    }
  };
  menus.forEach((m) => walk(m.items));
  return out;
};

export const accelLabel = (accel: string, mac: boolean) => accel.replace("CmdOrCtrl", mac ? "Cmd" : "Ctrl");
