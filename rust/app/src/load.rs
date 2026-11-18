use crate::git::{GitResult, run_git};
use crate::load_gix::load_repo_gix;
use graph::port::{GraphCommit, GraphRow, layout};
use repo::js::is_undefined;
use repo::port::{
    Commit, insert_stashes, parse_remotes, parse_stashes, parse_worktrees, read_log, read_refs,
    read_status,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

const FS: &str = "\x1f";
const RS: &str = "\x1e";
const WIP: &str = "WIP";

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum Operation {
    Rebase,
    Merge,
    CherryPick,
    Revert,
}

#[derive(Serialize, Debug)]
pub struct RepoData {
    pub cwd: String,
    pub name: String,
    pub head: Option<String>,
    pub branch: Option<String>,
    pub commits: Vec<Value>,
    pub refs: Vec<Value>,
    pub stashes: Vec<Value>,
    pub worktrees: Vec<Value>,
    pub remotes: Vec<Value>,
    pub submodules: Vec<String>,
    pub status: Vec<Value>,
    pub operation: Option<Operation>,
    pub rows: Vec<GraphRow>,
}

fn git<'a>(
    cwd: &'a str,
    args: &[&str],
    input: Option<String>,
) -> impl Future<Output = GitResult> + use<'a> {
    let args: Vec<String> = args.iter().map(|a| a.to_string()).collect();
    async move { run_git(cwd, &args, None, input).await }
}

fn try_git<'a>(
    cwd: &'a str,
    args: &[&str],
    input: Option<String>,
) -> impl Future<Output = String> + use<'a> {
    let run = git(cwd, args, input);
    async move {
        let result = run.await;
        if result.code == 0 {
            result.stdout
        } else {
            String::new()
        }
    }
}

fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

pub(crate) fn js_trim(text: &str) -> &str {
    text.trim_matches(is_js_space)
}

pub(crate) fn non_blank(text: &str) -> Option<String> {
    let trimmed = text.trim_matches(is_js_space);
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn clean(value: Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.into_iter()
                .filter(|(_, v)| !is_undefined(v))
                .map(|(k, v)| (k, clean(v)))
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.into_iter().map(clean).collect()),
        other => other,
    }
}

pub(crate) fn value<T: Serialize>(item: &T) -> Value {
    clean(serde_json::to_value(item).unwrap_or(Value::Null))
}

pub(crate) fn values<T: Serialize>(items: &[T]) -> Vec<Value> {
    items.iter().map(value).collect()
}

pub(crate) fn graph_rows(commits: &[Commit], head: Option<&str>, dirty: bool) -> Vec<GraphRow> {
    let mut list: Vec<GraphCommit> = Vec::with_capacity(commits.len() + 1);
    if dirty {
        list.push(GraphCommit {
            sha: WIP.to_string(),
            parents: head.map(String::from).into_iter().collect(),
        });
    }
    list.extend(commits.iter().map(|c| GraphCommit {
        sha: c.sha.clone(),
        parents: c.parents.clone(),
    }));
    layout(&list)
}

fn log_format() -> String {
    format!("--format=%H{FS}%P{FS}%an{FS}%ae{FS}%at{FS}%s{FS}%B{RS}")
}

async fn stash_times(cwd: &str, shas: &[&str]) -> HashMap<String, Commit> {
    let mut map = HashMap::new();
    if shas.is_empty() {
        return map;
    }
    let format = log_format();
    let mut args = vec!["show", "-s", format.as_str()];
    args.extend(shas);
    for commit in read_log(&try_git(cwd, &args, None).await) {
        map.insert(commit.sha.clone(), commit);
    }
    map
}

async fn detect_operation(cwd: &str) -> Option<Operation> {
    let checks = [
        ("REBASE_HEAD", Operation::Rebase),
        ("MERGE_HEAD", Operation::Merge),
        ("CHERRY_PICK_HEAD", Operation::CherryPick),
        ("REVERT_HEAD", Operation::Revert),
    ];
    let probe = |name: &str| git(cwd, &["rev-parse", "-q", "--verify", name], None);
    let results = tokio::join!(
        probe(checks[0].0),
        probe(checks[1].0),
        probe(checks[2].0),
        probe(checks[3].0)
    );
    let codes = [
        results.0.code,
        results.1.code,
        results.2.code,
        results.3.code,
    ];
    if let Some(hit) = codes.iter().position(|c| *c == 0) {
        return Some(checks[hit].1);
    }
    let status = git(cwd, &["status", "--no-ahead-behind"], None).await;
    let rebasing = [
        "rebase in progress",
        "You are currently rebasing",
        "You are currently editing a commit while rebasing",
    ]
    .iter()
    .any(|needle| status.stdout.contains(needle));
    rebasing.then_some(Operation::Rebase)
}

