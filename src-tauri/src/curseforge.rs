use crate::*;
use futures_util::{stream, StreamExt};
use sha1::{Digest, Sha1};
use std::collections::{HashSet, VecDeque};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

const API: &str = "https://api.curse.tools/v1/cf";
const API_OFFICIAL: &str = "https://api.curseforge.com/v1";
// PCL 使用的 CurseForge 镜像；官方 /mods/search 在部分网络会被 CloudFront 403。
const API_MIRROR: &str = "https://mod.mcimirror.top/curseforge/v1";
const GAME_ID: &str = "432";
// 内置的 CurseForge 官方 API Key。客户端内置 Key 仍可能被提取，
// 公开发布前请按需轮换；环境变量或数据目录配置可覆盖它。
const BUILTIN_KEY: &str = "";

pub(crate) fn configured_key(core: &Core, provided: &str) -> Option<String> {
    let mut key = provided.trim().to_string();
    if key.is_empty() {
        for name in ["KXL_CURSEFORGE_API_KEY", "KXL_CF_API_KEY"] {
            if let Ok(value) = std::env::var(name) {
                if !value.trim().is_empty() {
                    key = value.trim().to_string();
                    break;
                }
            }
        }
    }
    if key.is_empty() {
        if let Ok(value) = read_json(&core.root.join("curseforge-key.json")) {
            key = value["apiKey"].as_str().unwrap_or("").trim().to_string();
        }
    }
    if key.is_empty() {
        key = BUILTIN_KEY.to_string();
    }
    if key.is_empty() {
        None
    } else {
        Some(key)
    }
}

fn endpoint(key: Option<&str>) -> &'static str {
    if key.is_some() {
        API_OFFICIAL
    } else {
        API
    }
}

async fn get(core: &Core, url: &str, key: Option<&str>) -> Result<Value> {
    let primary = get_with_timeout(core, url, key, std::time::Duration::from_secs(10));
    let Some(path) = url.strip_prefix(API_OFFICIAL) else {
        return crate::jobs::wait(core, primary).await?;
    };
    let mirror_url = format!("{API_MIRROR}{path}");
    let mirror = async {
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        get_with_timeout(core, &mirror_url, key, std::time::Duration::from_secs(10)).await
    };
    tokio::pin!(primary);
    tokio::pin!(mirror);
    crate::jobs::wait(core, async {
        tokio::select! {
            first = &mut primary => match first { Ok(value) => Ok(value), Err(_) => mirror.await },
            second = &mut mirror => match second { Ok(value) => Ok(value), Err(_) => primary.await },
        }
    }).await?
}

async fn get_with_timeout(
    core: &Core,
    url: &str,
    key: Option<&str>,
    timeout: std::time::Duration,
) -> Result<Value> {
    let Some(key) = key else {
        return core.get(url).await.map_err(|error| {
            format!("{error}。可在「设置 → 高级」填写 CurseForge API Key 后重试。")
        });
    };
    let response = core
        .http
        .get(url)
        .header("x-api-key", key)
        // 部分 CurseForge 镜像会声明压缩编码却返回不完整的压缩流，
        // reqwest 随后会报 error decoding response body。搜索 JSON 很小，
        // 明确请求未压缩响应比在这里重试损坏的压缩流更可靠。
        .header(reqwest::header::ACCEPT_ENCODING, "identity")
        .timeout(timeout)
        .send()
        .await
        .map_err(|error| format!("连接 CurseForge 失败：{error}"))?;
    let status = response.status();
    let text = response.text().await.map_err(err)?;
    let value: Value = serde_json::from_str(&text)
        .unwrap_or_else(|_| json!({"message": text.chars().take(200).collect::<String>()}));
    if !status.is_success() {
        return Err(format!(
            "CurseForge API 返回 HTTP {}：{}",
            status.as_u16(),
            value["errorMessage"]
                .as_str()
                .or_else(|| value["message"].as_str())
                .unwrap_or("请检查 API Key 是否有效")
        ));
    }
    Ok(value)
}

