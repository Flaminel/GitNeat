use crate::git;
use crate::paths;
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use tauri::Window;
use tauri_plugin_dialog::{DialogExt, FilePath};
use tokio::sync::oneshot;
use tokio::task::JoinSet;

const SCAN_DEPTH: usize = 5;
const UNREACHABLE: &str = "Repo is unreachable and may have been deleted";

#[derive(Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RepoSummary {
    pub path: String,
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub remote: Option<String>,
    pub remote_url: Option<String>,
    pub changes: Option<u32>,
    pub conflicts: u32,
    pub error: Option<String>,
}

async fn git_out(cwd: &str, args: &[&str]) -> Option<String> {
    let list: Vec<String> = args.iter().map(|a| a.to_string()).collect();
    let out = git::run_git(cwd, &list, None, None).await;
    if out.code == 0 {
        Some(out.stdout)
    } else {
        None
    }
}

pub fn parse_status(text: &str, wip: bool) -> RepoSummary {
    let mut s = RepoSummary::default();
    let mut changes = 0;
    for line in text.lines() {
        if let Some(head) = line.strip_prefix("# branch.head ") {
            if head != "(detached)" {
                s.branch = Some(head.to_string());
            }
        } else if let Some(up) = line.strip_prefix("# branch.upstream ") {
            s.upstream = Some(up.to_string());
        } else if let Some(ab) = line.strip_prefix("# branch.ab ") {
            for part in ab.split(' ') {
                if let Some(n) = part.strip_prefix('+') {
                    s.ahead = n.parse().unwrap_or(0);
                } else if let Some(n) = part.strip_prefix('-') {
                    s.behind = n.parse().unwrap_or(0);
                }
            }
        } else if line.starts_with("u ") {
            s.conflicts += 1;
            changes += 1;
        } else if !line.starts_with('#') && !line.is_empty() {
            changes += 1;
        }
    }
    if wip {
        s.changes = Some(changes);
    }
    s
}

pub async fn summary(path: String, wip: bool) -> RepoSummary {
    if !Path::new(&path).is_dir() {
        return RepoSummary {
            path,
            error: Some(UNREACHABLE.into()),
            ..Default::default()
        };
    }
    let untracked = if wip { "-uall" } else { "-uno" };
    let Some(status) = git_out(&path, &["status", "--porcelain=v2", "--branch", untracked]).await
    else {
        return RepoSummary {
            path,
            error: Some("Not a git repository".into()),
            ..Default::default()
        };
    };
    let mut s = parse_status(&status, wip);
    let remotes = git_out(&path, &["remote"]).await.unwrap_or_default();
    let names: Vec<&str> = remotes.lines().filter(|l| !l.is_empty()).collect();
    let from_upstream = s
        .upstream
        .as_deref()
        .and_then(|u| names.iter().find(|n| u.starts_with(&format!("{n}/"))).copied());
    let remote = from_upstream
        .or_else(|| names.iter().find(|n| **n == "origin").copied())
        .or_else(|| names.first().copied());
    if let Some(name) = remote {
        s.remote_url = git_out(&path, &["remote", "get-url", name])
            .await
            .map(|u| u.trim().to_string());
        s.remote = Some(name.to_string());
    }
    s.path = path;
    s
}

#[tauri::command]
pub async fn repo_summaries(paths: Vec<String>, wip: bool) -> Vec<RepoSummary> {
    let mut set = JoinSet::new();
    for (i, path) in paths.into_iter().enumerate() {
        set.spawn(async move { (i, summary(path, wip).await) });
    }
    let mut out: Vec<(usize, RepoSummary)> = Vec::new();
    while let Some(Ok(item)) = set.join_next().await {
        out.push(item);
    }
    out.sort_by_key(|(i, _)| *i);
    out.into_iter().map(|(_, s)| s).collect()
}

fn is_repo(dir: &Path) -> bool {
    dir.join(".git").exists()
}

fn scan(dir: &Path, depth: usize, out: &mut Vec<String>) {
    if is_repo(dir) {
        out.push(paths::normalize(dir).to_string_lossy().into_owned());
        return;
    }
    if depth == 0 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut children: Vec<PathBuf> = entries
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .map(|e| e.path())
        .filter(|p| {
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            !name.starts_with('.') && name != "node_modules"
        })
        .collect();
    children.sort();
    for child in children {
        scan(&child, depth - 1, out);
    }
}

