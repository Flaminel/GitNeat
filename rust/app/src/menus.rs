mod branch;
mod tag;

use crate::actions::{self, Res};
use crate::menu::MenuSpec;
use repo::port::{paths_equal, web_base};
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum MenuKind {
    Commit,
    Ref,
    Wip,
    Stash,
    Tag,
    Remote,
    Worktree,
    Submodule,
    File,
    Drop,
    Multi,
    Refs,
    Folder,
}

#[derive(Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum RefKind {
    Local,
    Remote,
    Tag,
}

#[derive(Deserialize, Clone, Debug)]
pub struct RefIn {
    kind: RefKind,
    name: String,
    full: String,
    #[serde(default)]
    sha: String,
    upstream: Option<String>,
    current: Option<bool>,
    worktree: Option<String>,
}

#[derive(Deserialize, Debug)]
pub struct RemoteIn {
    name: String,
    url: String,
}

#[derive(Deserialize, Debug)]
pub struct CommitRow {
    sha: String,
    parents: usize,
}

#[derive(Deserialize, Debug)]
pub struct WorktreeIn {
    path: String,
    main: bool,
    locked: bool,
    prunable: bool,
}

#[derive(Deserialize, Debug)]
struct WipIn {
    staged: bool,
    #[serde(default)]
    stash: bool,
    #[serde(default)]
    count: usize,
    #[serde(default)]
    panel: bool,
    #[serde(default)]
    ignore: bool,
    conflict: Option<ConflictIn>,
}

#[derive(Deserialize, Debug)]
struct ConflictIn {
    current: String,
    incoming: String,
}

