use super::{
    CommitRow, Env, RangeInfo, RefIn, RefKind, current_name, flat, groups, has, item, range_info,
    scoped, sep, short, sub, tag_actions,
};
use crate::actions::Res;
use crate::menu::MenuSpec;
use repo::port::{commit_url, compare_url};

#[derive(Clone, Copy, PartialEq)]
enum Variant {
    Commit,
    Branch,
}

fn parents_of(env: &Env, sha: &str) -> usize {
    env.commits
        .iter()
        .find(|c| c.sha == sha)
        .map_or(0, |c| c.parents)
}

pub(super) fn reset_item(env: &Env) -> Option<MenuSpec> {
    has(&env.head).then(|| {
        sub(
            format!("Reset {} to this commit", current_name(env)),
            vec![
                item("reset:soft", "Soft - keep all changes"),
                item("reset:mixed", "Mixed - keep working copy but reset index"),
                item("reset:hard", "Hard - discard all changes"),
            ],
        )
    })
}

fn commit_actions(env: &Env, info: &RangeInfo, variant: Variant) -> Vec<MenuSpec> {
    let edit_head = info
        .is_head
        .then(|| item("editHeadMessage", "Edit commit message"));
    let revert = Some(item("revert", "Revert commit"));
    let (first, second) = match variant {
        Variant::Branch => (edit_head, revert),
        Variant::Commit => (revert, edit_head),
    };
    flat(vec![
        Some(item("createBranch", "Create branch here")),
        (!info.is_head).then(|| item("cherryPick", "Cherry pick commit")),
        reset_item(env),
        first,
        second,
    ])
}

fn rebase_actions(env: &Env, sha: &str, parents: usize, info: &RangeInfo) -> Vec<MenuSpec> {
    if !info.ancestor || info.has_merges || env.operation.as_deref() == Some("rebase") {
        return Vec::new();
    }
    let not_head = !info.is_head;
    flat(vec![
        not_head.then(|| {
            item(
                "rebaseInteractiveCommit",
                format!(
                    "Interactive Rebase {} children of {}",
                    info.children,
                    short(sha)
                ),
            )
        }),
        not_head.then(|| item("editMessage", "Edit commit message")),
        Some(item("dropCommit", "Drop commit")),
        not_head.then(|| item("moveUp", "Move commit up")),
        (parents == 1).then(|| item("moveDown", "Move commit down")),
    ])
}

fn copy_actions(env: &Env, sha: &str) -> Vec<MenuSpec> {
    let mut out = vec![item("copySha", "Copy commit sha")];
    for (i, remote) in env.remotes.iter().enumerate() {
        if commit_url(&remote.url, sha).is_some() {
            out.push(item(
                format!("copyLink:{i}"),
                format!("Copy link to this commit on remote: {}", remote.name),
            ));
        }
    }
    out.push(item("savePatch", "Create patch from commit"));
    out
}

fn pr_item(env: &Env, branch: &str, remote_name: &str) -> Option<MenuSpec> {
    let remote = env
        .remotes
        .iter()
        .find(|r| r.name == remote_name)
        .or_else(|| env.remotes.iter().find(|r| r.name == "origin"))
        .or_else(|| env.remotes.first())?;
    compare_url(&remote.url, branch)?;
    Some(item(
        "pullRequest",
        format!("Start a pull request from {branch}"),
    ))
}

fn base_name(r: &RefIn) -> &str {
    if r.kind == RefKind::Remote {
        r.name.split_once('/').map_or("", |(_, rest)| rest)
    } else {
        &r.name
    }
}

fn ref_groups(refs: &[RefIn]) -> Vec<Vec<RefIn>> {
    let mut map: Vec<(String, Vec<RefIn>)> = Vec::new();
    for r in refs {
        let key = format!("{} {}", r.sha, base_name(r));
        match map.iter_mut().find(|(k, _)| *k == key) {
            Some((_, list)) => list.push(r.clone()),
            None => map.push((key, vec![r.clone()])),
        }
    }
    map.into_iter()
        .map(|(_, mut g)| {
            g.sort_by_key(|r| r.kind != RefKind::Local);
            g
        })
        .collect()
}

