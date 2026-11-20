use crate::actions;
use crate::appmenu;
use crate::askpass;
use crate::editors;
use crate::git;
use crate::load::{self, Operation};
use crate::loaders::{self, DiffSource};
use crate::menus::{self, MenuKind};
use crate::paths;
use crate::setup;
use crate::store;
use crate::terminal;
use crate::watch;
use crate::workspaces;
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use std::path::PathBuf;

type Res<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn arg<T: DeserializeOwned>(args: &Value, key: &str) -> Res<T> {
    serde_json::from_value(args.get(key).cloned().unwrap_or(Value::Null))
        .map_err(|e| format!("Bad argument {key}: {e}"))
}

fn out<T: Serialize>(value: T) -> Res<Value> {
    serde_json::to_value(value).map_err(err)
}

fn done<T: Serialize>(result: Res<T>) -> Res<Value> {
    out(result?)
}

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

async fn resolve_repo(dir: String) -> Value {
    let top = git::run_git(
        &dir,
        &["rev-parse".into(), "--show-toplevel".into()],
        None,
        None,
    )
    .await;
    if top.code == 0 {
        let path = paths::normalize(&PathBuf::from(top.stdout.trim()));
        Value::String(path.to_string_lossy().into_owned())
    } else {
        json!({ "error": format!("Not a git repository: {dir}") })
    }
}

