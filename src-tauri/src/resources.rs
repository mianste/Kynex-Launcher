use crate::*;
use rayon::prelude::*;
use std::collections::{BTreeMap, BTreeSet};
use std::io::{Read, Seek};
type ModMetadata = (Vec<String>, Vec<String>, Vec<String>, String, String);
static RESOURCE_READERS: std::sync::OnceLock<rayon::ThreadPool> = std::sync::OnceLock::new();
static HASH_READERS: std::sync::OnceLock<rayon::ThreadPool> = std::sync::OnceLock::new();
type DetailCache = (usize, std::collections::HashMap<String, Value>);
static DETAIL_CACHE: std::sync::OnceLock<std::sync::Mutex<DetailCache>> = std::sync::OnceLock::new();
pub(crate) fn readers() -> &'static rayon::ThreadPool {
    RESOURCE_READERS.get_or_init(|| rayon::ThreadPoolBuilder::new().num_threads(1).thread_name(|n|format!("resource-reader-{n}")).build().expect("resource reader pool"))
}
// Background fingerprint work must not occupy the reader needed by visible icons.
pub(crate) fn hash_readers()->&'static rayon::ThreadPool {
    HASH_READERS.get_or_init(||rayon::ThreadPoolBuilder::new().num_threads(1).thread_name(|n|format!("mod-fingerprint-{n}")).build().expect("mod fingerprint pool"))
}
// The absolute path prevents collisions between game directories. Sub-second
// timestamps and length invalidate changed files; missing icons are cached too.
fn cached_resource<T: serde::Serialize + serde::de::DeserializeOwned>(core:&Core,path:&Path,kind:&str,load:impl FnOnce()->T)->T {
    try_cached_resource(core,path,kind,||Ok(load())).expect("infallible resource reader")
}
pub(crate) fn try_cached_resource<T: serde::Serialize + serde::de::DeserializeOwned>(core:&Core,path:&Path,kind:&str,load:impl FnOnce()->Result<T>)->Result<T> {
    use sha2::{Digest,Sha256};
    let Ok(stat)=std::fs::metadata(path) else {return load()};
    if !stat.is_file(){return load();}
    let stamp=json!([stat.len(),stat.modified().ok().and_then(|t|t.duration_since(std::time::UNIX_EPOCH).ok()).map(|t|t.as_nanos().to_string())]);
    let key=format!("{:x}",Sha256::digest(format!("v1:{kind}:{}",path.display()).as_bytes()));
    let memory_key=format!("{}:{key}:{stamp}",core.root.display());
    let memory=DETAIL_CACHE.get_or_init(||std::sync::Mutex::new((0,std::collections::HashMap::new())));
    if let Some(value)=memory.lock().unwrap().1.get(&memory_key).cloned(){if let Ok(value)=serde_json::from_value(value){return Ok(value);}}
    let cache=core.root.join("cache/local-resource-details").join(format!("{key}.json"));
    let remember=|value:Value| {
        let bytes=serde_json::to_vec(&value).map(|v|v.len()).unwrap_or(0);
        if bytes>32*1024*1024{return;}
        let mut memory=memory.lock().unwrap();
        if memory.0+bytes>32*1024*1024 || memory.1.len()>=4096 {memory.0=0;memory.1.clear();}
        memory.0+=bytes;memory.1.insert(memory_key.clone(),value);
    };
    if let Ok(v)=read_json(&cache){if v["stamp"]==stamp {if let Ok(value)=serde_json::from_value(v["value"].clone()){remember(v["value"].clone());return Ok(value);}}}
    let value=load()?;
    // A replacement while parsing must never be saved with the old fingerprint.
    if std::fs::metadata(path).ok().is_some_and(|after|after.len()==stat.len() && after.modified().ok()==stat.modified().ok()) {
        let record=json!({"stamp":stamp,"value":value});
        remember(record["value"].clone());
        if let Some(parent)=cache.parent(){let _=std::fs::create_dir_all(parent);}
        let temporary=cache.with_extension(format!("{}.tmp",uuid::Uuid::new_v4()));
        if let Ok(bytes)=serde_json::to_vec(&record){if std::fs::write(&temporary,bytes).is_ok(){let _=std::fs::rename(&temporary,&cache);}let _=std::fs::remove_file(temporary);}
    }
    Ok(value)
}
fn root(core: &Core, id: &str) -> Result<PathBuf> {
    let mut config = read_json(&core.instance(id)?.join("kxl.json"))?;
    config["id"]=json!(id);
    game_directories::running_directory(core,&config)
}
fn order_from(path: &Path) -> Vec<String> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| {
            s.lines().find_map(|line| {
                line.strip_prefix("resourcePacks:")
                    .and_then(|v| serde_json::from_str::<Vec<String>>(v).ok())
            })
        })
        .unwrap_or_else(|| vec!["vanilla".into()])
}
fn write_order(path: &Path, order: &[String]) -> Result<()> {
    let previous = std::fs::read_to_string(path).unwrap_or_default();
    let mut lines: Vec<String> = previous
        .lines()
        .filter(|l| !l.starts_with("resourcePacks:"))
        .map(str::to_string)
        .collect();
    lines.push(format!(
        "resourcePacks:{}",
        serde_json::to_string(order).map_err(err)?
    ));
    let tmp = path.with_extension("txt.tmp");
    std::fs::write(&tmp, lines.join("\n") + "\n").map_err(err)?;
    std::fs::rename(tmp, path).map_err(err)
}
fn metadata<R: Read + Seek>(
    archive: &mut zip::ZipArchive<R>,
    nested: bool,
) -> (Vec<String>, Vec<String>, Vec<String>, String, String) {
    let mut json_value = None;
    for name in ["fabric.mod.json", "quilt.mod.json"] {
        if let Ok(mut f) = archive.by_name(name) {
            if f.size() < 1024 * 1024 {
                let mut s = String::new();
                if f.read_to_string(&mut s).is_ok() {
                    json_value = serde_json::from_str::<Value>(&s).ok();
                    break;
                }
            }
        }
    }
    let Some(v) = json_value else {
        return (vec![], vec![], vec![], String::new(), String::new());
    };
    let icon_path = v["icon"]
        .as_str()
        .or_else(|| v["quilt_loader"]["metadata"]["icon"].as_str())
        .map(str::to_string);
    let v = v.get("quilt_loader").unwrap_or(&v);
    let mut ids = vec![];
    if let Some(id) = v["id"].as_str() {
        ids.push(id.to_string());
    }
    if let Some(provides) = v["provides"].as_array() {
        for p in provides {
            if let Some(id) = p.as_str().or(p["id"].as_str()) {
                ids.push(id.to_string());
            }
        }
    }
    let requires = v["depends"]
        .as_object()
        .map(|m| m.keys().cloned().collect())
        .unwrap_or_default();
    let breaks = v["breaks"]
        .as_object()
        .map(|m| {
            m.iter()
                .filter(|(_, v)| v.as_str() == Some("*"))
                .map(|(k, _)| k.clone())
                .collect()
        })
        .unwrap_or_default();
    let version = v["version"].as_str().unwrap_or("").to_string();
    if !nested {
        if let Some(jars) = v["jars"].as_array() {
            for jar in jars.iter().take(256) {
                if let Some(path) = jar["file"].as_str() {
                    if let Ok(mut f) = archive.by_name(path) {
                        if f.size() < 16 * 1024 * 1024 {
                            let mut data = Vec::new();
                            if f.read_to_end(&mut data).is_ok() {
                                if let Ok(mut child) =
                                    zip::ZipArchive::new(std::io::Cursor::new(data))
                                {
                                    ids.extend(metadata(&mut child, true).0);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    let icon = icon_path
        .and_then(|path| image_from_archive(archive, &path))
        .unwrap_or_default();
    (ids, requires, breaks, version, icon)
}
pub(crate) fn image_data(bytes: Vec<u8>) -> Option<String> {
    use base64::Engine;
    if bytes.len() > 2 * 1024 * 1024 {
        return None;
    }
    let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        "image/jpeg"
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        "image/webp"
    } else {
        return None;
    };
    Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}
fn image_from_archive<R: Read + Seek>(
    archive: &mut zip::ZipArchive<R>,
    path: &str,
) -> Option<String> {
    let mut file = archive.by_name(path.trim_start_matches('/')).ok()?;
    if file.size() > 2 * 1024 * 1024 {
        return None;
    }
    let mut bytes = Vec::with_capacity(file.size() as usize);
    file.read_to_end(&mut bytes).ok()?;
    image_data(bytes)
}
fn icon_from_anywhere<R: Read + Seek>(
    archive: &mut zip::ZipArchive<R>,
) -> Option<String> {
    for index in 0..archive.len() {
        let mut file = archive.by_index(index).ok()?;
        if file.size() > 2 * 1024 * 1024 {
            continue;
        }
        let name = file.name().to_ascii_lowercase();
        if !(name.ends_with("pack.png")
            || name.ends_with("icon.png")
            || name.ends_with("logo.png"))
        {
            continue;
        }
        let mut bytes = Vec::with_capacity(file.size() as usize);
        file.read_to_end(&mut bytes).ok()?;
        if let Some(icon) = image_data(bytes) {
            return Some(icon);
        }
    }
    None
}
fn packaged_icon(path: &Path, kind: &str) -> String {
    let Ok(file) = std::fs::File::open(path) else {
        return String::new();
    };
    let Ok(mut archive) = zip::ZipArchive::new(file) else {
        return String::new();
    };
    if kind == "mods" {
        let icon = metadata(&mut archive, false).4;
        if !icon.is_empty() {
            return icon;
        }
    }
    for candidate in ["pack.png", "icon.png", "server-icon.png"] {
        if let Some(icon) = image_from_archive(&mut archive, candidate) {
            return icon;
        }
    }
    // 很多光影/资源包把图标放在 shaders/ 或子目录里，扫描任意层级的图标文件。
    icon_from_anywhere(&mut archive).unwrap_or_default()
}
pub fn list(core: &Core, p: &Value) -> Result<Value> {
    let mut rows = crate::engine::resources(core, p)?
        .as_array()
        .cloned()
        .unwrap_or_default();
    let kind = string(p, "kind")?;
    let dir = crate::engine::resource_dir(core,p)?;
    if p["basic"]==true {
        if kind=="resourcepacks" {
            let order=order_from(&dir.parent().unwrap().join("options.txt"));
            for row in &mut rows {let index=order.iter().position(|v|v==&format!("file/{}",row["name"].as_str().unwrap_or("")));row["enabled"]=json!(index.is_some());row["order"]=json!(index.unwrap_or(usize::MAX));}
            rows.sort_by_key(|v|v["order"].as_u64().unwrap_or(u64::MAX));
        }
        return Ok(json!(rows));
    }
    let preview=p["previewNames"].as_array();
    if let Some(names)=preview {
        let names:std::collections::HashSet<&str>=names.iter().take(64).filter_map(Value::as_str).collect();
        rows.retain(|row|row["name"].as_str().is_some_and(|name|names.contains(name)));
    }
    let lock = read_json(
        &core
            .instance(string(p, "id")?)?
            .join("installed-projects.json"),
    )
    .unwrap_or_else(|_| json!({}));
    let remote_icons: BTreeMap<String, String> = lock
        .as_object()
        .into_iter()
        .flatten()
        .filter_map(|(_, value)| {
            Some((
                value["file"].as_str()?.to_string(),
                value["icon_url"].as_str()?.to_string(),
            ))
        })
        .collect();
    if kind == "resourcepacks" {
        let order = order_from(&dir.parent().unwrap().join("options.txt"));
        for row in &mut rows {
            let name = string(row, "name")?;
            let key = format!("file/{name}");
            let index = order.iter().position(|v| v == &key);
            row["enabled"] = json!(index.is_some());
            row["order"] = json!(index.unwrap_or(usize::MAX));
        }
        rows.sort_by_key(|v| v["order"].as_u64().unwrap_or(u64::MAX));
    }
    if kind == "mods" {
        if p["basic"]==true {return Ok(json!(rows));}
        let mut metas = BTreeMap::new();
        let mut providers: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        // 并行读取 jar 元数据（含 .disabled）；只有启用的模组参与依赖与冲突判断。
        let found: Vec<(
            String,
            bool,
            (Vec<String>, Vec<String>, Vec<String>, String, String),
        )> = readers().install(|| rows
            .par_iter()
            .filter_map(|row| {
                let name = string(row, "name").ok()?.to_string();
                let enabled = row["enabled"] == true;
                let clean=name.strip_suffix(".disabled").unwrap_or(&name).to_lowercase();
                if row["dir"]==true || !(clean.ends_with(".jar")||clean.ends_with(".litemod")){return None;}
                let path=dir.join(&name);
                let meta:ModMetadata=cached_resource(core,&path,"mods",||{
                let Ok(file) = std::fs::File::open(&path) else{return Default::default()};
                let Ok(mut archive) = zip::ZipArchive::new(file) else{return Default::default()};
                let mut meta = metadata(&mut archive, false);
                // 很多模组没有在 fabric.mod.json/mods.toml 里声明图标，
                // 退回到 jar 内任意层级的 icon.png / logo.png / pack.png。
                if meta.4.is_empty() {
                    meta.4 = icon_from_anywhere(&mut archive).unwrap_or_default();
                }
                meta
                });
                Some((name, enabled, meta))
            })
            .collect());
        for (name, enabled, meta) in found {
            if enabled {
                for id in &meta.0 {
                    providers
                        .entry(id.clone())
                        .or_default()
                        .insert(name.clone());
                }
            }
            metas.insert(name, meta);
        }
        for row in &mut rows {
            let name = string(row, "name")?.to_string();
            let enabled = row["enabled"] == true;
            let mut problems = vec![];
            if let Some((ids, requires, breaks, version, icon)) = metas.get(&name) {
                if enabled && preview.is_none() {
                    for id in ids {
                        if providers.get(id).map(|v| v.len() > 1).unwrap_or(false) {
                            problems.push(format!("重复模组：{id}"));
                        }
                    }
                    for id in requires {
                        if ![
                            "minecraft",
                            "java",
                            "fabricloader",
                            "quilt_loader",
                            "forge",
                            "neoforge",
                        ]
                        .contains(&id.as_str())
                            && !providers.contains_key(id)
                        {
                            problems.push(format!("缺少依赖：{id}"));
                        }
                    }
                    for id in breaks {
                        if providers.contains_key(id) {
                            problems.push(format!("声明冲突：{id}"));
                        }
                    }
                }
                row["version"] = json!(version);
                row["modIds"] = json!(ids);
                if !icon.is_empty() {
                    row["icon_url"] = json!(icon);
                }
            }
            if row["icon_url"].is_null() {
                let clean = name.strip_suffix(".disabled").unwrap_or(&name);
                if let Some(icon) = remote_icons.get(clean) {
                    row["icon_url"] = json!(icon);
                }
            }
            row["problems"] = json!(problems);
        }
    } else if matches!(kind, "resourcepacks" | "shaderpacks" | "datapacks") {
        if p["basic"]==true {return Ok(json!(rows));}
        for row in &mut rows {
            let name = string(row, "name")?.to_string();
            let clean = name.strip_suffix(".disabled").unwrap_or(&name);
            let path = dir.join(&name);
            let icon:String=cached_resource(core,&path,kind,||packaged_icon(&path,kind));
            if !icon.is_empty() {
                row["icon_url"] = json!(icon);
            } else if let Some(icon) = remote_icons.get(clean) {
                row["icon_url"] = json!(icon);
            }
        }
    }
    Ok(json!(rows))
}
pub fn toggle(core: &Core, p: &Value) -> Result<Value> {
    if string(p, "kind")? != "resourcepacks" {
        return crate::engine::toggle_resource(core, p);
    }
    let dir = root(core, string(p, "id")?)?;
    let mut name = string(p, "name")?.to_string();
    safe_name(&name)?;
    if let Some(original) = name.strip_suffix(".disabled") {
        let target = dir.join("resourcepacks").join(original);
        if target.exists() {
            return Err("同名资源包已存在".into());
        }
        std::fs::rename(dir.join("resourcepacks").join(&name), target).map_err(err)?;
        name = original.to_string();
    }
    if !dir.join("resourcepacks").join(&name).exists() {
        return Err("资源包不存在".into());
    }
    let options = dir.join("options.txt");
    let mut order = order_from(&options);
    let key = format!("file/{name}");
    if order.contains(&key) {
        order.retain(|v| v != &key);
    } else {
        order.push(key);
    }
    write_order(&options, &order)?;
    Ok(json!(true))
}
pub fn move_pack(core: &Core, p: &Value) -> Result<Value> {
    let dir = root(core, string(p, "id")?)?;
    let options = dir.join("options.txt");
    let mut order = order_from(&options);
    let name = safe_name(string(p, "name")?)?;
    let key = format!("file/{name}");
    let pos = order
        .iter()
        .position(|v| v == &key)
        .ok_or("请先启用资源包")?;
    let delta = p["direction"].as_i64().unwrap_or(0);
    let next = if delta < 0 {
        pos.checked_sub(1)
    } else if delta > 0 {
        Some(pos + 1)
    } else {
        None
    };
    if let Some(next) = next.filter(|n| *n < order.len() && order[*n].starts_with("file/")) {
        order.swap(pos, next);
        write_order(&options, &order)?;
    }
    list(core, &json!({"id":p["id"],"kind":"resourcepacks"}))
}
pub(crate) fn after_delete(core: &Core, p: &Value, deleted: &[String]) -> Vec<String> {
    let mut warnings = Vec::new();
    let result = (|| -> Result<()> {
        let kind = string(p, "kind")?;
        let dir = engine::resource_dir(core, p)?;
        let game = dir.parent().ok_or("资源目录无效")?;
        let mut names: BTreeSet<_> = deleted.iter().map(String::as_str).collect();
        for name in deleted {
            if let Some(clean) = name.strip_suffix(".disabled").filter(|clean| !dir.join(clean).exists()) {
                names.insert(clean);
            }
        }
        if kind == "resourcepacks" {
            let path = game.join("options.txt");
            if path.exists() {
                let mut order = order_from(&path);
                order.retain(|v| !v.strip_prefix("file/").is_some_and(|n| names.contains(n)));
                write_order(&path, &order)?;
                let text = std::fs::read_to_string(&path).map_err(err)?;
                let lines = text.lines().map(|line| {
                    let Some(value) = line.strip_prefix("incompatibleResourcePacks:") else { return Ok(line.to_owned()); };
                    let mut packs: Vec<String> = serde_json::from_str(value).map_err(err)?;
                    packs.retain(|v| !v.strip_prefix("file/").is_some_and(|n| names.contains(n)));
                    Ok(format!("incompatibleResourcePacks:{}",serde_json::to_string(&packs).map_err(err)?))
                }).collect::<Result<Vec<_>>>()?;
                let temp = path.with_extension("txt.tmp");
                std::fs::write(&temp, lines.join("\n") + "\n").map_err(err)?;
                std::fs::rename(temp, path).map_err(err)?;
            }
        }
        if kind == "shaderpacks" {
            for relative in ["config/iris.properties", "config/oculus.properties", "optionsshaders.txt"] {
                let path = game.join(relative);
                if !path.exists() { continue; }
                let text = std::fs::read_to_string(&path).map_err(err)?;
                let active = text.lines().filter_map(|line| line.split_once('=')).any(|(key,value)| key.trim() == "shaderPack" && names.iter().any(|n| value.trim() == *n || value.trim() == n.replace(' ', "\\ ")));
                if active {
                    let mut lines: Vec<_> = text.lines().filter(|line| !matches!(line.split('=').next().unwrap_or("").trim(), "shaderPack" | "enableShaders")).map(str::to_owned).collect();
                    lines.push("shaderPack=".into());
                    if relative != "optionsshaders.txt" { lines.push("enableShaders=false".into()); }
                    std::fs::write(path, lines.join("\n") + "\n").map_err(err)?;
                }
            }
        }
        let lock_path = if kind == "datapacks" && p["world"].as_str().is_some_and(|w| !w.is_empty()) {
            game.join("kxl-datapacks.json")
        } else { core.instance(string(p, "id")?)?.join("installed-projects.json") };
        if let Ok(mut lock) = read_json(&lock_path) {
            if let Some(entries) = lock.as_object_mut() {
                entries.retain(|_, value| {
                    let Some(file) = value["file"].as_str() else { return true; };
                    // Historical records have no resource kind. Keep ambiguous
                    // records if the same file still exists in another category.
                    !names.contains(file) || ["mods", "resourcepacks", "shaderpacks", "datapacks"].iter().any(|k| game.join(k).join(file).exists())
                });
                write_json(&lock_path, &lock)?;
            }
        }
        Ok(())
    })();
    if let Err(error) = result { warnings.push(format!("文件已删除，配置同步失败：{error}")); }
    warnings
}
pub fn import_file(core: &Core, p: &Value) -> Result<Value> {
    use base64::Engine;
    let kind = string(p, "kind")?;
    let name = safe_name(string(p, "name")?)?;
    let lower = name.to_ascii_lowercase();
    let valid = match kind {
        "mods" => lower.ends_with(".jar"),
        "resourcepacks" | "shaderpacks" | "datapacks" => lower.ends_with(".zip"),
        _ => false,
    };
    if !valid {
        return Err(match kind {
            "mods" => "Mod 目录只接受 .jar 文件".into(),
            "resourcepacks" => "资源包目录只接受 .zip 文件".into(),
            "shaderpacks" => "光影目录只接受 .zip 文件".into(),
            "datapacks" => "数据包目录只接受 .zip 文件".into(),
            _ => "当前分类不支持拖入文件".into(),
        });
    }
    let encoded = string(p, "base64")?;
    if encoded.len() > 168 * 1024 * 1024 {
        return Err("单个资源文件不能大于 120 MB".into());
    }
    let data = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(err)?;
    if data.len() > 120 * 1024 * 1024 {
        return Err("单个资源文件不能大于 120 MB".into());
    }
    let dir = crate::engine::resource_dir(core, p)?;
    std::fs::create_dir_all(&dir).map_err(err)?;
    let target = dir.join(name);
    if target.exists() {
        return Err(format!("{name} 已存在"));
    }
    let temp = dir.join(format!(".{name}.kxl-import"));
    std::fs::write(&temp, data).map_err(err)?;
    std::fs::rename(&temp, &target).map_err(err)?;
    list(core, p)
}
pub fn import_paths(core: &Core, p: &Value) -> Result<Value> {
    let paths = p["paths"].as_array().ok_or("没有可导入的文件")?;
    if paths.is_empty() || paths.len() > 64 {
        return Err("一次请选择 1–64 个资源文件".into());
    }
    let kind = string(p, "kind")?;
    let dir = crate::engine::resource_dir(core, p)?;
    std::fs::create_dir_all(&dir).map_err(err)?;
    for value in paths {
        let source = PathBuf::from(value.as_str().ok_or("文件路径无效")?);
        let metadata = std::fs::metadata(&source).map_err(err)?;
        if !metadata.is_file() || metadata.len() > 120 * 1024 * 1024 {
            return Err("资源必须是小于 120 MB 的文件".into());
        }
        let name = source
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or("文件名无效")?;
        let name = safe_name(name)?;
        let lower = name.to_ascii_lowercase();
        let valid = match kind {
            "mods" => lower.ends_with(".jar"),
            "resourcepacks" | "shaderpacks" | "datapacks" => lower.ends_with(".zip"),
            _ => false,
        };
        if !valid {
            return Err(format!("{name} 不适合当前资源分类"));
        }
        let target = dir.join(name);
        if target.exists() {
            return Err(format!("{name} 已存在"));
        }
        let temp = dir.join(format!(".{name}.kxl-import"));
        std::fs::copy(&source, &temp).map_err(err)?;
        std::fs::rename(&temp, target).map_err(err)?;
    }
    list(core, p)
}
pub async fn ensure_loader_components(core: &Core, p: &Value) -> Result<Value> {
    let id = string(p, "id")?;
    let instance = read_json(&core.instance(id)?.join("kxl.json"))?;
    let loader = instance["loader"].as_str().unwrap_or("vanilla");
    let (project, label, accepted_ids): (&str, &str, &[&str]) = match loader {
        "fabric" => ("fabric-api", "Fabric API", &["fabric-api"]),
        "quilt" => (
            "qsl",
            "Quilt Standard Libraries",
            &["qsl", "quilted_fabric_api"],
        ),
        _ => return Ok(json!({"installed":false,"required":false})),
    };
    let dir = root(core, id)?.join("mods");
    std::fs::create_dir_all(&dir).map_err(err)?;
    for entry in std::fs::read_dir(&dir).map_err(err)?.flatten() {
        if !entry.path().is_file() || entry.file_name().to_string_lossy().ends_with(".disabled") {
            continue;
        }
        let Ok(file) = std::fs::File::open(entry.path()) else {
            continue;
        };
        let Ok(mut archive) = zip::ZipArchive::new(file) else {
            continue;
        };
        let ids = metadata(&mut archive, false).0;
        if ids
            .iter()
            .any(|candidate| accepted_ids.contains(&candidate.as_str()))
        {
            return Ok(json!({"installed":false,"required":true,"present":true,"label":label}));
        }
    }
    crate::engine::install_project(core, &json!({"id":id,"kind":"mods","project":project})).await?;
    Ok(json!({"installed":true,"required":true,"present":true,"label":label}))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn options_preserve_other_settings() {
        let t = tempfile::tempdir().unwrap();
        let path = t.path().join("options.txt");
        std::fs::write(
            &path,
            "fullscreen:true\nresourcePacks:[\"vanilla\"]\nfov:0.5\n",
        )
        .unwrap();
        write_order(&path, &["vanilla".into(), "file/a.zip".into()]).unwrap();
        assert_eq!(order_from(&path), vec!["vanilla", "file/a.zip"]);
        let text = std::fs::read_to_string(path).unwrap();
        assert!(text.contains("fullscreen:true"));
        assert!(text.contains("fov:0.5"));
    }
    #[test]
    fn metadata_reads_real_dependencies() {
        use std::io::Write;
        let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        w.start_file("fabric.mod.json", zip::write::SimpleFileOptions::default())
            .unwrap();
        w.write_all(br#"{"id":"a","version":"1.0","icon":"assets/a.png","depends":{"b":"*"},"breaks":{"c":"*"}}"#)
            .unwrap();
        w.start_file("assets/a.png", zip::write::SimpleFileOptions::default())
            .unwrap();
        w.write_all(b"\x89PNG\r\n\x1a\nfixture").unwrap();
        let data = w.finish().unwrap();
        let mut r = zip::ZipArchive::new(data).unwrap();
        let (ids, deps, conflicts, v, icon) = metadata(&mut r, false);
        assert_eq!(ids, vec!["a"]);
        assert_eq!(deps, vec!["b"]);
        assert_eq!(conflicts, vec!["c"]);
        assert_eq!(v, "1.0");
        assert!(icon.starts_with("data:image/png;base64,"));
    }
    #[test]
    fn detail_cache_keeps_empty_results_and_invalidates_changed_files_and_paths() {
        let t=tempfile::tempdir().unwrap();let c=Core::new(t.path().join("app"),Arc::new(|_|{})).unwrap();
        let one=t.path().join("one/same.zip");let two=t.path().join("two/same.zip");
        for p in [&one,&two]{std::fs::create_dir_all(p.parent().unwrap()).unwrap();std::fs::write(p,b"one").unwrap();}
        let calls=std::sync::atomic::AtomicUsize::new(0);
        let load=||{calls.fetch_add(1,Ordering::Relaxed);String::new()};
        assert_eq!(cached_resource(&c,&one,"icons",load),"");
        assert_eq!(cached_resource(&c,&one,"icons",load),"");assert_eq!(calls.load(Ordering::Relaxed),1);
        let other:String=cached_resource(&c,&two,"icons",||"other".to_string());assert_eq!(other,"other");
        std::fs::write(&one,b"changed length").unwrap();
        let changed:String=cached_resource(&c,&one,"icons",||"new".to_string());assert_eq!(changed,"new");
        let failed:Result<String>=try_cached_resource(&c,&one,"hash-failure",||Err("temporary read error".into()));assert!(failed.is_err());
        assert_eq!(try_cached_resource(&c,&one,"hash-failure",||Ok("retry".to_string())).unwrap(),"retry");
        assert_eq!(readers().current_num_threads()+hash_readers().current_num_threads(),2);
    }
    #[test]
    fn basic_list_does_not_open_mod_archives_and_details_follow_file_changes() {
        let t=tempfile::tempdir().unwrap();let c=Core::new(t.path().into(),Arc::new(|_|{})).unwrap();let dir=c.instance("demo").unwrap();
        write_json(&dir.join("kxl.json"),&json!({"id":"demo","settings":{"isolation":"all"}})).unwrap();std::fs::create_dir_all(dir.join("mods")).unwrap();
        let path=dir.join("mods/a.jar");std::fs::write(&path,mod_jar("a","1",Some("b"))).unwrap();
        std::fs::write(dir.join("mods/b.jar"),mod_jar("b","1",None)).unwrap();
        let p=json!({"id":"demo","kind":"mods"});let mut basic=p.clone();basic["basic"]=json!(true);
        assert!(list(&c,&basic).unwrap()[0]["version"].is_null());assert!(!c.root.join("cache/local-resource-details").exists());
        let mut preview=p.clone();preview["previewNames"]=json!(["a.jar"]);let part=list(&c,&preview).unwrap();assert_eq!(part.as_array().unwrap().len(),1);assert!(part[0]["problems"].as_array().unwrap().is_empty());
        assert_eq!(list(&c,&p).unwrap()[0]["version"],"1");assert_eq!(list(&c,&p).unwrap()[0]["version"],"1");
        std::fs::write(&path,mod_jar("a","changed-version",None)).unwrap();assert_eq!(list(&c,&p).unwrap()[0]["version"],"changed-version");
    }
    #[test]
    #[ignore = "read-only benchmark against an installed large pack; cache is isolated"]
    fn reported_large_pack_resource_timing() {
        let t=tempfile::tempdir().unwrap();let c=Core::new(t.path().into(),Arc::new(|_|{})).unwrap();
        let running=std::env::var("KXL_RESOURCE_BENCH_DIR").unwrap();
        write_json(&c.instance("bench").unwrap().join("kxl.json"),&json!({"id":"bench","settings":{"isolation":"custom","gameDirectory":running}})).unwrap();
        let mut reports=vec![];
        for kind in ["mods","resourcepacks","shaderpacks","saves","datapacks"] {
            if !Path::new(&running).join(kind).is_dir(){continue;}
            let p=json!({"id":"bench","kind":kind});let mut basic=p.clone();basic["basic"]=json!(true);
            let now=std::time::Instant::now();let first=list(&c,&basic).unwrap();let first_ms=now.elapsed().as_millis();
            let mut part=p.clone();part["previewNames"]=json!(first.as_array().unwrap().iter().take(32).map(|r|r["name"].clone()).collect::<Vec<_>>());
            let now=std::time::Instant::now();let icons=list(&c,&part).unwrap();let icon_ms=now.elapsed().as_millis();
            let now=std::time::Instant::now();let details=list(&c,&p).unwrap();let cold_ms=now.elapsed().as_millis();
            let now=std::time::Instant::now();let warm=list(&c,&p).unwrap();let warm_ms=now.elapsed().as_millis();assert_eq!(details,warm);assert_eq!(first.as_array().unwrap().len(),details.as_array().unwrap().len());
            reports.push(json!({"kind":kind,"files":first.as_array().unwrap().len(),"firstListMs":first_ms,"firstIconBatchMs":icon_ms,"firstBatchIcons":icons.as_array().unwrap().iter().filter(|r|r["icon_url"].is_string()).count(),"remainingDetailsMs":cold_ms,"warmDetailsMs":warm_ms}));
        }
        let value=json!({"readOnlyOriginalFiles":true,"readerThreads":readers().current_num_threads()+hash_readers().current_num_threads(),"lists":reports});println!("{value}");
        if let Ok(path)=std::env::var("KXL_RESOURCE_BENCH_REPORT"){write_json(Path::new(&path),&value).unwrap();}
    }

    fn mod_jar(id: &str, version: &str, depends: Option<&str>) -> Vec<u8> {
        use std::io::Write;
        let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        w.start_file("fabric.mod.json", zip::write::SimpleFileOptions::default())
            .unwrap();
        let depends = depends
            .map(|dependency| format!(r#","depends":{{"{dependency}":"*"}}"#))
            .unwrap_or_default();
        w.write_all(format!(r#"{{"id":"{id}","version":"{version}"{depends}}}"#).as_bytes())
            .unwrap();
        w.finish().unwrap().into_inner()
    }

    #[test]
    fn disabled_mods_keep_metadata_but_do_not_satisfy_dependencies() {
        let root = tempfile::tempdir().unwrap();
        let core =
            crate::Core::new(root.path().to_path_buf(), std::sync::Arc::new(|_| {})).unwrap();
        let instance = root.path().join("instances").join("demo");
        std::fs::create_dir_all(instance.join("mods")).unwrap();
        write_json(
            &instance.join("kxl.json"),
            &json!({"id":"demo","name":"demo","version":"1.20.1","loader":"fabric","settings":{"isolation":"independent"}}),
        )
        .unwrap();
        std::fs::write(
            instance.join("mods").join("a.jar"),
            mod_jar("a", "1.0", Some("b")),
        )
        .unwrap();
        std::fs::write(
            instance.join("mods").join("b.jar.disabled"),
            mod_jar("b", "2.0", None),
        )
        .unwrap();

        let rows = list(&core, &json!({"id":"demo","kind":"mods"})).unwrap();
        let rows = rows.as_array().unwrap();
        let a = rows.iter().find(|row| row["name"] == "a.jar").unwrap();
        let b = rows
            .iter()
            .find(|row| row["name"] == "b.jar.disabled")
            .unwrap();
        // 禁用模组仍要读出元数据，界面才能显示版本和图标。
        assert_eq!(b["enabled"], false);
        assert_eq!(b["version"], "2.0");
        assert_eq!(b["modIds"], json!(["b"]));
        // 但禁用文件不参与依赖解析，a 仍然缺少 b。
        assert_eq!(a["enabled"], true);
        assert!(a["problems"]
            .as_array()
            .unwrap()
            .iter()
            .any(|problem| problem.as_str().unwrap_or("").contains("缺少依赖：b")));
        assert!(b["problems"].as_array().unwrap().is_empty());
    }
}
