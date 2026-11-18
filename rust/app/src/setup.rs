use crate::actions::{Res, git, git_env};
use crate::git::{blocked, run_git, run_git_with};
use crate::templates::{GITIGNORE, LICENSES};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

const DEFAULT_DEPTH: u32 = 50;

#[derive(Serialize)]
pub struct LicenseInfo {
    key: &'static str,
    title: &'static str,
}

#[derive(Serialize)]
pub struct Templates {
    home: String,
    lfs: bool,
    gitignore: Vec<&'static str>,
    licenses: Vec<LicenseInfo>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct Shallow {
    branch: String,
    depth: String,
    since: String,
    flags: String,
}

#[derive(Serialize, Clone)]
struct CloneProgress {
    target: String,
    percent: u32,
}

fn clone_args(url: &str, target: &str, shallow: Option<&Shallow>) -> Vec<String> {
    let mut args: Vec<String> = ["clone", "--progress"].map(String::from).to_vec();
    if let Some(s) = shallow {
        if !s.branch.trim().is_empty() {
            args.extend([
                "--single-branch".into(),
                "--branch".into(),
                s.branch.trim().into(),
            ]);
        }
        let depth = s.depth.trim();
        args.push("--depth".into());
        args.push(if depth.is_empty() {
            DEFAULT_DEPTH.to_string()
        } else {
            depth.into()
        });
        if !s.since.trim().is_empty() {
            args.extend(["--shallow-since".into(), s.since.trim().into()]);
        }
        args.extend(s.flags.split_whitespace().map(String::from));
    }
    args.extend(["--".into(), url.into(), target.into()]);
    args
}

fn percent_of(line: &str) -> Option<u32> {
    let line = line.strip_prefix("remote: ").unwrap_or(line);
    if line.starts_with("Resolving deltas:") {
        return Some(100);
    }
    let rest = line.strip_prefix("Receiving objects:")?;
    rest.trim_start().split('%').next()?.trim().parse().ok()
}

fn clean_error(stderr: &str) -> String {
    stderr
        .split(['\r', '\n'])
        .map(str::trim)
        .filter(|l| {
            !l.is_empty()
                && !l.contains("% (")
                && !l.starts_with("remote: Enumerating")
                && !l.starts_with("remote: Total")
                && !l.starts_with("Cloning into")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[tauri::command]
pub async fn repo_templates() -> Templates {
    let lfs = run_git(".", &["lfs".to_string(), "version".to_string()], None, None)
        .await
        .code
        == 0;
    Templates {
        lfs,
        home: dirs::home_dir()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default(),
        gitignore: GITIGNORE.iter().map(|(name, _)| *name).collect(),
        licenses: LICENSES
            .iter()
            .map(|(key, title, _)| LicenseInfo { key, title })
            .collect(),
    }
}

#[tauri::command]
pub async fn clone_repo(
    app: AppHandle,
    parent: String,
    url: String,
    target: String,
    shallow: Option<Shallow>,
) -> Res<String> {
    let args = clone_args(&url, &target, shallow.as_ref());
    if blocked(&args) {
        return Err("GitNeat blocked a git option that can run commands.".into());
    }
    std::fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
    let report = {
        let target = target.clone();
        move |line: &str| {
            if let Some(percent) = percent_of(line) {
                let _ = app.emit(
                    "clone-progress",
                    CloneProgress {
                        target: target.clone(),
                        percent,
                    },
                );
            }
        }
    };
    let result = run_git_with(&parent, &args, None, None, Some(&report)).await;
    if result.code != 0 {
        let text = clean_error(&result.stderr);
        return Err(if text.is_empty() {
            "git clone failed".into()
        } else {
            text
        });
    }
    Ok(target)
}

fn current_year() -> i64 {
    let days = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() / 86400)
        .unwrap_or(0) as i64;
    year_of(days)
}

fn year_of(days: i64) -> i64 {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    yoe + era * 400 + i64::from(mp >= 10)
}

fn fill_license(text: &str, email: &str, name: &str, year: i64) -> String {
    text.replace("[email]", email)
        .replace("[username]", name)
        .replace("[year]", &year.to_string())
}

async fn init_in(
    parent: &str,
    name: &str,
    branch: &str,
    gitignore: &str,
    license: &str,
    lfs: bool,
    env: HashMap<String, String>,
) -> Res<String> {
    let name = name.trim();
    if name.is_empty() || name == "." || name.contains(['/', '\\']) || name.contains("..") {
        return Err("Invalid repository name.".into());
    }
    let target = Path::new(parent).join(name);
    std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    let dir = target.to_string_lossy().into_owned();
    let branch = branch.trim();
    let mut init = vec!["init"];
    if !branch.is_empty() {
        init.extend(["-b", branch]);
    }
    git(&dir, &init).await?;
    if lfs {
        git(&dir, &["lfs", "install", "--local"]).await?;
    }
    let mut staged = vec!["README.md"];
    let readme = target.join("README.md");
    if !readme.exists() {
        std::fs::write(&readme, format!("# {name}\n")).map_err(|e| e.to_string())?;
    }
    if let Some((_, _, text)) = LICENSES
        .iter()
        .find(|(key, _, _)| !license.is_empty() && *key == license)
    {
        let email = git(&dir, &["config", "user.email"])
            .await
            .unwrap_or_default();
        let user = git(&dir, &["config", "user.name"])
            .await
            .unwrap_or_default();
        let filled = fill_license(text, email.trim(), user.trim(), current_year());
        std::fs::write(target.join("LICENSE.md"), filled).map_err(|e| e.to_string())?;
        staged.push("LICENSE.md");
    }
    if let Some((_, text)) = GITIGNORE
        .iter()
        .find(|(key, _)| !gitignore.is_empty() && *key == gitignore)
    {
        std::fs::write(target.join(".gitignore"), text).map_err(|e| e.to_string())?;
        staged.push(".gitignore");
    }
    let mut add = vec!["add", "--"];
    add.extend(staged);
    git(&dir, &add).await?;
    git_env(&dir, &["commit", "-q", "-m", "Initial commit"], env).await?;
    Ok(dir)
}

#[tauri::command]
pub async fn init_repo(
    parent: String,
    name: String,
    branch: String,
    gitignore: String,
    license: String,
    lfs: bool,
) -> Res<String> {
    init_in(
        &parent,
        &name,
        &branch,
        &gitignore,
        &license,
        lfs,
        HashMap::new(),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_follows_the_receiving_phase() {
        assert_eq!(percent_of("Receiving objects:  45% (9/20)"), Some(45));
        assert_eq!(percent_of("remote: Receiving objects: 7% (1/14)"), Some(7));
        assert_eq!(percent_of("Resolving deltas: 10% (1/10)"), Some(100));
        assert_eq!(percent_of("Cloning into 'x'..."), None);
    }

    #[test]
    fn error_text_drops_progress_lines() {
        let text =
            "Cloning into 'x'...\rReceiving objects: 10% (1/10)\nfatal: repository 'y' not found\n";
        assert_eq!(clean_error(text), "fatal: repository 'y' not found");
    }

    #[test]
    fn shallow_options_become_clone_flags() {
        let shallow = Shallow {
            branch: "dev".into(),
            depth: String::new(),
            since: "2024-01-01".into(),
            flags: "--no-tags  --quiet".into(),
        };
        let args = clone_args("u", "t", Some(&shallow));
        assert_eq!(
            args.join(" "),
            "clone --progress --single-branch --branch dev --depth 50 --shallow-since 2024-01-01 --no-tags --quiet -- u t"
        );
        assert_eq!(
            clone_args("u", "t", None).join(" "),
            "clone --progress -- u t"
        );
    }

    #[test]
    fn year_of_matches_known_days() {
        assert_eq!(year_of(0), 1970);
        assert_eq!(year_of(19_722), 2023);
        assert_eq!(year_of(19_723), 2024);
        assert_eq!(year_of(20_088), 2024);
        assert_eq!(year_of(20_089), 2025);
    }

    #[test]
    fn license_tags_are_filled() {
        assert_eq!(
            fill_license("(c) [year] [username] <[email]>", "a@b", "Ann", 2026),
            "(c) 2026 Ann <a@b>"
        );
    }

    #[test]
    fn templates_list_the_copyright_notice_first() {
        assert_eq!(LICENSES[0].0, "_copyright-notice");
        assert!(GITIGNORE.iter().any(|(name, _)| *name == "Rust"));
    }

    #[tokio::test]
    async fn init_writes_the_files_and_commits_them() {
        let dir = tempfile::tempdir().unwrap();
        let parent = dir.path().to_str().unwrap();
        let env = HashMap::from(
            ["GIT_AUTHOR_NAME", "GIT_COMMITTER_NAME"].map(|k| (k.to_string(), "Ann".to_string())),
        )
        .into_iter()
        .chain(
            ["GIT_AUTHOR_EMAIL", "GIT_COMMITTER_EMAIL"].map(|k| (k.to_string(), "a@b".to_string())),
        )
        .collect();
        let path = init_in(parent, "demo", "trunk", "Rust", "mit", false, env)
            .await
            .unwrap();
        let files = git(&path, &["ls-tree", "--name-only", "HEAD"])
            .await
            .unwrap();
        assert_eq!(
            files.lines().collect::<Vec<_>>(),
            [".gitignore", "LICENSE.md", "README.md"]
        );
        let branch = git(&path, &["symbolic-ref", "--short", "HEAD"])
            .await
            .unwrap();
        assert_eq!(branch.trim(), "trunk");
        let subject = git(&path, &["log", "-1", "--format=%s"]).await.unwrap();
        assert_eq!(subject.trim(), "Initial commit");
        let readme = std::fs::read_to_string(format!("{path}/README.md")).unwrap();
        assert_eq!(readme, "# demo\n");
        assert!(
            init_in(parent, "a/b", "", "", "", false, HashMap::new())
                .await
                .is_err()
        );
        assert!(
            init_in(parent, "other", "bad name", "", "", false, HashMap::new())
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn clone_streams_progress_lines() {
        let dir = tempfile::tempdir().unwrap();
        let parent = dir.path().to_str().unwrap();
        let env = HashMap::from([
            ("GIT_AUTHOR_NAME".to_string(), "Ann".to_string()),
            ("GIT_COMMITTER_NAME".to_string(), "Ann".to_string()),
            ("GIT_AUTHOR_EMAIL".to_string(), "a@b".to_string()),
            ("GIT_COMMITTER_EMAIL".to_string(), "a@b".to_string()),
        ]);
        let source = init_in(parent, "source", "main", "", "", false, env)
            .await
            .unwrap();
        let target = dir.path().join("copy").to_string_lossy().into_owned();
        let lines = std::sync::Mutex::new(Vec::new());
        let report = |line: &str| lines.lock().unwrap().push(line.to_string());
        let args = clone_args(&format!("file://{source}"), &target, None);
        let result = run_git_with(parent, &args, None, None, Some(&report)).await;
        assert_eq!(result.code, 0, "{}", result.stderr);
        assert!(
            lines
                .lock()
                .unwrap()
                .iter()
                .any(|l| l.contains("Cloning into"))
        );
        assert!(dir.path().join("copy/README.md").exists());
    }
}
