use crate::*;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};
use futures_util::{stream::FuturesUnordered, StreamExt};
async fn check_endpoint(app: tauri::AppHandle, endpoint: reqwest::Url, index: usize) -> Result<(bool, Option<Update>)> {
    tokio::time::sleep(Duration::from_millis(index as u64 * 350)).await;
    let official = matches!(endpoint.host_str(), Some("github.com" | "raw.githubusercontent.com"));
    let updater = app.updater_builder().endpoints(vec![endpoint]).map_err(err)?
        .pubkey(include_str!("../../config/updater-public-key.txt").trim())
        .timeout(Duration::from_secs(8))
        .configure_client(|client| client.connect_timeout(Duration::from_secs(3)).read_timeout(Duration::from_secs(8)))
        .build().map_err(err)?;
    updater.check().await.map(|update| (official, update)).map_err(err)
}
#[derive(Default)]
pub struct Updates {
    pending: Mutex<Option<Update>>,
    installing: AtomicBool,
}

pub async fn check(app: &tauri::AppHandle, core: &Core) -> Result<Value> {
    let state = app.state::<Updates>();
    if state.installing.load(Ordering::Relaxed) {
        return Err("正在安装更新".into());
    }
    let endpoints = crate::release::endpoints(core)?;
    if endpoints.is_empty() {
        return Ok(json!({"status":"unconfigured"}));
    }
    // Each source is an HTTPS update manifest. Download locations are separately
    // verified against the embedded signing public key by the official updater.
    let mut checks = FuturesUnordered::new();
    for (index, endpoint) in endpoints.into_iter().enumerate() {
        checks.push(check_endpoint(app.clone(), endpoint, index));
    }
    let mut candidate = None;
    let mut current = false;
    while let Some(result) = checks.next().await {
        if let Ok((official, update)) = result {
            if update.is_some() { candidate = update; break; }
            current = true;
            if official { break; }
        }
    }
    drop(checks);
    if candidate.is_none() && !current { return Err("更新源暂不可用，请稍后重试".into()); }
    let Some(mut update) = candidate else {
        return Ok(json!({"status":"current"}));
    };
    let channel = crate::release::info()["channel"]
        .as_str()
        .unwrap_or("stable")
        .to_owned();
    let is_preview = update.version.contains('-');
    if (channel == "stable" && is_preview)
        || (channel == "beta" && !is_preview)
        || update.raw_json["channel"]
            .as_str()
            .is_some_and(|value| value != channel)
        || update.download_url.scheme() != "https"
    {
        return Err("更新通道与当前版本不匹配".into());
    }
    update.timeout = Some(Duration::from_secs(300));
    let info = json!({"version":update.version,"notes":update.body.clone().unwrap_or_default(),"date":update.date.map(|v|v.to_string())});
    *state.pending.lock().map_err(err)? = Some(update);
    Ok(json!({"status":"available","update":info}))
}
pub async fn install(app: &tauri::AppHandle) -> Result<Value> {
    let state = app.state::<Updates>();
    if state.installing.swap(true, Ordering::Relaxed) {
        return Err("正在安装更新".into());
    }
    let update = state.pending.lock().map_err(err)?.clone();
    let Some(update) = update else {
        state.installing.store(false, Ordering::Relaxed);
        return Err("请先检查新版本".into());
    };
    let mut result = Err("更新下载或签名校验失败".to_string());
    for url in crate::release::delivery_urls(&update.download_url) {
        let mut attempt = update.clone();
        attempt.download_url = url;
        let mut downloaded = 0u64;
        result = attempt.download(|chunk,total|{
        downloaded+=chunk as u64;
        let _=app.emit("kynex-update-progress",json!({"stage":"downloading","downloaded":downloaded,"total":total.unwrap_or(0)}));
    },||{let _=app.emit("kynex-update-progress",json!({"stage":"verifying","downloaded":0,"total":0}));}).await.map_err(err);
        if result.is_ok() { break; }
    }
    let result = match result {
        Ok(bytes) => {
            let _ = app.emit(
                "kynex-update-progress",
                json!({"stage":"installing","downloaded":bytes.len(),"total":bytes.len()}),
            );
            update
                .install(bytes)
                .map_err(|_| "无法安装更新，请稍后重试".to_string())
        }
        Err(_) => Err("更新下载或签名校验失败，未安装任何文件".into()),
    };
    state.installing.store(false, Ordering::Relaxed);
    result?;
    Ok(json!(true))
}
