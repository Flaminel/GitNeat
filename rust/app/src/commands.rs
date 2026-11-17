use crate::git::{self, GitResult};
use crate::load::{self, RepoData};
use crate::menu::{self, Chosen, MenuSpec};
use crate::paths;
use crate::store;
use crate::watch::{self, Watchers};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State, Window};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::oneshot;

type Res<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn open_roots(watchers: &Watchers) -> Vec<String> {
    watchers
        .0
        .lock()
        .map(|m| m.keys().cloned().collect())
        .unwrap_or_default()
}

fn to_path(picked: Option<FilePath>) -> Option<PathBuf> {
    picked.and_then(|p| p.into_path().ok())
}

#[tauri::command]
pub async fn git(
    cwd: String,
    args: Vec<String>,
    env: Option<HashMap<String, String>>,
    input: Option<String>,
) -> GitResult {
    if git::blocked(&args) {
        return GitResult {
            code: 1,
            stdout: String::new(),
            stderr: "GitNeat blocked a git option that can run commands.".into(),
        };
    }
    git::run_git(&cwd, &args, env, input).await
}

#[tauri::command]
pub async fn load_repo(
    cwd: String,
    hidden: Vec<String>,
    solo: Vec<String>,
    limit: u32,
) -> RepoData {
    load::load_repo(&cwd, &hidden, &solo, limit).await
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

#[tauri::command]
pub async fn open_repo_dialog(window: Window) -> Value {
    let Some(dir) = pick_folder(&window, false).await else {
        return Value::Null;
    };
    let dir_text = dir.to_string_lossy().into_owned();
    let top = git::run_git(
        &dir_text,
        &["rev-parse".into(), "--show-toplevel".into()],
        None,
        None,
    )
    .await;
    if top.code == 0 {
        let path = paths::normalize(&PathBuf::from(top.stdout.trim()));
        Value::String(path.to_string_lossy().into_owned())
    } else {
        serde_json::json!({ "error": format!("Not a git repository: {dir_text}") })
    }
}

#[tauri::command]
pub async fn pick_directory(window: Window) -> Option<String> {
    pick_folder(&window, true)
        .await
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn save_file(window: Window, default_name: String, content: String) -> Res<bool> {
    let (tx, rx) = oneshot::channel();
    window
        .dialog()
        .file()
        .set_parent(&window)
        .set_file_name(default_name)
        .save_file(move |p| {
            let _ = tx.send(to_path(p));
        });
    let Some(target) = rx.await.ok().flatten() else {
        return Ok(false);
    };
    tokio::fs::write(target, content).await.map_err(err)?;
    Ok(true)
}

#[tauri::command]
pub async fn write_temp(content: String) -> Res<String> {
    let dir = tempfile::Builder::new()
        .prefix("gitneat-")
        .tempdir()
        .map_err(err)?
        .keep();
    let file = dir.join("data");
    tokio::fs::write(&file, content).await.map_err(err)?;
    Ok(file.to_string_lossy().replace('\\', "/"))
}

#[tauri::command]
pub async fn read_file(
    watchers: State<'_, Watchers>,
    cwd: String,
    rel: String,
) -> Res<Option<String>> {
    let target = paths::resolve(&cwd, &rel);
    if !paths::inside(&open_roots(&watchers), &target) {
        return Ok(None);
    }
    Ok(tokio::fs::read(&target)
        .await
        .ok()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned()))
}

#[tauri::command]
pub async fn write_file(
    watchers: State<'_, Watchers>,
    cwd: String,
    rel: String,
    content: String,
) -> Res<bool> {
    let target = paths::resolve(&cwd, &rel);
    if !paths::inside(&open_roots(&watchers), &target) {
        return Ok(false);
    }
    tokio::fs::write(&target, content).await.map_err(err)?;
    Ok(true)
}

#[tauri::command]
pub async fn menu(window: Window, items: Vec<MenuSpec>) -> Res<Option<String>> {
    if let Ok(mut chosen) = window.state::<Chosen>().0.lock() {
        *chosen = None;
    }
    menu::popup(&window, &items).map_err(err)?;
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

#[tauri::command]
pub fn clipboard(app: AppHandle, text: String) -> Res<()> {
    app.clipboard().write_text(text).map_err(err)
}

#[tauri::command]
pub fn open_external(app: AppHandle, url: String) -> Res<()> {
    if url.starts_with("http://") || url.starts_with("https://") {
        app.opener().open_url(url, None::<&str>).map_err(err)?;
    }
    Ok(())
}

#[tauri::command]
pub fn open_path(app: AppHandle, watchers: State<'_, Watchers>, target: String) -> String {
    if !paths::inside(&open_roots(&watchers), &PathBuf::from(&target)) {
        return "GitNeat opens only files inside an open repository.".into();
    }
    match app.opener().open_path(target, None::<&str>) {
        Ok(()) => String::new(),
        Err(e) => e.to_string(),
    }
}

#[tauri::command]
pub fn show_item(app: AppHandle, watchers: State<'_, Watchers>, target: String) -> Res<()> {
    if paths::inside(&open_roots(&watchers), &PathBuf::from(&target)) {
        app.opener().reveal_item_in_dir(target).map_err(err)?;
    }
    Ok(())
}

#[tauri::command]
pub fn open_terminal(cwd: String) -> Res<()> {
    let mut cmd = if cfg!(target_os = "macos") {
        let mut c = std::process::Command::new("open");
        c.args(["-a", "Terminal", &cwd]);
        c
    } else if cfg!(windows) {
        let mut c = std::process::Command::new("cmd.exe");
        c.args(["/c", "start", "cmd.exe"]).current_dir(&cwd);
        c
    } else {
        let mut c = std::process::Command::new("x-terminal-emulator");
        c.current_dir(&cwd);
        c
    };
    cmd.spawn().map(|_| ()).map_err(err)
}

#[tauri::command]
pub async fn store_get() -> Value {
    store::get().await
}

#[tauri::command]
pub async fn store_set(data: Value) -> Res<()> {
    store::set(&data).await.map_err(err)
}

#[tauri::command]
pub fn watch(app: AppHandle, watchers: State<'_, Watchers>, cwd: String) {
    let Ok(mut map) = watchers.0.lock() else {
        return;
    };
    if map.contains_key(&cwd) {
        return;
    }
    if let Ok(watcher) = watch::start(app, cwd.clone()) {
        map.insert(cwd, watcher);
    }
}

#[tauri::command]
pub fn unwatch(watchers: State<'_, Watchers>, cwd: String) {
    if let Ok(mut map) = watchers.0.lock() {
        map.remove(&cwd);
    }
}
