use crate::{curseforge, engine, err, error_chain, resource_delete, string, Core, Result};
use futures_util::StreamExt;
use sha1::{Digest, Sha1};
use std::{
    fs,
    io::{self, Read, Write},
    net::SocketAddr,
    path::{Path, PathBuf},
    time::Duration,
};

const PIXELMAP_API: &str = "https://goto.pixelmap.cc/api/open/v1/maps";
const MAX_DOWNLOAD: u64 = 2 * 1024 * 1024 * 1024;
const PIXELMAP_NO_FILE: &str = "像素茶艺暂未提供地图文件，可查看作者原帖。";
const CURSEFORGE_NO_FILE: &str = "CurseForge 暂未向启动器提供此地图的下载文件。";

#[derive(Clone, Copy)]
struct ArchiveLimits {
    max_entries: usize,
    max_total_bytes: u64,
    max_entry_bytes: u64,
    max_ratio: u64,
}

const MAP_LIMITS: ArchiveLimits = ArchiveLimits {
    max_entries: 20_000,
    max_total_bytes: 2 * 1024 * 1024 * 1024,
    max_entry_bytes: 1024 * 1024 * 1024,
    max_ratio: 80,
};

enum HostPolicy<'a> {
    Pixelmap,
    Forgecdn,
    Named(&'a str),
}

enum ZipInstall {
    Worlds(Vec<String>),
    NoLevelDat,
}

struct SavedArchive {
    name: String,
}

struct RemoteArchive {
    name: String,
    cover: Option<String>,
}

pub async fn catalog(core: &Core, p: &serde_json::Value) -> Result<serde_json::Value> {
    let page = p["page"].as_u64().unwrap_or(0);
    let pixelmap = || async {
        let value = search_pixelmap(core, p).await?;
        let hits: Vec<_> = value["hits"].as_array().into_iter().flatten().filter_map(project_from_pixelmap).collect();
        Ok::<_, String>(serde_json::json!({"hits": hits, "total": value["total"], "page": page, "pageSize": 20}))
    };
    let curseforge = || async {
        let value = search_curseforge(core, p).await?;
        let hits: Vec<_> = value["hits"].as_array().into_iter().flatten().filter_map(project_from_curseforge).collect();
        Ok::<_, String>(serde_json::json!({
            "hits": hits,
            "total": value["total"],
            "page": page,
            "pageSize": value["pageSize"].as_u64().unwrap_or(30)
        }))
    };
    match p["source"].as_str().unwrap_or("all") {
        "pixelmap" => pixelmap().await,
        "curseforge" => curseforge().await,
        "modrinth" => Ok(serde_json::json!({"hits": [], "total": 0, "page": page, "pageSize": 30})),
        "all" => {
            let (pixelmap, curseforge) = tokio::join!(pixelmap(), curseforge());
            if pixelmap.is_err() && curseforge.is_err() {
                return Err(format!("两个地图源都不可用。像素茶艺：{}；CurseForge：{}", pixelmap.unwrap_err(), curseforge.unwrap_err()));
            }
            let mut hits = Vec::new();
            let mut total = 0_u64;
            let mut warnings = Vec::new();
            for (name, result) in [("像素茶艺", pixelmap), ("CurseForge", curseforge)] {
                match result {
                    Ok(value) => {
                        total = total.saturating_add(value["total"].as_u64().unwrap_or(0));
                        hits.extend(value["hits"].as_array().cloned().unwrap_or_default());
                    }
                    Err(error) => warnings.push(format!("{name} 暂时不可用：{error}")),
                }
            }
            hits.sort_by_key(|hit| std::cmp::Reverse(hit["downloads"].as_u64().unwrap_or(0)));
            hits.truncate(30);
            Ok(serde_json::json!({
                "hits": hits,
                "total": total,
                "page": page,
                "pageSize": 30,
                "warning": if warnings.is_empty() { serde_json::Value::Null } else { serde_json::json!(warnings.join("；")) }
            }))
        }
        _ => Err("地图来源无效".into()),
    }
}

fn project_from_pixelmap(hit: &serde_json::Value) -> Option<serde_json::Value> {
    let title = nonempty(hit["title"].as_str())?;
    let slug = nonempty(hit["id"].as_str())?;
    let preview = hit["previewUrl"].as_str().filter(|url| https_only(url));
    let mut project = serde_json::json!({
        "project_id": slug,
        "title": title,
        "description": nonempty(hit["summary"].as_str()).unwrap_or(""),
        "downloads": hit["views"].as_u64().unwrap_or(0),
        "project_type": "world",
        "slug": slug,
        "source": "pixelmap",
        "gallery": preview.map(|url| vec![serde_json::json!({"url": url})]).unwrap_or_default(),
    });
    if let Some(url) = preview { project["icon_url"] = serde_json::json!(url); }
    copy_text(&mut project, "author", hit["author"].as_str());
    copy_text(&mut project, "page_url", hit["pageUrl"].as_str());
    copy_text(&mut project, "download_state", hit["download_state"].as_str());
    copy_text(&mut project, "download_note", hit["download_note"].as_str());
    Some(project)
}

fn project_from_curseforge(hit: &serde_json::Value) -> Option<serde_json::Value> {
    let title = nonempty(hit["title"].as_str())?;
    let id = nonempty(hit["id"].as_str())?;
    let preview = hit["previewUrl"].as_str().filter(|url| https_only(url));
    let mut project = serde_json::json!({
        "project_id": id,
        "title": title,
        "description": nonempty(hit["summary"].as_str()).unwrap_or(""),
        "downloads": hit["downloads"].as_u64().unwrap_or(0),
        "project_type": "world",
        "slug": hit.get("slug").and_then(|v| v.as_str()).unwrap_or(""),
        "source": "curseforge",
        "gallery": preview.map(|url| vec![serde_json::json!({"url": url})]).unwrap_or_default(),
    });
    if let Some(url) = hit["iconUrl"].as_str().filter(|url| https_only(url)).or(preview) {
        project["icon_url"] = serde_json::json!(url);
    }
    copy_text(&mut project, "author", hit["author"].as_str());
    copy_text(&mut project, "page_url", hit["pageUrl"].as_str());
    copy_text(&mut project, "download_state", hit["download_state"].as_str());
    copy_text(&mut project, "download_note", hit["download_note"].as_str());
    Some(project)
}

pub async fn versions(core: &Core, p: &serde_json::Value) -> Result<serde_json::Value> {
    let slug = pixelmap_slug(string(p, "project")?)?;
    let detail = pixelmap_json(core, &format!("{PIXELMAP_API}/query/{slug}")).await?;
    if let Some(link) = linked_curseforge_world(&detail) {
        let key = curseforge::configured_key(core, p["curseforgeKey"].as_str().unwrap_or(""));
        let Some(project) = curseforge::world_by_slug(core, &link, key.as_deref()).await? else {
            return Ok(unavailable_versions(p, CURSEFORGE_NO_FILE));
        };
        let mut query = p.clone();
        query["source"] = serde_json::json!("curseforge");
        query["project"] = serde_json::json!(project);
        // The author's listed Minecraft version can differ from the file's tags.
        query["game"] = serde_json::Value::Null;
        query["loader"] = serde_json::Value::Null;
        let mut page = crate::mod_updates::resource_versions(core, &query).await?;
        let rows = if p["paged"] == true { &mut page["versions"] } else { &mut page };
        if let Some(rows) = rows.as_array_mut() {
            for row in rows {
                row["fileSource"] = serde_json::json!("CurseForge");
            }
        }
        return Ok(page);
    }
    let (parsed, kind) = match classify_pixelmap_download(&detail) {
        Ok(archive) => archive,
        Err(reason) => return Ok(unavailable_versions(p, &reason)),
    };
    let filename = archive_name(parsed.path(), kind);
    let row = serde_json::json!({
        "id": slug,
        "name": detail["title"],
        "number": filename,
        "filename": filename,
        "date": detail["publish_time"],
        "type": "release",
        "gameVersions": detail["versions"],
        "loaders": [],
        "compatible": true
    });
    if p["paged"] == true {
        Ok(serde_json::json!({"versions": [row], "nextOffset": null, "total": 1}))
    } else {
        Ok(serde_json::json!([row]))
    }
}

fn unavailable_versions(p: &serde_json::Value, reason: &str) -> serde_json::Value {
    if p["paged"] == true {
        serde_json::json!({"versions": [], "nextOffset": null, "total": 0, "unavailable": reason})
    } else {
        serde_json::json!([])
    }
}

fn linked_curseforge_world(detail: &serde_json::Value) -> Option<String> {
    if detail["download_allowed"] != true || detail["download_integrated"] == true {
        return None;
    }
    let url = detail["download_url"].as_str()?.trim();
    if !curseforge_page(url) {
        return None;
    }
    let url = reqwest::Url::parse(url).ok()?;
    if url.password().is_some() || url.port().is_some() {
        return None;
    }
    let mut parts = url.path_segments()?;
    if parts.next()? != "minecraft" || parts.next()? != "worlds" {
        return None;
    }
    let slug = parts.next()?;
    match (parts.next(), parts.next()) {
        (None | Some(""), None) if slug_token(slug) => Some(slug.to_owned()),
        _ => None,
    }
}

pub fn prefer_system_addresses(addrs: impl IntoIterator<Item = SocketAddr>) -> Vec<SocketAddr> {
    let mut v4 = Vec::new();
    let mut v6 = Vec::new();
    for addr in addrs {
        if addr.is_ipv4() { v4.push(addr); } else { v6.push(addr); }
    }
    v4.extend(v6);
    v4
}

fn pixelmap_client(host: &str, addr: Option<SocketAddr>, body_timeout: Option<Duration>) -> Result<reqwest::Client> {
    let mut builder = reqwest::Client::builder()
        .user_agent(format!("Kynex Launcher/{} (independent launcher)", crate::release::version()))
        .connect_timeout(Duration::from_secs(20))
        .pool_max_idle_per_host(0)
        .no_gzip()
        .min_tls_version(reqwest::tls::Version::TLS_1_2)
        .redirect(reqwest::redirect::Policy::none());
    if let Some(timeout) = body_timeout {
        builder = builder.timeout(timeout);
    } else {
        builder = builder.http1_only();
    }
    #[cfg(windows)]
    { builder = builder.use_native_tls(); }
    #[cfg(not(windows))]
    { builder = builder.use_rustls_tls(); }
    if let Some(addr) = addr {
        if !host.is_empty() {
            builder = builder.resolve(host, addr);
        }
    }
    builder.build().map_err(|error| format!("无法创建像素茶艺连接：{}", error_chain(&error)))
}

