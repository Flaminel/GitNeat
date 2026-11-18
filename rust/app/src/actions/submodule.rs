use super::{Res, git, parse, raw, run};
use crate::paths;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Submodule {
    pub name: String,
    pub path: String,
    pub url: String,
    #[serde(default)]
    pub uninitialized: bool,
    #[serde(default)]
    pub deleted: bool,
    #[serde(default)]
    pub new: bool,
    #[serde(default)]
    pub out_of_sync: bool,
    #[serde(default)]
    pub dirty: bool,
}

pub struct Available {
    pub initialize: bool,
    pub commit: bool,
    pub reset: bool,
}

impl Submodule {
    pub fn available(&self) -> Available {
        let mut out = Available {
            initialize: false,
            commit: false,
            reset: false,
        };
        if self.uninitialized && !self.deleted {
            out.initialize = true;
        } else if self.new {
            out.commit = true;
        } else if self.dirty {
            out.reset = true;
        } else if self.out_of_sync {
            out.commit = true;
            out.reset = true;
        }
        out
    }
}

fn parse_gitmodules(text: &str) -> Vec<(String, String, String)> {
    let mut order: Vec<String> = Vec::new();
    let mut paths: HashMap<String, String> = HashMap::new();
    let mut urls: HashMap<String, String> = HashMap::new();
    for entry in text.split('\0').filter(|e| !e.is_empty()) {
        let (key, value) = entry.split_once('\n').unwrap_or((entry, ""));
        let Some(rest) = key.strip_prefix("submodule.") else {
            continue;
        };
        let Some((name, field)) = rest.rsplit_once('.') else {
            continue;
        };
        match field {
            "path" => {
                if !order.iter().any(|n| n == name) {
                    order.push(name.to_string());
                }
                paths.insert(name.to_string(), value.to_string());
            }
            "url" => {
                urls.insert(name.to_string(), value.to_string());
            }
            _ => {}
        }
    }
    order
        .into_iter()
        .map(|name| {
            let path = paths.remove(&name).unwrap_or_default();
            let url = urls.remove(&name).unwrap_or_default();
            (name, path, url)
        })
        .collect()
}

fn parse_status(text: &str) -> HashMap<String, char> {
    let mut out = HashMap::new();
    for line in text.lines() {
        let mut chars = line.chars();
        let Some(marker) = chars.next() else {
            continue;
        };
        let rest = chars.as_str();
        let Some((_, tail)) = rest.split_once(' ') else {
            continue;
        };
        let path = match tail.rfind(" (") {
            Some(at) if tail.ends_with(')') => &tail[..at],
            _ => tail,
        };
        out.insert(path.to_string(), marker);
    }
    out
}

pub async fn load(cwd: &str) -> Vec<Submodule> {
    let listed = raw(
        cwd,
        &["config", "-f", ".gitmodules", "-z", "--list"],
        None,
        None,
    )
    .await;
    if listed.code != 0 {
        return Vec::new();
    }
    let entries = parse_gitmodules(&listed.stdout);
    let status = raw(cwd, &["submodule", "status"], None, None).await;
    let markers = if status.code == 0 {
        parse_status(&status.stdout)
    } else {
        HashMap::new()
    };
    let mut out = Vec::new();
    for (name, path, url) in entries {
        let marker = markers.get(&path).copied();
        let folder = paths::resolve(cwd, &path);
        let deleted = !folder.exists();
        let uninitialized = matches!(marker, Some('-') | None);
        let tree = raw(cwd, &["ls-tree", "HEAD", "--", &path], None, None).await;
        let new = tree.code != 0 || tree.stdout.trim().is_empty();
        let dirty = if uninitialized || deleted {
            false
        } else {
            let inner = raw(
                &folder.to_string_lossy(),
                &["status", "--porcelain"],
                None,
                None,
            )
            .await;
            inner.code == 0 && !inner.stdout.trim().is_empty()
        };
        out.push(Submodule {
            name,
            path,
            url,
            uninitialized,
            deleted,
            new,
            out_of_sync: matches!(marker, Some('+') | Some('U')),
            dirty,
        });
    }
    out
}

