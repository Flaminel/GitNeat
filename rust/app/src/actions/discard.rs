use super::{Res, env, git, git_env, head_state, raw};
use serde::Deserialize;
use serde_json::{Value, json};
use std::future::Future;
use std::path::Path;

const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

#[derive(Deserialize)]
pub struct Discarded {
    sha: String,
    paths: Vec<String>,
}

async fn exists(cwd: &str, spec: &str) -> bool {
    raw(cwd, &["cat-file", "-e", spec], None, None).await.code == 0
}

async fn remove(cwd: &str, path: &str) {
    let _ = tokio::fs::remove_file(Path::new(cwd).join(path)).await;
}

async fn snapshot(cwd: &str, paths: &[String]) -> Res<Option<Discarded>> {
    let index = git(cwd, &["rev-parse", "--absolute-git-dir"]).await?;
    let index = Path::new(index.trim()).join("gitneat-snapshot-index");
    let index = index.to_string_lossy().into_owned();
    let vars = [
        ("GIT_INDEX_FILE", index.as_str()),
        ("GIT_AUTHOR_NAME", "GitNeat"),
        ("GIT_AUTHOR_EMAIL", "gitneat@localhost"),
        ("GIT_COMMITTER_NAME", "GitNeat"),
        ("GIT_COMMITTER_EMAIL", "gitneat@localhost"),
    ];
    let head = raw(cwd, &["rev-parse", "-q", "--verify", "HEAD"], None, None).await;
    let parent = (head.code == 0).then(|| head.stdout.trim().to_string());
    let result = async {
        let mut base = EMPTY_TREE.to_string();
        if let Some(parent) = &parent {
            git_env(cwd, &["read-tree", parent], env(&vars)).await?;
            base = git(cwd, &["rev-parse", &format!("{parent}^{{tree}}")])
                .await?
                .trim()
                .to_string();
        }
        let mut add = vec!["add", "-A", "--"];
        if paths.is_empty() {
            add.push(".");
        }
        add.extend(paths.iter().map(String::as_str));
        git_env(cwd, &add, env(&vars)).await?;
        let tree = git_env(cwd, &["write-tree"], env(&vars))
            .await?
            .trim()
            .to_string();
        if tree == base {
            return Ok(None);
        }
        let mut commit = vec!["commit-tree", tree.as_str(), "-m", "GitNeat discarded changes"];
        if let Some(parent) = &parent {
            commit.extend(["-p", parent.as_str()]);
        }
        let sha = git_env(cwd, &commit, env(&vars)).await?.trim().to_string();
        let names = git(
            cwd,
            &["diff-tree", "-r", "--name-only", "--no-renames", "-z", &base, &tree],
        )
        .await?;
        let paths = names
            .split('\0')
            .filter(|p| !p.is_empty())
            .map(String::from)
            .collect();
        Ok(Some(Discarded { sha, paths }))
    }
    .await;
    let _ = tokio::fs::remove_file(&index).await;
    result
}

pub async fn recorded(
    cwd: &str,
    paths: &[String],
    work: impl Future<Output = Res<()>>,
) -> Res<Value> {
    let saved = snapshot(cwd, paths).await.ok().flatten();
    work.await?;
    let record = match saved {
        Some(d) => {
            let head = head_state(cwd).await;
            json!({ "before": head, "after": head, "discard": { "sha": d.sha, "paths": d.paths } })
        }
        None => Value::Null,
    };
    Ok(json!({ "record": record }))
}

async fn changed(cwd: &str, paths: &[String]) -> Res<Vec<String>> {
    let mut list = vec!["status", "--porcelain=v1", "-z", "--untracked-files=all", "--"];
    list.extend(paths.iter().map(String::as_str));
    let out = git(cwd, &list).await?;
    let mut names = Vec::new();
    let mut parts = out.split('\0').filter(|p| !p.is_empty());
    while let Some(entry) = parts.next() {
        if entry.len() > 3 {
            names.push(entry[3..].to_string());
        }
        if entry.starts_with('R') || entry.starts_with('C') {
            parts.next();
        }
    }
    Ok(names)
}

pub async fn undo(cwd: &str, d: &Discarded) -> Res<Value> {
    let dirty = changed(cwd, &d.paths).await?;
    if !dirty.is_empty() {
        let mut list = vec![
            "stash",
            "push",
            "--include-untracked",
            "-m",
            "Auto stash before Undo Discard changes",
            "--",
        ];
        list.extend(dirty.iter().map(String::as_str));
        git(cwd, &list).await?;
    }
    for path in &d.paths {
        if exists(cwd, &format!("{}:{path}", d.sha)).await {
            let source = format!("--source={}", d.sha);
            git(cwd, &["restore", &source, "--staged", "--worktree", "--", path]).await?;
        } else {
            git(cwd, &["rm", "-f", "-q", "--ignore-unmatch", "--", path]).await?;
            remove(cwd, path).await;
        }
    }
    Ok(Value::Null)
}

pub async fn redo(cwd: &str, d: &Discarded) -> Res<Value> {
    for path in &d.paths {
        if exists(cwd, &format!("HEAD:{path}")).await {
            git(cwd, &["restore", "--source=HEAD", "--staged", "--worktree", "--", path]).await?;
        } else {
            git(cwd, &["rm", "-f", "-q", "--ignore-unmatch", "--", path]).await?;
            remove(cwd, path).await;
        }
    }
    Ok(Value::Null)
}
