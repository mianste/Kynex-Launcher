use crate::*;
use std::collections::BTreeSet;

fn is_link(metadata: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}
pub(crate) fn selected_paths(core: &Core, p: &Value) -> Result<Vec<(String, PathBuf)>> {
    if !matches!(
        string(p, "kind")?,
        "mods" | "resourcepacks" | "shaderpacks" | "datapacks"
    ) {
        return Err("此分类不支持删除资源".into());
    }
    let dir = engine::resource_dir(core, p)?;
    let root = core.root.canonicalize().map_err(err)?;
    let parent = dir
        .parent()
        .ok_or("资源目录无效")?
        .canonicalize()
        .map_err(err)?;
    let canonical = dir.canonicalize().map_err(err)?;
    if !parent.starts_with(&root)
        || canonical.parent() != Some(parent.as_path())
        || is_link(&std::fs::symlink_metadata(&dir).map_err(err)?)
    {
        return Err("资源目录不能指向实例以外的位置".into());
    }
    let names = p["names"].as_array().ok_or("请选择要删除的资源")?;
    if names.is_empty() || names.len() > 10_000 {
        return Err("请选择 1–10000 个资源".into());
    }
    let mut seen = BTreeSet::new();
    let mut paths = Vec::new();
    // Validate the entire batch before touching any file. Names come from the
    // actual directory and can exceed the instance-name limit of 128 bytes.
    for value in names {
        let name = value.as_str().ok_or("资源文件名无效")?;
        if name.is_empty()
            || name == "."
            || name == ".."
            || name.encode_utf16().count() > 255
            || name.ends_with(['.', ' '])
            || name
                .chars()
                .any(|c| c.is_control() || "/\\:*?\"<>|".contains(c))
        {
            return Err("资源文件名无效".into());
        }
        if !seen.insert(name.to_lowercase()) {
            continue;
        }
        let path = dir.join(name);
        let meta =
            std::fs::symlink_metadata(&path).map_err(|_| format!("{name} 已不存在，请刷新列表"))?;
        if is_link(&meta)
            || (!meta.is_file() && !meta.is_dir())
            || path.canonicalize().map_err(err)?.parent() != Some(canonical.as_path())
        {
            return Err(format!("不能删除指向其他位置的资源：{name}"));
        }
        paths.push((name.into(), path));
    }
    Ok(paths)
}

pub async fn remove(core: &Core, p: &Value) -> Result<Value> {
    let instance_lock = core.jobs.instance_lock(string(p, "id")?);
    let _instance = instance_lock
        .try_lock()
        .map_err(|_| "实例正在执行任务，请完成后再删除")?;
    let dir = engine::resource_dir(core, p)?;
    let lock = core.jobs.file_lock(&dir);
    let _guard = lock
        .try_lock()
        .map_err(|_| "资源正在安装或更新，请完成后再删除")?;
    let mut file_guards = Vec::new();
    for (_, path) in selected_paths(core, p)? {
        file_guards.push(
            core.jobs
                .file_lock(&path)
                .try_lock_owned()
                .map_err(|_| "所选资源正在下载，请完成后再删除")?,
        );
    }
    let core = core.clone();
    let p = p.clone();
    tokio::task::spawn_blocking(move || {
        remove_with(&core, &p, |path| trash::delete(path).map_err(err))
    })
    .await
    .map_err(err)?
}

