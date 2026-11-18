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
    #[serde(default)]
    in_worktree: bool,
    mode: Option<String>,
    new_name: Option<String>,
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

const LOCAL_CHANGES: &str =
    "Your local changes to the following files would be overwritten by checkout";

pub fn conflict_error(error: String, action: &str) -> String {
    if !error.contains(LOCAL_CHANGES) {
        return error;
    }
    match error.lines().filter(|l| l.starts_with('\t')).count() {
        0 => error,
        1 => format!("1 conflict prevents {action}."),
        n => format!("{n} conflicts prevent {action}."),
    }
}

fn checkout_error(error: String) -> String {
    let tail = "\nCommit, stash, or discard your changes first.";
    let message = conflict_error(error.clone(), "checkout");
    if message == error {
        error
    } else {
        message + tail
    }
}

async fn auto_stash(cwd: &str, target: &str) -> Res<()> {
    if git(cwd, &["status", "--porcelain"])
        .await?
        .trim()
        .is_empty()
    {
        return Ok(());
    }
    let message = format!("Auto stash before checking out \"{target}\"");
    git(
        cwd,
        &["stash", "push", "--include-untracked", "-m", &message],
    )
    .await?;
    Ok(())
}

async fn checkout_ref(cwd: &str, args: &Value) -> Res<Value> {
    let a: Name = parse(args)?;
    run(cwd, true, async {
        git(cwd, &["switch", &a.name]).await.map_err(checkout_error)
    })
    .await
}

async fn checkout_commit(cwd: &str, args: &Value) -> Res<Value> {
    let a: Sha = parse(args)?;
    run(cwd, true, async {
        auto_stash(cwd, "HEAD").await?;
        git(cwd, &["switch", "--detach", &a.sha]).await
    })
    .await
}

async fn reset_local(cwd: &str, local: &str, remote: &str) -> Res<String> {
    auto_stash(cwd, remote).await?;
    git(cwd, &["switch", "-C", local, remote])
        .await
        .map_err(checkout_error)
}

async fn same_commit(cwd: &str, local: &str, remote: &str) -> bool {
    let a = git(cwd, &["rev-parse", local]).await;
    let b = git(cwd, &["rev-parse", remote]).await;
    a.is_ok() && a == b
}

async fn can_reset_local(cwd: &str, local: &str, remote: &str) -> bool {
    let upstream = format!("{local}@{{upstream}}");
    let tracks = git(cwd, &["rev-parse", "--abbrev-ref", &upstream]).await;
    tracks.is_ok_and(|t| t.trim() == remote)
        && git(cwd, &["merge-base", "--is-ancestor", local, remote])
            .await
            .is_ok()
}

async fn checkout_remote(cwd: &str, args: &Value) -> Res<Value> {
    let a: CheckoutRemote = parse(args)?;
    let (_, local) = split_remote(&a.remote_branch);
    let remote = a.remote_branch.as_str();
    if !a.local_exists {
        return run(
            cwd,
            true,
            git(cwd, &["switch", "-c", local, "--track", remote]),
        )
        .await;
    }
    run(cwd, true, async {
        match a.mode.as_deref() {
            Some("reset") => return reset_local(cwd, local, remote).await,
            Some("create") => {
                let name = a.new_name.as_deref().unwrap_or_default().trim();
                return git(cwd, &["switch", "-c", name, "--track", remote]).await;
            }
            _ => {}
        }
        if !a.in_worktree && same_commit(cwd, local, remote).await {
            return git(cwd, &["switch", local]).await.map_err(checkout_error);
        }
        if can_reset_local(cwd, local, remote).await {
            return reset_local(cwd, local, remote).await;
        }
        Err(needs_confirm("remote-diverged", local))
    })
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
