#![forbid(unsafe_code)]

pub fn undefined() -> serde_json::Value {
    serde_json::json!({ "$undefined": true })
}

pub fn is_undefined(value: &serde_json::Value) -> bool {
    value.as_object().is_some_and(|o| {
        o.len() == 1 && o.get("$undefined") == Some(&serde_json::Value::Bool(true))
    })
}

pub fn utf16_string(units: &[u16]) -> serde_json::Value {
    match String::from_utf16(units) {
        Ok(s) => serde_json::Value::String(s),
        Err(_) => serde_json::json!({ "$utf16": units }),
    }
}

pub fn string_units(value: &serde_json::Value) -> Option<Vec<u16>> {
    match value {
        serde_json::Value::String(s) => Some(s.encode_utf16().collect()),
        serde_json::Value::Object(o) if o.len() == 1 => o
            .get("$utf16")?
            .as_array()?
            .iter()
            .map(|u| u.as_u64().and_then(|u| u16::try_from(u).ok()))
            .collect(),
        _ => None,
    }
}

pub fn number(n: f64) -> serde_json::Value {
    if n.is_nan() {
        serde_json::json!({ "$num": "NaN" })
    } else if n.is_infinite() {
        serde_json::json!({ "$num": if n > 0.0 { "Infinity" } else { "-Infinity" } })
    } else if n == 0.0 && n.is_sign_negative() {
        serde_json::json!({ "$num": "-0" })
    } else if n.fract() == 0.0 && n.abs() < 9_007_199_254_740_992.0 {
        serde_json::Value::from(n as i64)
    } else {
        serde_json::Value::from(n)
    }
}

pub fn sort<T>(items: &mut [T], mut compare: impl FnMut(&T, &T) -> f64) {
    let n = items.len();
    if n < 2 {
        return;
    }
    if n >= 64 {
        items.sort_by(|a, b| {
            compare(a, b)
                .partial_cmp(&0.0)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        return;
    }
    let mut run = 2;
    let descending = compare(&items[1], &items[0]) < 0.0;
    while run < n {
        let order = compare(&items[run], &items[run - 1]);
        if (descending && order >= 0.0) || (!descending && order < 0.0) {
            break;
        }
        run += 1;
    }
    if descending {
        items[..run].reverse();
    }
    for start in run..n {
        let (mut left, mut right) = (0, start);
        while left < right {
            let mid = left + ((right - left) >> 1);
            if compare(&items[start], &items[mid]) < 0.0 {
                right = mid;
            } else {
                left = mid + 1;
            }
        }
        items[left..=start].rotate_right(1);
    }
}

pub fn as_number(value: &serde_json::Value) -> Option<f64> {
    match value {
        serde_json::Value::Number(n) => n.as_f64(),
        serde_json::Value::Object(o) if o.len() == 1 => match o.get("$num")?.as_str()? {
            "NaN" => Some(f64::NAN),
            "Infinity" => Some(f64::INFINITY),
            "-Infinity" => Some(f64::NEG_INFINITY),
            "-0" => Some(-0.0),
            _ => None,
        },
        _ => None,
    }
}
