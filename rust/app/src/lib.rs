pub mod actions;
pub mod appmenu;
pub mod askpass;
pub mod commands;
pub mod editors;
pub mod git;
pub mod load;
pub mod load_gix;
pub mod loaders;
pub mod menu;
pub mod menus;
pub mod paths;
pub mod setup;
pub mod shellpath;
pub mod store;
pub mod templates;
pub mod terminal;
pub mod watch;
pub mod workspaces;

use tauri::webview::NewWindowResponse;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

fn window_size() -> (f64, f64) {
    let text = std::env::var("GITNEAT_WINDOW_SIZE").unwrap_or_else(|_| "1500x940".into());
    match text.split_once('x') {
        Some((w, h)) => (w.parse().unwrap_or(1500.0), h.parse().unwrap_or(940.0)),
        None => (1500.0, 940.0),
    }
}

pub fn run() {
    shellpath::apply();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .manage(watch::Watchers::default())
        .manage(menu::Chosen::default())
        .manage(appmenu::Checks::default())
        .manage(terminal::Terminals::default())
        .on_menu_event(|app, event| {
            if let Some(id) = menu::picked(&event.id().0)
                && let Ok(mut chosen) = app.state::<menu::Chosen>().0.lock()
            {
                *chosen = Some(id);
            }
            #[cfg(target_os = "macos")]
            if let Some(id) = appmenu::picked(&event.id().0) {
                let _ = app.emit("app-menu", id);
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
                .disable_drag_drop_handler()
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
            let emitter = app.handle().clone();
            if let Ok(exe) = std::env::current_exe()
                && let Ok(server) = askpass::start(
                    exe.to_string_lossy().into_owned(),
                    Box::new(move |request| {
                        let _ = emitter.emit("askpass", request);
                    }),
                )
            {
                askpass::install(server);
            }
            #[cfg(target_os = "macos")]
            app.set_menu(appmenu::build(app.handle())?)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::action,
            commands::askpass_reply,
            commands::load_repo,
            commands::load_commits,
            commands::load_commit,
            commands::load_all_files,
            commands::load_compare,
            commands::load_diff,
            commands::load_sides,
            commands::load_images,
            commands::load_blame,
            commands::load_file_history,
            commands::load_file_history_page,
            commands::load_merge,
            commands::load_operation,
            commands::load_submodules,
            commands::load_head_message,
            commands::has_commit_hook,
            commands::open_repo_dialog,
            commands::pick_directory,
            setup::repo_templates,
            setup::clone_repo,
            setup::init_repo,
            commands::missing_paths,
            workspaces::repo_summaries,
            workspaces::find_repos,
            workspaces::pick_directories,
            workspaces::import_code_workspace,
            workspaces::repo_readme,
            workspaces::create_readme,
            workspaces::pick_icon,
            workspaces::icon_data,
            editors::external_editors,
            editors::open_in_editor,
            commands::save_file,
            commands::open_patch,
            commands::write_temp,
            commands::read_file,
            commands::write_file,
            commands::menu,
            terminal::term_open,
            terminal::term_write,
            terminal::term_resize,
            terminal::term_close,
            appmenu::app_menu,
            appmenu::set_panel_checks,
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
