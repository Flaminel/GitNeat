const MARK: &str = "_GN_DELIM_";

pub fn parse_path(output: &str) -> Option<String> {
    let start = output.find(MARK)? + MARK.len();
    let rest = &output[start..];
    let path = rest[..rest.find(MARK)?].trim();
    if path.is_empty() {
        None
    } else {
        Some(path.to_string())
    }
}

#[cfg(target_os = "macos")]
fn login_path() -> Option<String> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut child = Command::new(shell)
        .arg("-ilc")
        .arg(format!("echo \"{MARK} $PATH {MARK}\""))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut text = String::new();
        let _ = stdout.read_to_string(&mut text);
        let _ = tx.send(text);
    });
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break;
            }
        }
    }
    parse_path(&rx.recv_timeout(Duration::from_millis(500)).ok()?)
}

pub fn apply() {
    #[cfg(target_os = "macos")]
    {
        if std::env::var_os("GITNEAT_ASKPASS_PORT").is_some() {
            return;
        }
        if let Some(path) = login_path() {
            unsafe {
                std::env::set_var("PATH", path);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_between_markers() {
        let out = "noise\n_GN_DELIM_ /a:/b _GN_DELIM_\n";
        assert_eq!(parse_path(out).as_deref(), Some("/a:/b"));
        assert_eq!(parse_path("_GN_DELIM_  _GN_DELIM_"), None);
        assert_eq!(parse_path("_GN_DELIM_ /a"), None);
        assert_eq!(parse_path("nothing"), None);
    }
}
