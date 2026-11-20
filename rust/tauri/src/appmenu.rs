#[cfg(target_os = "macos")]
use gitneat_core::appmenu::{Entry, PREFIX, menus};
use std::collections::HashMap;
use tauri::menu::CheckMenuItem;
#[cfg(target_os = "macos")]
use tauri::menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, Wry};

#[derive(Default)]
pub struct Checks(pub std::sync::Mutex<HashMap<String, CheckMenuItem<Wry>>>);

pub fn set_panel_checks(
    app: &AppHandle,
    left: Option<bool>,
    details: Option<bool>,
    terminal: Option<bool>,
) {
    if let Ok(held) = app.state::<Checks>().0.lock() {
        for (id, value) in [
            ("left-panel", left),
            ("details-panel", details),
            ("terminal-panel", terminal),
        ] {
            if let Some(item) = held.get(id) {
                let _ = item.set_enabled(value.is_some());
                let _ = item.set_checked(value.unwrap_or(false));
            }
        }
    }
}

#[cfg(target_os = "macos")]
pub fn picked(event_id: &str) -> Option<String> {
    event_id.strip_prefix(PREFIX).map(str::to_string)
}

#[cfg(target_os = "macos")]
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

#[cfg(target_os = "macos")]
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
                let refs: Vec<&dyn IsMenuItem<Wry>> = built.iter().map(|b| b.as_ref()).collect();
                out.push(Box::new(Submenu::with_items(app, label, true, &refs)?));
            }
            Entry::Native { kind, label } => out.push(native(app, kind, label.as_deref())?),
        }
    }
    Ok(out)
}

#[cfg(target_os = "macos")]
pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let mut checks = HashMap::new();
    let mut tops: Vec<Submenu<Wry>> = Vec::new();
    for menu in menus(true, "GitNeat") {
        let built = convert(app, &menu.items, &mut checks)?;
        let refs: Vec<&dyn IsMenuItem<Wry>> = built.iter().map(|b| b.as_ref()).collect();
        tops.push(Submenu::with_items(app, menu.label, true, &refs)?);
    }
    if let Ok(mut held) = app.state::<Checks>().0.lock() {
        *held = checks;
    }
    let refs: Vec<&dyn IsMenuItem<Wry>> = tops.iter().map(|t| t as &dyn IsMenuItem<Wry>).collect();
    Menu::with_items(app, &refs)
}
