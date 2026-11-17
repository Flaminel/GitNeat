use crate::port::wrappers;
use serde_json::Value;

#[path = "../../replay.rs"]
#[allow(dead_code)]
mod support;
use support::{arg, list};

fn call(name: &str, args: &[Value]) -> Result<Value, String> {
    match name {
        "layoutGraph" => Ok(Value::Array(wrappers::layout_graph(list(&arg(args, 0))?)?)),
        _ => Err(format!("unknown function {name}")),
    }
}

#[test]
fn replays_recorded_cases() {
    assert_eq!(support::replay(call), 202);
}
