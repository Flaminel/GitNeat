use super::{Res, parse, raw};
use crate::loaders::EMPTY_TREE;
use serde::Deserialize;
use serde_json::{Value, json};

#[cfg(windows)]
const NULL_DEVICE: &str = "NUL";
#[cfg(not(windows))]
const NULL_DEVICE: &str = "/dev/null";

#[derive(Deserialize)]
struct DiffTool {
    path: String,
    sha: Option<String>,
    parent: Option<String>,
    base: Option<String>,
    #[serde(default)]
    staged: bool,
    #[serde(default)]
    untracked: bool,
}

#[derive(Deserialize)]
struct MergeTool {
    path: String,
}

pub async fn call(cwd: &str, name: &str, args: &Value) -> Option<Res<Value>> {
    Some(match name {
        "openDiffTool" => open_diff_tool(cwd, args).await,
        "openMergeTool" => open_merge_tool(cwd, args).await,
        _ => return None,
    })
}

pub async fn configured(cwd: &str, key: &str) -> bool {
    let out = raw(cwd, &["config", "--get", key], None, None).await;
    out.code == 0 && !out.stdout.trim().is_empty()
}

pub async fn diff_tool_configured(cwd: &str) -> bool {
    configured(cwd, "diff.tool").await || configured(cwd, "merge.tool").await
}

async fn parent_of(cwd: &str, sha: &str) -> String {
    let out = raw(
        cwd,
        &["rev-parse", "--verify", "-q", &format!("{sha}^")],
        None,
        None,
    )
    .await;
    if out.code == 0 && !out.stdout.trim().is_empty() {
        format!("{sha}^")
    } else {
        EMPTY_TREE.to_string()
    }
}

async fn run_tool(cwd: &str, list: &[&str], diff_exit: bool) -> Res<Value> {
    let out = raw(cwd, list, None, None).await;
    let differs = diff_exit && out.code == 1 && out.stderr.starts_with("Command failed: git");
    if out.code != 0 && !differs {
        let text = if out.stderr.trim().is_empty() {
            out.stdout.trim()
        } else {
            out.stderr.trim()
        };
        return Err(text.to_string());
    }
    Ok(json!({ "record": Value::Null }))
}

async fn open_diff_tool(cwd: &str, args: &Value) -> Res<Value> {
    let a: DiffTool = parse(args)?;
    if !diff_tool_configured(cwd).await {
        return Err("There is no diff tool configured in your settings".into());
    }
    if a.untracked {
        return run_tool(
            cwd,
            &["difftool", "-y", "--no-index", "--", NULL_DEVICE, &a.path],
            true,
        )
        .await;
    }
    if a.staged {
        return run_tool(cwd, &["difftool", "-y", "--cached", "--", &a.path], false).await;
    }
    if let Some(base) = a.base.as_deref() {
        return run_tool(cwd, &["difftool", "-y", base, "--", &a.path], false).await;
    }
    let Some(sha) = a.sha.as_deref() else {
        return run_tool(cwd, &["difftool", "-y", "--", &a.path], false).await;
    };
    let base = match a.parent.as_deref() {
        Some("") => EMPTY_TREE.to_string(),
        Some(parent) => parent.to_string(),
        None => parent_of(cwd, sha).await,
    };
    run_tool(cwd, &["difftool", "-y", &base, sha, "--", &a.path], false).await
}