fn merge_items(env: &Env, r: &RefIn, info: &RangeInfo) -> Vec<MenuSpec> {
    let cur = current_name(env);
    let rebase = vec![
        Some(item("rebaseOnto", format!("Rebase {cur} onto {}", r.name))),
        (!info.descendant).then(|| {
            item(
                "rebaseInteractive",
                format!("Interactive Rebase {cur} onto {}", r.name),
            )
        }),
    ];
    let lead = if info.descendant {
        vec![
            Some(item(
                "fastForwardHead",
                format!("Fast-forward {cur} to {}", r.name),
            )),
            Some(item("mergeNoFf", format!("Merge {} into {cur}", r.name))),
        ]
    } else if info.ancestor {
        vec![(r.kind == RefKind::Local).then(|| {
            item(
                "fastForwardRef",
                format!("Fast-forward {} to {cur}", r.name),
            )
        })]
    } else {
        vec![Some(item("merge", format!("Merge {} into {cur}", r.name)))]
    };
    flat(lead.into_iter().chain(rebase).collect())
}

fn checkout_items(group: &[RefIn], panel: bool) -> Vec<MenuSpec> {
    let others: Vec<&RefIn> = group.iter().filter(|r| r.current != Some(true)).collect();
    let open: Vec<MenuSpec> = others
        .iter()
        .filter(|r| has(&r.worktree))
        .enumerate()
        .map(|(i, r)| {
            item(
                format!("openWorktree:{i}"),
                format!("Open worktree from {}", r.name),
            )
        })
        .collect();
    let refs: Vec<&RefIn> = others.into_iter().filter(|r| !has(&r.worktree)).collect();
    if refs.len() + usize::from(!panel) > 1 {
        let mut children: Vec<MenuSpec> = refs
            .iter()
            .enumerate()
            .map(|(i, r)| item(format!("checkout:{i}"), r.name.clone()))
            .collect();
        children.push(item("checkoutCommit", "this commit"));
        let mut out = vec![sub("Checkout", children)];
        out.extend(open);
        return out;
    }
    let mut out: Vec<MenuSpec> = refs
        .iter()
        .enumerate()
        .map(|(i, r)| item(format!("checkout:{i}"), format!("Checkout {}", r.name)))
        .collect();
    out.extend(open);
    if !panel {
        out.push(item("checkoutCommit", "Checkout this commit"));
    }
    out
}

fn worktree_items(group: &[RefIn], panel: bool) -> Vec<MenuSpec> {
    let refs: Vec<&RefIn> = group
        .iter()
        .filter(|r| !has(&r.worktree) && r.current != Some(true))
        .collect();
    if refs.len() + usize::from(!panel) > 1 {
        let mut children: Vec<MenuSpec> = refs
            .iter()
            .enumerate()
            .map(|(i, r)| item(format!("createWorktree:{i}"), r.name.clone()))
            .collect();
        children.push(item("createWorktreeCommit", "this commit"));
        return vec![sub("Create worktree from", children)];
    }
    let mut out: Vec<MenuSpec> = refs
        .iter()
        .enumerate()
        .map(|(i, r)| {
            item(
                format!("createWorktree:{i}"),
                format!("Create worktree from {}", r.name),
            )
        })
        .collect();
    if !panel {
        out.push(item(
            "createWorktreeCommit",
            "Create worktree from this commit",
        ));
    }
    out
}

fn delete_items(group: &[RefIn], local: Option<&RefIn>) -> Vec<MenuSpec> {
    let upstream = local
        .and_then(|l| l.upstream.as_deref().filter(|u| !u.is_empty()))
        .and_then(|u| group.iter().find(|r| r.name == u));
    let mut out: Vec<MenuSpec> = group
        .iter()
        .filter(|r| r.current != Some(true))
        .enumerate()
        .map(|(i, r)| item(format!("delete:{i}"), format!("Delete {}", r.name)))
        .collect();
    if let (Some(local), Some(upstream)) = (local, upstream)
        && local.current != Some(true)
    {
        out.push(item(
            "deleteWithUpstream",
            format!("Delete {} and {}", local.name, upstream.name),
        ));
    }
    out
}

pub(super) fn solo_items(env: &Env, group: &[RefIn], panel: bool) -> Vec<MenuSpec> {
    let solo = |r: &RefIn| {
        if env.solo.contains(&r.full) {
            "Stop soloing"
        } else {
            "Solo"
        }
    };
    if let [r] = group {
        let hidden = if env.hidden.contains(&r.full) {
            "Show"
        } else {
            "Hide"
        };
        return flat(vec![
            panel.then(|| item("toggleHidden", hidden)),
            Some(item("solo", solo(r))),
        ]);
    }
    let children = group
        .iter()
        .enumerate()
        .map(|(i, r)| item(format!("solo:{i}"), format!("{} {}", solo(r), r.name)))
        .collect();
    vec![sub("Solo", children)]
}

