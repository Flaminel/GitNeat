import { BrowserWindow, Menu, MenuItemConstructorOptions } from "electron";

export interface MenuSpec {
  label?: string;
  id?: string;
  type?: "separator";
  enabled?: boolean;
  submenu?: MenuSpec[];
  checked?: boolean;
}

export function popup(win: BrowserWindow, items: MenuSpec[]): Promise<string | null> {
  return new Promise((resolve) => {
    let picked: string | null = null;
    const convert = (list: MenuSpec[]): MenuItemConstructorOptions[] =>
      list.map((item) => {
        if (item.type === "separator") {
          return { type: "separator" };
        }
        if (item.submenu) {
          return { label: item.label, enabled: item.enabled !== false, submenu: convert(item.submenu) };
        }
        return {
          label: item.label,
          enabled: item.enabled !== false,
          type: item.checked === undefined ? "normal" : "checkbox",
          checked: item.checked,
          click: () => {
            picked = item.id ?? null;
          },
        };
      });
    Menu.buildFromTemplate(convert(items)).popup({ window: win, callback: () => resolve(picked) });
  });
}
