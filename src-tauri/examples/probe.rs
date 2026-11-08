use kynex_core::{engine, Core};
use std::sync::Arc;
#[tokio::main]
async fn main() {
    let tmp = std::env::temp_dir().join("kxl-api-probe");
    let core = Core::new(tmp, Arc::new(|_| {})).unwrap();
    let response = core
        .http
        .get(engine::MANIFEST)
        .send()
        .await
        .expect("request failed");
    let manifest: serde_json::Value = response.json().await.unwrap();
    println!(
        "Mojang manifest: {} versions; latest release = {}",
        manifest["versions"].as_array().unwrap().len(),
        manifest["latest"]["release"]
    );
    let loaders = engine::loaders(&core, "1.20.1", "fabric").await.unwrap();
    println!(
        "Fabric 1.20.1: {} compatible loaders",
        loaders.as_array().unwrap().len()
    );
    let search = core
        .dispatch("search", serde_json::json!({"kind":"mod","query":"sodium"}))
        .await
        .unwrap();
    println!(
        "Modrinth search: {} hits",
        search["hits"].as_array().unwrap().len()
    );
}
