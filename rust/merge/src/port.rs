#![forbid(unsafe_code)]

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Value, json};
use std::borrow::Cow;
use std::collections::HashSet;

#[derive(Clone, Debug, PartialEq)]
pub enum Segment {
    Common {
        lines: Vec<String>,
    },
    Conflict {
        a: Vec<String>,
        base: Vec<String>,
        b: Vec<String>,
    },
    Other(Value),
}

fn string_list(v: Option<&Value>) -> Option<Vec<String>> {
    v?.as_array()?
        .iter()
        .map(|x| x.as_str().map(str::to_string))
        .collect()
}

impl Segment {
    pub fn from_value(v: Value) -> Segment {
        let kind = v.get("kind").and_then(Value::as_str);
        if kind == Some("common")
            && v.as_object().is_some_and(|o| o.len() == 2)
            && let Some(lines) = string_list(v.get("lines"))
        {
            return Segment::Common { lines };
        }
        if kind == Some("conflict")
            && v.as_object().is_some_and(|o| o.len() == 4)
            && let (Some(a), Some(base), Some(b)) = (
                string_list(v.get("a")),
                string_list(v.get("base")),
                string_list(v.get("b")),
            )
        {
            return Segment::Conflict { a, base, b };
        }
        Segment::Other(v)
    }

    pub fn to_value(&self) -> Value {
        match self {
            Segment::Common { lines } => json!({ "kind": "common", "lines": lines }),
            Segment::Conflict { a, base, b } => {
                json!({ "kind": "conflict", "a": a, "base": base, "b": b })
            }
            Segment::Other(v) => v.clone(),
        }
    }

    pub fn kind(&self) -> Result<Option<&str>, String> {
        match self {
            Segment::Common { .. } => Ok(Some("common")),
            Segment::Conflict { .. } => Ok(Some("conflict")),
            Segment::Other(v) => Ok(prop(v, "kind")?.and_then(Value::as_str)),
        }
    }

    fn lines_of(&self, key: &str) -> Result<Cow<'_, [String]>, String> {
        let found: Option<&[String]> = match (self, key) {
            (Segment::Common { lines }, "lines") => Some(lines),
            (Segment::Conflict { a, .. }, "a") => Some(a),
            (Segment::Conflict { b, .. }, "b") => Some(b),
            (Segment::Conflict { base, .. }, "base") => Some(base),
            _ => None,
        };
        if let Some(lines) = found {
            return Ok(Cow::Borrowed(lines));
        }
        if let Segment::Other(v) = self
            && let Some(lines) = string_list(prop(v, key)?)
        {
            return Ok(Cow::Owned(lines));
        }
        Err(format!("TypeError: {key} is not iterable"))
    }

    fn side_len(&self, side: &str) -> Result<usize, String> {
        if let Segment::Other(v) = self {
            return match prop(v, side)? {
                Some(Value::Array(items)) => Ok(items.len()),
                Some(Value::String(s)) => Ok(s.encode_utf16().count()),
                _ => Err(
                    "TypeError: Cannot read properties of undefined (reading 'length')".to_string(),
                ),
            };
        }
        Ok(self.lines_of(side)?.len())
    }
}

impl Serialize for Segment {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        self.to_value().serialize(s)
    }
}

impl<'de> Deserialize<'de> for Segment {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Segment, D::Error> {
        Ok(Segment::from_value(Value::deserialize(d)?))
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(transparent)]
pub struct Pick(pub Value);

impl Pick {
    pub fn new(side: &str, line: f64) -> Pick {
        Pick(json!({ "side": side, "line": crate::js::number(line) }))
    }

    fn side(&self) -> Result<Option<&Value>, String> {
        prop(&self.0, "side")
    }

    fn line(&self) -> Result<Option<&Value>, String> {
        prop(&self.0, "line")
    }

