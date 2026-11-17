use crate::port::wrappers;
use serde_json::Value;

#[path = "../../replay.rs"]
#[allow(dead_code)]
mod support;
use support::{arg, flag, num_value, number, text};

fn call(name: &str, args: &[Value]) -> Result<Value, String> {
    match name {
        "parseDiff" => wrappers::parse_diff(text(&arg(args, 0))?),
        "hunkPatch" => wrappers::hunk_patch(arg(args, 0), arg(args, 1)).map(Value::String),
        "linesPatch" => wrappers::lines_patch(
            arg(args, 0),
            arg(args, 1),
            arg(args, 2),
            flag(&arg(args, 3))?,
        ),
        "linesInRange" => wrappers::lines_in_range(
            arg(args, 0),
            text(&arg(args, 1))?,
            number(&arg(args, 2))?,
            number(&arg(args, 3))?,
        )
        .map(|v| Value::Array(v.into_iter().map(num_value).collect())),
        _ => Err(format!("unknown function {name}")),
    }
}

#[test]
fn replays_recorded_cases() {
    assert_eq!(support::replay(call), 1149);
}
