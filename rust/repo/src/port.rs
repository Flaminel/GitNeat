#![forbid(unsafe_code)]

use crate::{js, utf16};
use regex::Regex;
use serde::{Serialize, Serializer};
use std::collections::HashMap;
use std::sync::LazyLock;

const FS: &str = "\x1f";
const RS: &str = "\x1e";

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Commit {
    pub sha: String,
    pub parents: Vec<String>,
    #[serde(serialize_with = "ser_undef")]
    pub author: Option<String>,
    #[serde(serialize_with = "ser_undef")]
    pub email: Option<String>,
    #[serde(serialize_with = "ser_num")]
    pub time: f64,
    #[serde(serialize_with = "ser_undef")]
    pub subject: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", serialize_with = "ser_key")]
    pub stash: Option<Option<String>>,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum RefKind {
    Local,
    Remote,
    Tag,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Ref {
    pub kind: RefKind,
    pub name: String,
    pub full: String,
    #[serde(serialize_with = "ser_undef")]
    pub sha: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", serialize_with = "ser_key")]
    pub upstream: Option<Option<String>>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "ser_opt_num"
    )]
    pub ahead: Option<f64>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "ser_opt_num"
    )]
    pub behind: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", serialize_with = "ser_key")]
    pub worktree: Option<Option<String>>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Stash {
    pub sha: String,
    #[serde(rename = "ref", serialize_with = "ser_undef")]
    pub reference: Option<String>,
    pub base: String,
    #[serde(serialize_with = "ser_undef")]
    pub message: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Worktree {
    pub path: String,
    pub sha: String,
    #[serde(serialize_with = "ser_undef")]
    pub branch: Option<String>,
    pub main: bool,
    pub locked: bool,
    pub prunable: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Remote {
    pub name: String,
    pub url: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct StatusEntry {
    #[serde(serialize_with = "ser_units")]
    pub index: Vec<u16>,
    #[serde(serialize_with = "ser_units")]
    pub work: Vec<u16>,
    #[serde(serialize_with = "ser_units")]
    pub path: Vec<u16>,
    #[serde(skip_serializing_if = "Option::is_none", serialize_with = "ser_key")]
    pub orig: Option<Option<String>>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct FileChange {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none", serialize_with = "ser_key")]
    pub orig: Option<Option<String>>,
    #[serde(serialize_with = "ser_undef")]
    pub path: Option<String>,
}

fn ser_num<S: Serializer>(v: &f64, s: S) -> Result<S::Ok, S::Error> {
    js::number(*v).serialize(s)
}

fn ser_units<S: Serializer>(v: &[u16], s: S) -> Result<S::Ok, S::Error> {
    js::utf16_string(v).serialize(s)
}

fn ser_opt_num<S: Serializer>(v: &Option<f64>, s: S) -> Result<S::Ok, S::Error> {
    match v {
        Some(n) => ser_num(n, s),
        None => s.serialize_none(),
    }
}

fn ser_undef<S: Serializer>(v: &Option<String>, s: S) -> Result<S::Ok, S::Error> {
    match v {
        Some(text) => s.serialize_str(text),
        None => js::undefined().serialize(s),
    }
}

fn ser_key<S: Serializer>(v: &Option<Option<String>>, s: S) -> Result<S::Ok, S::Error> {
    match v {
        Some(inner) => ser_undef(inner, s),
        None => s.serialize_none(),
    }
}

fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_space)
}

fn js_number(s: &str) -> f64 {
    let t = js_trim(s);
    if t.is_empty() {
        return 0.0;
    }
    match t {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    let b = t.as_bytes();
    if b.len() > 2 && b[0] == b'0' {
        let radix = match b[1] {
            b'x' | b'X' => 16,
            b'o' | b'O' => 8,
            b'b' | b'B' => 2,
            _ => 0,
        };
        if radix != 0 {
            let mut v = 0.0;
            for c in t[2..].chars() {
                match c.to_digit(radix) {
                    Some(d) => v = v * f64::from(radix) + f64::from(d),
                    None => return f64::NAN,
                }
            }
            return v;
        }
    }
    let mut i = 0;
    if matches!(b[0], b'+' | b'-') {
        i += 1;
    }
    let int_start = i;
    while i < b.len() && b[i].is_ascii_digit() {
        i += 1;
    }
    let mut digits = i - int_start;
    if i < b.len() && b[i] == b'.' {
        i += 1;
        let frac_start = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        digits += i - frac_start;
    }
    if digits == 0 {
        return f64::NAN;
    }
    if i < b.len() && matches!(b[i], b'e' | b'E') {
        i += 1;
        if i < b.len() && matches!(b[i], b'+' | b'-') {
            i += 1;
        }
        let exp_start = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        if i == exp_start {
            return f64::NAN;
        }
    }
    if i != b.len() {
        return f64::NAN;
    }
    t.parse::<f64>().unwrap_or(f64::NAN)
}

fn encode_uri_component(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for byte in s.bytes() {
        if byte.is_ascii_alphanumeric()
            || matches!(
                byte,
                b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')'
            )
        {
            out.push(char::from(byte));
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

pub fn paths_equal(a: &str, b: &str) -> bool {
    fn norm(p: &str) -> String {
        let s = p.replace('\\', "/");
        let s = s.trim_end_matches('/');
        let mut chars = s.chars();
        match (chars.next(), chars.next()) {
            (Some(c), Some(':')) if c.is_ascii_alphabetic() => s.to_lowercase(),
            _ => s.to_string(),
        }
    }
    norm(a) == norm(b)
}

pub fn read_log(out: &str) -> Vec<Commit> {
    out.split(RS)
        .map(|r| r.strip_prefix('\n').unwrap_or(r))
        .filter(|r| !r.is_empty())
        .map(|record| {
            let f: Vec<&str> = record.split(FS).collect();
            let parents = match f.get(1) {
                Some(p) if !p.is_empty() => p.split(' ').map(String::from).collect(),
                _ => Vec::new(),
            };
            Commit {
                sha: f[0].to_string(),
                parents,
                author: f.get(2).map(|s| s.to_string()),
                email: f.get(3).map(|s| s.to_string()),
                time: f.get(4).map_or(f64::NAN, |t| js_number(t)),
                subject: Some(f.get(5).unwrap_or(&"").to_string()),
                stash: None,
            }
        })
        .collect()
}

static AHEAD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"ahead ([0-9]+)").unwrap());
static BEHIND: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"behind ([0-9]+)").unwrap());

fn non_empty(s: Option<&&str>) -> Option<String> {
    s.filter(|v| !v.is_empty()).map(|v| v.to_string())
}

pub fn read_refs(out: &str) -> Vec<Ref> {
    let mut refs = Vec::new();
    for line in out.split('\n') {
        if line.is_empty() {
            continue;
        }
        let f: Vec<&str> = line.split(FS).collect();
        let full = f[0];
        let sha = non_empty(f.get(2)).or_else(|| f.get(1).map(|s| s.to_string()));
        if let Some(name) = full.strip_prefix("refs/heads/") {
            let track = f.get(4).copied().unwrap_or("");
            let count = |re: &Regex| {
                re.captures(track)
                    .map_or(0.0, |c| js_number(c.get(1).map_or("", |m| m.as_str())))
            };
            refs.push(Ref {
                kind: RefKind::Local,
                name: name.to_string(),
                full: full.to_string(),
                sha,
                upstream: Some(non_empty(f.get(3))),
                ahead: Some(count(&AHEAD)),
                behind: Some(count(&BEHIND)),
                current: Some(f.get(5) == Some(&"*")),
                worktree: Some(non_empty(f.get(6))),
            });
        } else if let Some(name) = full.strip_prefix("refs/remotes/") {
            if full.ends_with("/HEAD") {
                continue;
            }
            refs.push(plain_ref(RefKind::Remote, name, full, sha));
        } else if let Some(name) = full.strip_prefix("refs/tags/") {
            refs.push(plain_ref(RefKind::Tag, name, full, sha));
        }
    }
    refs
}

fn plain_ref(kind: RefKind, name: &str, full: &str, sha: Option<String>) -> Ref {
    Ref {
        kind,
        name: name.to_string(),
        full: full.to_string(),
        sha,
        upstream: None,
        ahead: None,
        behind: None,
        current: None,
        worktree: None,
    }
}

pub fn read_status(out: &str) -> Vec<StatusEntry> {
    let parts: Vec<&str> = out.split('\0').collect();
    let mut entries = Vec::new();
    let mut i = 0;
    while i < parts.len() {
        let u = utf16::units(parts[i]);
        i += 1;
        if u.len() < 4 {
            continue;
        }
        let index = u[..1].to_vec();
        let work = u[1..2].to_vec();
        let path = u[3..].to_vec();
        let mut orig = None;
        if index == [u16::from(b'R')] || index == [u16::from(b'C')] {
            orig = Some(parts.get(i).map(|s| s.to_string()));
            i += 1;
        }
        entries.push(StatusEntry {
            index,
            work,
            path,
            orig,
        });
    }
    entries
}

pub fn read_name_status(out: &str) -> Vec<FileChange> {
    let raw: Vec<&str> = out.split('\0').collect();
    let last = raw.len() - 1;
    let parts: Vec<&str> = raw
        .iter()
        .enumerate()
        .filter(|(i, p)| !p.is_empty() || *i < last)
        .map(|(_, p)| *p)
        .collect();
    let mut files = Vec::new();
    let mut i = 0;
    while i < parts.len() {
        let status = parts[i];
        let first = status.chars().next();
        if !first.is_some_and(|c| c.is_ascii_uppercase()) {
            i += 1;
            continue;
        }
        let letter = status[..1].to_string();
        let at = |n: usize| parts.get(i + n).map(|s| s.to_string());
        if letter == "R" || letter == "C" {
            files.push(FileChange {
                status: letter,
                orig: Some(at(1)),
                path: at(2),
            });
            i += 3;
        } else {
            files.push(FileChange {
                status: letter,
                orig: None,
                path: at(1),
            });
            i += 2;
        }
    }
    files
}

static WEB_URL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"^(?:https?://(?:[^@/]+@)?|ssh://(?:[^@/]+@)?|[^@/]+@)([^/:]+)(?::[0-9]+)?[:/]([^\n\r\x{2028}\x{2029}]+?)(?:\.git)?/?$",
    )
    .unwrap()
});