    fn on_side(&self, side: &str) -> Result<bool, String> {
        Ok(matches!(self.side()?, Some(Value::String(s)) if s == side))
    }
}

pub type Selection = Option<Vec<Pick>>;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct SideLines {
    pub lines: Vec<String>,
    pub starts: Vec<usize>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Range {
    pub start: usize,
    pub end: usize,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Built {
    pub text: String,
    pub ranges: Vec<Range>,
}

fn prop<'a>(v: &'a Value, key: &str) -> Result<Option<&'a Value>, String> {
    if v.is_null() || crate::js::is_undefined(v) {
        return Err(format!(
            "TypeError: Cannot read properties of null (reading '{key}')"
        ));
    }
    Ok(v.as_object()
        .and_then(|o| o.get(key))
        .filter(|x| !crate::js::is_undefined(x)))
}

fn strict_eq(a: Option<&Value>, b: Option<&Value>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(x), Some(y)) => {
            if let (Some(m), Some(n)) = (crate::js::as_number(x), crate::js::as_number(y)) {
                return m == n;
            }
            match (x, y) {
                (Value::String(m), Value::String(n)) => m == n,
                (Value::Bool(m), Value::Bool(n)) => m == n,
                (Value::Null, Value::Null) => true,
                _ => false,
            }
        }
        _ => false,
    }
}

fn index_in(line: Option<&Value>, lines: &[String]) -> String {
    match line {
        Some(Value::String(s)) if s == "length" => lines.len().to_string(),
        Some(Value::String(s)) => match s.parse::<usize>() {
            Ok(i) if i.to_string() == *s && i < lines.len() => lines[i].clone(),
            _ => String::new(),
        },
        Some(v) => match crate::js::as_number(v) {
            Some(n) if n >= 0.0 && n.fract() == 0.0 && n < lines.len() as f64 => {
                lines[n as usize].clone()
            }
            _ => String::new(),
        },
        None => String::new(),
    }
}

pub struct Typed;

impl Typed {
    pub fn split_text(text: &str) -> Vec<String> {
        let mut lines: Vec<String> = text.split('\n').map(str::to_string).collect();
        if lines.last().is_some_and(|l| l.is_empty()) {
            lines.pop();
        }
        lines
    }

    pub fn parse_segments(text: &str) -> Vec<Segment> {
        #[derive(PartialEq)]
        enum Part {
            Common,
            A,
            Base,
            B,
        }
        let mut segments = Vec::new();
        let mut part = Part::Common;
        let mut common: Vec<String> = Vec::new();
        let mut a: Vec<String> = Vec::new();
        let mut base: Vec<String> = Vec::new();
        let mut b: Vec<String> = Vec::new();
        for line in Self::split_text(text) {
            if part == Part::Common && line.starts_with("<<<<<<< ") {
                if !common.is_empty() {
                    segments.push(Segment::Common {
                        lines: std::mem::take(&mut common),
                    });
                }
                a = Vec::new();
                base = Vec::new();
                b = Vec::new();
                part = Part::A;
            } else if part == Part::A && line.starts_with("||||||| ") {
                part = Part::Base;
            } else if (part == Part::A || part == Part::Base) && line == "=======" {
                part = Part::B;
            } else if part == Part::B && line.starts_with(">>>>>>> ") {
                segments.push(Segment::Conflict {
                    a: std::mem::take(&mut a),
                    base: std::mem::take(&mut base),
                    b: std::mem::take(&mut b),
                });
                part = Part::Common;
            } else {
                match part {
                    Part::Common => common.push(line),
                    Part::A => a.push(line),
                    Part::Base => base.push(line),
                    Part::B => b.push(line),
                }
            }
        }
        if !common.is_empty() {
            segments.push(Segment::Common { lines: common });
        }
        segments
    }

    pub fn side_text(segments: &[Segment], side: &str) -> Result<SideLines, String> {
        let mut lines: Vec<String> = Vec::new();
        let mut starts = Vec::new();
        for s in segments {
            if s.kind()? == Some("common") {
                lines.extend(s.lines_of("lines")?.iter().cloned());
            } else {
                starts.push(lines.len() + 1);
                lines.extend(s.lines_of(side)?.iter().cloned());
            }
        }
        Ok(SideLines { lines, starts })
    }

