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
    File,
    Drop,
    Multi,
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
    }
}

fn sep() -> MenuSpec {
    MenuSpec {
        label: None,
        id: None,
        kind: Some("separator".into()),
        enabled: None,
        submenu: None,
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
    let folder = path.rsplit_once('/').map(|(dir, _)| dir.rsplit('/').next().unwrap_or(dir));
    if w.count > 1 {
        return vec![item("ignoreFile", format!("Ignore {} files", w.count))];
    }
    let mut children = vec![item("ignoreFile", format!("Ignore '{name}'"))];
    if let Some(e) = extension {
        children.push(item("ignoreExtension", format!("All files with the extension '{e}'")));
    }
    if let Some(f) = folder {
        children.push(item("ignoreFolder", format!("All files in '{f}/'")));
    }
    vec![sub("Ignore", children)]
}

fn file_menu(a: &FileArgs) -> Vec<MenuSpec> {
    let open = vec![
        item("openFile", "Open file"),
        item("showItem", reveal_label(&a.platform)),
    ];
    let history = if a.history {
        vec![item("fileHistory", "File History"), item("fileBlame", "File Blame")]
    } else {
        Vec::new()
    };
    if a.stash_apply > 0 {
        return groups(vec![
            vec![item(
                "applyStashed",
                plural(a.stash_apply, "Apply stashed file", "Apply {} files from stash"),
            )],
            history,
            open,
            vec![item("copyFilePath", "Copy file path")],
        ]);
    }
    let Some(w) = a.wip.as_ref() else {
        return groups(vec![history, open, vec![item("copyFilePath", "Copy file path")]]);
    };
    if !w.panel {
        let stage = flat(vec![
            (!w.staged).then(|| item("stage", "Stage")),
            w.staged.then(|| item("unstage", "Unstage")),
            (!w.staged).then(|| item("discard", "Discard changes")),
            w.stash.then(|| item("stashFile", "Stash file")),
        ]);
        return groups(vec![stage, history, open, vec![item("copyFilePath", "Copy file path")]]);
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
    let cur = current_name(env);
    let target_is_current = target.current == Some(true);
    let source_is_current = source.current == Some(true);
    Some(flat(vec![
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
    ]))
}

async fn multi_menu(cwd: &str, env: &Env, shas: &[String]) -> Res<Vec<MenuSpec>> {
    let n = shas.len();
    let mut all_in_history = env.operation.as_deref() != Some("rebase");
    for sha in shas {
        let info = range_info(cwd, sha).await?;
        if !info.ancestor || info.has_merges {
            all_in_history = false;
        }
    }
    Ok(groups(vec![
        vec![item("cherryPickMany", format!("Cherry pick {n} commits"))],
        if all_in_history {
            vec![
                item("squash", format!("Squash {n} commits")),
                item("drop", format!("Drop {n} commits")),
            ]
        } else {
            Vec::new()
        },
        vec![item("copyShas", "Copy commit shas")],
    ]))
}

pub async fn build(cwd: &str, kind: MenuKind, args: &Value) -> Res<Option<Vec<MenuSpec>>> {
    let items = match kind {
        MenuKind::Commit => {
            let a: CommitArgs = actions::parse(args)?;
            branch::commit_menu(cwd, &a.env, &a.commit).await?
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
        MenuKind::File => {
            let a: FileArgs = actions::parse(args)?;
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
            multi_menu(cwd, &a.env, &a.shas).await?
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

    #[test]
    fn wip_menu_has_two_items() {
        assert_eq!(
            labels(&wip_menu()),
            ["Stash all changes", "-", "Discard all changes"]
        );
    }
}
