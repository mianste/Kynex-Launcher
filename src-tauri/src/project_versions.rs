use crate::{err, mirrors, read_json, Core, Result};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{future::Future, time::Duration};

pub(crate) async fn cached<F, Fut>(
    core: &Core,
    key: Value,
    force: bool,
    fetch: F,
) -> Result<(Value, bool)>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<Value>>,
{
    let key = format!("{:x}", Sha256::digest(serde_json::to_vec(&key).map_err(err)?));
    let directory = core.data_root.join("cache").join("project-versions");
    let path = directory.join(format!("{key}.json"));
    let lock = core.jobs.file_lock(&path);
    let _guard = lock.lock().await;
    let cached = std::fs::metadata(&path).ok()
        .and_then(|meta| meta.modified().ok())
        .and_then(|time| time.elapsed().ok())
        .filter(|age| *age < Duration::from_secs(24 * 60 * 60))
        .and_then(|age| read_json(&path).ok().map(|value| (value, age)));
    let stale = match cached {
        Some((value, age)) if !force && age < Duration::from_secs(10 * 60) => {
            return Ok((value, false));
        }
        Some((value, _)) => Some(value),
        None => None,
    };
    match fetch().await {
        Ok(value) => {
            if std::fs::create_dir_all(&directory).is_ok() {
                if let Ok(mut file) = tempfile::NamedTempFile::new_in(&directory) {
                    if serde_json::to_writer(&mut file, &value).is_ok() {
                        let _ = file.persist(path);
                    }
                }
            }
            Ok((value, false))
        }
        Err(error) => stale.map(|value| (value, true)).ok_or(error),
    }
}

pub(crate) async fn get_modrinth(core: &Core, url: &reqwest::Url) -> Result<Value> {
    async fn request(core: &Core, address: &str) -> Result<Value> {
        let versions: Vec<Value> = core.http.get(address)
            .timeout(Duration::from_secs(10))
            .send().await.map_err(err)?
            .error_for_status().map_err(err)?
            .json().await.map_err(err)?;
        if versions.iter().any(|version| !version["id"].is_string() || !version["files"].is_array()) {
            return Err("Modrinth 版本列表响应无效".into());
        }
        Ok(Value::Array(versions))
    }
    let official = request(core, url.as_str());
    let source = core.download_source.read().map_err(err)?.clone();
    let Some(mirror) = mirrors::mirror_url(url.as_str()).filter(|_| source != "official") else {
        return official.await;
    };
    let fallback = async {
        tokio::time::sleep(Duration::from_millis(350)).await;
        request(core, &mirror).await
    };
    tokio::pin!(official, fallback);
    tokio::select! {
        result = &mut official => match result {
            Ok(value) => Ok(value),
            Err(error) => fallback.await.map_err(|fallback_error| format!("{error}；备用源：{fallback_error}")),
        },
        result = &mut fallback => match result {
            Ok(value) => Ok(value),
            Err(fallback_error) => official.await.map_err(|error| format!("{error}；备用源：{fallback_error}")),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::Arc;

    #[tokio::test]
    async fn versions_reuse_real_results_and_mark_offline_fallback() {
        let directory = tempfile::tempdir().unwrap();
        let core = Core::new(directory.path().to_path_buf(), Arc::new(|_| {})).unwrap();
        let key = json!(["project", "game-filter"]);
        let version = json!([{"id": "release"}]);
        let fetch = || async { Ok(version.clone()) };
        assert_eq!(cached(&core, key.clone(), false, fetch).await.unwrap(), (version.clone(), false));
        let offline = || async { Err("离线".into()) };
        assert_eq!(cached(&core, key.clone(), false, offline).await.unwrap(), (version.clone(), false));
        assert_eq!(cached(&core, key, true, offline).await.unwrap(), (version, true));
        assert!(cached(&core, json!(["different-filter"]), false, offline).await.is_err());
    }
}
