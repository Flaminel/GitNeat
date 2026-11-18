use crate::actions::{Res, git, raw};
use crate::commands::write_temp;
use crate::git;
use crate::load::{Operation, js_trim, value, values};
use crate::paths;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use diff::port::ParsedDiff;
use merge::port::Typed;
use repo::port::{BlameLine, read_blame, read_commit, read_log, read_name_status};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

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

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ImageData {
    pub mime: String,
    pub data: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ImageSides {
    pub original: Option<ImageData>,
    pub modified: Option<ImageData>,
}

const MAX_IMAGE_BYTES: usize = 10_000_000;

fn truthy(text: Option<&str>) -> Option<&str> {
    text.filter(|t| !t.is_empty())
}

pub async fn load_commit(cwd: &str, sha: &str) -> Res<Value> {
    let format = format!(
        "--format=%H{FS}%P{FS}%an{FS}%ae{FS}%at{FS}%cn{FS}%ct{FS}%B{FS}%ce{FS}%(trailers:key=Co-authored-by,valueonly,unfold)"
    );
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
    let mut out = value(&detail);
    if let Some(untracked) = detail.parents.get(2) {
        let paths = load_all_files(cwd, untracked).await.unwrap_or_default();
        if !paths.is_empty() {
            out["untracked"] = serde_json::json!(paths);
        }
    }
    Ok(out)
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

pub fn image_mime(file: &str) -> Option<&'static str> {
    let ext = file.rsplit_once('.')?.1.to_ascii_lowercase();
    match ext.as_str() {
        "tif" => Some("image/tiff"),
        "jpeg" | "jpg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        _ => None,
    }
}

fn encode_image(mime: &str, bytes: Vec<u8>) -> Option<ImageData> {
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return None;
    }
    Some(ImageData {
        mime: mime.to_string(),
        data: STANDARD.encode(bytes),
    })
}

async fn blob_image(cwd: &str, spec: String, mime: &str) -> Option<ImageData> {
    let out = git::command("git")
        .args(["show", &spec])
        .current_dir(cwd)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .output()
        .await
        .ok()?;
    if out.status.success() {
        encode_image(mime, out.stdout)
    } else {
        None
    }
}

async fn disk_image(cwd: &str, rel: &str, roots: &[String], mime: &str) -> Option<ImageData> {
    let target = paths::resolve(cwd, rel);
    if !paths::inside(roots, &target) {
        return None;
    }
    encode_image(mime, tokio::fs::read(&target).await.ok()?)
}