fn class_id(kind: &str) -> Result<u32> {
    match kind {
        "mod" => Ok(6),
        "modpack" => Ok(4471),
        "resourcepack" => Ok(12),
        "shader" => Ok(6552),
        _ => Err("CurseForge 不支持此资源类型".into()),
    }
}

fn loader_type(loader: &str) -> Option<u32> {
    match loader {
        "forge" => Some(1),
        "fabric" => Some(4),
        "quilt" => Some(5),
        "neoforge" => Some(6),
        _ => None,
    }
}

fn loader_name(loader: &str) -> Option<&'static str> {
    match loader {
        "forge" => Some("Forge"),
        "fabric" => Some("Fabric"),
        "quilt" => Some("Quilt"),
        "neoforge" => Some("NeoForge"),
        _ => None,
    }
}

fn project_id(value: &Value) -> Result<u64> {
    value
        .as_u64()
        .or_else(|| value.as_str().and_then(|v| v.parse().ok()))
        .ok_or_else(|| "CurseForge 项目 ID 无效".to_string())
}

pub async fn search(
    core: &Core,
    kind: &str,
    query: &str,
    game: Option<&str>,
    loader: Option<&str>,
    provided_key: &str,
    page: u64,
) -> Result<Value> {
    let class = class_id(kind)?;
    let key = configured_key(core, provided_key);
    let build_url = |base: &str| -> Result<reqwest::Url> {
        let mut url = reqwest::Url::parse(&format!("{base}/mods/search")).map_err(err)?;
        {
            let mut pairs = url.query_pairs_mut();
            pairs
                .append_pair("gameId", GAME_ID)
                .append_pair("classId", &class.to_string())
                .append_pair("index", &(page * 30).to_string())
                .append_pair("pageSize", "30")
                .append_pair("sortField", "2")
                .append_pair("sortOrder", "desc");
            if !query.trim().is_empty() {
                pairs.append_pair("searchFilter", query.trim());
            }
            if let Some(game) = game.filter(|v| !v.is_empty()) {
                pairs.append_pair("gameVersion", game);
            }
            if kind == "mod" {
                if let Some(loader) = loader.filter(|v| !v.is_empty()) {
                    if let Some(kind) = loader_type(loader) {
                        pairs.append_pair("modLoaderType", &kind.to_string());
                    }
                }
            }
        }
        Ok(url)
    };
    let official_url = build_url(API_OFFICIAL)?;
    let mirror_url = build_url(API_MIRROR)?;
    let timeout = std::time::Duration::from_secs(12);
    let official = get_with_timeout(core, official_url.as_str(), key.as_deref(), timeout);
    let mirror = async {
        // 官方源通常更快；若连接迟迟未完成，再错峰启动国内镜像。
        tokio::time::sleep(std::time::Duration::from_millis(350)).await;
        get_with_timeout(core, mirror_url.as_str(), key.as_deref(), timeout).await
    };
    tokio::pin!(official);
    tokio::pin!(mirror);
    let value = tokio::select! {
        first = &mut official => match first {
            Ok(value) => Ok(value),
            Err(official_error) => mirror.await.map_err(|mirror_error| {
                format!("CurseForge 官方源：{official_error}；国内镜像：{mirror_error}")
            }),
        },
        second = &mut mirror => match second {
            Ok(value) => Ok(value),
            Err(mirror_error) => official.await.map_err(|official_error| {
                format!("CurseForge 官方源：{official_error}；国内镜像：{mirror_error}")
            }),
        },
    }?;
    let data = value["data"]
        .as_array()
        .ok_or("CurseForge 返回了无法识别的搜索结果")?;
    let hits: Vec<Value> = data
        .iter()
        .map(|item| {
            json!({
                "project_id": item["id"],
                "title": item["name"],
                "description": item["summary"],
                "downloads": item["downloadCount"],
                "project_type": kind,
                "slug": item["slug"],
                "icon_url": item["logo"]["thumbnailUrl"].as_str().or_else(|| item["logo"]["url"].as_str()),
                "source": "curseforge"
            })
        })
        .collect();
    let total = value["pagination"]["totalCount"]
        .as_u64()
        .unwrap_or(hits.len() as u64);
    Ok(json!({"hits": hits, "total": total, "page": page, "pageSize": 30}))
}

