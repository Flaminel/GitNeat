use gitneat::menus::{MenuKind, build};
use serde_json::{Value, json};

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let out = match run(&args).await {
        Ok(value) => json!({ "ok": value }),
        Err(text) => json!({ "err": text }),
    };
    println!("{out}");
}

async fn run(args: &[String]) -> Result<Value, String> {
    let [_, cwd, kind, input] = args else {
        return Err("usage: menu <cwd> <kind> <args json>".into());
    };
    let kind: MenuKind =
        serde_json::from_value(Value::String(kind.clone())).map_err(|e| e.to_string())?;
    let input: Value = serde_json::from_str(input).map_err(|e| e.to_string())?;
    let items = build(cwd, kind, &input).await?;
    serde_json::to_value(items).map_err(|e| e.to_string())
}
