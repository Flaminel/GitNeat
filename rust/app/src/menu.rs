use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Manager, Runtime, Window};

#[derive(Serialize, Deserialize, Debug)]
pub struct MenuSpec {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub submenu: Option<Vec<MenuSpec>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accelerator: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checked: Option<bool>,
}

#[derive(Default)]
pub struct Chosen(pub Mutex<Option<String>>);

const PREFIX: &str = "gitneat:";

pub fn picked(event_id: &str) -> Option<String> {
    event_id.strip_prefix(PREFIX).map(str::to_string)
}

fn build<R: Runtime, M: Manager<R>>(
    app: &M,
    items: &[MenuSpec],
    seq: &mut usize,
) -> tauri::Result<Vec<Box<dyn IsMenuItem<R>>>> {
    let mut out: Vec<Box<dyn IsMenuItem<R>>> = Vec::new();
    for item in items {
        let enabled = item.enabled != Some(false);
        let label = item.label.clone().unwrap_or_default();
        *seq += 1;
        if item.kind.as_deref() == Some("separator") {
            out.push(Box::new(PredefinedMenuItem::separator(app)?));
        } else if let Some(children) = &item.submenu {
            let built = build(app, children, seq)?;
            let refs: Vec<&dyn IsMenuItem<R>> = built.iter().map(|b| b.as_ref()).collect();
            out.push(Box::new(Submenu::with_items(app, label, enabled, &refs)?));
        } else {
            let id = match &item.id {
                Some(id) => format!("{PREFIX}{id}"),
                None => format!("gitneat-none:{seq}"),
            };
            if let Some(checked) = item.checked {
                out.push(Box::new(CheckMenuItem::with_id(
                    app,
                    id,
                    label,
                    enabled,
                    checked,
                    item.accelerator.as_deref(),
                )?));
            } else {
                out.push(Box::new(MenuItem::with_id(
                    app,
                    id,
                    label,
                    enabled,
                    item.accelerator.as_deref(),
                )?));
            }
        }
    }
    Ok(out)
}

pub fn popup<R: Runtime>(window: &Window<R>, items: &[MenuSpec]) -> tauri::Result<()> {
    let mut seq = 0;
    let built = build(window, items, &mut seq)?;
    let refs: Vec<&dyn IsMenuItem<R>> = built.iter().map(|b| b.as_ref()).collect();
    let menu = Menu::with_items(window, &refs)?;
    window.popup_menu(&menu)
}
