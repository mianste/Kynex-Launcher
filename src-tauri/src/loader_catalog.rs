//! Shared, validated loader catalogues. Never cache a failed query as unsupported.
use crate::*;
use futures_util::{stream::FuturesUnordered, StreamExt};
use sha1::{Digest, Sha1};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const NEO: &str = "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml";
/// Forge 官方 Maven 目录：BMCLAPI 查不到/超时时的后备来源。
const FORGE_MAVEN: &str =
    "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml";
const FORGE_GAMES: &str = "https://bmclapi2.bangbang93.com/forge/minecraft";

/// 从 Forge 官方 Maven 的版本列表（`1.20.1-47.2.0`）推导出游戏版本列表。
fn forge_games_from_maven(rows: &Value) -> Result<Value> {
    let mut games = std::collections::BTreeSet::new();
    for row in rows.as_array().ok_or("Forge 版本目录无效")? {
        if let Some(version) = row.as_str() {
            if let Some((game, _)) = version.split_once('-') {
                // 只接受形如 1.20.1 / 26.3 的游戏版本，避免把任意字符串当版本。
                if !game.is_empty()
                    && game.chars().all(|c| c.is_ascii_digit() || c == '.')
                    && game.chars().any(|c| c.is_ascii_digit())
                {
                    games.insert(game.to_string());
                }
            }
        }
    }
    if games.is_empty() {
        return Err("Forge 版本目录为空".into());
    }
    Ok(json!(games.into_iter().collect::<Vec<_>>()))
}

/// 从 Forge 官方 Maven 版本列表里筛出某个游戏版本的加载器版本。
fn forge_versions_from_maven(rows: &Value, game: &str) -> Result<Value> {
    let prefix = format!("{game}-");
    let versions: Vec<&str> = rows
        .as_array()
        .ok_or("Forge 版本目录无效")?
        .iter()
        .filter_map(Value::as_str)
        .filter_map(|version| version.strip_prefix(&prefix))
        .collect();
    Ok(json!(versions))
}

fn valid_rows(value: &Value, shape: &str) -> bool {
    value.as_array().is_some_and(|rows| {
        (shape == "forge" || !rows.is_empty())
            && rows.iter().all(|row| {
                if shape == "maven" || shape == "forge-games" {
                    row.as_str().is_some()
                } else {
                    row["version"].as_str().is_some()
                }
            })
    })
}

fn parse(text: &str, shape: &str) -> Result<Value> {
    if shape == "maven" {
        if !text.contains("<metadata") || !text.contains("</metadata>") {
            return Err("NeoForge 版本目录无效".into());
        }
        let re = regex::Regex::new(r"<version>([^<]+)</version>").unwrap();
        let rows: Vec<_> = re.captures_iter(text).map(|c| c[1].to_string()).collect();
        if rows.is_empty() {
            return Err("NeoForge 版本目录为空".into());
        }
        return Ok(json!(rows));
    }
    let value: Value = serde_json::from_str(text).map_err(err)?;
    if !valid_rows(&value, shape) {
        return Err("加载器版本目录格式无效".into());
    }
    Ok(value)
}

async fn fetch(core: &Core, urls: Vec<String>, shape: &str) -> Result<Value> {
    let mut requests = FuturesUnordered::new();
    // Both sources run immediately; a slow mirror cannot hold the official source back.
    for url in urls {
        requests.push(async move {
            let text = core
                .http
                .get(url)
                .timeout(Duration::from_secs(6))
                .send()
                .await
                .map_err(err)?
                .error_for_status()
                .map_err(err)?
                .text()
                .await
                .map_err(err)?;
            parse(&text, shape)
        });
    }
    let mut last = String::new();
    while let Some(result) = requests.next().await {
        match result {
            Ok(rows) => return Ok(rows),
            Err(error) => last = error,
        }
    }
    Err(format!("加载器查询失败，请重试：{last}"))
}

