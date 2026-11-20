use super::{Res, git, parse};
use crate::paths;
use serde::Deserialize;
use serde_json::{Value, json};
use std::path::{Component, Path, PathBuf};

#[derive(Deserialize)]
struct Target {
    path: String,
}

const OUTSIDE: &str = "Cannot open a file outside of the repository";

fn target(cwd: &str, args: &Value) -> Res<PathBuf> {
    let a: Target = parse(args)?;
    let full = paths::resolve(cwd, &a.path);
    let root = paths::normalize(Path::new(cwd));
    let inside = paths::inside(&[cwd.to_string()], &full) && full != root;
    let in_git = full
        .strip_prefix(&root)
        .map(|rel| {
            rel.components()
                .any(|c| matches!(c, Component::Normal(n) if n == ".git"))
        })
        .unwrap_or(true);
    if a.path.trim().is_empty() || !inside || in_git {
        return Err(OUTSIDE.to_string());
    }
    Ok(full)
}

async fn create(cwd: &str, args: &Value) -> Res<Value> {
    let full = target(cwd, args)?;
    if full.exists() {
        return Err(format!("{} already exists", full.display()));
    }
    if let Some(parent) = full.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    tokio::fs::write(&full, "")
        .await
        .map_err(|e| e.to_string())?;
    Ok(json!({ "record": null }))
}

async fn delete(cwd: &str, args: &Value) -> Res<Value> {
    let full = target(cwd, args)?;
    tokio::fs::remove_file(&full)
        .await
        .map_err(|e| e.to_string())?;
    Ok(json!({ "record": null }))
}

pub async fn call(cwd: &str, name: &str, args: &Value) -> Option<Res<Value>> {
    Some(match name {
        "createFile" => create(cwd, args).await,
        "deleteFile" => delete(cwd, args).await,
        "maintenance" => git(cwd, &["maintenance", "run"])
            .await
            .map(|_| json!({ "record": null })),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    #[tokio::test]
    async fn creates_a_file_with_its_folders_and_deletes_it() {
        let dir = tempfile::tempdir().unwrap();
        let cwd = dir.path().to_str().unwrap();
        super::create(cwd, &json!({"path": "a/b/new.txt"}))
            .await
            .unwrap();
        assert!(dir.path().join("a/b/new.txt").is_file());
        assert!(
            super::create(cwd, &json!({"path": "a/b/new.txt"}))
                .await
                .is_err()
        );
        super::delete(cwd, &json!({"path": "a/b/new.txt"}))
            .await
            .unwrap();
        assert!(!dir.path().join("a/b/new.txt").exists());
    }

    #[tokio::test]
    async fn rejects_paths_outside_the_repository_and_inside_git() {
        let dir = tempfile::tempdir().unwrap();
        let cwd = dir.path().to_str().unwrap();
        for path in ["../x.txt", "/etc/x.txt", ".git/config", "", "."] {
            assert!(
                super::create(cwd, &json!({ "path": path })).await.is_err(),
                "{path}"
            );
            assert!(
                super::delete(cwd, &json!({ "path": path })).await.is_err(),
                "{path}"
            );
        }
    }

    #[tokio::test]
    async fn maintenance_runs_in_a_repository() {
        let dir = tempfile::tempdir().unwrap();
        let cwd = dir.path().to_str().unwrap();
        super::git(cwd, &["init", "-q"]).await.unwrap();
        assert!(
            super::call(cwd, "maintenance", &json!({}))
                .await
                .unwrap()
                .is_ok()
        );
    }
}
