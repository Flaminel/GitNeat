#![forbid(unsafe_code)]

use serde::{Deserialize, Deserializer, Serialize, Serializer};

fn opt_num<'de, D: Deserializer<'de>>(d: D) -> Result<Option<f64>, D::Error> {
    let v = serde_json::Value::deserialize(d)?;
    if crate::js::is_undefined(&v) || v.is_null() {
        return Ok(None);
    }
    match crate::js::as_number(&v) {
        Some(n) => Ok(Some(n)),
        None => Err(serde::de::Error::custom("expected a number")),
    }
}

fn num_or_zero<'de, D: Deserializer<'de>>(d: D) -> Result<f64, D::Error> {
    Ok(opt_num(d)?.unwrap_or(0.0))
}

fn truthy<'de, D: Deserializer<'de>>(d: D) -> Result<bool, D::Error> {
    let v = serde_json::Value::deserialize(d)?;
    Ok(match &v {
        serde_json::Value::Null => false,
        serde_json::Value::Bool(b) => *b,
        serde_json::Value::Number(n) => n.as_f64().is_some_and(|n| n != 0.0 && !n.is_nan()),
        serde_json::Value::String(s) => !s.is_empty(),
        serde_json::Value::Object(_) => !crate::js::is_undefined(&v),
        serde_json::Value::Array(_) => true,
    })
}

fn ser_num<S: Serializer>(n: &f64, s: S) -> Result<S::Ok, S::Error> {
    crate::js::number(*n).serialize(s)
}

fn ser_opt_num<S: Serializer>(n: &Option<f64>, s: S) -> Result<S::Ok, S::Error> {
    match n {
        Some(n) => ser_num(n, s),
        None => s.serialize_none(),
    }
}

