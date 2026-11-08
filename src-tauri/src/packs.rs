use crate::*;
use std::io::{Read, Write};
use std::sync::atomic::AtomicUsize;
use futures_util::{stream, StreamExt, TryStreamExt};

// Downloading a catalogue pack and importing a local archive share the exact
// same independent-instance installer below.
pub async fn install_modrinth(core: &Core, p: &Value) -> Result<Value> {
    let project = string(p, "project")?;
    safe_name(project)?;
    core.stage("获取 Modrinth 整合包版本", 0, 1);
    let mut url = reqwest::Url::parse(&format!("https://api.modrinth.com/v2/project/{project}/version")).map_err(err)?;
    if let Some(game) = p["game"].as_str().filter(|game| !game.is_empty()) {
        url.query_pairs_mut().append_pair("game_versions", &json!([game]).to_string());
    }
    if let Some(loader) = p["loader"].as_str().filter(|loader| !loader.is_empty()) {
        url.query_pairs_mut().append_pair("loaders", &json!([loader]).to_string());
    }
    let selected;
    let versions;
    let version=if let Some(id)=p["versionId"].as_str(){
        safe_name(id)?;selected=core.get(&format!("https://api.modrinth.com/v2/version/{id}")).await?;
        if selected["project_id"]!=project{return Err("所选版本不属于此整合包".into());}&selected
    }else{
        versions=crate::jobs::wait(core,core.get(url.as_str())).await??;
        let rows=versions.as_array().ok_or("整合包版本清单无效")?;
        rows.iter().find(|v|v["version_type"]=="release").or(rows.first()).ok_or("没有可安装的整合包版本")?
    };
    let files = version["files"].as_array().ok_or("整合包缺少文件")?;
    let file = files.iter().filter(|file| file["filename"].as_str().is_some_and(|name| name.ends_with(".mrpack"))).find(|file| file["primary"] == true)
        .or_else(|| files.iter().find(|file| file["filename"].as_str().is_some_and(|name| name.ends_with(".mrpack")))).ok_or("整合包没有 MRPACK 文件")?;
    let hash = string(&file["hashes"], "sha1")?;
    if hash.len() != 40 { return Err("整合包缺少有效的文件校验".into()); }
    let dir = core.root.join("imports").join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&dir).map_err(err)?;
    let path = dir.join(safe_name(string(file, "filename")?)?);
    let result = async {
        core.stage("下载整合包文件", 0, 1);
        crate::engine::download(core, string(file, "url")?, &path, hash).await?;
        import(core, &json!({"path":path,"name":p["name"],"settings":p["settings"],"project":p["project"],"source":"modrinth","iconUrl":p["iconUrl"]})).await
    }.await;
    let _ = std::fs::remove_dir_all(&dir);
    result
}

fn curse_loader(manifest: &Value) -> (String, String) {
    let id = manifest["minecraft"]["modLoaders"]
        .as_array()
        .and_then(|items| {
            items
                .iter()
                .find(|item| item["primary"] == true)
                .or_else(|| items.first())
        })
        .and_then(|item| item["id"].as_str())
        .unwrap_or("");
    let (prefix, version) = id.split_once('-').unwrap_or((id, ""));
    if prefix.is_empty() {
        return ("vanilla".to_string(), String::new());
    }
    let loader = if prefix.eq_ignore_ascii_case("neoforge") {
        "neoforge"
    } else if prefix.eq_ignore_ascii_case("fabric") {
        "fabric"
    } else if prefix.eq_ignore_ascii_case("quilt") {
        "quilt"
    } else {
        "forge"
    };
    (loader.to_string(), version.to_string())
}
fn archive(path: &Path) -> Result<zip::ZipArchive<std::fs::File>> {
    if std::fs::metadata(path).map_err(err)?.len() > 8 * 1024 * 1024 * 1024 {
        return Err("整合包超过 8 GB".into());
    }
    zip::ZipArchive::new(std::fs::File::open(path).map_err(err)?).map_err(err)
}

fn pack_download_urls(file: &Value) -> Result<Vec<String>> {
    let mut urls = Vec::new();
    let mut last_error = "包文件缺少下载地址".to_string();
    for value in file["downloads"].as_array().into_iter().flatten() {
        let Some(raw) = value.as_str() else { continue };
        let parsed = match reqwest::Url::parse(raw) { Ok(url) => url, Err(e) => { last_error = err(e); continue; } };
        let host = parsed.host_str().unwrap_or("");
        if parsed.scheme() != "https" || !parsed.username().is_empty() || parsed.password().is_some() {
            last_error = "包下载地址必须使用不含账号信息的 HTTPS 链接".into(); continue;
        }
        if !["cdn.modrinth.com", "github.com", "raw.githubusercontent.com"].contains(&host) && !crate::curseforge::is_cdn_url(raw) {
            last_error = format!("不支持的包下载域名：{host}"); continue;
        }
        if !urls.iter().any(|url| url == raw) { urls.push(raw.to_string()); }
    }
    if urls.is_empty() { Err(last_error) } else { Ok(urls) }
}

