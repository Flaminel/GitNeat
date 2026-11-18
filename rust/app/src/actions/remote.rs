use super::{Res, git, head_state, needs_confirm, parse, run, split_remote};
use serde::Deserialize;
use serde_json::Value;
use std::future::Future;

#[derive(Deserialize)]
struct CloneRepo {
    url: String,
    target: String,
}

#[derive(Deserialize)]
struct FastForward {
    name: String,
    current: bool,
    target: String,
}

#[derive(Deserialize)]
struct PullBranch {
    name: String,
    current: bool,
    upstream: Option<String>,
}

#[derive(Deserialize)]
enum PullMode {
    #[serde(rename = "ff")]
    Ff,
    #[serde(rename = "ff-only")]
    FfOnly,
    #[serde(rename = "rebase")]
    Rebase,
    #[serde(rename = "fetch")]
    Fetch,
}

#[derive(Deserialize)]
struct Pull {
    mode: PullMode,
}

#[derive(Deserialize)]
struct Answer {
    remote: String,
    branch: String,
}

#[derive(Deserialize)]
struct Push {
    name: String,
    remote: Option<String>,
    upstream: Option<String>,
    answer: Option<Answer>,
    force: bool,
    #[serde(default)]
    hard: bool,
}

#[derive(Deserialize)]
struct PushTo {
    local: String,
    remote: String,
    branch: String,
}

#[derive(Deserialize)]
struct SetUpstream {
    up: String,
    name: String,
}

#[derive(Deserialize)]
struct PushTag {
    tag: String,
    remote: String,
}

#[derive(Deserialize)]
struct AddRemote {
    name: String,
    url: String,
}

#[derive(Deserialize)]
struct Name {
    name: String,
}

pub async fn call(cwd: &str, name: &str, args: &Value) -> Option<Res<Value>> {
    Some(match name {
        "clone" => clone(cwd, args).await,
        "fastForward" => fast_forward(cwd, args).await,
        "pullBranch" => pull_branch(cwd, args).await,
        "pull" => pull(cwd, args).await,
        "push" => push(cwd, args).await,
        "pushTo" => push_to(cwd, args).await,
        "setUpstream" => set_upstream(cwd, args).await,
        "pushTag" => push_tag(cwd, args).await,
        "addRemote" => add_remote(cwd, args).await,
        "editRemote" => edit_remote(cwd, args).await,
        "removeRemote" => remove_remote(cwd, args).await,
        "fetchRemote" => fetch_remote(cwd, args).await,
        _ => return None,
    })
}

async fn fast_forward(cwd: &str, args: &Value) -> Res<Value> {
    let a: FastForward = parse(args)?;
    if a.current {
        return run(cwd, true, git(cwd, &["merge", "--ff-only", &a.target])).await;
    }
    let spec = format!("{}:refs/heads/{}", a.target, a.name);
    run(cwd, true, git(cwd, &["fetch", ".", &spec])).await
}

async fn pulled(cwd: &str, work: impl Future<Output = Res<String>>) -> Res<Value> {
    let before = head_state(cwd).await;
    let mut done = run(cwd, true, work).await?;
    let after = head_state(cwd).await;
    done["notice"] = Value::from(if before.head == after.head {
        "Already up to date"
    } else {
        "Pulled successfully"
    });
    Ok(done)
}

async fn pull_branch(cwd: &str, args: &Value) -> Res<Value> {
    let a: PullBranch = parse(args)?;
    if a.current {
        return pulled(cwd, git(cwd, &["pull", "--ff"])).await;
    }
    let Some(upstream) = a.upstream.as_deref().filter(|u| !u.is_empty()) else {
        return Err(format!("{} has no upstream.", a.name));
    };
    let (remote, rest) = split_remote(upstream);
    let spec = format!("{rest}:refs/heads/{}", a.name);
    run(cwd, true, git(cwd, &["fetch", remote, &spec])).await
}

