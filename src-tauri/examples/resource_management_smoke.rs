use kynex_core::{Core, write_json};
use serde_json::json;
use std::sync::Arc;

#[tokio::main]
async fn main() {
    let temp = tempfile::tempdir().unwrap();
    let core = Core::new(temp.path().into(), Arc::new(|_| {})).unwrap();
    let instance = core.instance("qa").unwrap();
    write_json(&instance.join("kxl.json"), &json!({"id":"qa","version":"1.20.1","loader":"forge","settings":{"isolation":"all"}})).unwrap();
    let mods = instance.join("mods");std::fs::create_dir_all(&mods).unwrap();
    for name in ["kynex-qa-delete.jar", "kynex-qa-disabled.jar.disabled", "keep.jar"] { std::fs::write(mods.join(name), b"isolated QA fixture").unwrap(); }
    let result = core.dispatch("delete_resources", json!({"id":"qa","kind":"mods","names":["kynex-qa-delete.jar","kynex-qa-disabled.jar.disabled"]})).await.unwrap();
    assert_eq!(result["deleted"].as_array().unwrap().len(), 2);assert!(result["failed"].as_array().unwrap().is_empty());assert!(mods.join("keep.jar").exists());
    let pack = instance.join("resourcepacks/kynex-qa-folder-pack");std::fs::create_dir_all(&pack).unwrap();std::fs::write(pack.join("pack.mcmeta"), b"{}").unwrap();
    std::fs::write(instance.join("options.txt"), "fov:0.7\nresourcePacks:[\"vanilla\",\"file/kynex-qa-folder-pack\"]\n").unwrap();
    let result = core.dispatch("delete_resources",json!({"id":"qa","kind":"resourcepacks","names":["kynex-qa-folder-pack"]})).await.unwrap();assert_eq!(result["deleted"].as_array().unwrap().len(),1);assert!(!pack.exists());
    assert!(!std::fs::read_to_string(instance.join("options.txt")).unwrap().contains("file/kynex-qa-folder-pack"));
    for world in ["WorldA", "WorldB"] {let path=instance.join("saves").join(world);std::fs::create_dir_all(path.join("datapacks")).unwrap();std::fs::write(path.join("level.dat"),b"qa").unwrap();std::fs::write(path.join("datapacks/kynex-qa-pack.zip"),b"qa").unwrap();}
    let result=core.dispatch("delete_resources",json!({"id":"qa","kind":"datapacks","world":"WorldA","names":["kynex-qa-pack.zip"]})).await.unwrap();assert_eq!(result["deleted"].as_array().unwrap().len(),1);assert!(instance.join("saves/WorldB/datapacks/kynex-qa-pack.zip").exists());
    println!("Real recycle-bin deletion passed: selected enabled/disabled files, folder pack, resource-pack options and world isolation");
    for loader in ["fabric", "quilt", "forge"] {
        let rows=core.dispatch("loaders",json!({"game":"b1.8.1","loader":loader})).await.unwrap();assert_eq!(rows,json!([]));
    }
    let modern=core.dispatch("loaders",json!({"game":"1.20.1","loader":"fabric"})).await.unwrap();assert!(!modern.as_array().unwrap().is_empty());
    println!("Live loader APIs passed: b1.8.1 unsupported, 1.20.1 Fabric supported");
}