pub fn web_base(url: &str) -> Option<String> {
    WEB_URL
        .captures(js_trim(url))
        .map(|m| format!("https://{}/{}", &m[1], &m[2]))
}

pub fn commit_url(remote_url: &str, sha: &str) -> Option<String> {
    let base = web_base(remote_url)?;
    if base.contains("bitbucket.org") {
        return Some(format!("{base}/commits/{sha}"));
    }
    if base.contains("gitlab") {
        return Some(format!("{base}/-/commit/{sha}"));
    }
    Some(format!("{base}/commit/{sha}"))
}

pub fn compare_url(remote_url: &str, branch: &str) -> Option<String> {
    let base = web_base(remote_url)?;
    if base.contains("gitlab") {
        return Some(format!(
            "{base}/-/merge_requests/new?merge_request[source_branch]={}",
            encode_uri_component(branch)
        ));
    }
    if base.contains("bitbucket.org") {
        return Some(format!(
            "{base}/pull-requests/new?source={}",
            encode_uri_component(branch)
        ));
    }
    Some(format!("{base}/compare/{branch}?expand=1"))
}

pub fn parse_worktrees(out: &str) -> Vec<Worktree> {
    out.split("\n\n")
        .filter(|b| !js_trim(b).is_empty())
        .enumerate()
        .map(|(i, block)| {
            let lines: Vec<&str> = block.split('\n').collect();
            let get = |key: &str| {
                lines
                    .iter()
                    .find(|l| l.strip_prefix(key).is_some_and(|r| r.starts_with(' ')))
                    .map(|l| l[key.len() + 1..].to_string())
            };
            let flag = |key: &str| {
                lines
                    .iter()
                    .any(|l| *l == key || l.strip_prefix(key).is_some_and(|r| r.starts_with(' ')))
            };
            Worktree {
                path: get("worktree").unwrap_or_default(),
                sha: get("HEAD").unwrap_or_default(),
                branch: get("branch").map(|b| b.replacen("refs/heads/", "", 1)),
                main: i == 0,
                locked: flag("locked"),
                prunable: flag("prunable"),
            }
        })
        .collect()
}

