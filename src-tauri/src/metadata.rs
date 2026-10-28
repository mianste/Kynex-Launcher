//! Small immutable version documents must not use the large-file retry budget.
use crate::*;
use futures_util::{stream::FuturesUnordered, StreamExt};
use sha1::{Digest, Sha1};
use std::time::Duration;

fn valid_manifest(value: &Value) -> bool {
    value["versions"].as_array().is_some_and(|items| {
        !items.is_empty()
            && items
                .iter()
                .all(|item| item["id"].is_string() && item["url"].is_string())
    })
}
fn hash_matches(bytes: &[u8], hash: &str) -> bool {
    hash.is_empty() || format!("{:x}", Sha1::digest(bytes)).eq_ignore_ascii_case(hash)
}

async fn fetch(core: &Core, urls: Vec<String>, hash: &str) -> Result<Vec<u8>> {
    let mut pending = FuturesUnordered::new();
    for (index, url) in urls.into_iter().enumerate() {
        pending.push(async move {
            tokio::time::sleep(Duration::from_millis(index as u64 * 400)).await;
            let response = core
                .http
                .get(&url)
                .timeout(Duration::from_secs(8))
                .send()
                .await
                .map_err(err)?
                .error_for_status()
                .map_err(err)?;
            if response.content_length().unwrap_or(0) > 16 * 1024 * 1024 {
                return Err("版本清单响应过大".to_string());
            }
            let bytes = response.bytes().await.map_err(err)?.to_vec();
            if bytes.len() > 16 * 1024 * 1024 || !hash_matches(&bytes, hash) {
                return Err("版本清单校验失败".to_string());
            }
            let value = serde_json::from_slice::<Value>(&bytes)
                .map_err(|_| "下载源没有返回有效的版本清单".to_string())?;
            if !valid_manifest(&value) && !value["id"].is_string() {
                return Err("下载源返回了错误信息，正在等待其他来源".to_string());
            }
            Ok(bytes)
        });
    }
    let mut cancellation = tokio::time::interval(Duration::from_millis(100));
    let mut failures = Vec::new();
    loop {
        tokio::select! {
            _ = cancellation.tick() => core.stopped()?,
            next = pending.next() => match next {
                Some(Ok(bytes)) => return Ok(bytes),
                Some(Err(error)) => failures.push(error),
                None => return Err(format!("获取版本信息失败，请重试或在设置中切换下载来源：{}",failures.join("；"))),
            }
        }
    }
}
fn urls(core: &Core, url: &str) -> Result<Vec<String>> {
    https(url)?;
    // The metadata race always includes the configured mirror, even if a large
    // resource download has temporarily marked that mirror as unhealthy.
    Ok(mirrors::candidates(
        url,
        &core.download_source.read().map_err(err)?,
    ))
}
pub async fn manifest(core: &Core, force: bool) -> Result<Value> {
    let cache = core.root.join("cache/version-manifest.json");
    let cached = read_json(&cache).ok().filter(valid_manifest);
    let fresh = std::fs::metadata(&cache)
        .and_then(|m| m.modified())
        .and_then(|t| t.elapsed().map_err(std::io::Error::other))
        .is_ok_and(|age| age < Duration::from_secs(900));
    if !force && fresh {
        if let Some(value) = &cached {
            return Ok(value.clone());
        }
    }
    // Browsing the catalogue is independent of an earlier cancelled install.
    let browsing = Core {
        cancel: Arc::new(AtomicBool::new(false)),
        ..core.clone()
    };
    match fetch(&browsing, urls(core, engine::MANIFEST)?, "").await {
        Ok(bytes) => {
            let value: Value = serde_json::from_slice(&bytes).map_err(err)?;
            if !valid_manifest(&value) {
                return cached.ok_or_else(|| "下载源返回了空的版本清单，请重试".into());
            }
            let _ = write_json(&cache, &value);
            Ok(value)
        }
        Err(error) => cached.ok_or(error),
    }
}
pub async fn version(core: &Core, id: &str) -> Result<Value> {
    core.stopped()?;
    let cache = core.root.join("cache/version-manifest.json");
    // Version IDs and their hashes are immutable. Reuse the selected catalogue
    // entry immediately rather than downloading the entire catalogue again.
    let mut index = read_json(&cache).ok().filter(valid_manifest);
    if !index.as_ref().is_some_and(|v| {
        v["versions"]
            .as_array()
            .is_some_and(|items| items.iter().any(|item| item["id"] == id))
    }) {
        let get = manifest(core, true);
        tokio::pin!(get);
        let mut cancellation = tokio::time::interval(Duration::from_millis(100));
        index = Some(loop {
            tokio::select! { value=&mut get => break value?, _=cancellation.tick()=>core.stopped()?, }
        });
    }
    let item = index
        .as_ref()
        .and_then(|v| v["versions"].as_array())
        .and_then(|items| items.iter().find(|item| item["id"] == id))
        .ok_or("版本清单中找不到此版本，请刷新后重试")?;
    core.stage("读取版本配置", 1, 2);
    let path = core
        .root
        .join("versions")
        .join(safe_name(id)?)
        .join(format!("{id}.json"));
    let hash = item["sha1"].as_str().unwrap_or("");
    if let Ok(bytes) = tokio::fs::read(&path).await {
        if !hash.is_empty() && hash_matches(&bytes, hash) {
            if let Ok(value) = serde_json::from_slice(&bytes) {
                return Ok(value);
            }
        }
    }
    let bytes = fetch(core, urls(core, string(item, "url")?)?, hash).await?;
    let value: Value = serde_json::from_slice(&bytes).map_err(err)?;
    if value["id"] != id || !value["libraries"].is_array() {
        return Err("版本配置与所选版本不匹配，请刷新后重试".into());
    }
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(err)?;
    }
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    tokio::fs::write(&temporary, &bytes).await.map_err(err)?;
    tokio::fs::rename(&temporary, &path).await.map_err(err)?;
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };
    async fn server(delay: Duration, body: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut buf = [0; 4096];
            let _ = stream.read(&mut buf).await;
            tokio::time::sleep(delay).await;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes()).await;
        });
        format!("http://{address}/metadata")
    }
    #[tokio::test]
    async fn slow_primary_does_not_block_valid_fallback() {
        let root = tempfile::tempdir().unwrap();
        let core = Core::new(root.path().into(), Arc::new(|_| {})).unwrap();
        let slow = server(Duration::from_secs(20), "{}").await;
        let fast = server(Duration::ZERO, "{\"id\":\"test\"}").await;
        let result =
            tokio::time::timeout(Duration::from_secs(2), fetch(&core, vec![slow, fast], ""))
                .await
                .unwrap()
                .unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&result).unwrap()["id"],
            "test"
        );
    }
    #[tokio::test]
    async fn cancelled_metadata_stops_promptly() {
        let root = tempfile::tempdir().unwrap();
        let core = Core::new(root.path().into(), Arc::new(|_| {})).unwrap();
        let stop = core.cancel.clone();
        let slow = server(Duration::from_secs(20), "{}").await;
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            stop.store(true, Ordering::SeqCst);
        });
        let result = tokio::time::timeout(Duration::from_secs(1), fetch(&core, vec![slow], ""))
            .await
            .unwrap();
        assert_eq!(result.unwrap_err(), "任务已取消");
    }
    #[tokio::test]
    async fn error_json_cannot_win_the_metadata_race() {
        let root = tempfile::tempdir().unwrap();
        let core = Core::new(root.path().into(), Arc::new(|_| {})).unwrap();
        let bad = server(Duration::ZERO, "{\"error\":\"busy\"}").await;
        let good = server(Duration::ZERO, "{\"id\":\"test\"}").await;
        let bytes = fetch(&core, vec![bad, good], "").await.unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&bytes).unwrap()["id"],
            "test"
        );
    }
    #[tokio::test]
    async fn selected_version_reuses_verified_cache() {
        let root = tempfile::tempdir().unwrap();
        let core = Core::new(root.path().into(), Arc::new(|_| {})).unwrap();
        let bytes = b"{\"id\":\"1.20.1\",\"libraries\":[]}";
        write_json(&root.path().join("cache/version-manifest.json"),&json!({"versions":[{"id":"1.20.1","url":"https://unreachable.invalid/v.json","sha1":format!("{:x}",Sha1::digest(bytes))}]})).unwrap();
        let path = root.path().join("versions/1.20.1/1.20.1.json");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
        let value = tokio::time::timeout(Duration::from_millis(300), version(&core, "1.20.1"))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(value["id"], "1.20.1");
    }
    #[tokio::test]
    #[ignore = "requires official Minecraft metadata network"]
    async fn live_version_metadata_is_bounded() {
        let root = tempfile::tempdir().unwrap();
        let core = Core::new(root.path().into(), Arc::new(|_| {})).unwrap();
        let value = tokio::time::timeout(Duration::from_secs(20), version(&core, "1.20.1"))
            .await
            .expect("metadata exceeded its request budgets")
            .unwrap();
        assert_eq!(value["id"], "1.20.1");
        assert!(value["downloads"]["client"]["url"].is_string());
    }
}
