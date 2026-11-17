use super::{Res, git, git_env, needs_confirm, parse, raw, run};
use crate::commands::write_temp;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
enum TodoAction {
    Pick,
    Reword,
    Squash,
    Fixup,
    Drop,
}

impl TodoAction {
    fn word(self) -> &'static str {
        match self {
            TodoAction::Pick | TodoAction::Reword => "pick",
            TodoAction::Squash => "squash",
            TodoAction::Fixup => "fixup",
            TodoAction::Drop => "drop",
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
struct TodoEntry {
    sha: String,
    #[serde(default)]
    subject: String,
    action: TodoAction,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

#[derive(Deserialize)]
struct Base {
    base: Option<String>,
}

#[derive(Deserialize)]
struct Todo {
    base: Option<String>,
    entries: Vec<TodoEntry>,
}

#[derive(Deserialize)]
struct Sha {
    sha: String,
}

#[derive(Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
enum Direction {
    Up,
    Down,
}

#[derive(Deserialize)]
struct MoveCommit {
    sha: String,
    direction: Direction,
}

#[derive(Deserialize)]
struct Message {
    message: String,
}

#[derive(Deserialize)]
struct Reword {
    sha: String,
    message: String,
}

#[derive(Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
enum Rewrite {
    Drop,
    Squash,
}

#[derive(Deserialize)]
struct RewriteMany {
    shas: Vec<String>,
    action: Rewrite,
    confirmed: bool,
}

pub async fn call(cwd: &str, name: &str, args: &Value) -> Option<Res<Value>> {
    Some(match name {
        "rebaseRange" => rebase_range_action(cwd, args).await,
        "runTodo" => run_todo_action(cwd, args).await,
        "dropPlan" => drop_plan(cwd, args).await,
        "movePlan" => move_plan(cwd, args).await,
        "commitMessage" => commit_message(cwd, args).await,
        "amendMessage" => amend_message(cwd, args).await,
        "rewordPlan" => reword_plan(cwd, args).await,
        "rewriteMany" => rewrite_many(cwd, args).await,
        "formatPatch" => format_patch(cwd, args).await,
        _ => return None,
    })
}

fn nonempty(base: Option<&str>) -> Option<&str> {
    base.filter(|b| !b.is_empty())
}

async fn rebase_range(cwd: &str, base: Option<&str>) -> Res<Vec<TodoEntry>> {
    let range = match nonempty(base) {
        Some(b) => format!("{b}..HEAD"),
        None => "HEAD".to_string(),
    };
    let out = git(cwd, &["log", "--reverse", "--format=%H%x1f%s", &range]).await?;
    Ok(out
        .split('\n')
        .filter(|line| !line.is_empty())
        .map(|line| {
            let mut parts = line.split('\x1f');
            TodoEntry {
                sha: parts.next().unwrap_or_default().to_string(),
                subject: parts.next().unwrap_or_default().to_string(),
                action: TodoAction::Pick,
                message: None,
            }
        })
        .collect())
}

async fn parent_of(cwd: &str, sha: &str) -> Option<String> {
    let target = format!("{sha}~1");
    let result = raw(cwd, &["rev-parse", "-q", "--verify", &target], None, None).await;
    (result.code == 0).then(|| result.stdout.trim().to_string())
}

async fn run_todo(cwd: &str, base: Option<&str>, entries: &[TodoEntry]) -> Res<()> {
    let mut lines: Vec<String> = Vec::new();
    for entry in entries {
        match (&entry.action, &entry.message) {
            (TodoAction::Reword, Some(message)) => {
                lines.push(format!("pick {}", entry.sha));
                let file = write_temp(message.clone()).await?;
                lines.push(format!(
                    "exec git commit --amend --only --allow-empty -F \"{file}\""
                ));
            }
            _ => lines.push(format!("{} {}", entry.action.word(), entry.sha)),
        }
    }
    let todo = write_temp(lines.join("\n") + "\n").await?;
    let mut list = vec!["rebase", "-i", "--autostash"];
    list.push(nonempty(base).unwrap_or("--root"));
    let env = [
        ("GIT_SEQUENCE_EDITOR".to_string(), format!("cp \"{todo}\"")),
        ("GIT_EDITOR".to_string(), ":".to_string()),
    ]
    .into_iter()
    .collect();
    git_env(cwd, &list, env).await?;
    Ok(())
}

async fn rebase_range_action(cwd: &str, args: &Value) -> Res<Value> {
    let a: Base = parse(args)?;
    Ok(json!(rebase_range(cwd, a.base.as_deref()).await?))
}

async fn run_todo_action(cwd: &str, args: &Value) -> Res<Value> {
    let a: Todo = parse(args)?;
    run(cwd, true, run_todo(cwd, a.base.as_deref(), &a.entries)).await
}

async fn plan(base: Option<String>, entries: Vec<TodoEntry>) -> Res<Value> {
    Ok(json!({ "base": base, "entries": entries }))
}

async fn drop_plan(cwd: &str, args: &Value) -> Res<Value> {
    let a: Sha = parse(args)?;
    let base = parent_of(cwd, &a.sha).await;
    let mut entries = rebase_range(cwd, base.as_deref()).await?;
    for entry in entries.iter_mut().filter(|e| e.sha == a.sha) {
        entry.action = TodoAction::Drop;
    }
    plan(base, entries).await
}

async fn move_plan(cwd: &str, args: &Value) -> Res<Value> {
    let a: MoveCommit = parse(args)?;
    let target = if a.direction == Direction::Up {
        Some(a.sha.clone())
    } else {
        parent_of(cwd, &a.sha).await
    };
    let Some(target) = target.filter(|t| !t.is_empty()) else {
        return Ok(Value::Null);
    };
    let base = parent_of(cwd, &target).await;
    let mut entries = rebase_range(cwd, base.as_deref()).await?;
    let Some(i) = entries.iter().position(|e| e.sha == target) else {
        return Ok(Value::Null);
    };
    if i + 1 >= entries.len() {
        return Ok(Value::Null);
    }
    entries.swap(i, i + 1);
    plan(base, entries).await
}

async fn commit_message(cwd: &str, args: &Value) -> Res<Value> {
    let a: Sha = parse(args)?;
    let out = git(cwd, &["show", "-s", "--format=%B", &a.sha]).await?;
    Ok(Value::String(out.trim().to_string()))
}

async fn amend_message(cwd: &str, args: &Value) -> Res<Value> {
    let a: Message = parse(args)?;
    run(
        cwd,
        true,
        git(
            cwd,
            &[
                "commit",
                "--amend",
                "--only",
                "--allow-empty",
                "-m",
                &a.message,
            ],
        ),
    )
    .await
}

async fn reword_plan(cwd: &str, args: &Value) -> Res<Value> {
    let a: Reword = parse(args)?;
    let base = parent_of(cwd, &a.sha).await;
    let mut entries = rebase_range(cwd, base.as_deref()).await?;
    for entry in entries.iter_mut().filter(|e| e.sha == a.sha) {
        entry.action = TodoAction::Reword;
        entry.message = Some(a.message.clone());
    }
    plan(base, entries).await
}

async fn rewrite_many(cwd: &str, args: &Value) -> Res<Value> {
    let a: RewriteMany = parse(args)?;
    let mut counts: Vec<u64> = Vec::new();
    for sha in &a.shas {
        let out = git(cwd, &["rev-list", "--count", sha]).await?;
        counts.push(out.trim().parse().unwrap_or(0));
    }
    let Some((index, _)) = counts.iter().enumerate().min_by_key(|(_, c)| **c) else {
        return Err("No commits selected.".into());
    };
    let oldest = a.shas[index].clone();
    let base = parent_of(cwd, &oldest).await;
    let mut entries = rebase_range(cwd, base.as_deref()).await?;
    let picked = entries.iter().filter(|e| a.shas.contains(&e.sha)).count();
    if picked != a.shas.len() {
        return Ok(json!({
            "toast": "All selected commits must be in the history of the current branch."
        }));
    }
    if a.action == Rewrite::Squash {
        let first = entries.iter().position(|e| e.sha == oldest).unwrap_or(0);
        let contiguous = entries
            .iter()
            .skip(first)
            .take(a.shas.len())
            .all(|e| a.shas.contains(&e.sha));
        if !contiguous {
            return Ok(json!({ "toast": "Squash needs adjacent commits." }));
        }
    }
    if !a.confirmed {
        return Err(needs_confirm("rewrite", ""));
    }
    for entry in entries.iter_mut() {
        if a.shas.contains(&entry.sha) && (a.action == Rewrite::Drop || entry.sha != oldest) {
            entry.action = if a.action == Rewrite::Drop {
                TodoAction::Drop
            } else {
                TodoAction::Squash
            };
        }
    }
    run(cwd, true, run_todo(cwd, base.as_deref(), &entries)).await
}

async fn format_patch(cwd: &str, args: &Value) -> Res<Value> {
    let a: Sha = parse(args)?;
    let patch = git(cwd, &["format-patch", "-1", "--stdout", &a.sha]).await?;
    Ok(Value::String(patch))
}