#[derive(Deserialize)]
struct PathArg {
    path: String,
}

#[derive(Deserialize)]
struct ResetArg {
    path: String,
    #[serde(default)]
    deleted: bool,
}

#[derive(Deserialize)]
struct CommitArg {
    path: String,
    name: String,
    #[serde(default)]
    new: bool,
    #[serde(default)]
    deleted: bool,
    #[serde(default)]
    message: String,
}

#[derive(Deserialize)]
struct UrlArg {
    path: String,
    name: String,
    url: String,
}

#[derive(Deserialize)]
struct RemoveArg {
    path: String,
    name: String,
    #[serde(default)]
    commit: bool,
}

#[derive(Deserialize)]
struct AddArg {
    url: String,
    path: String,
}

fn inner_path(cwd: &str, path: &str) -> Res<PathBuf> {
    let full = paths::resolve(cwd, path);
    let root = paths::resolve(cwd, ".");
    if path.trim().is_empty()
        || path.starts_with('-')
        || full == root
        || !paths::inside(&[cwd.to_string()], &full)
    {
        return Err(format!("Invalid submodule path '{path}'"));
    }
    Ok(full)
}

fn safe_url(url: &str) -> Res<&str> {
    let url = url.trim();
    if url.is_empty() || url.starts_with('-') {
        return Err("Invalid submodule URL".to_string());
    }
    Ok(url)
}

async fn update(cwd: &str, args: &Value) -> Res<Value> {
    let a: PathArg = parse(args)?;
    inner_path(cwd, &a.path)?;
    sync(cwd, &a.path).await?;
    Ok(json!({ "record": null }))
}

async fn sync(cwd: &str, path: &str) -> Res<String> {
    git(
        cwd,
        &["submodule", "update", "--init", "--recursive", "--", path],
    )
    .await
}

async fn update_all(cwd: &str) -> Res<Value> {
    if paths::resolve(cwd, ".gitmodules").exists() {
        git(cwd, &["submodule", "update", "--init", "--recursive"]).await?;
    }
    Ok(json!({ "record": null }))
}

async fn reset(cwd: &str, args: &Value) -> Res<Value> {
    let a: ResetArg = parse(args)?;
    let full = inner_path(cwd, &a.path)?;
    if a.deleted {
        git(cwd, &["restore", "--", &a.path]).await?;
    } else {
        let inner = full.to_string_lossy().into_owned();
        git(&inner, &["reset", "--hard"]).await?;
        git(&inner, &["clean", "-fd"]).await?;
    }
    sync(cwd, &a.path).await?;
    Ok(json!({ "record": null }))
}

async fn stage_paths(cwd: &str, path: &str) -> Res<()> {
    let mut args = vec!["add", "-A", "--"];
    if paths::resolve(cwd, ".gitmodules").exists() {
        args.push(".gitmodules");
    }
    args.push(path);
    git(cwd, &args).await?;
    Ok(())
}

async fn commit(cwd: &str, args: &Value) -> Res<Value> {
    let a: CommitArg = parse(args)?;
    inner_path(cwd, &a.path)?;
    let verb = if a.new {
        "Added"
    } else if a.deleted {
        "Removed"
    } else {
        "Updated"
    };
    let line = format!("{verb} submodule {}", a.name);
    let message = format!("{}\n{line}", a.message.trim()).trim().to_string();
    stage_paths(cwd, &a.path).await?;
    run(cwd, true, git(cwd, &["commit", "-m", &message])).await
}

async fn set_url(cwd: &str, args: &Value) -> Res<Value> {
    let a: UrlArg = parse(args)?;
    inner_path(cwd, &a.path)?;
    let url = safe_url(&a.url)?;
    git(cwd, &["submodule", "set-url", "--", &a.path, url]).await?;
    let key = format!("submodule.{}.url", a.name);
    if raw(cwd, &["config", "--get", &key], None, None).await.code == 0 {
        git(cwd, &["config", &key, url]).await?;
    }
    Ok(json!({ "record": null }))
}

