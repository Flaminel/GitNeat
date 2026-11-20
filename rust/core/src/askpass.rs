use serde::{Deserialize, Serialize};
use std::collections::hash_map::RandomState;
use std::collections::{HashMap, HashSet};
use std::hash::BuildHasher;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock, mpsc};
use std::time::{Duration, Instant};

const PORT: &str = "GITNEAT_ASKPASS_PORT";
const TOKEN: &str = "GITNEAT_ASKPASS_TOKEN";
const ID: &str = "GITNEAT_ASKPASS_ID";
const CACHE_TIME: Duration = Duration::from_secs(30);
const WAIT_TIME: Duration = Duration::from_secs(600);
const AUTH_ERRORS: [&str; 7] = [
    "Authentication failed",
    "Invalid username or password",
    "Permission denied",
    "returned error: 401",
    "returned error: 403",
    "could not read Username",
    "could not read Password",
];

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Username,
    Password,
    Passphrase,
    Other,
}

#[derive(Clone, Serialize, Debug)]
pub struct Request {
    pub request: u64,
    pub kind: Kind,
    pub target: String,
    pub user: String,
    pub retry: bool,
}

#[derive(Deserialize, Clone, Debug)]
pub struct Reply {
    pub username: String,
    pub password: String,
    pub remember: bool,
}

#[derive(Serialize, Deserialize)]
struct Ask {
    token: String,
    id: u64,
    prompt: String,
}

#[derive(Serialize, Deserialize)]
struct Answer {
    answer: Option<String>,
}

struct Saved {
    value: String,
    time: Instant,
    remember: bool,
}

#[derive(Default)]
struct State {
    cache: HashMap<(Kind, String), Saved>,
    served: HashMap<u64, Vec<(Kind, String)>>,
    cancelled: HashSet<u64>,
    failed: HashSet<String>,
    pending: HashMap<u64, mpsc::Sender<Option<Reply>>>,
}

type Emit = Box<dyn Fn(Request) + Send + Sync>;

pub struct Server {
    exe: String,
    port: u16,
    token: String,
    emit: Emit,
    state: Mutex<State>,
    prompt: Mutex<()>,
}

static SERVER: OnceLock<Arc<Server>> = OnceLock::new();
static NEXT: AtomicU64 = AtomicU64::new(1);

fn next_id() -> u64 {
    NEXT.fetch_add(1, Ordering::Relaxed)
}

fn token() -> String {
    let a = RandomState::new().hash_one(std::process::id());
    let b = RandomState::new().hash_one(Instant::now());
    format!("{a:016x}{b:016x}")
}

pub fn parse(prompt: &str) -> (Kind, String) {
    let text = prompt.trim();
    let rules = [
        ("Username for ", Kind::Username),
        ("Password for ", Kind::Password),
        ("Enter passphrase for key ", Kind::Passphrase),
    ];
    for (head, kind) in rules {
        if let Some(rest) = text.strip_prefix(head) {
            let target = rest
                .trim_end_matches(':')
                .trim()
                .trim_matches(|c| c == '\'' || c == '"');
            return (kind, target.to_string());
        }
    }
    (Kind::Other, text.to_string())
}

fn split_user(url: &str) -> (String, String) {
    if let Some((scheme, rest)) = url.split_once("://")
        && let Some((user, host)) = rest.split_once('@')
        && !user.contains('/')
    {
        return (format!("{scheme}://{host}"), user.to_string());
    }
    (url.to_string(), String::new())
}

pub fn start(exe: String, emit: Emit) -> std::io::Result<Arc<Server>> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let server = Arc::new(Server {
        exe,
        port: listener.local_addr()?.port(),
        token: token(),
        emit,
        state: Mutex::new(State::default()),
        prompt: Mutex::new(()),
    });
    let shared = server.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let server = shared.clone();
            std::thread::spawn(move || {
                let _ = server.serve(stream);
            });
        }
    });
    Ok(server)
}

pub fn install(server: Arc<Server>) {
    let _ = SERVER.set(server);
}

pub fn reply(request: u64, reply: Option<Reply>) {
    if let Some(server) = SERVER.get() {
        server.answer(request, reply);
    }
}