async fn open_merge_tool(cwd: &str, args: &Value) -> Res<Value> {
    let a: MergeTool = parse(args)?;
    if !configured(cwd, "merge.tool").await {
        return Err("There is no merge tool configured in your settings".into());
    }
    run_tool(cwd, &["mergetool", "-y", "--", &a.path], false).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::process::Command;

    fn git(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .args(args)
            .current_dir(dir)
            .status()
            .unwrap();
        assert!(status.success(), "git {args:?}");
    }

    fn repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        git(p, &["init", "-q", "-b", "main"]);
        git(p, &["config", "user.email", "t@example.com"]);
        git(p, &["config", "user.name", "T"]);
        std::fs::write(p.join("a.txt"), "one\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-q", "-m", "first"]);
        dir
    }

    fn fake_tool(dir: &Path, kind: &str) -> std::path::PathBuf {
        let log = dir.join("tool.log");
        git(dir, &["config", &format!("{kind}.tool"), "fake"]);
        let cmd = if kind == "diff" {
            "echo \"$LOCAL|$REMOTE\" >> tool.log"
        } else {
            "echo merged >> tool.log; cp \"$LOCAL\" \"$MERGED\""
        };
        git(dir, &["config", &format!("{kind}tool.fake.cmd"), cmd]);
        git(dir, &["config", "mergetool.keepBackup", "false"]);
        git(dir, &["config", "mergetool.fake.trustExitCode", "true"]);
        log
    }

    #[tokio::test]
    async fn diff_tool_needs_a_configured_tool() {
        let dir = repo();
        let cwd = dir.path().to_str().unwrap();
        let result = open_diff_tool(cwd, &json!({ "path": "a.txt" })).await;
        assert_eq!(
            result,
            Err("There is no diff tool configured in your settings".to_string())
        );
        assert!(!diff_tool_configured(cwd).await);
    }

    #[tokio::test]
    async fn diff_tool_opens_working_tree_staged_commit_and_untracked() {
        let dir = repo();
        let cwd = dir.path().to_str().unwrap();
        let log = fake_tool(dir.path(), "diff");
        assert!(diff_tool_configured(cwd).await);
        std::fs::write(dir.path().join("a.txt"), "two\n").unwrap();
        open_diff_tool(cwd, &json!({ "path": "a.txt" }))
            .await
            .unwrap();
        git(dir.path(), &["add", "a.txt"]);
        open_diff_tool(cwd, &json!({ "path": "a.txt", "staged": true }))
            .await
            .unwrap();
        git(dir.path(), &["commit", "-q", "-m", "second"]);
        let head = String::from_utf8(
            Command::new("git")
                .args(["rev-parse", "HEAD"])
                .current_dir(dir.path())
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap();
        open_diff_tool(cwd, &json!({ "path": "a.txt", "sha": head.trim() }))
            .await
            .unwrap();
        std::fs::write(dir.path().join("new.txt"), "x\n").unwrap();
        open_diff_tool(cwd, &json!({ "path": "new.txt", "untracked": true }))
            .await
            .unwrap();
        let text = std::fs::read_to_string(log).unwrap();
        assert_eq!(text.lines().count(), 4, "{text}");
    }

    #[tokio::test]
    async fn diff_tool_opens_the_root_commit_against_the_empty_tree() {
        let dir = repo();
        let cwd = dir.path().to_str().unwrap();
        let log = fake_tool(dir.path(), "diff");
        let head = String::from_utf8(
            Command::new("git")
                .args(["rev-parse", "HEAD"])
                .current_dir(dir.path())
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap();
        open_diff_tool(cwd, &json!({ "path": "a.txt", "sha": head.trim() }))
            .await
            .unwrap();
        assert_eq!(std::fs::read_to_string(log).unwrap().lines().count(), 1);
    }

    #[tokio::test]
    async fn merge_tool_resolves_a_conflict() {
        let dir = repo();
        let p = dir.path();
        let cwd = p.to_str().unwrap();
        assert_eq!(
            open_merge_tool(cwd, &json!({ "path": "a.txt" })).await,
            Err("There is no merge tool configured in your settings".to_string())
        );
        git(p, &["checkout", "-q", "-b", "other"]);
        std::fs::write(p.join("a.txt"), "other\n").unwrap();
        git(p, &["commit", "-q", "-am", "other"]);
        git(p, &["checkout", "-q", "main"]);
        std::fs::write(p.join("a.txt"), "main\n").unwrap();
        git(p, &["commit", "-q", "-am", "main"]);
        let merge = Command::new("git")
            .args(["merge", "other"])
            .current_dir(p)
            .output()
            .unwrap();
        assert!(!merge.status.success());
        let log = fake_tool(p, "merge");
        open_merge_tool(cwd, &json!({ "path": "a.txt" }))
            .await
            .unwrap();
        assert_eq!(std::fs::read_to_string(log).unwrap().trim(), "merged");
        let status = Command::new("git")
            .args(["status", "--porcelain"])
            .current_dir(p)
            .output()
            .unwrap();
        let text = String::from_utf8(status.stdout).unwrap();
        assert!(!text.contains("UU") && !text.contains("AA"), "{text}");
        assert_eq!(std::fs::read_to_string(p.join("a.txt")).unwrap(), "main\n");
    }
}
