use kynex_core::Core;
use serde_json::json;
use std::sync::Arc;

#[tokio::main]
async fn main() {
    let root = std::env::temp_dir().join("kxl-we-probe");
    let core = Core::new(root, Arc::new(|_| {})).unwrap();
    match core.dispatch("wallpaper_engine_scan", json!({})).await {
        Ok(value) => println!(
            "{}",
            serde_json::to_string_pretty(&value).unwrap_or_default()
        ),
        Err(error) => println!("ERR {error}"),
    }
}
