use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;
use std::time::Instant;

use gix::bstr::{BStr, ByteSlice};
use gix::bstr::ByteSlice as _;
use gix::remote::Direction;

const FS: &str = "\x1f";

fn cli(cwd: &str, args: &[&str], stdin: Option<&str>) -> String {
    use std::io::Write;
    use std::process::Stdio;
    let mut c = Command::new("git");
    c.current_dir(cwd).args(args).env("GIT_OPTIONAL_LOCKS", "0").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    let mut ch = c.spawn().unwrap();
    let mut si = ch.stdin.take().unwrap();
    let data = stdin.unwrap_or("").to_string();
    let t = std::thread::spawn(move || { let _ = si.write_all(data.as_bytes()); });
    let out = ch.wait_with_output().unwrap();
    let _ = t.join();
    if out.status.success() { String::from_utf8_lossy(&out.stdout).into_owned() } else { String::new() }
}

// ---------- refs ----------
fn cli_refs(cwd: &str) -> String {
    let fmt = format!("--format=%(refname){FS}%(objectname){FS}%(*objectname){FS}%(upstream:short){FS}%(upstream:track,nobracket){FS}%(HEAD){FS}%(worktreepath)");
    let out = cli(cwd, &["for-each-ref", &fmt, "refs/heads", "refs/remotes", "refs/tags"], None);
    out.lines().map(|l| {
        let p: Vec<&str> = l.split(FS).collect();
        let sha = if p[2].is_empty() { p[1] } else { p[2] };
        if p[0].starts_with("refs/heads/") {
            let a = p[4].split("ahead ").nth(1).and_then(|s| s.split(|c: char| !c.is_ascii_digit()).next()).and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
            let b = p[4].split("behind ").nth(1).and_then(|s| s.split(|c: char| !c.is_ascii_digit()).next()).and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
            format!("{}|{}|{}|{}|{}|{}|{}", p[0], sha, p[3], a, b, p[5].trim(), p[6])
        } else if p[0].ends_with("/HEAD") && p[0].starts_with("refs/remotes/") { String::new() } else { format!("{}|{}", p[0], sha) }
    }).filter(|s| !s.is_empty()).collect::<Vec<_>>().join("\n")
}

fn wt_map(repo: &gix::Repository) -> BTreeMap<String, String> {
    // branch full name -> worktree path (main + linked)
    let mut m = BTreeMap::new();
    if let Some(wd) = repo.workdir() {
        if let Ok(Some(n)) = repo.head_name() { m.insert(n.as_bstr().to_string(), norm(wd)); }
    }
    if let Ok(list) = repo.worktrees() {
        for p in list {
            let base = p.base().ok().map(|b| norm(&b)).unwrap_or_default();
            if let Ok(r) = p.into_repo_with_possibly_inaccessible_worktree() {
                if let Ok(Some(n)) = r.head_name() { m.insert(n.as_bstr().to_string(), base); }
            }
        }
    }
    m
}
fn norm(p: &Path) -> String { p.to_string_lossy().replace('\\', "/").trim_end_matches('/').to_string() }

