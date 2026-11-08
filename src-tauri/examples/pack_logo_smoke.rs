use kynex_core::{Core,write_json};use serde_json::json;use std::sync::Arc;
#[tokio::main]async fn main(){let t=tempfile::tempdir().unwrap();let c=Core::new(t.path().to_path_buf(),Arc::new(|_|{})).unwrap();
 for (id,name) in [("one","RLCraft"),("two","Fabulously Optimized")]{
  let v=c.dispatch("search",json!({"kind":"modpack","source":"all","query":name,"game":if id=="one"{"1.12.2"}else{"1.20.1"},"page":0})).await.unwrap();
  println!("Search {name}: {}",v["hits"].as_array().unwrap().iter().map(|h|h["title"].to_string()).collect::<Vec<_>>().join(", "));println!("warning: {}",v["warning"]);
  assert!(v["hits"].as_array().unwrap().iter().any(|h|h["title"].as_str()==Some(name)),"No exact project returned for {name}");
  write_json(&c.instance(id).unwrap().join("kxl.json"),&json!({"id":id,"name":name,"version":if id=="one"{"1.12.2"}else{"1.20.1"},"loader":"fabric","modpack":true})).unwrap();
 }
 let hydrated=c.dispatch("hydrate_pack_icons",json!({})).await.unwrap();
 for row in hydrated.as_array().unwrap(){assert!(row["packLogo"].as_str().is_some_and(|s|s.starts_with("data:image/")),"Missing catalogue logo for {}",row["name"]);assert!(row["packProject"].is_object());println!("Verified catalogue logo recovery: {}",row["name"]);}
 println!("Both independently identified pack logos cached and persisted in isolated test instances.");}
