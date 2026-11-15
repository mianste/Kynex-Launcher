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
fn saved_world(root: &Path, name: &str) -> Result<PathBuf> {
    if !resource_delete::valid_name(name) {
        return Err("存档文件夹名称无效".into());
    }
    let path = root.join(name).canonicalize().map_err(|_| "所选存档不存在，请刷新存档列表")?;
    if path.parent() != Some(root)
        || !["level.dat", "level.dat_old"].iter().any(|file| path.join(file).is_file()) {
        return Err("请选择此实例中的 Minecraft 存档".into());
    }
    Ok(path)
}
fn saves_dir(core: &Core, p: &Value) -> Result<PathBuf> {
    engine::resource_dir(core, &json!({"id":p["id"],"kind":"saves"}))
}
fn world_dir(core: &Core, p: &Value) -> Result<PathBuf> {
    let name = p["world"].as_str().filter(|name| !name.is_empty()).ok_or("请先选择要安装到的存档")?;
    let root = saves_dir(core, p)?.canonicalize().map_err(|_| "实例中没有存档，请先创建或导入世界")?;
    saved_world(&root, name)
}
pub fn worlds(core: &Core, p: &Value) -> Result<Value> {
    if !p["id"].as_str().is_some_and(|s| !s.is_empty()) {
        return Ok(json!([]));
    }
    let dir = match saves_dir(core, p)?.canonicalize() {
        Ok(dir) => dir,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(json!([])),
        Err(error) => return Err(err(error)),
    };
    let mut names: Vec<_> = std::fs::read_dir(&dir).map_err(err)?.flatten()
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| saved_world(&dir, name).is_ok())
        .collect();
    names.sort();
    Ok(json!(names.into_iter().map(|name| json!({"name": name})).collect::<Vec<_>>()))
}
pub(crate) fn install_dir(core:&Core,p:&Value)->Result<PathBuf>{
 if p["kind"]!="datapacks"{return engine::resource_dir(core,p);}
 let world=world_dir(core,p)?;let dir=world.join("datapacks");
 match std::fs::symlink_metadata(&dir) {
     Ok(meta) if !meta.is_dir() || resource_delete::is_link(&meta) => Err("存档的数据包路径必须是此存档中的文件夹".into()),
     Ok(_) => Ok(dir),
     Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(dir),
     Err(error) => Err(err(error)),
 }
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
 #[test]
 fn custom_save_directory_accepts_long_names_and_backup_level_metadata() {
     let temp = tempfile::tempdir().unwrap();
     let core = Core::new(temp.path().join("launcher"), Arc::new(|_| {})).unwrap();
     let game = temp.path().join("custom-game");
     write_json(&core.instance("a").unwrap().join("kxl.json"), &json!({
         "settings":{"isolation":"custom","gameDirectory": game}
     })).unwrap();
     let name = "长存档".repeat(20);
     let world = game.join("saves").join(&name);
     std::fs::create_dir_all(&world).unwrap();
     std::fs::write(world.join("level.dat_old"), b"saved level").unwrap();
     std::fs::create_dir_all(game.join("saves").join("incomplete")).unwrap();
     let payload = json!({"id":"a","kind":"datapacks","world":name});
     assert_eq!(worlds(&core, &payload).unwrap(), json!([{"name":name}]));
     assert_eq!(install_dir(&core, &payload).unwrap(), world.canonicalize().unwrap().join("datapacks"));
 }
 #[test]fn game_match_is_strict_only_for_mods_and_data(){assert!(needs_game_match("mods"));assert!(needs_game_match("datapacks"));assert!(!needs_game_match("resourcepacks"));assert!(!needs_game_match("shaderpacks"));}
 #[test]fn data_pack_selects_zip_and_not_a_primary_mod_jar(){let v=json!({"loaders":["fabric","datapack"],"files":[{"filename":"thing.jar","primary":true},{"filename":"thing.zip","primary":false}]});assert_eq!(modrinth_file(&v,"datapacks").unwrap()["filename"],"thing.zip");assert_eq!(modrinth_file(&v,"mods").unwrap()["filename"],"thing.jar");assert!(modrinth_file(&json!({"loaders":["fabric"],"files":[{"filename":"x.zip"}]}),"datapacks").is_err());}
 #[test]fn data_pack_target_is_a_real_world_and_has_an_independent_lock(){let t=tempfile::tempdir().unwrap();let c=Core::new(t.path().into(),Arc::new(|_|{})).unwrap();write_json(&c.instance("a").unwrap().join("kxl.json"),&json!({"loader":"vanilla","settings":{"isolation":"all"}})).unwrap();let world=c.instance("a").unwrap().join("saves/World");std::fs::create_dir_all(&world).unwrap();std::fs::write(world.join("level.dat"),b"fixture").unwrap();let p=json!({"id":"a","kind":"datapacks","world":"World"});assert_eq!(install_dir(&c,&p).unwrap(),world.canonicalize().unwrap().join("datapacks"));assert_eq!(worlds(&c,&p).unwrap()[0]["name"],"World");assert!(install_dir(&c,&json!({"id":"a","kind":"datapacks","world":"../x"})).is_err());assert!(install_dir(&c,&json!({"id":"a","kind":"datapacks"})).is_err());assert_eq!(lock_path(&c,&p).unwrap(),world.canonicalize().unwrap().join("kxl-datapacks.json"));}
}
