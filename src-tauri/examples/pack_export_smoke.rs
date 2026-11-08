use kynex_core::{Core,write_json};
use serde_json::{json,Value};
use std::{sync::Arc,io::Read};
#[tokio::main]
async fn main(){
    let t=tempfile::tempdir().unwrap();let c=Core::new(t.path().join("game"),Arc::new(|_|{})).unwrap();let dir=c.instance("qa").unwrap();
    write_json(&dir.join("kxl.json"),&json!({"id":"qa","name":"QA","version":"1.20.1","loader":"fabric","loaderVersion":"0.16.14","settings":{"isolation":"all"}})).unwrap();
    write_json(&dir.join("version.json"),&json!({"id":"fabric-loader-0.16.14-1.20.1"})).unwrap();std::fs::create_dir_all(dir.join("mods")).unwrap();
    let versions=c.get("https://api.modrinth.com/v2/project/AANobbMI/version?game_versions=%5B%221.20.1%22%5D&loaders=%5B%22fabric%22%5D").await.unwrap();
    let version=versions.as_array().unwrap().first().unwrap();let file=version["files"].as_array().unwrap().iter().find(|v|v["primary"]==true).unwrap();let name=file["filename"].as_str().unwrap();
    kynex_core::engine::download(&c,file["url"].as_str().unwrap(),&dir.join("mods").join(name),file["hashes"]["sha1"].as_str().unwrap()).await.unwrap();
    std::fs::create_dir_all(dir.join("resourcepacks")).unwrap();std::fs::write(dir.join("resourcepacks/local-only.zip"),b"local unlisted resource").unwrap();std::fs::write(dir.join("options.txt"),b"fov:0.5").unwrap();
    for bundled in [false,true]{
        let path=t.path().join(if bundled{"bundled.mrpack"}else{"linked.mrpack"});
        let result=c.dispatch("export_pack",json!({"id":"qa","path":path,"name":"Selected QA pack","packVersion":"2.3.4","format":"mrpack","selectionVersion":1,"include":["mods","resourcepacks","options"],"bundleResources":bundled})).await.unwrap();
        assert_eq!(result["onlineFiles"].as_u64().unwrap(),if bundled{0}else{1});let mut zip=zip::ZipArchive::new(std::fs::File::open(&path).unwrap()).unwrap();let mut text=String::new();zip.by_name("modrinth.index.json").unwrap().read_to_string(&mut text).unwrap();let index:Value=serde_json::from_str(&text).unwrap();assert_eq!(index["versionId"],"2.3.4");assert_eq!(index["dependencies"]["fabric-loader"],"0.16.14");
        assert_eq!(zip.by_name(&format!("overrides/mods/{name}")).is_ok(),bundled);assert!(zip.by_name("overrides/resourcepacks/local-only.zip").is_ok());assert!(zip.by_name("overrides/options.txt").is_ok());
        println!("Real Sodium export passed: bundled={bundled}, onlineFiles={}, embeddedFiles={}",result["onlineFiles"],result["embeddedFiles"]);
    }
}