fn branch_groups(
    env: &Env,
    group: &[RefIn],
    info: &RangeInfo,
    submenu: bool,
    panel: bool,
) -> Vec<MenuSpec> {
    let head = &group[0];
    let local = group.iter().find(|r| r.kind == RefKind::Local);
    let remote = group.iter().find(|r| r.kind == RefKind::Remote);
    let parents = parents_of(env, &head.sha);
    let in_group = group.iter().any(|r| r.current == Some(true))
        || env.head.as_deref() == Some(head.sha.as_str());
    let pull = if local.is_some() && !env.remotes.is_empty() {
        vec![
            item("pull", "Pull (fast-forward if possible)"),
            item("push", "Push"),
            item("setUpstream", "Set Upstream"),
        ]
    } else {
        Vec::new()
    };
    let merge = if !in_group && has(&env.branch) {
        merge_items(env, head, info)
    } else {
        Vec::new()
    };
    let commit = if submenu {
        Vec::new()
    } else {
        commit_actions(env, info, Variant::Branch)
    };
    let pr = remote.and_then(|remote| {
        pr_item(
            env,
            base_name(remote),
            remote.name.split('/').next().unwrap_or_default(),
        )
    });
    let mut rename_delete: Vec<MenuSpec> = local
        .map(|l| item("renameBranch", format!("Rename {}", l.name)))
        .into_iter()
        .collect();
    rename_delete.extend(delete_items(group, local));
    groups(vec![
        pull,
        merge,
        checkout_items(group, panel),
        worktree_items(group, panel),
        commit,
        rebase_actions(env, &head.sha, parents, info),
        pr.into_iter().collect(),
        rename_delete,
        flat(vec![
            Some(item("copyBranchName", "Copy branch name")),
            Some(item("copySha", "Copy commit sha")),
            (!panel).then(|| item("savePatch", "Create patch from commit")),
        ]),
        solo_items(env, group, panel),
    ])
}

fn same_sha_groups(env: &Env, sha: &str) -> Vec<Vec<RefIn>> {
    let refs: Vec<RefIn> = env
        .refs
        .iter()
        .filter(|r| r.sha == sha && r.kind != RefKind::Tag)
        .cloned()
        .collect();
    ref_groups(&refs)
}

fn compare_actions(wip: bool) -> Vec<MenuSpec> {
    if wip {
        vec![item(
            "compareWip",
            "Compare commit against working directory",
        )]
    } else {
        Vec::new()
    }
}

pub(super) async fn commit_menu(
    cwd: &str,
    env: &Env,
    commit: &CommitRow,
    wip: bool,
) -> Res<Vec<MenuSpec>> {
    let info = range_info(cwd, &commit.sha).await?;
    let found = same_sha_groups(env, &commit.sha);
    if let [only] = found.as_slice() {
        let mut out = branch_groups(env, only, &info, false, false);
        let compare = compare_actions(wip);
        if !compare.is_empty() {
            out.push(sep());
            out.extend(compare);
        }
        out.push(sep());
        out.extend(tag_actions());
        return Ok(out);
    }
    let submenus = found
        .iter()
        .enumerate()
        .map(|(i, g)| {
            sub(
                g[0].name.clone(),
                scoped(branch_groups(env, g, &info, true, false), &format!("g{i}:")),
            )
        })
        .collect();
    Ok(groups(vec![
        vec![item("checkoutCommit", "Checkout this commit")],
        vec![item(
            "createWorktreeCommit",
            "Create worktree from this commit",
        )],
        commit_actions(env, &info, Variant::Commit),
        rebase_actions(env, &commit.sha, commit.parents, &info),
        submenus,
        if found.is_empty() {
            copy_actions(env, &commit.sha)
        } else {
            Vec::new()
        },
        compare_actions(wip),
        tag_actions(),
    ]))
}

pub(super) async fn ref_menu(
    cwd: &str,
    env: &Env,
    reference: &RefIn,
    panel: bool,
) -> Res<Vec<MenuSpec>> {
    let info = range_info(cwd, &reference.sha).await?;
    let group = if panel {
        vec![reference.clone()]
    } else {
        same_sha_groups(env, &reference.sha)
            .into_iter()
            .find(|g| g.iter().any(|r| r.full == reference.full))
            .unwrap_or_else(|| vec![reference.clone()])
    };
    Ok(branch_groups(env, &group, &info, false, panel))
}

