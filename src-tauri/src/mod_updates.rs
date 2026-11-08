use crate::*;
use sha1::{Digest,Sha1};
fn modrinth_row(v: &Value, game: &str, loader: &str) -> Value {
 let compatible=v["game_versions"].as_array().is_some_and(|a|a.iter().any(|x|x==game))
     && v["loaders"].as_array().is_some_and(|a|a.iter().any(|x|x==loader));
 json!({"id":v["id"],"name":v["name"],"number":v["version_number"],"date":v["date_published"],"type":v["version_type"],"gameVersions":v["game_versions"],"loaders":v["loaders"],"compatible":compatible})
}
fn curseforge_row(v: &Value, game: &str, loader: &str) -> Value {
 let tags=v["gameVersions"].as_array().cloned().unwrap_or_default();
 let loader_names=["Forge","Fabric","Quilt","NeoForge","LiteLoader","Rift","Iris","OptiFine","Canvas","Vanilla"];
 let loaders:Vec<_>=tags.iter().filter_map(Value::as_str).filter(|x|loader_names.contains(x)).map(str::to_lowercase).collect();
 let games:Vec<_>=tags.iter().filter_map(Value::as_str).filter(|x|!loader_names.contains(x)).collect();
 json!({"id":v["id"].to_string(),"name":v["displayName"],"number":v["fileName"],"date":v["fileDate"],"type":match v["releaseType"].as_u64(){Some(1)=>"release",Some(2)=>"beta",_=>"alpha"},"gameVersions":games,"loaders":loaders,"compatible":curseforge::compatible(v,Some(game),Some(loader))})
}
pub async fn versions(core:&Core,p:&Value)->Result<Value>{
 let kind=p["kind"].as_str().unwrap_or("mods");
 if !["mods","modpacks","resourcepacks","shaderpacks","datapacks"].contains(&kind){return Err("资源类型无效".into());}
 let config=p["id"].as_str().filter(|id|!id.is_empty()).and_then(|id|core.instance(id).ok()).and_then(|path|read_json(&path.join("kxl.json")).ok()).unwrap_or_else(||json!({}));
 let game=config["version"].as_str().unwrap_or("");let loader=config["loader"].as_str().unwrap_or("");
 let game_filter=p["game"].as_str().filter(|v|!v.is_empty());
 let loader_filter=p["loader"].as_str().filter(|v|!v.is_empty());
 let paged=p["paged"].as_bool().unwrap_or(false);
 let mut next_offset=None;
 let mut total=None;
 let data=if p["source"]=="curseforge" {
  let project=p["project"].as_u64().or_else(||p["project"].as_str()?.parse().ok()).ok_or("项目 ID 无效")?;
  let key=curseforge::configured_key(core,p["curseforgeKey"].as_str().unwrap_or(""));
  let mut rows=if paged {
   let offset=p["offset"].as_u64().unwrap_or(0);
   let page=curseforge::file_page(core,project,game_filter,loader_filter,key.as_deref(),offset).await?;
   let rows=page["data"].as_array().ok_or("CurseForge 版本列表响应无效")?.clone();
   let end=offset+rows.len() as u64;
   total=page["pagination"]["totalCount"].as_u64();
   if !rows.is_empty() && total.map_or(rows.len()==50,|n|end<n){next_offset=Some(end);}
   rows
  }else{curseforge::files(core,project,game_filter,loader_filter,key.as_deref()).await?};
  rows.retain(|v|v["isAvailable"]!=false && v["isServerPack"]!=true);
  rows.sort_by(|a,b|b["fileDate"].as_str().cmp(&a["fileDate"].as_str()));
  let rows=rows.iter().filter_map(|v|{
   let name=v["fileName"].as_str()?;
   if !crate::resource_downloads::extension_matches(name,kind){return None;}
   let mut row=curseforge_row(v,game,loader);
   row["filename"]=json!(name);
   row["compatible"]=json!(kind=="modpacks" || (!game.is_empty() && curseforge::compatible(v,if resource_downloads::needs_game_match(kind){Some(game)}else{None},if kind=="mods"{Some(loader)}else{None})));
   Some(row)
  }).collect::<Vec<_>>();json!(rows)
 } else {
  let project=safe_name(string(p,"project")?)?;
  let mut url=reqwest::Url::parse(&format!("https://api.modrinth.com/v2/project/{project}/version")).map_err(err)?;
  url.query_pairs_mut().append_pair("include_changelog","false");
  if let Some(game)=game_filter{url.query_pairs_mut().append_pair("game_versions",&json!([game]).to_string());}
  if let Some(loader)=loader_filter{url.query_pairs_mut().append_pair("loaders",&json!([loader]).to_string());}
  let mut data=core.get(url.as_str()).await?;
  if let Some(rows)=data.as_array_mut(){rows.sort_by(|a,b|b["date_published"].as_str().cmp(&a["date_published"].as_str()));}
  let rows=data.as_array().ok_or("版本列表响应无效")?.iter().filter_map(|v|{
   let file=crate::resource_downloads::modrinth_file(v,kind).ok()?;
   let mut row=modrinth_row(v,game,loader);
   row["filename"]=file["filename"].clone();
   let compatible=kind=="modpacks" || (!game.is_empty() && (!resource_downloads::needs_game_match(kind) || v["game_versions"].as_array().is_some_and(|a|a.iter().any(|x|x==game))) && (kind!="mods" || v["loaders"].as_array().is_some_and(|a|a.iter().any(|x|x==loader))));
   row["compatible"]=json!(compatible);Some(row)
  }).collect::<Vec<_>>();json!(rows)
 };
 if paged{Ok(json!({"versions":data,"nextOffset":next_offset,"total":total}))}else{Ok(data)}
}
pub fn mode(core:&Core,p:&Value)->Result<Value>{let path=core.instance(string(p,"id")?)?.join("kxl.json");let mut v=read_json(&path)?;
 if let Some(mode)=p["mode"].as_str(){if !["auto","manual"].contains(&mode){return Err("更新方式无效".into());}v["modUpdateMode"]=json!(mode);write_json(&path,&v)?;}
 Ok(json!({"mode":v["modUpdateMode"].as_str().unwrap_or("manual")}))
}
pub async fn check(core:&Core,p:&Value)->Result<Value>{crate::mod_check::check(core,p).await}
// Copy all regular mod files and the lock before touching an installation. A
// failed/cancelled batch restores the exact prior set; successful backups stay.
fn snapshot(dir:&Path,backup:&Path)->Result<()>{std::fs::create_dir_all(backup).map_err(err)?;if dir.exists(){for e in std::fs::read_dir(dir).map_err(err)?.flatten(){if e.file_type().map_err(err)?.is_file(){std::fs::copy(e.path(),backup.join(e.file_name())).map_err(err)?;}}}Ok(())}
fn restore(dir:&Path,backup:&Path)->Result<()>{std::fs::create_dir_all(dir).map_err(err)?;for e in std::fs::read_dir(dir).map_err(err)?.flatten(){if e.file_type().map_err(err)?.is_file(){std::fs::remove_file(e.path()).map_err(err)?;}}snapshot(backup,dir)}
// 更新禁用模组后保持禁用：删掉旧的 .disabled 文件，再给新文件补上后缀。
// 安装记录仍保存干净文件名，资源列表按去掉后缀的名字取图标。
fn keep_disabled(dir:&Path,lock_path:&Path,key:&str,old:&str)->Result<()>{
 if !old.ends_with(".disabled"){return Ok(());}
 let lock=read_json(lock_path).unwrap_or_else(|_|json!({}));
 let Some(name)=lock[key]["file"].as_str().map(str::to_string) else{return Ok(())};
 if name.ends_with(".disabled"){return Ok(());}
 let fresh=dir.join(&name);if !fresh.exists(){return Ok(());}
 let stale=dir.join(old);
 if old!=name && stale.exists(){std::fs::remove_file(&stale).map_err(err)?;}
 let target=dir.join(format!("{name}.disabled"));
 if target.exists(){std::fs::remove_file(&target).map_err(err)?;}
 std::fs::rename(&fresh,&target).map_err(err)?;
 Ok(())
}
pub async fn apply(core:&Core,p:&Value)->Result<Value>{
 let mut fresh=p.clone();fresh["force"]=json!(true);let rows=check(core,&fresh).await?;let chosen=p["files"].as_array();
 if let Some(files)=chosen{if files.iter().any(|f|!rows.as_array().unwrap().iter().any(|r|&r["file"]==f)){return Err("所选模组已变化，请等待自动检测完成后再试".into());}}
 if rows.as_array().unwrap().iter().any(|r|chosen.is_none_or(|a|a.contains(&r["file"])) && (r["status"]=="error" || (chosen.is_some() && r["status"]=="unknown"))){return Err("模组更新信息未能确认，请检查网络并等待自动重试".into());}
 let updates:Vec<_>=rows.as_array().unwrap().iter().filter(|r|r["status"]=="update" && chosen.is_none_or(|a|a.contains(&r["file"]))).collect();
 if updates.is_empty(){return Ok(json!({"updated":0}));}
 let id=string(p,"id")?;let instance=core.instance(id)?;let dir=engine::resource_dir(core,&json!({"id":id,"kind":"mods"}))?;
 let guard=core.jobs.file_lock(&dir);let _lock=guard.lock().await;
 let backup=instance.join("mod-backups").join(uuid::Uuid::new_v4().to_string());snapshot(&dir,&backup.join("mods"))?;
 let lock_path=instance.join("installed-projects.json");let old_lock=std::fs::read(&lock_path).ok();
 if let Some(data)=&old_lock{std::fs::write(backup.join("installed-projects.json"),data).map_err(err)?;}
 let result=async {for r in &updates {core.stopped()?;let mut lock=read_json(&lock_path).unwrap_or_else(|_|json!({}));let pid=r["project"].as_str().map(str::to_string).unwrap_or_else(||r["project"].to_string());let key=if r["source"]=="curseforge"{format!("cf-{pid}")}else{pid};
 // An earlier project may already have upgraded this required dependency.
 let recorded=lock[&key]["version"].as_str().map(str::to_string).unwrap_or_else(||lock[&key]["version"].to_string());
 if recorded==r["versionId"].as_str().unwrap_or("") {if let Some(name)=lock[&key]["file"].as_str(){let path=dir.join(safe_name(name)?);if std::fs::read(path).ok().is_some_and(|bytes|format!("{:x}",Sha1::digest(bytes))==lock[&key]["sha1"].as_str().unwrap_or("")){continue;}}}
 let old=dir.join(safe_name(string(r,"file")?)?);if format!("{:x}",Sha1::digest(std::fs::read(&old).map_err(err)?))!=r["sha1"].as_str().unwrap_or(""){return Err("检测后模组已变化，请重新检测".into());}
 lock[&key]=json!({"file":r["file"],"sha1":r["sha1"],"version":r["currentId"]});write_json(&lock_path,&lock)?;
 let payload=json!({"id":id,"project":r["project"],"versionId":r["versionId"],"kind":"mods","curseforgeKey":p["curseforgeKey"]});
 if r["source"]=="curseforge"{curseforge::install_project(core,&payload).await?;}else{engine::install_project(core,&payload).await?;}
 keep_disabled(&dir,&lock_path,&key,r["file"].as_str().unwrap_or(""))?;
 }Ok::<_,String>(())}.await;
 if let Err(error)=result{restore(&dir,&backup.join("mods")).map_err(|e|format!("{error}；自动恢复失败：{e}。备份：{}",backup.display()))?;match old_lock{Some(data)=>std::fs::write(&lock_path,data).map_err(err)?,None=>{if lock_path.exists(){std::fs::remove_file(&lock_path).map_err(err)?;}}}return Err(format!("{error}；已恢复更新前的模组"));}
 Ok(json!({"updated":updates.len(),"backup":backup}))
}
#[cfg(test)]mod tests{use super::*;#[test]fn failed_batch_restores_files(){let t=tempfile::tempdir().unwrap();let dir=t.path().join("mods");std::fs::create_dir(&dir).unwrap();std::fs::write(dir.join("old.jar"),b"old").unwrap();let back=t.path().join("backup");snapshot(&dir,&back).unwrap();std::fs::remove_file(dir.join("old.jar")).unwrap();std::fs::write(dir.join("new.jar"),b"new").unwrap();restore(&dir,&back).unwrap();assert_eq!(std::fs::read(dir.join("old.jar")).unwrap(),b"old");assert!(!dir.join("new.jar").exists());}
#[test]fn disabled_update_stays_disabled(){let t=tempfile::tempdir().unwrap();let dir=t.path().join("mods");std::fs::create_dir(&dir).unwrap();std::fs::write(dir.join("old.jar.disabled"),b"old").unwrap();std::fs::write(dir.join("new.jar"),b"new").unwrap();let lock=t.path().join("installed-projects.json");write_json(&lock,&json!({"cf-1":{"file":"new.jar"}})).unwrap();keep_disabled(&dir,&lock,"cf-1","old.jar.disabled").unwrap();assert!(!dir.join("old.jar.disabled").exists());assert!(dir.join("new.jar.disabled").exists());assert!(!dir.join("new.jar").exists());}
#[test]fn same_name_disabled_update_stays_disabled(){let t=tempfile::tempdir().unwrap();let dir=t.path().join("mods");std::fs::create_dir(&dir).unwrap();std::fs::write(dir.join("same.jar.disabled"),b"old").unwrap();std::fs::write(dir.join("same.jar"),b"new").unwrap();let lock=t.path().join("installed-projects.json");write_json(&lock,&json!({"p":{"file":"same.jar"}})).unwrap();keep_disabled(&dir,&lock,"p","same.jar.disabled").unwrap();assert!(dir.join("same.jar.disabled").exists());assert!(!dir.join("same.jar").exists());}
#[test]fn enabled_update_is_untouched(){let t=tempfile::tempdir().unwrap();let dir=t.path().join("mods");std::fs::create_dir(&dir).unwrap();std::fs::write(dir.join("new.jar"),b"new").unwrap();let lock=t.path().join("installed-projects.json");write_json(&lock,&json!({"p":{"file":"new.jar"}})).unwrap();keep_disabled(&dir,&lock,"p","old.jar").unwrap();assert!(dir.join("new.jar").exists());assert!(!dir.join("new.jar.disabled").exists());}}

