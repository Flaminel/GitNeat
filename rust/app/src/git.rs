use serde::Serialize;
use std::collections::HashMap;
use std::process::Stdio;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

#[derive(Serialize, Debug, PartialEq)]
pub struct GitResult {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

const BLOCKED: [&str; 5] = [
    "--upload-pack",
    "--receive-pack",
    "--exec",
    "--exec-path",
    "--config-env",
];

pub fn blocked(args: &[String]) -> bool {
    if args.first().is_some_and(|a| a == "-c") {
        return true;
    }
    args.iter().any(|arg| {
        BLOCKED.iter().any(|b| {
            arg.strip_prefix(b)
                .is_some_and(|rest| rest.is_empty() || rest.starts_with('='))
        })
    })
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const WINDOWS_CONFIG: [(&str, &str); 2] = [("core.fscache", "true"), ("core.preloadindex", "true")];

pub fn command(program: &str) -> Command {
    #[cfg(windows)]
    {
        let mut cmd = Command::new(program);
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }
    #[cfg(not(windows))]
    {
        Command::new(program)
    }
}

pub async fn run_git(
    cwd: &str,
    args: &[String],
    env: Option<HashMap<String, String>>,
    input: Option<String>,
) -> GitResult {
    let mut cmd = command("git");
    cmd.args(args)
        .current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("LC_ALL", "C");
    if cfg!(windows) {
        cmd.env("GIT_CONFIG_COUNT", WINDOWS_CONFIG.len().to_string());
        for (i, (key, value)) in WINDOWS_CONFIG.iter().enumerate() {
            cmd.env(format!("GIT_CONFIG_KEY_{i}"), key)
                .env(format!("GIT_CONFIG_VALUE_{i}"), value);
        }
    }
    let askpass = crate::askpass::begin();
    if let Some((_, vars)) = &askpass {
        cmd.envs(vars.iter().map(|(k, v)| (*k, v.as_str())));
    }
    cmd.envs(env.unwrap_or_default())
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) => {
            return GitResult {
                code: 1,
                stdout: String::new(),
                stderr: format!("spawn git: {e}"),
            };
        }
    };
    if let (Some(text), Some(mut stdin)) = (input, child.stdin.take()) {
        tokio::spawn(async move {
            let _ = stdin.write_all(text.as_bytes()).await;
        });
    }
    let result = match child.wait_with_output().await {
        Ok(out) => {
            let code = out.status.code().unwrap_or(1);
            let mut stderr = String::from_utf8_lossy(&out.stderr).into_owned();
            if stderr.is_empty() && code != 0 {
                stderr = format!("Command failed: git {}", args.join(" "));
            }
            GitResult {
                code,
                stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
                stderr,
            }
        }
        Err(e) => GitResult {
            code: 1,
            stdout: String::new(),
            stderr: e.to_string(),
        },
    };
    if let Some((id, _)) = askpass {
        crate::askpass::end(id, result.code, &result.stderr);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn blocks_command_running_options() {
        assert!(blocked(&args(&["-c", "core.pager=x", "log"])));
        assert!(blocked(&args(&["fetch", "--upload-pack=evil"])));
        assert!(blocked(&args(&["fetch", "--upload-pack"])));
        assert!(blocked(&args(&["--exec-path"])));
        assert!(!blocked(&args(&["log", "--execute"])));
        assert!(!blocked(&args(&["commit", "-m", "-c"])));
    }

    #[tokio::test]
    async fn runs_git_with_stdin_and_exit_code() {
        let dir = tempfile::tempdir().unwrap();
        let cwd = dir.path().to_str().unwrap();
        let ok = run_git(
            cwd,
            &args(&["hash-object", "--stdin"]),
            None,
            Some("hi\n".into()),
        )
        .await;
        assert_eq!(ok.code, 0);
        assert_eq!(ok.stdout, "45b983be36b73c0788dc9cbcb76cbb80fc7bb057\n");
        let bad = run_git(cwd, &args(&["rev-parse", "HEAD"]), None, None).await;
        assert_eq!(bad.code, 128);
        assert!(!bad.stderr.is_empty());
    }
}
