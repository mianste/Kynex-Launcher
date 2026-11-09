use crate::*;
use futures_util::{stream, StreamExt};
use rayon::prelude::*;
use sha1::{Digest, Sha1};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const TTL: u64 = 6 * 3600;

/// Mod 目录里的可检查文件：`.jar` / `.litemod`，允许 `.disabled` 后缀。
/// 禁用模组也会被检查更新，更新时由调用方保持禁用状态。
fn mod_file(name: &str) -> bool {
    let name = name.strip_suffix(".disabled").unwrap_or(name);
    resource_downloads::extension_matches(name, "mods")
}

#[derive(Clone)]
struct Local {
    name: String,
    sha: String,
    fingerprint: u32,
}
#[derive(Default)]
struct Known {
    old: Value,
    candidates: Vec<Value>,
}
#[derive(Default)]
struct Source {
    known: HashMap<String, Known>,
    failed: HashMap<String, String>,
}
impl Source {
    fn failure(&mut self, hashes: impl IntoIterator<Item = String>, reason: &str) {
        for hash in hashes {
            self.failed.insert(hash, reason.into());
        }
    }
}
// CurseForge's public fingerprint format: MurmurHash2, seed 1, excluding
// ASCII tab, line-feed, carriage-return and space. SHA-1 still verifies identity.
fn fingerprint(bytes: &[u8]) -> u32 {
    let bytes: Vec<u8> = bytes
        .iter()
        .copied()
        .filter(|b| !matches!(b, 9 | 10 | 13 | 32))
        .collect();
    let mut h = 1 ^ bytes.len() as u32;
    let mut chunks = bytes.chunks_exact(4);
    for word in &mut chunks {
        let mut k = u32::from_le_bytes(word.try_into().unwrap()).wrapping_mul(0x5bd1e995);
        k ^= k >> 24;
        h = h.wrapping_mul(0x5bd1e995) ^ k.wrapping_mul(0x5bd1e995);
    }
    let tail = chunks.remainder();
    if !tail.is_empty() {
        let k = tail
            .iter()
            .enumerate()
            .fold(0u32, |n, (i, b)| n | ((*b as u32) << (8 * i)));
        h = (h ^ k).wrapping_mul(0x5bd1e995);
    }
    h ^= h >> 13;
    h = h.wrapping_mul(0x5bd1e995);
    h ^ (h >> 15)
}
fn id(v: &Value) -> String {
    v.as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| v.to_string())
}
fn date_key(value: &Value, source: &str) -> Option<String> {
    let s = value[if source == "modrinth" {
        "date_published"
    } else {
        "fileDate"
    }]
    .as_str()?;
    if !s.is_ascii()
        || s.len() < 20
        || !s[..19].bytes().enumerate().all(|(i, b)| match i {
            4 | 7 => b == b'-',
            10 => b == b'T',
            13 | 16 => b == b':',
            _ => b.is_ascii_digit(),
        })
    {
        return None;
    }
    let tail = s[19..]
        .strip_suffix('Z')
        .or_else(|| s[19..].strip_suffix("+00:00"))?;
    let fraction = if tail.is_empty() {
        ""
    } else {
        tail.strip_prefix('.')?
    };
    if fraction.len() > 9 || !fraction.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some(format!("{}{fraction:0<9}", &s[..19]))
}
fn loaders(v: &Value, source: &str) -> Vec<String> {
    let mut values: Vec<String> = if source == "modrinth" {
        v["loaders"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_lowercase)
            .collect()
    } else {
        v["gameVersions"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_lowercase)
            .filter(|s| {
                matches!(
                    s.as_str(),
                    "fabric" | "forge" | "neoforge" | "quilt" | "liteloader" | "rift"
                )
            })
            .collect()
    };
    values.sort();
    values.dedup();
    values
}
fn file_hash(v: &Value, source: &str) -> Option<String> {
    let hash = if source == "modrinth" {
        resource_downloads::modrinth_file(v, "mods").ok()?["hashes"]["sha1"]
            .as_str()?
            .to_string()
    } else {
        if v["isAvailable"] == false
            || v["isServerPack"] == true
            || !resource_downloads::extension_matches(v["fileName"].as_str()?, "mods")
        {
            return None;
        }
        curseforge::file_hash(v)
    };
    (hash.len() == 40 && hash.bytes().all(|b| b.is_ascii_hexdigit())).then(|| hash.to_lowercase())
}
// Secondary attachments can represent another binary variant. Only associate
// a local file with the version's selected installable JAR, never guess a mapping.
fn mr_identity(v: &Value, hash: &str) -> bool {
    resource_downloads::modrinth_file(v, "mods")
        .ok()
        .is_some_and(|file| {
            file["hashes"]["sha1"]
                .as_str()
                .is_some_and(|h| h.eq_ignore_ascii_case(hash))
        })
}

