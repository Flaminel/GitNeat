#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod appmenu;
mod menu;
mod ui;

use serde_json::{Value, json};
use tauri::webview::NewWindowResponse;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder, Window};
use tauri_plugin_opener::OpenerExt;

fn window_size() -> (f64, f64) {
    let text = std::env::var("GITNEAT_WINDOW_SIZE").unwrap_or_else(|_| "1500x940".into());
    match text.split_once('x') {
        Some((w, h)) => (w.parse().unwrap_or(1500.0), h.parse().unwrap_or(940.0)),
        None => (1500.0, 940.0),
    }
}

#[tauri::command]
async fn dispatch(window: Window, name: String, args: Value) -> Result<Value, String> {
    ui::dispatch(&window, &name, args).await
}

fn main() {
    if let Some(code) = gitneat_core::askpass::client() {
        std::process::exit(code);
    }
    gitneat_core::shellpath::apply();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .manage(menu::Chosen::default())
        .manage(appmenu::Checks::default())
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
            let emitter = app.handle().clone();
            gitneat_core::emit::set(Box::new(move |event, payload| {
                let value: Value = serde_json::from_str(&payload).unwrap_or(Value::Null);
                let _ = emitter.emit(event, value);
            }));
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
            if let Ok(exe) = std::env::current_exe() {
                let args = json!({ "askpass": exe.to_string_lossy() });
                let _ =
                    tauri::async_runtime::block_on(gitneat_core::commands::invoke("init", args));
            }
            #[cfg(target_os = "macos")]
            app.set_menu(appmenu::build(app.handle())?)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![dispatch])
        .run(tauri::generate_context!())
        .expect("GitNeat failed to start");
}
