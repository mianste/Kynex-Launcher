use crate::*;
use sha1::{Digest, Sha1};

fn config_path(core: &Core) -> PathBuf { core.data_root.join("game-directories.json") }
fn config(core: &Core) -> Value {
    let mut value = read_json(&config_path(core)).unwrap_or_else(|_| json!({"activeId":"default","items":[]}));
    if !value["items"].is_array() { value["items"] = json!([]); }
    value["items"].as_array_mut().unwrap().retain(|item| item["id"] != "default");
    value["items"].as_array_mut().unwrap().insert(0,json!({"id":"default","name":"默认目录","path":core.data_root}));
    if !value["items"].as_array().unwrap().iter().any(|item|item["id"]==value["activeId"]) {value["activeId"]=json!("default");}
    value
}
fn persist(core: &Core, value: &Value) -> Result<()> {
    let target = config_path(core);
    let temp = target.with_extension(format!("{}.tmp",uuid::Uuid::new_v4()));
    write_json(&temp,value)?;
    let result = std::fs::rename(&temp,&target).map_err(err);
    if result.is_err() { let _=std::fs::remove_file(temp); }
    result
}
pub fn path(raw: &str) -> Result<PathBuf> {
    let path=PathBuf::from(raw.trim());
    if !path.is_absolute() || path.parent().is_none() || path.components().any(|c| matches!(c,std::path::Component::ParentDir)) {
        return Err("请选择完整的文件夹路径，不能使用磁盘根目录或上级目录符号".into());
    }
    if raw.contains(if cfg!(windows) {';'} else {':'}) {return Err("路径中不能包含 Java 路径分隔符".into());}
    Ok(path)
}
pub fn writable(raw: &str) -> Result<PathBuf> {
    let path=path(raw)?;
    std::fs::create_dir_all(&path).map_err(|e|format!("无法创建游戏目录：{e}"))?;
    let probe=path.join(format!(".kxl-write-{}",uuid::Uuid::new_v4()));
    std::fs::OpenOptions::new().write(true).create_new(true).open(&probe).map_err(|e|format!("此目录不能写入：{e}"))?;
    std::fs::remove_file(probe).map_err(err)?;
    // Keep the ordinary Windows spelling rather than a \\?\ path in Java arguments.
    Ok(path)
}
fn same(a: &Path, b: &Path) -> bool {
    let a=a.canonicalize().unwrap_or_else(|_|a.into()).to_string_lossy().into_owned();
    let b=b.canonicalize().unwrap_or_else(|_|b.into()).to_string_lossy().into_owned();
    if cfg!(windows) {a.eq_ignore_ascii_case(&b)} else {a==b}
}
pub fn list(core: &Core) -> Result<Value> {
    let mut value=config(core);
    for entry in value["items"].as_array_mut().unwrap() {
        entry["available"]=json!(Path::new(entry["path"].as_str().unwrap_or("")).is_dir());
    }
    Ok(value)
}
pub async fn change(core: &Core, action: &str, p: &Value) -> Result<Value> {
    let lock=core.jobs.file_lock(&config_path(core)); let _guard=lock.lock().await;
    let mut value=config(core);
    match action {
        "add_game_directory" => {
            let mut folder=path(string(p,"path")?)?;
            if !folder.join("versions").is_dir() && !folder.join("instances").is_dir() && folder.join(".minecraft").is_dir() { folder=folder.join(".minecraft"); }
            folder=writable(&folder.to_string_lossy())?;
            let existing=value["items"].as_array().unwrap().iter().find(|item|same(Path::new(item["path"].as_str().unwrap_or("")),&folder)).map(|item|item["id"].clone());
            let id=existing.unwrap_or_else(||json!(uuid::Uuid::new_v4().to_string()));
            if !value["items"].as_array().unwrap().iter().any(|item|item["id"]==id) {
                let name=p["name"].as_str().map(str::trim).filter(|s|!s.is_empty()).map(str::to_owned).unwrap_or_else(||folder.file_name().unwrap_or_default().to_string_lossy().into_owned());
                if name.chars().count()>60 {return Err("目录名称不能超过 60 个字".into());}
                value["items"].as_array_mut().unwrap().push(json!({"id":id,"name":name,"path":folder}));
            }
            value["activeId"]=id;
        },
        "select_game_directory" => {
            let id=string(p,"directoryId")?;
            let entry=value["items"].as_array().unwrap().iter().find(|item|item["id"]==id).ok_or("游戏目录未添加")?;
            if !Path::new(string(entry,"path")?).is_dir() {return Err("游戏目录不存在，请连接磁盘或重新选择目录".into());}
            value["activeId"]=json!(id);
        },
        "remove_game_directory" => {
            let id=string(p,"directoryId")?;
            if id=="default" {return Err("默认目录不能移除".into());}
            value["items"].as_array_mut().unwrap().retain(|item|item["id"]!=id);
            if value["activeId"]==id {value["activeId"]=json!("default");}
        },
        _=>return Err("目录操作无效".into()),
    }
    persist(core,&value)?;
    list(core)
}
pub fn context(core: &Core, p: &Value) -> Result<Core> {
    let cfg=config(core);
    let id=p["directoryId"].as_str().unwrap_or(cfg["activeId"].as_str().unwrap_or("default"));
    let entry=cfg["items"].as_array().unwrap().iter().find(|item|item["id"]==id).ok_or("游戏目录未添加，请重新选择")?;
    let root=PathBuf::from(string(entry,"path")?);
    if !root.is_dir() {return Err("游戏目录不存在，请连接磁盘或选择其他目录".into());}
    let id=id.to_owned();let progress=core.progress.clone();
    Ok(Core{root,progress:Arc::new(move|mut event|{event["directoryId"]=json!(id);progress(event);}),..core.clone()})
}
pub fn game_action(action: &str) -> bool {
    matches!(action,"list_instances"|"hydrate_pack_icons"|"install"|"launch"|"import_pack"|"install_project"|"install_java"|"download_resource_file"|"update_mods"|"export_pack"|"export_options"|"save_instance"|"save_instance_icon"|"delete_instance"|"project_versions"|"resource_requirements"|"datapack_worlds"|"check_mod_updates"|"scan_installed_mod_updates"|"mod_update_mode"|"resources"|"delete_resources"|"toggle_resource"|"resource_move"|"import_resource"|"import_resource_paths"|"ensure_loader_components"|"open_folder"|"open_resource_folder"|"java")
}