fn gix_refs(repo: &gix::Repository) -> String {
    let mut out = vec![];
    let head_name = repo.head_name().ok().flatten().map(|n| n.as_bstr().to_string());
    let wts = wt_map(repo);
    for prefix in ["refs/heads/", "refs/remotes/", "refs/tags/"] {
        let platform = repo.references().unwrap();
        for r in platform.prefixed(prefix).unwrap() {
            let mut r = r.unwrap();
            let full = r.name().as_bstr().to_string();
            if prefix == "refs/remotes/" && full.ends_with("/HEAD") { continue; }
            // one-level peel like %(*objectname)
            let id = match r.try_id() { Some(i) => i.detach(), None => r.follow().unwrap().unwrap().id().detach() };
            let sha = if prefix == "refs/tags/" {
                // git peels ALL tag levels for %(*objectname) (verified with a tag of a tag)
                r.peel_to_id().map(|i| i.detach()).unwrap_or(id)
            } else { id };
            if prefix == "refs/heads/" {
                let mut up = String::new(); let (mut a, mut b) = (0u32, 0u32);
                let local_up = { let snap = repo.config_snapshot(); let short = full.trim_start_matches("refs/heads/").to_string();
                    if snap.string(format!("branch.{short}.remote").as_str()).map(|v| v.as_bytes() == b".").unwrap_or(false) {
                        snap.string(format!("branch.{short}.merge").as_str()).and_then(|m| gix::refs::FullName::try_from(m.to_owned()).ok()) } else { None } };
                let tracking = match local_up { Some(l) => Some(Ok(l)), None => repo.branch_remote_tracking_ref_name(r.name(), Direction::Fetch) };
                if let Some(Ok(t)) = tracking {
                    up = t.shorten().to_string();
                    if let Ok(Some(mut tr)) = repo.try_find_reference(t.as_ref()) {
                        let tid = tr.peel_to_id().unwrap().detach();
                        a = repo.rev_walk([sha]).with_hidden([tid]).all().unwrap().count() as u32;
                        b = repo.rev_walk([tid]).with_hidden([sha]).all().unwrap().count() as u32;
                    }
                }
                let cur = if head_name.as_deref() == Some(&full) { "*" } else { "" };
                out.push(format!("{full}|{sha}|{up}|{a}|{b}|{cur}|{}", wts.get(&full).cloned().unwrap_or_default()));
            } else { out.push(format!("{full}|{sha}")); }
        }
        let _ = &mut r_unused();
    }
    out.join("\n")
}
fn r_unused() {}

// ---------- head / branch ----------
fn cli_head(cwd: &str) -> (String, String) {
    (cli(cwd, &["rev-parse", "--verify", "-q", "HEAD"], None).trim().into(), cli(cwd, &["symbolic-ref", "-q", "--short", "HEAD"], None).trim().into())
}
fn gix_head(repo: &gix::Repository) -> (String, String) {
    let id = repo.head_id().ok().map(|i| i.to_string()).unwrap_or_default();
    let br = repo.head_name().ok().flatten().map(|n| n.shorten().to_string()).unwrap_or_default();
    (id, br)
}

// ---------- stash ----------
fn cli_stash(cwd: &str) -> String {
    cli(cwd, &["stash", "list", &format!("--format=%H{FS}%gd{FS}%P{FS}%gs")], None).lines().map(|l| {
        let p: Vec<&str> = l.split(FS).collect(); format!("{}|{}|{}|{}", p[0], p[1], p[2].split(' ').next().unwrap(), p[3])
    }).collect::<Vec<_>>().join("\n")
}
fn gix_stash(repo: &gix::Repository) -> String {
    let mut out = vec![];
    if let Ok(Some(r)) = repo.try_find_reference("refs/stash") {
        let mut platform = r.log_iter();
        if let Ok(Some(iter)) = platform.rev() {
            for (i, e) in iter.enumerate() {
                let e = e.unwrap();
                let sha = e.new_oid;
                let c = repo.find_commit(sha).unwrap();
                let base = c.parent_ids().next().map(|p| p.to_string()).unwrap_or_default();
                out.push(format!("{sha}|stash@{{{i}}}|{base}|{}", e.message));
            }
        }
    }
    out.join("\n")
}

