use tauri::menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Runtime};

pub const PREFIX: &str = "app:";

pub fn picked(event_id: &str) -> Option<String> {
    event_id.strip_prefix(PREFIX).map(str::to_string)
}

fn item<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    label: &str,
    accelerator: Option<&str>,
) -> tauri::Result<MenuItem<R>> {
    MenuItem::with_id(app, format!("{PREFIX}{id}"), label, true, accelerator)
}

fn submenu<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    items: &[&dyn IsMenuItem<R>],
) -> tauri::Result<Submenu<R>> {
    Submenu::with_items(app, label, true, items)
}

fn sep<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<PredefinedMenuItem<R>> {
    PredefinedMenuItem::separator(app)
}

fn numbered<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    label: &str,
    modifier: &str,
) -> tauri::Result<Vec<MenuItem<R>>> {
    (1..=9)
        .map(|n| {
            item(
                app,
                &format!("{id}:{n}"),
                &format!("{label} {n}"),
                Some(&format!("{modifier}+{n}")),
            )
        })
        .collect()
}

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let name = app
        .config()
        .product_name
        .clone()
        .unwrap_or_else(|| "GitNeat".into());

    let app_menu = submenu(
        app,
        &name,
        &[
            &PredefinedMenuItem::about(app, Some(&format!("About {name}")), None)?,
            &sep(app)?,
            &item(app, "preferences", "Preferences...", Some("CmdOrCtrl+,"))?,
            &sep(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &sep(app)?,
            &PredefinedMenuItem::hide(app, Some(&format!("Hide {name}")))?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &sep(app)?,
            &PredefinedMenuItem::quit(app, Some(&format!("Quit {name}")))?,
        ],
    )?;

    let file = submenu(
        app,
        "File",
        &[
            &item(app, "new-tab", "New Tab", Some("CmdOrCtrl+T"))?,
            &item(app, "close-tab", "Close Tab", Some("CmdOrCtrl+W"))?,
            &item(
                app,
                "reopen-tab",
                "Reopen Closed Tab",
                Some("CmdOrCtrl+Shift+T"),
            )?,
            &sep(app)?,
            &item(app, "clone", "Clone Repo...", Some("CmdOrCtrl+N"))?,
            &item(app, "init", "Init Repo...", Some("CmdOrCtrl+I"))?,
            &item(app, "open", "Open Repo...", Some("CmdOrCtrl+O"))?,
            &sep(app)?,
            &item(app, "terminal", "Open External Terminal", Some("Alt+T"))?,
            &item(app, "file-manager", "Open in File Manager", Some("Alt+O"))?,
        ],
    )?;

    let edit = submenu(
        app,
        "Edit",
        &[
            &item(app, "undo", "Undo", None)?,
            &item(app, "redo", "Redo", None)?,
            &sep(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let view = submenu(
        app,
        "View",
        &[
            &PredefinedMenuItem::fullscreen(app, Some("Toggle Full Screen"))?,
            &sep(app)?,
            &item(app, "left-panel", "Toggle Left Panel", None)?,
            &sep(app)?,
            &item(app, "zoom-in", "Increase Zoom", Some("CmdOrCtrl+="))?,
            &item(app, "zoom-out", "Decrease Zoom", Some("CmdOrCtrl+-"))?,
            &item(app, "zoom-reset", "Reset Zoom", Some("CmdOrCtrl+0"))?,
        ],
    )?;

    let tab_items = numbered(app, "tab", "Select Tab", "CmdOrCtrl")?;
    let mut tab_refs: Vec<&dyn IsMenuItem<R>> = Vec::new();
    let next = item(app, "next-tab", "Select Next Tab", None)?;
    let previous = item(app, "previous-tab", "Select Previous Tab", None)?;
    tab_refs.push(&next);
    tab_refs.push(&previous);
    let divider = sep(app)?;
    tab_refs.push(&divider);
    tab_refs.extend(tab_items.iter().map(|i| i as &dyn IsMenuItem<R>));
    let tabs = submenu(app, "Tabs", &tab_refs)?;

    let favorite_items = numbered(app, "favorite", "Open Favorite Repo", "Ctrl+Cmd")?;
    let favorite_refs: Vec<&dyn IsMenuItem<R>> = favorite_items
        .iter()
        .map(|i| i as &dyn IsMenuItem<R>)
        .collect();
    let favorites = submenu(app, "Favorites", &favorite_refs)?;

    let window = submenu(
        app,
        "Window",
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, Some("Zoom"))?,
            &sep(app)?,
            &tabs,
            &favorites,
        ],
    )?;

    let help = submenu(
        app,
        "Help",
        &[&item(
            app,
            "support-docs",
            "View Support Documentation",
            None,
        )?],
    )?;

    Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window, &help])
}
