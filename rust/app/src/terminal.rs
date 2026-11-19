use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct Terminals {
    next: AtomicU32,
    sessions: Arc<Mutex<HashMap<u32, Session>>>,
}

#[derive(Serialize, Clone)]
struct Data {
    id: u32,
    data: String,
}

fn shell() -> (String, Vec<&'static str>) {
    if cfg!(windows) {
        let program = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into());
        return (program, Vec::new());
    }
    let program = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    (program, vec!["-l"])
}

fn split_utf8(pending: &mut Vec<u8>) -> String {
    let valid = match std::str::from_utf8(pending) {
        Ok(_) => pending.len(),
        Err(e) if e.error_len().is_none() => e.valid_up_to(),
        Err(_) => {
            let text = String::from_utf8_lossy(pending).into_owned();
            pending.clear();
            return text;
        }
    };
    let rest = pending.split_off(valid);
    let text = String::from_utf8_lossy(pending).into_owned();
    *pending = rest;
    text
}

#[tauri::command]
pub fn term_open(
    app: AppHandle,
    terminals: State<Terminals>,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<u32, String> {
    let pair = native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    let (program, args) = shell();
    let mut command = CommandBuilder::new(program);
    command.args(args);
    command.cwd(cwd);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|e| e.to_string())?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let id = terminals.next.fetch_add(1, Ordering::SeqCst) + 1;
    terminals
        .sessions
        .lock()
        .map_err(|e| e.to_string())?
        .insert(
            id,
            Session {
                master: pair.master,
                writer,
                child,
            },
        );
    let sessions = terminals.sessions.clone();
    std::thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        let mut pending: Vec<u8> = Vec::new();
        while let Ok(n) = reader.read(&mut buffer) {
            if n == 0 {
                break;
            }
            pending.extend_from_slice(&buffer[..n]);
            let data = split_utf8(&mut pending);
            if !data.is_empty() {
                let _ = app.emit("term-data", Data { id, data });
            }
        }
        if let Ok(mut held) = sessions.lock() {
            held.remove(&id);
        }
        let _ = app.emit("term-exit", id);
    });
    Ok(id)
}

#[tauri::command]
pub fn term_write(terminals: State<Terminals>, id: u32, data: String) {
    if let Ok(mut held) = terminals.sessions.lock()
        && let Some(session) = held.get_mut(&id)
    {
        let _ = session.writer.write_all(data.as_bytes());
        let _ = session.writer.flush();
    }
}

#[tauri::command]
pub fn term_resize(terminals: State<Terminals>, id: u32, cols: u16, rows: u16) {
    if let Ok(held) = terminals.sessions.lock()
        && let Some(session) = held.get(&id)
    {
        let _ = session.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        });
    }
}

#[tauri::command]
pub fn term_close(terminals: State<Terminals>, id: u32) {
    if let Ok(mut held) = terminals.sessions.lock()
        && let Some(mut session) = held.remove(&id)
    {
        let _ = session.child.kill();
    }
}

#[cfg(test)]
mod tests {
    use super::split_utf8;

    #[test]
    fn keeps_a_split_character_for_the_next_read() {
        let mut pending = "aé".as_bytes()[..2].to_vec();
        assert_eq!(split_utf8(&mut pending), "a");
        pending.push("é".as_bytes()[1]);
        assert_eq!(split_utf8(&mut pending), "é");
        assert!(pending.is_empty());
    }

    #[test]
    fn replaces_bytes_that_are_not_utf8() {
        let mut pending = vec![b'a', 0xff, b'b'];
        assert_eq!(split_utf8(&mut pending), "a\u{fffd}b");
        assert!(pending.is_empty());
    }
}