fn split_spaces(s: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut start = 0;
    let mut in_space = false;
    for (i, c) in s.char_indices() {
        if is_js_space(c) {
            if !in_space {
                parts.push(&s[start..i]);
                in_space = true;
            }
        } else if in_space {
            start = i;
            in_space = false;
        }
    }
    parts.push(if in_space { "" } else { &s[start..] });
    parts
}

pub fn parse_remotes(out: &str) -> Vec<Remote> {
    let mut remotes: Vec<Remote> = Vec::new();
    for line in out.split('\n') {
        let parts = split_spaces(line);
        let name = parts[0];
        let url = parts.get(1).copied().unwrap_or("");
        if !name.is_empty() && !url.is_empty() && !remotes.iter().any(|r| r.name == name) {
            remotes.push(Remote {
                name: name.to_string(),
                url: url.to_string(),
            });
        }
    }
    remotes
}

pub fn parse_stashes(out: &str) -> Result<Vec<Stash>, String> {
    out.split('\n')
        .filter(|l| !l.is_empty())
        .map(|line| {
            let f: Vec<&str> = line.split(FS).collect();
            let parents = f.get(2).ok_or_else(|| {
                "TypeError: Cannot read properties of undefined (reading 'split')".to_string()
            })?;
            Ok(Stash {
                sha: f[0].to_string(),
                reference: f.get(1).map(|s| s.to_string()),
                base: parents.split(' ').next().unwrap_or("").to_string(),
                message: f.get(3).map(|s| s.to_string()),
            })
        })
        .collect()
}

