use crate::actions::{Res, git, raw};
use crate::load::{value, values};
use crate::paths;
use diff::port::ParsedDiff;
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