#[derive(Deserialize, Debug)]
pub struct Env {
    head: Option<String>,
    branch: Option<String>,
    operation: Option<String>,
    #[serde(default)]
    refs: Vec<RefIn>,
    #[serde(default)]
    remotes: Vec<RemoteIn>,
    #[serde(default)]
    hidden: Vec<String>,
    #[serde(default)]
    solo: Vec<String>,
    #[serde(default)]
    commits: Vec<CommitRow>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RangeInfo {
    ancestor: bool,
    is_head: bool,
    children: u64,
    has_merges: bool,
    descendant: bool,
}

#[derive(Deserialize)]
struct CommitArgs {
    #[serde(flatten)]
    env: Env,
    commit: CommitRow,
    #[serde(default)]
    wip: bool,
}

#[derive(Deserialize)]
struct RefArgs {
    #[serde(flatten)]
    env: Env,
    #[serde(rename = "ref")]
    reference: RefIn,
    #[serde(default)]
    panel: bool,
}

#[derive(Deserialize)]
struct RemoteArgs {
    #[serde(flatten)]
    env: Env,
    name: String,
    url: String,
}

#[derive(Deserialize)]
struct StashArgs {
    #[serde(default)]
    hidden: Vec<String>,
}

#[derive(Deserialize)]
struct SubmoduleArgs {
    sm: actions::submodule::Submodule,
}

#[derive(Deserialize)]
struct WorktreeArgs {
    platform: String,
    wt: WorktreeIn,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileArgs {
    platform: String,
    #[serde(default)]
    path: String,
    wip: Option<WipIn>,
    #[serde(default)]
    stash_apply: usize,
    #[serde(default)]
    history: bool,
    #[serde(skip)]
    missing: bool,
    #[serde(skip)]
    diff_tool: bool,
    #[serde(skip)]
    merge_tool: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DropArgs {
    #[serde(flatten)]
    env: Env,
    source_full: String,
    target: RefIn,
}

#[derive(Deserialize)]
struct MultiArgs {
    #[serde(flatten)]
    env: Env,
    shas: Vec<String>,
    #[serde(default)]
    wip: bool,
}

#[derive(Deserialize)]
struct RefsArgs {
    #[serde(flatten)]
    env: Env,
    fulls: Vec<String>,
}

#[derive(Deserialize)]
struct FolderArgs {
    name: String,
    count: usize,
}

fn has(value: &Option<String>) -> bool {
    value.as_deref().is_some_and(|s| !s.is_empty())
}

fn short(sha: &str) -> String {
    sha.chars().take(7).collect()
}

fn item(id: impl Into<String>, label: impl Into<String>) -> MenuSpec {
    MenuSpec {
        label: Some(label.into()),
        id: Some(id.into()),
        kind: None,
        enabled: None,
        submenu: None,
        accelerator: None,
        checked: None,
    }
}

fn sep() -> MenuSpec {
    MenuSpec {
        label: None,
        id: None,
        kind: Some("separator".into()),
        enabled: None,
        submenu: None,
        accelerator: None,
        checked: None,
    }
}

fn is_sep(spec: &MenuSpec) -> bool {
    spec.kind.as_deref() == Some("separator")
}

fn tidy(items: Vec<MenuSpec>) -> Vec<MenuSpec> {
    let mut out: Vec<MenuSpec> = Vec::new();
    for spec in items {
        if is_sep(&spec) && out.last().is_none_or(is_sep) {
            continue;
        }
        out.push(spec);
    }
    while out.last().is_some_and(is_sep) {
        out.pop();
    }
    out
}

fn sub(label: impl Into<String>, children: Vec<MenuSpec>) -> MenuSpec {
    MenuSpec {
        label: Some(label.into()),
        id: None,
        kind: None,
        enabled: None,
        submenu: Some(tidy(children)),
        accelerator: None,
        checked: None,
    }
}

fn groups(list: Vec<Vec<MenuSpec>>) -> Vec<MenuSpec> {
    list.into_iter()
        .flat_map(|g| std::iter::once(sep()).chain(g))
        .collect()
}

fn flat(items: Vec<Option<MenuSpec>>) -> Vec<MenuSpec> {
    items.into_iter().flatten().collect()
}

fn scoped(items: Vec<MenuSpec>, prefix: &str) -> Vec<MenuSpec> {
    items
        .into_iter()
        .map(|mut spec| {
            spec.id = spec.id.map(|id| format!("{prefix}{id}"));
            spec.submenu = spec.submenu.map(|list| scoped(list, prefix));
            spec
        })
        .collect()
}

fn tag_actions() -> Vec<MenuSpec> {
    vec![
        item("createTag", "Create tag here"),
        item("createAnnotatedTag", "Create annotated tag here"),
    ]
}

fn reveal_label(platform: &str) -> &'static str {
    if platform == "darwin" {
        "Show in Finder"
    } else {
        "Show in Explorer"
    }
}

async fn range_info(cwd: &str, sha: &str) -> Res<RangeInfo> {
    let value = actions::dispatch(cwd, "rangeInfo", json!({ "sha": sha })).await?;
    serde_json::from_value(value).map_err(|e| e.to_string())
}

fn current_name(env: &Env) -> &str {
    env.branch.as_deref().unwrap_or("HEAD")
}

fn wip_menu() -> Vec<MenuSpec> {
    vec![
        item("stashAll", "Stash all changes"),
        sep(),
        item("discardAll", "Discard all changes"),
    ]
}

fn stash_menu(hidden: &[String]) -> Vec<MenuSpec> {
    let toggle = if hidden.iter().any(|h| h == "refs/stash") {
        "Show"
    } else {
        "Hide"
    };
    groups(vec![
        vec![
            item("stashApply", "Apply Stash"),
            item("stashPop", "Pop Stash"),
            item("stashDrop", "Delete Stash"),
        ],
        vec![item("stashEdit", "Edit stash message")],
        vec![item("copySha", "Copy commit sha")],
        vec![item("toggleHidden", toggle)],
    ])
}

fn host(web: &str) -> String {
    web.strip_prefix("https://")
        .unwrap_or(web)
        .split('/')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn remote_menu(env: &Env, name: &str, url: &str) -> Vec<MenuSpec> {
    let web = web_base(url);
    let prefix = format!("{name}/");
    let own: Vec<&RefIn> = env
        .refs
        .iter()
        .filter(|r| r.kind == RefKind::Remote && r.name.starts_with(&prefix))
        .collect();
    let all_hidden = !own.is_empty() && own.iter().all(|r| env.hidden.contains(&r.full));
    let all_solo = !own.is_empty() && own.iter().all(|r| env.solo.contains(&r.full));
    groups(vec![
        vec![item("fetchRemote", format!("Fetch {name}"))],
        vec![
            item("editRemote", format!("Edit {name}")),
            item("removeRemote", format!("Remove {name}")),
        ],
        flat(vec![
            web.map(|w| item("openRemoteWeb", format!("View {name} on {}", host(&w)))),
            Some(item("copyRemoteUrl", "Copy remote URL")),
        ]),
        if own.is_empty() {
            Vec::new()
        } else {
            vec![
                item("toggleHidden", if all_hidden { "Show" } else { "Hide" }),
                item("solo", if all_solo { "Stop soloing" } else { "Solo" }),
            ]
        },
    ])
}

fn worktree_menu(cwd: &str, platform: &str, wt: &WorktreeIn) -> Vec<MenuSpec> {
    let is_self = paths_equal(&wt.path, cwd);
    groups(vec![
        flat(vec![
            (!wt.locked && !wt.prunable && !is_self)
                .then(|| item("openWorktree", "Open this worktree")),
            (!wt.main && !is_self).then(|| item("removeWorktree", "Remove this worktree")),
        ]),
        flat(vec![
            (!wt.main && !wt.locked).then(|| item("lockWorktree", "Lock this worktree")),
            wt.locked
                .then(|| item("unlockWorktree", "Unlock this worktree")),
        ]),
        flat(vec![
            wt.prunable
                .then(|| item("pruneWorktrees", "Prune worktrees")),
        ]),
        vec![
            item("copyPath", "Copy path"),
            item("showItem", reveal_label(platform)),
        ],
    ])
}

fn submodule_menu(sm: &actions::submodule::Submodule) -> Vec<MenuSpec> {
    let can = sm.available();
    groups(vec![
        flat(vec![
            can.reset
                .then(|| item("submoduleReset", "Discard Submodule Changes")),
            can.commit
                .then(|| item("submoduleCommit", "Commit Changes")),
        ]),
        flat(vec![
            can.initialize
                .then(|| item("submoduleInit", format!("Initialize {}", sm.name))),
            (!sm.deleted).then(|| item("submoduleUpdate", format!("Update {}", sm.name))),
        ]),
        flat(vec![
            (!sm.deleted).then(|| item("submoduleEdit", format!("Edit {}", sm.name))),
            (!sm.deleted && !sm.uninitialized)
                .then(|| item("submoduleOpen", "Open this submodule")),
        ]),
        flat(vec![
            (!sm.deleted).then(|| item("submoduleRemove", "Delete this submodule")),
        ]),
    ])
}

fn plural(count: usize, one: &str, many: &str) -> String {
    if count == 1 {
        one.to_string()
    } else {
        many.replace("{}", &count.to_string())
    }
}

fn ignore_items(path: &str, w: &WipIn) -> Vec<MenuSpec> {
    let name = path.rsplit('/').next().unwrap_or(path);
    let extension = name.rfind('.').map(|i| &name[i..]).filter(|e| e.len() > 1);
    let folder = path
        .rsplit_once('/')
        .map(|(dir, _)| dir.rsplit('/').next().unwrap_or(dir));
    if w.count > 1 {
        return vec![item("ignoreFile", format!("Ignore {} files", w.count))];
    }
    let mut children = vec![item("ignoreFile", format!("Ignore '{name}'"))];
    if let Some(e) = extension {
        children.push(item(
            "ignoreExtension",
            format!("All files with the extension '{e}'"),
        ));
    }
    if let Some(f) = folder {
        children.push(item("ignoreFolder", format!("All files in '{f}/'")));
    }
    vec![sub("Ignore", children)]
}

fn tool_label(configured: bool, kind: &str) -> String {
    if configured {
        format!("Open in external {kind} tool")
    } else {
        format!("Open in {kind} tool")
    }
}

fn conflict_items(a: &FileArgs, c: &ConflictIn) -> Vec<MenuSpec> {
    vec![
        item("openMergeTool", tool_label(a.merge_tool, "merge")),
        item("takeCurrent", format!("Take current ({})", c.current)),
        item("takeIncoming", format!("Take incoming ({})", c.incoming)),
        item("markResolved", "Mark resolved"),
    ]
}

fn file_menu(a: &FileArgs) -> Vec<MenuSpec> {
    let conflict = a.wip.as_ref().and_then(|w| w.conflict.as_ref());
    let mut open = Vec::new();
    if conflict.is_none() {
        open.push(item("openDiffTool", tool_label(a.diff_tool, "diff")));
    }
    if !a.missing {
        open.push(item("openFile", "Open file"));
        open.push(item("showItem", reveal_label(&a.platform)));
    }
    let history = if a.history {
        vec![
            item("fileHistory", "File History"),
            item("fileBlame", "File Blame"),
        ]
    } else {
        Vec::new()
    };
    if a.stash_apply > 0 {
        return groups(vec![
            vec![item(
                "applyStashed",
                plural(
                    a.stash_apply,
                    "Apply stashed file",
                    "Apply {} files from stash",
                ),
            )],
            history,
            open,
            vec![item("copyFilePath", "Copy file path")],
        ]);
    }
    let Some(w) = a.wip.as_ref() else {
        return groups(vec![
            history,
            open,
            vec![item("copyFilePath", "Copy file path")],
        ]);
    };
    if !w.panel {
        let mut stage = match conflict {
            Some(c) => conflict_items(a, c),
            None => flat(vec![
                (!w.staged).then(|| item("stage", "Stage")),
                w.staged.then(|| item("unstage", "Unstage")),
            ]),
        };
        stage.extend(flat(vec![
            (!w.staged).then(|| item("discard", "Discard changes")),
            w.stash.then(|| item("stashFile", "Stash file")),
        ]));
        return groups(vec![
            stage,
            history,
            open,
            vec![item("copyFilePath", "Copy file path")],
        ]);
    }
    let many = w.count > 1;
    let stage = if many {
        if w.staged {
            plural(w.count, "Unstage", "Unstage {} files")
        } else {
            plural(w.count, "Stage", "Stage {} files")
        }
    } else if w.staged {
        "Unstage".to_string()
    } else {
        "Stage".to_string()
    };
    let discard = if many {
        format!("Discard {} files", w.count)
    } else {
        "Discard changes".to_string()
    };
    let stash = if many {
        format!("Stash {} files", w.count)
    } else {
        "Stash file".to_string()
    };
    let changes = flat(vec![
        Some(item(if w.staged { "unstage" } else { "stage" }, stage)),
        Some(item("discard", discard)),
    ]);
    let mut changes = changes;
    if w.ignore {
        changes.extend(ignore_items(&a.path, w));
    }
    if w.stash {
        changes.push(item("stashFile", stash));
    }
    let patch = if many {
        format!("Create patch from changes in {} files", w.count)
    } else {
        "Create patch from file changes".to_string()
    };
    let mut tail = vec![if many { Vec::new() } else { history }, open];
    if !many {
        tail.push(vec![item("copyFilePath", "Copy file path")]);
    }
    let mut list = vec![changes, vec![item("exportPatch", patch)]];
    list.extend(tail);
    groups(list)
}

fn drop_menu(env: &Env, source_full: &str, target: &RefIn) -> Option<Vec<MenuSpec>> {
    let source = env.refs.iter().find(|r| r.full == source_full)?;
    if source.sha == target.sha {
        return None;
    }
    let cur = current_name(env);
    let target_is_current = target.current == Some(true);
    let source_is_current = source.current == Some(true);
    let local = flat(vec![
        target_is_current.then(|| item("merge", format!("Merge {} into {cur}", source.name))),
        target_is_current.then(|| item("rebaseOnto", format!("Rebase {cur} onto {}", source.name))),
        target_is_current.then(|| {
            item(
                "rebaseInteractive",
                format!("Interactive Rebase {cur} onto {}", source.name),
            )
        }),
        source_is_current.then(|| item("mergeTarget", format!("Merge {} into {cur}", target.name))),
        source_is_current.then(|| {
            item(
                "rebaseOntoTarget",
                format!("Rebase {cur} onto {}", target.name),
            )
        }),
        source_is_current.then(|| {
            item(
                "rebaseInteractiveTarget",
                format!("Interactive Rebase {cur} onto {}", target.name),
            )
        }),
        (target.kind == RefKind::Local && !target_is_current).then(|| {
            item(
                "fastForward",
                format!("Fast-forward {} to {}", target.name, source.name),
            )
        }),
        (source.kind == RefKind::Local && target.kind == RefKind::Remote)
            .then(|| item("pushTo", format!("Push {} to {}", source.name, target.name))),
    ]);
    let items = groups(vec![local, branch::drop_pr_items(env, source, target)]);
    items.iter().any(|i| !is_sep(i)).then_some(items)
}

async fn multi_menu(cwd: &str, env: &Env, shas: &[String], wip: bool) -> Res<Vec<MenuSpec>> {
    let n = shas.len();
    let mut all_in_history = !wip && env.operation.as_deref() != Some("rebase");
    for sha in shas {
        let info = range_info(cwd, sha).await?;
        if !info.ancestor || info.has_merges {
            all_in_history = false;
        }
    }
    let adjacent = all_in_history && {
        let chain = actions::git(cwd, &["rev-list", "--first-parent", "HEAD"]).await?;
        let positions: Vec<usize> = shas
            .iter()
            .filter_map(|sha| chain.lines().position(|line| line == sha))
            .collect();
        positions.len() == n
            && positions
                .iter()
                .max()
                .zip(positions.iter().min())
                .is_some_and(|(hi, lo)| hi - lo + 1 == n)
    };
    let mut rewrite = Vec::new();
    if adjacent {
        rewrite.push(item("squash", format!("Squash {n} commits")));
    }
    if all_in_history {
        rewrite.push(item("drop", format!("Drop {n} commits")));
    }
    Ok(groups(vec![
        vec![item("cherryPickMany", format!("Cherry pick {n} commits"))],
        rewrite,
        vec![item("copyShas", "Copy commit shas")],
    ]))
}

pub async fn build(cwd: &str, kind: MenuKind, args: &Value) -> Res<Option<Vec<MenuSpec>>> {
    let items = match kind {
        MenuKind::Commit => {
            let a: CommitArgs = actions::parse(args)?;
            branch::commit_menu(cwd, &a.env, &a.commit, a.wip).await?
        }
        MenuKind::Ref => {
            let a: RefArgs = actions::parse(args)?;
            if a.reference.kind == RefKind::Tag {
                tag::tag_menu(&a.env, &a.reference, a.panel)
            } else {
                branch::ref_menu(cwd, &a.env, &a.reference, a.panel).await?
            }
        }
        MenuKind::Wip => wip_menu(),
        MenuKind::Stash => {
            let a: StashArgs = actions::parse(args)?;
            stash_menu(&a.hidden)
        }
        MenuKind::Tag => {
            let a: RefArgs = actions::parse(args)?;
            tag::tag_menu(&a.env, &a.reference, a.panel)
        }
        MenuKind::Remote => {
            let a: RemoteArgs = actions::parse(args)?;
            remote_menu(&a.env, &a.name, &a.url)
        }
        MenuKind::Worktree => {
            let a: WorktreeArgs = actions::parse(args)?;
            worktree_menu(cwd, &a.platform, &a.wt)
        }
        MenuKind::Submodule => {
            let a: SubmoduleArgs = actions::parse(args)?;
            submodule_menu(&a.sm)
        }
        MenuKind::File => {
            let mut a: FileArgs = actions::parse(args)?;
            a.missing = a.history && !std::path::Path::new(cwd).join(&a.path).exists();
            a.diff_tool = actions::tools::diff_tool_configured(cwd).await;
            a.merge_tool = actions::tools::configured(cwd, "merge.tool").await;
            file_menu(&a)
        }
        MenuKind::Drop => {
            let a: DropArgs = actions::parse(args)?;
            match drop_menu(&a.env, &a.source_full, &a.target) {
                Some(items) => items,
                None => return Ok(None),
            }
        }
        MenuKind::Multi => {
            let a: MultiArgs = actions::parse(args)?;
            multi_menu(cwd, &a.env, &a.shas, a.wip).await?
        }
        MenuKind::Refs => {
            let a: RefsArgs = actions::parse(args)?;
            branch::refs_menu(&a.env, &a.fulls)
        }
        MenuKind::Folder => {
            let a: FolderArgs = actions::parse(args)?;
            branch::folder_menu(&a.name, a.count)
        }
    };
    Ok(Some(tidy(items)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn labels(items: &[MenuSpec]) -> Vec<String> {
        items
            .iter()
            .map(|i| {
                if is_sep(i) {
                    "-".to_string()
                } else {
                    i.label.clone().unwrap_or_default()
                }
            })
            .collect()
    }

    #[test]
    fn submodule_menu_follows_the_source_groups() {
        use crate::actions::submodule::Submodule;
        let base = Submodule {
            name: "lib".into(),
            path: "lib".into(),
            ..Submodule::default()
        };
        let synced = Submodule {
            out_of_sync: true,
            ..base.clone()
        };
        assert_eq!(
            labels(&tidy(submodule_menu(&synced))),
            [
                "Discard Submodule Changes",
                "Commit Changes",
                "-",
                "Update lib",
                "-",
                "Edit lib",
                "Open this submodule",
                "-",
                "Delete this submodule"
            ]
        );
        let uninit = Submodule {
            uninitialized: true,
            ..base.clone()
        };
        assert_eq!(
            labels(&tidy(submodule_menu(&uninit))),
            [
                "Initialize lib",
                "Update lib",
                "-",
                "Edit lib",
                "-",
                "Delete this submodule"
            ]
        );
        let gone = Submodule {
            uninitialized: true,
            deleted: true,
            ..base
        };
        assert!(labels(&tidy(submodule_menu(&gone))).is_empty());
    }

    #[test]
    fn tidy_drops_leading_repeated_and_trailing_separators() {
        let items = vec![sep(), item("a", "A"), sep(), sep(), item("b", "B"), sep()];
        assert_eq!(labels(&tidy(items)), ["A", "-", "B"]);
    }

    #[test]
    fn scoped_prefixes_nested_ids() {
        let items = vec![sub("S", vec![item("x", "X")]), item("y", "Y")];
        let out = scoped(items, "g0:");
        assert_eq!(
            out[0].submenu.as_ref().and_then(|s| s[0].id.as_deref()),
            Some("g0:x")
        );
        assert_eq!(out[1].id.as_deref(), Some("g0:y"));
    }

    fn file_labels(args: serde_json::Value, diff_tool: bool, merge_tool: bool) -> Vec<String> {
        let mut a: FileArgs = serde_json::from_value(args).unwrap();
        a.diff_tool = diff_tool;
        a.merge_tool = merge_tool;
        labels(&tidy(file_menu(&a)))
    }

    #[test]
    fn file_menu_opens_the_diff_tool_before_the_open_items() {
        let args = serde_json::json!({"platform": "darwin", "path": "a.txt"});
        assert_eq!(
            file_labels(args.clone(), false, false),
            [
                "Open in diff tool",
                "Open file",
                "Show in Finder",
                "-",
                "Copy file path"
            ]
        );
        assert_eq!(
            file_labels(args, true, false)[0],
            "Open in external diff tool"
        );
    }

    #[test]
    fn conflicted_file_menu_has_merge_tool_and_take_items() {
        let args = serde_json::json!({
            "platform": "darwin",
            "path": "a.txt",
            "wip": {"staged": false, "conflict": {"current": "main", "incoming": "topic"}}
        });
        assert_eq!(
            file_labels(args.clone(), true, true),
            [
                "Open in external merge tool",
                "Take current (main)",
                "Take incoming (topic)",
                "Mark resolved",
                "Discard changes",
                "-",
                "Open file",
                "Show in Finder",
                "-",
                "Copy file path"
            ]
        );
        assert_eq!(file_labels(args, false, false)[0], "Open in merge tool");
    }

    #[test]
    fn wip_menu_has_two_items() {
        assert_eq!(
            labels(&wip_menu()),
            ["Stash all changes", "-", "Discard all changes"]
        );
    }
    fn refs_labels(hidden: &[&str], solo: &[&str], current: &str) -> Vec<String> {
        let refs: Vec<Value> = ["a", "b", "c"]
            .iter()
            .map(|n| {
                json!({"kind": "local", "name": n, "full": format!("refs/heads/{n}"), "sha": "1", "current": *n == current})
            })
            .collect();
        let env: Env = serde_json::from_value(json!({
            "head": "1", "branch": "x", "refs": refs, "hidden": hidden, "solo": solo
        }))
        .unwrap();
        let fulls: Vec<String> = ["a", "b"].iter().map(|n| format!("refs/heads/{n}")).collect();
        labels(&tidy(branch::refs_menu(&env, &fulls)))
    }

    #[test]
    fn multi_ref_menu_follows_the_source_rules() {
        assert_eq!(
            refs_labels(&[], &[], ""),
            ["Delete 2 local branches", "-", "Hide 2 branches", "Solo 2 branches"]
        );
        assert_eq!(
            refs_labels(&["refs/heads/a"], &["refs/heads/b"], ""),
            [
                "Delete 2 local branches",
                "-",
                "Show 2 branches",
                "Hide 2 branches",
                "Solo 2 branches",
                "Stop soloing 2 branches"
            ]
        );
        assert_eq!(
            refs_labels(&["refs/heads/a", "refs/heads/b"], &[], "a"),
            ["Show 2 branches", "Solo 2 branches"]
        );
    }

    #[test]
    fn folder_menu_counts_branches() {
        assert_eq!(
            labels(&branch::folder_menu("feat", 1)),
            ["Delete 1 branch in folder \"feat\""]
        );
        assert_eq!(
            labels(&branch::folder_menu("feat/x", 3)),
            ["Delete 3 branches in folder \"feat/x\""]
        );
    }
    fn drop_env(upstream: Option<&str>) -> Env {
        serde_json::from_value(json!({
            "head": "1", "branch": "main",
            "remotes": [
                {"name": "origin", "url": "https://github.com/a/b.git"},
                {"name": "fork", "url": "https://github.com/c/b.git"}
            ],
            "refs": [
                {"kind": "local", "name": "feat", "full": "refs/heads/feat", "sha": "1", "upstream": upstream},
                {"kind": "remote", "name": "origin/feat", "full": "refs/remotes/origin/feat", "sha": "1"},
                {"kind": "remote", "name": "origin/main", "full": "refs/remotes/origin/main", "sha": "2"},
                {"kind": "remote", "name": "fork/main", "full": "refs/remotes/fork/main", "sha": "3"}
            ]
        }))
        .unwrap()
    }

    fn drop_labels(env: &Env, source: &str, target: &str) -> Vec<String> {
        let target = env.refs.iter().find(|r| r.full == target).unwrap();
        drop_menu(env, source, target).map_or_else(Vec::new, |items| labels(&tidy(items)))
    }

    #[test]
    fn drop_menu_has_pull_request_items() {
        let env = drop_env(Some("origin/feat"));
        assert_eq!(
            drop_labels(&env, "refs/remotes/origin/feat", "refs/remotes/origin/main"),
            ["Start a pull request to origin/main from origin/feat"]
        );
        let out = drop_labels(&env, "refs/remotes/origin/feat", "refs/remotes/fork/main");
        assert_eq!(out, ["Start a pull request to fork/main from origin/feat"]);
        assert!(drop_labels(&env, "refs/heads/feat", "refs/heads/feat").is_empty());
    }

    #[test]
    fn drop_menu_on_the_same_commit_has_no_menu() {
        let env = drop_env(None);
        assert!(drop_labels(&env, "refs/heads/feat", "refs/remotes/origin/feat").is_empty());
    }
}