pub fn insert_stashes(
    commits: &mut Vec<Commit>,
    stashes: &[Stash],
    details: &HashMap<String, Commit>,
) {
    for stash in stashes {
        let Some(index) = commits.iter().position(|c| c.sha == stash.base) else {
            continue;
        };
        let Some(detail) = details.get(&stash.sha) else {
            continue;
        };
        commits.insert(
            index,
            Commit {
                parents: vec![stash.base.clone()],
                subject: stash.message.clone(),
                stash: Some(stash.reference.clone()),
                ..detail.clone()
            },
        );
    }
}

#[cfg(test)]
pub(crate) mod wrappers {
    use super::*;

    fn nullable(v: Option<String>) -> serde_json::Value {
        v.map_or(serde_json::Value::Null, serde_json::Value::String)
    }

    fn to_values<T: Serialize>(items: &[T]) -> Result<Vec<serde_json::Value>, String> {
        items
            .iter()
            .map(|item| serde_json::to_value(item).map_err(|e| e.to_string()))
            .collect()
    }

    pub fn same_path(a: String, b: String) -> Result<bool, String> {
        Ok(paths_equal(&a, &b))
    }

    pub fn parse_log(out: String) -> Result<Vec<serde_json::Value>, String> {
        to_values(&read_log(&out))
    }

    pub fn parse_refs(out: String) -> Result<Vec<serde_json::Value>, String> {
        to_values(&read_refs(&out))
    }

    pub fn parse_status(out: String) -> Result<Vec<serde_json::Value>, String> {
        to_values(&read_status(&out))
    }

    pub fn parse_name_status(out: String) -> Result<Vec<serde_json::Value>, String> {
        to_values(&read_name_status(&out))
    }

    pub fn remote_web_url(url: String) -> Result<serde_json::Value, String> {
        Ok(nullable(web_base(&url)))
    }

    pub fn commit_web_url(remote_url: String, sha: String) -> Result<serde_json::Value, String> {
        Ok(nullable(commit_url(&remote_url, &sha)))
    }