pub fn find(dirs: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for dir in dirs {
        scan(Path::new(dir), SCAN_DEPTH, &mut out);
    }
    out.sort();
    out.dedup();
    out
}

#[tauri::command]
pub async fn find_repos(dirs: Vec<String>) -> Vec<String> {
    tokio::task::spawn_blocking(move || find(&dirs))
        .await
        .unwrap_or_default()
}

fn to_paths(picked: Option<Vec<FilePath>>) -> Vec<String> {
    picked
        .unwrap_or_default()
        .into_iter()
        .filter_map(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

#[tauri::command]
pub async fn pick_directories(window: Window) -> Vec<String> {
    let (tx, rx) = oneshot::channel();
    window
        .dialog()
        .file()
        .set_parent(&window)
        .pick_folders(move |p| {
            let _ = tx.send(to_paths(p));
        });
    rx.await.unwrap_or_default()
}

pub fn code_workspace_folders(file: &Path, text: &str) -> Vec<String> {
    let base = file.parent().unwrap_or(Path::new(""));
    let json: Value = serde_json::from_str(text).unwrap_or(Value::Null);
    json.get("folders")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|f| f.get("path").and_then(Value::as_str))
                .map(|p| paths::normalize(&base.join(p)).to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default()
}

#[tauri::command]
pub async fn import_code_workspace(window: Window) -> Vec<String> {
    let (tx, rx) = oneshot::channel();
    window
        .dialog()
        .file()
        .set_parent(&window)
        .add_filter("Workspaces", &["code-workspace"])
        .pick_file(move |p| {
            let _ = tx.send(p.and_then(|f| f.into_path().ok()));
        });
    let Some(file) = rx.await.ok().flatten() else {
        return Vec::new();
    };
    let text = tokio::fs::read_to_string(&file).await.unwrap_or_default();
    code_workspace_folders(&file, &text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_gives_branch_upstream_and_counts() {
        let text = "# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -3\n1 .M N... 100644 100644 100644 a b f.txt\nu UU N... 1 2 3 4 a b c g.txt\n? new.txt\n";
        let s = parse_status(text, true);
        assert_eq!(s.branch.as_deref(), Some("main"));
        assert_eq!(s.upstream.as_deref(), Some("origin/main"));
        assert_eq!((s.ahead, s.behind), (2, 3));
        assert_eq!(s.changes, Some(3));
        assert_eq!(s.conflicts, 1);
        let detached = parse_status("# branch.head (detached)\n", false);
        assert_eq!(detached.branch, None);
        assert_eq!(detached.changes, None);
    }

    #[test]
    fn scan_finds_repos_and_skips_inside_them() {
        let root = tempfile::tempdir().unwrap();
        let a = root.path().join("a");
        let nested = root.path().join("group/b");
        std::fs::create_dir_all(a.join(".git")).unwrap();
        std::fs::create_dir_all(a.join("inner/.git")).unwrap();
        std::fs::create_dir_all(nested.join(".git")).unwrap();
        std::fs::create_dir_all(root.path().join(".hidden/c/.git")).unwrap();
        let found = find(&[root.path().to_string_lossy().into_owned()]);
        let names: Vec<String> = found
            .iter()
            .map(|p| Path::new(p).strip_prefix(root.path()).unwrap().to_string_lossy().replace('\\', "/"))
            .collect();
        assert_eq!(names, vec!["a", "group/b"]);
    }

    #[test]
    fn code_workspace_paths_resolve_from_the_file() {
        let file = Path::new("/w/proj.code-workspace");
        let folders = code_workspace_folders(file, r#"{"folders":[{"path":"a"},{"path":"../b"},{"name":"x"}]}"#);
        let want: Vec<String> = ["/w/a", "/b"]
            .iter()
            .map(|p| paths::normalize(Path::new(p)).to_string_lossy().into_owned())
            .collect();
        assert_eq!(folders, want);
    }

    #[tokio::test]
    async fn missing_folder_is_unreachable() {
        let s = summary("/no/such/folder/gitneat".into(), false).await;
        assert_eq!(s.error.as_deref(), Some(UNREACHABLE));
    }
}
