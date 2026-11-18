use super::{Res, git, parse, raw, run};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
struct Path {
    path: String,
}

#[derive(Deserialize)]
struct Ref {
    #[serde(rename = "ref")]
    name: String,
}

#[derive(Deserialize)]
struct StashEdit {
    #[serde(rename = "ref")]
    name: String,
    message: String,
}

#[derive(Deserialize)]
struct StashPaths {
    paths: Vec<String>,
    message: Option<String>,
}

#[derive(Deserialize)]
struct StashSave {
    message: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Unstage {
    path: Option<String>,
    has_head: bool,
}

#[derive(Deserialize)]
struct Discard {
    path: String,
    untracked: bool,
    conflicted: bool,
    #[serde(default)]
    staged: bool,
    #[serde(default)]
    added: bool,
    orig: Option<String>,
}

#[derive(Deserialize)]
struct Paths {
    paths: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UnstageMany {
    paths: Vec<String>,
    has_head: bool,
}

#[derive(Deserialize)]
struct DiscardMany {
    files: Vec<Discard>,
}

#[derive(Deserialize)]
struct Ignore {
    lines: Vec<String>,
    untrack: Vec<String>,
}

#[derive(Deserialize)]
struct StashFiles {
    #[serde(rename = "ref")]
    name: String,
    paths: Vec<String>,
}

#[derive(Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
enum PatchAction {
    Stage,
    Unstage,
    Discard,
    Revert,
}

impl PatchAction {
    fn flags(self) -> &'static [&'static str] {
        match self {
            PatchAction::Stage => &["apply", "--cached"],
            PatchAction::Unstage => &["apply", "--cached", "-R"],
            PatchAction::Discard => &["apply", "-R"],
            PatchAction::Revert => &["apply", "-R", "--3way"],
        }
    }
}

#[derive(Deserialize)]
struct ApplyPatch {
    patch: String,
    action: PatchAction,
}

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
enum Resolve {
    Ours,
    Theirs,
    Delete,
}

#[derive(Deserialize)]
struct ResolveFile {
    path: String,
    how: Resolve,
}

async fn init(cwd: &str, args: &Value) -> Res<Value> {
    let branch = args.get("branch").and_then(Value::as_str).unwrap_or("");
    let mut argv = vec!["init"];
    if !branch.is_empty() {
        argv.extend(["-b", branch]);
    }
    git(cwd, &argv).await.map(Value::String)
}

pub async fn call(cwd: &str, name: &str, args: &Value) -> Option<Res<Value>> {
    Some(match name {
        "init" => init(cwd, args).await,
        "stashSave" => stash_save(cwd, args).await,
        "stashPaths" => stash_paths(cwd, args).await,
        "stashApply" => stash(cwd, "apply", args).await,
        "stashPop" => stash(cwd, "pop", args).await,
        "stashDrop" => stash(cwd, "drop", args).await,
        "stashEdit" => stash_edit(cwd, args).await,
        "stageFile" => stage_file(cwd, args).await,
        "stageFiles" => stage_files(cwd, args).await,
        "unstageFiles" => unstage_files(cwd, args).await,
        "discardFiles" => discard_files(cwd, args).await,
        "ignorePaths" => ignore_paths(cwd, args).await,
        "workPatch" => work_patch(cwd, args).await,
        "stashApplyFiles" => stash_apply_files(cwd, args).await,
        "stageAll" => run(cwd, true, git(cwd, &["add", "-A"])).await,
        "unstageFile" => unstage(cwd, args).await,
        "unstageAll" => unstage(cwd, args).await,
        "discardFile" => discard_file(cwd, args).await,
        "discardAll" => discard_all(cwd).await,
        "applyPatch" => apply_patch(cwd, args).await,
        "resolveFile" => resolve_file(cwd, args).await,
        _ => return None,
    })
}

async fn stash_save(cwd: &str, args: &Value) -> Res<Value> {
    let a: StashSave = parse(args)?;
    let mut list = vec!["stash", "push", "--include-untracked"];
    if let Some(message) = a.message.as_deref().filter(|m| !m.is_empty()) {
        list.extend(["-m", message]);
    }
    run(cwd, true, git(cwd, &list)).await
}

async fn stash_paths(cwd: &str, args: &Value) -> Res<Value> {
    let a: StashPaths = parse(args)?;
    let mut list = vec!["stash", "push", "--include-untracked"];
    if let Some(message) = a.message.as_deref().filter(|m| !m.is_empty()) {
        list.extend(["-m", message]);
    }
    list.push("--");
    list.extend(a.paths.iter().map(String::as_str));
    run(cwd, true, git(cwd, &list)).await
}

async fn stash(cwd: &str, verb: &str, args: &Value) -> Res<Value> {
    let a: Ref = parse(args)?;
    run(cwd, true, git(cwd, &["stash", verb, &a.name])).await
}

async fn stash_edit(cwd: &str, args: &Value) -> Res<Value> {
    let a: StashEdit = parse(args)?;
    let index: usize = a
        .name
        .strip_prefix("stash@{")
        .and_then(|rest| rest.strip_suffix('}'))
        .and_then(|digits| digits.parse().ok())
        .ok_or_else(|| format!("Not a stash reference: {}", a.name))?;
    run(cwd, false, async {
        let sha = git(cwd, &["rev-parse", &a.name]).await?;
        git(cwd, &["stash", "store", "-m", &a.message, sha.trim()]).await?;
        git(cwd, &["stash", "drop", &format!("stash@{{{}}}", index + 1)]).await
    })
    .await
}

async fn stage_file(cwd: &str, args: &Value) -> Res<Value> {
    let a: Path = parse(args)?;
    run(cwd, true, git(cwd, &["add", "--", &a.path])).await
}

async fn unstage(cwd: &str, args: &Value) -> Res<Value> {
    let a: Unstage = parse(args)?;
    match (a.path.as_deref(), a.has_head) {
        (Some(path), true) => run(cwd, true, git(cwd, &["reset", "-q", "HEAD", "--", path])).await,
        (Some(path), false) => {
            run(cwd, true, git(cwd, &["rm", "--cached", "-q", "--", path])).await
        }
        (None, true) => run(cwd, true, git(cwd, &["reset", "-q"])).await,
        (None, false) => run(cwd, true, git(cwd, &["rm", "-r", "--cached", "-q", "."])).await,
    }
}

async fn discard_one(cwd: &str, a: &Discard) -> Res<String> {
    if a.untracked {
        return git(cwd, &["clean", "-f", "--", &a.path]).await;
    }
    if a.staged && a.added {
        return git(cwd, &["rm", "-f", "-q", "--", &a.path]).await;
    }
    if a.staged {
        if let Some(orig) = a.orig.as_deref() {
            git(cwd, &["rm", "-f", "-q", "--", &a.path]).await?;
            return git(cwd, &["checkout", "HEAD", "--", orig]).await;
        }
        return git(cwd, &["checkout", "HEAD", "--", &a.path]).await;
    }
    if a.conflicted {
        return git(cwd, &["checkout", "HEAD", "--", &a.path]).await;
    }
    git(cwd, &["checkout", "--", &a.path]).await
}

async fn discard_file(cwd: &str, args: &Value) -> Res<Value> {
    let a: Discard = parse(args)?;
    run(cwd, true, discard_one(cwd, &a)).await
}

async fn discard_files(cwd: &str, args: &Value) -> Res<Value> {
    let a: DiscardMany = parse(args)?;
    run(cwd, true, async {
        for file in &a.files {
            discard_one(cwd, file).await?;
        }
        Ok(())
    })
    .await
}

async fn stage_files(cwd: &str, args: &Value) -> Res<Value> {
    let a: Paths = parse(args)?;
    let mut list = vec!["add", "--"];
    list.extend(a.paths.iter().map(String::as_str));
    run(cwd, true, git(cwd, &list)).await
}

async fn unstage_files(cwd: &str, args: &Value) -> Res<Value> {
    let a: UnstageMany = parse(args)?;
    let mut list = if a.has_head {
        vec!["reset", "-q", "HEAD", "--"]
    } else {
        vec!["rm", "--cached", "-r", "-q", "--"]
    };
    list.extend(a.paths.iter().map(String::as_str));
    run(cwd, true, git(cwd, &list)).await
}

async fn ignore_paths(cwd: &str, args: &Value) -> Res<Value> {
    let a: Ignore = parse(args)?;
    run(cwd, true, async {
        let file = std::path::Path::new(cwd).join(".gitignore");
        let mut text = tokio::fs::read_to_string(&file).await.unwrap_or_default();
        let mut changed = false;
        for line in &a.lines {
            if !text.lines().any(|existing| existing.trim() == line) {
                if !text.is_empty() && !text.ends_with('\n') {
                    text.push('\n');
                }
                text.push_str(line);
                text.push('\n');
                changed = true;
            }
        }
        if changed {
            tokio::fs::write(&file, text).await.map_err(|e| e.to_string())?;
        }
        if !a.untrack.is_empty() {
            let mut list = vec!["rm", "--cached", "-r", "-q", "--ignore-unmatch", "--"];
            list.extend(a.untrack.iter().map(String::as_str));
            git(cwd, &list).await?;
        }
        Ok(())
    })
    .await
}

async fn work_patch(cwd: &str, args: &Value) -> Res<Value> {
    let a: Paths = parse(args)?;
    let base = match raw(cwd, &["rev-parse", "-q", "--verify", "HEAD"], None, None).await {
        done if done.code == 0 => done.stdout.trim().to_string(),
        _ => "4b825dc642cb6eb9a060e54bf8d69288fbee4904".to_string(),
    };
    let mut list = vec!["diff", "-M", base.as_str(), "--"];
    list.extend(a.paths.iter().map(String::as_str));
    let mut patch = git(cwd, &list).await?;
    let mut others = vec!["ls-files", "--others", "--exclude-standard", "-z", "--"];
    others.extend(a.paths.iter().map(String::as_str));
    for file in git(cwd, &others).await?.split('\0').filter(|f| !f.is_empty()) {
        patch.push_str(&raw(cwd, &["diff", "--no-index", "--", "/dev/null", file], None, None).await.stdout);
    }
    if patch.trim().is_empty() {
        return Err("Working directory has no changes".to_string());
    }
    Ok(Value::String(patch))
}

async fn stash_apply_files(cwd: &str, args: &Value) -> Res<Value> {
    let a: StashFiles = parse(args)?;
    run(cwd, false, async {
        let sha = git(cwd, &["rev-parse", &a.name]).await?.trim().to_string();
        let untracked = format!("{sha}^3");
        for path in &a.paths {
            let tracked = raw(cwd, &["cat-file", "-e", &format!("{sha}:{path}")], None, None).await.code == 0;
            let loose = !tracked && raw(cwd, &["cat-file", "-e", &format!("{untracked}:{path}")], None, None).await.code == 0;
            if tracked || loose {
                let source = if tracked { sha.as_str() } else { untracked.as_str() };
                git(cwd, &["restore", &format!("--source={source}"), "--worktree", "--", path]).await?;
            } else {
                let _ = tokio::fs::remove_file(std::path::Path::new(cwd).join(path)).await;
            }
        }
        Ok(())
    })
    .await
}

async fn discard_all(cwd: &str) -> Res<Value> {
    run(cwd, true, async {
        git(cwd, &["reset", "--hard"]).await?;
        git(cwd, &["clean", "-fd"]).await
    })
    .await
}

async fn apply_patch(cwd: &str, args: &Value) -> Res<Value> {
    let a: ApplyPatch = parse(args)?;
    run(cwd, false, async {
        let mut list: Vec<&str> = a.action.flags().to_vec();
        list.extend(["--recount", "--whitespace=nowarn", "-"]);
        let result = raw(cwd, &list, None, Some(a.patch.clone())).await;
        if result.code != 0 {
            let text = result.stderr.trim();
            return Err(if text.is_empty() {
                "git apply failed".to_string()
            } else {
                text.to_string()
            });
        }
        Ok(())
    })
    .await
}

async fn resolve_file(cwd: &str, args: &Value) -> Res<Value> {
    let a: ResolveFile = parse(args)?;
    run(cwd, false, async {
        let side = match a.how {
            Resolve::Delete => return git(cwd, &["rm", "-q", "--", &a.path]).await,
            Resolve::Ours => "--ours",
            Resolve::Theirs => "--theirs",
        };
        git(cwd, &["checkout", side, "--", &a.path]).await?;
        git(cwd, &["add", "--", &a.path]).await
    })
    .await
}

#[cfg(test)]
mod init_tests {
    use serde_json::json;

    fn head(dir: &std::path::Path) -> String {
        std::fs::read_to_string(dir.join(".git/HEAD")).unwrap()
    }

    #[tokio::test]
    async fn init_uses_the_given_branch_name() {
        let dir = tempfile::tempdir().unwrap();
        let cwd = dir.path().to_str().unwrap();
        super::init(cwd, &json!({"branch": "trunk"})).await.unwrap();
        assert_eq!(head(dir.path()).trim(), "ref: refs/heads/trunk");
    }

    #[tokio::test]
    async fn init_rejects_an_invalid_branch_name() {
        let dir = tempfile::tempdir().unwrap();
        let cwd = dir.path().to_str().unwrap();
        assert!(
            super::init(cwd, &json!({"branch": "bad name"}))
                .await
                .is_err()
        );
    }
}
