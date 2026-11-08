use kynex_core::{Core,write_json};use serde_json::json;use std::sync::Arc;
#[tokio::main]async fn main(){let t=tempfile::tempdir().unwrap();let c=Core::new(t.path().into(),Arc::new(|_|{})).unwrap();
 let root=c.instance("test").unwrap();write_json(&root.join("kxl.json"),&json!({"id":"test","name":"Resource Test","version":"1.20.1","loader":"fabric","settings":{"isolation":"all"}})).unwrap();let world=root.join("saves/Test World");std::fs::create_dir_all(&world).unwrap();std::fs::write(world.join("level.dat"),b"fixture").unwrap();
 for(kind,project)in[("modpacks","fabulously-optimized"),("resourcepacks","faithful-32x"),("shaderpacks","complementary-unbound"),("datapacks","terralith")]{
  let v=c.dispatch("project_versions",json!({"id":"test","kind":kind,"source":"modrinth","project":project})).await.unwrap();let rows=v.as_array().unwrap();assert!(rows.len()>1,"{kind} missing all versions");println!("{kind}: {} publicly downloadable versions",rows.len());
  if kind=="datapacks"{
   let selected=rows.iter().find(|v|v["compatible"]==true).expect("No 1.20.1 data pack version");
   // The version endpoint always returns the canonical project ID.
   let version=c.get(&format!("https://api.modrinth.com/v2/version/{}",selected["id"].as_str().unwrap())).await.unwrap();let project=version["project_id"].clone();
   c.dispatch("install_project",json!({"id":"test","kind":kind,"source":"modrinth","project":project,"versionId":selected["id"],"world":"Test World"})).await.unwrap();
   let files=std::fs::read_dir(world.join("datapacks")).unwrap().flatten().filter(|e|e.path().extension().is_some_and(|x|x=="zip")).count();assert!(files>0);assert!(!root.join("datapacks").exists());
   let path=t.path().join("chosen-version.zip");c.dispatch("download_resource_file",json!({"kind":kind,"source":"modrinth","project":project,"versionId":selected["id"],"path":path})).await.unwrap();assert!(path.is_file());
   println!("Selected ZIP installed into real world path and saved separately with hash verification");
  }
 }
 let data=c.dispatch("search",json!({"kind":"datapack","query":"Terralith","source":"modrinth","game":"1.20.1","page":0})).await.unwrap();assert!(!data["hits"].as_array().unwrap().is_empty());
 println!("Modrinth data pack search passed");
 let cf=c.dispatch("search",json!({"kind":"datapack","source":"curseforge","game":"1.20.1","page":0,"query":""})).await.unwrap();
 let hit=cf["hits"].as_array().unwrap().first().expect("CurseForge data packs not listed");
 let versions=c.dispatch("project_versions",json!({"id":"test","kind":"datapacks","source":"curseforge","project":hit["project_id"]})).await.unwrap();
 let version=versions.as_array().unwrap().first().expect("CurseForge data pack versions missing");assert!(version["filename"].as_str().unwrap().ends_with(".zip"));
 let target=t.path().join("curseforge-selected.zip");c.dispatch("download_resource_file",json!({"kind":"datapacks","source":"curseforge","project":hit["project_id"],"versionId":version["id"],"path":target})).await.unwrap();assert!(target.is_file());
 println!("CurseForge data pack search, complete file list and selected ZIP download passed");

}
