use kynex_core::{Core, write_json};
use serde_json::json;
use std::{sync::Arc,time::Instant};
#[tokio::main]
async fn main() {
 let temp=tempfile::tempdir().unwrap();
 let core=Core::new(temp.path().into(),Arc::new(|_|{})).unwrap();
 write_json(&core.instance("qa").unwrap().join("kxl.json"),&json!({"id":"qa","name":"QA","version":"1.20.1","loader":"forge","settings":{"isolation":"all"}})).unwrap();
 for (source,project,game,loader) in [("modrinth",json!("jei"),"1.20.1","forge"),("modrinth",json!("sodium"),"1.20.1","fabric"),("curseforge",json!(238222),"1.20.1","forge"),("curseforge",json!(238222),"","")] {
  let start=Instant::now();
  let mut p=json!({"id":"qa","kind":"mods","source":source,"project":project,"game":game,"loader":loader,"paged":true,"offset":0});
  let page=core.dispatch("project_versions",p.clone()).await.unwrap();
  let rows=page["versions"].as_array().unwrap();assert!(!rows.is_empty(),"No versions for {project}");
  assert!(rows.iter().all(|r|game.is_empty() || r["gameVersions"].as_array().unwrap().iter().any(|v|v==game)));
  assert!(rows.iter().all(|r|loader.is_empty() || r["loaders"].as_array().unwrap().iter().any(|v|v==loader)));
  println!("{source} {project}, game={game}, loader={loader}: {} versions in {:.2}s, next={}",rows.len(),start.elapsed().as_secs_f64(),page["nextOffset"]);
  if let Some(next)=page["nextOffset"].as_u64() {
   p["offset"]=json!(next);let second=core.dispatch("project_versions",p).await.unwrap();let more=second["versions"].as_array().unwrap();assert!(!more.is_empty());assert!(more.iter().all(|v|!rows.iter().any(|r|r["id"]==v["id"])));println!("Additional history page: {} versions, no duplicate file IDs",more.len());
  }
  if source=="curseforge" && !game.is_empty() {
   let selected=rows.iter().find(|r|r["compatible"]==true).unwrap();
   core.dispatch("install_project",json!({"id":"qa","source":source,"project":project,"kind":"mods","versionId":selected["id"],"skipDependencies":true})).await.unwrap();
   let jar=core.instance("qa").unwrap().join("mods").join(selected["filename"].as_str().unwrap());assert!(jar.is_file());println!("Selected JEI file downloaded, verified and installed into isolated QA instance");
  }
 }
}
