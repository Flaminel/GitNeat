import { gitneat } from "../api";
import { accelLabel, AppMenu, AppMenuEntry } from "../keymap";
import { MenuItem, showMenu } from "../ui";

interface Props {
  menus: AppMenu[];
  checks: Record<string, boolean>;
  run(id: string): void;
}

const EDIT: Record<string, () => unknown> = {
  cut: () => document.execCommand("cut"),
  copy: () => document.execCommand("copy"),
  selectAll: () => document.execCommand("selectAll"),
  paste: async () => document.execCommand("insertText", false, await navigator.clipboard.readText()),
};

const LABELS: Record<string, string> = { cut: "Cut", copy: "Copy", paste: "Paste", selectAll: "Select All" };

export function MenuBar({ menus, checks, run }: Props) {
  const mac = gitneat().platform === "darwin";
  const toItems = (entries: AppMenuEntry[]): MenuItem[] =>
    entries.map((entry): MenuItem => {
      if (entry.type === "sep") {
        return "-";
      }
      if (entry.type === "sub") {
        return { label: entry.label as string, submenu: toItems(entry.items ?? []) };
      }
      if (entry.type === "native") {
        const action = EDIT[entry.kind as string];
        return action ? { label: LABELS[entry.kind as string], run: action } : null;
      }
      const id = entry.id as string;
      return {
        label: entry.label as string,
        id,
        accelerator: entry.accel ? accelLabel(entry.accel, mac) : undefined,
        checked: entry.type === "check" ? !!checks[id] : undefined,
        enabled: entry.type === "check" ? id in checks : undefined,
        run: () => run(id),
      };
    });
  return (
    <div className="menubar">
      {menus.map((menu) => (
        <button key={menu.label} onClick={() => void showMenu(toItems(menu.items))}>
          {menu.label}
        </button>
      ))}
    </div>
  );
}
