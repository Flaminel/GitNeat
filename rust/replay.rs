use serde_json::{Value, json};

pub fn undefined() -> Value {
    json!({ "$undefined": true })
}

pub fn arg(args: &[Value], i: usize) -> Value {
    args.get(i).cloned().unwrap_or_else(undefined)
}

fn marker<'a>(v: &'a Value, key: &str) -> Option<&'a Value> {
    v.as_object()
        .filter(|o| o.len() == 1)
        .and_then(|o| o.get(key))
}

pub fn text(v: &Value) -> Result<String, String> {
    if let Value::String(s) = v {
        return Ok(s.clone());
    }
    let units: Option<Vec<u16>> = marker(v, "$utf16").and_then(Value::as_array).and_then(|a| {
        a.iter()
            .map(|u| u.as_u64().and_then(|u| u16::try_from(u).ok()))
            .collect()
    });
    units
        .map(|u| String::from_utf16_lossy(&u))
        .ok_or_else(|| "TypeError: expected a string".to_string())
}

pub fn number(v: &Value) -> Result<f64, String> {
    match v {
        Value::Number(n) => n.as_f64(),
        _ => match marker(v, "$num").and_then(Value::as_str) {
            Some("NaN") => Some(f64::NAN),
            Some("Infinity") => Some(f64::INFINITY),
            Some("-Infinity") => Some(f64::NEG_INFINITY),
            Some("-0") => Some(-0.0),
            _ => None,
        },
    }
    .ok_or_else(|| "TypeError: expected a number".to_string())
}

pub fn flag(v: &Value) -> Result<bool, String> {
    v.as_bool()
        .ok_or_else(|| "TypeError: expected a boolean".to_string())
}

pub fn opt_flag(v: &Value) -> Result<Option<bool>, String> {
    if v.is_null() || marker(v, "$undefined").is_some() {
        Ok(None)
    } else {
        flag(v).map(Some)
    }
}

pub fn list(v: &Value) -> Result<Vec<Value>, String> {
    match v {
        Value::Array(items) => Ok(items.clone()),
        _ => Err("TypeError: expected an array".to_string()),
    }
}

pub fn num_value(n: f64) -> Value {
    if n.is_nan() {
        json!({ "$num": "NaN" })
    } else if n.is_infinite() {
        json!({ "$num": if n > 0.0 { "Infinity" } else { "-Infinity" } })
    } else if n == 0.0 && n.is_sign_negative() {
        json!({ "$num": "-0" })
    } else {
        Value::from(n)
    }
}

fn plain_number(v: &Value) -> Option<f64> {
    number(v).ok().filter(|_| !v.is_boolean())
}

pub fn same(a: &Value, b: &Value) -> bool {
    if let (Some(x), Some(y)) = (plain_number(a), plain_number(b)) {
        return x.to_bits() == y.to_bits() || (x.is_nan() && y.is_nan()) || (x == y && x != 0.0);
    }
    match (a, b) {
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(p, q)| same(p, q))
        }
        (Value::Object(x), Value::Object(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|((k, p), (l, q))| k == l && same(p, q))
        }
        _ => a == b,
    }
}

pub fn replay(call: impl Fn(&str, &[Value]) -> Result<Value, String>) -> usize {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/cases.jsonl");
    let data = std::fs::read_to_string(path).expect("read cases.jsonl");
    let mut count = 0;
    let mut failures = Vec::new();
    for (i, line) in data.lines().enumerate() {
        let case: Value = serde_json::from_str(line).expect("parse case");
        let name = case["fn"].as_str().expect("fn name");
        let args = case["args"].as_array().expect("args");
        let got = call(name, args);
        let ok = match (case.get("ok"), case.get("error"), &got) {
            (Some(want), _, Ok(have)) => same(want, have),
            (None, Some(_), Err(_)) => true,
            _ => false,
        };
        if !ok {
            failures.push(format!("line {} {name}: got {got:?}", i + 1));
        }
        count += 1;
    }
    assert!(
        failures.is_empty(),
        "{} of {count} cases differ:\n{}",
        failures.len(),
        failures
            .iter()
            .take(5)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
    count
}