fn classify_pixelmap_download(detail: &serde_json::Value) -> Result<(reqwest::Url, &'static str)> {
    if detail["download_allowed"] != true {
        return Err(PIXELMAP_NO_FILE.into());
    }
    let url = detail["download_url"].as_str().unwrap_or("").trim();
    if url.is_empty() {
        return Err(PIXELMAP_NO_FILE.into());
    }
    crate::https(url)?;
    let parsed = reqwest::Url::parse(url).map_err(|_| "像素茶艺下载地址无效")?;
    if parsed.scheme() != "https" || !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("下载地址不是不带账号的 https 链接，没有开始下载".into());
    }
    let host = parsed.host_str().unwrap_or("");
    if host.is_empty() || host.parse::<std::net::IpAddr>().is_ok() {
        return Err("下载地址没有可用的域名，没有开始下载".into());
    }
    let leaf = parsed.path().rsplit('/').next().unwrap_or("").to_ascii_lowercase();
    if leaf.ends_with(".schem") || leaf.ends_with(".litematic") || leaf.ends_with(".nbt") {
        return Err("接口给出的是投影或结构文件，不是可以安装的地图压缩包，没有开始下载".into());
    }
    let kind = file_kind(parsed.path()).ok_or("作者提供的是外部网页或网盘。请到原帖查看下载方式。")?;
    if detail["download_integrated"] == true && !host_allowed(host, &HostPolicy::Pixelmap) {
        return Err("标记为本站托管，但地址不在像素茶艺存储域名上，没有开始下载".into());
    }
    Ok((parsed, kind))
}

async fn pixelmap_json(core: &Core, url: &str) -> Result<serde_json::Value> {
    core.stopped()?;
    pixelmap_exchange(url).await
}

/// One documented search request on the same client search uses.
/// The string is status/counts or the error chain. It contains no credentials.
/// Reads response headers and the first 64 KiB with the archive download client.
/// The text contains the host, type, length, encoding and error chain only.
pub async fn pixelmap_file_probe(slug: &str) -> String {
    let slug = match pixelmap_slug(slug) {
        Ok(slug) => slug,
        Err(error) => return format!("slug_error={error}"),
    };
    let detail = match pixelmap_exchange(&format!("{PIXELMAP_API}/query/{slug}")).await {
        Ok(detail) => detail,
        Err(error) => return format!("query_error={error}"),
    };
    let (parsed, kind) = match classify_pixelmap_download(&detail) {
        Ok(file) => file,
        Err(error) => return format!("file_rejected={error}"),
    };
    let host = parsed.host_str().unwrap_or("").to_string();
    let looked_up = tokio::net::lookup_host((host.as_str(), 443)).await.ok().map(prefer_system_addresses).unwrap_or_default();
    let client = match pixelmap_client(&host, looked_up.first().copied(), None) {
        Ok(client) => client,
        Err(error) => return format!("client_error={error}"),
    };
    let response = match client.get(parsed.clone()).header(reqwest::header::ACCEPT_ENCODING, "identity").send().await {
        Ok(response) => response,
        Err(error) => return format!("send_error={}", error_chain(&error)),
    };
    let encoding = response.headers().get(reqwest::header::CONTENT_ENCODING).and_then(|value| value.to_str().ok()).unwrap_or("-").to_string();
    let content_type = response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|value| value.to_str().ok()).unwrap_or("-").to_string();
    let length = response.content_length().map(|value| value.to_string()).unwrap_or_else(|| "-".into());
    if !response.status().is_success() {
        return format!("host={host} kind={kind} status={} content_type={content_type} content_encoding={encoding} length={length}", response.status().as_u16());
    }
    let mut stream = response.bytes_stream();
    let mut written = 0_usize;
    let mut magic = Vec::new();
    let limit = 64 * 1024;
    while written < limit {
        match stream.next().await {
            Some(Ok(chunk)) => {
                if magic.len() < 8 {
                    magic.extend(chunk.iter().take(8 - magic.len()).copied());
                }
                written = written.saturating_add(chunk.len());
            }
            Some(Err(error)) => {
                return format!("host={host} kind={kind} content_type={content_type} content_encoding={encoding} length={length} bytes={written} body_error={}", error_chain(&error));
            }
            None => break,
        }
    }
    drop(stream);
    let magic = magic.iter().map(|byte| format!("{byte:02x}")).collect::<Vec<_>>().join("");
    format!("host={host} kind={kind} content_type={content_type} content_encoding={encoding} length={length} prefix_bytes={written} magic={magic}")
}

pub async fn pixelmap_search_probe() -> String {
    let url = format!("{PIXELMAP_API}/search?page=1&limit=1&sort=trend");
    match pixelmap_exchange(&url).await {
        Ok(value) => {
            let items = value["items"].as_array().map(|rows| rows.len()).unwrap_or(0);
            let total = value.get("total").and_then(|item| item.as_u64()).unwrap_or(0);
            format!("status=200 total={total} items={items}")
        }
        Err(error) => format!("request_error={error}"),
    }
}

async fn pixelmap_exchange(url: &str) -> Result<serde_json::Value> {
    let host = reqwest::Url::parse(url).ok().and_then(|parsed| parsed.host_str().map(str::to_string)).unwrap_or_default();
    if host.is_empty() || !host_allowed(&host, &HostPolicy::Pixelmap) {
        return Err("像素茶艺地址无效".into());
    }
    let looked_up = tokio::net::lookup_host((host.as_str(), 443)).await.ok().map(|items| prefer_system_addresses(items)).unwrap_or_default();
    let mut last = String::new();
    for (http1, addr) in [(false, looked_up.first().copied()), (true, looked_up.first().copied())] {
        let client = pixelmap_client(&host, addr, Some(Duration::from_secs(30)))?;
        let mut request = client.get(url).header(reqwest::header::ACCEPT, "application/json");
        if http1 { request = request.version(reqwest::Version::HTTP_11); }
        match request.send().await {
            Ok(response) => {
                let status = response.status();
                if response.url().scheme() != "https" || response.url().host_str() != Some(host.as_str()) {
                    return Err("像素茶艺响应来自未允许的地址".into());
                }
                let text = response.text().await.map_err(|error| format!("像素茶艺响应无法读取：{}", error_chain(&error)))?;
                if !status.is_success() {
                    return Err(format!("像素茶艺返回 HTTP {}", status.as_u16()));
                }
                return serde_json::from_str(&text).map_err(|_| "像素茶艺返回了无法识别的结果".into());
            }
            Err(error) => {
                let family = addr.map(|item| if item.is_ipv4() { "IPv4" } else { "IPv6" }).unwrap_or("系统解析");
                let protocol = if http1 { "HTTP/1.1" } else { "默认协议" };
                last = format!("{family}/{protocol}：{}", error_chain(&error));
            }
        }
    }
    Err(format!("像素茶艺连接失败：{last}"))
}

pub async fn search(core: &Core, p: &serde_json::Value) -> Result<serde_json::Value> {
    match p["source"].as_str().unwrap_or("pixelmap") {
        "pixelmap" => search_pixelmap(core, p).await,
        "curseforge" => search_curseforge(core, p).await,
        _ => Err("地图来源无效".into()),
    }
}

pub async fn install(core: &Core, p: &serde_json::Value) -> Result<serde_json::Value> {
    let saves = real_directory(core, p, "saves")?;
    let downloads = real_directory(core, p, "map-downloads")?;
    let preferred = p["name"].as_str().unwrap_or("地图");
    match string(p, "source")? {
        "file" => {
            let path = PathBuf::from(string(p, "path")?);
            let preferred = preferred.to_owned();
            core.stage("解压地图存档", 0, 1);
            tokio::task::spawn_blocking(move || install_local(&path, &saves, &downloads, &preferred))
                .await.map_err(err)?
        }
        "pixelmap" | "curseforge" => {
            let temp = temp_file(core)?;
            let result = async {
                let archive = fetch_archive(core, p, &temp).await?;
                core.stopped()?;
                core.stage("解压地图存档", 0, 1);
                let temp = temp.clone();
                let saves = saves.clone();
                let downloads = downloads.clone();
                let preferred = preferred.to_owned();
                let core = core.clone();
                tokio::task::spawn_blocking(move || {
                    let result = finish_archive(&temp, &archive.name, &saves, &downloads, &preferred)?;
                    if let Some(cover) = archive.cover {
                        for world in result["worlds"].as_array().into_iter().flatten().filter_map(serde_json::Value::as_str) {
                            remember_world_cover(&core, &saves.join(world), &cover);
                        }
                    }
                    Ok(result)
                }).await.map_err(err)?
            }.await;
            let _ = fs::remove_dir_all(temp.parent().unwrap_or(&temp));
            result
        }
        _ => Err("地图来源无效".into()),
    }
}

pub async fn save(core: &Core, p: &serde_json::Value) -> Result<serde_json::Value> {
    let path = Path::new(string(p, "path")?);
    if !path.is_absolute() || path.file_name().is_none() {
        return Err("请选择完整的保存路径".into());
    }
    let parent = path.parent().ok_or("保存目录无效")?;
    let temp = tempfile::NamedTempFile::new_in(parent).map_err(err)?.into_temp_path();
    let archive = fetch_archive(core, p, &temp).await?;
    core.stopped()?;
    temp.persist(path).map_err(err)?;
    Ok(serde_json::json!({"path": path, "filename": archive.name}))
}

fn allowed_world_cover(url: &str) -> bool {
    reqwest::Url::parse(url).ok().is_some_and(|url| {
        url.scheme() == "https" && url.username().is_empty() && url.password().is_none()
            && url.port().is_none() && url.host_str().is_some_and(|host| {
                match host {
                    "oss.pixelmap.cc" => url.path().starts_with("/pixelmap/covers/"),
                    "thingy.top" => url.path().starts_with("/view.php/"),
                    "img.remit.ee" => url.path().starts_with("/api/file/"),
                    "s41.ax1x.com" => url.path().ends_with(".png"),
                    _ => host_allowed(host, &HostPolicy::Forgecdn),
                }
            })
    })
}

