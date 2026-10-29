//! Asset mirrors compete for a hash-verified file, never for an unchecked response.
use crate::*;
use futures_util::{stream::FuturesUnordered, StreamExt};
use sha1::{Digest, Sha1};
use std::time::Duration;

struct TemporaryFile(PathBuf);
impl Drop for TemporaryFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

async fn fetch(
    core: &Core,
    url: &str,
    path: &Path,
    hash: &str,
    received: &(dyn Fn(usize) + Send + Sync),
) -> Result<TemporaryFile> {
    use tokio::io::AsyncWriteExt;
    let response = core.http.get(url).timeout(Duration::from_secs(90))
        .send().await.map_err(err)?.error_for_status().map_err(err)?;
    let temporary = TemporaryFile(path.with_extension(format!("part-{}", uuid::Uuid::new_v4())));
    // Declared after the cleanup guard so cancellation closes the handle first on Windows.
    let mut file = tokio::fs::File::create(&temporary.0).await.map_err(err)?;
    let mut stream = response.bytes_stream();
    let mut digest = Sha1::new();
    while let Some(bytes) = tokio::time::timeout(Duration::from_secs(8), stream.next())
        .await.map_err(|_| "资源下载没有收到数据，正在切换下载源".to_string())? {
        let bytes = bytes.map_err(err)?;
        digest.update(&bytes);
        file.write_all(&bytes).await.map_err(err)?;
        received(bytes.len());
    }
    file.flush().await.map_err(err)?;
    drop(file);
    if format!("{:x}", digest.finalize()) != hash.to_ascii_lowercase() {
        return Err("游戏资源 SHA1 校验失败".into());
    }
    Ok(temporary)
}

async fn race(
    core: &Core,
    urls: &[String],
    path: &Path,
    hash: &str,
    received: &(dyn Fn(usize) + Send + Sync),
) -> Result<()> {
    let mut requests = FuturesUnordered::new();
    for (index, url) in urls.iter().enumerate() {
        requests.push(async move {
            if index > 0 { tokio::time::sleep(Duration::from_millis(700 * index as u64)).await; }
            fetch(core, url, path, hash, received).await
        });
    }
    let mut last = "没有可用的资源下载源".to_string();
    while let Some(result) = requests.next().await {
        match result {
            Ok(temporary) => {
                // Only a fully verified winner can replace the shared cached object.
                drop(requests);
                tokio::fs::rename(&temporary.0, path).await.map_err(err)?;
                return Ok(());
            }
            Err(error) => last = error,
        }
    }
    Err(last)
}

