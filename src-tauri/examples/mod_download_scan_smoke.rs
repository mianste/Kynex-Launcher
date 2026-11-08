use kynex_core::{Core,write_json};use serde_json::json;use std::sync::Arc;use tokio::sync::mpsc;
#[tokio::main]async fn main(){
 let t=tempfile::tempdir().unwrap();let (tx,mut rx)=mpsc::unbounded_channel();let c=Core::new(t.path().into(),Arc::new(move|v|{let _=tx.send(v);})).unwrap();let dir=c.instance("qa").unwrap();
 write_json(&dir.join("kxl.json"),&json!({"id":"qa","name":"QA","version":"1.20.1","loader":"forge","settings":{"isolation":"all"}})).unwrap();
 let versions=c.dispatch("project_versions",json!({"id":"qa","kind":"mods","source":"curseforge","project":238222,"game":"1.20.1","loader":"forge","paged":true})).await.unwrap();let old=versions["versions"].as_array().unwrap().last().unwrap();
 c.dispatch("install_project",json!({"id":"qa","kind":"mods","source":"curseforge","project":238222,"versionId":old["id"]})).await.unwrap();
 let mut checking=false;let mut done=false;
 tokio::time::timeout(std::time::Duration::from_secs(45),async{while let Some(v)=rx.recv().await{let scan=&v["modUpdateScan"];if scan["id"]!="qa"{continue;}if scan["status"]=="checking"{checking=true;}if scan["status"]=="done"{assert!(scan["rows"].as_array().unwrap().iter().any(|r|r["status"]=="update"));done=true;break;}if scan["status"]=="error"{panic!("Background scan failed: {}",scan["error"]);}}}).await.unwrap();
 assert!(checking&&done);assert!(t.path().join("cache/mod-updates-v3.json").is_file());println!("Downloaded historical JEI: background checking and results emitted without opening Mod page or calling check_mod_updates");
 let (tx,mut rx)=mpsc::unbounded_channel();let restarted=Core::new(t.path().into(),Arc::new(move|v|{let _=tx.send(v);})).unwrap();
 assert_eq!(restarted.dispatch("scan_installed_mod_updates",json!({})).await.unwrap()["scheduled"],1);
 tokio::time::timeout(std::time::Duration::from_secs(15),async{let mut restored=false;while let Some(v)=rx.recv().await{let scan=&v["modUpdateScan"];if scan["status"]=="cached"{assert!(scan["rows"].as_array().unwrap().iter().any(|r|r["status"]=="update"));restored=true;}if scan["status"]=="done"{assert!(restored);break;}assert_ne!(scan["status"],"error");}}).await.unwrap();
 println!("Restarted launcher: existing JEI update restored and checked before visiting any Mod page");
}