fn cover_record(core: &Core, world: &Path) -> Option<PathBuf> {
    use sha2::{Digest, Sha256};

    let meta = fs::symlink_metadata(world).ok()?;
    if !meta.is_dir() || resource_delete::is_link(&meta) {
        return None;
    }
    let address = world.canonicalize().ok()?;
    let stamp = meta.created().ok().and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok());
    let key = format!("{:x}", Sha256::digest(format!("{}:{stamp:?}", address.display())));
    Some(core.data_root.join("cache/map-world-covers").join(format!("{key}.json")))
}

pub(crate) fn world_cover(core: &Core, world: &Path) -> Option<String> {
    let record = crate::read_json(&cover_record(core, world)?).ok()?;
    record.as_str().filter(|url| allowed_world_cover(url)).map(str::to_owned)
}

fn remember_world_cover(core: &Core, world: &Path, cover: &str) {
    let Some(path) = cover_record(core, world).filter(|_| allowed_world_cover(cover)) else { return };
    let Some(parent) = path.parent() else { return };
    if fs::create_dir_all(parent).is_err() {
        return;
    }
    if let Ok(mut record) = tempfile::NamedTempFile::new_in(parent) {
        if serde_json::to_writer(&mut record, cover).is_ok() {
            let _ = record.persist(path);
        }
    }
}

/// Earlier builds saved the original ZIP without recording its cover. Recover
/// an association only when that ZIP contains the world's actual level.dat.
pub async fn restore_world_covers(core: &Core, p: &serde_json::Value) -> Result<serde_json::Value> {
    use serde_json::{json, Map, Value};
    let saves = engine::resource_dir(core, &json!({"id":p["id"],"kind":"saves"}))?;
    let downloads = engine::resource_dir(core, &json!({"id":p["id"],"kind":"map-downloads"}))?;
    let mut result = Map::new();
    let mut missing = Vec::new();
    for name in p["names"].as_array().into_iter().flatten().filter_map(Value::as_str).take(24) {
        if !resource_delete::valid_name(name) {
            continue;
        }
        let world = saves.join(name);
        if let Some(cover) = world_cover(core, &world) {
            result.insert(name.to_owned(), json!(cover));
        } else if cover_record(core, &world).is_some() && world.join("level.dat").is_file() {
            missing.push((name, world));
        }
    }
    if missing.is_empty() || !fs::symlink_metadata(&downloads).is_ok_and(|meta| {
        meta.is_dir() && !resource_delete::is_link(&meta)
    }) {
        return Ok(Value::Object(result));
    }
    let archives: Vec<_> = fs::read_dir(&downloads).map_err(err)?.flatten().filter_map(|entry| {
        let path = entry.path();
        let name = path.file_name()?.to_str()?;
        if file_kind(name) != Some("zip") || !entry.file_type().ok()?.is_file() {
            return None;
        }
        let stem = path.file_stem()?.to_str()?;
        Some((without_copy_suffix(stem).to_ascii_lowercase(), path))
    }).collect();
    if archives.is_empty() {
        return Ok(Value::Object(result));
    }
    let (catalog, _) = crate::project_versions::cached(core, json!("pixelmap-cover-catalog"), false, || async {
        let first = search_pixelmap(core, &json!({})).await?;
        let count = first["total"].as_u64().unwrap_or(0).div_ceil(20).min(30);
        let mut hits = first["hits"].as_array().cloned().unwrap_or_default();
        let mut pages = futures_util::stream::iter(1..count)
            .map(|page| async move { search_pixelmap(core, &json!({"page":page})).await })
            .buffered(3);
        while let Some(page) = pages.next().await {
            if let Value::Array(items) = &mut page?["hits"] {
                hits.append(items);
            }
        }
        Ok(json!(hits))
    }).await?;
    let hits = catalog.as_array().ok_or("像素茶艺目录响应无效")?;
    for (name, world) in missing {
        let title_key = cover_title_key(name);
        let mut candidates = hits.iter().filter(|hit| hit["title"].as_str()
            .is_some_and(|title| cover_title_key(title) == title_key));
        let Some(hit) = candidates.next() else { continue };
        if candidates.next().is_some() {
            continue;
        }
        let Some(slug) = hit["id"].as_str().and_then(|slug| pixelmap_slug(slug).ok()) else { continue };
        let Ok(detail) = pixelmap_json(core, &format!("{PIXELMAP_API}/query/{slug}")).await else { continue };
        let (Ok((url, "zip")), Some(cover)) = (classify_pixelmap_download(&detail),
            detail["preview_image"].as_str().filter(|url| allowed_world_cover(url))) else { continue };
        let file_name = archive_name(url.path(), "zip");
        let Some(stem) = Path::new(&file_name).file_stem().and_then(|stem| stem.to_str()) else { continue };
        if archives.iter().any(|(key, path)| key.eq_ignore_ascii_case(stem) && same_world_level(&world, path)) {
            remember_world_cover(core, &world, cover);
            result.insert(name.to_owned(), json!(cover));
        }
    }
    Ok(Value::Object(result))
}

fn without_copy_suffix(name: &str) -> &str {
    name.rsplit_once(" (")
        .filter(|(_, end)| end.strip_suffix(')').is_some_and(|id| id.parse::<u32>().is_ok()))
        .map_or(name, |(base, _)| base)
}