// ---------- worktrees ----------
fn cli_wt(cwd: &str) -> String {
    cli(cwd, &["worktree", "list", "--porcelain"], None).split("\n\n").filter(|b| !b.trim().is_empty()).map(|b| {
        let ls: Vec<&str> = b.lines().collect();
        let get = |k: &str| ls.iter().find(|l| l.starts_with(&format!("{k} "))).map(|l| l[k.len() + 1..].to_string()).unwrap_or_default();
        let has = |k: &str| ls.iter().any(|l| *l == k || l.starts_with(&format!("{k} ")));
        format!("{}|{}|{}|{}|{}", get("worktree"), get("HEAD"), get("branch").replace("refs/heads/", ""), has("locked"), has("prunable"))
    }).collect::<Vec<_>>().join("\n")
}
fn gix_wt(repo: &gix::Repository) -> String {
    let mut out = vec![];
    let line = |path: String, r: &gix::Repository, locked: bool, prunable: bool| {
        let sha = r.head_id().ok().map(|i| i.to_string()).unwrap_or_default();
        let br = r.head_name().ok().flatten().map(|n| n.as_bstr().to_string().replace("refs/heads/", "")).unwrap_or_default();
        format!("{path}|{sha}|{br}|{locked}|{prunable}")
    };
    let main = repo.main_repo().unwrap();
    out.push(line(norm(main.workdir().unwrap()), &main, false, false));
    for p in main.worktrees().unwrap() {
        let (l, pr) = (p.is_locked(), p.is_prunable());
        let base = norm(&p.base().unwrap());
        let r = p.into_repo_with_possibly_inaccessible_worktree().unwrap();
        out.push(line(base, &r, l, pr));
    }
    out.join("\n")
}

// ---------- remotes ----------
fn cli_remotes(cwd: &str) -> String {
    let mut seen = std::collections::BTreeMap::new();
    for l in cli(cwd, &["remote", "-v"], None).lines() {
        let mut it = l.split_whitespace();
        if let (Some(n), Some(u)) = (it.next(), it.next()) { seen.entry(n.to_string()).or_insert(u.to_string()); }
    }
    seen.into_iter().map(|(n, u)| format!("{n} {u}")).collect::<Vec<_>>().join("\n")
}
fn gix_remotes(repo: &gix::Repository) -> String {
    let mut out = vec![];
    for n in repo.remote_names() {
        let r = repo.find_remote(n.as_bstr()).unwrap();
        if let Some(u) = r.url(Direction::Fetch) { out.push(format!("{n} {}", u.to_bstring())); }
    }
    out.join("\n")
}

// ---------- submodules ----------
fn cli_sub(cwd: &str) -> String {
    cli(cwd, &["config", "-f", ".gitmodules", "--get-regexp", "path"], None).lines().map(|l| l.split(' ').skip(1).collect::<Vec<_>>().join(" ")).collect::<Vec<_>>().join("\n")
}
fn gix_sub(repo: &gix::Repository) -> String {
    let mut out = vec![];
    if let Ok(Some(it)) = repo.submodules() { for s in it { if let Ok(p) = s.path() { out.push(p.to_string()); } } }
    out.join("\n")
}

// ---------- operation ----------
fn cli_op(cwd: &str) -> String {
    for (r, n) in [("REBASE_HEAD", "rebase"), ("MERGE_HEAD", "merge"), ("CHERRY_PICK_HEAD", "cherry-pick"), ("REVERT_HEAD", "revert")] {
        if !cli(cwd, &["rev-parse", "-q", "--verify", r], None).is_empty() { return n.into(); }
    }
    let s = cli(cwd, &["status", "--no-ahead-behind"], None);
    if s.contains("rebase in progress") || s.contains("You are currently rebasing") || s.contains("You are currently editing a commit while rebasing") { "rebase".into() } else { String::new() }
}
fn gix_op(repo: &gix::Repository) -> String {
    let d = repo.path();
    // same priority as the CLI code: sentinel refs first, then rebase dirs
    for (f, n) in [("REBASE_HEAD", "rebase"), ("MERGE_HEAD", "merge"), ("CHERRY_PICK_HEAD", "cherry-pick"), ("REVERT_HEAD", "revert")] {
        if d.join(f).is_file() { return n.into(); }
    }
    if d.join("rebase-merge").is_dir() || (d.join("rebase-apply").is_dir() && !d.join("rebase-apply/applying").is_file()) { "rebase".into() } else { String::new() }
}

