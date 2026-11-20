use gitneat::actions::dispatch;
use serde_json::{Value, json};

fn main() {
    let worker = std::thread::Builder::new()
        .stack_size(16 * 1024 * 1024)
        .spawn(run)
        .expect("spawn worker");
    worker.join().expect("worker panicked");
}

fn run() {
    let args: Vec<String> = std::env::args().collect();
    let input: Value = serde_json::from_str(&args[3]).expect("args json");
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("runtime");
    let out = match runtime.block_on(dispatch(&args[1], &args[2], input)) {
        Ok(value) => json!({ "ok": value }),
        Err(text) => json!({ "err": text }),
    };
    println!("{out}");
}