fn cover_title_key(title: &str) -> String {
    without_copy_suffix(title).chars().filter(|ch| ch.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

fn same_world_level(world: &Path, archive: &Path) -> bool {
    const LEVEL_LIMIT: u64 = 8 * 1024 * 1024;
    let locals: Vec<_> = ["level.dat", "level.dat_old"].iter().filter_map(|name| {
        let path = world.join(name);
        let meta = fs::symlink_metadata(&path).ok()?;
        if !meta.is_file() || resource_delete::is_link(&meta) || meta.len() == 0 || meta.len() > LEVEL_LIMIT {
            return None;
        }
        let mut bytes = Vec::new();
        fs::File::open(path).ok()?.take(LEVEL_LIMIT + 1).read_to_end(&mut bytes).ok()?;
        Some(bytes)
    }).collect();
    let Some(mut zip) = fs::File::open(archive).ok().and_then(|file| zip::ZipArchive::new(file).ok()) else {
        return false;
    };
    if locals.is_empty() || zip.len() > MAP_LIMITS.max_entries {
        return false;
    }
    let levels: Vec<_> = zip.file_names().filter(|name| name.rsplit('/').next() == Some("level.dat"))
        .take(32).map(str::to_owned).collect();
    levels.iter().any(|name| {
        let Ok(mut member) = zip.by_name(name) else { return false };
        if !locals.iter().any(|bytes| bytes.len() as u64 == member.size()) {
            return false;
        }
        let mut bytes = Vec::new();
        (&mut member).take(LEVEL_LIMIT + 1).read_to_end(&mut bytes).is_ok() && locals.contains(&bytes)
    })
}

async fn search_pixelmap(core: &Core, p: &serde_json::Value) -> Result<serde_json::Value> {
    let page = p["page"].as_u64().unwrap_or(0).min(500);
    let mut url = reqwest::Url::parse(&format!("{PIXELMAP_API}/search")).map_err(err)?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs
            .append_pair("page", &(page + 1).to_string())
            .append_pair("limit", "20")
            .append_pair("sort", "trend");
        if let Some(keyword) = text_token(p["query"].as_str().unwrap_or(""), 80) {
            pairs.append_pair("keyword", keyword);
        }
        if let Some(version) = text_token(p["game"].as_str().unwrap_or(""), 32) {
            pairs.append_pair("version", version);
        }
    }
    let value = pixelmap_json(core, url.as_str()).await.map_err(|error| format!("像素茶艺暂时不可用：{error}"))?;
    let items = value["items"].as_array().ok_or_else(|| {
        value["message"]
            .as_str()
            .unwrap_or("像素茶艺返回了无法识别的结果")
            .to_string()
    })?;
    let hits: Vec<_> = items.iter().filter_map(pixelmap_hit).collect();
    let total = value["total"].as_u64().unwrap_or(hits.len() as u64);
    Ok(serde_json::json!({"hits": hits, "total": total, "page": page, "pageSize": 20}))
}

async fn search_curseforge(core: &Core, p: &serde_json::Value) -> Result<serde_json::Value> {
    let page = p["page"].as_u64().unwrap_or(0);
    let query = p["query"].as_str().unwrap_or("");
    let game = text_token(p["game"].as_str().unwrap_or(""), 32);
    let value = curseforge::search(
        core,
        "world",
        query,
        game,
        None,
        None,
        p["curseforgeKey"].as_str().unwrap_or(""),
        page,
    )
    .await
    .map_err(|error| format!("CurseForge 地图暂时不可用：{error}"))?;
    let hits: Vec<_> = value["hits"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(curseforge_hit)
        .collect();
    Ok(serde_json::json!({
        "hits": hits,
        "total": value["total"].as_u64().unwrap_or(hits.len() as u64),
        "page": page,
        "pageSize": value["pageSize"].as_u64().unwrap_or(30)
    }))
}

fn pixelmap_hit(item: &serde_json::Value) -> Option<serde_json::Value> {
    let title = nonempty(item["title"].as_str())?;
    let slug = item["slug"].as_str().unwrap_or("").trim();
    let only_other = item["categories"].as_array()
        .is_some_and(|categories| categories.as_slice() == [serde_json::json!("其他")]);
    if only_other && (
        slug == "XZhongjie_brochure-terra"
        || slug.starts_with("pixelmap_official_") && item["download_allowed"] == false
    ) {
        return None;
    }
    let slug_ok = pixelmap_slug(slug).is_ok();
    let allowed = item["download_allowed"] == true && slug_ok;
    let integrated = item["download_integrated"] == true;
    let (state, note) = if allowed && integrated {
        ("file", "")
    } else if allowed {
        ("check", "")
    } else if !slug_ok {
        ("closed", "接口没有给出可用的地图标识")
    } else {
        ("closed", PIXELMAP_NO_FILE)
    };
    let page = pixelmap_page_url(item["url"].as_str(), if slug_ok { slug } else { "" });
    let id = if slug_ok {
        slug.to_string()
    } else {
        page.clone().unwrap_or_default()
    };
    if id.is_empty() {
        return None;
    }
    let mut hit = serde_json::json!({
        "id": id,
        "title": title,
        "source": "pixelmap",
        "sourceLabel": "像素茶艺",
        "action": state,
        "download_state": state,
        "download_note": note,
    });
    copy_text(&mut hit, "author", item["author"].as_str());
    copy_text(&mut hit, "summary", item["summary"].as_str());
    if let Some(url) = item["preview_image"].as_str().filter(|url| https_only(url)) {
        hit["previewUrl"] = serde_json::json!(url);
    }
    if let Some(url) = page {
        hit["pageUrl"] = serde_json::json!(url);
    }
    copy_list(&mut hit, "versions", "versionCount", &item["versions"], 3);
    copy_list(&mut hit, "categories", "categoryCount", &item["categories"], 4);
    if let Some(views) = item["views"].as_u64() {
        hit["views"] = serde_json::json!(views);
    }
    Some(hit)
}

fn curseforge_hit(hit: &serde_json::Value) -> Option<serde_json::Value> {
    let title = nonempty(hit["title"].as_str())?;
    let id = hit["project_id"]
        .as_u64()
        .map(|id| id.to_string())
        .or_else(|| hit["project_id"].as_str().map(str::to_string))
        .filter(|id| id.parse::<u64>().is_ok())?;
    let closed = hit["distribution_allowed"] == false;
    let state = if closed { "closed" } else { "file" };
    let mut row = serde_json::json!({
        "id": id,
        "title": title,
        "source": "curseforge",
        "sourceLabel": "CurseForge",
        "action": state,
        "download_state": state,
    });
    if closed {
        row["download_note"] = serde_json::json!(CURSEFORGE_NO_FILE);
    }
    copy_text(&mut row, "summary", hit["description"].as_str());
    copy_text(&mut row, "author", hit["author"].as_str());
    if let Some(url) = hit["page_url"].as_str().filter(|url| curseforge_page(url)) {
        row["pageUrl"] = serde_json::json!(url);
    } else if let Some(slug) = hit["slug"].as_str().filter(|slug| slug_token(slug)) {
        row["pageUrl"] = serde_json::json!(format!("https://www.curseforge.com/minecraft/worlds/{slug}"));
    }
    if let Some(url) = hit["gallery"].as_array().and_then(|images| {
        images.iter().find_map(|image| image["url"].as_str().filter(|url| https_only(url)))
    }) {
        row["previewUrl"] = serde_json::json!(url);
    }
    if let Some(url) = hit["icon_url"].as_str().filter(|url| https_only(url)) {
        row["iconUrl"] = serde_json::json!(url);
    }
    if let Some(downloads) = hit["downloads"].as_u64() {
        row["downloads"] = serde_json::json!(downloads);
    }
    copy_list(&mut row, "versions", "versionCount", &hit["versions"], 3);
    Some(row)
}

async fn fetch_archive(core: &Core, p: &serde_json::Value, temp: &Path) -> Result<RemoteArchive> {
    let key = curseforge::configured_key(core, p["curseforgeKey"].as_str().unwrap_or(""));
    if p["source"] == "curseforge" {
        let id = string(p, "project")?.parse().map_err(|_| "CurseForge 地图编号无效")?;
        core.stage("读取 CurseForge 地图信息", 0, 1);
        let info = curseforge::project_info(core, id, key.as_deref()).await?;
        if info["classId"].as_u64() != Some(17) {
            return Err("该 CurseForge 项目不是地图分类，已停止".into());
        }
        if info["allowModDistribution"] == false {
            return Err(CURSEFORGE_NO_FILE.into());
        }
        let cover = info["screenshots"].as_array().into_iter().flatten()
            .filter_map(|image| image["url"].as_str()).find(|url| allowed_world_cover(url))
            .or_else(|| info["logo"]["url"].as_str().filter(|url| allowed_world_cover(url)))
            .map(str::to_owned);
        let name = fetch_curseforge_archive(core, p, temp, id, key.as_deref()).await?;
        return Ok(RemoteArchive { name, cover });
    }
    let slug = pixelmap_slug(string(p, "project")?)?;
    core.stage("读取像素茶艺地图信息", 0, 1);
    let detail = pixelmap_json(core, &format!("{PIXELMAP_API}/query/{slug}")).await?;
    let cover = detail["preview_image"].as_str().filter(|url| allowed_world_cover(url)).map(str::to_owned);
    if let Some(link) = linked_curseforge_world(&detail) {
        core.stage("查找作者发布的 CurseForge 地图", 0, 1);
        let project = curseforge::world_by_slug(core, &link, key.as_deref()).await?
            .ok_or(CURSEFORGE_NO_FILE)?;
        let name = fetch_curseforge_archive(core, p, temp, project, key.as_deref()).await?;
        return Ok(RemoteArchive { name, cover });
    }
    if p["versionId"].as_str().is_some_and(|id| !id.is_empty() && id != slug) {
        return Err("地图文件已变更，请重新选择版本".into());
    }
    let (parsed, kind) = classify_pixelmap_download(&detail)?;
    let policy = if detail["download_integrated"] == true {
        HostPolicy::Pixelmap
    } else {
        HostPolicy::Named(parsed.host_str().unwrap_or(""))
    };
    core.stage("下载像素茶艺地图", 0, 1);
    download_file(core, parsed.as_str(), temp, "", &policy, None).await?;
    validate_archive(temp, kind)?;
    Ok(RemoteArchive { name: archive_name(parsed.path(), kind), cover })
}

async fn fetch_curseforge_archive(
    core: &Core,
    p: &serde_json::Value,
    temp: &Path,
    id: u64,
    key: Option<&str>,
) -> Result<String> {
    let game = text_token(p["game"].as_str().unwrap_or(""), 32);
    let file = if let Some(vid) = p["versionId"].as_str().filter(|vid| !vid.is_empty()) {
        curseforge::file_by_id(core, id, vid.parse().map_err(|_| "文件版本 ID 无效")?, key).await?
    } else {
        curseforge::best_file(core, id, game, None, key).await.map_err(|error| format!("没有找到可下载的 CurseForge 地图文件：{error}"))?
    };
    if file["modId"].as_u64() != Some(id) || file["isAvailable"] == false || file["isServerPack"] == true {
        return Err("所选文件不属于此地图或已停止下载".into());
    }
    let (name, kind, url) = curseforge_archive(&file).ok_or(CURSEFORGE_NO_FILE)?;
    core.stage("下载 CurseForge 地图", 0, 1);
    download_file(core, &url, temp, &curseforge::file_hash(&file), &HostPolicy::Forgecdn, key).await?;
    validate_archive(temp, kind)?;
    Ok(archive_name(name, kind))
}

pub(crate) fn curseforge_archive(file: &serde_json::Value) -> Option<(&str, &'static str, String)> {
    if file["isAvailable"] == false || file["isServerPack"] == true
        || file["fileLength"].as_u64().is_some_and(|length| length > MAX_DOWNLOAD)
    {
        return None;
    }
    let name = curseforge::file_name(file).ok()?;
    let kind = file_kind(name)?;
    let url = file["downloadUrl"].as_str()?;
    Some((name, kind, curseforge::download_entry(url)?))
}

fn validate_archive(path: &Path, kind: &str) -> Result<()> {
    if sniff_file(path)? != Some(kind) {
        return Err("下载内容与地图压缩包格式不符".into());
    }
    if kind == "zip" {
        let file = fs::File::open(path).map_err(err)?;
        zip::ZipArchive::new(file).map_err(|_| "下载的 ZIP 不完整或已损坏")?;
    }
    Ok(())
}

fn install_local(
    path: &Path,
    saves: &Path,
    downloads: &Path,
    preferred: &str,
) -> Result<serde_json::Value> {
    if !path.is_absolute() || !path.is_file() {
        return Err("请选择本机上的地图压缩包".into());
    }
    let length = fs::metadata(path).map_err(err)?.len();
    if length > MAX_DOWNLOAD {
        return Err("地图压缩包超过 2 GB，已停止".into());
    }
    let kind = sniff_file(path)?.ok_or("请选择 ZIP、RAR 或 7z 地图压缩包")?;
    let name = archive_name(
        path.file_name().and_then(|name| name.to_str()).unwrap_or("地图.zip"),
        kind,
    );
    if let ZipInstall::Worlds(worlds) = install_world_archive(path, kind, saves, preferred)? {
        return Ok(installed_value(&worlds, None));
    }
    let saved = copy_archive(path, downloads, &name)?;
    Ok(downloaded_value(&saved.name))
}

fn finish_archive(
    temp: &Path,
    name: &str,
    saves: &Path,
    downloads: &Path,
    preferred: &str,
) -> Result<serde_json::Value> {
    let kind = sniff_file(temp)?.ok_or("下载内容不是 zip、rar 或 7z，没有安装到存档")?;
    let name = archive_name(name, kind);
    let saved = copy_archive(temp, downloads, &name)?;
    match install_world_archive(temp, kind, saves, preferred) {
        Ok(ZipInstall::Worlds(worlds)) => Ok(installed_value(&worlds, Some(saved.name))),
        Ok(ZipInstall::NoLevelDat) => Ok(downloaded_value(&saved.name)),
        Err(error) => {
            let _ = fs::remove_file(downloads.join(&saved.name));
            Err(error)
        }
    }
}

fn installed_value(worlds: &[String], archive: Option<String>) -> serde_json::Value {
    let names = worlds.join("、");
    let note = match &archive {
        Some(archive) => format!("已安装到存档：{names}。没有覆盖已有存档。原始压缩包保存在地图下载文件夹：{archive}"),
        None => format!("已从本地压缩包安装到存档：{names}。没有改动原文件，也没有覆盖已有存档。"),
    };
    serde_json::json!({
        "status": "installed",
        "worlds": worlds,
        "archive": archive,
        "note": note
    })
}

fn downloaded_value(archive: &str) -> serde_json::Value {
    let note = format!("压缩包已保存到地图下载文件夹：{archive}。包内没有可导入的 Java 版存档。");
    serde_json::json!({
        "status": "downloaded",
        "archive": archive,
        "note": note
    })
}

async fn download_file(
    core: &Core,
    url: &str,
    dest: &Path,
    hash: &str,
    policy: &HostPolicy<'_>,
    curseforge_key: Option<&str>,
) -> Result<()> {
    use reqwest::header::{ACCEPT_ENCODING, CONTENT_RANGE, CONTENT_TYPE};

    crate::https(url)?;
    let parsed = reqwest::Url::parse(url).map_err(err)?;
    let host = parsed.host_str().unwrap_or("");
    if !host_allowed(host, policy) {
        return Err("地图下载地址不在允许的站点上".into());
    }
    let pixelmap = matches!(policy, HostPolicy::Pixelmap | HostPolicy::Named(_));
    let addresses = if pixelmap {
        crate::jobs::wait(core, tokio::net::lookup_host((host, 443))).await?
            .ok().map(prefer_system_addresses).unwrap_or_default()
    } else {
        Vec::new()
    };
    let mut last = String::new();
    for (attempt, address) in [addresses.first().copied(), None, addresses.get(1).copied()].into_iter().enumerate() {
        core.stopped()?;
        if attempt > 0 {
            core.stage("连接中断，正在重新下载地图", 0, 1);
        }
        let client = if pixelmap { pixelmap_client(host, address, None)? } else { core.http.clone() };
        let mut request = client.get(parsed.clone()).header(ACCEPT_ENCODING, "identity");
        if let Some(key) = curseforge_key {
            request = request.header("x-api-key", key);
        }
        let response = match crate::jobs::wait(core, tokio::time::timeout(Duration::from_secs(30), request.send())).await? {
            Ok(Ok(response)) => response,
            Ok(Err(error)) => {
                last = format!("地图下载连接失败：{}", error_chain(&error.without_url()));
                continue;
            }
            Err(_) => {
                last = "连接地图下载源超时".into();
                continue;
            }
        };
        let final_url = response.url();
        if final_url.scheme() != "https" || !host_allowed(final_url.host_str().unwrap_or(""), policy) {
            return Err("地图下载跳转到了未允许的站点".into());
        }
        let status = response.status();
        if status.is_server_error() {
            last = format!("地图下载源暂时不可用（HTTP {}）", status.as_u16());
            continue;
        }
        if status != reqwest::StatusCode::OK || response.headers().contains_key(CONTENT_RANGE) {
            return Err(format!("下载源未返回完整地图文件（HTTP {}）", status.as_u16()));
        }
        if response.headers().get(CONTENT_TYPE).and_then(|h| h.to_str().ok())
            .is_some_and(|value| value.to_ascii_lowercase().starts_with("text/html"))
        {
            return Err("下载地址返回了网页，无法获取地图文件".into());
        }
        if response.content_length().is_some_and(|length| length > MAX_DOWNLOAD) {
            return Err("地图文件超过 2 GB，已停止".into());
        }
        match write_archive_response(core, response, dest, hash).await? {
            Some(reason) => last = reason,
            None => return Ok(()),
        }
    }
    Err(last)
}

/// Stream failures can be retried from the start. Filesystem and validation
/// failures are returned immediately.
async fn write_archive_response(
    core: &Core,
    response: reqwest::Response,
    dest: &Path,
    hash: &str,
) -> Result<Option<String>> {
    let announced = response.content_length().unwrap_or(0);
    let mut file = tokio::fs::File::create(dest).await.map_err(err)?;
    let mut stream = response.bytes_stream();
    let mut written = 0_u64;
    let mut hasher = Sha1::new();
    let mut next_report = 1024 * 1024_u64;
    let check_hash = hash.len() == 40 && hash.bytes().all(|byte| byte.is_ascii_hexdigit());
    loop {
        core.stopped()?;
        let incoming = crate::jobs::wait(core, tokio::time::timeout(Duration::from_secs(45), stream.next())).await?;
        let chunk = match incoming {
            Ok(Some(Ok(chunk))) => chunk,
            Ok(None) => break,
            Ok(Some(Err(error))) => return Ok(Some(format!(
                "地图下载在收到 {:.1} MB 后中断：{}", written as f64 / 1048576.0, error_chain(&error.without_url())
            ))),
            Err(_) => return Ok(Some("地图下载超过 45 秒没有收到新数据".into())),
        };
        written = written.saturating_add(chunk.len() as u64);
        if written > MAX_DOWNLOAD {
            return Err("地图文件超过 2 GB，已停止".into());
        }
        if written >= next_report {
            let done = usize::try_from(written).unwrap_or(usize::MAX);
            let total = usize::try_from(announced.max(written + 1)).unwrap_or(usize::MAX);
            core.stage("下载地图", done, total);
            next_report = written.saturating_add(1024 * 1024);
        }
        if check_hash {
            hasher.update(&chunk);
        }
        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk)
            .await
            .map_err(err)?;
    }
    tokio::io::AsyncWriteExt::flush(&mut file).await.map_err(err)?;
    if announced != 0 && announced != written {
        return Ok(Some(format!("地图下载不完整（{written} / {announced} 字节）")));
    }
    if check_hash {
        let actual = format!("{:x}", hasher.finalize());
        if !actual.eq_ignore_ascii_case(hash) {
            return Err("地图文件校验不一致".into());
        }
    }
    Ok(None)
}

fn install_world_archive(archive: &Path, kind: &str, saves: &Path, preferred: &str) -> Result<ZipInstall> {
    if kind == "zip" {
        return install_world_zip(archive, saves, preferred, &MAP_LIMITS);
    }
    // Convert entries to an anonymous, size-bounded ZIP. The existing world
    // installer still owns all writes to the saves directory.
    let mut zip = zip::ZipWriter::new(tempfile::tempfile().map_err(err)?);
    let has_world = match kind {
        "7z" => decode_sevenz(archive, &mut zip),
        "rar" => decode_rar(archive, &mut zip),
        _ => return Err("未知地图压缩格式".into()),
    }?;
    if !has_world {
        return Ok(ZipInstall::NoLevelDat);
    }
    install_world_zip_file(zip.finish().map_err(err)?, saves, preferred, &MAP_LIMITS)
}

#[derive(Default)]
struct MapArchiveLayout {
    expanded: u64,
    has_world: bool,
}

impl MapArchiveLayout {
    fn check(&mut self, name: &str, is_dir: bool, size: u64) -> Result<()> {
        let parts = safe_parts(&name.replace('\\', "/"))?;
        if size > MAP_LIMITS.max_entry_bytes {
            return Err("压缩包内单个文件过大，已停止安装".into());
        }
        self.expanded = self.expanded.saturating_add(size);
        if self.expanded > MAP_LIMITS.max_total_bytes {
            return Err("解压后的总体积超过限制，已停止安装".into());
        }
        self.has_world |= !is_dir && parts.last().is_some_and(|part| part == "level.dat");
        Ok(())
    }
}

fn start_map_entry(zip: &mut zip::ZipWriter<fs::File>, name: &str) -> Result<()> {
    zip.start_file(name.replace('\\', "/"), zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Stored)).map_err(err)
}