pub fn begin() -> Option<(u64, Vec<(&'static str, String)>)> {
    let server = SERVER.get()?;
    let id = next_id();
    Some((id, server.env(id)))
}

pub fn end(id: u64, code: i32, stderr: &str) {
    if let Some(server) = SERVER.get() {
        server.finish(
            id,
            code != 0 && AUTH_ERRORS.iter().any(|e| stderr.contains(e)),
        );
    }
}

impl Server {
    pub fn env(&self, id: u64) -> Vec<(&'static str, String)> {
        vec![
            ("GIT_ASKPASS", self.exe.clone()),
            ("SSH_ASKPASS", self.exe.clone()),
            ("SSH_ASKPASS_REQUIRE", "force".into()),
            (PORT, self.port.to_string()),
            (TOKEN, self.token.clone()),
            (ID, id.to_string()),
        ]
    }

    fn serve(&self, stream: TcpStream) -> std::io::Result<()> {
        let mut line = String::new();
        BufReader::new(stream.try_clone()?.take(65536)).read_line(&mut line)?;
        let ask: Ask = serde_json::from_str(&line)?;
        let answer = if ask.token == self.token {
            self.handle(ask.id, &ask.prompt)
        } else {
            None
        };
        let mut out = stream;
        writeln!(out, "{}", serde_json::to_string(&Answer { answer })?)
    }

    fn lookup(&self, id: u64, kind: Kind, key: &str) -> Result<Option<String>, bool> {
        let mut state = self.state.lock().unwrap();
        if state.cancelled.contains(&id) {
            return Ok(None);
        }
        let entry = (kind, key.to_string());
        let retry = state
            .served
            .get(&id)
            .is_some_and(|list| list.contains(&entry));
        if retry {
            state.cache.remove(&entry);
            return Err(true);
        }
        let hit = state
            .cache
            .get_mut(&entry)
            .filter(|s| s.remember || s.time.elapsed() < CACHE_TIME);
        if let Some(saved) = hit {
            saved.time = Instant::now();
            let value = saved.value.clone();
            state.served.entry(id).or_default().push(entry);
            return Ok(Some(value));
        }
        Err(state.failed.contains(key))
    }

    fn handle(&self, id: u64, prompt: &str) -> Option<String> {
        let (kind, target) = parse(prompt);
        let (key, user) = match kind {
            Kind::Username | Kind::Password => split_user(&target),
            _ => (target.clone(), String::new()),
        };
        if let Ok(value) = self.lookup(id, kind, &key) {
            return value;
        }
        let _turn = self.prompt.lock().unwrap();
        let retry = match self.lookup(id, kind, &key) {
            Ok(value) => {
                return value;
            }
            Err(retry) => retry,
        };
        let request = next_id();
        let (send, receive) = mpsc::channel();
        self.state.lock().unwrap().pending.insert(request, send);
        (self.emit)(Request {
            request,
            kind,
            target: if kind == Kind::Other {
                target
            } else {
                key.clone()
            },
            user,
            retry,
        });
        let reply = receive.recv_timeout(WAIT_TIME).ok().flatten();
        let mut state = self.state.lock().unwrap();
        state.pending.remove(&request);
        let Some(reply) = reply else {
            state.cancelled.insert(id);
            return None;
        };
        let now = Instant::now();
        let mut save = |kind: Kind, value: &str| {
            let saved = Saved {
                value: value.to_string(),
                time: now,
                remember: reply.remember,
            };
            state.cache.insert((kind, key.clone()), saved);
        };
        let value = if kind == Kind::Username {
            save(Kind::Username, &reply.username);
            save(Kind::Password, &reply.password);
            reply.username.clone()
        } else {
            save(kind, &reply.password);
            reply.password.clone()
        };
        state.failed.remove(&key);
        state.served.entry(id).or_default().push((kind, key));
        Some(value)
    }

    fn answer(&self, request: u64, reply: Option<Reply>) {
        if let Some(send) = self.state.lock().unwrap().pending.remove(&request) {
            let _ = send.send(reply);
        }
    }

    fn finish(&self, id: u64, auth_failed: bool) {
        let mut state = self.state.lock().unwrap();
        state.cancelled.remove(&id);
        let served = state.served.remove(&id).unwrap_or_default();
        if !auth_failed {
            return;
        }
        for (_, key) in served {
            state.cache.retain(|(_, k), _| *k != key);
            state.failed.insert(key);
        }
    }
}

pub fn ask(port: &str, token: &str, id: u64, prompt: &str) -> Option<String> {
    let mut stream = TcpStream::connect(("127.0.0.1", port.parse::<u16>().ok()?)).ok()?;
    let ask = Ask {
        token: token.to_string(),
        id,
        prompt: prompt.to_string(),
    };
    writeln!(stream, "{}", serde_json::to_string(&ask).ok()?).ok()?;
    let mut line = String::new();
    BufReader::new(stream).read_line(&mut line).ok()?;
    serde_json::from_str::<Answer>(&line).ok()?.answer
}

pub fn client() -> Option<i32> {
    let port = std::env::var(PORT).ok()?;
    let token = std::env::var(TOKEN).unwrap_or_default();
    let id = std::env::var(ID)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let prompt = std::env::args().nth(1).unwrap_or_default();
    match ask(&port, &token, id, &prompt) {
        Some(answer) => {
            println!("{answer}");
            Some(0)
        }
        None => Some(1),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_git_and_ssh_prompts() {
        assert_eq!(
            parse("Username for 'https://github.com': "),
            (Kind::Username, "https://github.com".into())
        );
        assert_eq!(
            parse("Password for 'https://me@github.com': "),
            (Kind::Password, "https://me@github.com".into())
        );
        assert_eq!(
            parse("Enter passphrase for key '/home/me/.ssh/id_ed25519': "),
            (Kind::Passphrase, "/home/me/.ssh/id_ed25519".into())
        );
        assert_eq!(
            parse("me@host's password: "),
            (Kind::Other, "me@host's password:".into())
        );
        assert_eq!(
            split_user("https://me@github.com"),
            ("https://github.com".into(), "me".into())
        );
        assert_eq!(
            split_user("https://github.com/a@b"),
            ("https://github.com/a@b".into(), String::new())
        );
    }

    fn server(answers: Vec<Option<Reply>>) -> (Arc<Server>, Arc<Mutex<Vec<Request>>>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = seen.clone();
        let queue = Mutex::new(answers);
        let slot: Arc<OnceLock<Arc<Server>>> = Arc::new(OnceLock::new());
        let target = slot.clone();
        let emit: Emit = Box::new(move |req: Request| {
            log.lock().unwrap().push(req.clone());
            let reply = queue.lock().unwrap().remove(0);
            let target = target.clone();
            std::thread::spawn(move || {
                while target.get().is_none() {
                    std::thread::yield_now();
                }
                target.get().unwrap().answer(req.request, reply);
            });
        });
        let s = start("helper".into(), emit).unwrap();
        let _ = slot.set(s.clone());
        (s, seen)
    }

    fn reply(user: &str, pass: &str) -> Option<Reply> {
        Some(Reply {
            username: user.into(),
            password: pass.into(),
            remember: false,
        })
    }

    #[test]
    fn prompts_once_caches_and_retries() {
        let (s, seen) = server(vec![reply("me", "pw"), reply("", "pw2"), None]);
        let port = s.port.to_string();
        let ask_as = |id: u64, prompt: &str| ask(&port, &s.token, id, prompt);
        assert_eq!(
            ask_as(1, "Username for 'https://h.io': ").as_deref(),
            Some("me")
        );
        assert_eq!(
            ask_as(1, "Password for 'https://me@h.io': ").as_deref(),
            Some("pw")
        );
        s.finish(1, false);
        assert_eq!(
            ask_as(2, "Username for 'https://h.io': ").as_deref(),
            Some("me")
        );
        assert_eq!(
            ask(&port, "bad", 2, "Password for 'https://me@h.io': "),
            None
        );
        s.finish(2, true);
        assert_eq!(
            ask_as(3, "Password for 'https://me@h.io': ").as_deref(),
            Some("pw2")
        );
        assert_eq!(ask_as(4, "Enter passphrase for key '/k': "), None);
        assert_eq!(ask_as(4, "Enter passphrase for key '/k': "), None);
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 3);
        assert!(!seen[0].retry);
        assert_eq!(seen[1].kind, Kind::Password);
        assert_eq!(seen[1].user, "me");
        assert!(seen[1].retry);
        assert_eq!(seen[2].kind, Kind::Passphrase);
    }
}
