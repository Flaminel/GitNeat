use gitneat_core::actions::dispatch;
use serde_json::{Value, json};

fn main() {
    gitneat_core::stack::run(real_main());
}

async fn real_main() {
    let args: Vec<String> = std::env::args().collect();
    let input: Value = serde_json::from_str(&args[3]).expect("args json");
    let out = match dispatch(&args[1], &args[2], input).await {
        Ok(value) => json!({ "ok": value }),
        Err(text) => json!({ "err": text }),
    };
    println!("{out}");
}
