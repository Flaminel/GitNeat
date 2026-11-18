use gitneat::loaders::{self, DiffSource};
use serde_json::{Value, json};
use std::io::Read;

fn text(input: &Value, key: &str) -> Option<String> {
    input.get(key).and_then(Value::as_str).map(String::from)
}

fn ok<T: serde::Serialize>(result: Result<T, String>) -> Value {
    match result {
        Ok(value) => json!({ "ok": value }),
        Err(text) => json!({ "err": text }),
    }
}

async fn call(name: &str, input: &Value) -> Value {
    let cwd = text(input, "cwd").expect("cwd");
    let sha = text(input, "sha").unwrap_or_default();
    let file = text(input, "file").unwrap_or_default();
    let orig = text(input, "orig");
    let source = || -> DiffSource {
        serde_json::from_value(input.get("source").cloned().expect("source")).expect("source json")
    };
    match name {
        "loadCommit" => ok(loaders::load_commit(&cwd, &sha).await),
        "loadAllFiles" => ok(loaders::load_all_files(&cwd, &sha).await),
        "loadDiff" => {
            let ws = input
                .get("ignoreWhitespace")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            ok(loaders::load_diff(&cwd, &source(), &file, ws, orig.as_deref()).await)
        }
        "loadSides" => {
            let roots = vec![cwd.clone()];
            let sides = loaders::load_sides(&cwd, &source(), &file, orig.as_deref(), &roots).await;
            ok(Ok::<_, String>(sides))
        }
        "loadBlame" => ok(loaders::load_blame(&cwd, &file, text(input, "rev").as_deref()).await),
        "loadFileHistory" => {
            let limit = input.get("limit").and_then(Value::as_u64).unwrap_or(200);
            let limit = u32::try_from(limit).expect("limit");
            ok(loaders::load_file_history(&cwd, &file, limit).await)
        }
        "loadMerge" => {
            let op = input.get("operation").cloned().unwrap_or(Value::Null);
            let op = serde_json::from_value(op).expect("operation json");
            ok(loaders::load_merge(&cwd, &file, op).await)
        }
        "loadHeadMessage" => ok(Ok::<_, String>(loaders::load_head_message(&cwd).await)),
        other => panic!("unknown loader {other}"),
    }
}

#[tokio::main]
async fn main() {
    let mut stdin = String::new();
    std::io::stdin()
        .read_to_string(&mut stdin)
        .expect("read stdin");
    let calls: Vec<Value> = serde_json::from_str(&stdin).expect("calls json");
    let mut out = Vec::with_capacity(calls.len());
    for item in &calls {
        let name = item.get("name").and_then(Value::as_str).expect("name");
        let args = item.get("args").cloned().unwrap_or(Value::Null);
        out.push(call(name, &args).await);
    }
    println!("{}", Value::Array(out));
}