async fn remove_work(cwd: &str, a: &RemoveArg) -> Res<()> {
    if paths::resolve(cwd, ".gitmodules").exists() {
        git(cwd, &["add", "--", ".gitmodules"]).await?;
    }
    git(cwd, &["rm", "-f", "--", &a.path]).await?;
    let file = paths::resolve(cwd, ".gitmodules");
    let empty = tokio::fs::read_to_string(&file)
        .await
        .is_ok_and(|text| text.trim().is_empty());
    if empty {
        tokio::fs::remove_file(&file)
            .await
            .map_err(|e| e.to_string())?;
        git(cwd, &["add", "-A", "--", ".gitmodules"]).await?;
    }
    if a.commit {
        let message = format!("Removed submodule {}", a.name);
        let mut args = vec!["commit", "-m", &message, "--", &a.path];
        if empty || paths::resolve(cwd, ".gitmodules").exists() {
            args.push(".gitmodules");
        }
        git(cwd, &args).await?;
    }
    Ok(())
}

async fn remove(cwd: &str, args: &Value) -> Res<Value> {
    let a: RemoveArg = parse(args)?;
    inner_path(cwd, &a.path)?;
    let commit = a.commit;
    run(cwd, commit, remove_work(cwd, &a)).await
}

async fn add(cwd: &str, args: &Value) -> Res<Value> {
    let a: AddArg = parse(args)?;
    inner_path(cwd, &a.path)?;
    let url = safe_url(&a.url)?;
    git(cwd, &["submodule", "add", "--force", "--", url, &a.path]).await?;
    sync(cwd, &a.path).await?;
    Ok(json!({ "record": null }))
}