fn cached(path: &Path, shape: &str) -> Option<Value> {
    let value = read_json(path).ok()?;
    let age = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_secs()
        .checked_sub(value["fetchedAt"].as_u64()?)?;
    let rows = value["rows"].as_array()?;
    if !valid_rows(&value["rows"], shape) {
        return None;
    }
    // New loader support should not be hidden by a long-lived negative cache.
    (age < if rows.is_empty() { 60 } else { 3600 }).then(|| value["rows"].clone())
}

async fn catalog(core: &Core, url: &str, shape: &str, force: bool) -> Result<Value> {
    let key = format!("{:x}", Sha1::digest(format!("{shape}:{url}")));
    let path = core
        .root
        .join("cache/loader-catalogs")
        .join(format!("{key}.json"));
    if !force {
        if let Some(rows) = cached(&path, shape) {
            return Ok(rows);
        }
    }
    let lock = core.jobs.file_lock(&path);
    let _guard = lock.lock().await;
    if !force {
        if let Some(rows) = cached(&path, shape) {
            return Ok(rows);
        }
    }
    let source = core.download_source.read().map_err(err)?.clone();
    let rows = fetch(core, mirrors::candidates(url, &source), shape).await?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(err)?
        .as_secs();
    // Cache writes are optional: a read-only cache must not break a successful query.
    let _ = write_json(&path, &json!({"fetchedAt":timestamp,"rows":rows}));
    Ok(rows)
}

fn meta(loader: &str) -> &'static str {
    if loader == "fabric" {
        "https://meta.fabricmc.net/v2"
    } else {
        "https://meta.quiltmc.org/v3"
    }
}

pub async fn warm(core: &Core) -> Result<Value> {
    let mut requests = Vec::new();
    for loader in ["fabric", "quilt"] {
        for (endpoint, shape) in [("game", "games"), ("loader", "loaders")] {
            requests.push((format!("{}/versions/{endpoint}", meta(loader)), shape));
        }
    }
    requests.push((NEO.into(), "maven"));
    // 预取 Forge 的两个来源，打开安装窗口时可以直接命中缓存。
    requests.push((FORGE_GAMES.into(), "forge-games"));
    requests.push((FORGE_MAVEN.into(), "maven"));
    let mut work = FuturesUnordered::new();
    // Use one future type for all shared catalogues.
    for (url, shape) in requests {
        work.push(async move { catalog(core, &url, shape, false).await.is_ok() });
    }
    let mut ready = 0;
    while let Some(ok) = work.next().await {
        if ok {
            ready += 1;
        }
    }
    Ok(json!({"ready":ready}))
}

fn neo_matches(game: &str, version: &str) -> bool {
    let (base, suffix) = game
        .split_once('-')
        .map_or((game, None), |(base, suffix)| (base, Some(suffix)));
    let parts: Vec<_> = base.split('.').collect();
    if parts.len() < 2
        || parts.len() > 3
        || !parts
            .iter()
            .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
    {
        return false;
    }
    let patch = parts.get(2).copied().unwrap_or("0");
    let prefix = if parts[0] == "1" {
        if suffix.is_some() {
            return false;
        }
        format!("{}.{}.", parts[1], patch)
    } else if parts[0].parse::<u32>().unwrap_or(0) >= 26 {
        format!("{}.{}.{}.", parts[0], parts[1], patch)
    } else {
        return false;
    };
    version.starts_with(&prefix)
        && match suffix {
            Some(suffix) => version
                .split_once('+')
                .is_some_and(|(_, build)| build == suffix),
            None => !version.contains('+'),
        }
}

