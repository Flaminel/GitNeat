use super::{HeadState, Res, env, git, git_env, head_state, parse, raw, run};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Deserialize)]
struct Name {
    name: String,
}

#[derive(Deserialize)]
struct Sha {
    sha: String,
}

#[derive(Deserialize)]
struct Pick {
    sha: String,
    parents: usize,
}

#[derive(Deserialize)]
struct Shas {
    shas: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Merge {
    name: String,
    no_ff: bool,
}

#[derive(Deserialize)]
struct Commit {
    message: String,
    amend: bool,
}

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "kebab-case")]
pub enum Operation {
    Merge,
    Rebase,
    CherryPick,
    Revert,
}

impl Operation {
    pub fn word(self) -> &'static str {
        match self {
            Operation::Merge => "merge",
            Operation::Rebase => "rebase",
            Operation::CherryPick => "cherry-pick",
            Operation::Revert => "revert",
        }
    }
}

#[derive(Deserialize)]
struct Op {
    op: Operation,
}

#[derive(Deserialize)]
struct UndoEntry {
    label: String,
    before: HeadState,
    after: HeadState,
}

#[derive(Deserialize)]
struct Entry {
    entry: UndoEntry,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RangeInfo {
    ancestor: bool,
    is_head: bool,
    children: u64,
    has_merges: bool,
    descendant: bool,
}

pub async fn call(cwd: &str, name: &str, args: &Value) -> Option<Res<Value>> {
    Some(match name {
        "headState" => Ok(json!(head_state(cwd).await)),
        "rangeInfo" => range_info(cwd, args).await,
        "undo" => undo(cwd, args).await,
        "redo" => redo(cwd, args).await,
        "cherryPick" => cherry_pick(cwd, args).await,
        "revert" => revert(cwd, args).await,
        "cherryPickMany" => cherry_pick_many(cwd, args).await,
        "merge" => merge(cwd, args).await,
        "rebaseOnto" => rebase_onto(cwd, args).await,
        "commit" => commit(cwd, args).await,
        "continueOperation" => continue_operation(cwd, args).await,
        "abortOperation" => abort_operation(cwd, args).await,
        _ => return None,
    })
}

async fn move_to(cwd: &str, from: &HeadState, to: &HeadState, soft: bool) -> Res<Value> {
    let now = head_state(cwd).await;
    if now != *from {
        return Err("The repository changed since this action. GitNeat cannot undo it.".into());
    }
    let target = to.head.as_deref().unwrap_or_default();
    if from.branch != to.branch {
        match to.branch.as_deref() {
            Some(branch) => git(cwd, &["switch", branch]).await?,
            None => git(cwd, &["switch", "--detach", target]).await?,
        };
        return Ok(Value::Null);
    }
    let mode = if soft { "--soft" } else { "--keep" };
    git(cwd, &["reset", mode, target]).await?;
    Ok(Value::Null)
}

async fn undo(cwd: &str, args: &Value) -> Res<Value> {
    let a: Entry = parse(args)?;
    let e = a.entry;
    move_to(cwd, &e.after, &e.before, e.label == "Commit").await
}

async fn redo(cwd: &str, args: &Value) -> Res<Value> {
    let a: Entry = parse(args)?;
    let e = a.entry;
    move_to(cwd, &e.before, &e.after, e.label == "Commit").await
}

fn number(out: &str) -> u64 {
    out.trim().parse().unwrap_or(0)
}

async fn range_info(cwd: &str, args: &Value) -> Res<Value> {
    let a: Sha = parse(args)?;
    let anc = raw(
        cwd,
        &["merge-base", "--is-ancestor", &a.sha, "HEAD"],
        None,
        None,
    )
    .await;
    let head = raw(cwd, &["rev-parse", "-q", "--verify", "HEAD"], None, None)
        .await
        .stdout
        .trim()
        .to_string();
    if anc.code != 0 {
        let descendant = !head.is_empty()
            && raw(
                cwd,
                &["merge-base", "--is-ancestor", "HEAD", &a.sha],
                None,
                None,
            )
            .await
            .code
                == 0;
        return Ok(json!(RangeInfo {
            ancestor: false,
            is_head: false,
            children: 0,
            has_merges: false,
            descendant,
        }));
    }
    let range = format!("{}..HEAD", a.sha);
    let parent_range = format!("{}~1..HEAD", a.sha);
    let count = git(cwd, &["rev-list", "--count", &range]).await?;
    let merges = match git(cwd, &["rev-list", "--count", "--merges", &parent_range]).await {
        Ok(out) => out,
        Err(_) => git(cwd, &["rev-list", "--count", "--merges", "HEAD"]).await?,
    };
    Ok(json!(RangeInfo {
        ancestor: true,
        is_head: head == a.sha,
        children: number(&count),
        has_merges: number(&merges) > 0,
        descendant: head == a.sha,
    }))
}

async fn cherry_pick(cwd: &str, args: &Value) -> Res<Value> {
    let a: Pick = parse(args)?;
    if a.parents > 1 {
        return run(cwd, true, git(cwd, &["cherry-pick", "-m", "1", &a.sha])).await;
    }
    let result = run(cwd, true, git(cwd, &["cherry-pick", &a.sha])).await;
    match result {
        Err(error) if error.contains("now empty") => {
            git(cwd, &["cherry-pick", "--abort"]).await?;
            Ok(
                json!({ "record": Value::Null, "notice": "The cherry pick changed nothing: the commit is already applied." }),
            )
        }
        other => other,
    }
}

async fn revert(cwd: &str, args: &Value) -> Res<Value> {
    let a: Pick = parse(args)?;
    let mut list = vec!["revert", "--no-edit"];
    if a.parents > 1 {
        list.extend(["-m", "1"]);
    }
    list.push(&a.sha);
    run(cwd, true, git(cwd, &list)).await
}

async fn cherry_pick_many(cwd: &str, args: &Value) -> Res<Value> {
    let a: Shas = parse(args)?;
    let mut list = vec!["cherry-pick"];
    list.extend(a.shas.iter().rev().map(String::as_str));
    run(cwd, true, git(cwd, &list)).await
}

async fn merge(cwd: &str, args: &Value) -> Res<Value> {
    let a: Merge = parse(args)?;
    let mut list = vec!["merge"];
    if a.no_ff {
        list.push("--no-ff");
    }
    list.extend(["--no-edit", &a.name]);
    run(cwd, true, git(cwd, &list)).await
}

async fn rebase_onto(cwd: &str, args: &Value) -> Res<Value> {
    let a: Name = parse(args)?;
    run(
        cwd,
        true,
        git_env(
            cwd,
            &["rebase", "--autostash", &a.name],
            env(&[("GIT_EDITOR", ":")]),
        ),
    )
    .await
}

async fn commit(cwd: &str, args: &Value) -> Res<Value> {
    let a: Commit = parse(args)?;
    let mut list = vec!["commit"];
    if a.amend {
        list.push("--amend");
    }
    list.extend(["-m", &a.message]);
    run(cwd, true, git(cwd, &list)).await
}

async fn continue_operation(cwd: &str, args: &Value) -> Res<Value> {
    let a: Op = parse(args)?;
    let editor = env(&[("GIT_EDITOR", ":")]);
    if let Operation::Merge = a.op {
        return run(cwd, true, git_env(cwd, &["commit", "--no-edit"], editor)).await;
    }
    run(
        cwd,
        true,
        git_env(cwd, &[a.op.word(), "--continue"], editor),
    )
    .await
}

async fn abort_operation(cwd: &str, args: &Value) -> Res<Value> {
    let a: Op = parse(args)?;
    run(cwd, true, git(cwd, &[a.op.word(), "--abort"])).await
}
