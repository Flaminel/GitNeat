use crate::menu::{self, Chosen};
use gitneat_core::commands::invoke;
use gitneat_core::menu::MenuSpec;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use std::path::PathBuf;
use tauri::{Manager, Window};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::oneshot;

type Res<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn arg<T: DeserializeOwned>(args: &Value, key: &str) -> Res<T> {
    serde_json::from_value(args.get(key).cloned().unwrap_or(Value::Null))
        .map_err(|e| format!("Bad argument {key}: {e}"))
}

fn text(path: PathBuf) -> String {
    path.to_string_lossy().into_owned()
}

fn to_path(picked: Option<FilePath>) -> Option<PathBuf> {
    picked.and_then(|p| p.into_path().ok())
}

async fn pick_folder(window: &Window, create: bool) -> Option<PathBuf> {
    let (tx, rx) = oneshot::channel();
    window
        .dialog()
        .file()
        .set_parent(window)
        .set_can_create_directories(create)
        .pick_folder(move |p| {
            let _ = tx.send(to_path(p));
        });
    rx.await.ok().flatten()
}

async fn pick_folders(window: &Window) -> Vec<String> {
    let (tx, rx) = oneshot::channel();
    window
        .dialog()
        .file()
        .set_parent(window)
        .pick_folders(move |p| {
            let _ = tx.send(p);
        });
    rx.await
        .ok()
        .flatten()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|p| p.into_path().ok())
        .map(text)
        .collect()
}

async fn pick_file(
    window: &Window,
    title: Option<&str>,
    filter: (&str, &[&str]),
) -> Option<PathBuf> {
    let (tx, rx) = oneshot::channel();
    let mut dialog = window
        .dialog()
        .file()
        .set_parent(window)
        .add_filter(filter.0, filter.1);
    if let Some(title) = title {
        dialog = dialog.set_title(title);
    }
    dialog.pick_file(move |p| {
        let _ = tx.send(to_path(p));
    });
    rx.await.ok().flatten()
}

async fn show(window: &Window, items: &[MenuSpec]) -> Res<Option<String>> {
    if let Ok(mut chosen) = window.state::<Chosen>().0.lock() {
        *chosen = None;
    }
    menu::popup(window, items).map_err(err)?;
    let (tx, rx) = oneshot::channel();
    let handle = window.app_handle().clone();
    window
        .run_on_main_thread(move || {
            let picked = handle
                .state::<Chosen>()
                .0
                .lock()
                .ok()
                .and_then(|mut c| c.take());
            let _ = tx.send(picked);
        })
        .map_err(err)?;
    Ok(rx.await.ok().flatten())
}

async fn inside_roots(target: &str) -> Res<bool> {
    let value = invoke("inside_roots", json!({ "target": target })).await?;
    Ok(value.as_bool().unwrap_or(false))
}

fn json_of<T: serde::Serialize>(value: T) -> Res<Value> {
    serde_json::to_value(value).map_err(err)
}

pub async fn dispatch(window: &Window, name: &str, args: Value) -> Res<Value> {
    let a = &args;
    match name {
        "open_repo_dialog" => match pick_folder(window, false).await {
            Some(dir) => invoke("resolve_repo", json!({ "dir": text(dir) })).await,
            None => Ok(Value::Null),
        },
        "pick_directory" => json_of(pick_folder(window, true).await.map(text)),
        "pick_directories" => json_of(pick_folders(window).await),
        "import_code_workspace" => {
            match pick_file(window, None, ("Workspaces", &["code-workspace"])).await {
                Some(file) => invoke("import_code_workspace", json!({ "file": text(file) })).await,
                None => Ok(json!([])),
            }
        }
        "pick_icon" => {
            let filter = ("Image File", &["png", "jpg", "jpeg"][..]);
            match pick_file(window, Some("Select Workspace Icon"), filter).await {
                Some(source) => invoke("copy_icon", json!({ "source": text(source) })).await,
                None => Ok(Value::Null),
            }
        }
        "save_file" => {
            let default_name: String = arg(a, "defaultName")?;
            let content: String = arg(a, "content")?;
            let (tx, rx) = oneshot::channel();
            window
                .dialog()
                .file()
                .set_parent(window)
                .set_file_name(default_name)
                .save_file(move |p| {
                    let _ = tx.send(to_path(p));
                });
            let Some(target) = rx.await.ok().flatten() else {
                return Ok(json!(false));
            };
            tokio::fs::write(target, content).await.map_err(err)?;
            Ok(json!(true))
        }
        "open_patch" => match pick_file(window, None, ("Patch", &["patch", "diff"])).await {
            Some(source) => {
                let bytes = tokio::fs::read(source).await.map_err(err)?;
                Ok(json!(String::from_utf8_lossy(&bytes)))
            }
            None => Ok(Value::Null),
        },
        "menu" => {
            let items: Vec<MenuSpec> = arg(a, "items")?;
            json_of(show(window, &items).await?)
        }
        "context_menu" => {
            let items = invoke("context_menu_items", args.clone()).await?;
            if items.is_null() {
                return Ok(Value::Null);
            }
            let items: Vec<MenuSpec> = serde_json::from_value(items).map_err(err)?;
            json_of(show(window, &items).await?)
        }
        "clipboard" => {
            let content: String = arg(a, "text")?;
            window
                .app_handle()
                .clipboard()
                .write_text(content)
                .map_err(err)?;
            Ok(Value::Null)
        }
        "open_external" => {
            let url: String = arg(a, "url")?;
            if url.starts_with("http://") || url.starts_with("https://") {
                window.opener().open_url(url, None::<&str>).map_err(err)?;
            }
            Ok(Value::Null)
        }
        "open_path" => {
            let target: String = arg(a, "target")?;
            if !inside_roots(&target).await? {
                return Ok(json!("GitNeat opens only files inside an open repository."));
            }
            Ok(json!(
                match window.opener().open_path(target, None::<&str>) {
                    Ok(()) => String::new(),
                    Err(e) => e.to_string(),
                }
            ))
        }
        "show_item" => {
            let target: String = arg(a, "target")?;
            if inside_roots(&target).await? {
                window.opener().reveal_item_in_dir(target).map_err(err)?;
            }
            Ok(Value::Null)
        }
        "set_panel_checks" => {
            crate::appmenu::set_panel_checks(
                window.app_handle(),
                arg(a, "left")?,
                arg(a, "details")?,
                arg(a, "terminal")?,
            );
            Ok(Value::Null)
        }
        _ => invoke(name, args).await,
    }
}