fn decode_sevenz(archive: &Path, zip: &mut zip::ZipWriter<fs::File>) -> Result<bool> {
    use sevenz_rust2::{ArchiveReader, Error, Password};

    let file = fs::File::open(archive).map_err(err)?;
    let mut reader = ArchiveReader::new_with_memory_limit(file, Password::empty(), 128 * 1024)
        .map_err(|error| format!("无法读取 7z 地图：{error}"))?;
    reader.set_thread_count(1);
    let members = &reader.archive().files;
    if members.len() > MAP_LIMITS.max_entries {
        return Err("压缩包内文件过多，已停止安装".into());
    }
    let mut layout = MapArchiveLayout::default();
    for entry in members {
        let unix_kind = (entry.windows_attributes >> 16) & 0o170000;
        if entry.is_anti_item || entry.windows_attributes & 0x400 != 0
            || !matches!(unix_kind, 0 | 0o040000 | 0o100000)
        {
            return Err("压缩包包含链接或特殊文件，已停止安装".into());
        }
        layout.check(&entry.name, entry.is_directory, entry.size)?;
    }
    if !layout.has_world {
        return Ok(false);
    }
    reader.for_each_entries(|entry, data| {
        if !entry.is_directory {
            start_map_entry(zip, &entry.name).map_err(|error| Error::Other(error.into()))?;
            let written = io::copy(&mut Limited::new(data, entry.size), zip)
                .map_err(|error| Error::Io(error, "写入地图文件".into()))?;
            if written != entry.size {
                return Err(Error::Other("地图文件长度不完整".into()));
            }
        }
        Ok(true)
    }).map_err(|error| format!("无法完整解压 7z 地图：{error}"))?;
    Ok(true)
}

fn decode_rar(archive: &Path, zip: &mut zip::ZipWriter<fs::File>) -> Result<bool> {
    use unrar_rs::{Limits, RarArchive};

    let mut rar = RarArchive::open(fs::File::open(archive).map_err(err)?)
        .map_err(|error| format!("无法读取 RAR 地图：{error}"))?;
    rar.set_limits(Limits {
        max_unpacked_size: MAP_LIMITS.max_entry_bytes,
        max_dict_size: 128 * 1024 * 1024,
        max_ppmd_arena_size: 128 * 1024 * 1024,
        ..Limits::default()
    });
    if rar.len() > MAP_LIMITS.max_entries {
        return Err("压缩包内文件过多，已停止安装".into());
    }
    let members: Vec<_> = rar.entries().collect();
    let mut layout = MapArchiveLayout::default();
    for member in &members {
        if member.is_symlink || member.is_hardlink || member.is_file_copy {
            return Err("压缩包包含链接，已停止安装".into());
        }
        let size = member.unpacked_size.ok_or("不支持缺少解压大小的 RAR 分卷")?;
        layout.check(&member.raw_name, member.is_directory, size)?;
    }
    if !layout.has_world {
        return Ok(false);
    }
    for (index, member) in members.iter().enumerate().filter(|(_, member)| !member.is_directory) {
        if member.is_encrypted {
            return Err("此 RAR 地图需要密码，请另存后手动解压。".into());
        }
        start_map_entry(zip, &member.raw_name)?;
        let size = member.unpacked_size.unwrap_or_default();
        let mut output = BoundedMapWrite { writer: zip, remaining: size };
        let written = rar.by_index(index).and_then(|entry| entry.copy_to(&mut output))
            .map_err(|error| format!("无法完整解压 RAR 地图：{error}"))?;
        if written != size {
            return Err("RAR 地图文件长度不完整".into());
        }
    }
    Ok(true)
}

struct BoundedMapWrite<'a> {
    writer: &'a mut zip::ZipWriter<fs::File>,
    remaining: u64,
}

impl Write for BoundedMapWrite<'_> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() as u64 > self.remaining {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "解压体积超过声明"));
        }
        let written = self.writer.write(bytes)?;
        self.remaining -= written as u64;
        Ok(written)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.writer.flush()
    }
}

