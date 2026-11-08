use kynex_core::{auth, engine, read_json, write_json, Core};
use std::sync::Arc;
#[tokio::main]
async fn main() {
    let root = std::env::temp_dir().join("kxl-install-probe");
    let core = Core::new(
        root,
        Arc::new(|v| {
            if v["done"] == v["total"] {
                println!("{v}");
            }
        }),
    )
    .unwrap();
    let instances = core.instances().unwrap();
    let instance = instances
        .as_array()
        .unwrap()
        .iter()
        .find(|i| {
            i["name"]
                .as_str()
                .unwrap_or("")
                .starts_with("Probe Fabric ")
        })
        .unwrap();
    let id = instance["id"].as_str().unwrap();
    let dir = core.instance(id).unwrap();
    let mut conf = read_json(&dir.join("kxl.json")).unwrap();
    conf["settings"]["java"] = serde_json::json!(std::env::args()
        .nth(1)
        .expect("pass path to Java executable"));
    conf["settings"]["memory"] = serde_json::json!(1024);
    write_json(&dir.join("kxl.json"), &conf).unwrap();
    let account = auth::offline(&core, "KXL_Test").unwrap();
    engine::launch(
        &core,
        &serde_json::json!({"id":id,"accountId":account["id"],"settings":engine::defaults()}),
    )
    .await
    .unwrap();
    tokio::time::sleep(std::time::Duration::from_secs(15)).await;
    println!(
        "{}",
        std::fs::read_to_string(dir.join("logs/kxl-launch.log")).unwrap_or_default()
    );
}