async fn files(
    core: &Core,
    mod_id: u64,
    game: Option<&str>,
    loader: Option<&str>,
    key: Option<&str>,
) -> Result<Vec<Value>> {
    let mut url =
        reqwest::Url::parse(&format!("{}/mods/{mod_id}/files", endpoint(key))).map_err(err)?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("pageSize", "50");
        if let Some(game) = game.filter(|v| !v.is_empty()) {
            pairs.append_pair("gameVersion", game);
        }
        if let Some(kind) = loader.and_then(loader_type) {
            pairs.append_pair("modLoaderType", &kind.to_string());
        }
    }
    let value = get(core, url.as_str(), key).await?;
    Ok(value["data"].as_array().cloned().unwrap_or_default())
}

fn compatible(file: &Value, game: Option<&str>, loader: Option<&str>) -> bool {
    // A dedicated server archive is not an installable client modpack.
    if file["isServerPack"] == true {
        return false;
    }
    let versions: Vec<&str> = file["gameVersions"]
        .as_array()
        .map(|a| a.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    if let Some(game) = game.filter(|v| !v.is_empty()) {
        if !versions.iter().any(|v| *v == game) {
            return false;
        }
    }
    if let Some(loader) = loader.and_then(loader_name) {
        if !versions.iter().any(|v| *v == loader) {
            return false;
        }
    }
    true
}

async fn best_file(
    core: &Core,
    mod_id: u64,
    game: Option<&str>,
    loader: Option<&str>,
    key: Option<&str>,
) -> Result<Value> {
    let mut rows = files(core, mod_id, game, loader, key).await?;
    rows.retain(|file| file["isAvailable"] != false && compatible(file, game, loader));
    let mut approved: Vec<Value> = rows
        .iter()
        .filter(|file| file["fileStatus"].as_u64() == Some(4))
        .cloned()
        .collect();
    if approved.is_empty() {
        approved = rows;
    }
    approved.sort_by(|a, b| {
        a["fileDate"]
            .as_str()
            .unwrap_or("")
            .cmp(b["fileDate"].as_str().unwrap_or(""))
    });
    approved
        .pop()
        .ok_or_else(|| format!("CurseForge 项目 {mod_id} 没有兼容当前游戏与加载器的文件"))
}

pub(crate) async fn file_by_id(
    core: &Core,
    mod_id: u64,
    file_id: u64,
    key: Option<&str>,
) -> Result<Value> {
    let value = get(
        core,
        &format!("{}/mods/{mod_id}/files/{file_id}", endpoint(key)),
        key,
    )
    .await?;
    value["data"]
        .as_object()
        .map(|_| value["data"].clone())
        .ok_or_else(|| format!("CurseForge 文件 {mod_id}/{file_id} 不存在"))
}

pub(crate) async fn project_info(core: &Core, mod_id: u64, key: Option<&str>) -> Result<Value> {
    let value = get(core, &format!("{}/mods/{mod_id}", endpoint(key)), key).await?;
    value["data"]
        .as_object()
        .map(|_| value["data"].clone())
        .ok_or_else(|| format!("CurseForge 项目 {mod_id} 不存在"))
}

pub(crate) fn file_name(file: &Value) -> Result<&str> {
    let name = string(file, "fileName")?;
    safe_name(name)?;
    Ok(name)
}

pub(crate) fn file_hash(file: &Value) -> String {
    file["hashes"]
        .as_array()
        .and_then(|items| {
            items
                .iter()
                .find(|hash| hash["algo"].as_u64() == Some(1))
                .and_then(|hash| hash["value"].as_str())
        })
        .unwrap_or("")
        .to_string()
}

pub(crate) fn download_url(file: &Value) -> Result<String> {
    if let Some(url) = file["downloadUrl"].as_str().filter(|url| !url.is_empty()) {
        https(url)?;
        return Ok(download_entry(url).unwrap_or_else(|| url.to_string()));
    }
    let id = file["id"]
        .as_u64()
        .ok_or("CurseForge 文件缺少 ID 与下载地址")?;
    let name = file_name(file)?;
    let mut url = reqwest::Url::parse(&format!(
        "https://edge.forgecdn.net/files/{}",
        id / 1000
    ))
    .map_err(err)?;
    url.path_segments_mut()
        .map_err(|_| "无法构造 CurseForge 下载地址")?
        .push(&(id % 1000).to_string())
        .push(name);
    Ok(url.to_string())
}

pub(crate) fn is_cdn_url(url: &str) -> bool {
    reqwest::Url::parse(url).ok().is_some_and(|url| {
        url.scheme() == "https" && url.host_str().is_some_and(|host|
            host == "forgecdn.net" || host.ends_with(".forgecdn.net"))
    })
}

/// The official entry resolves file IDs and the actual storage path. Legacy
/// pack URLs may contain padded ID segments that the storage CDN rejects.
pub(crate) fn download_entry(url: &str) -> Option<String> {
    if !is_cdn_url(url) { return None; }
    let mut parsed = reqwest::Url::parse(url).ok()?;
    parsed.set_host(Some("edge.forgecdn.net")).ok()?;
    Some(parsed.into())
}

fn dependency_ids(file: &Value) -> Vec<u64> {
    file["dependencies"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter(|dep| dep["relationType"].as_u64() == Some(3))
                .filter_map(|dep| dep["modId"].as_u64())
                .collect()
        })
        .unwrap_or_default()
}

