use crate::git;
use crate::paths;
use base64::Engine;
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use tokio::task::JoinSet;

const UNREACHABLE: &str = "Repo is unreachable and may have been deleted";

#[derive(Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RepoSummary {
    pub path: String,
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub remote: Option<String>,
    pub remote_url: Option<String>,
    pub wip: Option<WipSummary>,
    pub error: Option<String>,
}

#[derive(Serialize, Default, Debug, PartialEq, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct WipSummary {
    pub added: u32,
    pub deleted: u32,
    pub modified: u32,
    pub renamed: u32,
}

impl WipSummary {
    fn count(&mut self, code: char) {
        match code {
            'A' | 'C' => self.added += 1,
            'D' => self.deleted += 1,
            'M' | 'T' => self.modified += 1,
            'R' => self.renamed += 1,
            _ => {}
        }
    }
}

async fn git_out(cwd: &str, args: &[&str]) -> Option<String> {
    let list: Vec<String> = args.iter().map(|a| a.to_string()).collect();
    let out = git::run_git(cwd, &list, None, None).await;
    if out.code == 0 {
        Some(out.stdout)
    } else {
        None
    }
}

pub fn parse_status(text: &str, wip: bool) -> RepoSummary {
    let mut s = RepoSummary::default();
    let mut changes = WipSummary::default();
    for line in text.lines() {
        if let Some(head) = line.strip_prefix("# branch.head ") {
            if head != "(detached)" {
                s.branch = Some(head.to_string());
            }
        } else if let Some(up) = line.strip_prefix("# branch.upstream ") {
            s.upstream = Some(up.to_string());
        } else if let Some(ab) = line.strip_prefix("# branch.ab ") {
            for part in ab.split(' ') {
                if let Some(n) = part.strip_prefix('+') {
                    s.ahead = n.parse().unwrap_or(0);
                } else if let Some(n) = part.strip_prefix('-') {
                    s.behind = n.parse().unwrap_or(0);
                }
            }
        } else if line.starts_with("u ") {
            changes.modified += 1;
        } else if line.starts_with("? ") {
            changes.added += 1;
        } else if line.starts_with("1 ") || line.starts_with("2 ") {
            for code in line.chars().skip(2).take(2) {
                changes.count(code);
            }
        }
    }
    if wip {
        s.wip = Some(changes);
    }
    s
}

pub async fn summary(path: String, wip: bool) -> RepoSummary {
    if !Path::new(&path).is_dir() {
        return RepoSummary {
            path,
            error: Some(UNREACHABLE.into()),
            ..Default::default()
        };
    }
    let untracked = if wip { "-uall" } else { "-uno" };
    let Some(status) = git_out(&path, &["status", "--porcelain=v2", "--branch", untracked]).await
    else {
        return RepoSummary {
            path,
            error: Some("Not a git repository".into()),
            ..Default::default()
        };
    };
    let mut s = parse_status(&status, wip);
    let remotes = git_out(&path, &["remote"]).await.unwrap_or_default();
    let names: Vec<&str> = remotes.lines().filter(|l| !l.is_empty()).collect();
    let from_upstream = s.upstream.as_deref().and_then(|u| {
        names
            .iter()
            .find(|n| u.starts_with(&format!("{n}/")))
            .copied()
    });
    let remote = from_upstream
        .or_else(|| names.iter().find(|n| **n == "origin").copied())
        .or_else(|| names.first().copied());
    if let Some(name) = remote {
        s.remote_url = git_out(&path, &["remote", "get-url", name])
            .await
            .map(|u| u.trim().to_string());
        s.remote = Some(name.to_string());
    }
    s.path = path;
    s
}

pub async fn repo_summaries(paths: Vec<String>, wip: bool) -> Vec<RepoSummary> {
    let mut set = JoinSet::new();
    for (i, path) in paths.into_iter().enumerate() {
        set.spawn(async move { (i, summary(path, wip).await) });
    }
    let mut out: Vec<(usize, RepoSummary)> = Vec::new();
    while let Some(Ok(item)) = set.join_next().await {
        out.push(item);
    }
    out.sort_by_key(|(i, _)| *i);
    out.into_iter().map(|(_, s)| s).collect()
}

fn is_repo(dir: &Path) -> bool {
    dir.join(".git").exists()
}

