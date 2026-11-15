use crate::{engine, err, schematic_preview, schematics, string, Core, Result};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const CATALOG: &str = include_str!("../../config/schematic-catalog.json");

fn entry(payload: &Value) -> Result<Value> {
    let id = string(payload, "entry")?;
    let entries: Vec<Value> = serde_json::from_str(CATALOG).map_err(err)?;
    entries
        .into_iter()
        .find(|entry| entry["id"] == id)
        .ok_or_else(|| "找不到此投影作品".into())
}

fn file_bytes(entry: &Value) -> Result<&'static [u8]> {
    let bytes: &[u8] = match string(entry, "id")? {
        "scorpio-obsidian-farm" => {
            include_bytes!("../../config/schematic-files/scorpio-obsidian-farm.litematic")
        }
        "block-library-cabin" => {
            include_bytes!("../../config/schematic-files/block-library-cabin.litematic")
        }
        "block-library-pavilion" => {
            include_bytes!("../../config/schematic-files/block-library-pavilion.litematic")
        }
        "block-library-bridge" => {
            include_bytes!("../../config/schematic-files/block-library-bridge.litematic")
        }
        _ => return Err("找不到投影文件数据".into()),
    };
    if format!("{:x}", Sha256::digest(bytes)) != string(entry, "sha256")? {
        return Err("投影文件校验失败".into());
    }
    Ok(bytes)
}

pub(crate) async fn preview(core: &Core, payload: &Value) -> Result<Value> {
    let entry = entry(payload)?;
    let bytes = file_bytes(&entry)?;
    let lock = schematic_preview::worker(core);
    let _guard = lock.lock().await;
    tokio::task::spawn_blocking(move || schematic_preview::read_stream(bytes))
        .await
        .map_err(err)?
}

pub(crate) async fn download(core: &Core, payload: &Value) -> Result<Value> {
    let entry = entry(payload)?;
    let target = json!({"id":payload["id"], "kind":schematics::KIND});
    let directory = engine::resource_dir(core, &target)?;
    let bytes = file_bytes(&entry)?;
    let lock = core.jobs.file_lock(&directory);
    let _guard = lock.lock().await;
    if engine::resource_dir(core, &target)? != directory {
        return Err("投影目录已更改，请重新下载".into());
    }
    let name = string(&entry, "fileName")?;
    let path = directory.join(name);
    let already_present = if std::fs::symlink_metadata(&path).is_ok() {
        schematics::selected_paths(&directory, &[json!(name)])?;
        if !engine::cached_file_valid(&path, string(&entry, "sha256")?).await? {
            return Err(format!(
                "同名文件「{name}」已存在，请先在投影文件管理中处理"
            ));
        }
        true
    } else {
        let destination = directory.clone();
        let file_name = name.to_owned();
        tokio::task::spawn_blocking(move || schematics::save_file(&destination, &file_name, bytes))
            .await
            .map_err(err)??;
        false
    };
    Ok(json!({"name":name,"directory":directory,"alreadyPresent":already_present}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::write_json;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::sync::Arc;

    #[tokio::test]
    async fn every_catalog_build_previews_and_saves_the_same_valid_file() {
        let temp = tempfile::tempdir().unwrap();
        let core = Core::new(temp.path().join("launcher"), Arc::new(|_| {})).unwrap();
        let running = temp.path().join("instance-game");
        let instance = core.instance("builds").unwrap();
        write_json(
            &instance.join("kxl.json"),
            &json!({
                "id":"builds", "settings":{"isolation":"custom","gameDirectory":running}
            }),
        )
        .unwrap();
        let folder = running.join(schematics::KIND);
        let entries: Vec<Value> = serde_json::from_str(CATALOG).unwrap();
        assert_eq!(entries.len(), 4);
        for entry in entries {
            let name = entry["fileName"].as_str().unwrap();
            let path = folder.join(name);
            let request = json!({"id":"builds","entry":entry["id"]});
            let preview = core
                .dispatch("schematic_catalog_preview", request.clone())
                .await
                .unwrap();
            assert!(!path.exists(), "a preview must not save into the instance");
            let filled = STANDARD
                .decode(preview["cells"].as_str().unwrap())
                .unwrap()
                .chunks_exact(2)
                .filter(|pair| *pair != [0, 0])
                .count();
            match entry["id"].as_str().unwrap() {
                "block-library-cabin" => assert_eq!(
                    (preview["size"].clone(), filled),
                    (json!([23, 15, 19]), 1566)
                ),
                "block-library-pavilion" => assert_eq!(
                    (preview["size"].clone(), filled),
                    (json!([23, 12, 19]), 1853)
                ),
                "block-library-bridge" => assert_eq!(
                    (preview["size"].clone(), filled),
                    (json!([23, 10, 19]), 1431)
                ),
                "scorpio-obsidian-farm" => assert_eq!(preview["size"], json!([45, 16, 31])),
                _ => panic!("unknown catalogue entry"),
            }
            let first = core
                .dispatch("schematic_catalog_download", request.clone())
                .await
                .unwrap();
            assert_eq!(
                first,
                json!({"name":name,"directory":folder,"alreadyPresent":false})
            );
            assert_eq!(std::fs::read(&path).unwrap(), file_bytes(&entry).unwrap());
            let local = core
                .dispatch(
                    "schematic_preview",
                    json!({
                        "id":"builds", "name":name, "directory":folder
                    }),
                )
                .await
                .unwrap();
            assert_eq!(preview, local);
            let repeat = core
                .dispatch("schematic_catalog_download", request.clone())
                .await
                .unwrap();
            assert_eq!(
                repeat,
                json!({"name":name,"directory":folder,"alreadyPresent":true})
            );
            std::fs::write(&path, b"original edit").unwrap();
            assert!(core
                .dispatch("schematic_catalog_download", request)
                .await
                .is_err());
            assert_eq!(std::fs::read(&path).unwrap(), b"original edit");
        }
    }
}