    fn pick_line(segment: &Segment, p: &Pick) -> Result<String, String> {
        let side = match p.side()? {
            Some(Value::String(s)) => s.as_str(),
            _ => return Err("TypeError: Cannot read properties of undefined".to_string()),
        };
        let lines = segment.lines_of(side)?;
        Ok(index_in(p.line()?, &lines))
    }

    pub fn build_text(
        segments: &[Segment],
        selections: &[Selection],
        markers: bool,
    ) -> Result<Built, String> {
        let mut out: Vec<String> = Vec::new();
        let mut ranges = Vec::new();
        let mut n = 0;
        for s in segments {
            if s.kind()? == Some("common") {
                out.extend(s.lines_of("lines")?.iter().cloned());
                continue;
            }
            let pick = selections.get(n).and_then(|p| p.as_ref());
            n += 1;
            let start = out.len() + 1;
            if let Some(pick) = pick {
                for p in pick {
                    out.push(Self::pick_line(s, p)?);
                }
            } else if markers {
                out.push("<<<<<<< A".to_string());
                out.extend(s.lines_of("a")?.iter().cloned());
                out.push("=======".to_string());
                out.extend(s.lines_of("b")?.iter().cloned());
                out.push(">>>>>>> B".to_string());
            }
            ranges.push(Range {
                start,
                end: out.len(),
            });
        }
        let text = if out.is_empty() {
            String::new()
        } else {
            out.join("\n") + "\n"
        };
        Ok(Built { text, ranges })
    }

    pub fn toggle(sel: &Selection, p: &Pick) -> Result<Selection, String> {
        let mut cur = sel.clone().unwrap_or_default();
        let mut at = None;
        for (i, x) in cur.iter().enumerate() {
            if strict_eq(x.side()?, p.side()?) && strict_eq(x.line()?, p.line()?) {
                at = Some(i);
                break;
            }
        }
        match at {
            Some(i) => {
                cur.remove(i);
            }
            None => cur.push(p.clone()),
        }
        Ok(if cur.is_empty() { None } else { Some(cur) })
    }

    fn remove_side(sel: &Selection, side: &str) -> Result<Selection, String> {
        let mut next = Vec::new();
        for x in sel.iter().flatten() {
            if !x.on_side(side)? {
                next.push(x.clone());
            }
        }
        Ok(if next.is_empty() { None } else { Some(next) })
    }

    pub fn taken(sel: &Selection, side: &str, count: f64) -> Result<bool, String> {
        if count.is_nan() || count <= 0.0 {
            return Ok(false);
        }
        let Some(picks) = sel else {
            return Ok(false);
        };
        let mut n = 0usize;
        for x in picks {
            if x.on_side(side)? {
                n += 1;
            }
        }
        Ok(n as f64 == count)
    }

    pub fn toggle_whole_side(sel: &Selection, side: &str, count: f64) -> Result<Selection, String> {
        if Self::taken(sel, side, count)? {
            return Self::remove_side(sel, side);
        }
        let len = if count.is_nan() || count <= 0.0 {
            0.0
        } else {
            count.trunc()
        };
        if len >= 1_073_741_824.0 {
            return Err("RangeError: Invalid array length".to_string());
        }
        let len = len as u64;
        let mut cur = sel.clone().unwrap_or_default();
        let readable = cur.iter().all(|x| x.side().is_ok());
        let mut missing = Vec::new();
        if readable {
            let mut have: HashSet<u64> = HashSet::new();
            for x in &cur {
                if x.on_side(side)?
                    && let Some(n) = x.line()?.and_then(crate::js::as_number)
                    && n >= 0.0
                    && n.fract() == 0.0
                {
                    have.insert(n as u64);
                }
            }
            for line in 0..len {
                if !have.contains(&line) {
                    missing.push(line);
                }
            }
        } else {
            for line in 0..len {
                let mut found = false;
                for x in &cur {
                    if x.on_side(side)?
                        && strict_eq(x.line()?, Some(&crate::js::number(line as f64)))
                    {
                        found = true;
                        break;
                    }
                }
                if !found {
                    missing.push(line);
                }
            }
        }
        cur.extend(missing.into_iter().map(|l| Pick::new(side, l as f64)));
        Ok(Some(cur))
    }