pub async fn load_repo(cwd: &str, hidden: &[String], solo: &[String], limit: u32) -> RepoData {
    if std::env::var("GITNEAT_BACKEND").as_deref() != Ok("cli") {
        let (dir, hide, only) = (cwd.to_string(), hidden.to_vec(), solo.to_vec());
        let job = tokio::task::spawn_blocking(move || load_repo_gix(&dir, &hide, &only, limit));
        if let Ok(Ok(data)) = job.await {
            return data;
        }
    }
    load_repo_cli(cwd, hidden, solo, limit).await
}

pub async fn load_repo_cli(cwd: &str, hidden: &[String], solo: &[String], limit: u32) -> RepoData {
    let ref_format = format!(
        "--format=%(refname){FS}%(objectname){FS}%(*objectname){FS}%(upstream:short){FS}%(upstream:track,nobracket){FS}%(HEAD){FS}%(worktreepath)"
    );
    let stash_format = format!("--format=%H{FS}%gd{FS}%P{FS}%gs");
    let (ref_out, head_out, branch_out, stash_out, wt_out, remote_out, status_out, sub_out) = tokio::join!(
        try_git(
            cwd,
            &[
                "for-each-ref",
                &ref_format,
                "refs/heads",
                "refs/remotes",
                "refs/tags",
            ],
            None
        ),
        try_git(cwd, &["rev-parse", "--verify", "-q", "HEAD"], None),
        try_git(cwd, &["symbolic-ref", "-q", "--short", "HEAD"], None),
        try_git(cwd, &["stash", "list", &stash_format], None),
        try_git(cwd, &["worktree", "list", "--porcelain"], None),
        try_git(cwd, &["remote", "-v"], None),
        try_git(
            cwd,
            &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
            None
        ),
        try_git(
            cwd,
            &[
                "config",
                "-f",
                ".gitmodules",
                "--get-regexp",
                r"^submodule\..*\.path$"
            ],
            None
        ),
    );

    let refs = read_refs(&ref_out);
    let head = non_blank(&head_out);
    let stashes = parse_stashes(&stash_out).unwrap_or_default();

    let mut revs: Vec<String> = if !solo.is_empty() {
        refs.iter()
            .filter(|r| solo.contains(&r.full))
            .map(|r| r.full.clone())
            .collect()
    } else if !hidden.is_empty() {
        refs.iter()
            .filter(|r| !hidden.contains(&r.full))
            .map(|r| r.full.clone())
            .collect()
    } else {
        ["--branches", "--remotes", "--tags"]
            .map(String::from)
            .to_vec()
    };
    if head.is_some() {
        revs.push("HEAD".to_string());
    }

    let log_out = if revs.is_empty() {
        String::new()
    } else {
        let limit_arg = format!("-n{limit}");
        let format = log_format();
        let mut args = vec!["log", "--date-order", limit_arg.as_str(), format.as_str()];
        args.extend(
            revs.iter()
                .filter(|r| r.starts_with("--"))
                .map(|r| r.as_str()),
        );
        args.extend(["--stdin", "--"]);
        let stdin = revs
            .iter()
            .filter(|r| !r.starts_with("--"))
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
            + "\n";
        try_git(cwd, &args, Some(stdin)).await
    };
    let mut commits = read_log(&log_out);
    let shas: Vec<&str> = stashes.iter().map(|s| s.sha.as_str()).collect();
    let details = stash_times(cwd, &shas).await;
    insert_stashes(&mut commits, &stashes, &details);

    let submodules = sub_out
        .split('\n')
        .filter(|l| !l.is_empty())
        .map(|l| l.split(' ').skip(1).collect::<Vec<_>>().join(" "))
        .collect();

    let status = read_status(&status_out);
    let rows = graph_rows(&commits, head.as_deref(), !status.is_empty());
    RepoData {
        cwd: cwd.to_string(),
        name: cwd.rsplit(['/', '\\']).next().unwrap_or(cwd).to_string(),
        head,
        branch: non_blank(&branch_out),
        commits: values(&commits),
        refs: values(&refs),
        stashes: values(&stashes),
        worktrees: values(&parse_worktrees(&wt_out)),
        remotes: values(&parse_remotes(&remote_out)),
        submodules,
        status: values(&status),
        operation: detect_operation(cwd).await,
        rows,
    }
}