pub async fn call(cwd: &str, name: &str, args: &Value) -> Option<Res<Value>> {
    Some(match name {
        "submoduleUpdate" => update(cwd, args).await,
        "submoduleUpdateAll" => update_all(cwd).await,
        "submoduleReset" => reset(cwd, args).await,
        "submoduleCommit" => commit(cwd, args).await,
        "submoduleSetUrl" => set_url(cwd, args).await,
        "submoduleRemove" => remove(cwd, args).await,
        "submoduleAdd" => add(cwd, args).await,
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn sh(dir: &std::path::Path, args: &[&str]) {
        let out = Command::new("git")
            .args(["-c", "protocol.file.allow=always"])
            .args(args)
            .current_dir(dir)
            .env("GIT_AUTHOR_NAME", "t")
            .env("GIT_AUTHOR_EMAIL", "t@t")
            .env("GIT_COMMITTER_NAME", "t")
            .env("GIT_COMMITTER_EMAIL", "t@t")
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "{args:?}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    fn allow_file_protocol() {
        let dir = std::env::temp_dir().join("gitneat-submodule-config");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("config");
        std::fs::write(&file, "[protocol \"file\"]\n\tallow = always\n").unwrap();
        unsafe {
            std::env::set_var("GIT_CONFIG_GLOBAL", &file);
            std::env::set_var("GIT_AUTHOR_NAME", "t");
            std::env::set_var("GIT_AUTHOR_EMAIL", "t@t");
            std::env::set_var("GIT_COMMITTER_NAME", "t");
            std::env::set_var("GIT_COMMITTER_EMAIL", "t@t");
        }
    }

    #[test]
    fn parses_gitmodules_names_with_dots() {
        let text =
            "submodule.a.b.path\nlibs/a.b\0submodule.a.b.url\nhttps://x/a.b\0submodule.c.path\nc\0";
        let list = parse_gitmodules(text);
        assert_eq!(
            list[0],
            ("a.b".into(), "libs/a.b".into(), "https://x/a.b".into())
        );
        assert_eq!(list[1], ("c".into(), "c".into(), String::new()));
    }

    #[test]
    fn parses_status_markers_and_paths() {
        let text = "-1111111111111111111111111111111111111111 libs/one\n+2222222222222222222222222222222222222222 two words (heads/main)\n 3333333333333333333333333333333333333333 three (v1)\n";
        let map = parse_status(text);
        assert_eq!(map["libs/one"], '-');
        assert_eq!(map["two words"], '+');
        assert_eq!(map["three"], ' ');
    }

    #[test]
    fn available_follows_the_source_order() {
        let base = Submodule::default();
        let uninit = Submodule {
            uninitialized: true,
            ..base.clone()
        };
        assert!(uninit.available().initialize);
        let deleted = Submodule {
            uninitialized: true,
            deleted: true,
            ..base.clone()
        };
        assert!(!deleted.available().initialize);
        let new = Submodule {
            new: true,
            dirty: true,
            ..base.clone()
        };
        assert!(new.available().commit && !new.available().reset);
        let dirty = Submodule {
            dirty: true,
            out_of_sync: true,
            ..base.clone()
        };
        assert!(dirty.available().reset && !dirty.available().commit);
        let sync = Submodule {
            out_of_sync: true,
            ..base
        };
        assert!(sync.available().reset && sync.available().commit);
    }

    #[tokio::test]
    async fn rejects_bad_paths_and_urls() {
        assert!(inner_path("/repo", "../x").is_err());
        assert!(inner_path("/repo", "-x").is_err());
        assert!(inner_path("/repo", "").is_err());
        assert!(inner_path("/repo", "libs/a").is_ok());
        assert!(safe_url("--upload-pack=x").is_err());
        assert!(safe_url("  ").is_err());
    }

    #[tokio::test]
    async fn adds_loads_updates_edits_and_removes_a_submodule() {
        allow_file_protocol();
        let root = tempfile::tempdir().unwrap();
        let lib = root.path().join("lib");
        let main = root.path().join("main");
        std::fs::create_dir_all(&lib).unwrap();
        std::fs::create_dir_all(&main).unwrap();
        sh(&lib, &["init", "-q", "-b", "main"]);
        std::fs::write(lib.join("a.txt"), "a").unwrap();
        sh(&lib, &["add", "."]);
        sh(&lib, &["commit", "-q", "-m", "lib"]);
        sh(&main, &["init", "-q", "-b", "main"]);
        std::fs::write(main.join("m.txt"), "m").unwrap();
        sh(&main, &["add", "."]);
        sh(&main, &["commit", "-q", "-m", "main"]);
        let cwd = main.to_str().unwrap();
        let url = lib.to_str().unwrap();

        add(cwd, &json!({"url": url, "path": "vendor/lib"}))
            .await
            .unwrap();
        let list = load(cwd).await;
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].path, "vendor/lib");
        assert!(list[0].new && !list[0].uninitialized && !list[0].dirty);
        assert!(list[0].available().commit);

        commit(
            cwd,
            &json!({"path": "vendor/lib", "name": "vendor/lib", "new": true, "message": "pending text\n"}),
        )
        .await
        .unwrap();
        let body = git(cwd, &["log", "-1", "--format=%B"]).await.unwrap();
        assert_eq!(body.trim(), "pending text\nAdded submodule vendor/lib");
        assert!(!load(cwd).await[0].new);

        std::fs::write(main.join("vendor/lib/a.txt"), "changed").unwrap();
        assert!(load(cwd).await[0].dirty);
        reset(cwd, &json!({"path": "vendor/lib"})).await.unwrap();
        assert!(!load(cwd).await[0].dirty);

        sh(&main, &["submodule", "deinit", "-f", "vendor/lib"]);
        assert!(load(cwd).await[0].uninitialized);
        update_all(cwd).await.unwrap();
        assert!(!load(cwd).await[0].uninitialized);

        set_url(cwd, &json!({"path": "vendor/lib", "name": "vendor/lib", "url": "https://example.com/x.git"})).await.unwrap();
        assert_eq!(load(cwd).await[0].url, "https://example.com/x.git");

        remove(
            cwd,
            &json!({"path": "vendor/lib", "name": "vendor/lib", "commit": true}),
        )
        .await
        .unwrap();
        assert!(load(cwd).await.is_empty());
        assert!(!main.join(".gitmodules").exists());
        let subject = git(cwd, &["log", "-1", "--format=%s"]).await.unwrap();
        assert_eq!(subject.trim(), "Removed submodule vendor/lib");
    }
}