pub async fn loaders(core: &Core, game: &str, loader: &str, force: bool) -> Result<Value> {
    safe_name(game)?;
    match loader {
        "vanilla" => Ok(json!([])),
        "fabric" | "quilt" => {
            let api = meta(loader);
            let games_url = format!("{api}/versions/game");
            let loaders_url = format!("{api}/versions/loader");
            let (games, releases) = tokio::try_join!(
                catalog(core, &games_url, "games", force),
                catalog(core, &loaders_url, "loaders", force)
            )?;
            if !games
                .as_array()
                .unwrap()
                .iter()
                .any(|row| row["version"] == game)
            {
                return Ok(json!([]));
            }
            Ok(json!(releases
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|row| row["version"].as_str())
                .collect::<Vec<_>>()))
        }
        "forge" => {
            // BMCLAPI 与官方 Maven 同时查询：国内镜像失败时 Maven 已经返回，避免 6s 超时后再重试。
            let (bmcl_games, maven) = tokio::join!(
                catalog(core, FORGE_GAMES, "forge-games", force),
                catalog(core, FORGE_MAVEN, "maven", force)
            );
            let games = match bmcl_games {
                Ok(rows) => rows,
                Err(primary) => match &maven {
                    Ok(all) => forge_games_from_maven(all)
                        .map_err(|error| format!("{primary}；{error}"))?,
                    Err(fallback) => return Err(format!("{primary}；{fallback}")),
                },
            };
            if !games.as_array().unwrap().iter().any(|row| row == game) {
                return Ok(json!([]));
            }
            let rows = match &maven {
                Ok(all) => forge_versions_from_maven(all, game)?,
                Err(_) => catalog(core, &format!("{FORGE_GAMES}/{game}"), "forge", force).await?,
            };
            Ok(json!(rows
                .as_array()
                .unwrap()
                .iter()
                .rev()
                .filter_map(|row| row["version"].as_str().or_else(|| row.as_str()))
                .collect::<Vec<_>>()))
        }
        "neoforge" => {
            let rows = catalog(core, NEO, "maven", force).await?;
            Ok(json!(rows
                .as_array()
                .unwrap()
                .iter()
                .rev()
                .filter_map(Value::as_str)
                .filter(|v| neo_matches(game, v))
                .collect::<Vec<_>>()))
        }
        "optifine" => {
            let rows = crate::optifine::releases(core, game).await?;
            Ok(json!(rows
                .as_array()
                .ok_or("OptiFine 版本列表无效")?
                .iter()
                .filter_map(|r| r["value"].as_str())
                .collect::<Vec<_>>()))
        }
        _ => Err("未知的加载器".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn matches_exact_game_in_both_neoforge_version_schemes() {
        for (game, release) in [
            ("26.3", "26.3.0.99"),
            ("26.3.1", "26.3.1.2-beta"),
            ("1.21.1", "21.1.200"),
            ("1.21", "21.0.1-beta"),
            ("26.1-snapshot-1", "26.1.0.0-alpha.2+snapshot-1"),
        ] {
            assert!(neo_matches(game, release), "{game} {release}");
        }
        for (game, release) in [
            ("26.3", "26.3.1.2"),
            ("26.3", "26.3.0.0-alpha.2+snapshot-1"),
            ("26.1-snapshot-1", "26.1.0.1"),
            ("1.21.1", "21.10.3"),
            ("b1.8.1", "8.1.2"),
            ("26.3-pre-1", "26.3.0.99"),
        ] {
            assert!(!neo_matches(game, release), "{game} {release}");
        }
    }
    #[test]
    fn forge_maven_fallback_derives_games_and_versions() {
        let rows = json!(["1.20.1-47.2.0", "1.20.1-47.1.3", "26.3-60.0.1", "not-a-version"]);
        let games = forge_games_from_maven(&rows).unwrap();
        assert!(games.as_array().unwrap().iter().any(|game| game == "26.3"));
        assert!(!games.as_array().unwrap().iter().any(|game| game == "not"));
        let versions = forge_versions_from_maven(&rows, "1.20.1").unwrap();
        assert_eq!(versions, json!(["47.2.0", "47.1.3"]));
        assert_eq!(forge_versions_from_maven(&rows, "26.3").unwrap(), json!(["60.0.1"]));
        assert_eq!(forge_versions_from_maven(&rows, "1.21").unwrap(), json!([]));
    }
    #[test]
    fn validates_before_accepting_source() {
        assert!(parse("<html>gateway error</html>", "maven").is_err());
        assert!(parse("[]", "games").is_err());
        assert!(parse("[{\"error\":\"slow\"}]", "loaders").is_err());
        assert_eq!(parse("[]", "forge").unwrap(), json!([]));
    }
    #[test]
    fn cache_expires_empty_results_early() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("cache.json");
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        for (rows, age, fresh) in [
            (json!([]), 10, true),
            (json!([]), 61, false),
            (json!(["ok"]), 61, true),
            (json!(["ok"]), 3601, false),
        ] {
            let shape = if rows.as_array().unwrap().is_empty() {
                "forge"
            } else {
                "maven"
            };
            write_json(&path, &json!({"rows":rows,"fetchedAt":now-age})).unwrap();
            assert_eq!(cached(&path, shape).is_some(), fresh);
        }
        write_json(&path, &json!({"rows":[false],"fetchedAt":now})).unwrap();
        assert!(cached(&path, "loaders").is_none());
    }
    async fn server(
        delay: u64,
        body: &'static str,
    ) -> (
        String,
        Arc<std::sync::atomic::AtomicUsize>,
        tokio::task::JoinHandle<()>,
    ) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/catalog", listener.local_addr().unwrap());
        let hits = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let count = hits.clone();
        let handle = tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                count.fetch_add(1, Ordering::SeqCst);
                tokio::spawn(async move {
                    let mut request = [0; 2048];
                    let _ = socket.read(&mut request).await;
                    tokio::time::sleep(Duration::from_millis(delay)).await;
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = socket.write_all(response.as_bytes()).await;
                });
            }
        });
        (url, hits, handle)
    }
    #[tokio::test]
    async fn stalled_or_invalid_source_cannot_delay_valid_source() {
        let temp = tempfile::tempdir().unwrap();
        let core = Core::new(temp.path().into(), Arc::new(|_| {})).unwrap();
        let (slow, _, a) = server(1500, "[{\"version\":\"slow\"}]").await;
        let (bad, _, b) = server(0, "<html>broken mirror</html>").await;
        let (fast, _, c) = server(20, "[{\"version\":\"fast\"}]").await;
        let start = std::time::Instant::now();
        assert_eq!(
            fetch(&core, vec![slow, bad, fast], "loaders")
                .await
                .unwrap()[0]["version"],
            "fast"
        );
        assert!(start.elapsed() < Duration::from_millis(1000));
        a.abort();
        b.abort();
        c.abort();
    }
    #[tokio::test]
    async fn concurrent_requests_share_cache_and_retry_bypasses_it() {
        let temp = tempfile::tempdir().unwrap();
        let core = Core::new(temp.path().into(), Arc::new(|_| {})).unwrap();
        let (url, hits, handle) = server(30, "[{\"version\":\"1\"}]").await;
        let (a, b) = tokio::join!(
            catalog(&core, &url, "loaders", false),
            catalog(&core, &url, "loaders", false)
        );
        assert_eq!(a.unwrap(), b.unwrap());
        assert_eq!(hits.load(Ordering::SeqCst), 1);
        catalog(&core, &url, "loaders", false).await.unwrap();
        assert_eq!(hits.load(Ordering::SeqCst), 1);
        catalog(&core, &url, "loaders", true).await.unwrap();
        assert_eq!(hits.load(Ordering::SeqCst), 2);
        handle.abort();
        let (url, hits, handle) = server(0, "<html>error</html>").await;
        assert!(catalog(&core, &url, "loaders", false).await.is_err());
        assert!(catalog(&core, &url, "loaders", false).await.is_err());
        assert_eq!(hits.load(Ordering::SeqCst), 2);
        handle.abort();
    }
}
