use crate::actions::{Res, git, raw};
use crate::commands::write_temp;
use crate::load::{Operation, js_trim, value, values};
use crate::paths;
use diff::port::ParsedDiff;
use merge::port::Typed;
use repo::port::{BlameLine, read_blame, read_commit, read_log, read_name_status};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const FS: &str = "\x1f";
const RS: &str = "\x1e";

#[derive(Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum DiffSource {
    Commit {
        sha: String,
        #[serde(default)]
        parent: Option<String>,
    },
    Staged,
    Unstaged {
        #[serde(default)]
        untracked: bool,
    },
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct DiffSides {
    pub original: String,
    pub modified: String,
    pub binary: bool,
}

fn truthy(text: Option<&str>) -> Option<&str> {
    text.filter(|t| !t.is_empty())
}

pub async fn load_commit(cwd: &str, sha: &str) -> Res<Value> {
    let format = format!("--format=%H{FS}%P{FS}%an{FS}%ae{FS}%at{FS}%cn{FS}%ct{FS}%B");
    let meta = git(cwd, &["show", "-s", &format, sha]).await?;
    let mut detail = read_commit(&meta)?;
    let full = detail.sha.clone();
    let args = match detail.parents.first() {
        Some(parent) => vec![
            "diff-tree",
            "-r",
            "-M",
            "--name-status",
            "-z",
            parent.as_str(),
            full.as_str(),
        ],
        None => vec![
            "diff-tree",
            "-r",
            "-M",
            "--name-status",
            "-z",
            "--root",
            full.as_str(),
        ],
    };
    detail.files = read_name_status(&git(cwd, &args).await?);
    Ok(value(&detail))
}

pub async fn load_all_files(cwd: &str, sha: &str) -> Res<Vec<String>> {
    let out = git(cwd, &["ls-tree", "-r", "-z", "--name-only", sha]).await?;
    Ok(out
        .split('\0')
        .filter(|p| !p.is_empty())
        .map(String::from)
        .collect())
}

pub async fn load_diff(
    cwd: &str,
    source: &DiffSource,
    file: &str,
    ignore_whitespace: bool,
    orig: Option<&str>,
) -> Res<ParsedDiff> {
    let ws: &[&str] = if ignore_whitespace {
        &["--ignore-space-at-eol", "-b"]
    } else {
        &[]
    };
    let paths: Vec<&str> = match truthy(orig) {
        Some(o) if o != file => vec![o, file],
        _ => vec![file],
    };
    let text = match source {
        DiffSource::Commit { sha, parent } => {
            let mut args: Vec<&str> = Vec::new();
            match truthy(parent.as_deref()) {
                Some(parent) => {
                    args.extend(["diff", "-M"]);
                    args.extend(ws);
                    args.extend([parent, sha.as_str(), "--"]);
                    args.extend(&paths);
                }
                None => {
                    args.extend(["show", "--format="]);
                    args.extend(ws);
                    args.extend([sha.as_str(), "--", file]);
                }
            }
            git(cwd, &args).await?
        }
        DiffSource::Staged => {
            let mut args = vec!["diff", "--cached", "-M"];
            args.extend(ws);
            args.push("--");
            args.extend(&paths);
            git(cwd, &args).await?
        }
        DiffSource::Unstaged { untracked: true } => {
            let mut args = vec!["diff", "--no-index"];
            args.extend(ws);
            args.extend(["--", "/dev/null", file]);
            raw(cwd, &args, None, None).await.stdout
        }
        DiffSource::Unstaged { untracked: false } => {
            let mut args = vec!["diff"];
            args.extend(ws);
            args.extend(["--", file]);
            git(cwd, &args).await?
        }
    };
    Ok(ParsedDiff::parse(&text))
}

async fn show_blob(cwd: &str, spec: String) -> String {
    let result = raw(cwd, &["show", &spec], None, None).await;
    if result.code == 0 {
        result.stdout
    } else {
        String::new()
    }
}

async fn read_text(cwd: &str, rel: &str, roots: &[String]) -> String {
    let target = paths::resolve(cwd, rel);
    if !paths::inside(roots, &target) {
        return String::new();
    }
    tokio::fs::read(&target)
        .await
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        .unwrap_or_default()
}

pub async fn load_sides(
    cwd: &str,
    source: &DiffSource,
    file: &str,
    orig: Option<&str>,
    roots: &[String],
) -> DiffSides {
    let before = orig.unwrap_or(file);
    let (original, modified) = match source {
        DiffSource::Commit { sha, parent } => {
            let old = async {
                match parent {
                    Some(parent) if !parent.is_empty() => {
                        show_blob(cwd, format!("{parent}:{before}")).await
                    }
                    _ => String::new(),
                }
            };
            tokio::join!(old, show_blob(cwd, format!("{sha}:{file}")))
        }
        DiffSource::Staged => tokio::join!(
            show_blob(cwd, format!("HEAD:{before}")),
            show_blob(cwd, format!(":{file}"))
        ),
        DiffSource::Unstaged { untracked } => {
            let index = async {
                if *untracked {
                    String::new()
                } else {
                    show_blob(cwd, format!(":{file}")).await
                }
            };
            tokio::join!(index, read_text(cwd, file, roots))
        }
    };
    let binary = original.contains('\0') || modified.contains('\0');
    DiffSides {
        original,
        modified,
        binary,
    }
}