pub async fn dependencies(core: &Core, p: &Value) -> Result<Value> {
    let id = string(p, "id")?;
    let instance = read_json(&core.instance(id)?.join("kxl.json"))?;
    let game = string(&instance, "version")?;
    let loader = instance["loader"].as_str().unwrap_or("vanilla");
    let cf_key = configured_key(core, p["curseforgeKey"].as_str().unwrap_or(""));
    let project = project_id(&p["project"])?;
    let file = best_file(
        core,
        project,
        Some(game),
        if loader == "vanilla" {
            None
        } else {
            Some(loader)
        },
        cf_key.as_deref(),
    )
    .await?;
    let lock = read_json(&core.instance(id)?.join("installed-projects.json"))
        .unwrap_or_else(|_| json!({}));
    let mut dependencies = vec![];
    for dependency in dependency_ids(&file) {
        let info = project_info(core, dependency, cf_key.as_deref())
            .await
            .unwrap_or_else(|_| json!({}));
        let key = format!("cf-{dependency}");
        dependencies.push(json!({
            "project_id": dependency,
            "name": info["name"].as_str().unwrap_or("未知前置"),
            "icon_url": info["logo"]["thumbnailUrl"].as_str().or_else(|| info["logo"]["url"].as_str()),
            "installed": lock[key.as_str()].is_object()
        }));
    }
    Ok(json!({"dependencies": dependencies}))
}