pub fn running_directory(core: &Core, instance: &Value) -> Result<PathBuf> {
    if instance["settings"]["isolation"]=="custom" {return path(string(&instance["settings"],"gameDirectory")?);}
    if instance["settings"]["isolation"]=="shared" || (instance["settings"]["isolation"]=="modded" && instance["loader"]=="vanilla") {
        return Ok(if same(&core.root,&core.data_root) {core.root.join("shared")} else {core.root.clone()});
    }
    core.instance(string(instance,"id")?)
}

fn resolve(root: &Path, id: &str, seen: &mut Vec<String>) -> Result<(Value,String,Option<PathBuf>)> {
    safe_name(id)?;
    if seen.len()>=16 || seen.iter().any(|s|s==id) {return Err("版本继承关系循环或层数过多".into());}
    seen.push(id.into());
    let dir=root.join("versions").join(id);
    let canonical=dir.canonicalize().map_err(err)?;
    if !canonical.starts_with(root.canonicalize().map_err(err)?) {return Err("版本文件夹超出所选游戏目录".into());}
    let overlay=read_json(&dir.join(format!("{id}.json")))?;
    let local_jar=dir.join(format!("{id}.jar"));
    if let Some(parent)=overlay["inheritsFrom"].as_str() {
        let (base,game,client)=resolve(root,parent,seen)?;
        Ok((engine::merge(base,overlay),game,if local_jar.is_file(){Some(local_jar)}else{client}))
    } else {
        let game=overlay["clientVersion"].as_str().or(overlay["id"].as_str()).unwrap_or(id).to_string();
        Ok((overlay,game,local_jar.is_file().then_some(local_jar)))
    }
}
fn loader(version: &Value) -> (&'static str,String) {
    for lib in version["libraries"].as_array().into_iter().flatten() {
        let name=lib["name"].as_str().unwrap_or("");
        for (prefix,kind) in [("net.neoforged:neoforge:","neoforge"),("net.minecraftforge:forge:","forge"),("net.minecraftforge:fmlloader:","forge"),("net.fabricmc:fabric-loader:","fabric"),("org.quiltmc:quilt-loader:","quilt"),("optifine:OptiFine:","optifine")] {
            if let Some(v)=name.strip_prefix(prefix) {return (kind,if kind=="forge"{v.split_once('-').map(|(_,v)|v).unwrap_or(v).into()}else{v.into()});}
        }
    }
    ("vanilla",String::new())
}
fn existing_running_directory(root: &Path, version: &Path) -> PathBuf {
    if let Ok(settings)=read_json(&version.join("hmclversion.cfg")) {
        if let Some(raw)=settings["runningDirectory"].as_str().filter(|p|!p.is_empty()).or_else(||(settings["gameDirType"]=="CUSTOM" || settings["gameDirType"]==2).then(||settings["gameDir"].as_str()).flatten()) {
            if let Ok(dir)=path(raw) {return dir;}
        }
        if settings["gameDirType"]=="ROOT_FOLDER" || settings["gameDirType"]==0 {return root.into();}
        if settings["gameDirType"]=="VERSION_FOLDER" || settings["gameDirType"]==1 {return version.into();}
    }
    if ["mods","saves","resourcepacks","options.txt"].iter().any(|p|version.join(p).exists()) {version.into()}else{root.into()}
}
pub fn discover(core: &Core) -> Result<()> {
    let versions=core.root.join("versions");
    if !versions.is_dir() {return Ok(());}
    let ignored=read_json(&core.root.join(".kxl-hidden-versions.json")).unwrap_or_else(|_|json!([]));
    for item in std::fs::read_dir(&versions).map_err(err)?.flatten() {
        if !item.path().is_dir() || item.path().join(".kxl-internal").exists() {continue;}
        let name=item.file_name().to_string_lossy().into_owned();
        if ignored.as_array().is_some_and(|v|v.iter().any(|s|s==&name)) {continue;}
        // Our default directory also holds internal loader outputs, not user instances.
        if same(&core.root,&core.data_root) {continue;}
        let Ok((version,game,client))=resolve(&core.root,&name,&mut vec![]) else {continue};
        if !version["mainClass"].is_string() {continue;}
        let id=format!("external-{:x}",Sha1::digest(format!("{}\0{name}",core.root.display()).as_bytes()));
        let dir=core.instance(&id)?;
        let config_path=dir.join("kxl.json");
        if !config_path.exists() {
            let (kind,loader_version)=loader(&version);
            let game_dir=existing_running_directory(&core.root,&item.path());
            let mut settings=engine::defaults();settings["isolation"]=json!("custom");settings["gameDirectory"]=json!(game_dir);
            write_json(&config_path,&json!({"id":id,"name":name,"version":game,"loader":kind,"loaderVersion":loader_version,"game":"java","path":dir,"settings":settings,"externalVersion":name,"externalSource":item.path(),"externalClient":client}))?;
        }
        if read_json(&dir.join("version.json")).ok().as_ref()!=Some(&version) {write_json(&dir.join("version.json"),&version)?;}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn core(root:&Path)->Core {Core::new(root.into(),Arc::new(|_|{})).unwrap()}
    #[tokio::test]
    async fn directories_persist_deduplicate_snapshot_and_remove_without_deleting_files() {
        let temp=tempfile::tempdir().unwrap();let data=temp.path().join("app");let core=core(&data);
        let folder=temp.path().join("游戏 路径");
        let added=change(&core,"add_game_directory",&json!({"path":folder,"name":"生存"})).await.unwrap();
        let id=added["activeId"].as_str().unwrap();
        let snapshot=context(&core,&json!({"directoryId":id})).unwrap();
        assert_eq!(snapshot.root,folder);assert_eq!(snapshot.data_root,data);
        let again=change(&core,"add_game_directory",&json!({"path":folder})).await.unwrap();assert_eq!(again["items"].as_array().unwrap().len(),2);
        assert_eq!(list(&super::tests::core(&data)).unwrap()["activeId"],id);
        std::fs::write(folder.join("keep.txt"),b"keep").unwrap();
        change(&core,"select_game_directory",&json!({"directoryId":"default"})).await.unwrap();
        assert_eq!(snapshot.root,folder);assert_eq!(context(&core,&json!({})).unwrap().root,data);
        change(&core,"remove_game_directory",&json!({"directoryId":id})).await.unwrap();
        assert!(folder.join("keep.txt").is_file());assert!(context(&core,&json!({"directoryId":id})).is_err());
    }
    #[tokio::test]
    async fn custom_resources_worlds_exports_and_accounts_use_the_correct_locations() {
        let temp=tempfile::tempdir().unwrap();let c=core(&temp.path().join("data"));
        let game=temp.path().join("Minecraft");let run=temp.path().join("自定义 运行目录");
        let result=change(&c,"add_game_directory",&json!({"path":game})).await.unwrap();let id=&result["activeId"];
        let context=context(&c,&json!({"directoryId":id})).unwrap();
        write_json(&context.instance("one").unwrap().join("kxl.json"),&json!({"id":"one","loader":"fabric","settings":{"isolation":"all"}})).unwrap();
        c.dispatch("save_instance",json!({"directoryId":id,"id":"one","settings":{"isolation":"custom","gameDirectory":run}})).await.unwrap();
        std::fs::create_dir_all(run.join("saves/World")).unwrap();std::fs::write(run.join("saves/World/level.dat"),b"world").unwrap();
        for kind in ["mods","resourcepacks","shaderpacks","saves"] {assert_eq!(engine::resource_dir(&context,&json!({"id":"one","kind":kind})).unwrap(),run.join(kind));}
        assert_eq!(crate::resource_downloads::worlds(&context,&json!({"id":"one"})).unwrap()[0]["name"],"World");
        let config=read_json(&context.instance("one").unwrap().join("kxl.json")).unwrap();assert_eq!(running_directory(&context,&config).unwrap(),run);
        auth::offline(&context,"Player").unwrap();assert!(c.data_root.join("accounts.json").is_file());assert!(!game.join("accounts.json").exists());
        assert_eq!(auth::list(&c).unwrap(),auth::list(&context).unwrap());
        assert!(!c.instance("one").unwrap().exists());
    }
    #[tokio::test]
    async fn discovers_inherited_standard_versions_and_preserves_originals_and_user_settings() {
        let temp=tempfile::tempdir().unwrap();let c=core(&temp.path().join("app"));let root=temp.path().join(".minecraft");
        let base=json!({"id":"1.20.1","mainClass":"net.minecraft.client.main.Main","libraries":[],"downloads":{"client":{"url":"https://example.invalid/client.jar","sha1":"a".repeat(40)}}});
        let overlay=json!({"id":"My Fabric","inheritsFrom":"1.20.1","libraries":[{"name":"net.fabricmc:fabric-loader:0.16.14"}],"mainClass":"net.fabricmc.loader.Main"});
        write_json(&root.join("versions/1.20.1/1.20.1.json"),&base).unwrap();
        write_json(&root.join("versions/My Fabric/My Fabric.json"),&overlay).unwrap();
        std::fs::create_dir_all(root.join("versions/My Fabric/mods")).unwrap();
        write_json(&root.join("versions/broken/broken.json"),&json!({"inheritsFrom":"broken"})).unwrap();
        let added=change(&c,"add_game_directory",&json!({"path":root})).await.unwrap();let selected=context(&c,&json!({"directoryId":added["activeId"]})).unwrap();
        let list=selected.instances().unwrap();assert_eq!(list.as_array().unwrap().len(),2);
        let found=list.as_array().unwrap().iter().find(|v|v["name"]=="My Fabric").unwrap();
        assert_eq!(found["loader"],"fabric");assert_eq!(found["version"],"1.20.1");assert_eq!(PathBuf::from(found["settings"]["gameDirectory"].as_str().unwrap()),root.join("versions").join("My Fabric"));
        let file=selected.instance(found["id"].as_str().unwrap()).unwrap().join("kxl.json");let mut settings=read_json(&file).unwrap();settings["settings"]["memory"]=json!(8192);write_json(&file,&settings).unwrap();
        selected.instances().unwrap();assert_eq!(read_json(&file).unwrap()["settings"]["memory"],8192);assert_eq!(read_json(&root.join("versions/My Fabric/My Fabric.json")).unwrap(),overlay);
        selected.dispatch_at("delete_instance",json!({"id":found["id"]})).await.unwrap();assert!(root.join("versions/My Fabric/My Fabric.json").is_file());assert_eq!(selected.instances().unwrap().as_array().unwrap().len(),1);
    }
    #[test]
    fn invalid_paths_and_missing_disks_do_not_redirect_operations() {
        for raw in ["", "relative", "../escape"] {assert!(path(raw).is_err());}
        let temp=tempfile::tempdir().unwrap();let c=core(temp.path());
        assert!(context(&c,&json!({"directoryId":"unknown"})).is_err());
        assert!(writable(&temp.path().join("../escape").to_string_lossy()).is_err());
    }
}
pub fn hide_external(core: &Core, config: &Value) -> Result<()> {
    if let Some(name)=config["externalVersion"].as_str() {
        let path=core.root.join(".kxl-hidden-versions.json");
        let mut hidden=read_json(&path).unwrap_or_else(|_|json!([]));
        if !hidden.is_array() {hidden=json!([]);}
        if !hidden.as_array().unwrap().iter().any(|v|v==name) {hidden.as_array_mut().unwrap().push(json!(name));}
        write_json(&path,&hidden)?;
    }
    Ok(())
}
