use crate::port::wrappers;
use serde_json::Value;

#[path = "../../replay.rs"]
#[allow(dead_code)]
mod support;
use support::{arg, list, number, opt_flag, text, undefined};

fn picks(v: Option<Vec<Value>>) -> Value {
    v.map_or_else(undefined, Value::Array)
}

fn call(name: &str, args: &[Value]) -> Result<Value, String> {
    match name {
        "splitLines" => wrappers::split_lines(text(&arg(args, 0))?)
            .map(|v| Value::Array(v.into_iter().map(Value::String).collect())),
        "parseMerge" => wrappers::parse_merge(text(&arg(args, 0))?).map(Value::Array),
        "sideLines" => wrappers::side_lines(list(&arg(args, 0))?, text(&arg(args, 1))?),
        "buildOutput" => {
            wrappers::build_output(list(&arg(args, 0))?, arg(args, 1), opt_flag(&arg(args, 2))?)
        }
        "togglePick" => wrappers::toggle_pick(arg(args, 0), arg(args, 1)).map(picks),
        "sideTaken" => {
            wrappers::side_taken(arg(args, 0), text(&arg(args, 1))?, number(&arg(args, 2))?)
                .map(Value::Bool)
        }
        "toggleSide" => {
            wrappers::toggle_side(arg(args, 0), text(&arg(args, 1))?, number(&arg(args, 2))?)
                .map(picks)
        }
        "allTaken" => wrappers::all_taken(list(&arg(args, 0))?, arg(args, 1), text(&arg(args, 2))?)
            .map(Value::Bool),
        "takeAll" => wrappers::take_all(list(&arg(args, 0))?, arg(args, 1), text(&arg(args, 2))?)
            .map(|v| Value::Array(v.into_iter().map(picks).collect())),
        _ => Err(format!("unknown function {name}")),
    }
}

#[test]
fn replays_recorded_cases() {
    assert_eq!(support::replay(call), 867);
}
