use serde_json::Value;
use std::path::PathBuf;

pub fn user_data() -> PathBuf {
    match std::env::var_os("GITNEAT_USER_DATA") {
        Some(dir) => PathBuf::from(dir),
        None => dirs::config_dir()
            .unwrap_or_else(std::env::temp_dir)
            .join("GitNeat"),
    }
}

fn path() -> PathBuf {
    user_data().join("gitneat-state.json")
}

pub async fn get() -> Value {
    match tokio::fs::read_to_string(path()).await {
        Ok(text) => {
            serde_json::from_str(&text).unwrap_or_else(|_| Value::Object(Default::default()))
        }
        Err(_) => Value::Object(Default::default()),
    }
}

static WRITE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub async fn set(data: &Value) -> std::io::Result<()> {
    write(path(), data).await
}

async fn write(target: PathBuf, data: &Value) -> std::io::Result<()> {
    if let Some(dir) = target.parent() {
        tokio::fs::create_dir_all(dir).await?;
    }
    let text = serde_json::to_string_pretty(data).map_err(std::io::Error::other)?;
    let _guard = WRITE.lock().await;
    let temp = target.with_extension("json.tmp");
    tokio::fs::write(&temp, text).await?;
    tokio::fs::rename(temp, target).await
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn set_replaces_the_file_and_leaves_no_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("gitneat-state.json");
        super::write(target.clone(), &serde_json::json!({"active": 0})).await.unwrap();
        super::write(target.clone(), &serde_json::json!({"active": 1})).await.unwrap();
        let text = std::fs::read_to_string(&target).unwrap();
        assert_eq!(serde_json::from_str::<serde_json::Value>(&text).unwrap(), serde_json::json!({"active": 1}));
        assert!(!dir.path().join("gitneat-state.json.tmp").exists());
    }

    #[test]
    fn pretty_json_keeps_key_order_and_two_space_indent() {
        let value: serde_json::Value =
            serde_json::from_str(r#"{"tabs":[{"path":"/r"}],"active":0}"#).unwrap();
        assert_eq!(
            serde_json::to_string_pretty(&value).unwrap(),
            "{\n  \"tabs\": [\n    {\n      \"path\": \"/r\"\n    }\n  ],\n  \"active\": 0\n}"
        );
    }
}
