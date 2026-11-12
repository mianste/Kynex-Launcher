use crate::*;
use super::plan::PackPlan;
fn options_path(root: &Path) -> Result<PathBuf> {
    let primary = super::policy::under(root, "options.txt")?;
    if primary.exists() { return Ok(primary); }
    let yosbr = super::policy::under(root, "config/yosbr/options.txt")?;
    Ok(if yosbr.is_file() { yosbr } else { primary })
}

pub(super) fn enabled_pack_names(root: &Path) -> Vec<String> {
    options_path(root).ok().and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| text.lines().find_map(|line| line.strip_prefix("resourcePacks:").and_then(|value| serde_json::from_str::<Vec<String>>(value).ok())))
        .unwrap_or_default().into_iter().map(|name| name.strip_prefix("file/").unwrap_or(&name).to_owned()).collect()
}

pub(super) fn set_pack_enabled(root: &Path, filename: &str, enabled: bool) -> Result<()> {
    safe_name(filename)?;
    let path = options_path(root)?;
    let previous = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(format!("无法读取游戏选项：{error}")),
    };
    let legacy = legacy_lang(root);
    let entry = format!("file/{filename}");
    let mut order = match previous.lines().find_map(|line| line.strip_prefix("resourcePacks:")) {
        Some(value) => serde_json::from_str::<Vec<String>>(value)
            .map_err(|_| "options.txt 中的资源包列表格式有误，请在游戏内重新保存资源包设置。")?,
        None if !enabled => return Ok(()),
        None if legacy => Vec::new(),
        None => vec!["vanilla".into()],
    };
    let original = order.clone();
    // Existing entries may refer to built-in packs supplied by mods.
    order.retain(|pack| pack != filename && pack != &entry);
    if enabled {
        let value = if legacy { filename.to_owned() } else { entry };
        if filename == "KXL-AI-Localization" {
            let position = order.iter().position(|pack| pack.strip_prefix("file/").unwrap_or(pack).starts_with("CFPA-")).unwrap_or(order.len());
            order.insert(position, value);
        } else { order.push(value); }
    }
    if order == original { return Ok(()); }
    let value = serde_json::to_string(&order).map_err(err)?;
    let newline = if previous.contains("\r\n") { "\r\n" } else { "\n" };
    let mut updated = String::new();
    let mut replaced = false;
    for line in previous.split_inclusive('\n') {
        if line.starts_with("resourcePacks:") {
            if !replaced {
                updated.push_str(&format!("resourcePacks:{value}{newline}"));
                replaced = true;
            }
        } else {
            updated.push_str(line);
        }
    }
    if !replaced {
        if !updated.is_empty() && !updated.ends_with('\n') { updated.push_str(newline); }
        updated.push_str(&format!("resourcePacks:{value}{newline}"));
    }
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    std::fs::write(&temporary, updated).map_err(err)?;
    if let Err(error) = std::fs::rename(&temporary, &path) {
        let _ = std::fs::remove_file(&temporary);
        return Err(format!("无法更新游戏资源包列表：{error}"));
    }
    Ok(())
}

pub(super) fn legacy_lang(root: &Path) -> bool {
    super::policy::under(root, "kxl.json").ok()
        .and_then(|path| read_json(&path).ok())
        .and_then(|value| game_options::minor_version(value["version"].as_str()?))
        .is_some_and(|minor| minor <= 12)
}

pub async fn install(core:&Core,id:&str,plan:&PackPlan)->Result<String>{
 let root=core.instance(id)?;game_options::apply_language(&root,&plan.minecraft,"zh_cn")?;
 if plan.localization.mode=="none"{return Ok("未安装额外汉化包；游戏语言已设为中文。".into());}
 if plan.localization.mode=="ai"{return Ok("游戏语言已设为中文。机器补译会产生模型费用，请在汉化面板查看覆盖率和估算后单独确认。".into());}
 let result=community(core,&root,&plan.minecraft,&plan.loader.kind).await;
 core.stopped()?;if let Some(policy)=&core.agent_policy{policy.check()?;}
 let mut detail=match result{Ok(v)=>v,Err(e)=>format!("汉化已跳过：{}。游戏语言已设为中文，可稍后重试。",ai_diagnose::redact(&e))};if plan.localization.mode=="both"{detail.push_str("机器补译会产生模型费用，请在汉化面板核对用量后单独确认。");}Ok(detail)
}
fn compatible(metadata:&Value,format:u64,loader:&str)->Result<()> {
 let pack=&metadata["pack"];let supported=&pack["supported_formats"];
 let range=if let Some(n)=supported.as_u64(){Some((n,n))}else if let Some(a)=supported.as_array(){a.first().and_then(Value::as_u64).zip(a.get(1).and_then(Value::as_u64))}else{supported["min_inclusive"].as_u64().zip(supported["max_inclusive"].as_u64())};
 if !range.map_or(pack["pack_format"].as_u64()==Some(format),|(a,b)|format>=a&&format<=b){return Err("社区汉化包格式不兼容当前客户端，已停止启用。".into());}
 let description=pack["description"].to_string().to_lowercase();if (description.contains("仅限")||description.contains("only"))&&((description.contains("forge")&&!["forge","neoforge"].contains(&loader))||(description.contains("fabric")&&loader!="fabric")){return Err("社区汉化包限定的加载器与当前实例不同，已停止启用。".into());}Ok(())
}
pub(super) async fn install_community(core: &Core, id: &str) -> Result<Value> {
    let root = super::tools::instance(core, &json!({"id":id}))?;
    let config = read_json(&root.join("kxl.json"))?;
    let version = string(&config, "version")?;
    let loader = string(&config, "loader")?;
    core.stage("下载并校验社区汉化", 0, 0);
    let note = community(core, &root, version, loader).await?;
    game_options::apply_language(&root, version, "zh_cn")?;
    Ok(json!({"enabled":true,"community":true,"note":note}))
}