fn remove_with(
    core: &Core,
    p: &Value,
    mut recycle: impl FnMut(&Path) -> Result<()>,
) -> Result<Value> {
    let paths = selected_paths(core, p)?;
    let mut deleted = Vec::new();
    let mut failed = Vec::new();
    for (name, path) in paths {
        // The OS trash API never falls back here to permanent deletion.
        match recycle(&path) {
            Ok(()) if !path.exists() => deleted.push(name),
            Ok(()) => failed.push(json!({"name":name,"error":"文件仍存在，可能被游戏占用"})),
            Err(error) => failed.push(json!({"name":name,"error":error})),
        }
    }
    let mut warnings = Vec::new();
    if !deleted.is_empty() {
        warnings = resources::after_delete(core, p, &deleted);
    }
    Ok(json!({"deleted":deleted,"failed":failed,"warnings":warnings}))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (tempfile::TempDir, Core, PathBuf) {
        let t = tempfile::tempdir().unwrap();
        let c = Core::new(t.path().into(), Arc::new(|_| {})).unwrap();
        let instance = c.instance("a").unwrap();
        write_json(
            &instance.join("kxl.json"),
            &json!({"id":"a","version":"1.20.1","loader":"fabric","settings":{"isolation":"all"}}),
        )
        .unwrap();
        (t, c, instance)
    }
    #[tokio::test]
    async fn delete_cannot_race_installs_or_downloads() {
        let (_t, c, instance) = fixture();
        let dir = instance.join("mods");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("a.jar");
        std::fs::write(&path, b"a").unwrap();
        let p = json!({"id":"a","kind":"mods","names":["a.jar"]});
        let job = c.jobs.start("install_project", &p);
        let guard = job.target.lock().await;
        assert!(remove(&c, &p).await.unwrap_err().contains("实例正在"));
        drop(guard);
        let file = c.jobs.file_lock(&path);
        let guard = file.lock().await;
        assert!(remove(&c, &p).await.unwrap_err().contains("正在下载"));
        drop(guard);
        assert!(path.is_file());
    }
    #[test]
    fn long_resource_names_and_shader_settings_are_supported() {
        let (_t, c, instance) = fixture();
        let dir = instance.join("shaderpacks");
        std::fs::create_dir_all(&dir).unwrap();
        let name = format!("{}.zip", "s".repeat(140));
        std::fs::write(dir.join(&name), b"shader").unwrap();
        std::fs::create_dir_all(instance.join("config")).unwrap();
        std::fs::write(
            instance.join("config/iris.properties"),
            format!("shaderPack={name}\nenableShaders=true\nmaxShadowRenderDistance=12\n"),
        )
        .unwrap();
        let result = remove_with(
            &c,
            &json!({"id":"a","kind":"shaderpacks","names":[name]}),
            |path| std::fs::rename(path, instance.join("recycled.zip")).map_err(err),
        )
        .unwrap();
        assert_eq!(result["deleted"].as_array().unwrap().len(), 1);
        let text = std::fs::read_to_string(instance.join("config/iris.properties")).unwrap();
        assert!(text.contains("enableShaders=false"));
        assert!(text.contains("maxShadowRenderDistance=12"));
    }
    #[test]
    fn deleting_disabled_copy_preserves_active_pack_and_shared_scope() {
        let (_t, c, instance) = fixture();
        let mut config = read_json(&instance.join("kxl.json")).unwrap();
        config["settings"]["isolation"] = json!("shared");
        write_json(&instance.join("kxl.json"), &config).unwrap();
        let game = c.root.join("shared");
        let dir = game.join("resourcepacks");
        std::fs::create_dir_all(&dir).unwrap();
        for name in ["a.zip", "a.zip.disabled"] {
            std::fs::write(dir.join(name), b"pack").unwrap();
        }
        std::fs::write(game.join("options.txt"),"resourcePacks:[\"vanilla\",\"file/a.zip\"]\nincompatibleResourcePacks:[\"file/a.zip\"]\n").unwrap();
        let result = remove_with(
            &c,
            &json!({"id":"a","kind":"resourcepacks","names":["a.zip.disabled"]}),
            |path| std::fs::rename(path, instance.join("disabled-backup.zip")).map_err(err),
        )
        .unwrap();
        assert_eq!(result["deleted"], json!(["a.zip.disabled"]));
        assert!(dir.join("a.zip").exists());
        assert!(std::fs::read_to_string(game.join("options.txt"))
            .unwrap()
            .contains("file/a.zip"));
        remove_with(
            &c,
            &json!({"id":"a","kind":"resourcepacks","names":["a.zip"]}),
            |path| std::fs::rename(path, instance.join("active-backup.zip")).map_err(err),
        )
        .unwrap();
        assert!(!std::fs::read_to_string(game.join("options.txt"))
            .unwrap()
            .contains("file/a.zip"));
    }
    #[test]
    fn validates_whole_batch_and_leaves_unselected_files() {
        let (_t, c, instance) = fixture();
        let dir = instance.join("mods");
        std::fs::create_dir_all(&dir).unwrap();
        for name in ["a.jar", "b.jar.disabled", "keep.jar"] {
            std::fs::write(dir.join(name), name).unwrap();
        }
        let p = json!({"id":"a","kind":"mods","names":["a.jar","../keep.jar"]});
        assert!(remove_with(&c, &p, |_| panic!("invalid batch must not delete anything")).is_err());
        let recycle = _t.path().join("recycled");
        std::fs::create_dir_all(&recycle).unwrap();
        let result = remove_with(
            &c,
            &json!({"id":"a","kind":"mods","names":["a.jar","a.jar","b.jar.disabled"]}),
            |path| std::fs::rename(path, recycle.join(path.file_name().unwrap())).map_err(err),
        )
        .unwrap();
        assert_eq!(result["deleted"].as_array().unwrap().len(), 2);
        assert!(dir.join("keep.jar").is_file());
        assert!(recycle.join("b.jar.disabled").is_file());
    }
    #[test]
    fn partial_failures_keep_failed_resources_and_clear_only_successful_records() {
        let (_t, c, instance) = fixture();
        let dir = instance.join("resourcepacks");
        std::fs::create_dir_all(&dir).unwrap();
        for name in ["a.zip", "locked.zip"] {
            std::fs::write(dir.join(name), name).unwrap();
        }
        std::fs::write(
            instance.join("options.txt"),
            "fov:0.5\nresourcePacks:[\"vanilla\",\"file/a.zip\",\"file/locked.zip\"]\n",
        )
        .unwrap();
        let result = remove_with(
            &c,
            &json!({"id":"a","kind":"resourcepacks","names":["a.zip","locked.zip"]}),
            |path| {
                if path.ends_with("locked.zip") {
                    Err("文件被占用".into())
                } else {
                    std::fs::rename(path, instance.join("recycled.zip")).map_err(err)
                }
            },
        )
        .unwrap();
        assert_eq!(result["deleted"], json!(["a.zip"]));
        assert_eq!(result["failed"][0]["name"], "locked.zip");
        let options = std::fs::read_to_string(instance.join("options.txt")).unwrap();
        assert!(options.contains("fov:0.5"));
        assert!(!options.contains("file/a.zip"));
        assert!(options.contains("file/locked.zip"));
    }
    #[test]
    fn data_pack_world_scope_and_non_resource_categories_are_checked() {
        let (_t, c, instance) = fixture();
        for world in ["one", "two"] {
            let path = instance.join("saves").join(world);
            std::fs::create_dir_all(path.join("datapacks")).unwrap();
            std::fs::write(path.join("level.dat"), b"world").unwrap();
            std::fs::write(path.join("datapacks/pack.zip"), world).unwrap();
        }
        let paths = selected_paths(
            &c,
            &json!({"id":"a","kind":"datapacks","world":"one","names":["pack.zip"]}),
        )
        .unwrap();
        assert_eq!(std::fs::read(&paths[0].1).unwrap(), b"one");
        assert!(selected_paths(&c, &json!({"id":"a","kind":"saves","names":["one"]})).is_err());
        assert!(selected_paths(
            &c,
            &json!({"id":"a","kind":"datapacks","world":"../two","names":["pack.zip"]})
        )
        .is_err());
    }
}
