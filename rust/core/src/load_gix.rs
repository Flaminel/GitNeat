use crate::load::{CommitPage, Operation, RepoData, graph_rows, non_blank, values};
use gix::ObjectId;
use gix::bstr::{BString, ByteSlice};
use gix::remote::Direction;
use gix_status::index_as_worktree::{Change, Conflict, EntryStatus};
use graph::port::Lanes;
use repo::port::{
    Commit, Ref, Stash, insert_stashes, parse_remotes, parse_stashes, parse_worktrees, read_log,
    read_refs, read_status,
};
use std::cmp::Reverse;
use std::collections::{BTreeMap, BinaryHeap, HashMap, HashSet};
use std::path::Path;

const FS: &str = "\x1f";
const RS: &str = "\x1e";

type Info = HashMap<ObjectId, (i64, Vec<ObjectId>)>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn long_path(p: &Path) -> std::path::PathBuf {
    #[cfg(windows)]
    {
        if let Ok(full) = std::fs::canonicalize(p) {
            let text = full.to_string_lossy().into_owned();
            if let Some(rest) = text.strip_prefix(r"\\?\")
                && !rest.starts_with("UNC\\")
            {
                return std::path::PathBuf::from(rest);
            }
        }
    }
    p.to_path_buf()
}

fn norm(p: &Path) -> String {
    p.to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string()
}

struct Wt {
    path: String,
    sha: String,
    branch: Option<String>,
    locked: bool,
    prunable: bool,
}

fn wt_of(path: String, r: &gix::Repository, locked: bool, prunable: bool) -> Wt {
    Wt {
        path,
        sha: r.head_id().map_or_else(
            |_| ObjectId::null(r.object_hash()).to_string(),
            |i| i.to_string(),
        ),
        branch: r
            .head_name()
            .ok()
            .flatten()
            .map(|n| n.as_bstr().to_string()),
        locked,
        prunable,
    }
}

fn worktrees(repo: &gix::Repository) -> Result<Vec<Wt>, String> {
    let main = repo.main_repo().map_err(err)?;
    let root = main.workdir().ok_or("bare repository")?;
    let mut list = vec![wt_of(norm(&long_path(root)), &main, false, false)];
    for proxy in main.worktrees().map_err(err)? {
        let (locked, prunable) = (proxy.is_locked(), proxy.is_prunable());
        let base = proxy.base().map_err(err)?;
        let linked = proxy
            .into_repo_with_possibly_inaccessible_worktree()
            .map_err(err)?;
        list.push(wt_of(norm(&base), &linked, locked, prunable));
    }
    Ok(list)
}

fn worktree_text(list: &[Wt]) -> String {
    list.iter()
        .map(|w| {
            let mut block = format!("worktree {}\nHEAD {}", w.path, w.sha);
            if let Some(branch) = &w.branch {
                block.push_str(&format!("\nbranch {branch}"));
            }
            if w.locked {
                block.push_str("\nlocked");
            }
            if w.prunable {
                block.push_str("\nprunable");
            }
            block
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn count(repo: &gix::Repository, tip: ObjectId, hidden: ObjectId) -> Result<u32, String> {
    let mut n = 0;
    for item in repo
        .rev_walk([tip])
        .with_hidden([hidden])
        .all()
        .map_err(err)?
    {
        item.map_err(err)?;
        n += 1;
    }
    Ok(n)
}

fn upstream(repo: &gix::Repository, name: &gix::refs::FullNameRef) -> Option<String> {
    let short = name.shorten().to_string();
    let snap = repo.config_snapshot();
    let local = snap
        .string(format!("branch.{short}.remote").as_str())
        .is_some_and(|v| v.as_bytes() == b".");
    if local {
        return snap
            .string(format!("branch.{short}.merge").as_str())
            .map(|m| m.to_string());
    }
    match repo.branch_remote_tracking_ref_name(name, Direction::Fetch) {
        Some(Ok(t)) => Some(t.as_bstr().to_string()),
        _ => None,
    }
}

fn refs_text(
    repo: &gix::Repository,
    wts: &[Wt],
) -> Result<(String, Vec<(String, ObjectId)>), String> {
    let head_name = repo
        .head_name()
        .ok()
        .flatten()
        .map(|n| n.as_bstr().to_string());
    let checked_out: HashMap<&str, &str> = wts
        .iter()
        .filter_map(|w| Some((w.branch.as_deref()?, w.path.as_str())))
        .collect();
    let mut lines = Vec::new();
    let mut rows = Vec::new();
    for prefix in ["refs/heads/", "refs/remotes/", "refs/tags/"] {
        let platform = repo.references().map_err(err)?;
        for item in platform.prefixed(prefix).map_err(err)? {
            let mut r = item.map_err(err)?;
            let full = r.name().as_bstr().to_string();
            let Ok(id) = r.peel_to_id() else {
                continue;
            };
            let sha = id.detach();
            let mut line = format!("{full}{FS}{sha}{FS}{FS}");
            if prefix == "refs/heads/" {
                let up = upstream(repo, r.name());
                let (mut ahead, mut behind) = (0, 0);
                if let Some(up) = &up
                    && let Ok(Some(mut target)) = repo.try_find_reference(up.as_str())
                    && let Ok(tid) = target.peel_to_id()
                {
                    let tid = tid.detach();
                    ahead = count(repo, sha, tid)?;
                    behind = count(repo, tid, sha)?;
                }
                let short = up
                    .and_then(|u| gix::refs::FullName::try_from(BString::from(u)).ok())
                    .map(|u| u.shorten().to_string())
                    .unwrap_or_default();
                let current = if head_name.as_deref() == Some(full.as_str()) {
                    "*"
                } else {
                    ""
                };
                let path = checked_out.get(full.as_str()).copied().unwrap_or("");
                line.push_str(&format!(
                    "{short}{FS}ahead {ahead}, behind {behind}{FS}{current}{FS}{path}"
                ));
            }
            lines.push(line);
            rows.push((full, sha));
        }
    }
    Ok((lines.join("\n"), rows))
}

fn stash_text(repo: &gix::Repository) -> Result<String, String> {
    let mut lines = Vec::new();
    if let Some(r) = repo.try_find_reference("refs/stash").map_err(err)?
        && let Some(iter) = r.log_iter().rev().map_err(err)?
    {
        for (i, entry) in iter.enumerate() {
            let entry = entry.map_err(err)?;
            let sha = entry.new_oid;
            let base = repo
                .find_commit(sha)
                .map_err(err)?
                .parent_ids()
                .next()
                .map(|p| p.to_string())
                .unwrap_or_default();
            lines.push(format!(
                "{sha}{FS}stash@{{{i}}}{FS}{base}{FS}{}",
                entry.message
            ));
        }
    }
    Ok(lines.join("\n"))
}

fn remote_text(repo: &gix::Repository) -> Result<String, String> {
    let mut lines = Vec::new();
    for name in repo.remote_names() {
        let remote = repo.find_remote(name.as_bstr()).map_err(err)?;
        if let Some(url) = remote.url(Direction::Fetch) {
            lines.push(format!("{name}\t{} (fetch)", url.to_bstring()));
        }
    }
    Ok(lines.join("\n"))
}

fn submodule_paths(cwd: &str) -> Result<Vec<String>, String> {
    let path = Path::new(cwd).join(".gitmodules");
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let file =
        gix::config::File::from_path_no_includes(path, gix::config::Source::Local).map_err(err)?;
    let mut paths = Vec::new();
    for section in file.sections_by_name("submodule").into_iter().flatten() {
        if section.header().subsection_name().is_none() {
            continue;
        }
        for value in section.body().values("path") {
            paths.push(value.to_str_lossy().into_owned());
        }
    }
    Ok(paths)
}

fn status_text(repo: &gix::Repository) -> Result<String, String> {
    use gix::status::{Item, index_worktree::Item as IW};
    let mut tracked: BTreeMap<Vec<u8>, (char, char, Option<String>)> = BTreeMap::new();
    let mut untracked: Vec<String> = Vec::new();
    let iter = repo
        .status(gix::progress::Discard)
        .map_err(err)?
        .untracked_files(gix::status::UntrackedFiles::Files)
        .into_iter(None::<BString>)
        .map_err(err)?;
    for item in iter {
        match item.map_err(err)? {
            Item::TreeIndex(change) => {
                use gix::diff::index::Change as C;
                let entry = tracked
                    .entry(change.location().to_vec())
                    .or_insert((' ', ' ', None));
                match change {
                    C::Addition { .. } => entry.0 = 'A',
                    C::Deletion { .. } => entry.0 = 'D',
                    C::Modification {
                        previous_entry_mode,
                        entry_mode,
                        ..
                    } => {
                        entry.0 = if previous_entry_mode.bits() & 0o170000
                            != entry_mode.bits() & 0o170000
                        {
                            'T'
                        } else {
                            'M'
                        }
                    }
                    C::Rewrite {
                        source_location,
                        copy,
                        ..
                    } => {
                        entry.0 = if copy { 'C' } else { 'R' };
                        entry.2 = Some(source_location.to_string());
                    }
                }
            }
            Item::IndexWorktree(IW::Modification {
                rela_path, status, ..
            }) => {
                let entry = tracked
                    .entry(rela_path.to_vec())
                    .or_insert((' ', ' ', None));
                match status {
                    EntryStatus::Conflict { summary, .. } => {
                        (entry.0, entry.1) = match summary {
                            Conflict::BothDeleted => ('D', 'D'),
                            Conflict::AddedByUs => ('A', 'U'),
                            Conflict::DeletedByThem => ('U', 'D'),
                            Conflict::AddedByThem => ('U', 'A'),
                            Conflict::DeletedByUs => ('D', 'U'),
                            Conflict::BothAdded => ('A', 'A'),
                            Conflict::BothModified => ('U', 'U'),
                        };
                    }
                    EntryStatus::Change(change) => {
                        entry.1 = match change {
                            Change::Removed => 'D',
                            Change::Type { .. } => 'T',
                            _ => 'M',
                        };
                    }
                    EntryStatus::IntentToAdd => entry.1 = 'A',
                    EntryStatus::NeedsUpdate(_) => {}
                }
            }
            Item::IndexWorktree(IW::DirectoryContents { entry, .. }) => {
                if matches!(entry.status, gix::dir::entry::Status::Untracked) {
                    let mut path = entry.rela_path.to_string();
                    if matches!(entry.disk_kind, Some(gix::dir::entry::Kind::Repository)) {
                        path.push('/');
                    }
                    untracked.push(path);
                }
            }
            Item::IndexWorktree(IW::Rewrite { .. }) => {}
        }
    }
    let mut out = String::new();
    for (path, (x, y, orig)) in tracked {
        if x == ' ' && y == ' ' {
            continue;
        }
        out.push_str(&format!("{x}{y} {}\0", String::from_utf8_lossy(&path)));
        if let Some(orig) = orig {
            out.push_str(&orig);
            out.push('\0');
        }
    }
    untracked.sort();
    for path in untracked {
        out.push_str(&format!("?? {path}\0"));
    }
    Ok(out)
}

fn operation(repo: &gix::Repository) -> Option<Operation> {
    let dir = repo.path();
    for (file, op) in [
        ("MERGE_HEAD", Operation::Merge),
        ("CHERRY_PICK_HEAD", Operation::CherryPick),
        ("REVERT_HEAD", Operation::Revert),
    ] {
        if dir.join(file).is_file() {
            return Some(op);
        }
    }
    let rebasing = dir.join("rebase-merge").is_dir()
        || (dir.join("rebase-apply").is_dir() && !dir.join("rebase-apply/applying").is_file());
    rebasing.then_some(Operation::Rebase)
}

fn git_subject(message: &str) -> String {
    let mut out = String::new();
    let mut started = false;
    for line in message.split('\n') {
        let line = line.trim_end();
        if line.trim().is_empty() {
            if started {
                break;
            }
            continue;
        }
        if started {
            out.push(' ');
        }
        started = true;
        out.push_str(line);
    }
    out
}

fn record(repo: &gix::Repository, id: ObjectId) -> Result<String, String> {
    let commit = repo.find_commit(id).map_err(err)?;
    let author = commit.author().map_err(err)?;
    let parents: Vec<String> = commit.parent_ids().map(|p| p.to_string()).collect();
    let message = commit.message_raw_sloppy().to_str_lossy();
    Ok(format!(
        "{id}{FS}{}{FS}{}{FS}{}{FS}{}{FS}{}{FS}{message}{RS}",
        parents.join(" "),
        author.name.to_str_lossy(),
        author.email.to_str_lossy(),
        author.seconds(),
        git_subject(&message)
    ))
}

fn load(repo: &gix::Repository, id: ObjectId, info: &mut Info) -> Result<i64, String> {
    if let Some(known) = info.get(&id) {
        return Ok(known.0);
    }
    let commit = repo.find_commit(id).map_err(err)?;
    let date = commit.committer().map_err(err)?.seconds();
    let parents = commit.parent_ids().map(|p| p.detach()).collect();
    info.insert(id, (date, parents));
    Ok(date)
}

fn date_order(
    repo: &gix::Repository,
    tips: Vec<ObjectId>,
    limit: usize,
) -> Result<Vec<ObjectId>, String> {
    let mut info = Info::new();
    let mut seen = HashSet::new();
    let mut queue: BTreeMap<(Reverse<i64>, u64), ObjectId> = BTreeMap::new();
    let mut counter = 0u64;
    for tip in tips {
        if repo.find_commit(tip).is_ok() && seen.insert(tip) {
            let date = load(repo, tip, &mut info)?;
            queue.insert((Reverse(date), counter), tip);
            counter += 1;
        }
    }
    let mut list = Vec::new();
    while let Some((_, id)) = queue.pop_first() {
        list.push(id);
        let parents = info.get(&id).map(|v| v.1.clone()).unwrap_or_default();
        for parent in parents {
            if seen.insert(parent) {
                let date = load(repo, parent, &mut info)?;
                queue.insert((Reverse(date), counter), parent);
                counter += 1;
            }
        }
    }
    let date_of = |id: &ObjectId| info.get(id).map_or(0, |v| v.0);
    let mut indegree: HashMap<ObjectId, u32> = list.iter().map(|c| (*c, 1)).collect();
    for id in &list {
        for parent in info.get(id).map(|v| v.1.as_slice()).unwrap_or_default() {
            if let Some(n) = indegree.get_mut(parent)
                && *n != 0
            {
                *n += 1;
            }
        }
    }
    let mut heap: BinaryHeap<(i64, Reverse<u64>, ObjectId)> = BinaryHeap::new();
    let mut order = 0u64;
    for id in &list {
        if indegree.get(id) == Some(&1) {
            heap.push((date_of(id), Reverse(order), *id));
            order += 1;
        }
    }
    let mut out = Vec::new();
    while let Some((_, _, id)) = heap.pop() {
        for parent in info.get(&id).map(|v| v.1.as_slice()).unwrap_or_default() {
            if let Some(n) = indegree.get_mut(parent)
                && *n != 0
            {
                *n -= 1;
                if *n == 1 {
                    heap.push((date_of(parent), Reverse(order), *parent));
                    order += 1;
                }
            }
        }
        indegree.insert(id, 0);
        out.push(id);
        if out.len() == limit {
            break;
        }
    }
    Ok(out)
}

fn check_supported(repo: &gix::Repository) -> Result<(), String> {
    if repo.workdir().is_none() {
        return Err("bare repository".into());
    }
    if repo.is_shallow().map_err(err)? {
        return Err("shallow repository".into());
    }
    if repo.common_dir().join("info/grafts").exists() {
        return Err("grafts".into());
    }
    if repo
        .config_snapshot()
        .boolean("core.sparseCheckout")
        .unwrap_or(false)
    {
        return Err("sparse checkout".into());
    }
    let platform = repo.references().map_err(err)?;
    if platform
        .prefixed("refs/replace/")
        .map_err(err)?
        .next()
        .is_some()
    {
        return Err("replace refs".into());
    }
    Ok(())
}

fn open(cwd: &str) -> Result<gix::Repository, String> {
    let mut repo = gix::open(cwd).map_err(err)?;
    repo.object_cache_size_if_unset(32 * 1024 * 1024);
    check_supported(&repo)?;
    Ok(repo)
}

struct Tips {
    refs: Vec<Ref>,
    head_id: Option<ObjectId>,
    head: Option<String>,
    stashes: Vec<Stash>,
    wts: Vec<Wt>,
}

fn tips(repo: &gix::Repository) -> Result<(Tips, Vec<(String, ObjectId)>), String> {
    let wts = worktrees(repo)?;
    let (ref_out, rows) = refs_text(repo, &wts)?;
    let head_id = repo.head_id().ok().map(|i| i.detach());
    Ok((
        Tips {
            refs: read_refs(&ref_out),
            head_id,
            head: head_id.map(|i| i.to_string()).and_then(|h| non_blank(&h)),
            stashes: parse_stashes(&stash_text(repo)?)?,
            wts,
        },
        rows,
    ))
}

fn log_gix(
    repo: &gix::Repository,
    known: &Tips,
    rows: &[(String, ObjectId)],
    hidden: &[String],
    solo: &[String],
    skip: u32,
    limit: u32,
) -> Result<Vec<Commit>, String> {
    let mut tips: Vec<ObjectId> = if !solo.is_empty() || !hidden.is_empty() {
        let by_name: HashMap<&str, ObjectId> =
            rows.iter().map(|(n, id)| (n.as_str(), *id)).collect();
        known
            .refs
            .iter()
            .filter(|r| {
                if solo.is_empty() {
                    !hidden.contains(&r.full)
                } else {
                    solo.contains(&r.full)
                }
            })
            .filter_map(|r| by_name.get(r.full.as_str()).copied())
            .collect()
    } else {
        rows.iter().map(|(_, id)| *id).collect()
    };
    if let Some(id) = known.head_id {
        tips.push(id);
    }
    let mut log_out = String::new();
    let order = date_order(repo, tips, skip as usize + limit as usize)?;
    for id in order.into_iter().skip(skip as usize) {
        log_out.push_str(&record(repo, id)?);
    }
    let mut commits = read_log(&log_out);
    let mut detail_out = String::new();
    for stash in &known.stashes {
        let id = ObjectId::from_hex(stash.sha.as_bytes()).map_err(err)?;
        detail_out.push_str(&record(repo, id)?);
    }
    let details: HashMap<String, Commit> = read_log(&detail_out)
        .into_iter()
        .map(|c| (c.sha.clone(), c))
        .collect();
    if !hidden.iter().any(|h| h == "refs/stash") {
        insert_stashes(&mut commits, &known.stashes, &details);
    }
    Ok(commits)
}

pub fn load_commits_gix(
    cwd: &str,
    hidden: &[String],
    solo: &[String],
    skip: u32,
    limit: u32,
    mut lanes: Lanes,
) -> Result<CommitPage, String> {
    let repo = open(cwd)?;
    let (known, rows) = tips(&repo)?;
    let commits = log_gix(&repo, &known, &rows, hidden, solo, skip, limit)?;
    let rows = graph_rows(&mut lanes, &commits, None, false);
    Ok(CommitPage {
        commits: values(&commits),
        rows,
        lanes,
    })
}

pub fn load_repo_gix(
    cwd: &str,
    hidden: &[String],
    solo: &[String],
    limit: u32,
) -> Result<RepoData, String> {
    let gix_repo = open(cwd)?;
    let repo = &gix_repo;
    let (known, rows) = tips(repo)?;
    let branch = repo
        .head_name()
        .ok()
        .flatten()
        .map(|n| n.shorten().to_string());
    let commits = log_gix(repo, &known, &rows, hidden, solo, 0, limit)?;
    let status = read_status(&status_text(repo)?);
    let operation = operation(repo);
    let mut lanes = Lanes::new();
    let rows = graph_rows(
        &mut lanes,
        &commits,
        known.head.as_deref(),
        !status.is_empty() || operation.is_some(),
    );
    Ok(RepoData {
        cwd: cwd.to_string(),
        name: cwd.rsplit(['/', '\\']).next().unwrap_or(cwd).to_string(),
        head: known.head,
        branch,
        commits: values(&commits),
        refs: values(&known.refs),
        stashes: values(&known.stashes),
        worktrees: values(&parse_worktrees(&worktree_text(&known.wts))),
        remotes: values(&parse_remotes(&remote_text(repo)?)),
        submodules: submodule_paths(cwd)?,
        status: values(&status),
        operation,
        rows,
        lanes,
    })
}