fn compatible(old: &Value, new: &Value, source: &str, game: &str, loader: &str) -> bool {
    let project = if source == "modrinth" {
        "project_id"
    } else {
        "modId"
    };
    let versions = if source == "modrinth" {
        "game_versions"
    } else {
        "gameVersions"
    };
    let profile = loaders(old, source);
    old[project] == new[project]
        && !old[project].is_null()
        && loaders(new, source) == profile
        && (profile.iter().any(|s| s == loader)
            || (profile.is_empty()
                && source == "curseforge"
                && !matches!(loader, "vanilla" | "optifine")))
        && new[versions]
            .as_array()
            .is_some_and(|a| a.iter().any(|v| v == game))
        && file_hash(new, source).is_some()
        && date_key(old, source).is_some()
        && date_key(new, source).is_some()
}
async fn mr_post(core: &Core, path: &str, body: &Value) -> Result<Value> {
    let request = |base: &str| {
        let url = format!("{base}/{path}");
        async move {
            let value: Value = core
                .http
                .post(url)
                .json(body)
                .timeout(Duration::from_secs(12))
                .send()
                .await
                .map_err(err)?
                .error_for_status()
                .map_err(err)?
                .json()
                .await
                .map_err(err)?;
            if !value.is_object() {
                return Err("Modrinth 响应无效".into());
            }
            Ok::<Value, String>(value)
        }
    };
    let primary = request("https://api.modrinth.com/v2");
    let mirror = async {
        tokio::time::sleep(Duration::from_millis(350)).await;
        request("https://mod.mcimirror.top/modrinth/v2").await
    };
    tokio::pin!(primary);
    tokio::pin!(mirror);
    jobs::wait(core,async{tokio::select!{
        a=&mut primary=>match a{Ok(v)=>Ok(v),Err(a)=>mirror.await.map_err(|b|format!("Modrinth：{a}；备用源：{b}"))},
        b=&mut mirror=>match b{Ok(v)=>Ok(v),Err(b)=>primary.await.map_err(|a|format!("Modrinth：{a}；备用源：{b}"))},
    }}).await?
}
async fn modrinth(core: &Core, local: &[Local], game: &str) -> Source {
    let mut result = Source::default();
    for chunk in local.chunks(100) {
        let hashes: Vec<_> = chunk.iter().map(|l| l.sha.clone()).collect();
        match mr_post(
            core,
            "version_files",
            &json!({"hashes":hashes,"algorithm":"sha1"}),
        )
        .await
        {
            Ok(values) => {
                for l in chunk {
                    if let Some(v) = values.get(&l.sha).filter(|v| mr_identity(v, &l.sha)) {
                        result.known.insert(
                            l.sha.clone(),
                            Known {
                                old: v.clone(),
                                candidates: vec![],
                            },
                        );
                    }
                }
            }
            Err(e) => result.failure(hashes, &e),
        }
    }
    let mut groups: BTreeMap<Vec<String>, Vec<String>> = BTreeMap::new();
    for (hash, k) in &result.known {
        groups
            .entry(loaders(&k.old, "modrinth"))
            .or_default()
            .push(hash.clone());
    }
    for (profile, hashes) in groups {
        if profile.is_empty() {
            continue;
        }
        for chunk in hashes.chunks(100) {
            match mr_post(core,"version_files/update",&json!({"hashes":chunk,"algorithm":"sha1","game_versions":[game],"loaders":profile})).await{
                Ok(values)=>for hash in chunk{if let Some(v)=values.get(hash){result.known.get_mut(hash).unwrap().candidates.push(v.clone());}},
                Err(e)=>result.failure(chunk.iter().cloned(),&e),
            }
        }
    }
    result
}
fn loader_number(loader: &str) -> u64 {
    match loader {
        "forge" => 1,
        "fabric" => 4,
        "quilt" => 5,
        "neoforge" => 6,
        _ => 0,
    }
}
async fn curseforge_scan(
    core: &Core,
    local: &[Local],
    game: &str,
    loader: &str,
    provided: &str,
    lock: &Value,
) -> Source {
    let key = curseforge::configured_key(core, provided);
    let key = key.as_deref();
    let mut result = Source::default();
    for chunk in local.chunks(100) {
        let prints: Vec<_> = chunk.iter().map(|l| l.fingerprint).collect();
        match curseforge::post(
            core,
            "fingerprints/432",
            key,
            &json!({"fingerprints":prints}),
        )
        .await
        {
            Ok(value) => {
                if let Some(matches) = value["data"]["exactMatches"].as_array() {
                    for m in matches {
                        let file = &m["file"];
                        for l in chunk {
                            if file["fileFingerprint"].as_u64() != Some(l.fingerprint as u64)
                                || file_hash(file, "curseforge").as_deref() != Some(&l.sha)
                            {
                                continue;
                            }
                            if result
                                .failed
                                .get(&l.sha)
                                .is_some_and(|e| e == "指纹对应多个项目，不能自动选择更新来源")
                            {
                                continue;
                            }
                            if result
                                .known
                                .get(&l.sha)
                                .is_some_and(|k| k.old["modId"] != file["modId"])
                            {
                                result.known.remove(&l.sha);
                                result.failure(
                                    [l.sha.clone()],
                                    "指纹对应多个项目，不能自动选择更新来源",
                                );
                                continue;
                            }
                            result.known.insert(
                                l.sha.clone(),
                                Known {
                                    old: file.clone(),
                                    candidates: vec![],
                                },
                            );
                        }
                    }
                } else {
                    result.failure(
                        chunk.iter().map(|l| l.sha.clone()),
                        "CurseForge 指纹响应无效",
                    );
                }
            }
            Err(e) => result.failure(chunk.iter().map(|l| l.sha.clone()), &e),
        }
    }
    // Existing trusted installation records remain a fallback if fingerprint
    // lookup is temporarily unavailable. File contents must still match.
    let mut recorded = vec![];
    for l in local.iter().filter(|l| !result.known.contains_key(&l.sha)) {
        if let Some((pid, v)) = lock.as_object().into_iter().flatten().find(|(k, v)| {
            k.starts_with("cf-")
                && v["sha1"]
                    .as_str()
                    .is_some_and(|h| h.eq_ignore_ascii_case(&l.sha))
        }) {
            if let (Ok(pid), Ok(vid)) = (
                pid.trim_start_matches("cf-").parse::<u64>(),
                id(&v["version"]).parse::<u64>(),
            ) {
                recorded.push((l.sha.clone(), pid, vid));
            }
        }
    }
    let records = stream::iter(recorded.into_iter().map(|(hash, pid, vid)| async move {
        (hash, curseforge::file_by_id(core, pid, vid, key).await)
    }))
    .buffer_unordered(4)
    .collect::<Vec<_>>()
    .await;
    for (hash, file) in records {
        if let Ok(file) = file {
            if file_hash(&file, "curseforge").as_deref() == Some(&hash) {
                result.failed.remove(&hash);
                result.known.insert(
                    hash,
                    Known {
                        old: file,
                        candidates: vec![],
                    },
                );
            }
        }
    }
    let projects: Vec<u64> = result
        .known
        .values()
        .filter_map(|v| v.old["modId"].as_u64())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let mut indexes: HashMap<u64, BTreeSet<u64>> = HashMap::new();
    let mut files: HashMap<u64, Value> = HashMap::new();
    for batch in projects.chunks(100) {
        match curseforge::post(core, "mods", key, &json!({"modIds":batch})).await {
            Ok(value) => {
                if let Some(rows) = value["data"].as_array() {
                    for info in rows {
                        let Some(pid) = info["id"].as_u64() else {
                            continue;
                        };
                        if info["isAvailable"] == false {
                            continue;
                        }
                        let wanted = indexes.entry(pid).or_default();
                        for entry in info["latestFilesIndexes"].as_array().into_iter().flatten() {
                            if entry["gameVersion"] == game
                                && entry["modLoader"]
                                    .as_u64()
                                    .is_none_or(|n| n == 0 || n == loader_number(loader))
                            {
                                if let Some(id) = entry["fileId"].as_u64() {
                                    wanted.insert(id);
                                }
                            }
                        }
                        for file in info["latestFiles"].as_array().into_iter().flatten() {
                            if file["gameVersions"]
                                .as_array()
                                .is_some_and(|a| a.iter().any(|v| v == game))
                            {
                                if let Some(id) = file["id"].as_u64() {
                                    wanted.insert(id);
                                    files.insert(id, file.clone());
                                }
                            }
                        }
                    }
                } else {
                    result.failure(
                        result
                            .known
                            .iter()
                            .filter(|(_, v)| batch.contains(&v.old["modId"].as_u64().unwrap_or(0)))
                            .map(|(h, _)| h.clone())
                            .collect::<Vec<_>>(),
                        "CurseForge 项目响应无效",
                    );
                }
            }
            Err(e) => result.failure(
                result
                    .known
                    .iter()
                    .filter(|(_, v)| batch.contains(&v.old["modId"].as_u64().unwrap_or(0)))
                    .map(|(h, _)| h.clone())
                    .collect::<Vec<_>>(),
                &e,
            ),
        }
    }
    let needed: Vec<u64> = indexes
        .values()
        .flatten()
        .copied()
        .filter(|id| !files.contains_key(id))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    for batch in needed.chunks(100) {
        match curseforge::post(core, "mods/files", key, &json!({"fileIds":batch})).await {
            Ok(value) => {
                if let Some(rows) = value["data"].as_array() {
                    for file in rows {
                        if let Some(id) = file["id"].as_u64() {
                            files.insert(id, file.clone());
                        }
                    }
                }
            }
            Err(e) => result.failure(
                result
                    .known
                    .iter()
                    .filter(|(_, v)| {
                        indexes
                            .get(&v.old["modId"].as_u64().unwrap_or(0))
                            .is_some_and(|ids| batch.iter().any(|id| ids.contains(id)))
                    })
                    .map(|(h, _)| h.clone())
                    .collect::<Vec<_>>(),
                &e,
            ),
        }
    }
    for (hash, k) in &mut result.known {
        let Some(ids) = indexes.get(&k.old["modId"].as_u64().unwrap_or(0)) else {
            continue;
        };
        for id in ids {
            if let Some(v) = files.get(id) {
                k.candidates.push(v.clone());
            } else {
                result
                    .failed
                    .insert(hash.clone(), "部分 CurseForge 文件信息暂不可用".into());
            }
        }
    }
    result
}
fn row(local: &Local, mr: &Source, cf: &Source, game: &str, loader: &str) -> Value {
    let mut row = json!({"file":local.name,"sha1":local.sha,"status":"unknown","detail":"文件未被可用平台收录，不能确认版本","cached":false});
    row["identifiedSources"] = json!([("modrinth", mr), ("curseforge", cf)]
        .into_iter()
        .filter(|(_, s)| s.known.contains_key(&local.sha))
        .map(|(name, _)| name)
        .collect::<Vec<_>>());
    let mut identities = serde_json::Map::new();
    for (name, source) in [("modrinth", mr), ("curseforge", cf)] {
        if let Some(k) = source.known.get(&local.sha) {
            let field = if name == "modrinth" {
                "project_id"
            } else {
                "modId"
            };
            if !k.old[field].is_null() {
                identities.insert(name.into(), json!(id(&k.old[field])));
            }
        }
    }
    row["identities"] = Value::Object(identities);
    let mut candidates = vec![];
    for (name, source) in [("modrinth", mr), ("curseforge", cf)] {
        if let Some(k) = source.known.get(&local.sha) {
            for v in &k.candidates {
                if compatible(&k.old, v, name, game, loader) {
                    candidates.push((name, &k.old, v));
                }
            }
        }
    }
    let is_update = |(source, old, new): &(&str, &Value, &Value)| {
        id(&old["id"]) != id(&new["id"])
            && date_key(new, source) > date_key(old, source)
            && file_hash(new, source).as_deref() != Some(&local.sha)
    };
    let selected = candidates
        .iter()
        .filter(|c| is_update(c))
        .max_by_key(|(s, _, v)| date_key(v, s))
        .or_else(|| candidates.first());
    let errors: Vec<_> = [mr.failed.get(&local.sha), cf.failed.get(&local.sha)]
        .into_iter()
        .flatten()
        .cloned()
        .collect();
    if let Some((source, old, new)) = selected {
        let update = is_update(&(*source, *old, *new));
        let (project, number) = if *source == "modrinth" {
            ("project_id", "version_number")
        } else {
            ("modId", "displayName")
        };
        row["source"] = json!(source);
        row["project"] = old[project].clone();
        row["versionId"] = json!(id(&new["id"]));
        row["currentId"] = json!(id(&old["id"]));
        row["current"] = old[number].clone();
        row["latest"] = new[number].clone();
        row["status"] = json!(if update { "update" } else { "current" });
        row["detail"] = json!(if update {
            "有同加载器的兼容更新"
        } else if errors.is_empty() {
            "未发现更新的兼容文件"
        } else {
            "当前可用来源未发现兼容更新"
        });
        if !errors.is_empty() {
            row["partial"] = json!(true);
            row["warning"] = json!(errors.join("；"));
        }
    } else if !errors.is_empty() {
        row["status"] = json!("error");
        row["detail"] = json!(errors.join("；"));
    } else if mr.known.contains_key(&local.sha) || cf.known.contains_key(&local.sha) {
        row["detail"] = json!("未找到相同加载器组合的兼容文件，未自动替换");
    }
    row
}
fn mark_duplicates(rows: &mut [Value]) {
    let mut counts: HashMap<String, usize> = HashMap::new();
    for r in rows.iter() {
        for (source, pid) in r["identities"].as_object().into_iter().flatten() {
            *counts.entry(format!("{source}:{}", id(pid))).or_default() += 1;
        }
    }
    for r in rows.iter_mut() {
        if r["identities"]
            .as_object()
            .into_iter()
            .flatten()
            .any(|(source, pid)| {
                counts
                    .get(&format!("{source}:{}", id(pid)))
                    .copied()
                    .unwrap_or(0)
                    > 1
            })
        {
            r["status"] = json!("unknown");
            r["detail"] = json!("同一模组存在多个启用文件，请先保留一份再更新");
        }
    }
}
fn installed_target(core: &Core, action: &str, p: &Value, result: &Value) -> Option<String> {
    let target = match action {
        "install_project"
            if matches!(p["kind"].as_str(), Some("mods" | "modpacks"))
                || result["modsChanged"] == true =>
        {
            p["id"].as_str().or_else(|| result["id"].as_str())
        }
        "import_pack" => result["id"].as_str(),
        "update_mods" if result["updated"].as_u64().unwrap_or(0) > 0 => p["id"].as_str(),
        "import_resource" | "import_resource_paths" if p["kind"] == "mods" => p["id"].as_str(),
        "download_resource_file" if p["kind"] == "mods" => p["id"].as_str(),
        _ => None,
    }?;
    let dir = engine::resource_dir(core, &json!({"id":target,"kind":"mods"})).ok()?;
    if action == "download_resource_file" {
        let parent = Path::new(p["path"].as_str()?)
            .parent()?
            .canonicalize()
            .ok()?;
        if parent != dir.canonicalize().ok()? {
            return None;
        }
    }
    if !std::fs::read_dir(&dir).ok()?.flatten().any(|e| {
        e.file_type().is_ok_and(|t| t.is_file())
            && resource_downloads::extension_matches(&e.file_name().to_string_lossy(), "mods")
    }) {
        return None;
    }
    Some(target.into())
}
// Run after file writes have completed, independently of the visible page or
// the completed download task. Repeated installs coalesce into one worker.
pub fn after_install(core: &Core, action: &str, p: &Value, result: &Value) {
    let Some(id) = installed_target(core, action, p, result) else {
        return;
    };
    schedule(
        core,
        id,
        p["curseforgeKey"].as_str().unwrap_or("").into(),
        true,
    );
}
// Called once the app's event listener is ready, independently of any page.
pub fn prepare_installed(core: &Core, p: &Value) -> Result<Value> {
    let root = core.root.join("instances");
    if !root.exists() {
        return Ok(json!({"scheduled":0}));
    }
    let mut scheduled = 0;
    for entry in std::fs::read_dir(root).map_err(err)?.flatten() {
        let id = entry.file_name().to_string_lossy().to_string();
        if installed_target(
            core,
            "import_resource_paths",
            &json!({"id":id,"kind":"mods"}),
            &Value::Null,
        )
        .is_some()
        {
            schedule(
                core,
                id,
                p["curseforgeKey"].as_str().unwrap_or("").into(),
                false,
            );
            scheduled += 1;
        }
    }
    Ok(json!({"scheduled":scheduled}))
}
fn schedule(core: &Core, id: String, key: String, force: bool) {
    let scan_key=format!("{}:{id}",core.root.display());
    if !core.jobs.request_mod_scan(&scan_key) {
        return;
    }
    let background = Core {
        cancel: Arc::new(AtomicBool::new(false)),
        ..core.clone()
    };
    tokio::spawn(async move {
        // Restore only results whose content hash/game/loader still match. No
        // network is used for this step, even when the saved result has aged.
        let generation = background.jobs.mod_scan_generation(&scan_key);
        if let Ok(rows) = check(&background, &json!({"id":id,"cacheOnly":true})).await {
            if background.jobs.mod_scan_generation(&scan_key) == generation
                && rows.as_array().is_some_and(|r| !r.is_empty())
            {
                (background.progress)(
                    json!({"modUpdateScan":{"id":id,"generation":generation,"status":"cached","rows":rows}}),
                );
            }
        }
        let _slot = background
            .jobs
            .mod_scan_slots
            .acquire()
            .await
            .expect("mod scan semaphore open");
        loop {
            let generation = background.jobs.mod_scan_generation(&scan_key);
            (background.progress)(
                json!({"modUpdateScan":{"id":id,"generation":generation,"status":"checking"}}),
            );
            let result = check(
                &background,
                &json!({"id":id,"force":force || generation > 1,"curseforgeKey":key}),
            )
            .await;
            if !background.jobs.finish_mod_scan(&scan_key, generation) {
                continue;
            }
            let event = match result {
                Ok(rows) => json!({"id":id,"generation":generation,"status":"done","rows":rows}),
                Err(error) => {
                    json!({"id":id,"generation":generation,"status":"error","error":error})
                }
            };
            (background.progress)(json!({"modUpdateScan":event}));
            break;
        }
    });
}
pub async fn check(core: &Core, p: &Value) -> Result<Value> {
    core.stopped()?;
    let instance = core.instance(string(p, "id")?)?;
    let config = read_json(&instance.join("kxl.json"))?;
    let game = string(&config, "version")?;
    let loader = config["loader"]
        .as_str()
        .unwrap_or("vanilla")
        .to_lowercase();
    let dir = engine::resource_dir(core, &json!({"id":p["id"],"kind":"mods"}))?;
    let cache_core=core.clone();
    let (local,mut rows)=tokio::task::spawn_blocking(move||->Result<(Vec<Local>,Vec<Value>)>{
        if !dir.exists(){return Ok((vec![],vec![]));}
        let paths=std::fs::read_dir(&dir).map_err(err)?.flatten().filter(|e|e.file_type().is_ok_and(|t|t.is_file()) && mod_file(&e.file_name().to_string_lossy())).map(|e|e.path()).collect::<Vec<_>>();
        let scans=resources::hash_readers().install(||paths.par_iter().map(|path|{
            let name=path.file_name().unwrap().to_string_lossy().to_string();
            let hashes:Result<(String,u32)>=resources::try_cached_resource(&cache_core,path,"mod-hashes",||{
                let bytes=std::fs::read(path).map_err(err)?;Ok((format!("{:x}",Sha1::digest(&bytes)),fingerprint(&bytes)))
            });
            match hashes{Ok((sha,fingerprint))=>Ok(Local{name,sha,fingerprint}),Err(e)=>Err(json!({"file":name,"status":"error","detail":format!("无法读取模组：{e}")}))}
        }).collect::<Vec<_>>());
        let mut local=vec![];let mut errors=vec![];for s in scans{match s{Ok(v)=>local.push(v),Err(e)=>errors.push(e)}}Ok((local,errors))
    }).await.map_err(err)??;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(err)?
        .as_secs();
    let cache_path = core.root.join("cache/mod-updates-v3.json");
    let cache = read_json(&cache_path).unwrap_or_else(|_| json!({}));
    let key = |l: &Local| format!("{}|{game}|{loader}", l.sha);
    let mut pending = vec![];
    for l in local {
        let cached = &cache["entries"][key(&l)];
        let age = cached["checkedAt"]
            .as_u64()
            .filter(|at| *at <= now)
            .map(|at| now - at);
        if age.is_some()
            && (p["cacheOnly"] == true || p["force"] != true && age.is_some_and(|n| n < TTL))
            && matches!(cached["status"].as_str(), Some("current" | "update"))
            && cached["partial"] != true
        {
            let mut v = cached.clone();
            v["file"] = json!(l.name);
            v["cached"] = json!(true);
            rows.push(v);
        } else if p["cacheOnly"] != true {
            pending.push(l);
        }
    }
    if !pending.is_empty() {
        let lock =
            read_json(&instance.join("installed-projects.json")).unwrap_or_else(|_| json!({}));
        let (mr, cf) = tokio::join!(
            modrinth(core, &pending, game),
            curseforge_scan(
                core,
                &pending,
                game,
                &loader,
                p["curseforgeKey"].as_str().unwrap_or(""),
                &lock
            )
        );
        core.stopped()?;
        for l in &pending {
            let mut v = row(l, &mr, &cf, game, &loader);
            v["checkedAt"] = json!(now);
            rows.push(v);
        }
        mark_duplicates(&mut rows);
        let guard = core.jobs.file_lock(&cache_path);
        let _guard = guard.lock().await;
        let mut saved = read_json(&cache_path).unwrap_or_else(|_| json!({"entries":{}}));
        if !saved["entries"].is_object() {
            saved["entries"] = json!({});
        }
        saved["entries"].as_object_mut().unwrap().retain(|_, v| {
            v["checkedAt"]
                .as_u64()
                .is_some_and(|at| at <= now && now - at < TTL)
        });
        for l in &pending {
            if let Some(v) = rows.iter().find(|r| {
                r["sha1"] == l.sha
                    && r["partial"] != true
                    && matches!(r["status"].as_str(), Some("current" | "update"))
            }) {
                saved["entries"][key(l)] = v.clone();
            }
        }
        let _ = write_json(&cache_path, &saved);
    }
    mark_duplicates(&mut rows);
    rows.sort_by_key(|v| v["file"].as_str().unwrap_or("").to_lowercase());
    Ok(json!(rows))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn disabled_mods_are_scanned_for_updates() {
        assert!(mod_file("sodium.jar"));
        assert!(mod_file("old.litemod"));
        // 禁用文件仍然参与更新检查，避免“更新后偷偷启用”。
        assert!(mod_file("sodium.jar.disabled"));
        assert!(mod_file("old.litemod.disabled"));
        // 其他后缀与双层 .disabled 不算 Mod。
        assert!(!mod_file("sodium.jar.disabled.disabled"));
        assert!(!mod_file("notes.txt"));
    }
    #[tokio::test]
    async fn cached_startup_results_require_matching_contents_game_and_loader() {
        let t = tempfile::tempdir().unwrap();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let core = Core::new(
            t.path().into(),
            Arc::new(move |v| {
                let _ = tx.send(v);
            }),
        )
        .unwrap();
        let instance = core.instance("a").unwrap();
        write_json(
            &instance.join("kxl.json"),
            &json!({"id":"a","version":"1.20.1","loader":"fabric","settings":{"isolation":"all"}}),
        )
        .unwrap();
        std::fs::create_dir_all(instance.join("mods")).unwrap();
        std::fs::write(instance.join("mods/renamed.jar"), b"old mod").unwrap();
        let sha = format!("{:x}", Sha1::digest(b"old mod"));
        let key = format!("{sha}|1.20.1|fabric");
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let cache = core.root.join("cache/mod-updates-v3.json");
        write_json(&cache, &json!({"entries":{key.clone():{"sha1":sha,"file":"original.jar","status":"update","current":"1","latest":"2","checkedAt":now}}})).unwrap();
        assert_eq!(
            prepare_installed(&core, &json!({})).unwrap()["scheduled"],
            1
        );
        tokio::time::timeout(Duration::from_secs(5), async {
            let mut restored = false;
            while let Some(event) = rx.recv().await {
                let event = &event["modUpdateScan"];
                if event["status"] == "cached" {
                    assert_eq!(event["rows"][0]["file"], "renamed.jar");
                    assert_eq!(event["rows"][0]["status"], "update");
                    restored = true;
                }
                if event["status"] == "done" {
                    assert!(restored);
                    break;
                }
                assert_ne!(event["status"], "error");
            }
        })
        .await
        .unwrap();
        // Expired results can be shown while refreshing, but never for different
        // local contents, game version, or loader. cacheOnly never uses a network.
        let mut saved = read_json(&cache).unwrap();
        saved["entries"][&key]["checkedAt"] = json!(now - TTL - 1);
        write_json(&cache, &saved).unwrap();
        assert_eq!(
            check(&core, &json!({"id":"a","cacheOnly":true}))
                .await
                .unwrap()[0]["status"],
            "update"
        );
        for (game, loader) in [("1.20.2", "fabric"), ("1.20.1", "forge")] {
            write_json(
                &instance.join("kxl.json"),
                &json!({"id":"a","version":game,"loader":loader,"settings":{"isolation":"all"}}),
            )
            .unwrap();
            assert_eq!(
                check(&core, &json!({"id":"a","cacheOnly":true}))
                    .await
                    .unwrap(),
                json!([])
            );
        }
        write_json(
            &instance.join("kxl.json"),
            &json!({"id":"a","version":"1.20.1","loader":"fabric","settings":{"isolation":"all"}}),
        )
        .unwrap();
        std::fs::write(instance.join("mods/renamed.jar"), b"different mod").unwrap();
        assert_eq!(
            check(&core, &json!({"id":"a","cacheOnly":true}))
                .await
                .unwrap(),
            json!([])
        );
    }
    fn v(id: &str, date: &str, hash: &str, loader: &str) -> Value {
        json!({"id":id,"project_id":"project","date_published":date,"version_number":id,"game_versions":["1.20.1"],"loaders":[loader],"files":[{"filename":"mod.jar","primary":true,"hashes":{"sha1":hash}}]})
    }
    #[test]
    fn fingerprint_ignores_only_the_platform_whitespace() {
        assert_eq!(fingerprint(b"a b\t c\r\n"), fingerprint(b"abc"));
        assert_ne!(fingerprint(b"a\x0bc"), fingerprint(b"ac"));
        assert_eq!(fingerprint(b""), 1540447798);
    }
    #[test]
    fn no_downgrade_same_bytes_or_loader_switch() {
        let local = Local {
            name: "renamed.jar".into(),
            sha: "a".repeat(40),
            fingerprint: 0,
        };
        let old = v("old", "2024-01-02T12:00:00Z", &local.sha, "fabric");
        let mut source = Source::default();
        source.known.insert(
            local.sha.clone(),
            Known {
                old: old.clone(),
                candidates: vec![v(
                    "older",
                    "2024-01-01T12:00:00Z",
                    &"b".repeat(40),
                    "fabric",
                )],
            },
        );
        assert_eq!(
            row(&local, &source, &Source::default(), "1.20.1", "fabric")["status"],
            "current"
        );
        source.known.get_mut(&local.sha).unwrap().candidates = vec![v(
            "changed-id",
            "2024-01-03T12:00:00Z",
            &local.sha,
            "fabric",
        )];
        assert_eq!(
            row(&local, &source, &Source::default(), "1.20.1", "fabric")["status"],
            "current"
        );
        source.known.get_mut(&local.sha).unwrap().candidates = vec![v(
            "different-loader",
            "2024-01-03T12:00:00Z",
            &"b".repeat(40),
            "forge",
        )];
        assert_eq!(
            row(&local, &source, &Source::default(), "1.20.1", "fabric")["status"],
            "unknown"
        );
    }
    #[test]
    fn one_failed_source_does_not_discard_a_verified_update() {
        let local = Local {
            name: "renamed.jar".into(),
            sha: "a".repeat(40),
            fingerprint: 0,
        };
        let mut mr = Source::default();
        mr.known.insert(
            local.sha.clone(),
            Known {
                old: v("old", "2024-01-01T00:00:00Z", &local.sha, "fabric"),
                candidates: vec![v("new", "2024-01-02T00:00:00Z", &"b".repeat(40), "fabric")],
            },
        );
        let mut cf = Source::default();
        cf.failure([local.sha.clone()], "CurseForge 连接失败");
        let r = row(&local, &mr, &cf, "1.20.1", "fabric");
        assert_eq!(r["status"], "update");
        assert_eq!(r["partial"], true);
        assert_eq!(
            row(&local, &Source::default(), &cf, "1.20.1", "fabric")["status"],
            "error"
        );
    }
    #[test]
    fn duplicate_project_files_do_not_offer_automatic_replacement() {
        let mut rows = vec![
            json!({"file":"a.jar","status":"update","identities":{"modrinth":"same"}}),
            json!({"file":"b.jar","status":"current","identities":{"modrinth":"same"}}),
            json!({"file":"c.jar","status":"update","identities":{"curseforge":"same"}}),
        ];
        mark_duplicates(&mut rows);
        assert_eq!(rows[0]["status"], "unknown");
        assert_eq!(rows[1]["status"], "unknown");
        assert_eq!(rows[2]["status"], "update");
    }
    #[test]
    fn curseforge_uses_dates_and_hashes_instead_of_numeric_id_order() {
        let local = Local {
            name: "local.jar".into(),
            sha: "a".repeat(40),
            fingerprint: 0,
        };
        let old = json!({"id":"100","modId":42,"fileName":"old.jar","fileDate":"2024-01-01T00:00:00Z","displayName":"old","gameVersions":["1.20.1","Forge"],"hashes":[{"algo":1,"value":local.sha}]});
        let new = json!({"id":99,"modId":42,"fileName":"new.jar","fileDate":"2024-01-02T00:00:00Z","displayName":"new","gameVersions":["1.20.1","Forge"],"hashes":[{"algo":1,"value":"b".repeat(40)}]});
        let mut cf = Source::default();
        cf.known.insert(
            local.sha.clone(),
            Known {
                old,
                candidates: vec![new],
            },
        );
        let r = row(&local, &Source::default(), &cf, "1.20.1", "forge");
        assert_eq!(r["status"], "update");
        assert_eq!(r["currentId"], "100");
        assert_eq!(r["versionId"], "99");
    }
    #[test]
    fn secondary_binary_attachment_is_not_guessed_as_the_primary_mod() {
        let primary = "a".repeat(40);
        let other = "b".repeat(40);
        let v = json!({"files":[{"filename":"forge.jar","primary":true,"hashes":{"sha1":primary}},{"filename":"fabric.jar","hashes":{"sha1":other}}]});
        assert!(mr_identity(&v, &primary));
        assert!(!mr_identity(&v, &other));
    }
    #[test]
    fn completion_triggers_only_for_installed_mods_and_mod_dependencies() {
        let t = tempfile::tempdir().unwrap();
        let c = Core::new(t.path().into(), Arc::new(|_| {})).unwrap();
        let root = c.instance("a").unwrap();
        write_json(
            &root.join("kxl.json"),
            &json!({"version":"1.20.1","loader":"fabric","settings":{"isolation":"all"}}),
        )
        .unwrap();
        std::fs::create_dir_all(root.join("mods")).unwrap();
        let file = root.join("mods/a.jar");
        std::fs::write(&file, b"fixture").unwrap();
        assert_eq!(
            installed_target(
                &c,
                "install_project",
                &json!({"id":"a","kind":"mods"}),
                &json!({})
            )
            .as_deref(),
            Some("a")
        );
        assert!(installed_target(
            &c,
            "install_project",
            &json!({"id":"a","kind":"resourcepacks"}),
            &json!({})
        )
        .is_none());
        assert_eq!(
            installed_target(
                &c,
                "install_project",
                &json!({"id":"a","kind":"resourcepacks"}),
                &json!({"modsChanged":true})
            )
            .as_deref(),
            Some("a")
        );
        assert_eq!(
            installed_target(&c, "import_pack", &json!({}), &json!({"id":"a"})).as_deref(),
            Some("a")
        );
        assert_eq!(
            installed_target(
                &c,
                "download_resource_file",
                &json!({"id":"a","kind":"mods","path":file}),
                &json!({})
            )
            .as_deref(),
            Some("a")
        );
        assert!(installed_target(
            &c,
            "download_resource_file",
            &json!({"id":"a","kind":"mods","path":t.path().join("outside.jar")}),
            &json!({})
        )
        .is_none());
    }
    #[test]
    fn timestamps_compare_fractional_seconds_and_utc_consistently() {
        let a = v("a", "2024-01-01T00:00:00Z", "", "fabric");
        let b = v("b", "2024-01-01T00:00:00.100+00:00", "", "fabric");
        assert!(date_key(&a, "modrinth") < date_key(&b, "modrinth"));
        assert!(date_key(&json!({}), "modrinth").is_none());
    }
}