    pub fn counts(segments: &[Segment], side: &str) -> Result<Vec<usize>, String> {
        let mut out = Vec::new();
        for s in segments {
            if s.kind()? == Some("conflict") {
                out.push(s.side_len(side)?);
            }
        }
        Ok(out)
    }

    pub fn every_taken(
        segments: &[Segment],
        sels: &[Selection],
        side: &str,
    ) -> Result<bool, String> {
        let n = Self::counts(segments, side)?;
        if !n.iter().any(|&c| c > 0) {
            return Ok(false);
        }
        let none: Selection = None;
        for (i, &c) in n.iter().enumerate() {
            if c != 0 && !Self::taken(sels.get(i).unwrap_or(&none), side, c as f64)? {
                return Ok(false);
            }
        }
        Ok(true)
    }

    pub fn take_every(
        segments: &[Segment],
        sels: &[Selection],
        side: &str,
    ) -> Result<Vec<Selection>, String> {
        let full = Self::every_taken(segments, sels, side)?;
        let none: Selection = None;
        let mut out = Vec::new();
        for (i, c) in Self::counts(segments, side)?.into_iter().enumerate() {
            let sel = sels.get(i).unwrap_or(&none);
            out.push(if full {
                Self::remove_side(sel, side)?
            } else {
                Self::toggle_whole_side(sel, side, c as f64)?
            });
        }
        Ok(out)
    }
}

#[cfg(test)]
pub(crate) mod wrappers {
    use super::*;

    fn segments_of(values: Vec<Value>) -> Vec<Segment> {
        values.into_iter().map(Segment::from_value).collect()
    }

    fn falsy(v: &Value) -> bool {
        match v {
            Value::Null | Value::Bool(false) => true,
            Value::String(s) => s.is_empty(),
            Value::Number(n) => n.as_f64() == Some(0.0),
            _ => {
                crate::js::is_undefined(v)
                    || crate::js::as_number(v).is_some_and(|n| n == 0.0 || n.is_nan())
            }
        }
    }

    fn selection_of(v: &Value) -> Result<Selection, String> {
        match v {
            Value::Null => Ok(None),
            _ if crate::js::is_undefined(v) => Ok(None),
            Value::Array(items) => Ok(Some(items.iter().cloned().map(Pick).collect())),
            _ => Err("TypeError: selection is not an array".to_string()),
        }
    }

    fn js_index(v: &Value, i: usize) -> Result<Value, String> {
        match v {
            Value::Null => Err("TypeError: Cannot read properties of null".to_string()),
            _ if crate::js::is_undefined(v) => {
                Err("TypeError: Cannot read properties of undefined".to_string())
            }
            Value::Array(items) => Ok(items.get(i).cloned().unwrap_or_else(crate::js::undefined)),
            Value::Object(o) => Ok(o
                .get(&i.to_string())
                .cloned()
                .unwrap_or_else(crate::js::undefined)),
            Value::String(s) => Ok(s
                .chars()
                .nth(i)
                .map_or_else(crate::js::undefined, |c| Value::String(c.to_string()))),
            _ => Ok(crate::js::undefined()),
        }
    }

    fn selection_list(v: &Value, n: usize) -> Result<Vec<Selection>, String> {
        (0..n).map(|i| selection_of(&js_index(v, i)?)).collect()
    }

    fn build_selections(v: &Value, n: usize) -> Result<Vec<Selection>, String> {
        (0..n)
            .map(|i| {
                let item = js_index(v, i)?;
                if falsy(&item) {
                    Ok(None)
                } else {
                    selection_of(&item)
                }
            })
            .collect()
    }

    fn selection_picks(sel: Selection) -> Option<Vec<Value>> {
        sel.map(|picks| picks.into_iter().map(|p| p.0).collect())
    }

    pub fn split_lines(text: String) -> Result<Vec<String>, String> {
        Ok(Typed::split_text(&text))
    }