pub async fn install_project(core: &Core, p: &Value) -> Result<Value> {
    let id = string(p, "id")?;
    let instance = read_json(&core.instance(id)?.join("kxl.json"))?;
    let cf_key = configured_key(core, p["curseforgeKey"].as_str().unwrap_or(""));
    let skip_dependencies = p["skipDependencies"].as_bool().unwrap_or(false);
    let kind = string(p, "kind")?;
    let cf_kind = match kind {
        "mods" => "mod",
        "resourcepacks" => "resourcepack",
        "shaderpacks" => "shader",
        _ => return Err("CurseForge 不支持安装到此资源分类".into()),
    };
    let game = string(&instance, "version")?.to_string();
    let loader = instance["loader"].as_str().unwrap_or("vanilla");
    let project = project_id(&p["project"])?;
    let root_icon = p["iconUrl"].as_str().map(str::to_string);
    if cf_kind == "mod" && loader == "vanilla" {
        return Err("原版实例不能安装 Mod，请先安装 Fabric / Forge / NeoForge 等加载器".into());
    }
    let mut pending = VecDeque::from([project]);
    let mut seen = HashSet::new();
    let mut selected: Vec<(u64, Value)> = vec![];
    while let Some(mod_id) = pending.pop_front() {
        core.stopped()?;
        core.stage("解析资源及必需依赖", selected.len(), selected.len() + pending.len() + 1);
        if !seen.insert(mod_id) {
            continue;
        }
        if seen.len() > 128 {
            return Err("CurseForge 依赖树过大，请改用整合包安装".into());
        }
        let file = best_file(
            core,
            mod_id,
            Some(game.as_str()),
            if cf_kind == "mod" { Some(loader) } else { None },
            cf_key.as_deref(),
        )
        .await?;
        for dep in dependency_ids(&file) {
            if !skip_dependencies {
                pending.push_back(dep);
            }
        }
        selected.push((mod_id, file));
    }
    let dir = crate::engine::resource_dir(core, &json!({"id":id,"kind":kind}))?;
    std::fs::create_dir_all(&dir).map_err(err)?;
    let lock_path = core.instance(id)?.join("installed-projects.json");
    let mut lock = read_json(&lock_path).unwrap_or_else(|_| json!({}));
    let plan: Vec<(u64, String, String, String, Value)> = selected
        .iter()
        .map(|(mod_id, file)| {
            Ok((
                *mod_id,
                file_name(file)?.to_string(),
                download_url(file)?,
                file_hash(file),
                file["id"].clone(),
            ))
        })
        .collect::<Result<Vec<_>>>()?;
    let total = plan.len();
    core.stage("下载资源文件", 0, total);
    let count = Arc::new(AtomicUsize::new(0));
    let results = stream::iter(plan.into_iter().map(|(mod_id, name, url, hash, version)| {
        let count = count.clone();
        let target_dir = dir.clone();
        async move {
            crate::engine::download(core, &url, &target_dir.join(&name), &hash).await?;
            let done = count.fetch_add(1, Ordering::Relaxed) + 1;
            core.stage("安装 CurseForge 资源与必需依赖", done, total);
            Ok::<_, String>((mod_id, name, hash, version))
        }
    }))
    .buffer_unordered(8)
    .collect::<Vec<std::result::Result<_, _>>>()
    .await;
    let downloaded = results
        .into_iter()
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for (mod_id, name, hash, version) in downloaded {
        let key = format!("cf-{mod_id}");
        if let Some(previous) = lock[key.as_str()]["file"]
            .as_str()
            .filter(|old| *old != name)
        {
            safe_name(previous)?;
            let old_path = dir.join(previous);
            if let Ok(bytes) = std::fs::read(&old_path) {
                if format!("{:x}", Sha1::digest(&bytes))
                    == lock[key.as_str()]["sha1"].as_str().unwrap_or("")
                {
                    let disabled = dir.join(format!("{previous}.disabled"));
                    if !disabled.exists() {
                        std::fs::rename(&old_path, disabled).map_err(err)?;
                    }
                }
            }
        }
        lock[key.as_str()] = json!({
            "version": version,
            "file": name,
            "sha1": hash,
            "icon_url": if mod_id == project { root_icon.clone() } else { None }
        });
    }
    write_json(&lock_path, &lock)?;
    Ok(json!({"files": total}))
}

