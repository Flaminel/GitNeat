use serde::Serialize;

pub const PREFIX: &str = "app:";

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Entry {
    Item {
        id: String,
        label: String,
        accel: Option<String>,
    },
    Check {
        id: String,
        label: String,
        accel: Option<String>,
    },
    Sep,
    Sub {
        label: String,
        items: Vec<Entry>,
    },
    Native {
        kind: String,
        label: Option<String>,
    },
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Menu {
    pub label: String,
    pub items: Vec<Entry>,
}

fn item(id: &str, label: &str, accel: Option<&str>) -> Entry {
    Entry::Item {
        id: id.into(),
        label: label.into(),
        accel: accel.map(str::to_string),
    }
}

fn check(id: &str, label: &str, accel: &str) -> Entry {
    Entry::Check {
        id: id.into(),
        label: label.into(),
        accel: Some(accel.into()),
    }
}

fn native(kind: &str, label: Option<String>) -> Entry {
    Entry::Native {
        kind: kind.into(),
        label,
    }
}

fn sub(label: &str, items: Vec<Entry>) -> Entry {
    Entry::Sub {
        label: label.into(),
        items,
    }
}

fn numbered(id: &str, label: &str, modifier: Option<&str>) -> Vec<Entry> {
    (1..=9)
        .map(|n| {
            item(
                &format!("{id}:{n}"),
                &format!("{label} {n}"),
                modifier.map(|m| format!("{m}+{n}")).as_deref(),
            )
        })
        .collect()
}

fn tabs() -> Entry {
    let mut items = vec![
        item("next-tab", "Select Next Tab", Some("Ctrl+Tab")),
        item(
            "previous-tab",
            "Select Previous Tab",
            Some("Ctrl+Shift+Tab"),
        ),
        item("tabs-list", "Open Tabs List", Some("CmdOrCtrl+Shift+A")),
        Entry::Sep,
    ];
    items.extend(numbered("tab", "Select Tab", Some("CmdOrCtrl")));
    sub("Tabs", items)
}

fn favorites(mac: bool) -> Entry {
    sub(
        "Favorites",
        numbered("favorite", "Open Favorite Repo", mac.then_some("Ctrl+Cmd")),
    )
}

fn file(mac: bool) -> Menu {
    let mut items = vec![
        item("new-tab", "New Tab", Some("CmdOrCtrl+T")),
        item("close-tab", "Close Tab", Some("CmdOrCtrl+W")),
        item("reopen-tab", "Reopen Closed Tab", Some("CmdOrCtrl+Shift+T")),
        Entry::Sep,
        item("clone", "Clone Repo...", Some("CmdOrCtrl+N")),
        item("init", "Init Repo...", Some("CmdOrCtrl+I")),
        item("open", "Open Repo...", Some("CmdOrCtrl+O")),
        item(
            "repo-management",
            "Open Repo Management",
            Some("CmdOrCtrl+Alt+O"),
        ),
        item(
            "external-editor",
            "Open Repo in External Editor",
            Some("CmdOrCtrl+Shift+E"),
        ),
        Entry::Sep,
        item("terminal", "Open External Terminal", Some("Alt+T")),
        item("file-manager", "Open in File Manager", Some("Alt+O")),
    ];
    if !mac {
        items.extend([
            Entry::Sep,
            item("preferences", "Preferences...", Some("Ctrl+,")),
            item("repo-preferences", "Repository Preferences...", None),
            Entry::Sep,
            item("exit", "Exit", None),
        ]);
    }
    Menu {
        label: "File".into(),
        items,
    }
}

fn edit() -> Menu {
    Menu {
        label: "Edit".into(),
        items: vec![
            item("undo", "Undo", None),
            item("redo", "Redo", None),
            Entry::Sep,
            native("cut", None),
            native("copy", None),
            native("paste", None),
            native("selectAll", None),
        ],
    }
}

fn view(mac: bool) -> Menu {
    let mut items = vec![if mac {
        native("fullscreen", Some("Toggle Full Screen".into()))
    } else {
        item("fullscreen", "Toggle Full Screen", Some("F11"))
    }];
    items.extend([
        Entry::Sep,
        check("left-panel", "Show Left Panel", "CmdOrCtrl+J"),
        check("details-panel", "Show Commit Details Panel", "CmdOrCtrl+K"),
        Entry::Sep,
        item("zoom-in", "Increase Zoom", Some("CmdOrCtrl+=")),
        item("zoom-out", "Decrease Zoom", Some("CmdOrCtrl+-")),
        item("zoom-reset", "Reset Zoom", Some("CmdOrCtrl+0")),
    ]);
    if !mac {
        items.extend([Entry::Sep, tabs(), favorites(false)]);
    }
    Menu {
        label: "View".into(),
        items,
    }
}

fn help() -> Menu {
    Menu {
        label: "Help".into(),
        items: vec![
            item("palette", "Open Command Palette", Some("CmdOrCtrl+P")),
            item("shortcuts", "Keyboard Shortcuts", Some("CmdOrCtrl+/")),
            item("support-docs", "View Support Documentation", None),
        ],
    }
}

pub fn menus(mac: bool, name: &str) -> Vec<Menu> {
    let mut out = Vec::new();
    if mac {
        out.push(Menu {
            label: name.into(),
            items: vec![
                native("about", Some(format!("About {name}"))),
                Entry::Sep,
                item("preferences", "Preferences...", Some("CmdOrCtrl+,")),
                item("repo-preferences", "Repository Preferences...", None),
                Entry::Sep,
                native("services", None),
                Entry::Sep,
                native("hide", Some(format!("Hide {name}"))),
                native("hideOthers", None),
                native("showAll", None),
                Entry::Sep,
                native("quit", Some(format!("Quit {name}"))),
            ],
        });
    }
    out.extend([file(mac), edit(), view(mac)]);
    if mac {
        out.push(Menu {
            label: "Window".into(),
            items: vec![
                native("minimize", None),
                native("maximize", Some("Zoom".into())),
                Entry::Sep,
                tabs(),
                favorites(true),
            ],
        });
    }
    out.push(help());
    out
}

pub fn product_name<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> String {
    app.config()
        .product_name
        .clone()
        .unwrap_or_else(|| "GitNeat".into())
}

#[tauri::command]
pub fn app_menu(app: tauri::AppHandle) -> Vec<Menu> {
    menus(cfg!(target_os = "macos"), &product_name(&app))
}

#[derive(Default)]
pub struct Checks(
    pub std::sync::Mutex<std::collections::HashMap<String, tauri::menu::CheckMenuItem<tauri::Wry>>>,
);

#[tauri::command]
pub fn set_panel_checks(checks: tauri::State<Checks>, left: Option<bool>, details: Option<bool>) {
    if let Ok(held) = checks.0.lock() {
        for (id, value) in [("left-panel", left), ("details-panel", details)] {
            if let Some(item) = held.get(id) {
                let _ = item.set_enabled(value.is_some());
                let _ = item.set_checked(value.unwrap_or(false));
            }
        }
    }
}

#[cfg(target_os = "macos")]
pub use native_menu::{build, picked};

#[cfg(target_os = "macos")]
mod native_menu {
    use super::{Checks, Entry, PREFIX, menus, product_name};
    use std::collections::HashMap;
    use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
    use tauri::{AppHandle, Manager, Wry};

    pub fn picked(event_id: &str) -> Option<String> {
        event_id.strip_prefix(PREFIX).map(str::to_string)
    }

    fn native(
        app: &AppHandle,
        kind: &str,
        label: Option<&str>,
    ) -> tauri::Result<Box<dyn IsMenuItem<Wry>>> {
        Ok(match kind {
            "about" => Box::new(PredefinedMenuItem::about(app, label, None)?),
            "services" => Box::new(PredefinedMenuItem::services(app, label)?),
            "hide" => Box::new(PredefinedMenuItem::hide(app, label)?),
            "hideOthers" => Box::new(PredefinedMenuItem::hide_others(app, label)?),
            "showAll" => Box::new(PredefinedMenuItem::show_all(app, label)?),
            "quit" => Box::new(PredefinedMenuItem::quit(app, label)?),
            "cut" => Box::new(PredefinedMenuItem::cut(app, label)?),
            "copy" => Box::new(PredefinedMenuItem::copy(app, label)?),
            "paste" => Box::new(PredefinedMenuItem::paste(app, label)?),
            "selectAll" => Box::new(PredefinedMenuItem::select_all(app, label)?),
            "fullscreen" => Box::new(PredefinedMenuItem::fullscreen(app, label)?),
            "minimize" => Box::new(PredefinedMenuItem::minimize(app, label)?),
            _ => Box::new(PredefinedMenuItem::maximize(app, label)?),
        })
    }

    fn convert(
        app: &AppHandle,
        entries: &[Entry],
        checks: &mut HashMap<String, CheckMenuItem<Wry>>,
    ) -> tauri::Result<Vec<Box<dyn IsMenuItem<Wry>>>> {
        let mut out: Vec<Box<dyn IsMenuItem<Wry>>> = Vec::new();
        for entry in entries {
            match entry {
                Entry::Item { id, label, accel } => out.push(Box::new(MenuItem::with_id(
                    app,
                    format!("{PREFIX}{id}"),
                    label,
                    true,
                    accel.as_deref(),
                )?)),
                Entry::Check { id, label, accel } => {
                    let check = CheckMenuItem::with_id(
                        app,
                        format!("{PREFIX}{id}"),
                        label,
                        false,
                        false,
                        accel.as_deref(),
                    )?;
                    checks.insert(id.clone(), check.clone());
                    out.push(Box::new(check));
                }
                Entry::Sep => out.push(Box::new(PredefinedMenuItem::separator(app)?)),
                Entry::Sub { label, items } => {
                    let built = convert(app, items, checks)?;
                    let refs: Vec<&dyn IsMenuItem<Wry>> =
                        built.iter().map(|b| b.as_ref()).collect();
                    out.push(Box::new(Submenu::with_items(app, label, true, &refs)?));
                }
                Entry::Native { kind, label } => out.push(native(app, kind, label.as_deref())?),
            }
        }
        Ok(out)
    }

    pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
        let mut checks = HashMap::new();
        let mut tops: Vec<Submenu<Wry>> = Vec::new();
        for menu in menus(true, &product_name(app)) {
            let built = convert(app, &menu.items, &mut checks)?;
            let refs: Vec<&dyn IsMenuItem<Wry>> = built.iter().map(|b| b.as_ref()).collect();
            tops.push(Submenu::with_items(app, menu.label, true, &refs)?);
        }
        if let Ok(mut held) = app.state::<Checks>().0.lock() {
            *held = checks;
        }
        let refs: Vec<&dyn IsMenuItem<Wry>> =
            tops.iter().map(|t| t as &dyn IsMenuItem<Wry>).collect();
        Menu::with_items(app, &refs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(entries: &[Entry], out: &mut Vec<String>) {
        for entry in entries {
            match entry {
                Entry::Item { id, .. } | Entry::Check { id, .. } => out.push(id.clone()),
                Entry::Sub { items, .. } => ids(items, out),
                _ => {}
            }
        }
    }

    fn all(mac: bool) -> Vec<String> {
        let mut out = Vec::new();
        for menu in menus(mac, "GitNeat") {
            ids(&menu.items, &mut out);
        }
        out
    }

    #[test]
    fn both_platforms_reach_every_action() {
        let mac = all(true);
        let other = all(false);
        for id in [
            "details-panel",
            "left-panel",
            "tabs-list",
            "shortcuts",
            "next-tab",
            "previous-tab",
            "preferences",
            "tab:9",
            "favorite:9",
        ] {
            assert!(mac.iter().any(|i| i == id), "{id} missing on macOS");
            assert!(other.iter().any(|i| i == id), "{id} missing elsewhere");
        }
        assert!(other.iter().any(|i| i == "exit"));
        assert!(!mac.iter().any(|i| i == "exit"));
    }

    #[test]
    fn non_mac_menu_has_no_product_menu() {
        let labels: Vec<String> = menus(false, "GitNeat")
            .into_iter()
            .map(|m| m.label)
            .collect();
        assert_eq!(labels, ["File", "Edit", "View", "Help"]);
    }

    #[test]
    fn ids_are_unique() {
        for mac in [true, false] {
            let mut list = all(mac);
            let count = list.len();
            list.sort();
            list.dedup();
            assert_eq!(list.len(), count);
        }
    }
}