// ---------- status ----------
fn cli_status(cwd: &str) -> String {
    let out = cli(cwd, &["status", "--porcelain=v1", "-z", "--untracked-files=all"], None);
    let parts: Vec<&str> = out.split('\0').collect();
    let mut v = vec![]; let mut i = 0;
    while i < parts.len() {
        let it = parts[i]; i += 1;
        if it.len() < 4 { continue; }
        let mut s = it.to_string();
        if it.starts_with('R') || it.starts_with('C') { s = format!("{s} <- {}", parts[i]); i += 1; }
        v.push(s);
    }
    v.join("\n")
}
fn gix_status(repo: &gix::Repository) -> String {
    use gix::status::{index_worktree::Item as IW, Item};
    use gix_status_alias::*;
    let mut tracked: BTreeMap<Vec<u8>, (char, char, Option<String>)> = BTreeMap::new();
    let mut untracked: Vec<String> = vec![];
    let it = repo.status(gix::progress::Discard).unwrap()
        .untracked_files(gix::status::UntrackedFiles::Files)
        .into_iter(None::<gix::bstr::BString>).unwrap();
    for item in it {
        match item.unwrap() {
            Item::TreeIndex(ch) => {
                use gix::diff::index::Change as C;
                let loc = ch.location().to_owned();
                let e = tracked.entry(loc.to_vec()).or_insert((' ', ' ', None));
                match ch {
                    C::Addition { .. } => e.0 = 'A',
                    C::Deletion { .. } => e.0 = 'D',
                    C::Modification { previous_entry_mode, entry_mode, .. } => e.0 = if previous_entry_mode.bits() & 0o170000 != entry_mode.bits() & 0o170000 { 'T' } else { 'M' },
                    C::Rewrite { source_location, copy, .. } => { e.0 = if copy { 'C' } else { 'R' }; e.2 = Some(source_location.to_string()); }
                }
            }
            Item::IndexWorktree(iw) => match iw {
                IW::Modification { rela_path, status, .. } => {
                    let e = tracked.entry(rela_path.to_vec()).or_insert((' ', ' ', None));
                    match status {
                        EntryStatus::Conflict { summary, .. } => { let (x, y) = match summary { Conflict::BothDeleted => ('D','D'), Conflict::AddedByUs => ('A','U'), Conflict::DeletedByThem => ('U','D'), Conflict::AddedByThem => ('U','A'), Conflict::DeletedByUs => ('D','U'), Conflict::BothAdded => ('A','A'), Conflict::BothModified => ('U','U') }; e.0 = x; e.1 = y; }
                        EntryStatus::Change(c) => e.1 = match c { Change::Removed => 'D', Change::Type { .. } => 'T', _ => 'M' },
                        EntryStatus::IntentToAdd => e.1 = 'A',
                        EntryStatus::NeedsUpdate(_) => {}
                    }
                }
                IW::DirectoryContents { entry, .. } => {
                    if matches!(entry.status, gix::dir::entry::Status::Untracked) {
                        let mut p = entry.rela_path.to_string();
                        if matches!(entry.disk_kind, Some(gix::dir::entry::Kind::Repository)) { p.push('/'); }
                        untracked.push(p);
                    }
                }
                IW::Rewrite { .. } => {}
            },
        }
    }
    tracked.retain(|_, v| !(v.0 == ' ' && v.1 == ' '));
    let mut out: Vec<String> = tracked.into_iter().map(|(p, (x, y, o))| { let p = String::from_utf8_lossy(&p).to_string(); match o { Some(o) => format!("{x}{y} {p} <- {o}"), None => format!("{x}{y} {p}") } }).collect();
    untracked.sort();
    out.extend(untracked.into_iter().map(|p| format!("?? {p}")));
    out.join("\n")
}
mod gix_status_alias {
    pub use gix_status_real::index_as_worktree::{Change, Conflict, EntryStatus};
}
extern crate gix_status as gix_status_real;

// ---------- log ----------
fn rev_set(repo: &gix::Repository, refs_all: &[(String, gix::ObjectId)]) -> Vec<gix::ObjectId> { let _ = repo; refs_all.iter().map(|x| x.1).collect() }

