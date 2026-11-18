use crate::port::wrappers;
use serde_json::Value;

#[path = "../../replay.rs"]
#[allow(dead_code)]
mod support;
use support::{arg, text};

fn values(v: Vec<Value>) -> Value {
    Value::Array(v)
}

fn call(name: &str, args: &[Value]) -> Result<Value, String> {
    let first = text(&arg(args, 0));
    match name {
        "samePath" => wrappers::same_path(first?, text(&arg(args, 1))?).map(Value::Bool),
        "parseLog" => wrappers::parse_log(first?).map(values),
        "parseRefs" => wrappers::parse_refs(first?).map(values),
        "parseStatus" => wrappers::parse_status(first?).map(values),
        "parseNameStatus" => wrappers::parse_name_status(first?).map(values),
        "remoteWebUrl" => wrappers::remote_web_url(first?),
        "commitWebUrl" => wrappers::commit_web_url(first?, text(&arg(args, 1))?),
        "compareWebUrl" => wrappers::compare_web_url(first?, text(&arg(args, 1))?),
        _ => Err(format!("unknown function {name}")),
    }
}

#[test]
fn replays_recorded_cases() {
    assert_eq!(support::replay(call), 1979);
}
