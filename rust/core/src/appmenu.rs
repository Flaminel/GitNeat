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
        check("terminal-panel", "Show Terminal Panel", "Ctrl+`"),
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

pub fn app_menu(name: &str) -> Vec<Menu> {
    menus(cfg!(target_os = "macos"), name)
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
            "terminal-panel",
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
