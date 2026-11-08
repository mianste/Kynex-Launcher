use crate::*;
use sha1::{Digest, Sha1};
use std::io::Read;

pub(crate) fn hash_file(c: &Core, path: &Path) -> Result<(String, u64)> {
    let mut file = std::fs::File::open(path).map_err(err)?;
    let mut hash = Sha1::new();
    let mut size = 0u64;
    let mut buffer = [0u8; 65536];
    loop {
        c.stopped()?;
        let count = file.read(&mut buffer).map_err(err)?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
        size += count as u64;
    }
    Ok((format!("{:x}", hash.finalize()), size))
}
use std::collections::{BTreeMap, BTreeSet};

pub(crate) const ROOTS: &[&str] = &[
    "mods",
    "config",
    "defaultconfigs",
    "configureddefaults",
    "kubejs",
    "scripts",
    "openloader",
    "global_packs",
    "global_resource_packs",
    "global_data_packs",
    "resources",
    "structures",
    "patchouli_books",
    "resourcepacks",
    "texturepacks",
    "shaderpacks",
    "saves",
    "datapacks",
    "journeymap",
    "xaero",
    "XaeroWaypoints",
    "XaeroWorldMap",
];
pub(crate) fn category(path: &str) -> Option<&'static str> {
    let p = path.to_lowercase();
    let base = p.rsplit('/').next().unwrap_or("");
    if [
        "accounts.json",
        "launcher_accounts.json",
        "launcher_profiles.json",
        "microsoft_accounts.json",
        "credentials.json",
        "tokens.json",
        "usercache.json",
        "usernamecache.json",
        "servers.dat",
        "servers.dat_old",
        "kxl.json",
        "version.json",
        ".env",
    ]
    .contains(&base)
        || p.split('/')
            .any(|v| ["logs", "crash-reports", ".git", ".connector"].contains(&v))
    {
        return None;
    }
    if [
        "license",
        "license.md",
        "license.txt",
        "copying",
        "copying.txt",
    ]
    .contains(&p.as_str())
    {
        return Some("license");
    }
    if ["options.txt", "optionsof.txt", "optionsshaders.txt"].contains(&p.as_str())
        || p.starts_with("configureddefaults/")
    {
        return Some("options");
    }
    if p.starts_with("mods/") {
        return Some(if p.ends_with(".disabled") || p.ends_with(".old") {
            "disabledMods"
        } else {
            "mods"
        });
    }
    if p.starts_with("config/jei/world/")
        || p.starts_with("config/jei/") && base.contains("bookmark")
    {
        return Some("jeiData");
    }
    if p.starts_with("journeymap/data/")
        || ["xaero/", "xaerowaypoints/", "xaeroworldmap/"]
            .iter()
            .any(|v| p.starts_with(v))
    {
        return Some("mapData");
    }
    if ["config/", "defaultconfigs/", "journeymap/config/"]
        .iter()
        .any(|v| p.starts_with(v))
    {
        return Some("config");
    }
    if [
        "kubejs/",
        "scripts/",
        "openloader/",
        "global_packs/",
        "global_resource_packs/",
        "global_data_packs/",
        "resources/",
        "structures/",
        "patchouli_books/",
    ]
    .iter()
    .any(|v| p.starts_with(v))
    {
        return Some("important");
    }
    for (root, id) in [
        ("resourcepacks/", "resourcepacks"),
        ("texturepacks/", "resourcepacks"),
        ("shaderpacks/", "shaderpacks"),
        ("saves/", "saves"),
        ("datapacks/", "datapacks"),
    ] {
        if p.starts_with(root) {
            return Some(id);
        }
    }
    None
}
fn linked(meta: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        meta.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        meta.file_type().is_symlink()
    }
}
fn game_root(c: &Core, id: &str) -> Result<PathBuf> {
    let mods = engine::resource_dir(c, &json!({"id":id,"kind":"mods"}))?;
    Ok(mods.parent().ok_or("游戏目录无效")?.to_path_buf())
}
fn metadata(c: &Core, id: &str) -> Result<Value> {
    let dir = c.instance(id)?;
    let config = read_json(&dir.join("kxl.json"))?;
    let mut info = json!({});
    for key in [
        "name",
        "version",
        "loader",
        "loaderVersion",
        "optifineVersion",
    ] {
        if !config[key].is_null() {
            info[key] = config[key].clone();
        }
    }
    if info["loaderVersion"].as_str().unwrap_or("").is_empty() {
        if let Ok(version) = read_json(&dir.join("version.json")) {
            info["loaderVersion"] = json!(packs::version_details(&version).2);
        }
    }
    Ok(info)
}
pub fn options(c: &Core, p: &Value) -> Result<Value> {
    let id = string(p, "id")?;
    let game = game_root(c, id)?;
    let mut groups = Vec::new();
    for (key, label, description, default, parent) in [
        (
            "options",
            "游戏本体设置",
            "键位、音量、视频设置等",
            true,
            "",
        ),
        ("mods", "Mod", "启用的模组", true, ""),
        ("config", "Mod 设置", "模组配置与默认配置", true, "mods"),
        (
            "important",
            "整合包重要数据",
            "脚本、全局资源和内置数据",
            true,
            "mods",
        ),
        (
            "disabledMods",
            "已停用的 Mod",
            ".disabled / .old 文件",
            false,
            "mods",
        ),
        (
            "mapData",
            "已绘制的地图",
            "地图、路标点等个人记录",
            false,
            "mods",
        ),
        (
            "jeiData",
            "JEI 个人信息",
            "物品收藏夹与世界记录",
            false,
            "mods",
        ),
        ("resourcepacks", "资源包", "纹理包 / 材质包", true, ""),
        ("shaderpacks", "光影", "光影包", true, ""),
        (
            "datapacks",
            "数据包",
            "实例级待安装文件；存档内的数据包随存档导出",
            true,
            "",
        ),
        ("saves", "单人游戏存档", "世界 / 地图", false, ""),
    ] {
        let mut items = Vec::new();
        for root in ROOTS {
            let path = game.join(root);
            if !path.is_dir() || std::fs::symlink_metadata(&path).is_ok_and(|m| linked(&m)) {
                continue;
            }
            if matches!(
                key,
                "mods" | "disabledMods" | "resourcepacks" | "shaderpacks" | "saves" | "datapacks"
            ) {
                for entry in std::fs::read_dir(&path).map_err(err)?.flatten() {
                    let meta = entry.metadata().map_err(err)?;
                    if linked(&std::fs::symlink_metadata(entry.path()).map_err(err)?) {
                        continue;
                    }
                    let name = entry.file_name().to_string_lossy().into_owned();
                    let relative = format!("{root}/{name}");
                    let probe = if meta.is_dir() {
                        format!("{relative}/_")
                    } else {
                        relative.clone()
                    };
                    if category(&probe) == Some(key) {
                        items.push(json!({"path":relative,"name":name,"dir":meta.is_dir(),"size":if meta.is_file(){Some(meta.len())}else{None}}));
                    }
                }
            } else {
                let probes = match key {
                    "config" => vec!["config", "defaultconfigs", "journeymap/config"],
                    "important" => vec![
                        "kubejs",
                        "scripts",
                        "openloader",
                        "global_packs",
                        "global_resource_packs",
                        "global_data_packs",
                        "resources",
                        "structures",
                        "patchouli_books",
                    ],
                    "mapData" => vec![
                        "journeymap/data",
                        "xaero",
                        "XaeroWaypoints",
                        "XaeroWorldMap",
                    ],
                    "jeiData" => vec!["config/jei/world"],
                    _ => vec![],
                };
                for probe in probes {
                    if (probe == *root || probe.starts_with(&format!("{root}/")))
                        && game.join(probe).exists()
                    {
                        items.push(json!({"path":probe,"name":probe,"dir":true}));
                    }
                }
            }
        }
        if key == "options" {
            for name in [
                "options.txt",
                "optionsof.txt",
                "optionsshaders.txt",
                "configureddefaults",
            ] {
                if game.join(name).exists() {
                    items.push(json!({"path":name,"name":name,"dir":game.join(name).is_dir()}));
                }
            }
        }
        if key == "jeiData" {
            if let Ok(entries) = std::fs::read_dir(game.join("config/jei")) {
                for entry in entries.flatten() {
                    let meta = std::fs::symlink_metadata(entry.path()).map_err(err)?;
                    let name = entry.file_name().to_string_lossy().into_owned();
                    let path = format!("config/jei/{name}");
                    if meta.is_file() && !linked(&meta) && category(&path) == Some("jeiData") {
                        items.push(json!({"path":path,"name":name,"dir":false,"size":meta.len()}));
                    }
                }
            }
        }
        items.sort_by_key(|v| v["path"].as_str().unwrap_or("").to_lowercase());
        items.dedup_by(|a, b| a["path"] == b["path"]);
        if !items.is_empty() {
            groups.push(json!({"id":key,"label":label,"description":description,"defaultChecked":default,"parent":parent,"items":items}));
        }
    }
    Ok(json!({"instance":metadata(c,id)?,"groups":groups}))
}
pub(crate) fn files(c: &Core, p: &Value) -> Result<Vec<String>> {
    let root = game_root(c, string(p, "id")?)?;
    let canonical = root.canonicalize().map_err(err)?;
    let mut selected: BTreeSet<String> = p["include"]
        .as_array()
        .ok_or("请选择导出内容")?
        .iter()
        .map(|v| v.as_str().map(str::to_owned).ok_or("导出选项无效".into()))
        .collect::<Result<_>>()?;
    let allowed = [
        "options",
        "mods",
        "config",
        "important",
        "disabledMods",
        "mapData",
        "jeiData",
        "resourcepacks",
        "shaderpacks",
        "datapacks",
        "saves",
    ];
    if selected.iter().any(|s| !allowed.contains(&s.as_str())) {
        return Err("不允许导出该目录".into());
    }
    if p["selectionVersion"] != 1 && selected.contains("config") {
        selected.insert("important".into());
    }
    let mut choices = BTreeMap::<String, Vec<String>>::new();
    if let Some(groups) = p["choices"].as_object() {
        for (group, values) in groups {
            let mut paths = Vec::new();
            for value in values.as_array().ok_or("文件选择无效")? {
                let text = value.as_str().ok_or("文件选择无效")?;
                if text.contains(['\\', ':'])
                    || Path::new(text)
                        .components()
                        .any(|c| !matches!(c, std::path::Component::Normal(_)))
                {
                    return Err("导出路径无效".into());
                }
                paths.push(text.to_owned());
            }
            choices.insert(group.clone(), paths);
        }
    }
    let mut out = Vec::new();
    let mut size = 0u64;
    fn walk(
        c: &Core,
        root: &Path,
        canonical: &Path,
        path: &Path,
        selected: &BTreeSet<String>,
        choices: &BTreeMap<String, Vec<String>>,
        out: &mut Vec<String>,
        size: &mut u64,
    ) -> Result<()> {
        c.stopped()?;
        let meta = std::fs::symlink_metadata(path).map_err(err)?;
        if linked(&meta) {
            return Ok(());
        }
        if !path.canonicalize().map_err(err)?.starts_with(canonical) {
            return Err("导出内容越出游戏目录".into());
        }
        if meta.is_dir() {
            let relative = path
                .strip_prefix(root)
                .map_err(err)?
                .to_string_lossy()
                .replace('\\', "/");
            let lower = relative.to_lowercase();
            if lower
                .split('/')
                .any(|v| ["logs", "crash-reports", ".connector", ".git"].contains(&v))
                || (lower == "journeymap/data" && !selected.contains("mapData"))
                || (lower == "config/jei/world" && !selected.contains("jeiData"))
            {
                return Ok(());
            }
            if let Some(group) = category(&format!("{relative}/_")) {
                let leads_to_jei = selected.contains("jeiData")
                    && ["config", "config/jei"].contains(&lower.as_str());
                if !selected.contains(group) && !leads_to_jei {
                    return Ok(());
                }
                if choices.get(group).is_some_and(|paths| {
                    !paths.iter().any(|p| {
                        relative == *p
                            || relative.starts_with(&format!("{p}/"))
                            || p.starts_with(&format!("{relative}/"))
                    })
                }) && !leads_to_jei
                {
                    return Ok(());
                }
            }
            for entry in std::fs::read_dir(path).map_err(err)?.flatten() {
                walk(
                    c,
                    root,
                    canonical,
                    &entry.path(),
                    selected,
                    choices,
                    out,
                    size,
                )?;
            }
            return Ok(());
        }
        let name = path
            .strip_prefix(root)
            .map_err(err)?
            .to_string_lossy()
            .replace('\\', "/");
        let Some(group) = category(&name) else {
            return Ok(());
        };
        if group != "license"
            && (!selected.contains(group)
                || choices.get(group).is_some_and(|paths| {
                    !paths
                        .iter()
                        .any(|p| name == *p || name.starts_with(&format!("{p}/")))
                }))
        {
            return Ok(());
        }
        if meta.len() > 2 * 1024 * 1024 * 1024 {
            return Err(format!("文件超过 2 GB：{name}"));
        }
        *size = size.checked_add(meta.len()).ok_or("导出体积过大")?;
        if *size > 16 * 1024 * 1024 * 1024 {
            return Err("导出内容超过 16 GB".into());
        }
        out.push(name);
        Ok(())
    }
    for name in ROOTS {
        let path = root.join(name);
        let needed = match *name {
            "mods" => selected.contains("mods") || selected.contains("disabledMods"),
            "config" => selected.contains("config") || selected.contains("jeiData"),
            "journeymap" => selected.contains("config") || selected.contains("mapData"),
            _ => category(&format!("{name}/_")).is_some_and(|g| selected.contains(g)),
        };
        if path.exists() && needed {
            walk(
                c, &root, &canonical, &path, &selected, &choices, &mut out, &mut size,
            )?;
        }
    }
    for entry in std::fs::read_dir(&root).map_err(err)?.flatten() {
        if entry.file_type().map_err(err)?.is_file() {
            walk(
                c,
                &root,
                &canonical,
                &entry.path(),
                &selected,
                &choices,
                &mut out,
                &mut size,
            )?;
        }
    }
    out.sort();
    out.dedup();
    Ok(out)
}
pub async fn export(c: &Core, p: &Value) -> Result<Value> {
    let mut payload = p.clone();
    payload
        .as_object_mut()
        .ok_or("导出参数无效")?
        .remove("onlineFiles");
    let scan = c.clone();
    let value = p.clone();
    let selected = tokio::task::spawn_blocking(move || files(&scan, &value))
        .await
        .map_err(err)??;
    payload["selectedFiles"] = json!(selected);
    let mut remote = Vec::new();
    let mut warnings: Vec<String> = Vec::new();
    if p["bundleResources"] == false && p["format"].as_str().unwrap_or("mrpack") == "mrpack" {
        let root = game_root(c, string(p, "id")?)?;
        let paths = selected
            .iter()
            .filter(|path| {
                matches!(
                    category(path),
                    Some("mods" | "resourcepacks" | "shaderpacks")
                ) && resource_downloads::extension_matches(
                    path,
                    if category(path) == Some("mods") {
                        "mods"
                    } else {
                        "resourcepacks"
                    },
                )
            })
            .cloned()
            .collect::<Vec<_>>();
        c.stage("识别可在线下载的资源", 0, paths.len());
        let mut hashes = BTreeMap::new();
        for path in paths {
            c.stopped()?;
            let file = root.join(&path);
            let task = c.clone();
            let hash = tokio::task::spawn_blocking(move || hash_file(&task, &file))
                .await
                .map_err(err)??;
            hashes.insert(path, hash);
        }
        for batch in hashes.iter().collect::<Vec<_>>().chunks(100) {
            let response=jobs::wait(c,c.http.post("https://api.modrinth.com/v2/version_files").json(&json!({"hashes":batch.iter().map(|(_,v)|&v.0).collect::<Vec<_>>(),"algorithm":"sha1"})).timeout(std::time::Duration::from_secs(15)).send()).await?;
            let lookup = match response {
                Ok(r) => match r.error_for_status() {
                    Ok(r) => r.json::<Value>().await.map_err(err),
                    Err(e) => Err(err(e)),
                },
                Err(e) => Err(err(e)),
            };
            match lookup {
                Ok(lookup) => {
                    for (path, (hash, size)) in batch {
                        if let Some(file) = lookup[hash.as_str()]
                            .get("files")
                            .and_then(Value::as_array)
                            .and_then(|rows| {
                                rows.iter()
                                    .find(|f| f["hashes"]["sha1"].as_str() == Some(hash.as_str()))
                            })
                        {
                            let Some(url) = file["url"]
                                .as_str()
                                .and_then(|v| reqwest::Url::parse(v).ok())
                                .filter(|u| {
                                    u.scheme() == "https"
                                        && u.host_str() == Some("cdn.modrinth.com")
                                        && u.username().is_empty()
                                        && u.password().is_none()
                                })
                            else {
                                continue;
                            };
                            remote.push(json!({"path":path,"hashes":{"sha1":hash},"downloads":[url.as_str()],"fileSize":size,"env":{"client":"required","server":"optional"}}));
                        }
                    }
                }
                Err(_) => warnings.push("部分资源来源未能确认，已将对应文件直接打包。".into()),
            }
        }
    }
    payload["onlineFiles"] = json!(remote);
    let task = c.clone();
    let result = tokio::task::spawn_blocking(move || packs::export(&task, &payload))
        .await
        .map_err(err)??;
    warnings.sort();
    warnings.dedup();
    Ok(
        json!({"path":result,"files":selected.len(),"onlineFiles":remote.len(),"embeddedFiles":selected.len().saturating_sub(remote.len()),"warnings":warnings}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (tempfile::TempDir, Core, PathBuf) {
        let temp = tempfile::tempdir().unwrap();
        let core = Core::new(temp.path().join("game"), Arc::new(|_| {})).unwrap();
        let dir = core.instance("a").unwrap();
        write_json(&dir.join("kxl.json"),&json!({"name":"original","version":"1.20.1","loader":"fabric","loaderVersion":"0.16.14","icon":resources::image_data(include_bytes!("../../src/assets/loaders/minecraft.png").to_vec()).unwrap(),"privateToken":"must-not-export","settings":{"isolation":"all"}})).unwrap();
        write_json(
            &dir.join("version.json"),
            &json!({"id":"fabric-loader-0.16.14-1.20.1"}),
        )
        .unwrap();
        for name in [
            "mods/a.jar",
            "mods/a.jar.disabled",
            "config/general.json",
            "resources/pack-assets/logo.png",
            "config/jei/world/bookmarks.ini",
            "config/credentials.json",
            "resourcepacks/a.zip",
            "resourcepacks/b.zip",
            "saves/A/level.dat",
            "saves/B/level.dat",
            "XaeroWorldMap/data.bin",
            "options.txt",
            "LICENSE",
        ] {
            let path = dir.join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, name).unwrap();
        }
        (temp, core, dir)
    }
    #[test]
    fn export_plan_honors_individual_choices_and_private_defaults() {
        let (_t, c, _dir) = fixture();
        let value = options(&c, &json!({"id":"a"})).unwrap();
        for id in ["saves", "mapData", "jeiData", "disabledMods"] {
            let group = value["groups"]
                .as_array()
                .unwrap()
                .iter()
                .find(|g| g["id"] == id)
                .unwrap();
            assert_eq!(group["defaultChecked"], false);
        }
        assert!(value["instance"]["privateToken"].is_null());
        let selected=files(&c,&json!({"id":"a","selectionVersion":1,"include":["options","mods","config","resourcepacks"],"choices":{"resourcepacks":["resourcepacks/a.zip"]}})).unwrap();
        for expected in [
            "mods/a.jar",
            "options.txt",
            "LICENSE",
            "config/general.json",
            "resourcepacks/a.zip",
        ] {
            assert!(selected.iter().any(|v| v == expected), "{expected}");
        }
        for excluded in [
            "mods/a.jar.disabled",
            "config/credentials.json",
            "config/jei/world/bookmarks.ini",
            "resourcepacks/b.zip",
            "saves/A/level.dat",
            "XaeroWorldMap/data.bin",
        ] {
            assert!(!selected.iter().any(|v| v == excluded), "{excluded}");
        }
        assert!(files(
            &c,
            &json!({"id":"a","include":["mods"],"choices":{"mods":["../accounts.json"]}})
        )
        .is_err());
    }
    #[test]
    fn metadata_selections_and_settings_roundtrip_in_all_formats() {
        let (t, c, dir) = fixture();
        for format in ["mrpack", "universal", "curseforge", "multimc", "kynex"] {
            let target = t.path().join(format!("{format}.zip"));
            packs::export(&c,&json!({"id":"a","name":"Selected pack","packVersion":"2.3.4","path":target,"format":format,"selectionVersion":1,"include":["options","config","important","resourcepacks","saves"],"choices":{"resourcepacks":["resourcepacks/b.zip"],"saves":["saves/B"]}})).unwrap();
            let mut archive = zip::ZipArchive::new(std::fs::File::open(&target).unwrap()).unwrap();
            assert!(archive.by_name("icon.png").is_ok());
            let prefix = if format == "multimc" {
                ".minecraft/"
            } else if format == "kynex" {
                ""
            } else {
                "overrides/"
            };
            assert!(archive
                .by_name(&format!("{prefix}resourcepacks/b.zip"))
                .is_ok());
            assert!(archive
                .by_name(&format!("{prefix}resourcepacks/a.zip"))
                .is_err());
            assert!(archive
                .by_name(&format!("{prefix}saves/A/level.dat"))
                .is_err());
            if ["mrpack", "universal"].contains(&format) {
                let mut text = String::new();
                archive
                    .by_name("modrinth.index.json")
                    .unwrap()
                    .read_to_string(&mut text)
                    .unwrap();
                let value: Value = serde_json::from_str(&text).unwrap();
                assert_eq!(value["name"], "Selected pack");
                assert_eq!(value["versionId"], "2.3.4");
            }
            if format == "kynex" {
                let mut text = String::new();
                archive
                    .by_name("kxl-pack.json")
                    .unwrap()
                    .read_to_string(&mut text)
                    .unwrap();
                assert!(!text.contains("privateToken"));
                assert!(!text.contains("settings"));
            }
            let restored = t.path().join(format!("restored-{format}"));
            std::fs::create_dir_all(&restored).unwrap();
            packs::extract_game_resources(&mut archive, &restored, prefix.trim_end_matches('/'))
                .unwrap();
            assert_eq!(
                std::fs::read(restored.join("options.txt")).unwrap(),
                std::fs::read(dir.join("options.txt")).unwrap()
            );
            assert!(restored.join("LICENSE").exists());
            assert!(restored.join("resources/pack-assets/logo.png").exists());
            assert!(restored.join("saves/B/level.dat").exists());
        }
    }
    #[test]
    fn invalid_selection_and_cancellation_never_replace_an_existing_export() {
        let (t, c, _) = fixture();
        let target = t.path().join("keep.zip");
        std::fs::write(&target, b"existing export").unwrap();
        assert!(
            packs::export(&c, &json!({"id":"a","path":target,"include":["accounts"]})).is_err()
        );
        assert_eq!(std::fs::read(&target).unwrap(), b"existing export");
        c.cancel.store(true, Ordering::Relaxed);
        assert!(packs::export(&c, &json!({"id":"a","path":target,"include":["mods"]})).is_err());
        assert_eq!(std::fs::read(&target).unwrap(), b"existing export");
    }
}