fn install_world_zip(archive: &Path, saves: &Path, preferred: &str, limits: &ArchiveLimits) -> Result<ZipInstall> {
    let file = fs::File::open(archive).map_err(err)?;
    install_world_zip_file(file, saves, preferred, limits)
}

fn install_world_zip_file(file: fs::File, saves: &Path, preferred: &str, limits: &ArchiveLimits) -> Result<ZipInstall> {
    if fs::symlink_metadata(saves).is_ok_and(|meta| resource_delete::is_link(&meta) || !meta.is_dir()) {
        return Err("存档目录不是普通文件夹，已停止".into());
    }
    let mut zip = zip::ZipArchive::new(file).map_err(|_| "ZIP 无法读取，没有安装到存档")?;
    if zip.len() > limits.max_entries {
        return Err("压缩包内文件过多，已停止安装".into());
    }
    let mut entries = Vec::new();
    let mut total = 0_u64;
    for index in 0..zip.len() {
        let entry = zip.by_index(index).map_err(err)?;
        let name = entry.name().to_string();
        if entry.is_symlink() {
            return Err("压缩包包含符号链接，已停止安装".into());
        }
        let parts = safe_parts(&name)?;
        let declared = entry.size();
        let compressed = entry.compressed_size();
        if declared > limits.max_entry_bytes {
            return Err("压缩包内单个文件过大，已停止安装".into());
        }
        if compressed == 0 && declared > 4096 {
            return Err("压缩包声明的体积异常，已停止安装".into());
        }
        if exceeds_zip_ratio(&parts, declared, compressed, limits.max_ratio) {
            return Err("压缩包的压缩比异常，已停止安装".into());
        }
        total = total.saturating_add(declared);
        if total > limits.max_total_bytes {
            return Err("解压后的总体积超过限制，已停止安装".into());
        }
        let dir = entry.is_dir() || name.ends_with('/');
        entries.push((index, parts, dir, declared));
    }
    let bedrock_roots: std::collections::HashSet<_> = entries.iter()
        .filter(|(_, parts, dir, _)| !*dir
            && matches!(parts.as_slice(), [.., folder, name] if folder == "db" && name == "CURRENT"))
        .map(|(_, parts, _, _)| &parts[..parts.len() - 2])
        .collect();
    let level_roots: Vec<Vec<String>> = entries
        .iter()
        .filter(|(_, parts, dir, _)| !*dir && parts.last().is_some_and(|part| *part == "level.dat")
            && parts.first().is_none_or(|name| name != "__MACOSX")
            && !bedrock_roots.contains(&parts[..parts.len() - 1]))
        .map(|(_, parts, _, _)| parts[..parts.len() - 1].to_vec())
        .collect();
    if level_roots.is_empty() {
        return Ok(ZipInstall::NoLevelDat);
    }
    let roots = shallow_roots(&level_roots);
    let saves_canon = saves.canonicalize().map_err(err)?;
    let mut created = Vec::new();
    let outcome = (|| -> Result<Vec<String>> {
        let mut names = Vec::new();
        for root in &roots {
            let base = root.last().map(String::as_str).unwrap_or(preferred);
            let (folder, _) = free_name(saves, base)?;
            let dest = saves.join(&folder);
            if dest.symlink_metadata().is_ok() {
                return Err("存档文件夹已存在，已停止以免覆盖".into());
            }
            fs::create_dir(&dest).map_err(|error| {
                if error.kind() == io::ErrorKind::AlreadyExists {
                    "存档文件夹已存在，已停止以免覆盖".into()
                } else {
                    err(error)
                }
            })?;
            created.push(dest.clone());
            for (index, parts, dir, declared) in &entries {
                if *dir || !within_root(parts, root) {
                    continue;
                }
                let relative: Vec<&str> = if root.is_empty() {
                    parts.iter().map(String::as_str).collect()
                } else {
                    parts[root.len()..].iter().map(String::as_str).collect()
                };
                if relative.is_empty() {
                    continue;
                }
                let mut parent = dest.clone();
                for part in &relative[..relative.len() - 1] {
                    parent.push(part);
                    match parent.symlink_metadata() {
                        Ok(meta) if resource_delete::is_link(&meta) => {
                            return Err("解压路径遇到符号链接，已停止".into());
                        }
                        Ok(meta) if !meta.is_dir() => return Err("解压路径与已有文件冲突，已停止".into()),
                        Ok(_) => {}
                        Err(error) if error.kind() == io::ErrorKind::NotFound => {
                            fs::create_dir(&parent).map_err(err)?;
                        }
                        Err(error) => return Err(err(error)),
                    }
                }
                let parent_canon = parent.canonicalize().map_err(err)?;
                if !parent_canon.starts_with(&saves_canon) {
                    return Err("解压路径超出存档目录，已停止".into());
                }
                let target = parent.join(relative[relative.len() - 1]);
                if target.symlink_metadata().is_ok() {
                    return Err("解压目标已存在，已停止".into());
                }
                let mut reader = zip.by_index(*index).map_err(err)?;
                let mut output = fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&target)
                    .map_err(err)?;
                io::copy(&mut Limited::new(&mut reader, *declared), &mut output).map_err(|_| {
                    "解压体积超过限制，已停止安装".to_string()
                })?;
            }
            let level = dest.join("level.dat");
            let meta = fs::symlink_metadata(&level).map_err(|_| "安装后的存档缺少 level.dat")?;
            if resource_delete::is_link(&meta) || !meta.is_file() {
                return Err("安装后的 level.dat 不是普通文件，已停止".into());
            }
            names.push(folder);
        }
        Ok(names)
    })();
    if let Err(error) = &outcome {
        for path in created.iter().rev() {
            remove_created(path);
        }
        return Err(error.clone());
    }
    Ok(ZipInstall::Worlds(outcome.unwrap_or_default()))
}

fn exceeds_zip_ratio(parts: &[String], expanded: u64, packed: u64, limit: u64) -> bool {
    if packed == 0 || expanded < 64 * 1024 || expanded / packed <= limit {
        return false;
    }
    // Sparse Anvil regions compress their sector padding well. Keep the byte
    // budget and only allow a higher ratio for ordinary, small region files.
    let anvil_region = matches!(parts, [.., folder, name]
        if matches!(folder.as_str(), "region" | "entities" | "poi")
            && name.strip_prefix("r.").and_then(|name| name.strip_suffix(".mca"))
                .and_then(|coords| coords.split_once('.'))
                .is_some_and(|(x, z)| x.parse::<i32>().is_ok() && z.parse::<i32>().is_ok()));
    !anvil_region || expanded > 16 * 1024 * 1024 || expanded / packed > 256
}

fn shallow_roots(roots: &[Vec<String>]) -> Vec<Vec<String>> {
    let mut kept = Vec::new();
    for root in roots {
        let nested = roots.iter().any(|other| other.len() < root.len() && root.starts_with(&other[..]));
        if !nested && !kept.contains(root) {
            kept.push(root.clone());
        }
    }
    kept
}

fn within_root(parts: &[String], root: &[String]) -> bool {
    parts.len() > root.len() && parts.starts_with(root)
}

struct Limited<R> {
    inner: R,
    remaining: u64,
}

impl<R: Read> Limited<R> {
    fn new(inner: R, remaining: u64) -> Self {
        Self { inner, remaining }
    }
}

impl<R: Read> Read for Limited<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.remaining == 0 {
            let mut probe = [0_u8; 1];
            return match self.inner.read(&mut probe)? {
                0 => Ok(0),
                _ => Err(io::Error::new(io::ErrorKind::InvalidData, "解压体积超过声明")),
            };
        }
        let max = buf.len().min(self.remaining as usize);
        let read = self.inner.read(&mut buf[..max])?;
        self.remaining -= read as u64;
        Ok(read)
    }
}

fn safe_parts(name: &str) -> Result<Vec<String>> {
    if name.is_empty()
        || name.contains('\\')
        || name.starts_with('/')
        || name.contains(':')
        || name.contains('\0')
    {
        return Err("压缩包包含不安全路径，已停止安装".into());
    }
    let trimmed = name.trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("压缩包包含不安全路径，已停止安装".into());
    }
    let parts: Vec<String> = trimmed.split('/').map(str::to_string).collect();
    if parts.iter().any(|part| {
        part.is_empty() || part == "." || part == ".." || part.ends_with(' ') || part.ends_with('.')
    }) {
        return Err("压缩包包含不安全路径，已停止安装".into());
    }
    Ok(parts)
}

fn free_name(saves: &Path, raw: &str) -> Result<(String, bool)> {
    let base = folder_name(raw);
    if !occupied(saves, &base) {
        return Ok((base, false));
    }
    for index in 2..100 {
        let candidate = folder_name(&format!("{base} ({index})"));
        if candidate != base && !occupied(saves, &candidate) {
            return Ok((candidate, true));
        }
    }
    Err("已有同名存档，备用名称也已被占用，已停止以免覆盖".into())
}

fn occupied(dir: &Path, name: &str) -> bool {
    dir.join(name).symlink_metadata().is_ok()
}

fn folder_name(raw: &str) -> String {
    let mut cleaned = String::new();
    for ch in raw.trim().chars() {
        if ch.is_control() || matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
            cleaned.push('_');
        } else {
            cleaned.push(ch);
        }
    }
    let mut name: String = cleaned.trim().trim_matches(|ch: char| ch == '.' || ch == ' ').chars().take(60).collect();
    while name.ends_with('.') || name.ends_with(' ') {
        name.pop();
    }
    let reserved = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    let device = matches!(reserved.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((reserved.starts_with("COM") || reserved.starts_with("LPT"))
            && reserved.len() == 4
            && reserved.as_bytes()[3].is_ascii_digit()
            && reserved.as_bytes()[3] != b'0');
    if name.is_empty() || name == "." || name == ".." || device {
        "地图".into()
    } else {
        name
    }
}

fn remove_created(path: &Path) {
    if fs::symlink_metadata(path).is_ok_and(|meta| meta.is_dir() && !resource_delete::is_link(&meta)) {
        let _ = fs::remove_dir_all(path);
    }
}