    pub fn parse_merge(text: String) -> Result<Vec<Value>, String> {
        Ok(Typed::parse_segments(&text)
            .iter()
            .map(Segment::to_value)
            .collect())
    }

    pub fn side_lines(segments: Vec<Value>, side: String) -> Result<Value, String> {
        let segments = segments_of(segments);
        serde_json::to_value(Typed::side_text(&segments, &side)?).map_err(|e| e.to_string())
    }

    pub fn build_output(
        segments: Vec<Value>,
        selections: Value,
        markers: Option<bool>,
    ) -> Result<Value, String> {
        let segments = segments_of(segments);
        let mut n = 0;
        for s in &segments {
            if s.kind()? != Some("common") {
                n += 1;
            }
        }
        let sels = build_selections(&selections, n)?;
        let built = Typed::build_text(&segments, &sels, markers.unwrap_or(false))?;
        serde_json::to_value(built).map_err(|e| e.to_string())
    }

    pub fn toggle_pick(sel: Value, p: Value) -> Result<Option<Vec<Value>>, String> {
        let sel = selection_of(&sel)?;
        Ok(selection_picks(Typed::toggle(&sel, &Pick(p))?))
    }

    pub fn side_taken(sel: Value, side: String, count: f64) -> Result<bool, String> {
        if count.is_nan() || count <= 0.0 || falsy(&sel) {
            return Ok(false);
        }
        Typed::taken(&selection_of(&sel)?, &side, count)
    }

    pub fn toggle_side(sel: Value, side: String, count: f64) -> Result<Option<Vec<Value>>, String> {
        let sel = selection_of(&sel)?;
        Ok(selection_picks(Typed::toggle_whole_side(
            &sel, &side, count,
        )?))
    }

    pub fn all_taken(segments: Vec<Value>, sels: Value, side: String) -> Result<bool, String> {
        let segments = segments_of(segments);
        let n = Typed::counts(&segments, &side)?;
        if !n.iter().any(|&c| c > 0) {
            return Ok(false);
        }
        for (i, &c) in n.iter().enumerate() {
            if c != 0 && !side_taken(js_index(&sels, i)?, side.clone(), c as f64)? {
                return Ok(false);
            }
        }
        Ok(true)
    }

    pub fn take_all(
        segments: Vec<Value>,
        sels: Value,
        side: String,
    ) -> Result<Vec<Option<Vec<Value>>>, String> {
        let segments = segments_of(segments);
        let n = Typed::counts(&segments, &side)?.len();
        let sels = selection_list(&sels, n)?;
        Ok(Typed::take_every(&segments, &sels, &side)?
            .into_iter()
            .map(selection_picks)
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crlf_markers_are_not_closed() {
        let s = Typed::parse_segments("<<<<<<< A\r\nx\r\n=======\r\ny\r\n>>>>>>> B\r\n");
        assert!(s.is_empty());
    }

    #[test]
    fn parses_diff3_conflict() {
        let s =
            Typed::parse_segments("top\n<<<<<<< A\na\n||||||| base\nx\n=======\nb\n>>>>>>> B\nend");
        assert_eq!(s.len(), 3);
        assert_eq!(
            s[1],
            Segment::Conflict {
                a: vec!["a".into()],
                base: vec!["x".into()],
                b: vec!["b".into()],
            }
        );
    }

    #[test]
    fn toggles_and_builds() {
        let s = Typed::parse_segments("<<<<<<< A\na1\na2\n=======\nb1\n>>>>>>> B\n");
        let sel = Typed::toggle_whole_side(&None, "a", 2.0);
        assert_eq!(
            sel,
            Ok(Some(vec![Pick::new("a", 0.0), Pick::new("a", 1.0)]))
        );
        let built = Typed::build_text(&s, &[sel.unwrap_or_default()], false);
        assert_eq!(built.map(|b| b.text), Ok("a1\na2\n".to_string()));
        assert_eq!(
            Typed::toggle(&Some(vec![Pick::new("a", 0.0)]), &Pick::new("a", 0.0)),
            Ok(None)
        );
    }
}
