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
    let versions = crate::jobs::wait(core, core.get(url.as_str())).await??;
    let rows = versions.as_array().ok_or("整合包版本清单无效")?;
    let version = rows.iter().find(|v| v["version_type"] == "release").or(rows.first()).ok_or("没有可安装的整合包版本")?;
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
        import(core, &json!({"path":path,"name":p["name"],"settings":p["settings"]})).await
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
fn version_details(v: &Value) -> (String, String, String) {
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
    let mut install = json!({"name":p["name"].as_str().or(info["name"].as_str()).ok_or("包名缺失")?,"version":info["version"],"loader":info["loader"],"loaderVersion":info["loaderVersion"],"settings":settings});
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
                let url = f["downloads"]
                    .as_array()
                    .and_then(|a| a.first())
                    .and_then(Value::as_str)
                    .ok_or("包文件缺少下载地址")?;
                let host = reqwest::Url::parse(url)
                    .map_err(err)?
                    .host_str()
                    .unwrap_or("")
                    .to_string();
                if ![
                    "cdn.modrinth.com",
                    "github.com",
                    "raw.githubusercontent.com",
                ]
                .contains(&host.as_str())
                {
                    return Err(format!("不支持的包下载域名：{host}"));
                }
                let hash = f["hashes"]["sha1"]
                    .as_str()
                    .ok_or("包文件缺少 SHA-1 校验")?;
                crate::engine::download(&c, url, &dir.join(path), hash).await?;
                c.stage("安装整合包资源", count.fetch_add(1, Ordering::Relaxed) + 1, total);
                Ok::<_, String>(())
                }
            })).buffer_unordered(8).try_collect::<Vec<_>>().await?;
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
            })).buffer_unordered(8).try_collect::<Vec<_>>().await?;
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
        Ok(instance)
    }
    .await;
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&dir);
    }
    result
}
fn extract_game_resources(
    z: &mut zip::ZipArchive<std::fs::File>,
    dir: &Path,
    root: &str,
) -> Result<()> {
    for kind in [
        "mods",
        "config",
        "saves",
        "resourcepacks",
        "shaderpacks",
        "datapacks",
        "defaultconfigs",
        "kubejs",
        "scripts",
    ] {
        let prefix = if root.is_empty() {
            kind.to_string()
        } else {
            format!("{root}/{kind}")
        };
        safe_extract(z, &dir.join(kind), Some(&prefix))?;
    }
    Ok(())
}
fn add_tree(
    w: &mut zip::ZipWriter<std::fs::File>,
    root: &Path,
    dir: &Path,
    prefix: &str,
) -> Result<()> {
    for e in std::fs::read_dir(dir).map_err(err)?.flatten() {
        if e.file_type().map_err(err)?.is_symlink() {
            continue;
        }
        let path = e.path();
        if path.is_dir() {
            add_tree(w, root, &path, prefix)?
        } else {
            let name = path
                .strip_prefix(root)
                .map_err(err)?
                .to_string_lossy()
                .replace('\\', "/");
            w.start_file(
                format!("{prefix}{name}"),
                zip::write::SimpleFileOptions::default()
                    .compression_method(zip::CompressionMethod::Deflated),
            )
            .map_err(err)?;
            std::io::copy(&mut std::fs::File::open(path).map_err(err)?, w).map_err(err)?;
        }
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
    let target = PathBuf::from(string(p, "path")?);
    if target.starts_with(&dir) || target.starts_with(game_dir) {
        return Err("导出位置必须在游戏目录外".into());
    }
    let temp = target.with_extension("zip.part");
    let file = std::fs::File::create(&temp).map_err(err)?;
    let mut w = zip::ZipWriter::new(file);
    let format = p["format"].as_str().unwrap_or("mrpack");
    let loader = info["loader"].as_str().unwrap_or("vanilla");
    let loader_version = info["loaderVersion"].as_str().unwrap_or("");
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
                &json!({"formatVersion":1,"game":"minecraft","versionId":"1.0.0","name":info["name"],"files":[],"dependencies":deps}),
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
    for name in p["include"]
        .as_array()
        .ok_or("请选择导出内容")?
        .iter()
        .filter_map(Value::as_str)
    {
        if ![
            "mods",
            "config",
            "saves",
            "resourcepacks",
            "shaderpacks",
            "datapacks",
        ]
        .contains(&name)
        {
            return Err("不允许导出该目录".into());
        }
        let sub = game_dir.join(name);
        if sub.is_dir() {
            add_tree(&mut w, game_dir, &sub, prefix)?;
        }
    }
    if p["include"]
        .as_array()
        .map(|items| items.iter().any(|v| v == "config"))
        .unwrap_or(false)
    {
        for name in ["defaultconfigs", "kubejs", "scripts"] {
            let sub = game_dir.join(name);
            if sub.is_dir() {
                add_tree(&mut w, game_dir, &sub, prefix)?;
            }
        }
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
        &json!({"minecraft":{"version":info["version"],"modLoaders":loaders},"manifestType":"minecraftModpack","manifestVersion":1,"name":info["name"],"version":"1.0.0","author":"","files":[],"overrides":"overrides"}),
    )
}
#[cfg(test)]
mod tests {
    use super::*;
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
            zip.finish().unwrap();
            let installed = import(&core, &json!({"path":path,"id":"existing","name":format,"settings":{"isolation":"shared"}})).await.unwrap();
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