pub(super) fn refs_menu(env: &Env, fulls: &[String]) -> Vec<MenuSpec> {
    let picked: Vec<&RefIn> = env
        .refs
        .iter()
        .filter(|r| fulls.contains(&r.full))
        .collect();
    let n = picked.len();
    let count = |test: &dyn Fn(&RefIn) -> bool| picked.iter().filter(|r| test(r)).count();
    let hidden = count(&|r| env.hidden.contains(&r.full));
    let soloed = count(&|r| env.solo.contains(&r.full));
    let delete = picked
        .iter()
        .all(|r| r.current != Some(true))
        .then(|| item("deleteMany", format!("Delete {n} local branches")));
    groups(vec![
        delete.into_iter().collect(),
        flat(vec![
            (hidden > 0).then(|| item("showMany", format!("Show {n} branches"))),
            (hidden < n).then(|| item("hideMany", format!("Hide {n} branches"))),
            (soloed < n).then(|| item("soloMany", format!("Solo {n} branches"))),
            (soloed > 0).then(|| item("unsoloMany", format!("Stop soloing {n} branches"))),
        ]),
    ])
}

pub(super) fn folder_menu(name: &str, count: usize) -> Vec<MenuSpec> {
    let label = if count == 1 {
        format!("Delete 1 branch in folder \"{name}\"")
    } else {
        format!("Delete {count} branches in folder \"{name}\"")
    };
    vec![item("deleteFolder", label)]
}

fn drop_group(env: &Env, r: &RefIn) -> Vec<RefIn> {
    let refs: Vec<RefIn> = env
        .refs
        .iter()
        .filter(|x| x.sha == r.sha && x.kind != RefKind::Tag)
        .cloned()
        .collect();
    ref_groups(&refs)
        .into_iter()
        .find(|g| g.iter().any(|x| x.full == r.full))
        .unwrap_or_else(|| vec![r.clone()])
}

fn has_web(env: &Env, r: &RefIn) -> bool {
    let name = r.name.split('/').next().unwrap_or_default();
    env.remotes
        .iter()
        .find(|x| x.name == name)
        .is_some_and(|x| compare_url(&x.url, base_name(r)).is_some())
}

pub(super) fn drop_pr_items(env: &Env, source: &RefIn, target: &RefIn) -> Vec<MenuSpec> {
    let from = drop_group(env, source);
    let to = drop_group(env, target);
    let heads: Vec<&RefIn> = from.iter().filter(|r| r.kind == RefKind::Remote).collect();
    let bases: Vec<&RefIn> = to.iter().filter(|r| r.kind == RefKind::Remote).collect();
    let local = from.iter().find(|r| r.kind == RefKind::Local);
    let start = |i: usize, j: usize| {
        (has_web(env, heads[i]) && has_web(env, bases[j])).then(|| {
            item(
                format!("pr:{i}:{j}"),
                format!(
                    "Start a pull request to {} from {}",
                    bases[j].name, heads[i].name
                ),
            )
        })
    };
    let push = |j: usize| {
        let local = local?;
        (local.upstream.as_deref().is_some_and(|u| !u.is_empty()) && has_web(env, bases[j])).then(
            || {
                item(
                    format!("prPush:{j}"),
                    format!(
                        "Push {} and start a pull request to {}",
                        local.name, bases[j].name
                    ),
                )
            },
        )
    };
    match (heads.len(), bases.len()) {
        (_, 0) => Vec::new(),
        (1, 1) => flat(vec![start(0, 0)]),
        (0, 1) => flat(vec![push(0)]),
        (0, _) => {
            let items = flat((0..bases.len()).map(push).collect());
            if items.is_empty() {
                items
            } else {
                vec![sub(
                    format!(
                        "Push {} and start a pull request",
                        local.map_or("", |l| &l.name)
                    ),
                    items,
                )]
            }
        }
        (1, n) => {
            let items = flat((0..n).map(|j| start(0, j)).collect());
            if items.is_empty() {
                items
            } else {
                vec![sub(
                    format!("Start a pull request from {}", heads[0].name),
                    items,
                )]
            }
        }
        (m, 1) => {
            let items = flat((0..m).map(|i| start(i, 0)).collect());
            if items.is_empty() {
                items
            } else {
                vec![sub(
                    format!("Start a pull request to {}", bases[0].name),
                    items,
                )]
            }
        }
        (m, n) => (0..n)
            .filter_map(|j| {
                let items = flat((0..m).map(|i| start(i, j)).collect());
                (!items.is_empty())
                    .then(|| sub(format!("Start a pull request to {}", bases[j].name), items))
            })
            .collect(),
    }
}
