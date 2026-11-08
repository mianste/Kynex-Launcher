use kynex_core::{Core,write_json};
use serde_json::json;
use std::sync::Arc;
#[tokio::main]async fn main(){
 let temp=tempfile::tempdir().unwrap();let core=Core::new(temp.path().to_path_buf(),Arc::new(|_|{})).unwrap();
 write_json(&temp.path().join("instances/qa/kxl.json"),&json!({"id":"qa","version":"1.20.1","loader":"fabric","settings":{"isolation":"all"}})).unwrap();
 let v=core.dispatch("project_versions",json!({"id":"qa","project":"AANobbMI","source":"modrinth"})).await.unwrap();let rows=v.as_array().unwrap();assert!(rows.len()>1);assert!(rows.iter().any(|r|r["compatible"]==false));let old=rows.iter().rev().find(|r|r["compatible"]==true).unwrap()["id"].as_str().unwrap();
 let invalid=core.dispatch("install_project",json!({"id":"qa","project":"wrong-project","kind":"mods","versionId":old})).await;assert!(invalid.is_err());
 core.dispatch("install_project",json!({"id":"qa","project":"AANobbMI","kind":"mods","versionId":old})).await.unwrap();
 println!("Selected old: {} Latest listed: {}",old,rows[0]); let check=core.dispatch("check_mod_updates",json!({"id":"qa"})).await.unwrap();println!("Update check: {check}");assert!(check.as_array().unwrap().iter().any(|v|v["status"]=="update"));
 let updated=core.dispatch("update_mods",json!({"id":"qa"})).await.unwrap();assert!(updated["updated"].as_u64().unwrap()>0);assert!(std::path::Path::new(updated["backup"].as_str().unwrap()).is_dir());
 let checked=core.dispatch("check_mod_updates",json!({"id":"qa"})).await.unwrap();assert!(checked.as_array().unwrap().iter().all(|v|v["status"]=="current"));
 // Repeat a downgrade/upgrade with existing disabled backups: never leave duplicate active jars.
 core.dispatch("install_project",json!({"id":"qa","project":"AANobbMI","kind":"mods","versionId":old})).await.unwrap();
 core.dispatch("update_mods",json!({"id":"qa"})).await.unwrap();
 let active=std::fs::read_dir(temp.path().join("instances/qa/mods")).unwrap().flatten().filter(|e|e.file_name().to_string_lossy().ends_with(".jar")).count();assert_eq!(active,1);
 let cf=core.dispatch("project_versions",json!({"id":"qa","project":306612,"source":"curseforge"})).await.unwrap();assert!(!cf.as_array().unwrap().is_empty());
 println!("Live Modrinth version selection, wrong-project rejection, installation, update detection, backup, update, current-state verification passed; CurseForge version listing passed.");
}