    pub fn compare_web_url(
        remote_url: String,
        branch: String,
    ) -> Result<serde_json::Value, String> {
        Ok(nullable(compare_url(&remote_url, &branch)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn commit(sha: &str) -> Commit {
        Commit {
            sha: sha.into(),
            parents: vec![],
            author: Some("a".into()),
            email: Some("e".into()),
            time: 1.0,
            subject: Some("s".into()),
            stash: None,
        }
    }

    #[test]
    fn js_numbers() {
        assert_eq!(js_number(" 12 "), 12.0);
        assert_eq!(js_number(""), 0.0);
        assert_eq!(js_number("0x10"), 16.0);
        assert_eq!(js_number(".5"), 0.5);
        assert_eq!(js_number("1e3"), 1000.0);
        assert!(js_number("1e").is_nan());
        assert!(js_number("1_0").is_nan());
        assert!(js_number("inf").is_nan());
        assert_eq!(js_number("-Infinity"), f64::NEG_INFINITY);
    }

    #[test]
    fn missing_time_is_null() {
        let v = wrappers::parse_log("abc".into()).unwrap();
        assert_eq!(
            v[0],
            serde_json::json!({"sha": "abc", "parents": [], "author": {"$undefined": true}, "email": {"$undefined": true}, "time": {"$num": "NaN"}, "subject": ""})
        );
    }

    #[test]
    fn log_record_parses() {
        let c = read_log("\nabc\x1fp1 p2\x1fAn\x1fe@x\x1f1700000000\x1fhi\x1e\n");
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].parents, vec!["p1", "p2"]);
        assert_eq!(c[0].time, 1_700_000_000.0);
    }

    #[test]
    fn refs_and_tracking() {
        let out = "refs/heads/main\x1fa\x1f\x1forigin/main\x1fahead 2, behind 10\x1f*\x1f/w\nrefs/remotes/origin/HEAD\x1fa\x1f\x1f\x1f\x1f\x1f\nrefs/tags/v1\x1fobj\x1fpeeled\x1f\x1f\x1f\x1f\n";
        let r = read_refs(out);
        assert_eq!(r.len(), 2);
        assert_eq!(r[0].ahead, Some(2.0));
        assert_eq!(r[0].behind, Some(10.0));
        assert_eq!(r[0].current, Some(true));
        assert_eq!(r[1].sha.as_deref(), Some("peeled"));
    }

    #[test]
    fn status_rename_and_short() {
        let e = read_status("R  new.txt\0old.txt\0?? a b\0ab\0 M x\0");
        assert_eq!(e.len(), 3);
        assert_eq!(e[0].orig, Some(Some("old.txt".to_string())));
        assert_eq!(e[1].path, utf16::units("a b"));
        assert_eq!(e[2].index, utf16::units(" "));
    }

    #[test]
    fn status_rename_without_orig() {
        let e = read_status("R  new.txt");
        assert_eq!(e[0].orig, Some(None));
        assert_eq!(read_status("M  x")[0].orig, None);
    }

    #[test]
    fn name_status() {
        let f = read_name_status("M\0a\0R100\0old\0new\0A\0b\0");
        assert_eq!(f.len(), 3);
        assert_eq!(f[1].orig, Some(Some("old".to_string())));
        assert_eq!(f[2].path.as_deref(), Some("b"));
        let g = read_name_status("R\0only");
        assert_eq!(g[0].path, None);
        assert_eq!(g[0].orig, Some(Some("only".to_string())));
    }

    #[test]
    fn web_urls() {
        assert_eq!(
            web_base("git@github.com:o/r.git").as_deref(),
            Some("https://github.com/o/r")
        );
        assert_eq!(
            web_base(" ssh://git@host:2222/o/r.git/ ").as_deref(),
            Some("https://host/o/r")
        );
        assert_eq!(web_base("/local/path"), None);
        assert_eq!(
            commit_url("https://gitlab.com/o/r", "x").as_deref(),
            Some("https://gitlab.com/o/r/-/commit/x")
        );
        assert_eq!(
            compare_url("https://bitbucket.org/o/r", "a b").as_deref(),
            Some("https://bitbucket.org/o/r/pull-requests/new?source=a%20b")
        );
        assert_eq!(
            compare_url("https://github.com/o/r", "a/b").as_deref(),
            Some("https://github.com/o/r/compare/a/b?expand=1")
        );
    }

    #[test]
    fn same_path_windows() {
        assert!(paths_equal("C:\\Foo\\bar\\", "c:/Foo/bar"));
        assert!(!paths_equal("/a/B", "/a/b"));
    }

    #[test]
    fn worktrees() {
        let w = parse_worktrees(
            "worktree /a\nHEAD abc\nbranch refs/heads/main\n\nworktree /b\nHEAD def\ndetached\nlocked why\nprunable\n\n",
        );
        assert_eq!(w.len(), 2);
        assert!(w[0].main);
        assert_eq!(w[0].branch.as_deref(), Some("main"));
        assert!(w[1].locked && w[1].prunable && w[1].branch.is_none());
    }

    #[test]
    fn remotes_first_wins() {
        let r =
            parse_remotes("origin\tu1 (fetch)\norigin\tu1 (push)\nup  u2 (fetch)\n \tx y\nlone\n");
        assert_eq!(r.len(), 2);
        assert_eq!(r[1].name, "up");
    }

    #[test]
    fn stashes_parse_and_insert() {
        let s = parse_stashes("S1\x1fstash@{0}\x1fB1 X\x1fWIP on main\n\n").unwrap();
        assert_eq!(s[0].base, "B1");
        assert!(parse_stashes("S1\x1fstash@{0}").is_err());
        let mut commits = vec![commit("T"), commit("B1")];
        let mut details = HashMap::new();
        details.insert("S1".to_string(), commit("S1"));
        insert_stashes(&mut commits, &s, &details);
        assert_eq!(commits[1].sha, "S1");
        assert_eq!(commits[1].stash, Some(Some("stash@{0}".to_string())));
        assert_eq!(commits[1].subject.as_deref(), Some("WIP on main"));
        assert_eq!(commits[1].parents, vec!["B1"]);
    }
}