fn is_false(b: &bool) -> bool {
    !*b
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub kind: String,
    pub text: String,
    #[serde(
        default,
        deserialize_with = "opt_num",
        serialize_with = "ser_opt_num",
        skip_serializing_if = "Option::is_none"
    )]
    pub old: Option<f64>,
    #[serde(
        default,
        deserialize_with = "opt_num",
        serialize_with = "ser_opt_num",
        skip_serializing_if = "Option::is_none"
    )]
    pub next: Option<f64>,
    #[serde(
        default,
        deserialize_with = "opt_num",
        serialize_with = "ser_opt_num",
        skip_serializing_if = "Option::is_none"
    )]
    pub at: Option<f64>,
    #[serde(default, deserialize_with = "truthy", skip_serializing_if = "is_false")]
    pub no_newline: bool,
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Hunk {
    pub header: String,
    #[serde(default, deserialize_with = "num_or_zero", serialize_with = "ser_num")]
    pub old_start: f64,
    #[serde(default, deserialize_with = "num_or_zero", serialize_with = "ser_num")]
    pub new_start: f64,
    pub lines: Vec<DiffLine>,
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ParsedDiff {
    pub file_header: String,
    pub hunks: Vec<Hunk>,
    #[serde(default, deserialize_with = "truthy")]
    pub binary: bool,
}

fn digits(s: &str) -> Option<(f64, &str)> {
    let end = s.bytes().take_while(u8::is_ascii_digit).count();
    if end == 0 {
        return None;
    }
    Some((s[..end].parse::<f64>().ok()?, &s[end..]))
}

fn skip_count(s: &str) -> &str {
    match s.strip_prefix(',') {
        Some(rest) => match digits(rest) {
            Some((_, after)) => after,
            None => s,
        },
        None => s,
    }
}

fn hunk_header(line: &str) -> Option<(f64, f64)> {
    let rest = line.strip_prefix("@@ -")?;
    let (old, rest) = digits(rest)?;
    let rest = skip_count(rest).strip_prefix(" +")?;
    let (next, rest) = digits(rest)?;
    let rest = skip_count(rest).strip_prefix(" @@")?;
    if rest
        .chars()
        .any(|c| matches!(c, '\r' | '\u{2028}' | '\u{2029}'))
    {
        return None;
    }
    Some((old, next))
}

fn tail(line: &str) -> String {
    line.chars().skip(1).collect()
}

impl ParsedDiff {
    pub fn parse(text: &str) -> Self {
        let mut header: Vec<&str> = Vec::new();
        let mut hunks: Vec<Hunk> = Vec::new();
        let mut old = 0.0;
        let mut next = 0.0;
        let mut binary = false;
        for line in text.split('\n') {
            if let Some((o, n)) = hunk_header(line) {
                old = o;
                next = n;
                hunks.push(Hunk {
                    header: line.to_string(),
                    old_start: old,
                    new_start: next,
                    lines: Vec::new(),
                });
                continue;
            }
            let Some(current) = hunks.last_mut() else {
                if line.starts_with("Binary files") || line.starts_with("GIT binary patch") {
                    binary = true;
                }
                if !line.is_empty() {
                    header.push(line);
                }
                continue;
            };
            let line_of =
                |kind: &str, old: Option<f64>, next: Option<f64>, at: Option<f64>| DiffLine {
                    kind: kind.to_string(),
                    text: tail(line),
                    old,
                    next,
                    at,
                    no_newline: false,
                };
            match line.chars().next() {
                Some('+') => {
                    current.lines.push(line_of("add", None, Some(next), None));
                    next += 1.0;
                }
                Some('-') => {
                    current
                        .lines
                        .push(line_of("del", Some(old), None, Some(next)));
                    old += 1.0;
                }
                Some(' ') => {
                    current
                        .lines
                        .push(line_of("ctx", Some(old), Some(next), None));
                    old += 1.0;
                    next += 1.0;
                }
                Some('\\') => {
                    if let Some(last) = current.lines.last_mut() {
                        last.no_newline = true;
                    }
                }
                _ => {}
            }
        }
        Self {
            file_header: header.join("\n"),
            hunks,
            binary,
        }
    }
}

fn emit(line: &DiffLine, sign: &str) -> String {
    let out = format!("{sign}{}", line.text);
    if line.no_newline {
        format!("{out}\n\\ No newline at end of file")
    } else {
        out
    }
}

fn assemble(diff: &ParsedDiff, hunk: &Hunk, body: &[String]) -> String {
    format!(
        "{}\n{}\n{}\n",
        diff.file_header,
        hunk.header,
        body.join("\n")
    )
}

fn lines_body(
    hunk: &Hunk,
    selected: Option<&[f64]>,
    reverse: bool,
) -> Result<Option<Vec<String>>, String> {
    let mut body = Vec::new();
    let mut changes = 0;
    for (i, line) in hunk.lines.iter().enumerate() {
        if line.kind == "ctx" {
            body.push(emit(line, " "));
            continue;
        }
        let Some(selected) = selected else {
            return Err("TypeError: selected.has is not a function".to_string());
        };
        let is_add = line.kind == "add";
        if selected.contains(&(i as f64)) {
            changes += 1;
            body.push(emit(line, if is_add { "+" } else { "-" }));
            continue;
        }
        let keep_as_context = if reverse { is_add } else { line.kind == "del" };
        if keep_as_context {
            body.push(emit(line, " "));
        }
    }
    if changes == 0 {
        return Ok(None);
    }
    Ok(Some(body))
}

impl Hunk {
    pub fn patch(&self, diff: &ParsedDiff) -> String {
        let body: Vec<String> = self
            .lines
            .iter()
            .map(|l| {
                emit(
                    l,
                    match l.kind.as_str() {
                        "add" => "+",
                        "del" => "-",
                        _ => " ",
                    },
                )
            })
            .collect();
        assemble(diff, self, &body)
    }

    pub fn lines_patch(
        &self,
        diff: &ParsedDiff,
        selected: &[f64],
        reverse: bool,
    ) -> Option<String> {
        let body = lines_body(self, Some(selected), reverse).ok()??;
        Some(assemble(diff, self, &body))
    }

    pub fn lines_in_range(&self, side: &str, start: f64, end: f64) -> Vec<f64> {
        let mut picked = Vec::new();
        for (i, line) in self.lines.iter().enumerate() {
            if line.kind == "ctx" {
                continue;
            }
            let n = if side == "old" {
                line.old
            } else if line.kind == "add" {
                line.next
            } else {
                line.at
            };
            if let Some(n) = n
                && n >= start
                && n <= end
                && (side == "new" || line.kind == "del")
            {
                picked.push(i as f64);
            }
        }
        picked
    }
}

#[cfg(test)]
pub(crate) mod wrappers {
    use super::*;

    fn typed<T: serde::de::DeserializeOwned>(value: serde_json::Value) -> Result<T, String> {
        serde_json::from_value(value).map_err(|e| format!("TypeError: {e}"))
    }

    fn js_string(v: &serde_json::Value) -> String {
        match v {
            serde_json::Value::Null => "null".to_string(),
            serde_json::Value::Bool(b) => b.to_string(),
            serde_json::Value::String(s) => s.clone(),
            serde_json::Value::Number(n) => n.to_string(),
            serde_json::Value::Array(items) => items
                .iter()
                .map(|i| {
                    if i.is_null() {
                        String::new()
                    } else {
                        js_string(i)
                    }
                })
                .collect::<Vec<_>>()
                .join(","),
            serde_json::Value::Object(_) if crate::js::is_undefined(v) => "undefined".to_string(),
            serde_json::Value::Object(_) => match crate::js::as_number(v) {
                Some(n) if n.is_nan() => "NaN".to_string(),
                Some(n) if n.is_infinite() && n > 0.0 => "Infinity".to_string(),
                Some(n) if n.is_infinite() => "-Infinity".to_string(),
                Some(_) => "0".to_string(),
                None => "[object Object]".to_string(),
            },
        }
    }

    fn header_only(diff: &serde_json::Value) -> Result<ParsedDiff, String> {
        let file_header = match diff {
            serde_json::Value::Null => {
                return Err(
                    "TypeError: Cannot read properties of null (reading 'fileHeader')".to_string(),
                );
            }
            serde_json::Value::Object(o) if crate::js::is_undefined(diff) => {
                let _ = o;
                return Err(
                    "TypeError: Cannot read properties of undefined (reading 'fileHeader')"
                        .to_string(),
                );
            }
            serde_json::Value::Object(o) => o
                .get("fileHeader")
                .map_or_else(|| "undefined".to_string(), js_string),
            _ => "undefined".to_string(),
        };
        Ok(ParsedDiff {
            file_header,
            hunks: Vec::new(),
            binary: false,
        })
    }

    pub fn parse_diff(text: String) -> Result<serde_json::Value, String> {
        serde_json::to_value(ParsedDiff::parse(&text)).map_err(|e| e.to_string())
    }

    pub fn hunk_patch(diff: serde_json::Value, hunk: serde_json::Value) -> Result<String, String> {
        let hunk: Hunk = typed(hunk)?;
        let diff = header_only(&diff)?;
        Ok(hunk.patch(&diff))
    }

    pub fn lines_patch(
        diff: serde_json::Value,
        hunk: serde_json::Value,
        selected: serde_json::Value,
        reverse: bool,
    ) -> Result<serde_json::Value, String> {
        let hunk: Hunk = typed(hunk)?;
        let set: Option<Vec<f64>> = selected
            .get("$set")
            .and_then(serde_json::Value::as_array)
            .map(|items| items.iter().filter_map(crate::js::as_number).collect());
        let Some(body) = lines_body(&hunk, set.as_deref(), reverse)? else {
            return Ok(serde_json::Value::Null);
        };
        let diff = header_only(&diff)?;
        Ok(serde_json::Value::String(assemble(&diff, &hunk, &body)))
    }

    pub fn lines_in_range(
        hunk: serde_json::Value,
        side: String,
        start: f64,
        end: f64,
    ) -> Result<Vec<f64>, String> {
        let hunk: Hunk = typed(hunk)?;
        Ok(hunk.lines_in_range(&side, start, end))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RAW: &str = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n\\ No newline at end of file\n";

    #[test]
    fn parses_numbers_and_no_newline() {
        let d = ParsedDiff::parse(RAW);
        assert_eq!(d.hunks.len(), 1);
        let l = &d.hunks[0].lines;
        assert_eq!((l[0].old, l[0].next), (Some(1.0), Some(1.0)));
        assert_eq!((l[1].old, l[1].at), (Some(2.0), Some(2.0)));
        assert_eq!(l[2].next, Some(2.0));
        assert!(l[2].no_newline);
    }

    #[test]
    fn crlf_header_is_not_a_hunk() {
        assert!(ParsedDiff::parse("@@ -1 +1 @@\r\n-a\n").hunks.is_empty());
    }

    #[test]
    fn nothing_selected_is_none() {
        let d = ParsedDiff::parse("--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n");
        assert_eq!(d.hunks[0].lines_patch(&d, &[], false), None);
        assert_eq!(
            d.hunks[0].lines_patch(&d, &[1.0], false).as_deref(),
            Some("--- a/x\n+++ b/x\n@@ -1 +1 @@\n a\n+b\n")
        );
    }
}