fn copy_archive(source: &Path, downloads: &Path, name: &str) -> Result<SavedArchive> {
    fs::create_dir_all(downloads).map_err(err)?;
    if fs::symlink_metadata(downloads).is_ok_and(|meta| resource_delete::is_link(&meta)) {
        return Err("地图下载目录是符号链接，已停止".into());
    }
    let target = unique_file(downloads, name)?;
    let mut input = fs::File::open(source).map_err(err)?;
    let mut output = fs::OpenOptions::new().write(true).create_new(true).open(&target).map_err(err)?;
    if let Err(error) = io::copy(&mut input, &mut output).and_then(|_| output.flush()) {
        drop(output);
        let _ = fs::remove_file(&target);
        return Err(err(error));
    }
    Ok(SavedArchive {
        name: target.file_name().and_then(|item| item.to_str()).unwrap_or(name).to_string(),
    })
}

fn unique_file(dir: &Path, name: &str) -> Result<PathBuf> {
    let direct = dir.join(name);
    if direct.symlink_metadata().is_err() {
        return Ok(direct);
    }
    let stem = Path::new(name).file_stem().and_then(|item| item.to_str()).unwrap_or("地图");
    let ext = Path::new(name).extension().and_then(|item| item.to_str()).unwrap_or("zip");
    for index in 2..100 {
        let candidate = dir.join(format!("{stem} ({index}).{ext}"));
        if candidate.symlink_metadata().is_err() {
            return Ok(candidate);
        }
    }
    Err("地图下载目录里的同名文件过多，已停止以免覆盖".into())
}

fn real_directory(core: &Core, p: &serde_json::Value, kind: &str) -> Result<PathBuf> {
    let dir = engine::resource_dir(core, &serde_json::json!({"id": p["id"], "kind": kind}))?;
    if fs::symlink_metadata(&dir).is_ok_and(|meta| resource_delete::is_link(&meta)) {
        return Err("目标目录是符号链接，地图安装已停止".into());
    }
    fs::create_dir_all(&dir).map_err(err)?;
    if fs::symlink_metadata(&dir).is_ok_and(|meta| resource_delete::is_link(&meta) || !meta.is_dir()) {
        return Err("目标目录不是普通文件夹，地图安装已停止".into());
    }
    Ok(dir)
}

fn temp_file(core: &Core) -> Result<PathBuf> {
    let dir = core
        .root
        .join("cache")
        .join("map-imports")
        .join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir.join("download.bin"))
}

fn sniff_file(path: &Path) -> Result<Option<&'static str>> {
    let mut file = fs::File::open(path).map_err(err)?;
    let mut magic = [0_u8; 8];
    let read = file.read(&mut magic).map_err(err)?;
    Ok(sniff_magic(&magic[..read]))
}

fn sniff_magic(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"PK\x03\x04") || bytes.starts_with(b"PK\x05\x06") || bytes.starts_with(b"PK\x07\x08") {
        Some("zip")
    } else if bytes.starts_with(b"Rar!\x1a\x07") {
        Some("rar")
    } else if bytes.starts_with(b"7z\xbc\xaf\x27\x1c") {
        Some("7z")
    } else {
        None
    }
}

fn file_kind(path: &str) -> Option<&'static str> {
    let name = path.rsplit('/').next().unwrap_or(path).to_ascii_lowercase();
    if name.ends_with(".zip") {
        Some("zip")
    } else if name.ends_with(".rar") {
        Some("rar")
    } else if name.ends_with(".7z") {
        Some("7z")
    } else {
        None
    }
}

fn host_allowed(host: &str, policy: &HostPolicy) -> bool {
    let host = host.to_ascii_lowercase();
    match policy {
        HostPolicy::Pixelmap => host == "pixelmap.cc" || host.ends_with(".pixelmap.cc"),
        HostPolicy::Forgecdn => host == "forgecdn.net" || host.ends_with(".forgecdn.net"),
        HostPolicy::Named(expected) => !expected.is_empty() && host.eq_ignore_ascii_case(expected),
    }
}

fn pixelmap_slug(slug: &str) -> Result<&str> {
    if (1..=80).contains(&slug.len())
        && slug.contains('_')
        && slug.chars().next().is_some_and(|ch| ch.is_ascii_alphanumeric())
        && slug.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
    {
        Ok(slug)
    } else {
        Err("像素茶艺地图标识无效".into())
    }
}

fn pixelmap_page_url(url: Option<&str>, slug: &str) -> Option<String> {
    if let Some(url) = url.filter(|url| pixelmap_page(url)) {
        return Some(url.to_string());
    }
    pixelmap_slug(slug).ok().map(|slug| format!("https://goto.pixelmap.cc/maps/{slug}"))
}

fn pixelmap_page(url: &str) -> bool {
    reqwest::Url::parse(url).ok().is_some_and(|parsed| {
        parsed.scheme() == "https" && parsed.host_str() == Some("goto.pixelmap.cc") && parsed.username().is_empty()
    })
}

fn curseforge_page(url: &str) -> bool {
    reqwest::Url::parse(url).ok().is_some_and(|parsed| {
        parsed.scheme() == "https"
            && matches!(parsed.host_str(), Some("www.curseforge.com" | "curseforge.com"))
            && parsed.username().is_empty()
    })
}

fn slug_token(slug: &str) -> bool {
    (1..=128).contains(&slug.len())
        && slug.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
        && !slug.contains("..")
}

fn https_only(url: &str) -> bool {
    reqwest::Url::parse(url).ok().is_some_and(|parsed| {
        parsed.scheme() == "https" && parsed.host_str().is_some() && parsed.username().is_empty()
    })
}

fn text_token(value: &str, max: usize) -> Option<&str> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > max || value.chars().any(|ch| ch.is_control() || "/\\?#&=%".contains(ch)) {
        None
    } else {
        Some(value)
    }
}

