use serde::Serialize;
use std::sync::OnceLock;

type Sink = Box<dyn Fn(&str, String) + Send + Sync>;

static SINK: OnceLock<Sink> = OnceLock::new();

pub fn set(sink: Sink) {
    let _ = SINK.set(sink);
}

pub fn emit(event: &str, payload: impl Serialize) {
    if let Some(sink) = SINK.get()
        && let Ok(text) = serde_json::to_string(&payload)
    {
        sink(event, text);
    }
}
