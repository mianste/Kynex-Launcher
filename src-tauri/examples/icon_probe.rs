use kynex_core::Core;
use serde_json::json;
use std::sync::Arc;

#[tokio::main]
async fn main() {
    let root = std::env::temp_dir().join("kxl-icon-probe");
    let core = Core::new(root, Arc::new(|_| {})).unwrap();
    for url in [
        "https://media.forgecdn.net/avatars/thumbnails/1831/837/256/256/639155811725299955.png",
        "https://cdn.modrinth.com/data/tpehi7ww/429ba22d212868940cdd82465df949ac51c9791e_96.webp",
    ] {
        match core.dispatch("icon", json!({"url": url})).await {
            Ok(value) => println!(
                "OK {} bytes={}",
                url,
                value["data"].as_str().map(str::len).unwrap_or(0)
            ),
            Err(error) => println!("ERR {url} => {error}"),
        }
    }
}