#[cfg(test)] mod all_versions_tests {
 use super::*;
 #[test] fn modrinth_channels_and_incompatible_versions_remain_selectable(){
  for channel in ["release","beta","alpha"] {
   let v=json!({"id":channel,"version_type":channel,"game_versions":["1.20.1"],"loaders":["fabric"]});
   let row=modrinth_row(&v,"1.20.1","fabric");assert_eq!(row["type"],channel);assert_eq!(row["compatible"],true);
   let other=modrinth_row(&v,"1.21.1","forge");assert_eq!(other["id"],channel);assert_eq!(other["compatible"],false);assert_eq!(other["gameVersions"],json!(["1.20.1"]));
  }
 }
 #[test] fn curseforge_all_channels_and_game_loader_labels(){
  for (number,channel) in [(1,"release"),(2,"beta"),(3,"alpha")] {
   let v=json!({"id":123,"releaseType":number,"gameVersions":["1.20.1","Fabric"]});
   let row=curseforge_row(&v,"1.20.1","fabric");assert_eq!(row["type"],channel);assert_eq!(row["loaders"],json!(["fabric"]));assert_eq!(row["gameVersions"],json!(["1.20.1"]));assert_eq!(row["compatible"],true);
   assert_eq!(curseforge_row(&v,"1.20.1","forge")["compatible"],false);
  }
 }
}