pub async fn download(
    core: &Core, url: &str, path: &Path, hash: &str,
    received: &(dyn Fn(usize) + Send + Sync),
) -> Result<()> {
    https(url)?;
    let lock = core.jobs.file_lock(path);
    let _guard = crate::jobs::wait(core, lock.lock()).await?;
    if crate::engine::cached_file_valid(path, hash).await? { return Ok(()); }
    let _permit = crate::jobs::wait(core, core.jobs.download_slots.acquire()).await?.map_err(err)?;
    if let Some(parent) = path.parent() { tokio::fs::create_dir_all(parent).await.map_err(err)?; }
    let source = core.download_source.read().map_err(err)?.clone();
    // An unrelated mod CDN failure must not disable the game asset mirror.
    let urls = crate::mirrors::candidates(url, &source);
    let mut last = String::new();
    for _ in 0..2 {
        core.stopped()?;
        match crate::jobs::wait(core, race(core, &urls, path, hash, received)).await? {
            Ok(()) => return Ok(()),
            Err(error) => last = error,
        }
    }
    Err(format!("资源 {hash} 下载失败：{last}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    async fn server(delay: Duration, body: &'static [u8], stall: bool) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0; 4096]; let _ = socket.read(&mut request).await;
            tokio::time::sleep(delay).await;
            let length = if stall { body.len() + 100 } else { body.len() };
            let header = format!("HTTP/1.1 200 OK\r\nContent-Length: {length}\r\nConnection: close\r\n\r\n");
            let _ = socket.write_all(header.as_bytes()).await;
            let _ = socket.write_all(body).await;
            if stall { tokio::time::sleep(Duration::from_secs(20)).await; }
        });
        url
    }
    #[tokio::test]
    async fn stalled_mirror_cannot_hold_up_verified_fallback_or_leave_partial_files() {
        let root = tempfile::tempdir().unwrap();
        let core = Core::new(root.path().into(), Arc::new(|_| {})).unwrap();
        let slow = server(Duration::ZERO, b"slow", true).await;
        let good = server(Duration::ZERO, b"verified", false).await;
        let hash = format!("{:x}", Sha1::digest(b"verified"));
        let path = root.path().join("object");
        tokio::time::timeout(Duration::from_secs(3), race(&core, &[slow, good], &path, &hash, &|_| {})).await.unwrap().unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"verified");
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 1);
    }
    #[tokio::test]
    async fn corrupt_fast_source_cannot_win() {
        let root = tempfile::tempdir().unwrap();
        let core = Core::new(root.path().into(), Arc::new(|_| {})).unwrap();
        let bad = server(Duration::ZERO, b"corrupt", false).await;
        let good = server(Duration::ZERO, b"verified", false).await;
        let hash = format!("{:x}", Sha1::digest(b"verified"));
        let path = root.path().join("object");
        race(&core, &[bad,good], &path, &hash, &|_| {}).await.unwrap();
        assert_eq!(std::fs::read(path).unwrap(), b"verified");
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 1);
    }
    #[tokio::test]
    async fn cancellation_removes_inflight_partial_file() {
        let root = tempfile::tempdir().unwrap();
        let core = Core::new(root.path().into(), Arc::new(|_| {})).unwrap();
        let slow = server(Duration::ZERO, b"partial", true).await;
        let stop = core.cancel.clone();
        tokio::spawn(async move {tokio::time::sleep(Duration::from_millis(150)).await; stop.store(true,Ordering::SeqCst);});
        let path = root.path().join("object");
        let result = crate::jobs::wait(&core, race(&core, &[slow], &path, "hash", &|_| {})).await;
        assert_eq!(result.unwrap_err(), "任务已取消");
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
    }
    #[tokio::test]
    #[ignore = "repairs one copied real asset over HTTPS in an isolated QA directory"]
    async fn live_asset_repair_with_two_jobs_and_unrelated_mirror_failure() {
        let root = PathBuf::from(std::env::var("KXL_ASSET_TEST_ROOT").expect("isolated QA root required"));
        assert!(root.components().any(|part| part.as_os_str() == ".update-qa"));
        let core = Core::new(root.clone(),Arc::new(|_| {})).unwrap();
        let index = read_json(&root.join("assets/indexes/32.json")).unwrap();
        let object = index["objects"].as_object().unwrap().values().find(|v| v["size"].as_u64().is_some_and(|n| n > 200000 && n < 1000000)).unwrap();
        let hash = object["hash"].as_str().unwrap();
        let path = root.join("assets/objects").join(&hash[..2]).join(hash);
        std::fs::write(&path,b"corrupt QA cache").unwrap();
        crate::mirrors::mark_failed(&core);
        let bytes = std::sync::atomic::AtomicUsize::new(0);
        let received = |n| {bytes.fetch_add(n,Ordering::Relaxed);};
        let url = format!("https://resources.download.minecraft.net/{}/{hash}",&hash[..2]);
        let start = std::time::Instant::now();
        let (a,b) = tokio::join!(download(&core,&url,&path,hash,&received),download(&core,&url,&path,hash,&received));
        a.unwrap(); b.unwrap();
        assert!(crate::engine::cached_file_valid(&path,hash).await.unwrap());
        assert_eq!(std::fs::metadata(&path).unwrap().len(),object["size"].as_u64().unwrap());
        assert!(std::fs::read_dir(path.parent().unwrap()).unwrap().all(|entry| !entry.unwrap().file_name().to_string_lossy().contains("part-")));
        let report = json!({"success":true,"elapsedMs":start.elapsed().as_millis(),"networkBytes":bytes.load(Ordering::Relaxed),"assetSize":object["size"],"concurrentJobs":2,"sha1Verified":true});
        write_json(&root.join("live-repair.json"),&report).unwrap();
        println!("{report}");
    }
}
