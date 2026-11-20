use std::path::{Component, Path, PathBuf};

pub fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for part in path.components() {
        match part {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    out.push(part);
                }
            }
            other => out.push(other),
        }
    }
    out
}

pub fn resolve(cwd: &str, rel: &str) -> PathBuf {
    normalize(&Path::new(cwd).join(rel))
}

fn key(path: &Path) -> String {
    let text = normalize(path).to_string_lossy().into_owned();
    if cfg!(windows) {
        text.replace('/', "\\").to_lowercase()
    } else {
        text
    }
}

pub fn inside<'a>(roots: impl IntoIterator<Item = &'a String>, target: &Path) -> bool {
    let target = PathBuf::from(key(target));
    roots
        .into_iter()
        .any(|root| target.starts_with(key(Path::new(root))))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_and_checks_containment() {
        let roots = vec!["/repo".to_string()];
        assert!(inside(&roots, &resolve("/repo", "src/a.ts")));
        assert!(inside(&roots, &resolve("/repo", ".")));
        assert!(!inside(&roots, &resolve("/repo", "../other/a.ts")));
        assert!(!inside(&roots, &resolve("/repo", "/etc/passwd")));
        assert!(!inside(&roots, Path::new("/repository/a")));
    }
}