fn nonempty(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn copy_text(hit: &mut serde_json::Value, key: &str, value: Option<&str>) {
    if let Some(value) = nonempty(value) {
        hit[key] = serde_json::json!(value);
    }
}

fn copy_list(hit: &mut serde_json::Value, key: &str, count_key: &str, value: &serde_json::Value, take: usize) {
    let Some(items) = value.as_array() else { return };
    let texts: Vec<&str> = items.iter().filter_map(|item| nonempty(item.as_str())).collect();
    if texts.is_empty() {
        return;
    }
    hit[count_key] = serde_json::json!(texts.len());
    hit[key] = serde_json::json!(texts.into_iter().take(take).collect::<Vec<_>>());
}

fn archive_name(raw: &str, kind: &str) -> String {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or("地图");
    let mut cleaned = String::new();
    for ch in base.chars() {
        if ch.is_control() || matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
            cleaned.push('_');
        } else {
            cleaned.push(ch);
        }
    }
    let mut name: String = cleaned.trim().trim_end_matches(['.', ' ']).chars().take(80).collect();
    if name.is_empty() {
        name = "地图".into();
    }
    if !name.to_ascii_lowercase().ends_with(&format!(".{kind}")) {
        name = format!("{name}.{kind}");
    }
    name
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Write;

    fn zip_bytes(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for (name, data) in files {
            writer
                .start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            writer.write_all(data).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    fn limits() -> ArchiveLimits {
        ArchiveLimits { max_entries: 20, max_total_bytes: 1024 * 1024, max_entry_bytes: 512 * 1024, max_ratio: 200 }
    }

    #[test]
    fn catalogue_keeps_maps_in_other_and_skips_official_articles() {
        let mut row = json!({
            "title":"像素茶艺地图站开放平台", "slug":"pixelmap_official_openplatform",
            "download_allowed":false, "categories":["其他"]
        });
        assert!(pixelmap_hit(&row).is_none());
        row["slug"] = json!("builder_snowland");
        row["title"] = json!("雪山");
        let project = project_from_pixelmap(&pixelmap_hit(&row).unwrap()).unwrap();
        assert_eq!(project["download_state"], "closed");
        assert_eq!(project["page_url"], "https://goto.pixelmap.cc/maps/builder_snowland");
    }

    #[test]
    fn curseforge_world_file_must_be_offered_by_the_source() {
        let mut file = json!({"id":1234,"fileName":"world.zip","isAvailable":true});
        assert!(curseforge_archive(&file).is_none());
        file["downloadUrl"] = json!("https://media.forgecdn.net/files/1/234/world.zip");
        assert_eq!(curseforge_archive(&file).unwrap().1, "zip");
        file["fileLength"] = json!(MAX_DOWNLOAD + 1);
        assert!(curseforge_archive(&file).is_none());
    }

    #[test]
    fn anvil_padding_is_allowed_without_relaxing_the_general_ratio_limit() {
        let region = vec!["World".to_owned(), "region".to_owned(), "r.-1.4.mca".to_owned()];
        assert!(!exceeds_zip_ratio(&region, 1_056_768, 9_262, 80));
        assert!(exceeds_zip_ratio(&region, 1_056_768, 100, 80));
        assert!(exceeds_zip_ratio(&["random.bin".into()], 1_056_768, 9_262, 80));
    }

    #[test]
    fn bedrock_save_is_not_installed_and_legacy_cover_requires_matching_level() {
        let tmp = tempfile::tempdir().unwrap();
        let saves = tmp.path().join("saves");
        fs::create_dir(&saves).unwrap();
        let world = saves.join("维特拉米尔[传颂之地]");
        fs::create_dir(&world).unwrap();
        fs::write(world.join("level.dat"), b"local-world").unwrap();
        let archive = tmp.path().join("bedrock.zip");
        fs::write(&archive, zip_bytes(&[
            ("Bedrock/level.dat", b"bedrock-level"), ("Bedrock/db/CURRENT", b"MANIFEST"),
        ])).unwrap();
        assert!(matches!(install_world_zip(&archive, &saves, "床岩", &limits()).unwrap(), ZipInstall::NoLevelDat));
        assert!(!same_world_level(&world, &archive));
        let archive = tmp.path().join("java.zip");
        fs::write(&archive, zip_bytes(&[("World/level.dat", b"local-world")])).unwrap();
        assert!(same_world_level(&world, &archive));
        assert_eq!(cover_title_key("维特拉米尔 [传颂之地] (2)"), cover_title_key("维特拉米尔[传颂之地]"));
    }

    #[test]
    fn pixelmap_uses_only_author_linked_curseforge_worlds() {
        let mut detail = json!({
            "download_allowed": true,
            "download_integrated": false,
            "download_url": "https://www.curseforge.com/minecraft/worlds/lesraisins-csgo-dust-ii"
        });
        assert_eq!(linked_curseforge_world(&detail).as_deref(), Some("lesraisins-csgo-dust-ii"));
        for url in [
            "https://www.curseforge.com/minecraft/mc-mods/sodium",
            "https://www.curseforge.com.evil.example/minecraft/worlds/test",
            "https://www.curseforge.com/minecraft/worlds/test/another-path",
            "https://user:password@www.curseforge.com/minecraft/worlds/test",
            "https://pan.quark.cn/s/example",
        ] {
            detail["download_url"] = json!(url);
            assert!(linked_curseforge_world(&detail).is_none());
        }
        detail["download_url"] = json!("https://www.curseforge.com/minecraft/worlds/test");
        detail["download_allowed"] = json!(false);
        assert!(linked_curseforge_world(&detail).is_none());
    }

    #[tokio::test]
    async fn truncated_archive_response_requests_a_retry() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut connection, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            while !request.ends_with(b"\r\n\r\n") {
                request.push(connection.read_u8().await.unwrap());
            }
            connection.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 256\r\nConnection: close\r\n\r\nPK\x03\x04").await.unwrap();
        });
        let tmp = tempfile::tempdir().unwrap();
        let core = Core::new(tmp.path().join("game"), std::sync::Arc::new(|_| {})).unwrap();
        let response = core.http.get(format!("http://{address}")).send().await.unwrap();
        let dest = tmp.path().join("archive.zip");
        let retry = write_archive_response(&core, response, &dest, "").await.unwrap();
        assert!(retry.is_some());
        server.await.unwrap();
    }

    #[test]
    fn pixelmap_download_requires_hosted_file_and_keeps_real_metadata() {
        let hosted = pixelmap_hit(&json!({
            "title": "曲香坊",
            "summary": "一座院子",
            "author": "诗与2233",
            "slug": "yzt2233_architecture-quxiangfang",
            "preview_image": "https://oss.pixelmap.cc/pixelmap/covers/example.webp",
            "url": "https://goto.pixelmap.cc/maps/yzt2233_architecture-quxiangfang",
            "versions": ["1.21.1", "1.21.4"],
            "categories": ["建筑"],
            "views": 12,
            "download_allowed": true,
            "download_integrated": true
        })).unwrap();
        assert_eq!(hosted["download_state"], "file");
        assert_eq!(hosted["author"], "诗与2233");
        assert_eq!(hosted["previewUrl"], "https://oss.pixelmap.cc/pixelmap/covers/example.webp");
        assert!(hosted.get("download_url").is_none());
        let listed = project_from_pixelmap(&hosted).unwrap();
        assert_eq!(listed["download_state"], "file");
        let external = pixelmap_hit(&json!({
            "title": "图册",
            "author": "",
            "slug": "XZhongjie_brochure-terra",
            "url": "https://goto.pixelmap.cc/maps/XZhongjie_brochure-terra",
            "download_allowed": true,
            "download_integrated": false
        })).unwrap();
        assert_eq!(external["download_state"], "check");
        assert!(project_from_pixelmap(&external).is_some());
        let closed = pixelmap_hit(&json!({
            "title": "未开放",
            "slug": "YSHOfficial_example",
            "download_allowed": false,
            "download_integrated": false
        })).unwrap();
        assert_eq!(closed["download_state"], "closed");
        assert_eq!(closed["download_note"], PIXELMAP_NO_FILE);
        assert_eq!(project_from_pixelmap(&closed).unwrap()["title"], "未开放");
        assert!(external.get("author").is_none());
        assert!(external.get("previewUrl").is_none());
        assert!(external.get("download_url").is_none());
        let direct = classify_pixelmap_download(&json!({
            "download_allowed": true,
            "download_integrated": false,
            "download_url": "https://thingy.top/maps/example.zip"
        })).unwrap();
        assert_eq!(direct.1, "zip");
        assert_eq!(direct.0.host_str(), Some("thingy.top"));
        let oss = classify_pixelmap_download(&json!({
            "download_allowed": true,
            "download_integrated": true,
            "download_url": "https://oss.pixelmap.cc/pixelmap/file/example.zip"
        })).unwrap();
        assert_eq!(oss.1, "zip");
        assert!(classify_pixelmap_download(&json!({
            "download_allowed": true,
            "download_integrated": false,
            "download_url": "https://brochure.terratea.cc/"
        })).unwrap_err().contains("网页或网盘"));
        assert!(classify_pixelmap_download(&json!({
            "download_allowed": true,
            "download_integrated": false,
            "download_url": "https://thingy.top/maps/build.schem"
        })).unwrap_err().contains("投影"));
        assert!(classify_pixelmap_download(&json!({
            "download_allowed": false,
            "download_url": ""
        })).unwrap_err().contains("暂未提供"));
        assert!(classify_pixelmap_download(&json!({
            "download_allowed": true,
            "download_integrated": true,
            "download_url": "https://thingy.top/file.zip"
        })).unwrap_err().contains("像素茶艺存储域名"));
    }

    #[test]
    fn curseforge_preview_comes_from_screenshots_and_author_can_be_absent() {
        let hit = curseforge_hit(&json!({
            "project_id": 307740,
            "title": "Oneblock",
            "description": "一座方块",
            "author": "Crepi",
            "slug": "oneblock",
            "page_url": "https://www.curseforge.com/minecraft/worlds/oneblock",
            "downloads": 10,
            "gallery": [{"url": "https://media.forgecdn.net/shot.png"}],
            "icon_url": "https://media.forgecdn.net/logo.png",
            "versions": ["1.20.1"]
        })).unwrap();
        assert_eq!(hit["previewUrl"], "https://media.forgecdn.net/shot.png");
        assert_eq!(hit["author"], "Crepi");
        assert_eq!(hit["pageUrl"], "https://www.curseforge.com/minecraft/worlds/oneblock");
        assert_eq!(hit["action"], "file");
        let bare = curseforge_hit(&json!({"project_id": 1, "title": "没有图", "slug": "bare-map"})).unwrap();
        assert!(bare.get("author").is_none());
        assert!(bare.get("previewUrl").is_none());
        assert!(bare.get("iconUrl").is_none());
        assert_eq!(bare["pageUrl"], "https://www.curseforge.com/minecraft/worlds/bare-map");
    }

    #[test]
    fn system_addresses_try_ipv4_before_ipv6() {
        let addrs = vec![
            "[2001:db8::1]:443".parse().unwrap(),
            "198.18.1.20:443".parse().unwrap(),
        ];
        let ordered = prefer_system_addresses(addrs);
        assert!(ordered[0].is_ipv4());
        assert!(ordered[1].is_ipv6());
    }
    #[test]
    fn storage_hosts_stay_on_the_source_domain() {
        assert!(host_allowed("oss.pixelmap.cc", &HostPolicy::Pixelmap));
        assert!(!host_allowed("pixelmap.cc.example", &HostPolicy::Pixelmap));
        assert!(!host_allowed("evilpixelmap.cc", &HostPolicy::Pixelmap));
        assert!(host_allowed("edge.forgecdn.net", &HostPolicy::Forgecdn));
        assert!(!host_allowed("oss.pixelmap.cc", &HostPolicy::Forgecdn));
    }

    #[test]
    fn zip_install_refuses_traversal_symlinks_bombs_and_existing_saves() {
        let root = tempfile::tempdir().unwrap();
        let saves = root.path().join("saves");
        fs::create_dir_all(saves.join("Home")).unwrap();
        fs::write(saves.join("Home/level.dat"), b"KEEP").unwrap();
        let outside = root.path().join("outside.txt");
        let traversal = root.path().join("bad-traversal.zip");
        fs::write(&traversal, zip_bytes(&[("../outside.txt", b"no"), ("level.dat", b"world")])).unwrap();
        assert!(install_world_zip(&traversal, &saves, "新地图", &limits()).is_err());
        assert!(!outside.exists());
        assert_eq!(fs::read(saves.join("Home/level.dat")).unwrap(), b"KEEP");

        let linked = root.path().join("bad-link.zip");
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        writer.start_file("level.dat", zip::write::SimpleFileOptions::default()).unwrap();
        writer.write_all(b"world").unwrap();
        writer.add_symlink("escape", "../outside", zip::write::SimpleFileOptions::default()).unwrap();
        fs::write(&linked, writer.finish().unwrap().into_inner()).unwrap();
        assert!(install_world_zip(&linked, &saves, "链接", &limits()).is_err());
        assert!(!saves.join("链接").exists());

        let bomb = root.path().join("bomb.zip");
        fs::write(&bomb, zip_bytes(&[("level.dat", &vec![0_u8; 80 * 1024])])).unwrap();
        let tight = ArchiveLimits { max_ratio: 8, ..limits() };
        assert!(install_world_zip(&bomb, &saves, "炸弹", &tight).is_err());
        assert!(!saves.join("炸弹").exists());

        let fresh = root.path().join("fresh.zip");
        fs::write(&fresh, zip_bytes(&[("level.dat", b"NEW"), ("data/mark.txt", b"ok")])).unwrap();
        match install_world_zip(&fresh, &saves, "Home", &limits()).unwrap() {
            ZipInstall::Worlds(names) => assert_eq!(names, vec!["Home (2)".to_string()]),
            ZipInstall::NoLevelDat => panic!("应安装存档"),
        }
        assert_eq!(fs::read(saves.join("Home/level.dat")).unwrap(), b"KEEP");
        assert_eq!(fs::read(saves.join("Home (2)/level.dat")).unwrap(), b"NEW");
        assert_eq!(fs::read(saves.join("Home (2)/data/mark.txt")).unwrap(), b"ok");

        let nested = root.path().join("nested.zip");
        fs::write(&nested, zip_bytes(&[("Valley/level.dat", b"valley"), ("readme.txt", b"hi")])).unwrap();
        match install_world_zip(&nested, &saves, "不用这个名字", &limits()).unwrap() {
            ZipInstall::Worlds(names) => assert_eq!(names, vec!["Valley".to_string()]),
            ZipInstall::NoLevelDat => panic!("应安装 Valley"),
        }
        assert!(!saves.join("readme.txt").exists());

        let plain = root.path().join("plain.zip");
        fs::write(&plain, zip_bytes(&[("readme.txt", b"only")])).unwrap();
        assert!(matches!(install_world_zip(&plain, &saves, "说明", &limits()).unwrap(), ZipInstall::NoLevelDat));
        assert_eq!(fs::read(saves.join("Home/level.dat")).unwrap(), b"KEEP");
    }
}