pub async fn load_blame(cwd: &str, file: &str, rev: Option<&str>) -> Res<Vec<BlameLine>> {
    let mut args = vec!["blame", "--porcelain"];
    if let Some(rev) = truthy(rev) {
        args.push(rev);
    }
    args.extend(["--", file]);
    read_blame(&git(cwd, &args).await?)
}

pub async fn load_file_history(cwd: &str, file: &str, limit: u32) -> Res<Vec<Value>> {
    let limit_arg = format!("-n{limit}");
    let format = format!("--format=%H{FS}%P{FS}%an{FS}%ae{FS}%at{FS}%s{RS}");
    let out = git(cwd, &["log", "--follow", &limit_arg, &format, "--", file]).await?;
    Ok(values(&read_log(&out)))
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    A,
    B,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum MergeLoad {
    Text {
        segments: Vec<Value>,
        #[serde(rename = "bName")]
        b_name: String,
    },
    Binary,
    Delete {
        missing: Side,
    },
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct HeadMessage {
    pub summary: String,
    pub description: String,
}

fn is_line_end(c: char) -> bool {
    matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

fn short_name(text: &str) -> String {
    let name = text.strip_prefix("remotes/").unwrap_or(text);
    let cut = name
        .char_indices()
        .find(|(i, c)| matches!(c, '~' | '^') && !name[*i..].chars().any(is_line_end))
        .map(|(i, _)| i);
    match cut {
        Some(i) => name[..i].to_string(),
        None => name.to_string(),
    }
}

async fn b_label(cwd: &str, op: Option<Operation>) -> String {
    let Some(op) = op else {
        return "B".to_string();
    };
    let (args, head) = match op {
        Operation::Merge => (["name-rev", "--name-only"], "MERGE_HEAD"),
        Operation::CherryPick => (["rev-parse", "--short"], "CHERRY_PICK_HEAD"),
        Operation::Revert => (["rev-parse", "--short"], "REVERT_HEAD"),
        Operation::Rebase => (["rev-parse", "--short"], "REBASE_HEAD"),
    };
    let r = raw(cwd, &[args[0], args[1], head], None, None).await;
    let out = js_trim(&r.stdout);
    if r.code == 0 && !out.is_empty() {
        short_name(out)
    } else {
        "B".to_string()
    }
}

pub async fn load_merge(cwd: &str, path: &str, op: Option<Operation>) -> Res<MergeLoad> {
    let show = |n: u8| {
        let spec = format!(":{n}:{path}");
        async move { raw(cwd, &["show", &spec], None, None).await }
    };
    let (base, a, b) = tokio::join!(show(1), show(2), show(3));
    if a.code != 0 || b.code != 0 {
        let missing = if a.code != 0 { Side::A } else { Side::B };
        return Ok(MergeLoad::Delete { missing });
    }
    if a.stdout.contains('\0') || b.stdout.contains('\0') {
        return Ok(MergeLoad::Binary);
    }
    let root = if base.code == 0 {
        base.stdout
    } else {
        String::new()
    };
    let (ours, root, theirs) =
        tokio::join!(write_temp(a.stdout), write_temp(root), write_temp(b.stdout));
    let (ours, root, theirs) = (ours?, root?, theirs?);
    let merged = raw(
        cwd,
        &[
            "merge-file",
            "-p",
            "--diff3",
            "-L",
            "A",
            "-L",
            "base",
            "-L",
            "B",
            &ours,
            &root,
            &theirs,
        ],
        None,
        None,
    )
    .await;
    if merged.code < 0 || merged.code > 127 {
        let text = js_trim(&merged.stderr);
        return Err(if text.is_empty() {
            "git merge-file failed".to_string()
        } else {
            text.to_string()
        });
    }
    let segments = Typed::parse_segments(&merged.stdout)
        .iter()
        .map(|s| s.to_value())
        .collect();
    Ok(MergeLoad::Text {
        segments,
        b_name: b_label(cwd, op).await,
    })
}

pub async fn load_head_message(cwd: &str) -> HeadMessage {
    let r = raw(cwd, &["show", "-s", "--format=%B", "HEAD"], None, None).await;
    let mut lines = js_trim(&r.stdout).split('\n');
    let summary = lines.next().unwrap_or_default().to_string();
    let rest: Vec<&str> = lines.collect();
    HeadMessage {
        summary,
        description: js_trim(&rest.join("\n")).to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_name_cuts_suffix() {
        assert_eq!(short_name("remotes/origin/main~2"), "origin/main");
        assert_eq!(short_name("side^0"), "side");
        assert_eq!(short_name("a~1\nb"), "a~1\nb");
        assert_eq!(short_name("a~1\nb~2"), "a~1\nb");
        assert_eq!(short_name("plain"), "plain");
    }
}
