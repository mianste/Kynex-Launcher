use crate::*;
use rayon::prelude::*;
use std::collections::{BTreeMap, BTreeSet};
use std::io::{Read, Seek};
fn root(core: &Core, id: &str) -> Result<PathBuf> {
    let config = read_json(&core.instance(id)?.join("kxl.json"))?;
    Ok(
        if config["settings"]["isolation"] == "shared"
            || (config["settings"]["isolation"] == "modded" && config["loader"] == "vanilla")
        {
            core.root.join("shared")
        } else {
            core.instance(id)?
        },
    )
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
fn image_data(bytes: Vec<u8>) -> Option<String> {
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
fn packaged_icon(path: &Path, kind: &str) -> String {
    let Ok(file) = std::fs::File::open(path) else {
        return String::new();
    };
    let Ok(mut archive) = zip::ZipArchive::new(file) else {
        return String::new();
    };
    if kind == "mods" {
        return metadata(&mut archive, false).4;
    }
    for candidate in ["pack.png", "icon.png", "server-icon.png"] {
        if let Some(icon) = image_from_archive(&mut archive, candidate) {
            return icon;
        }
    }
    String::new()
}
pub fn list(core: &Core, p: &Value) -> Result<Value> {
    let mut rows = crate::engine::resources(core, p)?
        .as_array()
        .cloned()
        .unwrap_or_default();
    let kind = string(p, "kind")?;
    let dir = root(core, string(p, "id")?)?.join(kind);
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
        let mut metas = BTreeMap::new();
        let mut providers: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        // 并行读取 jar 元数据；模组较多时比逐个解压快很多。
        let found: Vec<(
            String,
            (Vec<String>, Vec<String>, Vec<String>, String, String),
        )> = rows
            .par_iter()
            .filter(|row| row["enabled"] == true)
            .filter_map(|row| {
                let name = string(row, "name").ok()?.to_string();
                let file = std::fs::File::open(dir.join(&name)).ok()?;
                let mut archive = zip::ZipArchive::new(file).ok()?;
                Some((name, metadata(&mut archive, false)))
            })
            .collect();
        for (name, meta) in found {
            for id in &meta.0 {
                providers
                    .entry(id.clone())
                    .or_default()
                    .insert(name.clone());
            }
            metas.insert(name, meta);
        }
        for row in &mut rows {
            let name = string(row, "name")?.to_string();
            let mut problems = vec![];
            if let Some((ids, requires, breaks, version, icon)) = metas.get(&name) {
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
                row["version"] = json!(version);
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
        for row in &mut rows {
            let name = string(row, "name")?.to_string();
            let clean = name.strip_suffix(".disabled").unwrap_or(&name);
            let icon = packaged_icon(&dir.join(&name), kind);
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
}
