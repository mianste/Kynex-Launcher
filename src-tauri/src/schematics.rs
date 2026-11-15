use crate::{err, read_json, resource_delete, string, Result};
use serde_json::{json, Value};
use std::{
    collections::BTreeSet,
    fs::{self, File},
    io::{self, ErrorKind, Read},
    path::{Path, PathBuf},
};

pub(crate) const KIND: &str = "schematics";

pub(crate) fn directory(game: &Path) -> Result<PathBuf> {
    let config = read_json(&game.join("config/litematica.json")).unwrap_or(Value::Null);
    let settings = &config["Generic"];
    if settings["customSchematicBaseDirectoryEnabled"] != true {
        return Ok(game.join(KIND));
    }
    let path = settings["customSchematicBaseDirectory"]
        .as_str()
        .filter(|path| !path.trim().is_empty())
        .ok_or("请在 Litematica 中设置有效的自定义投影目录")?;
    Ok(game.join(path))
}

fn supports(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ["litematic", "schematic", "schem", "nbt"].iter().any(|allowed| ext.eq_ignore_ascii_case(allowed)))
}

fn directory_exists(dir: &Path) -> Result<bool> {
    match fs::symlink_metadata(dir) {
        Ok(meta) if meta.is_dir() && !resource_delete::is_link(&meta) => Ok(true),
        Ok(_) => Err("投影目录必须是实际文件夹".into()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(error) => Err(err(error)),
    }
}

pub(crate) fn ensure_directory(dir: &Path) -> Result<()> {
    if !directory_exists(dir)? {
        fs::create_dir_all(dir).map_err(err)?;
        if !directory_exists(dir)? {
            return Err("无法创建投影目录".into());
        }
    }
    Ok(())
}

pub(crate) fn list(dir: &Path) -> Result<Value> {
    if !directory_exists(dir)? {
        return Ok(json!([]));
    }
    let mut folders = vec![(dir.to_path_buf(), String::new())];
    let mut rows = Vec::new();
    while let Some((folder, prefix)) = folders.pop() {
        for entry in fs::read_dir(&folder).map_err(err)?.flatten() {
            let Some(name) = entry.file_name().into_string().ok().filter(|name| resource_delete::valid_name(name)) else { continue; };
            let Ok(meta) = entry.metadata() else { continue; };
            if resource_delete::is_link(&meta) {
                continue;
            }
            let relative = format!("{prefix}{name}");
            if meta.is_dir() {
                folders.push((entry.path(), format!("{relative}/")));
            } else if meta.is_file() && supports(&name) {
                let modified = meta.modified().ok()
                    .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|time| time.as_millis() as u64);
                rows.push((relative, meta.len(), modified));
            }
        }
    }
    rows.sort_by(|a, b| a.0.cmp(&b.0));
    let rows: Vec<_> = rows.into_iter().map(|(name, size, modified)| {
        json!({"name":name,"size":size,"modified":modified,"enabled":true,"dir":false,"directory":dir})
    }).collect();
    Ok(json!(rows))
}

pub(crate) fn selected_paths(dir: &Path, names: &[Value]) -> Result<Vec<(String, PathBuf)>> {
    if !directory_exists(dir)? {
        return Err("投影文件夹不存在，请刷新列表".into());
    }
    let root = dir.canonicalize().map_err(err)?;
    let mut seen = BTreeSet::new();
    let mut paths = Vec::new();
    for value in names {
        let name = value.as_str().ok_or("投影文件名无效")?;
        if !supports(name) || !name.split('/').all(resource_delete::valid_name) {
            return Err("投影文件名无效".into());
        }
        if !seen.insert(name.to_lowercase()) {
            continue;
        }
        let path = dir.join(name);
        for ancestor in path.ancestors().take_while(|candidate| *candidate != dir) {
            let meta = fs::symlink_metadata(ancestor).map_err(|_| format!("{name} 已不存在，请刷新列表"))?;
            if resource_delete::is_link(&meta) || (ancestor == path && !meta.is_file()) {
                return Err(format!("不能访问此投影文件：{name}"));
            }
        }
        if !path.canonicalize().map_err(err)?.starts_with(&root) {
            return Err(format!("文件位于投影目录之外：{name}"));
        }
        paths.push((name.to_owned(), path));
    }
    Ok(paths)
}

fn destination(dir: &Path, name: &str) -> Result<PathBuf> {
    if !resource_delete::valid_name(name) || !supports(name) {
        return Err(format!("不支持的投影文件：{name}"));
    }
    let target = dir.join(name);
    match fs::symlink_metadata(&target) {
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(target),
        Err(error) => Err(err(error)),
        Ok(_) => Err(format!("{name} 已存在")),
    }
}