async fn community(core:&Core,root:&Path,game:&str,loader:&str)->Result<String>{
 let custom=super::policy::under(&core.data_root,"localization-sources.json")?;
 let config:Value=if custom.exists(){read_json(&custom)?}else{serde_json::from_str(include_str!("../../../config/localization-sources.json")).map_err(err)?};
 let source=config["sources"].as_array().ok_or("汉化源配置无效")?.iter().find(|s|s["minecraft"].as_array().is_some_and(|a|a.iter().any(|v|v==game))&&s["loaders"].as_array().is_some_and(|a|a.iter().any(|v|v==loader))).ok_or("没有对应游戏版本与加载器的已核验汉化源")?;
 let (url,digest)=if let (Some(url),Some(hash))=(source["downloadUrl"].as_str(),source["sha256"].as_str()){(url.to_owned(),hash.to_owned())}else{
  let api=string(source,"releasesApi")?;super::policy::url(api)?;let data=core.get(api).await?;
  let releases=if data.is_array(){data.as_array().unwrap().iter().collect::<Vec<_>>()}else{vec![&data]};
  let asset=releases.iter().flat_map(|v|v["assets"].as_array().into_iter().flatten()).find(|v|v["name"]==source["assetName"]).ok_or("CFPA 当前发布中没有对应资源包")?;
  (string(asset,"browser_download_url")?.to_owned(),asset["digest"].as_str().and_then(|s|s.strip_prefix("sha256:")).ok_or("CFPA 未提供可核验 SHA-256，已跳过而非盲信下载")?.to_owned())
 };
 if digest.len()!=64||!digest.bytes().all(|b|b.is_ascii_hexdigit()){return Err("社区汉化哈希无效".into());}super::policy::url(&url)?;
 let target=super::policy::under(root,&format!("resourcepacks/CFPA-{game}-{loader}.zip"))?;engine::download(core,&url,&target,&digest).await?;
 let validation=(||{let mut zip=zip::ZipArchive::new(std::fs::File::open(&target).map_err(err)?).map_err(|_|"汉化文件不是合法资源包")?;let file=zip.by_name("pack.mcmeta").map_err(|_|"汉化包缺少 pack.mcmeta")?;if file.size()>65536{return Err("汉化包元数据过大".into());}let metadata:Value=serde_json::from_reader(file).map_err(|_|"汉化包元数据无效")?;compatible(&metadata,super::translation::pack_format(root)?,loader)})();
 if let Err(e)=validation{let _=std::fs::remove_file(&target);return Err(e);}
 set_pack_enabled(root, &format!("CFPA-{game}-{loader}.zip"), true)?;
 Ok("CFPA 社区汉化已通过哈希、加载器和资源包格式校验并启用；游戏语言为中文。".into())
}
#[cfg(test)]
mod options_tests {
    use super::*;

    #[test]
    fn translation_preserves_mod_and_legacy_pack_entries() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let options = root.join("options.txt");
        let packs = json!(["vanilla", "mod_resources", "modularbees:dynamic_assets", "mod/example:compat_packs/test/", "file/Example.zip"]);
        let original = format!("lang:zh_cn\r\nresourcePacks:{packs}\r\nfov:0.5\r\n");
        std::fs::write(&options, &original).unwrap();
        set_pack_enabled(root, "KXL-AI-Localization", true).unwrap();
        let updated = std::fs::read_to_string(&options).unwrap();
        let order: Vec<String> = serde_json::from_str(updated.lines().nth(1).unwrap().strip_prefix("resourcePacks:").unwrap()).unwrap();
        assert_eq!(json!(order[..5]), packs);
        assert_eq!(order.last().unwrap(), "file/KXL-AI-Localization");
        set_pack_enabled(root, "KXL-AI-Localization", false).unwrap();
        assert_eq!(std::fs::read_to_string(&options).unwrap(), original);

        write_json(&root.join("kxl.json"), &json!({"version": "1.12.2"})).unwrap();
        std::fs::write(&options, "resourcePacks:[\"RLHats.zip\"]\n").unwrap();
        set_pack_enabled(root, "KXL-AI-Localization", true).unwrap();
        assert_eq!(std::fs::read_to_string(options).unwrap(), "resourcePacks:[\"RLHats.zip\",\"KXL-AI-Localization\"]\n");
    }

    #[test]
    fn malformed_list_is_preserved() {
        let directory = tempfile::tempdir().unwrap();
        let options = directory.path().join("options.txt");
        let original = "resourcePacks:[broken]\n";
        std::fs::write(&options, original).unwrap();
        assert!(set_pack_enabled(directory.path(), "KXL-AI-Localization", true).is_err());
        assert_eq!(std::fs::read_to_string(options).unwrap(), original);
    }
}

#[cfg(test)]mod tests{use super::*;#[test]fn community_checks_format_and_loader(){let meta=json!({"pack":{"pack_format":15,"description":"汉化万用包，仅限1.20.1 Forge"}});assert!(compatible(&meta,15,"forge").is_ok());assert!(compatible(&meta,15,"fabric").is_err());assert!(compatible(&meta,34,"forge").is_err());assert!(compatible(&json!({"pack":{"pack_format":15,"supported_formats":{"min_inclusive":15,"max_inclusive":18}}}),18,"fabric").is_ok());}}