async fn read_file(cwd: String, rel: String) -> Option<String> {
    let target = paths::resolve(&cwd, &rel);
    if !paths::inside(&watch::roots(), &target) {
        return None;
    }
    tokio::fs::read(&target)
        .await
        .ok()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

async fn write_file(cwd: String, rel: String, content: String) -> Res<bool> {
    let target = paths::resolve(&cwd, &rel);
    if !paths::inside(&watch::roots(), &target) {
        return Ok(false);
    }
    tokio::fs::write(&target, content).await.map_err(err)?;
    Ok(true)
}

fn open_terminal(cwd: &str) -> Res<()> {
    let mut cmd = if cfg!(target_os = "macos") {
        let mut c = std::process::Command::new("open");
        c.args(["-a", "Terminal", cwd]);
        c
    } else if cfg!(windows) {
        let mut c = std::process::Command::new("cmd.exe");
        c.args(["/c", "start", "cmd.exe"]).current_dir(cwd);
        c
    } else {
        let mut c = std::process::Command::new("x-terminal-emulator");
        c.current_dir(cwd);
        c
    };
    cmd.spawn().map(|_| ()).map_err(err)
}

type Fut = std::pin::Pin<Box<dyn std::future::Future<Output = Res<Value>> + Send>>;
type Handler = fn(Value) -> Fut;

macro_rules! h {
    (|$a:ident| $body:expr) => {
        Some(
            (|args: Value| -> Fut {
                Box::pin(async move {
                    let $a = &args;
                    $body
                })
            }) as Handler,
        )
    };
}

fn handler(name: &str) -> Option<Handler> {
    match name {
        "init" => h!(|a| {
            let exe: String = arg(a, "askpass")?;
            let started = askpass::start(
                exe,
                Box::new(|request| crate::emit::emit("askpass", request)),
            );
            if let Ok(server) = started {
                askpass::install(server);
            }
            Ok(Value::Null)
        }),
        "askpass_reply" => h!(|a| {
            askpass::reply(arg(a, "request")?, arg(a, "reply")?);
            Ok(Value::Null)
        }),
        "action" => h!(|a| done(
            actions::dispatch(
                &arg::<String>(a, "cwd")?,
                &arg::<String>(a, "name")?,
                arg(a, "args")?,
            )
            .await,
        )),
        "load_repo" => h!(|a| out(load::load_repo(
            &arg::<String>(a, "cwd")?,
            &arg::<Vec<String>>(a, "hidden")?,
            &arg::<Vec<String>>(a, "solo")?,
            arg(a, "limit")?,
        )
        .await)),
        "load_commits" => h!(|a| out(load::load_commits(
            &arg::<String>(a, "cwd")?,
            &arg::<Vec<String>>(a, "hidden")?,
            &arg::<Vec<String>>(a, "solo")?,
            arg(a, "skip")?,
            arg(a, "limit")?,
            arg(a, "lanes")?,
        )
        .await)),
        "load_commit" => h!(|a| {
            done(loaders::load_commit(&arg::<String>(a, "cwd")?, &arg::<String>(a, "sha")?).await)
        }),
        "load_compare" => h!(|a| done(
            loaders::load_compare(
                &arg::<String>(a, "cwd")?,
                &arg::<Vec<String>>(a, "shas")?,
                arg(a, "wip")?,
            )
            .await,
        )),
        "load_all_files" => h!(|a| done(
            loaders::load_all_files(&arg::<String>(a, "cwd")?, &arg::<String>(a, "sha")?).await,
        )),
        "load_diff" => h!(|a| {
            let source: DiffSource = arg(a, "source")?;
            let orig: Option<String> = arg(a, "orig")?;
            let ignore: Option<bool> = arg(a, "ignoreWhitespace")?;
            done(
                loaders::load_diff(
                    &arg::<String>(a, "cwd")?,
                    &source,
                    &arg::<String>(a, "file")?,
                    ignore.unwrap_or(false),
                    orig.as_deref(),
                )
                .await,
            )
        }),
        "load_sides" => h!(|a| {
            let source: DiffSource = arg(a, "source")?;
            let orig: Option<String> = arg(a, "orig")?;
            out(loaders::load_sides(
                &arg::<String>(a, "cwd")?,
                &source,
                &arg::<String>(a, "file")?,
                orig.as_deref(),
                &watch::roots(),
            )
            .await)
        }),
        "load_images" => h!(|a| {
            let source: DiffSource = arg(a, "source")?;
            let orig: Option<String> = arg(a, "orig")?;
            out(loaders::load_images(
                &arg::<String>(a, "cwd")?,
                &source,
                &arg::<String>(a, "file")?,
                orig.as_deref(),
                &watch::roots(),
            )
            .await)
        }),
        "load_blame" => h!(|a| {
            let rev: Option<String> = arg(a, "rev")?;
            done(
                loaders::load_blame(
                    &arg::<String>(a, "cwd")?,
                    &arg::<String>(a, "file")?,
                    rev.as_deref(),
                )
                .await,
            )
        }),
        "load_file_history_page" => h!(|a| {
            let pages: u32 = arg(a, "pages")?;
            done(
                loaders::load_file_history_page(
                    &arg::<String>(a, "cwd")?,
                    &arg::<String>(a, "file")?,
                    pages.max(1) as usize * 30000,
                )
                .await,
            )
        }),
        "load_file_history" => h!(|a| {
            let limit: Option<u32> = arg(a, "limit")?;
            done(
                loaders::load_file_history(
                    &arg::<String>(a, "cwd")?,
                    &arg::<String>(a, "file")?,
                    limit.unwrap_or(200),
                )
                .await,
            )
        }),
        "load_merge" => h!(|a| {
            let operation: Option<Operation> = arg(a, "operation")?;
            done(
                loaders::load_merge(
                    &arg::<String>(a, "cwd")?,
                    &arg::<String>(a, "path")?,
                    operation,
                )
                .await,
            )
        }),
        "load_operation" => h!(|a| {
            let operation: Option<Operation> = arg(a, "operation")?;
            out(loaders::load_operation(&arg::<String>(a, "cwd")?, operation).await)
        }),
        "load_submodules" => h!(|a| out(actions::submodule::load(&arg::<String>(a, "cwd")?).await)),
        "load_head_message" => {
            h!(|a| out(loaders::load_head_message(&arg::<String>(a, "cwd")?).await))
        }
        "has_commit_hook" => h!(|a| out(loaders::has_commit_hook(&arg::<String>(a, "cwd")?).await)),
        "resolve_repo" => h!(|a| out(resolve_repo(arg(a, "dir")?).await)),
        "repo_templates" => h!(|a| out(setup::repo_templates().await)),
        "clone_repo" => h!(|a| done(
            setup::clone_repo(
                arg(a, "parent")?,
                arg(a, "url")?,
                arg(a, "target")?,
                arg(a, "shallow")?,
            )
            .await,
        )),
        "init_repo" => h!(|a| done(
            setup::init_repo(
                arg(a, "parent")?,
                arg(a, "name")?,
                arg(a, "branch")?,
                arg(a, "gitignore")?,
                arg(a, "license")?,
                arg(a, "lfs")?,
            )
            .await,
        )),
        "missing_paths" => h!(|a| {
            let list: Vec<String> = arg(a, "paths")?;
            out(list
                .into_iter()
                .filter(|p| !std::path::Path::new(p).is_dir())
                .collect::<Vec<_>>())
        }),
        "repo_summaries" => {
            h!(|a| out(workspaces::repo_summaries(arg(a, "paths")?, arg(a, "wip")?).await))
        }
        "find_repos" => h!(|a| out(workspaces::find_repos(arg(a, "dirs")?).await)),
        "import_code_workspace" => {
            h!(|a| out(workspaces::import_code_workspace(arg(a, "file")?).await))
        }
        "repo_readme" => h!(|a| out(workspaces::repo_readme(arg(a, "path")?).await)),
        "create_readme" => h!(|a| done(workspaces::create_readme(arg(a, "path")?).await)),
        "copy_icon" => h!(|a| out(workspaces::copy_icon(arg(a, "source")?).await)),
        "icon_data" => h!(|a| out(workspaces::icon_data(arg(a, "name")?).await)),
        "external_editors" => h!(|a| out(editors::external_editors().await)),
        "open_in_editor" => h!(|a| done(
            editors::open_in_editor(arg(a, "editor")?, arg(a, "customPath")?, arg(a, "paths")?)
                .await,
        )),
        "write_temp" => h!(|a| done(write_temp(arg(a, "content")?).await)),
        "read_file" => h!(|a| out(read_file(arg(a, "cwd")?, arg(a, "rel")?).await)),
        "write_file" => {
            h!(|a| done(write_file(arg(a, "cwd")?, arg(a, "rel")?, arg(a, "content")?).await))
        }
        "context_menu_items" => h!(|a| {
            let kind: MenuKind = arg(a, "kind")?;
            done(
                menus::build(
                    &arg::<String>(a, "cwd")?,
                    kind,
                    a.get("args").unwrap_or(&Value::Null),
                )
                .await,
            )
        }),
        "app_menu" => h!(|a| out(appmenu::app_menu("GitNeat"))),
        "inside_roots" => h!(|a| {
            let target: String = arg(a, "target")?;
            out(paths::inside(&watch::roots(), &PathBuf::from(target)))
        }),
        "open_terminal" => h!(|a| done(open_terminal(&arg::<String>(a, "cwd")?))),
        "store_get" => h!(|a| out(store::get().await)),
        "store_set" => h!(|a| {
            let data: Value = arg(a, "data")?;
            store::set(&data).await.map_err(err)?;
            Ok(Value::Null)
        }),
        "watch" => h!(|a| {
            watch::watch(arg(a, "cwd")?);
            Ok(Value::Null)
        }),
        "unwatch" => h!(|a| {
            watch::unwatch(&arg::<String>(a, "cwd")?);
            Ok(Value::Null)
        }),
        "term_open" => h!(|a| done(terminal::term_open(
            arg(a, "cwd")?,
            arg(a, "cols")?,
            arg(a, "rows")?,
        ))),
        "term_write" => h!(|a| {
            terminal::term_write(arg(a, "id")?, arg(a, "data")?);
            Ok(Value::Null)
        }),
        "term_resize" => h!(|a| {
            terminal::term_resize(arg(a, "id")?, arg(a, "cols")?, arg(a, "rows")?);
            Ok(Value::Null)
        }),
        "term_close" => h!(|a| {
            terminal::term_close(arg(a, "id")?);
            Ok(Value::Null)
        }),
        _ => None,
    }
}

pub async fn invoke(name: &str, args: Value) -> Res<Value> {
    match handler(name) {
        Some(run) => run(args).await,
        None => Err(format!("Unknown command {name}")),
    }
}