fn scan(dir: &Path, out: &mut Vec<String>) {
    if is_repo(dir) {
        out.push(paths::normalize(dir).to_string_lossy().into_owned());
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut children: Vec<PathBuf> = entries
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .map(|e| e.path())
        .filter(|p| {
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            !name.starts_with('.') && name != "node_modules"
        })
        .collect();
    children.sort();
    for child in children {
        scan(&child, out);
    }
}

pub fn find(dirs: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for dir in dirs {
        scan(Path::new(dir), &mut out);
    }
    out.sort();
    out.dedup();
    out
}

pub async fn find_repos(dirs: Vec<String>) -> Vec<String> {
    tokio::task::spawn_blocking(move || find(&dirs))
        .await
        .unwrap_or_default()
}

pub fn code_workspace_folders(file: &Path, text: &str) -> Vec<String> {
    let base = file.parent().unwrap_or(Path::new(""));
    let json: Value = serde_json::from_str(text).unwrap_or(Value::Null);
    json.get("folders")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|f| f.get("path").and_then(Value::as_str))
                .map(|p| {
                    paths::normalize(&base.join(p))
                        .to_string_lossy()
                        .into_owned()
                })
                .collect()
        })
        .unwrap_or_default()
}

pub async fn import_code_workspace(file: String) -> Vec<String> {
    let file = PathBuf::from(file);
    let text = tokio::fs::read_to_string(&file).await.unwrap_or_default();
    code_workspace_folders(&file, &text)
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RepoReadme {
    pub name: String,
    pub html: String,
}

fn is_readme(name: &str) -> bool {
    let lower = name.to_lowercase();
    match lower.strip_prefix("readme") {
        Some("") => true,
        Some(rest) => rest
            .strip_prefix('.')
            .is_some_and(|e| !e.is_empty() && e.chars().all(|c| c.is_ascii_alphanumeric())),
        None => false,
    }
}

fn pick_readme(names: &[String]) -> Option<String> {
    let mut found: Vec<&String> = names.iter().filter(|n| is_readme(n)).collect();
    found.sort();
    found
        .iter()
        .find(|n| n.eq_ignore_ascii_case("readme.md"))
        .or_else(|| found.iter().min_by_key(|n| n.len()))
        .map(|n| n.to_string())
}

fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn url_allowed(url: &str) -> bool {
    match url.find([':', '/', '?', '#']) {
        Some(i) if url.as_bytes()[i] == b':' => {
            matches!(
                url[..i].to_ascii_lowercase().as_str(),
                "http" | "https" | "irc" | "ircs" | "mailto" | "xmpp"
            )
        }
        _ => true,
    }
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = bytes
            .get(i + 1..i + 3)
            .and_then(|h| std::str::from_utf8(h).ok())
            .and_then(|h| u8::from_str_radix(h, 16).ok());
        match (bytes[i], hex) {
            (b'%', Some(b)) => {
                out.push(b);
                i += 3;
            }
            (b, _) => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn inline_image(root: &Path, readme_dir: &Path, url: &str) -> Option<String> {
    if url.starts_with('/') || url.contains(':') {
        return None;
    }
    let clean = url.split(['?', '#']).next().unwrap_or("");
    let file = readme_dir.join(percent_decode(clean)).canonicalize().ok()?;
    let root = root.canonicalize().ok()?;
    if !file.starts_with(&root) {
        return None;
    }
    let mime = match file.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        _ => return None,
    };
    let meta = std::fs::metadata(&file).ok()?;
    if !meta.is_file() || meta.len() > 5 * 1024 * 1024 {
        return None;
    }
    let bytes = std::fs::read(&file).ok()?;
    Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

fn render_readme(root: &Path, name: &str, text: &str) -> String {
    let lower = name.to_lowercase();
    if !lower.ends_with(".md") && !lower.ends_with(".markdown") {
        return format!("<pre>{}</pre>", escape_html(text));
    }
    use pulldown_cmark::{CowStr, Event, Options, Parser, Tag};
    let options =
        Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS;
    let readme_dir = root
        .join(name)
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| root.to_path_buf());
    let events = Parser::new_ext(text, options).map(|e| match e {
        Event::Html(h) | Event::InlineHtml(h) => Event::Text(h),
        Event::Start(Tag::Link {
            link_type,
            dest_url,
            title,
            id,
        }) => {
            let dest_url = if url_allowed(&dest_url) {
                dest_url
            } else {
                CowStr::Borrowed("")
            };
            Event::Start(Tag::Link {
                link_type,
                dest_url,
                title,
                id,
            })
        }
        Event::Start(Tag::Image {
            link_type,
            dest_url,
            title,
            id,
        }) => {
            let dest_url = if !url_allowed(&dest_url) {
                CowStr::Borrowed("")
            } else if let Some(data) = inline_image(root, &readme_dir, &dest_url) {
                CowStr::from(data)
            } else {
                dest_url
            };
            Event::Start(Tag::Image {
                link_type,
                dest_url,
                title,
                id,
            })
        }
        other => other,
    });
    let mut html = String::new();
    pulldown_cmark::html::push_html(&mut html, events);
    html
}

pub async fn repo_readme(path: String) -> Option<RepoReadme> {
    let mut names = Vec::new();
    let mut entries = tokio::fs::read_dir(&path).await.ok()?;
    while let Ok(Some(entry)) = entries.next_entry().await {
        if entry
            .file_type()
            .await
            .map(|t| t.is_file())
            .unwrap_or(false)
        {
            names.push(entry.file_name().to_string_lossy().into_owned());
        }
    }
    let name = pick_readme(&names)?;
    let bytes = tokio::fs::read(Path::new(&path).join(&name)).await.ok()?;
    let html = render_readme(Path::new(&path), &name, &String::from_utf8_lossy(&bytes));
    Some(RepoReadme { name, html })
}

pub async fn create_readme(path: String) -> Result<(), String> {
    let root = Path::new(&path);
    let mut entries = tokio::fs::read_dir(root).await.map_err(|e| e.to_string())?;
    while let Ok(Some(entry)) = entries.next_entry().await {
        if is_readme(&entry.file_name().to_string_lossy()) {
            return Ok(());
        }
    }
    let folder = root.file_name().and_then(|n| n.to_str()).unwrap_or("");
    tokio::fs::write(root.join("README.md"), format!("# {folder}\n"))
        .await
        .map_err(|e| e.to_string())
}

fn icons_dir() -> PathBuf {
    crate::store::user_data().join("icons")
}

fn icon_name_ok(name: &str) -> bool {
    !name.contains('/') && !name.contains('\\') && !name.contains("..")
}

pub async fn copy_icon(source: String) -> Option<String> {
    let source = PathBuf::from(source);
    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let name = format!("{stamp}.{ext}");
    let dir = icons_dir();
    tokio::fs::create_dir_all(&dir).await.ok()?;
    tokio::fs::copy(&source, dir.join(&name)).await.ok()?;
    Some(name)
}

pub async fn icon_data(name: String) -> Option<String> {
    if !icon_name_ok(&name) {
        return None;
    }
    let bytes = tokio::fs::read(icons_dir().join(&name)).await.ok()?;
    let lower = name.to_lowercase();
    let mime = if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "jpeg"
    } else {
        "png"
    };
    Some(format!(
        "data:image/{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn readme_repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a b.png"), b"png").unwrap();
        std::fs::write(dir.path().join("x.txt"), b"t").unwrap();
        std::fs::write(dir.path().join("big.png"), vec![0u8; 5 * 1024 * 1024 + 1]).unwrap();
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        std::fs::write(dir.path().join("sub").join("README.md"), b"").unwrap();
        dir
    }

    #[test]
    fn readme_filters_link_schemes() {
        let dir = readme_repo();
        let html = render_readme(
            dir.path(),
            "README.md",
            "[a](javascript:alert(1)) [b](https://x.io) [c](rel/p)",
        );
        assert!(!html.contains("javascript"));
        assert!(html.contains("href=\"https://x.io\""));
        assert!(html.contains("href=\"rel/p\""));
    }

    #[test]
    fn readme_inlines_relative_images_only_inside_repo() {
        let dir = readme_repo();
        let html = render_readme(dir.path(), "README.md", "![i](a%20b.png?raw=1)");
        assert!(html.contains("src=\"data:image/png;base64,cG5n\""));
        let html = render_readme(dir.path(), "sub/README.md", "![i](../a%20b.png)");
        assert!(html.contains("data:image/png;base64,"));
        let parent = dir.path().join("sub");
        let html = render_readme(&parent, "README.md", "![i](../a%20b.png)");
        assert!(!html.contains("data:"));
        let html = render_readme(
            dir.path(),
            "README.md",
            "![i](big.png) ![j](x.txt) ![k](data:image/png;base64,AA)",
        );
        assert!(!html.contains("base64,AA"));
        assert!(!html.contains("src=\"data:"));
    }

    #[test]
    fn status_gives_branch_upstream_and_counts() {
        let text = "# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -3\n1 .M N... 100644 100644 100644 a b f.txt\nu UU N... 1 2 3 4 a b c g.txt\n? new.txt\n";
        let s = parse_status(text, true);
        assert_eq!(s.branch.as_deref(), Some("main"));
        assert_eq!(s.upstream.as_deref(), Some("origin/main"));
        assert_eq!((s.ahead, s.behind), (2, 3));
        assert_eq!(
            s.wip,
            Some(WipSummary {
                added: 1,
                deleted: 0,
                modified: 2,
                renamed: 0
            })
        );
        let detached = parse_status("# branch.head (detached)\n", false);
        assert_eq!(detached.branch, None);
        assert_eq!(detached.wip, None);
    }

    #[test]
    fn wip_counts_staged_and_unstaged_separately() {
        let text = "1 MM N... 1 1 1 a b f1\n1 A. N... 1 1 1 a b f2\n1 .D N... 1 1 1 a b f3\n2 R. N... 1 1 1 a b R100 f4\tf5\n? u.txt\nu UU N... 1 2 3 4 a b c g\n";
        let w = parse_status(text, true).wip.unwrap();
        assert_eq!(
            w,
            WipSummary {
                added: 2,
                deleted: 1,
                modified: 3,
                renamed: 1
            }
        );
    }

    #[test]
    fn readme_prefers_markdown_then_shortest() {
        let pick =
            |names: &[&str]| pick_readme(&names.iter().map(|n| n.to_string()).collect::<Vec<_>>());
        assert_eq!(
            pick(&["README.txt", "readme.md", "README"]).as_deref(),
            Some("readme.md")
        );
        assert_eq!(
            pick(&["README.rst", "Readme.txt"]).as_deref(),
            Some("README.rst")
        );
        assert_eq!(pick(&["README.md.bak", "readme-notes.md", "a.md"]), None);
    }

    #[test]
    fn readme_html_escapes_raw_html() {
        let html = render_readme(
            Path::new("."),
            "README.md",
            "# T\n\n<script>x</script>\n\n| a |\n|---|\n| 1 |\n\n- [x] t\n",
        );
        assert!(html.contains("<h1>"));
        assert!(html.contains("<table>"));
        assert!(html.contains("checkbox"));
        assert!(!html.contains("<script>"));
        assert!(html.contains("&lt;script&gt;"));
        assert_eq!(
            render_readme(Path::new("."), "README", "<b>&"),
            "<pre>&lt;b&gt;&amp;</pre>"
        );
    }

    #[test]
    fn icon_names_with_separators_are_rejected() {
        assert!(!icon_name_ok("../x.png"));
        assert!(!icon_name_ok("a/b.png"));
        assert!(!icon_name_ok("a\\b.png"));
        assert!(icon_name_ok("123.png"));
    }

    #[test]
    fn scan_finds_repos_and_skips_inside_them() {
        let root = tempfile::tempdir().unwrap();
        let a = root.path().join("a");
        let nested = root.path().join("group/b");
        std::fs::create_dir_all(a.join(".git")).unwrap();
        std::fs::create_dir_all(a.join("inner/.git")).unwrap();
        std::fs::create_dir_all(nested.join(".git")).unwrap();
        std::fs::create_dir_all(root.path().join(".hidden/c/.git")).unwrap();
        let found = find(&[root.path().to_string_lossy().into_owned()]);
        let names: Vec<String> = found
            .iter()
            .map(|p| {
                Path::new(p)
                    .strip_prefix(root.path())
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/")
            })
            .collect();
        assert_eq!(names, vec!["a", "group/b"]);
    }

    #[test]
    fn code_workspace_paths_resolve_from_the_file() {
        let file = Path::new("/w/proj.code-workspace");
        let folders = code_workspace_folders(
            file,
            r#"{"folders":[{"path":"a"},{"path":"../b"},{"name":"x"}]}"#,
        );
        let want: Vec<String> = ["/w/a", "/b"]
            .iter()
            .map(|p| {
                paths::normalize(Path::new(p))
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        assert_eq!(folders, want);
    }

    #[tokio::test]
    async fn missing_folder_is_unreachable() {
        let s = summary("/no/such/folder/gitneat".into(), false).await;
        assert_eq!(s.error.as_deref(), Some(UNREACHABLE));
    }
}
