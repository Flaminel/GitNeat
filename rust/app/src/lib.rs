pub mod actions;
pub mod commands;
pub mod git;
pub mod load;
pub mod load_gix;
pub mod menu;
pub mod menus;
pub mod paths;
pub mod store;
pub mod watch;

use tauri::webview::NewWindowResponse;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

fn window_size() -> (f64, f64) {
    let text = std::env::var("GITNEAT_WINDOW_SIZE").unwrap_or_else(|_| "1500x940".into());
    match text.split_once('x') {
        Some((w, h)) => (w.parse().unwrap_or(1500.0), h.parse().unwrap_or(940.0)),
        None => (1500.0, 940.0),
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .manage(watch::Watchers::default())
        .manage(menu::Chosen::default())
        .on_menu_event(|app, event| {
            if let Some(id) = menu::picked(&event.id().0)
                && let Ok(mut chosen) = app.state::<menu::Chosen>().0.lock()
            {
                *chosen = Some(id);
            }
        })
        .setup(|app| {
            let (width, height) = window_size();
            let opener = app.handle().clone();
            let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("GitNeat")
                .inner_size(width, height)
                .min_inner_size(900.0, 600.0)
                .background_color(tauri::window::Color(0x1c, 0x1e, 0x23, 0xff))
                .on_new_window(move |url, _| {
                    if matches!(url.scheme(), "http" | "https") {
                        let _ = opener.opener().open_url(url.as_str(), None::<&str>);
                    }
                    NewWindowResponse::Deny
                });
            #[cfg(target_os = "macos")]
            let builder = builder
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true)
                .traffic_light_position(tauri::LogicalPosition::new(12.0, 11.0));
            #[cfg(not(target_os = "macos"))]
            let builder = builder.decorations(false);
            builder.build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::git,
            commands::action,
            commands::load_repo,
            commands::open_repo_dialog,
            commands::pick_directory,
            commands::save_file,
            commands::write_temp,
            commands::read_file,
            commands::write_file,
            commands::menu,
            commands::context_menu,
            commands::clipboard,
            commands::open_external,
            commands::open_path,
            commands::show_item,
            commands::open_terminal,
            commands::store_get,
            commands::store_set,
            commands::watch,
            commands::unwatch,
        ])
        .run(tauri::generate_context!())
        .expect("GitNeat failed to start");
}