fn commit_tips(repo: &gix::Repository) -> Vec<gix::ObjectId> {
    // order: branches, remotes, tags (sorted by refname), then HEAD, like `--branches --remotes --tags` + stdin HEAD
    let mut tips = vec![];
    for prefix in ["refs/heads/", "refs/remotes/", "refs/tags/"] {
        for r in repo.references().unwrap().prefixed(prefix).unwrap() {
            let r = r.unwrap();
            let mut r = r;
            if let Ok(id) = r.peel_to_id() {
                if let Ok(o) = repo.find_object(id.detach()) { if o.kind == gix::object::Kind::Commit { tips.push(o.id); } }
            }
        }
    }
    if let Ok(h) = repo.head_id() { tips.push(h.detach()); }
    tips
}


// git-exact `--date-order`: emulates revision.c limit_list() + commit.c sort_in_topological_order()
// (stable date sort of tips, parents inserted "after equal dates", then Kahn with a FIFO tie-break prio queue).
fn git_date_order(repo: &gix::Repository, tips: Vec<gix::ObjectId>, limit: usize) -> Vec<gix::ObjectId> {
    use std::cmp::Reverse;
    use std::collections::{BinaryHeap, HashMap, HashSet};
    let mut info: HashMap<gix::ObjectId, (i64, Vec<gix::ObjectId>)> = HashMap::new();
    let mut load = |id: gix::ObjectId, info: &mut HashMap<gix::ObjectId, (i64, Vec<gix::ObjectId>)>| {
        info.entry(id).or_insert_with(|| {
            let c = repo.find_commit(id).unwrap();
            (c.committer().unwrap().seconds(), c.parent_ids().map(|p| p.detach()).collect())
        }).0
    };
    // limit_list: pending queue ordered by (date desc, insertion counter asc)
    let mut seen: HashSet<gix::ObjectId> = HashSet::new();
    let mut q: BTreeMap<(Reverse<i64>, u64), gix::ObjectId> = BTreeMap::new();
    let mut ctr = 0u64;
    for t in tips { if seen.insert(t) { let d = load(t, &mut info); q.insert((Reverse(d), ctr), t); ctr += 1; } }
    let mut list: Vec<gix::ObjectId> = vec![];
    while let Some((_, c)) = q.pop_first() {
        list.push(c);
        for p in info[&c].1.clone() {
            if seen.insert(p) { let d = load(p, &mut info); q.insert((Reverse(d), ctr), p); ctr += 1; }
        }
    }
    // sort_in_topological_order, REV_SORT_BY_COMMIT_DATE
    let mut indeg: HashMap<gix::ObjectId, u32> = list.iter().map(|c| (*c, 1)).collect();
    for c in &list { for p in &info[c].1 { if let Some(i) = indeg.get_mut(p) { if *i != 0 { *i += 1; } } } }
    let mut heap: BinaryHeap<(i64, Reverse<u64>, gix::ObjectId)> = BinaryHeap::new();
    let mut n = 0u64;
    for c in &list { if indeg[c] == 1 { heap.push((info[c].0, Reverse(n), *c)); n += 1; } }
    let mut out = vec![];
    while let Some((_, _, c)) = heap.pop() {
        for p in &info[&c].1 {
            if let Some(i) = indeg.get_mut(p) { if *i == 0 { continue; } *i -= 1; if *i == 1 { heap.push((info[p].0, Reverse(n), *p)); n += 1; } }
        }
        indeg.insert(c, 0);
        out.push(c);
        if out.len() == limit { break; }
    }
    out
}