fn stage_file(dir: &Path, mut source: impl Read) -> Result<tempfile::NamedTempFile> {
    let mut temporary = tempfile::NamedTempFile::new_in(dir).map_err(err)?;
    io::copy(&mut source, temporary.as_file_mut()).map_err(err)?;
    Ok(temporary)
}

pub(crate) fn import_file(dir: &Path, payload: &Value) -> Result<Value> {
    let data = crate::resources::decode_resource(payload)?;
    save_file(dir, string(payload, "name")?, data.as_slice())?;
    list(dir)
}

pub(crate) fn save_file(dir: &Path, name: &str, source: impl Read) -> Result<()> {
    let target = destination(dir, name)?;
    ensure_directory(dir)?;
    stage_file(dir, source)?.persist_noclobber(target).map_err(err)?;
    Ok(())
}

pub(crate) fn import_paths(dir: &Path, payload: &Value) -> Result<Value> {
    let paths = payload["paths"].as_array().ok_or("没有可导入的投影文件")?;
    if paths.is_empty() || paths.len() > 64 {
        return Err("一次请选择 1–64 个投影文件".into());
    }
    let mut seen = BTreeSet::new();
    let mut sources = Vec::new();
    for value in paths {
        let source = PathBuf::from(value.as_str().ok_or("文件路径无效")?);
        let name = source.file_name().and_then(|name| name.to_str()).ok_or("文件名无效")?;
        let target = destination(dir, name)?;
        if !seen.insert(name.to_lowercase()) {
            return Err(format!("所选文件中有同名投影：{name}"));
        }
        if !source.is_file() {
            return Err(format!("无法读取投影文件：{name}"));
        }
        sources.push((source, target));
    }
    ensure_directory(dir)?;
    let mut staged = Vec::new();
    for (source, target) in sources {
        staged.push((stage_file(dir, File::open(source).map_err(err)?)?, target));
    }
    for (imported, (temporary, target)) in staged.into_iter().enumerate() {
        temporary.persist_noclobber(&target).map_err(|error| {
            format!("已导入 {imported} 个文件。无法导入 {}：{error}", target.file_name().unwrap_or_default().to_string_lossy())
        })?;
    }
    list(dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{write_json, Core};
    use std::sync::Arc;

    #[tokio::test]
    async fn imports_and_lists_builds_in_the_active_schematic_directory() {
        let temp = tempfile::tempdir().unwrap();
        let core = Core::new(temp.path().join("launcher"), Arc::new(|_| {})).unwrap();
        let instance = core.instance("builds").unwrap();
        let running = temp.path().join("instance-game");
        let schematics = temp.path().join("投影库");
        write_json(&instance.join("kxl.json"), &json!({"id":"builds","settings":{"isolation":"custom","gameDirectory":running}})).unwrap();
        let request = json!({"id":"builds","kind":KIND,"basic":true});
        assert_eq!(core.dispatch("resources", request).await.unwrap(), json!([]));
        assert!(!running.join(KIND).exists());
        write_json(&running.join("config/litematica.json"), &json!({"Generic":{
            "customSchematicBaseDirectoryEnabled":true,"customSchematicBaseDirectory":schematics,
        }})).unwrap();
        fs::create_dir_all(schematics.join("村庄")).unwrap();
        fs::write(schematics.join("村庄/小屋.LITEMATIC"), b"house").unwrap();
        fs::write(schematics.join("notes.txt"), b"notes").unwrap();
        let source = temp.path().join("塔.schem");
        fs::write(&source, b"tower").unwrap();
        let paths = json!({"id":"builds","kind":KIND,"paths":[source]});
        let imported = core.dispatch("import_resource_paths", paths.clone()).await.unwrap();
        let names: BTreeSet<_> = imported.as_array().unwrap().iter().map(|row| row["name"].as_str().unwrap()).collect();
        assert_eq!(names, BTreeSet::from(["村庄/小屋.LITEMATIC", "塔.schem"]));
        assert_eq!(fs::read(schematics.join("塔.schem")).unwrap(), b"tower");
        assert!(!running.join(KIND).exists());
        assert!(core.dispatch("import_resource_paths", paths).await.is_err());
        assert!(core.dispatch("toggle_resource", json!({"id":"builds","kind":KIND,"name":"塔.schem"})).await.is_err());
        let bridge = temp.path().join("桥.nbt");
        fs::write(&bridge, b"bridge").unwrap();
        let paths = json!({"id":"builds","kind":KIND,"paths":[bridge, schematics.join("notes.txt")]});
        assert!(core.dispatch("import_resource_paths", paths).await.is_err());
        assert!(!schematics.join("桥.nbt").exists());
        let dropped = json!({"id":"builds","kind":KIND,"name":"桥.nbt","base64":"YnJpZGdl"});
        core.dispatch("import_resource", dropped).await.unwrap();
        assert_eq!(fs::read(schematics.join("桥.nbt")).unwrap(), b"bridge");
    }
}
