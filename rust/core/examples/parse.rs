use diff::port::ParsedDiff;
use merge::port::Typed;
use serde_json::Value;
use std::io::Read;

fn main() {
    let kind = std::env::args().nth(1).expect("kind");
    let mut text = String::new();
    std::io::stdin().read_to_string(&mut text).expect("stdin");
    let out: Value = match kind.as_str() {
        "diff" => serde_json::to_value(ParsedDiff::parse(&text)).expect("diff json"),
        _ => Value::Array(
            Typed::parse_segments(&text)
                .iter()
                .map(|s| s.to_value())
                .collect(),
        ),
    };
    println!("{out}");
}
