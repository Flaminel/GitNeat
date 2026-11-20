use super::branch::{reset_item, solo_items};
use super::{Env, RefIn, flat, groups, item, sub};
use crate::menu::MenuSpec;

pub(super) fn tag_menu(env: &Env, tag: &RefIn, panel: bool) -> Vec<MenuSpec> {
    let remotes = &env.remotes;
    let is_head = env.head.as_deref() == Some(tag.sha.as_str());
    let push = match remotes.as_slice() {
        [] => Vec::new(),
        [only] => vec![item(
            "pushTag:0",
            format!("Push {} to {}", tag.name, only.name),
        )],
        many => vec![sub(
            "Push tag to remote",
            many.iter()
                .enumerate()
                .map(|(i, r)| item(format!("pushTag:{i}"), r.name.clone()))
                .chain(std::iter::once(item(
                    "pushTagAll",
                    format!("Push {} to all remotes", tag.name),
                )))
                .collect(),
        )],
    };
    let delete_remote = (!remotes.is_empty()).then(|| {
        sub(
            "Delete tag from remote",
            remotes
                .iter()
                .enumerate()
                .map(|(i, r)| {
                    item(
                        format!("deleteTagRemote:{i}"),
                        format!("Delete {} from {}", tag.name, r.name),
                    )
                })
                .collect(),
        )
    });
    groups(vec![
        push,
        vec![item(
            "checkoutCommit",
            format!("Checkout the commit at {}", tag.name),
        )],
        vec![item(
            "createWorktreeCommit",
            "Create worktree from this commit",
        )],
        flat(vec![
            Some(item("createBranch", "Create branch here")),
            (!is_head).then(|| item("cherryPick", "Cherry pick commit")),
            reset_item(env),
            Some(item("revert", "Revert commit")),
        ]),
        flat(vec![
            Some(item("deleteTag", format!("Delete {} locally", tag.name))),
            delete_remote,
        ]),
        vec![item("copyTagName", "Copy tag name")],
        solo_items(env, std::slice::from_ref(tag), panel),
    ])
}