async fn download_pack_file(core: &Core, file: &Value, target: &Path) -> Result<()> {
    let hash = file["hashes"]["sha1"].as_str().filter(|hash| hash.len() == 40 && hash.bytes().all(|b| b.is_ascii_hexdigit())).ok_or("包文件缺少有效的 SHA-1 校验")?;
    let urls = pack_download_urls(file)?;
    let cache = core.root.join("cache/pack-files").join(hash.to_ascii_lowercase());
    let mut last_error = String::new();
    for url in urls {
        core.stopped()?;
        match crate::engine::download(core, &url, &cache, hash).await {
            Ok(()) => {
                if let Some(parent)=target.parent(){std::fs::create_dir_all(parent).map_err(err)?;}
                std::fs::copy(&cache,target).map_err(err)?;
                return Ok(());
            },
            Err(error) => last_error = format!("{}：{error}",file["path"].as_str().unwrap_or("整合包资源")),
        }
    }
    Err(last_error)
}
fn entry(zip: &mut zip::ZipArchive<std::fs::File>, name: &str) -> Result<Option<Value>> {
    match zip.by_name(name) {
        Ok(mut f) => {
            if f.size() > 10 * 1024 * 1024 {
                return Err("包清单过大".into());
            }
            let mut s = String::new();
            f.read_to_string(&mut s).map_err(err)?;
            Ok(Some(serde_json::from_str(&s).map_err(err)?))
        }
        Err(zip::result::ZipError::FileNotFound) => Ok(None),
        Err(e) => Err(err(e)),
    }
}
pub fn inspect(path: &Path) -> Result<Value> {
    let mut info=inspect_archive(path)?;
    let mut zip=archive(path)?;
    if let Some(icon)=embedded_icon(&mut zip,&info) { info["packIcon"]=json!(icon); }
    Ok(info)
}
fn embedded_icon(zip: &mut zip::ZipArchive<std::fs::File>, info: &Value) -> Option<String> {
    let base=info["base"].as_str().unwrap_or("");
    let mut candidates=Vec::new();
    // MultiMC / Prism custom icon keys refer to an icon in the exported archive.
    if let Ok(mut cfg)=zip.by_name(&format!("{base}instance.cfg")) {
        if cfg.size()<=64*1024 {
            let mut text=String::new();let _=cfg.read_to_string(&mut text);
            if let Some(key)=text.lines().find_map(|l|l.trim().strip_prefix("iconKey=")) {
                if safe_name(key).is_ok(){candidates.push(format!("{base}icons/{key}.png"));candidates.push(format!("{base}{key}.png"));}
            }
        }
    }
    for manifest_name in ["modrinth.index.json","manifest.json","modpack.json","kxl-pack.json"] {
        if let Ok(Some(value))=entry(zip,&format!("{base}{manifest_name}")) {
            for field in ["icon","packIcon","logo","image"] {
                if let Some(data)=value[field].as_str().filter(|s|s.starts_with("data:image/") && s.len()<3*1024*1024) {
                    use base64::Engine;
                    if let Some((_,encoded))=data.split_once(";base64,"){if let Ok(bytes)=base64::engine::general_purpose::STANDARD.decode(encoded){if let Some(icon)=resources::image_data(bytes){return Some(icon);}}}
                }
                if let Some(name)=value[field].as_str().filter(|s|!s.contains(':') && !s.contains('\\') && !s.split('/').any(|x|x=="..")) {
                    candidates.push(format!("{base}{name}"));
                }
            }
            if let Some(root)=value["overrides"].as_str().filter(|s|!s.contains(':') && !s.split('/').any(|x|x=="..")) {
                for name in ["icon.png","icon.jpg","icon.webp","pack.png","PCL/Logo.png"] {candidates.push(format!("{base}{root}/{name}"));}
            }
        }
    }
    for root in [base.trim_end_matches('/'),info["root"].as_str().unwrap_or(""),info["resourceRoot"].as_str().unwrap_or("")] {
        for name in ["icon.png","icon.jpg","icon.webp","pack.png","PCL/Logo.png",".minecraft/icon.png","minecraft/icon.png","overrides/icon.png","overrides/pack.png","client-overrides/icon.png"] {
            candidates.push(if root.is_empty(){name.into()}else{format!("{root}/{name}")});
        }
    }
    for name in candidates {
        let Ok(mut file)=zip.by_name(&name) else {continue};
        if file.size()>2*1024*1024 {continue;}
        let mut bytes=Vec::new();if file.read_to_end(&mut bytes).is_ok(){if let Some(image)=resources::image_data(bytes){return Some(image);}}
    }
    None
}
pub(crate) fn installed_icon(dir:&Path)->Option<String> {
    for name in ["icon.png","icon.jpg","icon.webp","pack.png","PCL/Logo.png"] {
        let path=dir.join(name);
        if std::fs::metadata(&path).ok().is_some_and(|m|m.is_file() && m.len()<=2*1024*1024) {
            if let Ok(bytes)=std::fs::read(path){if let Some(image)=resources::image_data(bytes){return Some(image);}}
        }
    }
    None
}
fn inspect_archive(path: &Path) -> Result<Value> {
    let mut z = archive(path)?;
    if let Some((base, v)) = manifest(&mut z, "modrinth.index.json")? {
        let deps = v["dependencies"].as_object().ok_or("整合包没有依赖清单")?;
        let loader = if deps.contains_key("fabric-loader") {
            "fabric"
        } else if deps.contains_key("quilt-loader") {
            "quilt"
        } else if deps.contains_key("neoforge") {
            "neoforge"
        } else if deps.contains_key("forge") {
            "forge"
        } else {
            "vanilla"
        };
        return Ok(
            json!({"name":v["name"],"version":deps["minecraft"],"loader":loader,"count":z.len(),"format":"modrinth","base":base,"path":path}),
        );
    }
    if let Some((base, v)) = manifest(&mut z, "kxl-pack.json")? {
        return Ok(
            json!({"name":v["name"],"version":v["version"],"loader":v["loader"],"count":z.len(),"format":"kynex","base":base,"path":path}),
        );
    }
    if let Some((base, v)) = manifest(&mut z, "manifest.json")? {
        if v["minecraft"]["version"].is_string() {
            let (loader, loader_version) = curse_loader(&v);
            return Ok(
                json!({"name":v["name"],"version":v["minecraft"]["version"],"loader":loader,"loaderVersion":loader_version,"count":z.len(),"format":"curseforge","base":base,"path":path}),
            );
        }
    }
    if let Some((base, v)) = manifest(&mut z, "mmc-pack.json")? {
        let components = v["components"].as_array().ok_or("MultiMC 组件清单无效")?;
        let game = components
            .iter()
            .find(|v| v["uid"] == "net.minecraft")
            .and_then(|v| v["version"].as_str())
            .ok_or("MultiMC 整合包缺少 Minecraft 版本")?;
        let mut loader = "vanilla";
        let mut loader_version = "";
        for component in components {
            loader = match component["uid"].as_str().unwrap_or("") {
                "net.fabricmc.fabric-loader" => "fabric",
                "org.quiltmc.quilt-loader" => "quilt",
                "net.minecraftforge" => "forge",
                "net.neoforged" => "neoforge",
                _ => continue,
            };
            loader_version = component["version"].as_str().unwrap_or("");
            break;
        }
        let root = [format!("{base}.minecraft"), format!("{base}minecraft")]
            .into_iter()
            .find(|root| {
                z.file_names()
                    .any(|name| name.starts_with(&format!("{root}/")))
            })
            .unwrap_or(format!("{base}.minecraft"));
        return Ok(
            json!({"name":path.file_stem().and_then(|s|s.to_str()).unwrap_or("导入的实例"),"version":game,"loader":loader,"loaderVersion":loader_version,"count":z.len(),"format":"multimc","base":base,"root":root,"path":path}),
        );
    }
    if let Some((base, v)) = manifest(&mut z, "modpack.json")? {
        if let Some(game) = v["gameVersion"].as_str() {
            let root = format!("{base}minecraft");
            let config =
                entry(&mut z, &format!("{root}/version.json"))?.unwrap_or_else(|| json!({}));
            let (_, loader, loader_version) = version_details(&config);
            return Ok(
                json!({"name":v["name"].as_str().unwrap_or("HMCL 整合包"),"version":game,"loader":loader,"loaderVersion":loader_version,"count":z.len(),"format":"hmcl","root":root,"base":base,"path":path}),
            );
        }
    }
    let candidates: Vec<String> = z
        .file_names()
        .filter(|name| {
            name.ends_with(".json")
                && (name.contains("/versions/")
                    || name.starts_with("versions/")
                    || name.ends_with("/version.json")
                    || *name == "version.json")
        })
        .map(str::to_string)
        .collect();
    let mut found = vec![];
    for name in candidates {
        if let Ok(Some(config)) = entry(&mut z, &name) {
            if config["mainClass"].is_null()
                && config["inheritsFrom"].is_null()
                && config["downloads"]["client"].is_null()
            {
                continue;
            }
            let (game, loader, loader_version) = version_details(&config);
            if game.is_empty() {
                continue;
            }
            let root = name
                .split("versions/")
                .next()
                .filter(|_| name.contains("versions/"))
                .unwrap_or_else(|| name.strip_suffix("version.json").unwrap_or(""));
            found.push(json!({"name":path.file_stem().and_then(|s|s.to_str()).unwrap_or("Minecraft 整合包"),"version":game,"loader":loader,"loaderVersion":loader_version,"count":z.len(),"format":"minecraft","root":root.trim_end_matches('/'),"resourceRoot":name.rsplit_once('/').map(|s|s.0).unwrap_or(""),"path":path}));
        }
    }
    if found.len() == 1 {
        return Ok(found.remove(0));
    }
    Err(if found.len() > 1 {
        "压缩包包含多个游戏版本，请按单个实例导出后导入"
    } else {
        "未识别游戏版本。支持 MRPACK、CurseForge、MultiMC/Prism、HMCL 和含版本清单的 Minecraft ZIP"
    }
    .into())
}
fn manifest(z: &mut zip::ZipArchive<std::fs::File>, file: &str) -> Result<Option<(String, Value)>> {
    let mut names: Vec<String> = z
        .file_names()
        .filter(|name| *name == file || name.ends_with(&format!("/{file}")))
        .map(str::to_string)
        .collect();
    names.sort_by_key(String::len);
    let Some(name) = names.first() else {
        return Ok(None);
    };
    let base = name.strip_suffix(file).unwrap_or("").to_string();
    Ok(entry(z, name)?.map(|value| (base, value)))
}
pub(crate) fn version_details(v: &Value) -> (String, String, String) {
    let game = v["inheritsFrom"]
        .as_str()
        .or(v["clientVersion"].as_str())
        .or(v["id"].as_str())
        .unwrap_or("");
    let mut loader = "vanilla".to_string();
    let mut version = String::new();
    for library in v["libraries"].as_array().into_iter().flatten() {
        let parts: Vec<&str> = library["name"].as_str().unwrap_or("").split(':').collect();
        if parts.len() < 3 {
            continue;
        }
        let candidate = match (parts[0], parts[1]) {
            ("net.fabricmc", "fabric-loader") => "fabric",
            ("org.quiltmc", "quilt-loader") => "quilt",
            ("net.minecraftforge", "forge") => "forge",
            ("net.neoforged", "neoforge") => "neoforge",
            _ => continue,
        };
        loader = candidate.into();
        version = if loader == "forge" {
            parts[2]
                .strip_prefix(&format!("{game}-"))
                .unwrap_or(parts[2])
                .to_string()
        } else {
            parts[2].to_string()
        };
    }
    (game.to_string(), loader, version)
}
pub(crate) fn safe_extract(
    zip: &mut zip::ZipArchive<std::fs::File>,
    to: &Path,
    prefix: Option<&str>,
) -> Result<()> {
    let mut total = 0u64;
    for i in 0..zip.len() {
        let mut e = zip.by_index(i).map_err(err)?;
        let path = e.enclosed_name().ok_or("压缩包含目录穿越路径")?;
        if let Some(mode) = e.unix_mode() {
            if mode & 0o170000 == 0o120000 {
                return Err("压缩包包含符号链接".into());
            }
        }
        let path = if let Some(prefix) = prefix {
            match path.strip_prefix(prefix) {
                Ok(p) => p.to_path_buf(),
                Err(_) => continue,
            }
        } else {
            path
        };
        if path.as_os_str().is_empty() {
            continue;
        }
        if [
            "accounts.json",
            "kxl.json",
            "version.json",
            "launcher_profiles.json",
        ]
        .iter()
        .any(|x| path == Path::new(x))
        {
            continue;
        }
        total = total.checked_add(e.size()).ok_or("包大小溢出")?;
        if total > 16 * 1024 * 1024 * 1024 || e.size() > 2 * 1024 * 1024 * 1024 {
            return Err("解压体积超出限制".into());
        }
        let target = to.join(&path);
        if e.is_dir() {
            std::fs::create_dir_all(target).map_err(err)?;
        } else {
            if let Some(p) = target.parent() {
                std::fs::create_dir_all(p).map_err(err)?;
            }
            let mut f = std::fs::File::create(target).map_err(err)?;
            std::io::copy(&mut e, &mut f).map_err(err)?;
        }
    }
    Ok(())
}
/// 导入同名整合包时自动加序号，允许重复安装而不是报“实例名已存在”。
fn unique_instance_name(core: &Core, base: &str) -> Result<String> {
    let taken: std::collections::HashSet<String> = core
        .instances()?
        .as_array()
        .map(|rows| {
            rows.iter()
                .filter_map(|row| row["name"].as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    if !taken.contains(base) {
        return Ok(base.to_string());
    }
    for index in 2..1000 {
        let candidate = format!("{base} ({index})");
        if !taken.contains(&candidate) {
            return Ok(candidate);
        }
    }
    Err("同名实例过多，请先清理旧实例".into())
}

pub async fn import(c: &Core, p: &Value) -> Result<Value> {
    c.stage("读取整合包清单", 0, 1);
    let path = Path::new(string(p, "path")?);
    let info = inspect(path)?;
    let mut z = archive(path)?;
    let cf_key = crate::curseforge::configured_key(c, p["curseforgeKey"].as_str().unwrap_or(""));
    let mut settings = crate::engine::defaults()
        .as_object()
        .cloned()
        .unwrap_or_default();
    if let Some(custom) = p["settings"].as_object() {
        settings.extend(custom.clone());
    }
    settings.insert("isolation".into(), json!("all"));
    let requested = p["name"]
        .as_str()
        .or(info["name"].as_str())
        .ok_or("包名缺失")?;
    let name = unique_instance_name(c, requested)?;
    let mut install = json!({"name":name,"version":info["version"],"loader":info["loader"],"loaderVersion":info["loaderVersion"],"settings":settings});
    let base = info["base"].as_str().unwrap_or("");
    let modrinth = entry(&mut z, &format!("{base}modrinth.index.json"))?;
    let curse = if info["format"] == "curseforge" {
        entry(&mut z, &format!("{base}manifest.json"))?
    } else {
        None
    };
    if let Some(ref index) = modrinth {
        let key = match info["loader"].as_str().unwrap_or("") {
            "fabric" => "fabric-loader",
            "quilt" => "quilt-loader",
            "neoforge" => "neoforge",
            "forge" => "forge",
            _ => "",
        };
        install["loaderVersion"] = index["dependencies"][key].clone();
    }
    if let Some(ref manifest) = curse {
        let (loader, loader_version) = curse_loader(manifest);
        if loader != "vanilla" && loader_version.is_empty() {
            return Err("CurseForge 清单缺少加载器版本".into());
        }
        install["loader"] = json!(loader);
        install["version"] = manifest["minecraft"]["version"].clone();
        install["loaderVersion"] = json!(loader_version);
    }
    if info["format"] == "kynex" {
        let v = entry(&mut z, &format!("{base}kxl-pack.json"))?.ok_or("包清单缺失")?;
        install["loaderVersion"] = v["loaderVersion"].clone();
        install["optifineVersion"] = v["optifineVersion"].clone();
    }
    let instance = crate::engine::install(c, &install).await?;
    let dir = c.instance(string(&instance, "id")?)?;
    let result = async {
        if let Some(index) = modrinth {
            let files = index["files"].as_array().ok_or("包文件清单无效")?;
            let count = Arc::new(AtomicUsize::new(0));
            let total = files.iter().filter(|f| f["env"]["client"] != "unsupported").count();
            c.stage("下载整合包资源", 0, total);
            stream::iter(files.clone().into_iter().filter(|f| f["env"]["client"] != "unsupported").map(|f| {
                let count = count.clone();
                let dir = dir.clone();
                let c = c.clone();
                async move {
                c.stopped()?;
                let path = Path::new(string(&f, "path")?);
                if path.is_absolute()
                    || path
                        .components()
                        .any(|c| !matches!(c, std::path::Component::Normal(_)))
                {
                    return Err("文件路径不安全".into());
                }
                if ["kxl.json", "version.json", "accounts.json"]
                    .iter()
                    .any(|name| path == Path::new(name))
                {
                    return Err("包下载清单试图覆盖启动器配置".into());
                }
                download_pack_file(&c, &f, &dir.join(path)).await?;
                c.stage("安装整合包资源", count.fetch_add(1, Ordering::Relaxed) + 1, total);
                Ok::<_, String>(())
                }
            })).buffer_unordered(16).try_collect::<Vec<_>>().await?;
            safe_extract(&mut z, &dir, Some(&format!("{base}overrides")))?;
            safe_extract(&mut z, &dir, Some(&format!("{base}client-overrides")))?;
        } else if let Some(manifest) = curse {
            let files = manifest["files"]
                .as_array()
                .ok_or("CurseForge 文件清单无效")?;
            let count = Arc::new(AtomicUsize::new(0));
            let total = files.len();
            c.stage("获取整合包资源与下载文件", 0, total);
            stream::iter(files.clone().into_iter().map(|f| {
                let count = count.clone();
                let dir = dir.clone();
                let c = c.clone();
                let cf_key = cf_key.clone();
                async move {
                c.stopped()?;
                let project_id = f["projectID"]
                    .as_u64()
                    .or_else(|| f["projectID"].as_str().and_then(|v| v.parse().ok()))
                    .ok_or("CurseForge 清单缺少项目 ID")?;
                let file_id = f["fileID"]
                    .as_u64()
                    .or_else(|| f["fileID"].as_str().and_then(|v| v.parse().ok()))
                    .ok_or("CurseForge 清单缺少文件 ID")?;
                let file = crate::curseforge::file_by_id(&c, project_id, file_id, cf_key.as_deref())
                    .await?;
                let name = crate::curseforge::file_name(&file)?.to_string();
                let url = crate::curseforge::download_url(&file)?;
                let hash = crate::curseforge::file_hash(&file);
                let kind = if name.to_ascii_lowercase().ends_with(".jar") {
                        "mods"
                    } else {
                        match crate::curseforge::project_info(&c, project_id, cf_key.as_deref())
                            .await
                        {
                            Ok(project) => match project["classId"].as_u64() {
                                Some(12) => "resourcepacks",
                                Some(6552) => "shaderpacks",
                                Some(4546) => "saves",
                                _ => "mods",
                            },
                            Err(_) => "mods",
                        }
                };
                if kind == "saves" {
                    return Ok::<_, String>(());
                }
                let target = dir.join(kind).join(safe_name(&name)?);
                crate::engine::download(&c, &url, &target, &hash).await?;
                c.stage("安装 CurseForge 整合包资源", count.fetch_add(1, Ordering::Relaxed) + 1, total);
                Ok::<_, String>(())
                }
            })).buffer_unordered(16).try_collect::<Vec<_>>().await?;
            let overrides = manifest["overrides"].as_str().unwrap_or("overrides");
            safe_extract(&mut z, &dir, Some(&format!("{base}{overrides}")))?;
            if let Some(extra) = manifest["clientOverrides"]
                .as_str()
                .or_else(|| manifest["client-overrides"].as_str())
            {
                safe_extract(&mut z, &dir, Some(&format!("{base}{extra}")))?;
            }
        } else if info["format"] == "kynex" {
            safe_extract(
                &mut z,
                &dir,
                if base.is_empty() {
                    None
                } else {
                    Some(base.trim_end_matches('/'))
                },
            )?;
        } else {
            let root = info["root"].as_str().unwrap_or("");
            extract_game_resources(&mut z, &dir, root)?;
            if let Some(isolated) = info["resourceRoot"].as_str().filter(|s| *s != root) {
                extract_game_resources(&mut z, &dir, isolated)?;
            }
        }
        let mut instance=instance.clone();
        instance["modpack"]=json!(true);
        if !p["project"].is_null() {
            let project=crate::pack_logos::identity(p);
            if !info["packIcon"].is_string() {if let Some(image)=crate::pack_logos::download(c,&project).await{instance["packLogo"]=json!(image);}}
            instance["packProject"]=project;
        }
        if let Some(icon)=info["packIcon"].as_str(){instance["packIcon"]=json!(icon);}
        write_json(&dir.join("kxl.json"),&instance)?;
        Ok(instance)
    }
    .await;
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&dir);
    }
    result
}
pub(crate) fn extract_game_resources(
    z: &mut zip::ZipArchive<std::fs::File>,
    dir: &Path,
    root: &str,
) -> Result<()> {
    for kind in crate::pack_export::ROOTS {
        let prefix = if root.is_empty() {
            kind.to_string()
        } else {
            format!("{root}/{kind}")
        };
        safe_extract(z, &dir.join(kind), Some(&prefix))?;
    }
    let prefix = if root.is_empty() { String::new() } else { format!("{root}/") };
    let files = z.file_names().filter_map(|name| {
        let relative = name.strip_prefix(&prefix)?;
        (!relative.contains('/') && matches!(crate::pack_export::category(relative), Some("options" | "license"))).then(|| (name.to_owned(), relative.to_owned()))
    }).collect::<Vec<_>>();
    for (name, relative) in files {
        let mut file = z.by_name(&name).map_err(err)?;
        if file.is_dir() || file.size() > 16 * 1024 * 1024 { return Err("游戏设置或许可文件过大".into()); }
        let mut target = std::fs::File::create(dir.join(relative)).map_err(err)?;
        std::io::copy(&mut file, &mut target).map_err(err)?;
    }
    Ok(())
}
pub fn export(c: &Core, p: &Value) -> Result<Value> {
    let dir = c.instance(string(p, "id")?)?;
    let mut info = read_json(&dir.join("kxl.json"))?;
    let mods = crate::engine::resource_dir(c, &json!({"id": string(p, "id")?, "kind": "mods"}))?;
    let game_dir = mods.parent().ok_or("无法确定游戏目录")?;
    let version = read_json(&dir.join("version.json"))?;
    if info["loaderVersion"].as_str().unwrap_or("").is_empty() {
        let (_, _, value) = version_details(&version);
        if !value.is_empty() {
            info["loaderVersion"] = json!(value);
        }
    }
    if let Some(id) = version["id"].as_str() {
        let loader = info["loader"].as_str().unwrap_or("");
        if (loader == "fabric" || loader == "quilt")
            && info["loaderVersion"].as_str().unwrap_or("").is_empty()
        {
            info["loaderVersion"] = json!(id
                .split("-loader-")
                .nth(1)
                .and_then(|s| s.rsplit_once('-').map(|x| x.0))
                .unwrap_or(""));
        }
    }
    info.as_object_mut().ok_or("配置无效")?.remove("path");
    info.as_object_mut().unwrap().remove("settings");
    let image = ["icon", "packIcon", "packLogo"].iter().find_map(|key| {
        use base64::Engine;
        let value = info[*key].as_str().filter(|s| s.starts_with("data:image/") && s.len() < 3 * 1024 * 1024)?;
        let bytes = base64::engine::general_purpose::STANDARD.decode(value.split_once(',')?.1).ok()?;
        resources::image_data(bytes.clone()).map(|data| (bytes, data))
    });
    let mut clean = json!({});
    for key in ["name", "version", "loader", "loaderVersion", "optifineVersion"] {
        if !info[key].is_null() { clean[key] = info[key].clone(); }
    }
    info = clean;
    if let Some((_, data)) = &image { info["packIcon"] = json!(data); }
    for (field, parameter, fallback) in [("name", "name", "KXL Modpack"), ("packVersion", "packVersion", "1.0.0")] {
        let value = p[parameter].as_str().filter(|s| !s.trim().is_empty()).or_else(|| info[field].as_str()).unwrap_or(fallback).trim().to_string();
        if value.chars().count() > 100 || value.chars().any(char::is_control) { return Err("整合包名称或版本过长或包含控制字符".into()); }
        info[field] = json!(value);
    }
    let selected = if let Some(files) = p["selectedFiles"].as_array() {
        files.iter().map(|v| v.as_str().map(str::to_owned).ok_or("导出文件列表无效".into())).collect::<Result<Vec<_>>>()?
    } else { crate::pack_export::files(c, p)? };
    let target = PathBuf::from(string(p, "path")?);
    let target_parent = target.parent().ok_or("导出位置无效")?.canonicalize().map_err(err)?;
    let canonical_game = game_dir.canonicalize().map_err(err)?;
    let canonical_instance = dir.canonicalize().map_err(err)?;
    if target_parent.starts_with(&canonical_instance) || target_parent.starts_with(&canonical_game) || target.file_name().is_none() {
        return Err("导出位置必须在游戏目录外".into());
    }
    let format = p["format"].as_str().unwrap_or("mrpack");
    if !["mrpack", "universal", "curseforge", "multimc", "kynex"].contains(&format) { return Err("不支持的整合包导出格式".into()); }
    struct PartialExport(PathBuf);
    impl Drop for PartialExport { fn drop(&mut self) { let _ = std::fs::remove_file(&self.0); } }
    let temp = target.with_extension(format!("{}.zip.part", uuid::Uuid::new_v4()));
    let _cleanup = PartialExport(temp.clone());
    let file = std::fs::File::create(&temp).map_err(err)?;
    let mut w = zip::ZipWriter::new(file);
    let loader = info["loader"].as_str().unwrap_or("vanilla");
    let loader_version = info["loaderVersion"].as_str().unwrap_or("");
    if format != "kynex" && (loader == "optifine" || info["optifineVersion"].as_str().is_some_and(|v| !v.is_empty())) {
        return Err("此实例含 OptiFine，请使用 KXL ZIP 保留完整加载器配置".into());
    }
    if loader != "vanilla" && loader_version.is_empty() {
        return Err("无法确定加载器版本，请先修复或重新安装该实例的加载器".into());
    }
    let loader_key = match loader {
        "fabric" => "fabric-loader",
        "quilt" => "quilt-loader",
        "forge" => "forge",
        "neoforge" => "neoforge",
        _ => "",
    };
    let mut deps = json!({"minecraft":info["version"]});
    if !loader_key.is_empty() {
        deps[loader_key] = json!(loader_version);
    }
    let prefix = match format {
        "mrpack" | "universal" => {
            write_entry(
                &mut w,
                "modrinth.index.json",
                &json!({"formatVersion":1,"game":"minecraft","versionId":info["packVersion"],"name":info["name"],"files":p["onlineFiles"].as_array().cloned().unwrap_or_default(),"dependencies":deps}),
            )?;
            if format == "universal" {
                write_curse_manifest(&mut w, &info)?;
            }
            "overrides/"
        }
        "curseforge" => {
            write_curse_manifest(&mut w, &info)?;
            "overrides/"
        }
        "multimc" => {
            let mut components =
                vec![json!({"uid":"net.minecraft","version":info["version"],"important":true})];
            let uid = match loader {
                "fabric" => "net.fabricmc.fabric-loader",
                "quilt" => "org.quiltmc.quilt-loader",
                "forge" => "net.minecraftforge",
                "neoforge" => "net.neoforged",
                _ => "",
            };
            if !uid.is_empty() {
                components.push(json!({"uid":uid,"version":loader_version}));
            }
            write_entry(
                &mut w,
                "mmc-pack.json",
                &json!({"formatVersion":1,"components":components}),
            )?;
            w.start_file("instance.cfg", zip::write::SimpleFileOptions::default())
                .map_err(err)?;
            let name = info["name"]
                .as_str()
                .unwrap_or("KXL Modpack")
                .replace(['\r', '\n'], " ");
            w.write_all(format!("InstanceType=OneSix\nname={name}\niconKey=default\n").as_bytes())
                .map_err(err)?;
            ".minecraft/"
        }
        "kynex" => {
            write_entry(&mut w, "kxl-pack.json", &info)?;
            ""
        }
        _ => return Err("不支持的整合包导出格式".into()),
    };
    let online = p["onlineFiles"].as_array().cloned().unwrap_or_default();
    if let Some((bytes, _)) = &image {
        if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            w.start_file("icon.png", zip::write::SimpleFileOptions::default()).map_err(err)?;
            w.write_all(bytes).map_err(err)?;
        }
    }
    for (index, name) in selected.iter().enumerate() {
        c.stopped()?;
        if name.contains(['\\', ':']) || Path::new(name).components().any(|v| !matches!(v,std::path::Component::Normal(_))) || crate::pack_export::category(name).is_none() { return Err("导出文件路径无效".into()); }
        let path = game_dir.join(name);
        if !path.canonicalize().map_err(err)?.starts_with(&canonical_game) { return Err("导出文件越出游戏目录".into()); }
        if let Some(remote) = online.iter().find(|r| r["path"] == *name) {
            if crate::pack_export::hash_file(c, &path)?.0 != remote["hashes"]["sha1"].as_str().unwrap_or("") { return Err("资源文件已发生变化，请重新导出".into()); }
        } else {
            w.start_file(format!("{prefix}{name}"),zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated)).map_err(err)?;
            let mut file = std::fs::File::open(&path).map_err(err)?;
            let before = file.metadata().map_err(err)?;
            let mut buffer = [0u8; 65536]; let mut copied = 0u64;
            loop { c.stopped()?; let count = file.read(&mut buffer).map_err(err)?; if count == 0 { break; } w.write_all(&buffer[..count]).map_err(err)?; copied += count as u64; }
            let after = file.metadata().map_err(err)?;
            if copied != before.len() || before.len() != after.len() || before.modified().ok() != after.modified().ok() { return Err("文件在打包时发生变化，请重新导出".into()); }
        }
        c.stage("打包所选文件", index + 1, selected.len());
    }
    w.finish().map_err(err)?;
    std::fs::rename(&temp, &target).map_err(err)?;
    Ok(json!(target))
}
fn write_entry(w: &mut zip::ZipWriter<std::fs::File>, name: &str, value: &Value) -> Result<()> {
    w.start_file(
        name,
        zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated),
    )
    .map_err(err)?;
    w.write_all(value.to_string().as_bytes()).map_err(err)
}
fn write_curse_manifest(w: &mut zip::ZipWriter<std::fs::File>, info: &Value) -> Result<()> {
    let loader = info["loader"].as_str().unwrap_or("vanilla");
    let loaders = if loader == "vanilla" {
        vec![]
    } else {
        vec![
            json!({"id":format!("{loader}-{}",info["loaderVersion"].as_str().unwrap_or("")),"primary":true}),
        ]
    };
    write_entry(
        w,
        "manifest.json",
        &json!({"minecraft":{"version":info["version"],"modLoaders":loaders},"manifestType":"minecraftModpack","manifestVersion":1,"name":info["name"],"version":info["packVersion"].as_str().unwrap_or("1.0.0"),"author":"","files":[],"overrides":"overrides"}),
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    #[ignore = "downloads the reported large mod and verifies reuse from its content-addressed cache"]
    async fn live_reported_large_mod_cache() {
        let root=PathBuf::from(std::env::var("KXL_LARGE_MOD_TEST_ROOT").unwrap());
        assert!(root.components().any(|part|part.as_os_str()==".update-qa"));
        let core=Core::new(root.clone(),Arc::new(|_|{})).unwrap();
        let hash="bddafeea4c9c1132ed720c30fbaedfe5ab25e846";
        let mut file=json!({"path":"mods/tacz-1.20.1-1.1.8-hotfix.jar","downloads":["https://cdn.modrinth.com/data/SzzJttH8/versions/yOVIzIJR/tacz-1.20.1-1.1.8-hotfix.jar"],"hashes":{"sha1":hash}});
        let target=root.join("one/tacz.jar");
        let started=std::time::Instant::now();
        tokio::time::timeout(std::time::Duration::from_secs(90),download_pack_file(&core,&file,&target)).await.unwrap().unwrap();
        let elapsed=started.elapsed().as_millis();
        assert!(crate::engine::cached_file_valid(&target,hash).await.unwrap());
        file["downloads"]=json!(["https://cdn.modrinth.com/must-not-fetch-a-cached-file"]);
        let second=root.join("two/tacz.jar");
        download_pack_file(&core,&file,&second).await.unwrap();
        assert!(crate::engine::cached_file_valid(&second,hash).await.unwrap());
        println!("{}",json!({"largeModDownloaded":true,"hashCacheReused":true,"downloadMs":elapsed}));
        if let Ok(report)=std::env::var("KXL_LARGE_MOD_REPORT"){write_json(Path::new(&report),&json!({"largeModDownloaded":true,"hashCacheReused":true,"downloadMs":elapsed})).unwrap();}
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    #[ignore = "imports user-provided archives and downloads their dependencies into an isolated QA directory"]
    async fn live_reported_pack_archives() {
        let root = PathBuf::from(std::env::var("KXL_PACK_REPRO_ROOT").unwrap());
        assert!(root.components().any(|part| part.as_os_str() == ".update-qa"));
        let paths: Vec<String> = serde_json::from_str(&std::env::var("KXL_PACK_FILES").unwrap()).unwrap();
        let mut reports = vec![];
        let progress = Arc::new(std::sync::Mutex::new((String::new(), std::time::Instant::now())));
        let core = Core::new(root.clone(), Arc::new(move |value| {
            let stage = value["stage"].as_str().unwrap_or("").to_string();
            let mut previous = progress.lock().unwrap();
            if previous.0 != stage || previous.1.elapsed().as_secs() >= 3 {
                println!("{}",json!({"stage":stage,"done":value["done"],"total":value["total"],"detail":value["detail"]}));
                *previous = (stage, std::time::Instant::now());
            }
        })).unwrap();
        for path in paths {
            let info = inspect(Path::new(&path)).unwrap();
            println!("{}",json!({"beginPack":info["name"],"loader":info["loader"],"loaderVersion":info["loaderVersion"]}));
            let result = import(&core, &json!({"path":path,"name":info["name"],"settings":{"memory":6144,"isolation":"all"}})).await;
            let mut report = json!({"file":path,"name":info["name"],"game":info["version"]});
            match result {
                Ok(instance) => {
                    let dir = core.instance(instance["id"].as_str().unwrap()).unwrap();
                    assert!(dir.join("kxl.json").is_file() && dir.join("version.json").is_file());
                    assert_eq!(instance["version"],"1.20.1"); assert_eq!(instance["loader"],"forge");
                    let mods = std::fs::read_dir(dir.join("mods")).unwrap().flatten().filter(|entry| entry.path().extension().is_some_and(|ext| ext == "jar")).count();
                    assert!(mods > 0); report["success"]=json!(true); report["mods"]=json!(mods); report["instanceId"]=instance["id"].clone();
                },
                Err(error) => { report["success"]=json!(false); report["error"]=json!(error); }
            }
            println!("{}",report); reports.push(report);
            if let Ok(dest) = std::env::var("KXL_PACK_REPRO_REPORT") { write_json(Path::new(&dest),&json!({"isolated":true,"packs":reports})).unwrap(); }
            assert_eq!(reports.last().unwrap()["success"],true,"{}",reports.last().unwrap());
        }
    }
    #[tokio::test]
    #[ignore = "downloads the reported legacy CurseForge CDN form into an isolated QA directory"]
    async fn live_mrpack_legacy_cdn_download() {
        let root = PathBuf::from(std::env::var("KXL_MRPACK_TEST_ROOT").unwrap());
        assert!(root.components().any(|part| part.as_os_str() == ".update-qa"));
        let core = Core::new(root.clone(), Arc::new(|_| {})).unwrap();
        let name = "notenoughanimations-neoforge-1.12.6-mc1.21.1.jar";
        let hash = "2098ae4965ebefb2dc8d5aec42a7d5282414fddc";
        let file = json!({"downloads":[format!("https://mediafilez.forgecdn.net/files/8925/075/{name}")],"hashes":{"sha1":hash}});
        let target = root.join("mods").join(name);
        download_pack_file(&core, &file, &target).await.unwrap();
        assert!(crate::engine::cached_file_valid(&target, hash).await.unwrap());
        let archive = zip::ZipArchive::new(std::fs::File::open(&target).unwrap()).unwrap();
        assert!(!archive.is_empty());
        if let Ok(report) = std::env::var("KXL_CDN_REPORT") {
            write_json(Path::new(&report), &json!({"legacyMrpackCdnDownloadPassed":true,"sha1":hash,"bytes":std::fs::metadata(target).unwrap().len()})).unwrap();
        }
    }
    #[test]
    fn mrpack_accepts_curseforge_cdn_and_preserves_alternate_addresses() {
        let urls = ["https://mediafilez.forgecdn.net/files/8925/075/test%20mod.jar", "https://media.forgecdn.net/files/1/2/test.jar", "https://edge.forgecdn.net/files/1/2/test.jar", "https://cdn.modrinth.com/data/x/versions/y/test.jar"];
        let file = json!({"downloads":urls});
        assert_eq!(pack_download_urls(&file).unwrap(), urls);
        assert_eq!(crate::mirrors::candidates(urls[0], "official")[0], "https://edge.forgecdn.net/files/8925/075/test%20mod.jar");
        let mixed = json!({"downloads":["https://untrusted.invalid/file.jar",urls[0],urls[0]]});
        assert_eq!(pack_download_urls(&mixed).unwrap(), vec![urls[0]]);
    }
    #[test]
    fn mrpack_domain_support_does_not_accept_spoofed_or_credential_urls() {
        for url in ["http://mediafilez.forgecdn.net/a.jar", "https://mediafilez.forgecdn.net.evil.invalid/a.jar", "https://mediafilez.forgecdn.net@evil.invalid/a.jar", "https://name:password@mediafilez.forgecdn.net/a.jar", "https://evil.invalid/?host=forgecdn.net"] {
            assert!(pack_download_urls(&json!({"downloads":[url]})).is_err(), "{url}");
        }
    }
    #[tokio::test]
    async fn local_pack_imports_create_independent_instances_from_the_manifest() {
        use sha1::{Digest, Sha1};
        let temp = tempfile::tempdir().unwrap();
        let core = Core::new(temp.path().join("game"), Arc::new(|_| {})).unwrap();
        let client = b"fixture-client";
        let client_hash = format!("{:x}", Sha1::digest(client));
        let version = json!({"id":"fixture-game","libraries":[],"downloads":{"client":{"url":"https://example.com/client.jar","sha1":client_hash}}});
        let bytes = serde_json::to_vec(&version).unwrap();
        let meta_hash = format!("{:x}", Sha1::digest(&bytes));
        write_json(&core.root.join("cache/version-manifest.json"), &json!({"versions":[{"id":"fixture-game","url":"https://example.com/version.json","sha1":meta_hash}]})).unwrap();
        let version_dir = core.root.join("versions/fixture-game");
        std::fs::create_dir_all(&version_dir).unwrap();
        std::fs::write(version_dir.join("fixture-game.json"), bytes).unwrap();
        let client_dir = core.root.join("cache/game-clients").join(&client_hash);
        std::fs::create_dir_all(&client_dir).unwrap();
        std::fs::write(client_dir.join("client.jar"), client).unwrap();
        let existing = core.instance("existing").unwrap();
        write_json(&existing.join("kxl.json"), &json!({"id":"existing","name":"已有实例"})).unwrap();
        std::fs::write(existing.join("keep.txt"), b"untouched").unwrap();
        for format in ["modrinth", "curseforge"] {
            let path = temp.path().join(format!("{format}.zip"));
            let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
            let (entry, value) = if format == "modrinth" {
                ("modrinth.index.json", json!({"name":"测试整合包","dependencies":{"minecraft":"fixture-game"},"files":[]}))
            } else {
                ("manifest.json", json!({"name":"测试整合包","minecraft":{"version":"fixture-game","modLoaders":[]},"files":[],"overrides":"overrides"}))
            };
            zip.start_file(entry, zip::write::SimpleFileOptions::default()).unwrap();
            zip.write_all(serde_json::to_string(&value).unwrap().as_bytes()).unwrap();
            zip.start_file("overrides/config/pack.txt", zip::write::SimpleFileOptions::default()).unwrap();
            zip.write_all(b"pack-config").unwrap();
            zip.start_file("icon.png",zip::write::SimpleFileOptions::default()).unwrap();
            zip.write_all(include_bytes!("../../src/assets/loaders/minecraft.png")).unwrap();
            zip.finish().unwrap();
            let installed = import(&core, &json!({"path":path,"id":"existing","name":format,"settings":{"isolation":"shared"}})).await.unwrap();
            assert!(installed["packIcon"].as_str().unwrap().starts_with("data:image/png;base64,"));
            assert_eq!(installed["modpack"],true);
            let saved=read_json(&core.instance(installed["id"].as_str().unwrap()).unwrap().join("kxl.json")).unwrap();
            assert_eq!(saved["packIcon"],installed["packIcon"]);
            assert_ne!(installed["id"], "existing");
            assert_eq!(installed["version"], "fixture-game");
            assert_eq!(installed["settings"]["isolation"], "all");
            assert_eq!(std::fs::read(core.instance(installed["id"].as_str().unwrap()).unwrap().join("config/pack.txt")).unwrap(), b"pack-config");
            assert_eq!(std::fs::read(existing.join("keep.txt")).unwrap(), b"untouched");
        }
        assert_eq!(core.instances().unwrap().as_array().unwrap().len(), 3);
    }
    #[test]
    fn export_standard_formats_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let core = Core::new(tmp.path().join("launcher"), Arc::new(|_| {})).unwrap();
        let instance = core.instance("fabric-test").unwrap();
        std::fs::create_dir_all(instance.join("mods")).unwrap();
        write_json(&instance.join("kxl.json"), &json!({"name":"测试实例","version":"1.20.1","loader":"fabric","loaderVersion":"0.16.10","settings":{"isolation":"all"}})).unwrap();
        write_json(
            &instance.join("version.json"),
            &json!({"id":"fabric-loader-0.16.10-1.20.1"}),
        )
        .unwrap();
        std::fs::write(instance.join("mods").join("example.jar"), b"example mod").unwrap();
        for format in ["mrpack", "universal", "curseforge", "multimc", "kynex"] {
            let target = tmp.path().join(format!("{format}.zip"));
            export(
                &core,
                &json!({"id":"fabric-test","path":target,"include":["mods"],"format":format}),
            )
            .unwrap();
            let info = inspect(&target).unwrap();
            assert_eq!(info["version"], "1.20.1");
            assert_eq!(info["loader"], "fabric");
            let mut zip = archive(&target).unwrap();
            let content = match format {
                "multimc" => ".minecraft/mods/example.jar",
                "kynex" => "mods/example.jar",
                _ => "overrides/mods/example.jar",
            };
            assert!(zip.by_name(content).is_ok(), "{format}");
        }
    }
    #[test]
    fn nested_manifests_and_hmcl_are_detected() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("nested.zip");
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        write_entry(
            &mut zip,
            "wrapped/modpack.json",
            &json!({"name":"HMCL test","gameVersion":"1.20.1"}),
        )
        .unwrap();
        write_entry(&mut zip,"wrapped/minecraft/version.json",&json!({"inheritsFrom":"1.20.1","libraries":[{"name":"net.fabricmc:fabric-loader:0.16.10"}]})).unwrap();
        zip.finish().unwrap();
        let info = inspect(&path).unwrap();
        assert_eq!(info["format"], "hmcl");
        assert_eq!(info["loader"], "fabric");
        assert_eq!(info["root"], "wrapped/minecraft");
    }
    #[test]
    fn export_reads_shared_game_resources() {
        let tmp = tempfile::tempdir().unwrap();
        let core = Core::new(tmp.path().join("launcher"), Arc::new(|_| {})).unwrap();
        let instance = core.instance("test").unwrap();
        std::fs::create_dir_all(&instance).unwrap();
        write_json(&instance.join("kxl.json"), &json!({"name":"test","version":"1.20.1","loader":"vanilla","settings":{"isolation":"shared"}})).unwrap();
        write_json(&instance.join("version.json"), &json!({"id":"1.20.1"})).unwrap();
        let mods = core.root.join("shared").join("mods");
        std::fs::create_dir_all(&mods).unwrap();
        std::fs::write(mods.join("example.jar"), b"example").unwrap();
        let target = tmp.path().join("pack.zip");
        export(
            &core,
            &json!({"id":"test","path":target,"include":["mods"]}),
        )
        .unwrap();
        let mut zip = archive(&target).unwrap();
        assert!(zip.by_name("overrides/mods/example.jar").is_ok());
    }
    #[test]
    fn zip_slip() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("evil.zip");
        let mut w = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        w.start_file("../outside", zip::write::SimpleFileOptions::default())
            .unwrap();
        w.write_all(b"bad").unwrap();
        w.finish().unwrap();
        let mut a = archive(&path).unwrap();
        assert!(safe_extract(&mut a, &tmp.path().join("out"), None).is_err());
        assert!(!tmp.path().join("outside").exists());
    }
}