pub async fn load_images(
    cwd: &str,
    source: &DiffSource,
    file: &str,
    orig: Option<&str>,
    roots: &[String],
) -> ImageSides {
    let Some(mime) = image_mime(file) else {
        return ImageSides {
            original: None,
            modified: None,
        };
    };
    let before = orig.unwrap_or(file);
    let (original, modified) = match source {
        DiffSource::Commit { sha, parent } => {
            let old = async {
                match parent {
                    Some(parent) if !parent.is_empty() => {
                        blob_image(cwd, format!("{parent}:{before}"), mime).await
                    }
                    _ => None,
                }
            };
            tokio::join!(old, blob_image(cwd, format!("{sha}:{file}"), mime))
        }
        DiffSource::Staged => tokio::join!(
            blob_image(cwd, format!("HEAD:{before}"), mime),
            blob_image(cwd, format!(":{file}"), mime)
        ),
        DiffSource::Unstaged { untracked } => {
            let index = async {
                if *untracked {
                    None
                } else {
                    blob_image(cwd, format!(":{file}"), mime).await
                }
            };
            tokio::join!(index, disk_image(cwd, file, roots, mime))
        }
    };
    ImageSides { original, modified }
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

pub async fn load_file_history_page(cwd: &str, file: &str, scan: usize) -> Res<Value> {
    let count = format!("-n{}", scan + 1);
    let ids = git(cwd, &["rev-list", &count, "HEAD"]).await?;
    let ids: Vec<&str> = ids.lines().collect();
    let end = ids.len() <= scan;
    let window: HashSet<&str> = ids.iter().take(scan).copied().collect();
    let format = format!("--format=%H{FS}%P{FS}%an{FS}%ae{FS}%at{FS}%s{RS}");
    let out = git(cwd, &["log", "--follow", &format, "--", file]).await?;
    let commits: Vec<Value> = values(&read_log(&out))
        .into_iter()
        .filter(|c| c["sha"].as_str().is_some_and(|sha| window.contains(sha)))
        .collect();
    let next = match ids.get(scan) {
        Some(sha) => {
            let time = git(cwd, &["log", "-1", "--format=%at", sha]).await?;
            serde_json::json!({ "sha": sha, "time": time.trim().parse::<i64>().unwrap_or(0) })
        }
        None => Value::Null,
    };
    Ok(serde_json::json!({ "commits": commits, "end": end, "next": next }))
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

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct OperationInfo {
    pub from: String,
    pub to: String,
}

async fn git_path_text(cwd: &str, rel: &str) -> Option<String> {
    let r = raw(cwd, &["rev-parse", "--git-path", rel], None, None).await;
    if r.code != 0 {
        return None;
    }
    let path = std::path::Path::new(cwd).join(js_trim(&r.stdout));
    let text = std::fs::read_to_string(path).ok()?;
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_string())
}

async fn current_branch(cwd: &str) -> String {
    let r = raw(cwd, &["symbolic-ref", "--short", "-q", "HEAD"], None, None).await;
    let out = js_trim(&r.stdout);
    if r.code == 0 && !out.is_empty() {
        return out.to_string();
    }
    let r = raw(cwd, &["rev-parse", "--short", "HEAD"], None, None).await;
    js_trim(&r.stdout).to_string()
}

pub async fn load_operation(cwd: &str, op: Option<Operation>) -> OperationInfo {
    if let Some(Operation::Rebase) = op {
        let mut head = None;
        let mut onto = None;
        for dir in ["rebase-merge", "rebase-apply"] {
            head = head.or(git_path_text(cwd, &format!("{dir}/head-name")).await);
            onto = onto.or(git_path_text(cwd, &format!("{dir}/onto")).await);
        }
        let from = match head {
            Some(name) => name
                .strip_prefix("refs/heads/")
                .unwrap_or(&name)
                .to_string(),
            None => current_branch(cwd).await,
        };
        let to = match onto {
            Some(sha) => sha.chars().take(6).collect(),
            None => String::new(),
        };
        return OperationInfo { from, to };
    }
    OperationInfo {
        from: b_label(cwd, op).await,
        to: current_branch(cwd).await,
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

pub async fn has_commit_hook(cwd: &str) -> bool {
    let r = raw(cwd, &["rev-parse", "--git-path", "hooks"], None, None).await;
    let dir = js_trim(&r.stdout);
    let base = std::path::Path::new(cwd).join(dir);
    ["pre-commit", "commit-msg"]
        .iter()
        .any(|name| base.join(name).is_file())
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

    #[tokio::test]
    async fn file_history_page_windows_the_scan() {
        let file = "../../package.json";
        let small = load_file_history_page(".", file, 1).await.unwrap();
        assert_eq!(small["end"], false);
        assert!(small["next"]["sha"].is_string());
        assert!(small["commits"].as_array().unwrap().len() <= 1);
        let all = load_file_history_page(".", file, 10_000_000).await.unwrap();
        assert_eq!(all["end"], true);
        assert!(all["next"].is_null());
        assert!(!all["commits"].as_array().unwrap().is_empty());
    }

    fn sh(dir: &std::path::Path, args: &[&str]) {
        let out = std::process::Command::new("git")
            .args([
                "-c",
                "user.name=t",
                "-c",
                "user.email=t@x",
                "-c",
                "commit.gpgsign=false",
            ])
            .args(args)
            .current_dir(dir)
            .output()
            .unwrap();
        let _ = out;
    }

    #[tokio::test]
    async fn operation_info_names_branches() {
        let dir = std::env::temp_dir().join(format!("gitneat-op-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        sh(&dir, &["init", "-q", "-b", "main"]);
        std::fs::write(dir.join("f"), "a\n").unwrap();
        sh(&dir, &["add", "."]);
        sh(&dir, &["commit", "-q", "-m", "base"]);
        sh(&dir, &["checkout", "-q", "-b", "side"]);
        std::fs::write(dir.join("f"), "side\n").unwrap();
        sh(&dir, &["commit", "-q", "-am", "side"]);
        sh(&dir, &["checkout", "-q", "main"]);
        std::fs::write(dir.join("f"), "main\n").unwrap();
        sh(&dir, &["commit", "-q", "-am", "main"]);
        let cwd = dir.to_str().unwrap();
        sh(&dir, &["merge", "side"]);
        let info = load_operation(cwd, Some(Operation::Merge)).await;
        assert_eq!((info.from.as_str(), info.to.as_str()), ("side", "main"));
        sh(&dir, &["merge", "--abort"]);
        sh(&dir, &["checkout", "-q", "side"]);
        sh(&dir, &["rebase", "main"]);
        let onto = std::process::Command::new("git")
            .args(["rev-parse", "--short=6", "main"])
            .current_dir(&dir)
            .output()
            .unwrap();
        let onto = String::from_utf8(onto.stdout).unwrap();
        let info = load_operation(cwd, Some(Operation::Rebase)).await;
        assert_eq!(
            (info.from.as_str(), info.to.as_str()),
            ("side", onto.trim())
        );
        sh(&dir, &["rebase", "--abort"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn images_load_from_commit_and_disk() {
        let dir = std::env::temp_dir().join(format!("gitneat-img-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        sh(&dir, &["init", "-q", "-b", "main"]);
        std::fs::write(dir.join("a.PNG"), [0u8, 159, 146, 150, 1]).unwrap();
        sh(&dir, &["add", "."]);
        sh(&dir, &["commit", "-q", "-m", "one"]);
        std::fs::write(dir.join("a.PNG"), [0u8, 1, 2]).unwrap();
        sh(&dir, &["commit", "-q", "-am", "two"]);
        let cwd = dir.to_str().unwrap();
        let roots = vec![cwd.to_string()];
        let source = DiffSource::Commit {
            sha: "HEAD".into(),
            parent: Some("HEAD~1".into()),
        };
        let sides = load_images(cwd, &source, "a.PNG", None, &roots).await;
        assert_eq!(
            sides.original.unwrap().data,
            STANDARD.encode([0u8, 159, 146, 150, 1])
        );
        let modified = sides.modified.unwrap();
        assert_eq!(modified.mime, "image/png");
        assert_eq!(modified.data, STANDARD.encode([0u8, 1, 2]));
        std::fs::write(dir.join("a.PNG"), [9u8]).unwrap();
        let live = load_images(
            cwd,
            &DiffSource::Unstaged { untracked: false },
            "a.PNG",
            None,
            &roots,
        )
        .await;
        assert_eq!(live.modified.unwrap().data, STANDARD.encode([9u8]));
        assert!(live.original.is_some());
        let text = load_images(cwd, &source, "a.txt", None, &roots).await;
        assert!(text.original.is_none() && text.modified.is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