fn cli_log(cwd: &str, n: usize) -> Vec<String> {
    let fmt = format!("--format=%H{FS}%P{FS}%an{FS}%ae{FS}%at{FS}%s\x1e");
    let out = cli(cwd, &["log", "--date-order", &format!("-n{n}"), &fmt, "--branches", "--remotes", "--tags", "--stdin", "--"], Some("HEAD\n"));
    out.split('\x1e').map(|r| r.trim_start_matches('\n')).filter(|r| !r.is_empty()).map(|s| s.to_string()).collect()
}
fn gix_log(repo: &gix::Repository, n: usize) -> Vec<String> {
    let tips = commit_tips(repo);
    git_date_order(repo, tips, n).into_iter().map(|id| {
        let c = repo.find_commit(id).unwrap();
        let a = c.author().unwrap();
        let parents: Vec<String> = c.parent_ids().map(|p| p.to_string()).collect();
        format!("{}{FS}{}{FS}{}{FS}{}{FS}{}{FS}{}", id, parents.join(" "), a.name, a.email, a.seconds(), git_subject(&c.message_raw_sloppy().to_str_lossy()))
    }).collect()
}
// first attempt, kept for the report: gix-traverse Topo DateOrder (ties differ from git)
fn gix_log_topo(repo: &gix::Repository, n: usize) -> Vec<gix::ObjectId> {
    use gix::traverse::commit::topo::{Builder, Sorting};
    Builder::from_iters(&repo.objects, commit_tips(repo), None::<Vec<gix::ObjectId>>).sorting(Sorting::DateOrder)
        .build().unwrap().take(n).map(|i| i.unwrap().id).collect()
}

// git's format_subject: skip leading blank lines, join lines up to the next blank line with ' ', keep leading spaces, trim trailing ones.
fn git_subject(m: &str) -> String {
    let mut out = String::new();
    let mut started = false;
    for l in m.split('\n') {
        let t = l.trim_end();
        if t.trim().is_empty() { if started { break } else { continue } }
        if started { out.push(' '); }
        started = true;
        out.push_str(t);
    }
    out
}

// wall time of the whole loadRepo flow as the TS runs it: 8 parallel spawns, then log, then `show` (if stashes), then 4 parallel rev-parse, then `status --no-ahead-behind`
fn cli_load_repo_wall(p: &str, n: usize) -> f64 {
    let t = Instant::now();
    let p1 = p.to_string();
    let hs: Vec<_> = (0..8).map(|i| { let p = p1.clone(); std::thread::spawn(move || match i {
        0 => { cli(&p, &["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes", "refs/tags"], None); }
        1 => { cli(&p, &["rev-parse", "--verify", "-q", "HEAD"], None); }
        2 => { cli(&p, &["symbolic-ref", "-q", "--short", "HEAD"], None); }
        3 => { cli(&p, &["stash", "list", "--format=%H"], None); }
        4 => { cli(&p, &["worktree", "list", "--porcelain"], None); }
        5 => { cli(&p, &["remote", "-v"], None); }
        6 => { cli(&p, &["status", "--porcelain=v1", "-z", "--untracked-files=all"], None); }
        _ => { cli(&p, &["config", "-f", ".gitmodules", "--get-regexp", "path"], None); }
    }) }).collect();
    for h in hs { h.join().unwrap(); }
    cli_log(p, n);
    let hs: Vec<_> = ["REBASE_HEAD", "MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD"].iter().map(|r| { let p = p1.clone(); let r = r.to_string(); std::thread::spawn(move || { cli(&p, &["rev-parse", "-q", "--verify", &r], None); }) }).collect();
    for h in hs { h.join().unwrap(); }
    cli(p, &["status", "--no-ahead-behind"], None);
    t.elapsed().as_secs_f64() * 1000.0
}
fn gix_load_repo_wall(p: &str, n: usize) -> f64 {
    let t = Instant::now();
    let mut r = gix::open(p).unwrap(); r.object_cache_size_if_unset(32 * 1024 * 1024);
    let _ = (gix_refs(&r), gix_head(&r), gix_stash(&r), gix_wt(&r), gix_remotes(&r), gix_sub(&r), gix_status(&r), gix_log(&r, n), gix_op(&r));
    t.elapsed().as_secs_f64() * 1000.0
}
fn time<T>(f: impl FnOnce() -> T) -> (T, f64) { let t = Instant::now(); let r = f(); (r, t.elapsed().as_secs_f64() * 1000.0) }
fn median(mut v: Vec<f64>) -> f64 { v.sort_by(|a, b| a.partial_cmp(b).unwrap()); v[v.len() / 2] }

