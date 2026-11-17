mod history;
mod index;
mod rebase;
mod refs;
mod remote;

use crate::git::{self, GitResult};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::future::Future;

pub type Res<T> = Result<T, String>;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct HeadState {
    pub head: Option<String>,
    pub branch: Option<String>,
}

pub fn needs_confirm(kind: &str, text: &str) -> String {
    format!("needs-confirm:{kind}:{text}")
}

pub fn parse<T: DeserializeOwned>(args: &Value) -> Res<T> {
    T::deserialize(args).map_err(|e| e.to_string())
}

pub fn env(pairs: &[(&str, &str)]) -> HashMap<String, String> {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

pub fn split_remote(full: &str) -> (&str, &str) {
    full.split_once('/').unwrap_or((full, ""))
}

pub async fn raw(
    cwd: &str,
    args: &[&str],
    env: Option<HashMap<String, String>>,
    input: Option<String>,
) -> GitResult {
    let list: Vec<String> = args.iter().map(|a| a.to_string()).collect();
    if git::blocked(&list) {
        return GitResult {
            code: 1,
            stdout: String::new(),
            stderr: "GitNeat blocked a git option that can run commands.".into(),
        };
    }
    git::run_git(cwd, &list, env, input).await
}

pub async fn git_env(cwd: &str, args: &[&str], env: HashMap<String, String>) -> Res<String> {
    let result = raw(cwd, args, Some(env), None).await;
    if result.code != 0 {
        let text = if result.stderr.is_empty() {
            &result.stdout
        } else {
            &result.stderr
        };
        let text = text.trim();
        return Err(if text.is_empty() {
            format!("git {} failed", args.first().copied().unwrap_or_default())
        } else {
            text.to_string()
        });
    }
    Ok(result.stdout)
}

pub async fn git(cwd: &str, args: &[&str]) -> Res<String> {
    git_env(cwd, args, HashMap::new()).await
}

fn text(out: &str) -> Option<String> {
    let trimmed = out.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

pub async fn head_state(cwd: &str) -> HeadState {
    let (head, branch) = tokio::join!(
        raw(cwd, &["rev-parse", "-q", "--verify", "HEAD"], None, None),
        raw(cwd, &["symbolic-ref", "-q", "--short", "HEAD"], None, None),
    );
    HeadState {
        head: text(&head.stdout),
        branch: text(&branch.stdout),
    }
}

pub async fn run<T>(cwd: &str, undoable: bool, work: impl Future<Output = Res<T>>) -> Res<Value> {
    let before = head_state(cwd).await;
    work.await?;
    let after = head_state(cwd).await;
    let changed = before.head != after.head || before.branch != after.branch;
    let record = if undoable && before.head.is_some() && changed {
        json!({ "before": before, "after": after })
    } else {
        Value::Null
    };
    Ok(json!({ "record": record }))
}

pub async fn dispatch(cwd: &str, name: &str, args: Value) -> Res<Value> {
    if let Some(done) = refs::call(cwd, name, &args).await {
        return done;
    }
    if let Some(done) = history::call(cwd, name, &args).await {
        return done;
    }
    if let Some(done) = rebase::call(cwd, name, &args).await {
        return done;
    }
    if let Some(done) = remote::call(cwd, name, &args).await {
        return done;
    }
    if let Some(done) = index::call(cwd, name, &args).await {
        return done;
    }
    Err(format!("Unknown action {name}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_remote_at_first_slash() {
        assert_eq!(split_remote("origin/feature/x"), ("origin", "feature/x"));
        assert_eq!(split_remote("origin"), ("origin", ""));
    }

    #[test]
    fn needs_confirm_has_kind_and_text() {
        assert_eq!(
            needs_confirm("force-push", "rejected"),
            "needs-confirm:force-push:rejected"
        );
    }

    #[tokio::test]
    async fn unknown_action_is_an_error() {
        let result = dispatch(".", "nope", Value::Null).await;
        assert_eq!(result, Err("Unknown action nope".to_string()));
    }
}
