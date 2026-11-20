use crate::{curseforge, engine, err, mod_check, resource_delete, resources, string, Core, Result};
use serde_json::{json, Map, Value};
use sha1::{Digest, Sha1};
use sha2::Sha256;
use std::{collections::{BTreeMap, BTreeSet}, fs, io::{Read, Write}, path::{Path, PathBuf}, time::Duration};

const MAX_FILE: u64 = 128 * 1024 * 1024;

struct Probe {
    name: String,
    sha: String,
    fingerprint: u32,
    receipt: PathBuf,
}

fn receipt(core: &Core, path: &Path) -> Option<PathBuf> {
    let meta = fs::symlink_metadata(path).ok()?;
    if !meta.is_file() || resource_delete::is_link(&meta) || meta.len() > MAX_FILE {
        return None;
    }
    let stamp = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_nanos();
    let key = Sha256::digest(format!("{}:{stamp}:{}", path.display(), meta.len()));
    Some(core.root.join("cache/resource-artwork").join(format!("{key:x}.json")))
}

fn allowed(url: &str) -> bool {
    reqwest::Url::parse(url).ok().is_some_and(|url| {
        url.scheme() == "https" && url.username().is_empty() && url.password().is_none()
            && url.port().is_none() && url.host_str().is_some_and(|host|
                host == "cdn.modrinth.com" || host == "forgecdn.net" || host.ends_with(".forgecdn.net"))
    })
}

fn remembered(path: &Path) -> Option<Option<String>> {
    let value = crate::read_json(path).ok()?;
    if let Some(url) = value.as_str().filter(|url| allowed(url)) {
        return Some(Some(url.to_owned()));
    }
    let age = path.metadata().ok()?.modified().ok()?.elapsed().ok()?;
    (value.is_null() && age < Duration::from_secs(20 * 60)).then_some(None)
}

pub(crate) fn cached(core: &Core, path: &Path) -> Option<String> {
    remembered(&receipt(core, path)?).flatten()
}

fn remember(path: &Path, url: Option<&String>) {
    let Some(parent) = path.parent() else { return };
    if fs::create_dir_all(parent).is_err() {
        return;
    }
    if let Ok(mut file) = tempfile::NamedTempFile::new_in(parent) {
        if serde_json::to_writer(&mut file, &url).is_ok() && file.flush().is_ok() {
            let _ = file.persist(path);
        }
    }
}

async fn modrinth_logos(core: &Core, probes: &[Probe]) -> Result<BTreeMap<String, String>> {
    let hashes: Vec<_> = probes.iter().map(|probe| probe.sha.as_str()).collect();
    let result = mod_check::mr_post(core, "version_files", &json!({"hashes":hashes,"algorithm":"sha1"})).await?;
    let hashes_by_project: BTreeMap<_, _> = probes.iter().filter_map(|probe| {
        let version = &result[&probe.sha];
        let id = version["project_id"].as_str()?;
        let verified = version["files"].as_array()?.iter()
            .any(|file| file["hashes"]["sha1"].as_str().is_some_and(|hash| hash.eq_ignore_ascii_case(&probe.sha)));
        (verified && id.bytes().all(|byte| byte.is_ascii_alphanumeric())).then_some((probe.sha.as_str(), id))
    }).collect();
    if hashes_by_project.is_empty() {
        return Ok(BTreeMap::new());
    }
    let ids: BTreeSet<_> = hashes_by_project.values().copied().collect();
    let mut url = reqwest::Url::parse("https://api.modrinth.com/v2/projects").map_err(err)?;
    url.query_pairs_mut().append_pair("ids", &json!(ids).to_string());
    let projects = core.get(url.as_str()).await?;
    let logos: BTreeMap<_, _> = projects.as_array().ok_or("Modrinth 图标响应无效")?.iter()
        .filter_map(|project| Some((project["id"].as_str()?, project["icon_url"].as_str().filter(|url| allowed(url))?)))
        .collect();
    Ok(hashes_by_project.into_iter().filter_map(|(hash, id)| {
        logos.get(id).map(|url| (hash.to_owned(), (*url).to_owned()))
    }).collect())
}