fn main() {
    let path = std::env::args().nth(1).unwrap();
    let n: usize = std::env::args().nth(2).map(|s| s.parse().unwrap()).unwrap_or(5000);
    let runs = 10;
    println!("== {path}");
    type Job<'a> = (&'a str, Box<dyn Fn() -> String + 'a>, Box<dyn Fn() -> String + 'a>);
    let p = path.as_str();
    let open = || { let mut r = gix::open(p).unwrap(); r.object_cache_size_if_unset(32 * 1024 * 1024); r };
    let jobs: Vec<Job> = vec![
        ("for-each-ref", Box::new(move || cli_refs(p)), Box::new(move || gix_refs(&open()))),
        ("head+branch", Box::new(move || format!("{:?}", cli_head(p))), Box::new(move || format!("{:?}", gix_head(&open())))),
        ("stash list", Box::new(move || cli_stash(p)), Box::new(move || gix_stash(&open()))),
        ("worktree list", Box::new(move || cli_wt(p)), Box::new(move || gix_wt(&open()))),
        ("remote -v", Box::new(move || cli_remotes(p)), Box::new(move || gix_remotes(&open()))),
        ("config .gitmodules", Box::new(move || cli_sub(p)), Box::new(move || gix_sub(&open()))),
        ("status", Box::new(move || cli_status(p)), Box::new(move || gix_status(&open()))),
        ("operation", Box::new(move || cli_op(p)), Box::new(move || gix_op(&open()))),
    ];
    println!("{:<20} {:>6} {:>10} {:>10} {:>10} {:>10}", "command", "equal", "cli cold", "cli warm", "gix cold", "gix warm");
    let (mut tc, mut tg) = (0.0, 0.0);
    for (name, c, g) in &jobs {
        let (co, cc) = time(|| c()); let (go, gc) = time(|| g());
        let cw = median((0..runs).map(|_| time(|| c()).1).collect());
        let gw = median((0..runs).map(|_| time(|| g()).1).collect());
        let eq = co == go;
        println!("{name:<20} {eq:>6} {cc:>10.1} {cw:>10.1} {gc:>10.1} {gw:>10.1}");
        if !eq { println!("  CLI: {}\n  GIX: {}", co.lines().take(60).collect::<Vec<_>>().join("\n       "), go.lines().take(60).collect::<Vec<_>>().join("\n       ")); }
        tc += cw; tg += gw;
    }
    // log
    let (cl, cc) = time(|| cli_log(p, n));
    let (gl, gc) = time(|| gix_log(&open(), n));
    let cw = median((0..5).map(|_| time(|| cli_log(p, n)).1).collect());
    let gw = median((0..5).map(|_| time(|| gix_log(&open(), n)).1).collect());
    let first_diff = cl.iter().zip(gl.iter()).position(|(a, b)| a != b);
    println!("{:<20} {:>6} {cc:>10.1} {cw:>10.1} {gc:>10.1} {gw:>10.1}   (n={}, cli {} commits, gix {}, first diff {:?})", format!("log -n{n}"), cl == gl, n, cl.len(), gl.len(), first_diff);
    if let Some(i) = first_diff { println!("  CLI[{i}]: {}\n  GIX[{i}]: {}", cl[i], gl[i]); }
    let cw_all = median((0..5).map(|_| cli_load_repo_wall(p, n)).collect());
    let gw_all = median((0..5).map(|_| gix_load_repo_wall(p, n)).collect());
    let (c0, g0) = (cli_load_repo_wall(p, n), gix_load_repo_wall(p, n));
    println!("WHOLE loadRepo wall: cli {c0:.1} ms first / {cw_all:.1} ms warm; gix {g0:.1} ms first / {gw_all:.1} ms warm (gix runs sequentially, one open)");
    println!("sum of warm medians (sequential): cli {:.1} ms, gix {:.1} ms (+ log)", tc + cw, tg + gw);
    let _ = (BStr::new(""), rev_set as fn(&_, &_) -> _);
}
