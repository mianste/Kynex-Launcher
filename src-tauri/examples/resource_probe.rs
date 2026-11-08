use kynex_core::{read_json, write_json, Core};
use serde_json::json;
use std::sync::Arc;
#[tokio::main]
async fn main() {
    let temp = tempfile::tempdir().unwrap();
    let core = Core::new(temp.path().to_path_buf(), Arc::new(|_| {})).unwrap();
    let instance = temp.path().join("instances").join("resource-probe");
    write_json(&instance.join("kxl.json"), &json!({"id":"resource-probe","name":"probe","version":"1.20.1","loader":"fabric","settings":{"isolation":"independent"}})).unwrap();
    let result = core
        .dispatch(
            "install_project",
            json!({"id":"resource-probe","kind":"mods","project":"wthit"}),
        )
        .await
        .unwrap();
    assert!(
        result["files"].as_u64().unwrap() >= 2,
        "required dependency must be downloaded"
    );
    let lock = read_json(&instance.join("installed-projects.json")).unwrap();
    assert_eq!(
        lock.as_object().unwrap().len() as u64,
        result["files"].as_u64().unwrap()
    );
    for v in lock.as_object().unwrap().values() {
        assert!(instance
            .join("mods")
            .join(v["file"].as_str().unwrap())
            .exists());
    }
    println!("REAL_DEPENDENCY_INSTALL {result}");
    println!(
        "MOD_SCAN {}",
        core.dispatch("resources", json!({"id":"resource-probe","kind":"mods"}))
            .await
            .unwrap()
    );
}
