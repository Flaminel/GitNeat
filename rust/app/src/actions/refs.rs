use super::{Res, git, needs_confirm, parse, run, split_remote};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
struct Name {
    name: String,
}

#[derive(Deserialize)]
struct Sha {
    sha: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CheckoutRemote {
    remote_branch: String,
    local_exists: bool,
}

#[derive(Deserialize)]
struct CreateBranch {
    name: String,
    from: String,
}

#[derive(Deserialize)]
struct CreateWorktree {
    dir: String,
    name: Option<String>,
    branch: Option<String>,
    from: String,
}

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
enum ResetMode {
    Soft,
    Mixed,
    Hard,
}

impl ResetMode {
    fn flag(self) -> &'static str {
        match self {
            ResetMode::Soft => "--soft",
            ResetMode::Mixed => "--mixed",
            ResetMode::Hard => "--hard",
        }
    }
}

#[derive(Deserialize)]
struct Reset {
    mode: ResetMode,
    sha: String,
}

#[derive(Deserialize)]
struct CreateTag {
    sha: String,
    annotated: bool,
    name: String,
    message: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteBranch {
    name: String,
    upstream: Option<String>,
    also_remote: bool,
    force: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteBranch {
    remote_branch: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameBranch {
    name: String,
    new_name: String,
}

#[derive(Deserialize)]
struct DeleteTag {
    tag: String,
    remote: Option<String>,
}

#[derive(Deserialize)]
struct Path {
    path: String,
}

#[derive(Deserialize)]
struct RemoveWorktree {
    path: String,
    #[serde(default)]
    force: bool,
}

#[derive(Deserialize)]
struct LockWorktree {
    path: String,
    lock: bool,
}

pub async fn call(cwd: &str, name: &str, args: &Value) -> Option<Res<Value>> {
    Some(match name {
        "checkoutRef" => checkout_ref(cwd, args).await,
        "checkoutCommit" => checkout_commit(cwd, args).await,
        "checkoutRemote" => checkout_remote(cwd, args).await,
        "createBranch" => create_branch(cwd, args).await,
        "createWorktree" => create_worktree(cwd, args).await,
        "reset" => reset(cwd, args).await,
        "createTag" => create_tag(cwd, args).await,
        "deleteBranch" => delete_branch(cwd, args).await,
        "deleteRemoteBranch" => delete_remote_branch(cwd, args).await,
        "renameBranch" => rename_branch(cwd, args).await,
        "deleteTag" => delete_tag(cwd, args).await,
        "removeWorktree" => remove_worktree(cwd, args).await,
        "lockWorktree" => lock_worktree(cwd, args).await,
        "pruneWorktrees" => run(cwd, true, git(cwd, &["worktree", "prune"])).await,
        _ => return None,
    })
}

async fn checkout_ref(cwd: &str, args: &Value) -> Res<Value> {
    let a: Name = parse(args)?;
    run(cwd, true, git(cwd, &["switch", &a.name])).await
}

async fn checkout_commit(cwd: &str, args: &Value) -> Res<Value> {
    let a: Sha = parse(args)?;
    run(cwd, true, git(cwd, &["switch", "--detach", &a.sha])).await
}

async fn checkout_remote(cwd: &str, args: &Value) -> Res<Value> {
    let a: CheckoutRemote = parse(args)?;
    let local = a
        .remote_branch
        .split('/')
        .skip(1)
        .collect::<Vec<_>>()
        .join("/");
    if a.local_exists {
        return run(cwd, true, git(cwd, &["switch", &local])).await;
    }
    run(
        cwd,
        true,
        git(cwd, &["switch", "-c", &local, "--track", &a.remote_branch]),
    )
    .await
}

async fn create_branch(cwd: &str, args: &Value) -> Res<Value> {
    let a: CreateBranch = parse(args)?;
    run(
        cwd,
        true,
        git(cwd, &["switch", "-c", a.name.trim(), &a.from]),
    )
    .await
}

async fn create_worktree(cwd: &str, args: &Value) -> Res<Value> {
    let a: CreateWorktree = parse(args)?;
    let mut list = vec!["worktree", "add"];
    if let Some(name) = a.name.as_deref().map(str::trim).filter(|n| !n.is_empty()) {
        list.extend(["-b", name]);
    }
    list.push(&a.dir);
    list.push(a.branch.as_deref().unwrap_or(&a.from));
    run(cwd, true, git(cwd, &list)).await
}

async fn reset(cwd: &str, args: &Value) -> Res<Value> {
    let a: Reset = parse(args)?;
    run(cwd, true, git(cwd, &["reset", a.mode.flag(), &a.sha])).await
}

async fn create_tag(cwd: &str, args: &Value) -> Res<Value> {
    let a: CreateTag = parse(args)?;
    let name = a.name.trim();
    if a.annotated {
        let message = a
            .message
            .as_deref()
            .filter(|m| !m.is_empty())
            .unwrap_or(name);
        return run(
            cwd,
            true,
            git(cwd, &["tag", "-a", name, "-m", message, &a.sha]),
        )
        .await;
    }
    run(cwd, true, git(cwd, &["tag", name, &a.sha])).await
}

async fn delete_branch(cwd: &str, args: &Value) -> Res<Value> {
    let a: DeleteBranch = parse(args)?;
    run(cwd, true, async {
        if a.force {
            git(cwd, &["branch", "-D", &a.name]).await?;
        } else if let Err(error) = git(cwd, &["branch", "-d", &a.name]).await {
            if error.contains("not fully merged") {
                return Err(needs_confirm("force-delete", &error));
            }
            return Err(error);
        }
        if a.also_remote
            && let Some(upstream) = a.upstream.as_deref().filter(|u| !u.is_empty())
        {
            let (remote, rest) = split_remote(upstream);
            git(cwd, &["push", remote, "--delete", rest]).await?;
        }
        Ok(())
    })
    .await
}

async fn delete_remote_branch(cwd: &str, args: &Value) -> Res<Value> {
    let a: RemoteBranch = parse(args)?;
    let (remote, rest) = split_remote(&a.remote_branch);
    run(cwd, true, git(cwd, &["push", remote, "--delete", rest])).await
}

async fn rename_branch(cwd: &str, args: &Value) -> Res<Value> {
    let a: RenameBranch = parse(args)?;
    run(
        cwd,
        false,
        git(cwd, &["branch", "-m", &a.name, a.new_name.trim()]),
    )
    .await
}

async fn delete_tag(cwd: &str, args: &Value) -> Res<Value> {
    let a: DeleteTag = parse(args)?;
    match a.remote.as_deref().filter(|r| !r.is_empty()) {
        Some(remote) => {
            let tag = format!("refs/tags/{}", a.tag);
            run(cwd, true, git(cwd, &["push", remote, "--delete", &tag])).await
        }
        None => run(cwd, true, git(cwd, &["tag", "-d", &a.tag])).await,
    }
}

async fn remove_worktree(cwd: &str, args: &Value) -> Res<Value> {
    let a: RemoveWorktree = parse(args)?;
    run(cwd, true, async {
        if a.force {
            return git(cwd, &["worktree", "remove", "--force", "--force", &a.path]).await;
        }
        match git(cwd, &["worktree", "remove", &a.path]).await {
            Err(error) if error.contains("--force") || error.contains("remove -f") => {
                Err(needs_confirm("force-remove", &error))
            }
            other => other,
        }
    })
    .await
}

async fn lock_worktree(cwd: &str, args: &Value) -> Res<Value> {
    let a: LockWorktree = parse(args)?;
    let verb = if a.lock { "lock" } else { "unlock" };
    run(cwd, true, git(cwd, &["worktree", verb, &a.path])).await
}
