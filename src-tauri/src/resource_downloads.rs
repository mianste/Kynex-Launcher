use crate::*;
pub(crate) fn needs_game_match(kind:&str)->bool{matches!(kind,"mods"|"datapacks")}
pub(crate) fn extension_matches(name:&str,kind:&str)->bool{
 let name=name.to_ascii_lowercase();match kind{"mods"=>name.ends_with(".jar")||name.ends_with(".litemod"),"modpacks"=>name.ends_with(".mrpack")||name.ends_with(".zip"),"resourcepacks"|"shaderpacks"|"datapacks"=>name.ends_with(".zip"),_=>false}
}
pub(crate) fn modrinth_file<'a>(version:&'a Value,kind:&str)->Result<&'a Value>{
 if kind=="datapacks" && !version["loaders"].as_array().is_some_and(|a|a.iter().any(|v|v=="datapack")){return Err("此发行版不是数据包".into());}
 let files=version["files"].as_array().ok_or("资源没有文件")?;
 let eligible=|f:&&Value|f["filename"].as_str().is_some_and(|n|extension_matches(n,kind) && (kind!="modpacks" || n.to_lowercase().ends_with(".mrpack")));
 files.iter().filter(eligible).find(|f|f["primary"]==true).or_else(||files.iter().find(eligible)).ok_or("此发行版没有对应类型的可下载文件".into())
}
fn world_dir(core:&Core,p:&Value)->Result<PathBuf>{
 let root=engine::resource_dir(core,&json!({"id":p["id"],"kind":"saves"}))?;
 let world=safe_name(string(p,"world")?)?;let path=root.join(world);
 let root=root.canonicalize().map_err(|_|"实例中没有存档，请先创建或导入世界")?;
 let path=path.canonicalize().map_err(|_|"所选存档不存在")?;
 if !path.starts_with(&root)||!path.join("level.dat").is_file(){return Err("请选择此实例中的 Minecraft 存档".into());}Ok(path)
}
pub fn worlds(core:&Core,p:&Value)->Result<Value>{
 if !p["id"].as_str().is_some_and(|s|!s.is_empty()){return Ok(json!([]));}
 let dir=engine::resource_dir(core,&json!({"id":p["id"],"kind":"saves"}))?;
 if !dir.exists(){return Ok(json!([]));}let mut rows=Vec::new();
 for e in std::fs::read_dir(dir).map_err(err)?.flatten(){let name=e.file_name().to_string_lossy().to_string();if safe_name(&name).is_ok() && world_dir(core,&json!({"id":p["id"],"world":name})).is_ok(){rows.push(json!({"name":name}));}}
 rows.sort_by_key(|v|v["name"].as_str().unwrap_or("").to_owned());Ok(json!(rows))
}
pub(crate) fn install_dir(core:&Core,p:&Value)->Result<PathBuf>{
 if p["kind"]!="datapacks"{return engine::resource_dir(core,p);}
 let world=world_dir(core,p)?;let dir=world.join("datapacks");
 if dir.exists()&&!dir.canonicalize().map_err(err)?.starts_with(&world){return Err("数据包目录不能指向存档以外的位置".into());}Ok(dir)
}
pub(crate) fn lock_path(core:&Core,p:&Value)->Result<PathBuf>{
 if p["kind"]=="datapacks"{Ok(world_dir(core,p)?.join("kxl-datapacks.json"))}else{Ok(core.instance(string(p,"id")?)?.join("installed-projects.json"))}
}
pub async fn save(core:&Core,p:&Value)->Result<Value>{
 let kind=string(p,"kind")?;let vid=string(p,"versionId")?;
 let (url,hash,name)=if p["source"]=="curseforge"{
  let project=p["project"].as_u64().or_else(||p["project"].as_str()?.parse().ok()).ok_or("项目 ID 无效")?;
  let key=curseforge::configured_key(core,p["curseforgeKey"].as_str().unwrap_or(""));let file=curseforge::file_by_id(core,project,vid.parse().map_err(|_|"文件 ID 无效")?,key.as_deref()).await?;
  if file["modId"].as_u64()!=Some(project)||file["isAvailable"]==false||file["isServerPack"]==true{return Err("所选文件不属于此项目或不可下载".into());}
  (curseforge::download_url(&file)?,curseforge::file_hash(&file),curseforge::file_name(&file)?.to_string())
 }else{
  safe_name(vid)?;let version=core.get(&format!("https://api.modrinth.com/v2/version/{vid}")).await?;
  if version["project_id"]!=p["project"]{return Err("所选版本不属于此项目".into());}
  let file=modrinth_file(&version,kind)?;
  (string(file,"url")?.to_owned(),string(&file["hashes"],"sha1")?.to_owned(),string(file,"filename")?.to_owned())
 };
 if !extension_matches(&name,kind)||![40,64].contains(&hash.len())||!hash.bytes().all(|c|c.is_ascii_hexdigit()){return Err("下载文件类型或校验信息无效".into());}
 let path=PathBuf::from(string(p,"path")?);if !path.is_absolute(){return Err("请选择完整的保存路径".into());}
 engine::download(core,&url,&path,&hash).await?;Ok(json!({"path":path,"filename":name}))
}
#[cfg(test)]mod tests{use super::*;
 #[test]fn game_match_is_strict_only_for_mods_and_data(){assert!(needs_game_match("mods"));assert!(needs_game_match("datapacks"));assert!(!needs_game_match("resourcepacks"));assert!(!needs_game_match("shaderpacks"));}
 #[test]fn data_pack_selects_zip_and_not_a_primary_mod_jar(){let v=json!({"loaders":["fabric","datapack"],"files":[{"filename":"thing.jar","primary":true},{"filename":"thing.zip","primary":false}]});assert_eq!(modrinth_file(&v,"datapacks").unwrap()["filename"],"thing.zip");assert_eq!(modrinth_file(&v,"mods").unwrap()["filename"],"thing.jar");assert!(modrinth_file(&json!({"loaders":["fabric"],"files":[{"filename":"x.zip"}]}),"datapacks").is_err());}
 #[test]fn data_pack_target_is_a_real_world_and_has_an_independent_lock(){let t=tempfile::tempdir().unwrap();let c=Core::new(t.path().into(),Arc::new(|_|{})).unwrap();write_json(&c.instance("a").unwrap().join("kxl.json"),&json!({"loader":"vanilla","settings":{"isolation":"all"}})).unwrap();let world=c.instance("a").unwrap().join("saves/World");std::fs::create_dir_all(&world).unwrap();std::fs::write(world.join("level.dat"),b"fixture").unwrap();let p=json!({"id":"a","kind":"datapacks","world":"World"});assert_eq!(install_dir(&c,&p).unwrap(),world.canonicalize().unwrap().join("datapacks"));assert_eq!(worlds(&c,&p).unwrap()[0]["name"],"World");assert!(install_dir(&c,&json!({"id":"a","kind":"datapacks","world":"../x"})).is_err());assert!(install_dir(&c,&json!({"id":"a","kind":"datapacks"})).is_err());assert_eq!(lock_path(&c,&p).unwrap(),world.canonicalize().unwrap().join("kxl-datapacks.json"));}
}