pub async fn install_modpack(core: &Core, p: &Value) -> Result<Value> {
    core.stage("获取 CurseForge 整合包版本", 0, 1);
    let project = project_id(&p["project"])?;
    let cf_key = configured_key(core, p["curseforgeKey"].as_str().unwrap_or(""));
    let file = best_file(core, project, p["game"].as_str(), p["loader"].as_str(), cf_key.as_deref()).await?;
    let download = download_url(&file)?;
    let file_name = file_name(&file).unwrap_or("modpack.zip").to_string();
    let dir = core
        .root
        .join("imports")
        .join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&dir).map_err(err)?;
    let path = dir.join(safe_name(&file_name)?);
    core.stage("下载整合包文件", 0, 1);
    crate::engine::download(core, &download, &path, &file_hash(&file)).await?;
    let info = crate::packs::inspect(&path)?;
    let name = p["name"]
        .as_str()
        .or_else(|| info["name"].as_str())
        .unwrap_or("CurseForge 整合包")
        .to_string();
    let result = crate::packs::import(
        core,
        &json!({"path": path, "name": name, "settings": p["settings"].clone(), "curseforgeKey": p["curseforgeKey"].clone()}),
    )
    .await;
    let _ = std::fs::remove_dir_all(&dir);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ids_and_cdn_fallback() {
        assert_eq!(class_id("mod").unwrap(), 6);
        assert_eq!(loader_type("neoforge"), Some(6));
        let file = json!({"id": 9298209u64, "fileName": "jei-test.jar"});
        assert_eq!(
            download_url(&file).unwrap(),
            "https://edge.forgecdn.net/files/9298/209/jei-test.jar"
        );
    }
    #[test]
    fn file_ids_are_not_zero_padded_and_official_storage_urls_use_the_entry() {
        let file = json!({"id":8925075u64,"fileName":"notenoughanimations-neoforge-1.12.6-mc1.21.1.jar"});
        let url = download_url(&file).unwrap();
        assert!(url.contains("edge.forgecdn.net/files/8925/75/"));
        assert!(!url.contains("/075/"));
        assert_eq!(download_url(&json!({"downloadUrl":"https://mediafilez.forgecdn.net/files/8925/075/a%20b.jar"})).unwrap(),
            "https://edge.forgecdn.net/files/8925/075/a%20b.jar");
        assert_eq!(download_url(&json!({"id":1005u64,"fileName":"a + 中文.jar"})).unwrap(),
            "https://edge.forgecdn.net/files/1/5/a%20+%20%E4%B8%AD%E6%96%87.jar");
        for hostile in ["https://forgecdn.net.evil.invalid/a.jar","https://evil.invalid/?source=forgecdn.net", "https://edge.forgecdn.net@evil.invalid/a.jar"] {
            assert!(!is_cdn_url(hostile));
            assert!(download_entry(hostile).is_none());
        }
    }
    #[tokio::test]
    #[ignore = "downloads the actual reported file over HTTPS into an isolated QA root"]
    async fn live_reported_atm10_file_uses_official_redirect_and_verified_cache() {
        let root = PathBuf::from(std::env::var("KXL_CF_TEST_ROOT").expect("isolated QA root required"));
        assert!(root.components().any(|part| part.as_os_str() == ".update-qa"));
        let core = Core::new(root.clone(),Arc::new(|_| {})).unwrap();
        let key = configured_key(&core, "");
        let file = file_by_id(&core,433760,8925075,key.as_deref()).await.unwrap();
        let name = file_name(&file).unwrap();
        let hash = file_hash(&file);
        assert_eq!(hash,"2098ae4965ebefb2dc8d5aec42a7d5282414fddc");
        let legacy = format!("https://mediafilez.forgecdn.net/files/8925/075/{name}");
        let target = root.join("mods").join(name);
        crate::mirrors::mark_failed(&core);
        let start = std::time::Instant::now();
        crate::engine::download(&core,&legacy,&target,&hash).await.unwrap();
        assert!(crate::engine::cached_file_valid(&target,&hash).await.unwrap());
        let report = json!({"success":true,"fileId":8925075,"bytes":std::fs::metadata(&target).unwrap().len(),
            "sha1":hash,"elapsedMs":start.elapsed().as_millis(),"legacyUrlResolved":true,"unrelatedMirrorFailureDoesNotDisableEntry":true});
        write_json(&root.join("result.json"),&report).unwrap();
        println!("{report}");
    }
    #[tokio::test]
    #[ignore = "downloads real files from multiple projects through the shared downloader"]
    async fn live_shared_curseforge_downloads_across_projects() {
        let root = PathBuf::from(std::env::var("KXL_CF_TEST_ROOT").expect("isolated QA root required"));
        assert!(root.components().any(|part| part.as_os_str() == ".update-qa"));
        let core = Core::new(root.clone(),Arc::new(|_| {})).unwrap();
        let key = configured_key(&core, "");
        let mut results = vec![];
        for project_id in [306612,238222,285109] {
            let project = project_info(&core,project_id,key.as_deref()).await.unwrap();
            let file = project["latestFiles"].as_array().unwrap().iter()
                .find(|file| file["isServerPack"] != true && file["isAvailable"] != false).unwrap();
            let file = file_by_id(&core,project_id,file["id"].as_u64().unwrap(),key.as_deref()).await.unwrap();
            let name = file_name(&file).unwrap();
            let hash = file_hash(&file);
            assert_eq!(hash.len(),40);
            let url = download_url(&file).unwrap();
            assert!(url.starts_with("https://edge.forgecdn.net/"));
            let target = root.join("cross-project").join(project_id.to_string()).join(name);
            crate::engine::download(&core,&url,&target,&hash).await.unwrap();
            assert!(crate::engine::cached_file_valid(&target,&hash).await.unwrap());
            results.push(json!({"projectId":project_id,"projectName":project["name"],"fileId":file["id"],"fileName":name,"sha1Verified":true}));
        }
        write_json(&root.join("cross-project-result.json"),&json!({"success":true,"files":results})).unwrap();
        println!("{}",json!({"success":true,"files":results}));
    }
    #[test]
    fn compatible_versions() {
        let file = json!({"gameVersions":["1.20.1","Forge","Client"]});
        assert!(compatible(&file, Some("1.20.1"), Some("forge")));
        assert!(!compatible(&file, Some("1.21.1"), Some("forge")));
        assert!(!compatible(&file, Some("1.20.1"), Some("fabric")));
        assert!(!compatible(&json!({"isServerPack":true,"gameVersions":["1.20.1","Forge"]}), Some("1.20.1"), Some("forge")));
    }

    #[tokio::test]
    #[ignore = "downloads and installs the full public RLCraft pack into an isolated QA directory"]
    async fn live_rlcraft_independent_install() {
        let root = PathBuf::from(std::env::var("KXL_PACK_TEST_ROOT").unwrap());
        assert!(root.components().any(|part| part.as_os_str() == ".update-qa"));
        let last = std::sync::Mutex::new((String::new(), 0u64));
        let core = Core::new(root.clone(), Arc::new(move |event| {
            let stage = event["stage"].as_str().unwrap_or("");
            let done = event["done"].as_u64().unwrap_or(0);
            let total = event["total"].as_u64().unwrap_or(1).max(1);
            let percent = done.saturating_mul(100) / total;
            let mut last = last.lock().unwrap();
            if stage != last.0 || percent / 10 != last.1 / 10 {
                println!("{stage}: {done}/{total}");
                *last = (stage.to_string(), percent);
            }
        })).unwrap();
        let existing = core.instance("existing").unwrap();
        write_json(&existing.join("kxl.json"), &json!({"id":"existing","name":"已有实例"})).unwrap();
        std::fs::write(existing.join("keep.txt"), b"untouched").unwrap();
        let result = install_modpack(&core, &json!({"project":285109,"name":"RLCraft 验证","id":"existing"})).await.unwrap();
        let instance = core.instance(result["id"].as_str().unwrap()).unwrap();
        assert_ne!(result["id"], "existing");
        assert_eq!(result["settings"]["isolation"], "all");
        assert_eq!(result["loader"], "forge");
        assert!(instance.join("client.jar").is_file());
        assert!(instance.join("config").is_dir());
        assert!(std::fs::read_dir(instance.join("mods")).unwrap().count() > 100);
        assert_eq!(std::fs::read(existing.join("keep.txt")).unwrap(), b"untouched");
        write_json(&root.join("rlcraft-install-result.json"), &result).unwrap();
        println!("RLCraft installed successfully into a new instance; existing instance unchanged.");
    }
}
