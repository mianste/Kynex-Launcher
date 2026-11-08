use kynex_core::{auth, engine, Core};
use std::sync::Arc;
#[tokio::main]
async fn main() {
    let root = std::env::temp_dir().join("kxl-install-probe");
    let core = Core::new(
        root,
        Arc::new(|v| {
            if v["done"] == 0 || v["done"] == v["total"] {
                println!("{v}");
            }
        }),
    )
    .unwrap();
    let account = auth::offline(&core, "KXL_Test").unwrap();
    println!("offline UUID {}", account["uuid"]);
    let installed=engine::install(&core,&serde_json::json!({"name":format!("Probe Fabric {}",uuid::Uuid::new_v4()),"version":"1.20.1","loader":"fabric","loaderVersion":"0.16.14","settings":engine::defaults()})).await.unwrap();
    println!("installed {}", installed["path"]);
    assert!(std::path::Path::new(installed["path"].as_str().unwrap())
        .join("client.jar")
        .is_file());
    let version = kynex_core::read_json(
        &std::path::Path::new(installed["path"].as_str().unwrap()).join("version.json"),
    )
    .unwrap();
    assert!(version["libraries"]
        .as_array()
        .unwrap()
        .iter()
        .any(|v| v["name"].as_str().unwrap_or("") == "org.lwjgl:lwjgl:3.3.1"));
    println!("INSTALL_PROBE_OK");
}