async fn curseforge_logos(core: &Core, probes: &[&Probe], key: Option<&str>) -> Result<BTreeMap<String, String>> {
    if probes.is_empty() {
        return Ok(BTreeMap::new());
    }
    let fingerprints: Vec<_> = probes.iter().map(|probe| probe.fingerprint).collect();
    let result = curseforge::post(core, "fingerprints/432", key, &json!({"fingerprints":fingerprints})).await?;
    let matches = result["data"]["exactMatches"].as_array().ok_or("CurseForge 图标匹配响应无效")?;
    let projects: BTreeMap<_, _> = probes.iter().filter_map(|probe| {
        let ids: BTreeSet<_> = matches.iter().filter_map(|matched| {
            let file = &matched["file"];
            (file["fileFingerprint"].as_u64() == Some(u64::from(probe.fingerprint))
                && curseforge::file_hash(file).eq_ignore_ascii_case(&probe.sha))
                .then(|| file["modId"].as_u64()).flatten()
        }).collect();
        if ids.len() != 1 { return None }
        Some((probe.sha.as_str(), *ids.first()?))
    }).collect();
    if projects.is_empty() {
        return Ok(BTreeMap::new());
    }
    let ids: BTreeSet<_> = projects.values().copied().collect();
    let result = curseforge::post(core, "mods", key, &json!({"modIds":ids})).await?;
    let logos: BTreeMap<_, _> = result["data"].as_array().ok_or("CurseForge 图标响应无效")?.iter().filter_map(|item| {
        let url = item["logo"]["thumbnailUrl"].as_str().or_else(|| item["logo"]["url"].as_str())?;
        Some((item["id"].as_u64()?, allowed(url).then_some(url)?))
    }).collect();
    Ok(projects.into_iter().filter_map(|(hash, id)| {
        logos.get(&id).map(|url| (hash.to_owned(), (*url).to_owned()))
    }).collect())
}

pub(crate) async fn lookup(core: &Core, payload: &Value) -> Result<Value> {
    let kind = string(payload, "kind")?;
    if !matches!(kind, "mods" | "resourcepacks" | "shaderpacks" | "datapacks") {
        return Ok(json!({}));
    }
    let folder = engine::resource_dir(core, payload)?;
    let names: BTreeSet<_> = payload["names"].as_array().into_iter().flatten().take(24)
        .filter_map(Value::as_str).filter(|name| resource_delete::valid_name(name))
        .map(str::to_owned).collect();
    let core_for_hashes = core.clone();
    let (probes, mut result) = tokio::task::spawn_blocking(move || {
        let mut result = Map::new();
        let probes: Vec<_> = names.into_iter().filter_map(|name| {
            let path = folder.join(&name);
            let receipt = receipt(&core_for_hashes, &path)?;
            if let Some(known) = remembered(&receipt) {
                if let Some(url) = known { result.insert(name, json!(url)); }
                return None;
            }
            let (sha, fingerprint) = resources::try_cached_resource(&core_for_hashes, &path, "mod-hashes", || {
                let mut bytes = Vec::new();
                fs::File::open(&path).map_err(err)?.take(MAX_FILE + 1).read_to_end(&mut bytes).map_err(err)?;
                if bytes.len() as u64 > MAX_FILE { return Err("文件过大".into()); }
                Ok((format!("{:x}", Sha1::digest(&bytes)), mod_check::fingerprint(&bytes)))
            }).ok()?;
            Some(Probe { name, sha, fingerprint, receipt })
        }).collect();
        (probes, result)
    }).await.map_err(err)?;
    if probes.is_empty() {
        return Ok(Value::Object(result));
    }
    let modrinth = modrinth_logos(core, &probes).await;
    let remaining: Vec<_> = probes.iter()
        .filter(|probe| !modrinth.as_ref().is_ok_and(|logos| logos.contains_key(&probe.sha))).collect();
    let key = curseforge::configured_key(core, payload["curseforgeKey"].as_str().unwrap_or(""));
    let curseforge = curseforge_logos(core, &remaining, key.as_deref()).await;
    let remote_ok = modrinth.is_ok() && curseforge.is_ok();
    let mut logos = modrinth.unwrap_or_default();
    logos.extend(curseforge.unwrap_or_default());
    for probe in probes {
        let url = logos.get(&probe.sha);
        if let Some(url) = url {
            result.insert(probe.name, json!(url));
        }
        if url.is_some() || remote_ok {
            remember(&probe.receipt, url);
        }
    }
    Ok(Value::Object(result))
}
