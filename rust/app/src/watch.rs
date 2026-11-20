use notify::{RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::Path;
use std::sync::LazyLock;
use std::sync::Mutex;
use std::sync::mpsc;
use std::time::Duration;

#[derive(Default)]
pub struct Watchers(pub Mutex<HashMap<String, notify::RecommendedWatcher>>);

static WATCHERS: LazyLock<Watchers> = LazyLock::new(Watchers::default);

pub fn roots() -> Vec<String> {
    WATCHERS
        .0
        .lock()
        .map(|m| m.keys().cloned().collect())
        .unwrap_or_default()
}

pub fn watch(cwd: String) {
    let Ok(mut map) = WATCHERS.0.lock() else {
        return;
    };
    if map.contains_key(&cwd) {
        return;
    }
    if let Ok(watcher) = start(cwd.clone()) {
        map.insert(cwd, watcher);
    }
}

pub fn unwatch(cwd: &str) {
    if let Ok(mut map) = WATCHERS.0.lock() {
        map.remove(cwd);
    }
}

pub fn ignored(cwd: &Path, file: &Path) -> bool {
    let rel = file.strip_prefix(cwd).unwrap_or(file);
    let name = rel.to_string_lossy().replace('\\', "/");
    name.contains("node_modules/") || name.starts_with(".git/objects/") || name.ends_with(".lock")
}

fn start(cwd: String) -> notify::Result<notify::RecommendedWatcher> {
    let (tx, rx) = mpsc::channel::<()>();
    let root = std::fs::canonicalize(&cwd).unwrap_or_else(|_| cwd.clone().into());
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if let Ok(event) = event
            && event.paths.iter().any(|p| !ignored(&root, p))
        {
            let _ = tx.send(());
        }
    })?;
    watcher.watch(Path::new(&cwd), RecursiveMode::Recursive)?;
    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            loop {
                match rx.recv_timeout(Duration::from_millis(400)) {
                    Ok(()) => continue,
                    Err(mpsc::RecvTimeoutError::Timeout) => break,
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
            crate::emit::emit("repo-changed", &cwd);
        }
    });
    Ok(watcher)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_noise_paths() {
        let cwd = Path::new("/repo");
        assert!(ignored(cwd, Path::new("/repo/.git/objects/ab/cd")));
        assert!(ignored(cwd, Path::new("/repo/.git/index.lock")));
        assert!(ignored(cwd, Path::new("/repo/web/node_modules/x/y.js")));
        assert!(!ignored(cwd, Path::new("/repo/.git/HEAD")));
        assert!(!ignored(cwd, Path::new("/repo/src/a.ts")));
    }
}
