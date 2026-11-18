use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const NOT_FOUND: &str = "The configured external editor was not found";

pub struct Editor {
    pub id: &'static str,
    pub label: &'static str,
    pub bins: &'static [&'static str],
    pub apps: &'static [&'static str],
    pub multi: bool,
    pub os: Option<&'static str>,
}

pub const EDITORS: &[Editor] = &[
    Editor { id: "atom", label: "Atom", bins: &["atom"], apps: &["Atom.app"], multi: false, os: None },
    Editor { id: "cursor", label: "Cursor", bins: &["cursor"], apps: &["Cursor.app"], multi: true, os: None },
    Editor { id: "windsurf", label: "Windsurf", bins: &["windsurf"], apps: &["Windsurf.app"], multi: true, os: None },
    Editor { id: "vscode", label: "Visual Studio Code", bins: &["code"], apps: &["Visual Studio Code.app"], multi: true, os: None },
    Editor { id: "zed", label: "Zed", bins: &["zed"], apps: &["Zed.app"], multi: true, os: None },
    Editor { id: "eclipse", label: "Eclipse", bins: &["eclipse"], apps: &["Eclipse.app"], multi: false, os: None },
    Editor { id: "xcode", label: "Xcode", bins: &["xed"], apps: &["Xcode.app"], multi: false, os: Some("macos") },
    Editor { id: "sublime", label: "Sublime Text", bins: &["subl"], apps: &["Sublime Text.app"], multi: true, os: None },
    Editor { id: "intellij-ce", label: "IntelliJ IDEA CE", bins: &["idea"], apps: &["IntelliJ IDEA CE.app"], multi: true, os: None },
    Editor { id: "intellij", label: "IntelliJ IDEA", bins: &["idea"], apps: &["IntelliJ IDEA.app"], multi: true, os: None },
    Editor { id: "pycharm", label: "PyCharm", bins: &["pycharm", "charm"], apps: &["PyCharm.app"], multi: true, os: None },
    Editor { id: "pycharm-ce", label: "PyCharm CE", bins: &["pycharm", "charm"], apps: &["PyCharm CE.app"], multi: true, os: None },
    Editor { id: "rider", label: "Rider", bins: &["rider"], apps: &["Rider.app"], multi: false, os: None },
    Editor { id: "visualstudio", label: "Visual Studio", bins: &["devenv"], apps: &[], multi: false, os: Some("windows") },
];

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalEditor {
    pub id: String,
    pub label: String,
}

#[derive(Debug, PartialEq, Clone)]
pub enum Launcher {
    Binary(PathBuf),
    Bundle(PathBuf),
}

pub fn lookup(id: &str) -> Option<&'static Editor> {
    EDITORS.iter().find(|e| e.id == id)
}

fn available(editor: &Editor) -> bool {
    editor.os.is_none_or(|os| os == std::env::consts::OS)
}

fn find_binary(names: &[&str]) -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    if cfg!(target_os = "macos") {
        dirs.push(PathBuf::from("/usr/local/bin"));
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
    }
    let suffixes: &[&str] = if cfg!(windows) { &[".exe", ".cmd"] } else { &[""] };
    for name in names {
        for dir in &dirs {
            for suffix in suffixes {
                let candidate = dir.join(format!("{name}{suffix}"));
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

fn find_bundle(apps: &[&str]) -> Option<PathBuf> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    let mut roots = vec![PathBuf::from("/Applications")];
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join("Applications"));
    }
    for app in apps {
        for root in &roots {
            let candidate = root.join(app);
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    None
}

fn resolve(editor: &Editor) -> Option<Launcher> {
    if !available(editor) {
        return None;
    }
    find_binary(editor.bins)
        .map(Launcher::Binary)
        .or_else(|| find_bundle(editor.apps).map(Launcher::Bundle))
}

pub fn plan(launcher: &Launcher, multi: bool, paths: &[String]) -> Vec<(String, Vec<String>)> {
    let build = |chunk: &[String]| match launcher {
        Launcher::Binary(bin) => (bin.to_string_lossy().into_owned(), chunk.to_vec()),
        Launcher::Bundle(app) => {
            let mut args = vec!["-na".to_string(), app.to_string_lossy().into_owned(), "--args".to_string()];
            args.extend(chunk.iter().cloned());
            ("open".to_string(), args)
        }
    };
    if multi {
        vec![build(paths)]
    } else {
        paths.iter().map(|p| build(std::slice::from_ref(p))).collect()
    }
}

#[tauri::command]
pub async fn external_editors() -> Vec<ExternalEditor> {
    tokio::task::spawn_blocking(|| {
        EDITORS
            .iter()
            .filter(|e| resolve(e).is_some())
            .map(|e| ExternalEditor {
                id: e.id.into(),
                label: e.label.into(),
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

fn spawn(label: &str, program: &str, args: &[String]) -> Result<(), String> {
    Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(drop)
        .map_err(|e| format!("Failed to open {label}: {e}"))
}

#[tauri::command]
pub async fn open_in_editor(editor: String, custom_path: String, paths: Vec<String>) -> Result<(), String> {
    if editor.is_empty() {
        return Err("There is no external editor configured in your settings".into());
    }
    let (label, launcher, multi) = if editor == "custom" {
        let file = Path::new(&custom_path);
        let is_app = cfg!(target_os = "macos") && custom_path.ends_with(".app") && file.exists();
        if !is_app && !file.is_file() {
            return Err(NOT_FOUND.into());
        }
        let launcher = if is_app {
            Launcher::Bundle(file.to_path_buf())
        } else {
            Launcher::Binary(file.to_path_buf())
        };
        ("the external editor", launcher, true)
    } else {
        let found = lookup(&editor).ok_or(NOT_FOUND)?;
        let launcher = resolve(found).ok_or(NOT_FOUND)?;
        (found.label, launcher, found.multi)
    };
    for (program, args) in plan(&launcher, multi, &paths) {
        spawn(label, &program, &args)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn table_lookup() {
        assert_eq!(lookup("vscode").unwrap().bins, &["code"]);
        assert!(lookup("vscode").unwrap().multi);
        assert!(!lookup("rider").unwrap().multi);
        assert!(lookup("nope").is_none());
        assert_eq!(EDITORS.len(), 14);
    }

    #[test]
    fn plan_binary_multi_and_single() {
        let bin = Launcher::Binary(PathBuf::from("/bin/code"));
        let paths = vec!["a".to_string(), "b".to_string()];
        assert_eq!(plan(&bin, true, &paths), vec![("/bin/code".to_string(), paths.clone())]);
        assert_eq!(
            plan(&bin, false, &paths),
            vec![
                ("/bin/code".to_string(), vec!["a".to_string()]),
                ("/bin/code".to_string(), vec!["b".to_string()]),
            ]
        );
    }

    #[test]
    fn plan_bundle_uses_open() {
        let app = Launcher::Bundle(PathBuf::from("/Applications/Zed.app"));
        let planned = plan(&app, true, &["a".to_string()]);
        assert_eq!(planned[0].0, "open");
        assert_eq!(planned[0].1, vec!["-na", "/Applications/Zed.app", "--args", "a"]);
    }
}