#[cfg(test)]mod embedded_icon_tests {
 use super::*;
 fn fixture(path:&Path, files:&[(&str,&[u8])]) {
  let mut z=zip::ZipWriter::new(std::fs::File::create(path).unwrap());
  write_entry(&mut z,"wrapped/mmc-pack.json",&json!({"components":[{"uid":"net.minecraft","version":"1.20.1"},{"uid":"net.fabricmc.fabric-loader","version":"0.16.10"}]})).unwrap();
  for (name,bytes) in files {z.start_file(*name,zip::write::SimpleFileOptions::default()).unwrap();z.write_all(bytes).unwrap();}z.finish().unwrap();
 }
 #[test]fn custom_multimc_icon_is_read_and_missing_or_invalid_images_fall_back(){
  let t=tempfile::tempdir().unwrap();let path=t.path().join("pack.zip");let png=include_bytes!("../../src/assets/loaders/minecraft.png");
  fixture(&path,&[("wrapped/instance.cfg",b"iconKey=my-pack
"),("wrapped/icons/my-pack.png",png)]);
  let info=inspect(&path).unwrap();assert_eq!(info["loader"],"fabric");assert!(info["packIcon"].as_str().unwrap().starts_with("data:image/png;base64,"));
  fixture(&path,&[("wrapped/icon.png",b"not-an-image")]);assert!(inspect(&path).unwrap()["packIcon"].is_null());
  fixture(&path,&[]);assert!(inspect(&path).unwrap()["packIcon"].is_null());
 }
 #[test]fn installed_internal_icon_is_found_for_existing_instances(){let t=tempfile::tempdir().unwrap();assert!(installed_icon(t.path()).is_none());std::fs::create_dir(t.path().join("PCL")).unwrap();std::fs::write(t.path().join("PCL/Logo.png"),include_bytes!("../../src/assets/loaders/minecraft.png")).unwrap();assert!(installed_icon(t.path()).unwrap().starts_with("data:image/png;base64,"));}
}