async fn pull(cwd: &str, args: &Value) -> Res<Value> {
    let a: Pull = parse(args)?;
    match a.mode {
        PullMode::Fetch => run(cwd, true, git(cwd, &["fetch", "--all", "--prune"])).await,
        PullMode::Rebase => pulled(cwd, git(cwd, &["pull", "--rebase", "--autostash"])).await,
        PullMode::Ff => pulled(cwd, git(cwd, &["pull", "--ff"])).await,
        PullMode::FfOnly => pulled(cwd, git(cwd, &["pull", "--ff-only"])).await,
    }
}

fn rejected(error: &str) -> bool {
    ["rejected", "non-fast-forward", "fetch first"]
        .iter()
        .any(|m| error.contains(m))
}

fn remote_changed(error: &str) -> bool {
    ["stale info", "fetch first"].iter().any(|m| error.contains(m))
}

async fn push(cwd: &str, args: &Value) -> Res<Value> {
    let a: Push = parse(args)?;
    let list: Vec<String> = if let Some(remote) = a.remote.as_deref().filter(|r| !r.is_empty()) {
        vec!["push".into(), remote.into(), a.name.clone()]
    } else if let Some(upstream) = a.upstream.as_deref().filter(|u| !u.is_empty()) {
        let (up, rest) = split_remote(upstream);
        vec!["push".into(), up.into(), format!("{}:{rest}", a.name)]
    } else if let Some(answer) = &a.answer {
        vec![
            "push".into(),
            "-u".into(),
            answer.remote.clone(),
            format!("{}:{}", a.name, answer.branch),
        ]
    } else {
        return Err("Push needs a remote.".into());
    };
    let plain: Vec<&str> = list.iter().map(String::as_str).collect();
    let mut forced = vec![plain[0], "--force-with-lease"];
    forced.extend(&plain[1..]);
    let mut hard = vec![plain[0], "--force"];
    hard.extend(&plain[1..]);
    run(cwd, true, async {
        if a.hard {
            return git(cwd, &hard).await;
        }
        let result = git(cwd, if a.force { &forced } else { &plain }).await;
        match result {
            Err(error) if remote_changed(&error) => Err(needs_confirm("push-remote-changed", &error)),
            Err(error) if !a.force && rejected(&error) => Err(needs_confirm("push-behind", &error)),
            other => other,
        }
    })
    .await
}

async fn push_to(cwd: &str, args: &Value) -> Res<Value> {
    let a: PushTo = parse(args)?;
    let spec = format!("{}:{}", a.local, a.branch);
    run(cwd, true, git(cwd, &["push", &a.remote, &spec])).await
}

async fn set_upstream(cwd: &str, args: &Value) -> Res<Value> {
    let a: SetUpstream = parse(args)?;
    let flag = format!("--set-upstream-to={}", a.up);
    run(cwd, true, git(cwd, &["branch", &flag, &a.name])).await
}

async fn push_tag(cwd: &str, args: &Value) -> Res<Value> {
    let a: PushTag = parse(args)?;
    let tag = format!("refs/tags/{}", a.tag);
    run(cwd, true, git(cwd, &["push", &a.remote, &tag])).await
}

async fn add_remote(cwd: &str, args: &Value) -> Res<Value> {
    let a: AddRemote = parse(args)?;
    run(cwd, true, async {
        git(cwd, &["remote", "add", &a.name, &a.url]).await?;
        git(cwd, &["fetch", &a.name]).await
    })
    .await
}

async fn edit_remote(cwd: &str, args: &Value) -> Res<Value> {
    let a: AddRemote = parse(args)?;
    run(cwd, true, git(cwd, &["remote", "set-url", &a.name, &a.url])).await
}

async fn remove_remote(cwd: &str, args: &Value) -> Res<Value> {
    let a: Name = parse(args)?;
    run(cwd, true, git(cwd, &["remote", "remove", &a.name])).await
}

async fn fetch_remote(cwd: &str, args: &Value) -> Res<Value> {
    let a: Name = parse(args)?;
    run(cwd, true, git(cwd, &["fetch", "--prune", &a.name])).await
}

async fn clone(cwd: &str, args: &Value) -> Res<Value> {
    let a: CloneRepo = parse(args)?;
    git(cwd, &["clone", "--", &a.url, &a.target])
        .await
        .map(Value::String)
}
