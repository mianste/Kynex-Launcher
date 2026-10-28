use crate::*;
use futures_util::{stream, StreamExt, TryStreamExt};
use sha1::{Digest, Sha1};
use std::{
    collections::BTreeMap,
    process::{Command, Stdio},
};
pub const MANIFEST: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const DEFAULT_SETTINGS: &str =
    r#"{"memory":4096,"java":"","width":1280,"height":720,"isolation":"all"}"#;
pub fn defaults() -> Value {
    serde_json::from_str(DEFAULT_SETTINGS).unwrap()
}
fn os() -> &'static str {
    match std::env::consts::OS {
        "macos" => "osx",
        x => x,
    }
}
pub fn allowed(v: &Value) -> bool {
    let Some(rules) = v["rules"].as_array() else {
        return true;
    };
    let mut allow = false;
    for r in rules {
        let mut hit = true;
        if let Some(n) = r["os"]["name"].as_str() {
            hit &= n == os();
        }
        if let Some(a) = r["os"]["arch"].as_str() {
            hit &= match a {
                "x86" => std::env::consts::ARCH == "x86",
                "x86_64" => std::env::consts::ARCH == "x86_64",
                x => x == std::env::consts::ARCH,
            };
        }
        if let Some(v) = r["os"]["version"].as_str() {
            let version = if cfg!(windows) {
                let mut command = Command::new("cmd");
                command.args(["/C", "ver"]).stdin(Stdio::null());
                hidden(&mut command)
                    .output()
                    .ok()
                    .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
                    .unwrap_or_default()
            } else {
                String::new()
            };
            hit &= regex::Regex::new(v)
                .map(|x| x.is_match(&version))
                .unwrap_or(false);
        }
        if let Some(features) = r["features"].as_object() {
            for (_, v) in features {
                hit &= v == false;
            }
        }
        if hit {
            allow = r["action"] == "allow";
        }
    }
    allow
}
fn lib_path(name: &str) -> Result<String> {
    let (name, ext) = name.split_once('@').unwrap_or((name, "jar"));
    let v: Vec<_> = name.split(':').collect();
    if v.len() < 3 || v.len() > 4 {
        return Err("Maven 坐标无效".into());
    }
    for p in &v {
        safe_name(p)?;
    }
    Ok(format!(
        "{}/{}/{}/{}-{}{}.{}",
        v[0].replace('.', "/"),
        v[1],
        v[2],
        v[1],
        v[2],
        v.get(3).map(|c| format!("-{c}")).unwrap_or_default(),
        ext
    ))
}
fn under(base: &Path, path: &str) -> Result<PathBuf> {
    let p = Path::new(path);
    if p.is_absolute()
        || p.components()
            .any(|c| !matches!(c, std::path::Component::Normal(_)))
    {
        return Err("资源路径不安全".into());
    }
    Ok(base.join(p))
}
#[derive(Clone)]
struct FileTask {
    url: String,
    path: PathBuf,
    hash: String,
}
async fn wait_download<T>(
    core: &Core,
    future: impl std::future::Future<Output = Result<T>>,
) -> Result<T> {
    tokio::pin!(future);
    let mut check = tokio::time::interval(std::time::Duration::from_millis(100));
    loop {
        tokio::select! { value = &mut future => return value, _ = check.tick() => core.stopped()?, }
    }
}
pub async fn download(core: &Core, url: &str, path: &Path, hash: &str) -> Result<()> {
    https(url)?;
    core.stopped()?;
    let check = |bytes: &[u8]| -> bool {
        hash.is_empty()
            || if hash.len() == 64 {
                use sha2::Sha256;
                format!("{:x}", Sha256::digest(bytes)) == hash.to_lowercase()
            } else {
                format!("{:x}", Sha1::digest(bytes)) == hash.to_lowercase()
            }
    };
    if path.exists() && !hash.is_empty() {
        let data = tokio::fs::read(path).await.map_err(err)?;
        if check(&data) {
            return Ok(());
        }
    }
    if let Some(p) = path.parent() {
        tokio::fs::create_dir_all(p).await.map_err(err)?;
    }
    let mut last = String::new();
    let source = core.download_source.read().map_err(err)?.clone();
    let candidates = crate::mirrors::active_candidates(core, url, &source);
    let client_progress = path.file_name().and_then(|v| v.to_str()) == Some("client.jar");
    for attempt in 0..3 {
        core.stopped()?;
        let actual_url = &candidates[attempt.min(candidates.len() - 1)];
        let outcome = async {
            let mut request = core.http.get(actual_url);
            if actual_url.contains("forgecdn.net") {
                if let Some(key) = crate::curseforge::configured_key(core, "") {
                    request = request.header("x-api-key", key);
                }
            }
            if client_progress { (core.progress)(json!({"stage":"连接游戏客户端下载源","done":0,"total":1,"detail":format!("第 {} 次尝试",attempt+1)})); }
            let response = wait_download(core, async {
                tokio::time::timeout(std::time::Duration::from_secs(8), request.send())
                    .await
                    .map_err(|_| "下载源连接超时，正在切换备用源".to_string())?
                    .map_err(err)?
                    .error_for_status()
                    .map_err(err)
            }).await?;
            let expected = response.content_length().unwrap_or(0) as usize;
            let mut response = response.bytes_stream();
            let mut received = 0usize;
            let mut update = std::time::Instant::now() - std::time::Duration::from_secs(1);
            let tmp = path.with_extension(format!("part-{}", uuid::Uuid::new_v4()));
            let mut file = tokio::fs::File::create(&tmp).await.map_err(err)?;
            let mut sha1 = Sha1::new();
            let mut sha256 = sha2::Sha256::new();
            let result: Result<()> = async {
                use tokio::io::AsyncWriteExt;
                loop {
                    core.stopped()?;
                    let Some(b) = wait_download(core, async {
                        tokio::time::timeout(std::time::Duration::from_secs(10), response.next())
                            .await
                            .map_err(|_| "下载长时间没有数据，正在切换备用源".to_string())
                    }).await?
                    else {
                        break;
                    };
                    let b = b.map_err(err)?;
                    received += b.len();
                    sha1.update(&b);
                    sha256.update(&b);
                    file.write_all(&b).await.map_err(err)?;
                    if client_progress && update.elapsed() >= std::time::Duration::from_millis(150) {
                        let detail = if expected > 0 {format!("{:.1} / {:.1} MB",received as f64/1048576.,expected as f64/1048576.)} else {format!("已下载 {:.1} MB",received as f64/1048576.)};
                        (core.progress)(json!({"stage":"下载游戏客户端","done":if expected>0{received.min(expected.saturating_sub(1))}else{0},"total":expected.max(1),"detail":detail})); update=std::time::Instant::now();
                    }
                }
                file.flush().await.map_err(err)?;
                drop(file);
                if !hash.is_empty() {
                    let digest = if hash.len() == 64 {
                        format!("{:x}", sha256.finalize())
                    } else {
                        format!("{:x}", sha1.finalize())
                    };
                    if digest != hash.to_lowercase() {
                        return Err("文件哈希校验失败".into());
                    }
                }
                tokio::fs::rename(&tmp, path).await.map_err(err)?;
                Ok(())
            }
            .await;
            if result.is_err() {
                let _ = tokio::fs::remove_file(&tmp).await;
            }
            result
        }
        .await;
        match outcome {
            Ok(()) => return Ok(()),
            Err(e) => {
                if actual_url.as_str() != url {
                    crate::mirrors::mark_failed(core);
                }
                last = e;
            }
        }
    }
    Err(last)
}
async fn tasks(core: &Core, files: Vec<FileTask>, stage: &str, concurrency: usize) -> Result<()> {
    let total = files.len();
    let count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    stream::iter(files.into_iter().map(|f| {
        let n = count.clone();
        async move {
            download(core, &f.url, &f.path, &f.hash).await?;
            let done = n.fetch_add(1, Ordering::Relaxed) + 1;
            core.stage(stage, done, total);
            Ok::<_, String>(())
        }
    }))
    .buffer_unordered(concurrency)
    .try_collect::<Vec<_>>()
    .await?;
    Ok(())
}
pub async fn loaders(core: &Core, game: &str, loader: &str) -> Result<Value> {
    safe_name(game)?;
    match loader {
        "vanilla" => Ok(json!([])),
        "fabric" | "quilt" => {
            let host = if loader == "fabric" {
                "meta.fabricmc.net"
            } else {
                "meta.quiltmc.org"
            };
            let v = core
                .get(&format!(
                    "https://{host}/v{}/versions/loader/{game}",
                    if loader == "fabric" { 2 } else { 3 }
                ))
                .await?;
            Ok(json!(v
                .as_array()
                .ok_or("加载器列表无效")?
                .iter()
                .filter_map(|x| x["loader"]["version"].as_str())
                .collect::<Vec<_>>()))
        }
        "forge" => {
            let v = core
                .get(&format!(
                    "https://bmclapi2.bangbang93.com/forge/minecraft/{game}"
                ))
                .await?;
            Ok(json!(v
                .as_array()
                .ok_or("Forge 列表无效")?
                .iter()
                .filter_map(|x| x["version"].as_str())
                .rev()
                .collect::<Vec<_>>()))
        }
        "neoforge" => {
            let response=core.http.get("https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml").send().await.map_err(err)?.error_for_status().map_err(err)?.text().await.map_err(err)?;
            let parts: Vec<_> = game.split('.').collect();
            let prefix = if parts.len() >= 3 {
                format!("{}.{}.", parts[1], parts[2])
            } else {
                String::new()
            };
            let re = regex::Regex::new(r"<version>([^<]+)</version>").unwrap();
            let mut out: Vec<_> = re
                .captures_iter(&response)
                .map(|c| c[1].to_string())
                .filter(|v| !prefix.is_empty() && v.starts_with(&prefix))
                .collect();
            out.reverse();
            Ok(json!(out))
        }
        "optifine" => {
            let rows = crate::optifine::releases(core, game).await?;
            Ok(json!(rows
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|r| r["value"].as_str())
                .collect::<Vec<_>>()))
        }
        _ => Err("未知的加载器".into()),
    }
}
async fn metadata(core: &Core, id: &str) -> Result<Value> {
    crate::metadata::version(core, id).await
}
pub(crate) async fn run_installer(
    core: &Core,
    command: &mut tokio::process::Command,
    label: &str,
) -> Result<()> {
    command.kill_on_drop(true);
    let output = wait_download(core, async {
        tokio::time::timeout(
            std::time::Duration::from_secs(600),
            hidden_async(command).output(),
        )
        .await
        .map_err(|_| "安装器执行超时，可取消后重试".to_string())?
        .map_err(err)
    })
    .await?;
    if !output.status.success() {
        return Err(format!(
            "{label}失败：{}",
            String::from_utf8_lossy(&output.stderr)
                .chars()
                .take(1600)
                .collect::<String>()
        ));
    }
    Ok(())
}
fn reusable_loader(
    core: &Core,
    installer: &Path,
    game: &str,
    loader: &str,
    lv: &str,
) -> Option<Value> {
    use std::io::Read;
    let mut archive = zip::ZipArchive::new(std::fs::File::open(installer).ok()?).ok()?;
    let mut content = String::new();
    archive
        .by_name("install_profile.json")
        .ok()?
        .read_to_string(&mut content)
        .ok()?;
    let profile: Value = serde_json::from_str(&content).ok()?;
    // Modern installers declare hashes for generated client artifacts. A version JSON alone
    // is insufficient: Forge writes it before its processors finish.
    for field in ["PATCHED", "MC_EXTRA"] {
        let coordinate = profile["data"][field]["client"]
            .as_str()?
            .strip_prefix('[')?
            .strip_suffix(']')?;
        let key = format!("{field}_SHA");
        let hash = profile["data"][&key]["client"].as_str()?.trim_matches('\'');
        if hash.len() != 40 {
            return None;
        }
        let bytes =
            std::fs::read(under(&core.root.join("libraries"), &lib_path(coordinate).ok()?).ok()?)
                .ok()?;
        if format!("{:x}", Sha1::digest(&bytes)) != hash {
            return None;
        }
    }
    for entry in std::fs::read_dir(core.root.join("versions"))
        .ok()?
        .flatten()
    {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.contains(loader) && name.contains(lv) {
            if let Ok(value) = read_json(&entry.path().join(format!("{name}.json"))) {
                if value["inheritsFrom"] == game {
                    return Some(value);
                }
            }
        }
    }
    None
}
pub async fn install(core: &Core, p: &Value) -> Result<Value> {
    let name = string(p, "name")?;
    safe_name(name)?;
    let game = string(p, "version")?;
    safe_name(game)?;
    let loader = p["loader"].as_str().unwrap_or("vanilla");
    let id = uuid::Uuid::new_v4().to_string();
    let dir = core.instance(&id)?;
    if core
        .instances()?
        .as_array()
        .unwrap()
        .iter()
        .any(|v| v["name"] == name)
    {
        return Err("实例名已存在".into());
    }
    let addon = p["optifineVersion"].as_str().filter(|v| !v.is_empty());
    if addon.is_some() && loader != "forge" {
        return Err("OptiFine 附加安装仅适用于 Forge；其他加载器请分别安装".into());
    }
    let optifine = if loader == "optifine" || addon.is_some() {
        Some(
            crate::optifine::selected(
                core,
                game,
                addon.unwrap_or(p["loaderVersion"].as_str().unwrap_or("")),
                (loader == "forge").then(|| p["loaderVersion"].as_str().unwrap_or("")),
            )
            .await?,
        )
    } else {
        None
    };
    let result = async {
        core.stage("获取版本索引", 0, 2);
        let base = metadata(core, game).await?;
        std::fs::create_dir_all(&dir).map_err(err)?;
        let settings = p.get("settings").filter(|v|v.is_object()).cloned().unwrap_or_else(defaults);
        let mut version = base.clone();
        match loader {
            "vanilla" | "optifine" => {},
            "fabric" | "quilt" => {
                let lv=string(p,"loaderVersion")?; safe_name(lv)?;
                let host=if loader=="fabric" {"meta.fabricmc.net"} else {"meta.quiltmc.org"};
                let overlay=core.get(&format!("https://{host}/v{}/versions/loader/{game}/{lv}/profile/json",if loader=="fabric"{2}else{3})).await?;
                version=merge(base.clone(),overlay);
            },
            "forge" | "neoforge" => {
                let lv=string(p,"loaderVersion")?;safe_name(lv)?;
                // The official installer requires a complete vanilla version in this game root.
                prepare(core,&dir,&base).await?;
                let vanilla_dir=core.root.join("versions").join(game);
                std::fs::create_dir_all(&vanilla_dir).map_err(err)?;
                write_json(&vanilla_dir.join(format!("{game}.json")),&base)?;
                let vanilla_jar=vanilla_dir.join(format!("{game}.jar"));
                if !vanilla_jar.exists() { std::fs::copy(dir.join("client.jar"),&vanilla_jar).map_err(err)?; }
                let coordinate=if loader=="forge"{format!("{game}-{lv}")}else{lv.into()};
                let url=if loader=="forge"{format!("https://maven.minecraftforge.net/net/minecraftforge/forge/{coordinate}/forge-{coordinate}-installer.jar")}else{format!("https://maven.neoforged.net/releases/net/neoforged/neoforge/{lv}/neoforge-{lv}-installer.jar")};
                let installer=core.root.join("cache").join(format!("{loader}-{coordinate}.jar"));
                core.stage("下载官方加载器安装器",0,1);
                download(core,&url,&installer,"").await?;
                let cached=reusable_loader(core,&installer,game,loader,lv);
                if let Some(cached)=cached {
                    core.stage("复用已校验的加载器",1,1);
                    version=merge(base.clone(),cached);
                } else {
                let java=ensure_java(core,&base,&settings).await?;
                let profiles=core.root.join("launcher_profiles.json");
                if !profiles.exists(){write_json(&profiles,&json!({"profiles":{}}))?;}
                core.stage("执行加载器安装器",0,1);
                let mut command=tokio::process::Command::new(java);
                command.arg("-jar").arg(&installer).arg("--installClient").arg(&core.root);
                run_installer(core,&mut command,"加载器安装").await?;
                let mut found=None;
                for entry in std::fs::read_dir(core.root.join("versions")).map_err(err)?.flatten(){
                    let n=entry.file_name().to_string_lossy().to_string();
                    if (n.contains(loader)||n.contains("neoforge")) && n.contains(lv) {
                        if let Ok(v)=read_json(&entry.path().join(format!("{n}.json"))){found=Some(v);}
                    }
                }
                version=merge(base.clone(),found.ok_or("安装器没有生成版本配置")?);
                }
            },
            _ => return Err("未知的加载器".into()),
        }
        version["downloads"]["client"]=base["downloads"]["client"].clone();
        prepare(core,&dir,&version).await?;
        if let Some(release)=&optifine {
            let java=ensure_java(core,&base,&settings).await?;
            let addon_dir = if loader=="forge" && settings["isolation"]=="shared" {core.root.join("shared")}else{dir.clone()};
            crate::optifine::install(core,game,release,loader=="forge",&java,&addon_dir,&mut version).await?;
            if loader=="optifine" {prepare(core,&dir,&version).await?;}
        }
        write_json(&dir.join("version.json"),&version)?;
        let instance=json!({"id":id,"name":name,"version":game,"loader":loader,"loaderVersion":p["loaderVersion"],
            "optifineVersion":optifine.as_ref().map(|r|r.value.clone()),"game":"java","path":dir,"settings":settings});
        write_json(&dir.join("kxl.json"),&instance)?;
        for sub in ["mods","resourcepacks","saves","shaderpacks","datapacks"] {std::fs::create_dir_all(dir.join(sub)).map_err(err)?;}
        Ok(instance)
    }.await;
    if result.is_ok() && matches!(loader, "fabric" | "quilt") {
        let (project, label) = if loader == "fabric" {
            ("fabric-api", "Fabric API")
        } else {
            ("qsl", "Quilt Standard Libraries")
        };
        core.stage(&format!("安装 {label}"), 0, 1);
        if let Err(error) =
            install_project(core, &json!({"id":id,"kind":"mods","project":project})).await
        {
            return Err(format!(
                  "加载器已安装，但自动补齐 {label} 失败：{error}。实例已保留，进入 Mod 页面会自动重试"
              ));
        }
    }
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&dir);
    }
    result
}
pub fn merge(mut base: Value, overlay: Value) -> Value {
    if let Some(m) = overlay.as_object() {
        for (k, v) in m {
            if k == "libraries" {
                let a = base[k].as_array().cloned().unwrap_or_default();
                let mut libs: BTreeMap<String, Value> = BTreeMap::new();
                for lib in a
                    .into_iter()
                    .chain(v.as_array().cloned().unwrap_or_default())
                {
                    let coordinate = lib["name"].as_str().unwrap_or("");
                    let parts: Vec<_> = coordinate.split(':').collect();
                    let key = if parts.len() > 3 {
                        format!("{}:{}:{}", parts[0], parts[1], parts[3])
                    } else {
                        parts.iter().take(2).copied().collect::<Vec<_>>().join(":")
                    };
                    libs.insert(key, lib);
                }
                base[k] = json!(libs.into_values().collect::<Vec<_>>());
            } else if k == "arguments" {
                for key in ["game", "jvm"] {
                    let mut a = base[k][key].as_array().cloned().unwrap_or_default();
                    a.extend(v[key].as_array().cloned().unwrap_or_default());
                    base[k][key] = json!(a);
                }
            } else {
                base[k] = v.clone();
            }
        }
    }
    base
}
async fn prepare(core: &Core, dir: &Path, version: &Value) -> Result<()> {
    let client = &version["downloads"]["client"];
    core.stage("准备游戏客户端", 0, 1);
    let hash = client["sha1"].as_str().unwrap_or("");
    let client_path = dir.join("client.jar");
    let cache = if hash.len() == 40 && hash.bytes().all(|c| c.is_ascii_hexdigit()) {
        core.root
            .join("cache/game-clients")
            .join(hash)
            .join("client.jar")
    } else {
        client_path.clone()
    };
    download(core, string(client, "url")?, &cache, hash).await?;
    if cache != client_path {
        let valid = tokio::fs::read(&client_path)
            .await
            .ok()
            .is_some_and(|bytes| format!("{:x}", Sha1::digest(&bytes)) == hash);
        if !valid {
            if !client_path.exists() && tokio::fs::hard_link(&cache, &client_path).await.is_ok() {
            } else {
                tokio::fs::copy(&cache, &client_path).await.map_err(err)?;
            }
        }
    }
    let mut files = vec![];
    for lib in version["libraries"]
        .as_array()
        .ok_or("版本没有依赖库清单")?
    {
        if !allowed(lib) {
            continue;
        }
        if let Some(a) = lib["downloads"]["artifact"].as_object() {
            let a = json!(a);
            files.push(FileTask {
                url: string(&a, "url")?.into(),
                path: under(&core.root.join("libraries"), string(&a, "path")?)?,
                hash: a["sha1"].as_str().unwrap_or("").into(),
            });
        } else if let Some(name) = lib["name"].as_str() {
            let path = lib_path(name)?;
            files.push(FileTask {
                url: format!(
                    "{}{}",
                    lib["url"]
                        .as_str()
                        .unwrap_or("https://libraries.minecraft.net/"),
                    path
                ),
                path: under(&core.root.join("libraries"), &path)?,
                hash: String::new(),
            });
        }
        if let Some(n) = lib["natives"][os()].as_str() {
            let n = n.replace(
                "${arch}",
                if cfg!(target_pointer_width = "64") {
                    "64"
                } else {
                    "32"
                },
            );
            let a = &lib["downloads"]["classifiers"][&n];
            if a.is_object() {
                files.push(FileTask {
                    url: string(a, "url")?.into(),
                    path: under(&core.root.join("libraries"), string(a, "path")?)?,
                    hash: a["sha1"].as_str().unwrap_or("").into(),
                });
            }
        }
    }
    tasks(core, files, "校验与下载依赖库", 12).await?;
    if version["assetIndex"].is_object() {
        let a = &version["assetIndex"];
        let id = string(a, "id")?;
        safe_name(id)?;
        let path = core.root.join("assets/indexes").join(format!("{id}.json"));
        download(
            core,
            string(a, "url")?,
            &path,
            a["sha1"].as_str().unwrap_or(""),
        )
        .await?;
        let index = read_json(&path)?;
        let mut files = vec![];
        for v in index["objects"].as_object().ok_or("资源索引无效")?.values() {
            let hash = string(v, "hash")?;
            if hash.len() != 40 || !hash.bytes().all(|c| c.is_ascii_hexdigit()) {
                return Err("资源 SHA1 无效".into());
            }
            files.push(FileTask {
                url: format!(
                    "https://resources.download.minecraft.net/{}/{}",
                    &hash[..2],
                    hash
                ),
                path: core.root.join("assets/objects").join(&hash[..2]).join(hash),
                hash: hash.into(),
            });
        }
        tasks(core, files, "校验与下载游戏资源", 24).await?;
        if index["virtual"] == true || index["map_to_resources"] == true {
            let mapped = if index["map_to_resources"] == true {
                dir.join("resources")
            } else {
                core.root.join("assets/virtual").join(id)
            };
            for (name, object) in index["objects"].as_object().ok_or("资源映射无效")? {
                let hash = string(object, "hash")?;
                let source = core.root.join("assets/objects").join(&hash[..2]).join(hash);
                let target = under(&mapped, name)?;
                if !target.exists() {
                    if let Some(parent) = target.parent() {
                        std::fs::create_dir_all(parent).map_err(err)?;
                    }
                    std::fs::copy(source, target).map_err(err)?;
                }
            }
        }
    }
    Ok(())
}
/// 快速检查客户端、依赖库和全部资源对象是否存在，避免每次启动都对
/// 数千个资源文件重新计算 SHA-1。缺失时再走完整 prepare。
fn assets_ready(core: &Core, dir: &Path, version: &Value) -> bool {
    if !dir.join("client.jar").is_file() {
        return false;
    }
    let Some(libraries) = version["libraries"].as_array() else {
        return false;
    };
    for lib in libraries {
        if !allowed(lib) {
            continue;
        }
        if let Some(artifact) = lib["downloads"]["artifact"].as_object() {
            let Some(path) = artifact.get("path").and_then(Value::as_str) else {
                return false;
            };
            let Ok(path) = under(&core.root.join("libraries"), path) else {
                return false;
            };
            if !path.is_file() {
                return false;
            }
        } else if let Some(name) = lib["name"].as_str() {
            let Ok(path) = lib_path(name) else {
                return false;
            };
            if !under(&core.root.join("libraries"), &path)
                .map(|path| path.is_file())
                .unwrap_or(false)
            {
                return false;
            }
        }
    }
    let index_id = version["assetIndex"]["id"].as_str().unwrap_or("");
    if index_id.is_empty() {
        return true;
    }
    let index_path = core
        .root
        .join("assets/indexes")
        .join(format!("{index_id}.json"));
    let Ok(index) = read_json(&index_path) else {
        return false;
    };
    if index["virtual"] == true || index["map_to_resources"] == true {
        return false;
    }
    let Some(objects) = index["objects"].as_object() else {
        return false;
    };
    for object in objects.values() {
        let Some(hash) = object["hash"].as_str() else {
            return false;
        };
        if hash.len() < 3
            || !core
                .root
                .join("assets/objects")
                .join(&hash[..2])
                .join(hash)
                .is_file()
        {
            return false;
        }
    }
    true
}
fn java_paths() -> Vec<String> {
    let mut out = vec![];
    if let Ok(home) = std::env::var("JAVA_HOME") {
        out.push(
            Path::new(&home)
                .join("bin")
                .join(if cfg!(windows) { "java.exe" } else { "java" })
                .to_string_lossy()
                .to_string(),
        );
    }
    out.push("java".into());
    let dirs = if cfg!(windows) {
        vec![
            "C:\\Program Files\\Java",
            "C:\\Program Files\\Eclipse Adoptium",
            "C:\\Program Files\\Microsoft",
        ]
    } else {
        vec!["/usr/lib/jvm", "/Library/Java/JavaVirtualMachines"]
    };
    for d in dirs {
        if let Ok(entries) = std::fs::read_dir(d) {
            for e in entries.flatten() {
                for sub in ["bin/java", "bin/java.exe", "Contents/Home/bin/java"] {
                    let p = e.path().join(sub);
                    if p.exists() {
                        out.push(p.to_string_lossy().to_string());
                    }
                }
            }
        }
    }
    out.sort();
    out.dedup();
    out
}
fn java_version(path: &str) -> Option<(u64, String)> {
    let mut command = Command::new(path);
    command.arg("-version").stdin(Stdio::null());
    let o = hidden(&mut command).output().ok()?;
    let text = String::from_utf8_lossy(&o.stderr).to_string() + &String::from_utf8_lossy(&o.stdout);
    let re = regex::Regex::new(r#"version "(\d+)(?:\.(\d+))?"#).ok()?;
    let c = re.captures(&text)?;
    let n = c[1].parse::<u64>().ok()?;
    Some((
        if n == 1 {
            c.get(2)?.as_str().parse().ok()?
        } else {
            n
        },
        text.lines().next().unwrap_or("").to_string(),
    ))
}
pub fn java_list() -> Result<Value> {
    Ok(json!(java_paths()
        .into_iter()
        .filter_map(|path| java_version(&path)
            .map(|(major, version)| json!({"path":path,"major":major,"version":version})))
        .collect::<Vec<_>>()))
}
pub fn java_list_at(core: &Core) -> Result<Value> {
    let mut list = java_list()?.as_array().cloned().unwrap_or_default();
    let root = core.root.join("runtimes");
    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten() {
            for path in runtime_java_paths(&entry.path()) {
                if let Some((major, version)) = java_version(&path.to_string_lossy()) {
                    list.push(json!({"path":path,"major":major,"version":version}));
                }
            }
        }
    }
    Ok(json!(list))
}
fn runtime_java_paths(root: &Path) -> Vec<PathBuf> {
    let mut paths = vec![];
    for candidate in [root.join("bin/java.exe"), root.join("bin/java")] {
        if candidate.is_file() {
            paths.push(candidate);
        }
    }
    if let Ok(entries) = std::fs::read_dir(root) {
        for e in entries.flatten().filter(|e| e.path().is_dir()) {
            for name in ["bin/java.exe", "bin/java"] {
                let p = e.path().join(name);
                if p.is_file() {
                    paths.push(p);
                }
            }
        }
    }
    paths
}
pub async fn install_java(core: &Core, major: u64) -> Result<Value> {
    if !cfg!(windows) {
        return Err("内置 Java 下载面向 Windows，请通过 Adoptium 官网安装对应系统版本".into());
    }
    if ![8, 17, 21, 25].contains(&major) {
        return Err("请选择受支持的 Java 版本".into());
    }
    let destination = core.root.join("runtimes").join(format!("temurin-{major}"));
    if let Some(p) = runtime_java_paths(&destination).first() {
        return Ok(json!({"path":p}));
    }
    core.stage("读取 Java 运行时清单", 0, 1);
    let (link, hash) = java_package(core, major).await?;
    let archive = core.root.join("cache").join(format!("temurin-{major}.zip"));
    download(core, &link, &archive, &hash).await?;
    core.stopped()?;
    let staging = core
        .root
        .join("runtimes")
        .join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&staging).map_err(err)?;
    core.stage("解压 Java 运行时", 0, 1);
    let result = (|| {
        let mut z =
            zip::ZipArchive::new(std::fs::File::open(&archive).map_err(err)?).map_err(err)?;
        crate::packs::safe_extract(&mut z, &staging, None)?;
        if runtime_java_paths(&staging).is_empty() {
            return Err("运行时包不包含 Java".into());
        }
        std::fs::rename(&staging, &destination).map_err(err)?;
        let path = runtime_java_paths(&destination)
            .into_iter()
            .next()
            .ok_or("找不到 Java")?;
        Ok(json!({"path":path}))
    })();
    if result.is_err() {
        let _ = std::fs::remove_dir_all(staging);
    }
    result
}
async fn java_package(core: &Core, major: u64) -> Result<(String, String)> {
    // 国内优先使用清华 Adoptium 镜像，避免 api.adoptium.net / GitHub 长时间卡住。
    let mirror = format!("https://mirrors.tuna.tsinghua.edu.cn/Adoptium/{major}/jre/x64/windows/");
    if let Ok(response) = core
        .http
        .get(&mirror)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
    {
        if response.status().is_success() {
            if let Ok(text) = response.text().await {
                if let Ok(re) = regex::Regex::new(r#"href="([^"]+\.zip)""#) {
                    if let Some(name) = re
                        .captures(&text)
                        .and_then(|captures| captures.get(1))
                        .map(|value| value.as_str().to_string())
                    {
                        core.stage("从清华镜像下载 Java", 0, 1);
                        return Ok((format!("{mirror}{name}"), String::new()));
                    }
                }
            }
        }
    }
    core.stage("读取 Adoptium 运行时清单", 0, 1);
    let api = format!(
        "https://api.adoptium.net/v3/assets/latest/{major}/hotspot?architecture=x64&image_type=jre&os=windows&vendor=eclipse"
    );
    let data: Value = core
        .http
        .get(&api)
        .timeout(std::time::Duration::from_secs(12))
        .send()
        .await
        .map_err(|error| format!("无法连接 Adoptium 或清华镜像：{error}"))?
        .error_for_status()
        .map_err(|error| format!("Adoptium 清单请求失败：{error}"))?
        .json()
        .await
        .map_err(err)?;
    let package = &data
        .as_array()
        .and_then(|items| items.first())
        .ok_or("没有找到 Java 运行时")?["binary"]["package"];
    let hash = package["checksum"].as_str().unwrap_or("").to_string();
    if hash.len() != 64 {
        return Err("Java 清单缺少 SHA-256".into());
    }
    Ok((string(package, "link")?.to_string(), hash))
}
fn choose_java(core: &Core, version: &Value, settings: &Value) -> Result<String> {
    let required = version["javaVersion"]["majorVersion"].as_u64().unwrap_or(8);
    let custom = settings["java"].as_str().unwrap_or("");
    if !custom.is_empty() {
        let (major, _) = java_version(custom).ok_or("指定的 Java 无法执行")?;
        if major < required {
            return Err(format!("此版本至少需要 Java {required}"));
        }
        return Ok(custom.into());
    }
    let list = java_list_at(core)?;
    let candidates = list.as_array().unwrap();
    let chosen = candidates
        .iter()
        .filter(|v| v["major"].as_u64().unwrap_or(0) >= required)
        .min_by_key(|v| v["major"].as_u64().unwrap_or(999));
    chosen
        .and_then(|v| v["path"].as_str())
        .map(str::to_string)
        .ok_or_else(|| format!("没有找到 Java {required}，请在设置中指定 Java 路径"))
}
fn downloadable_java(required: u64) -> Option<u64> {
    [8, 17, 21, 25].into_iter().find(|major| *major >= required)
}
async fn ensure_java(core: &Core, version: &Value, settings: &Value) -> Result<String> {
    match choose_java(core, version, settings) {
        Ok(path) => Ok(path),
        Err(error) if error.contains("没有找到 Java") => {
            let required = version["javaVersion"]["majorVersion"].as_u64().unwrap_or(8);
            let major = downloadable_java(required).ok_or_else(|| {
                format!("此版本需要 Java {required}，自动下载仅覆盖 Java 8 / 17 / 21 / 25，请在设置中指定 Java 路径")
            })?;
            core.stage(&format!("自动下载 Java {major}"), 0, 1);
            let runtime = install_java(core, major)
                .await
                .map_err(|e| format!("自动下载 Java {major} 失败：{e}"))?;
            let path = runtime["path"]
                .as_str()
                .ok_or("Java 安装结果缺少可执行文件")?
                .to_string();
            let (installed, _) =
                java_version(&path).ok_or("自动下载的 Java 无法执行，请检查运行库")?;
            if installed < required {
                return Err(format!(
                    "自动下载的 Java {installed} 低于此版本要求的 Java {required}"
                ));
            }
            Ok(path)
        }
        Err(error) => Err(error),
    }
}
fn argument_list(v: &Value, vars: &BTreeMap<String, String>) -> Vec<String> {
    let mut out = vec![];
    if let Some(items) = v.as_array() {
        for item in items {
            if let Some(s) = item.as_str() {
                out.push(substitute(s, vars));
            } else if allowed(item) {
                if let Some(s) = item["value"].as_str() {
                    out.push(substitute(s, vars));
                } else if let Some(a) = item["value"].as_array() {
                    for s in a.iter().filter_map(Value::as_str) {
                        out.push(substitute(s, vars));
                    }
                }
            }
        }
    }
    out
}
pub fn substitute(s: &str, vars: &BTreeMap<String, String>) -> String {
    let mut out = s.to_string();
    for (k, v) in vars {
        out = out.replace(&format!("${{{k}}}"), v);
    }
    out
}
pub async fn launch(core: &Core, p: &Value) -> Result<Value> {
    core.stage("检查账号与 Java", 0, 4);
    let id = string(p, "id")?;
    let dir = core.instance(id)?;
    let mut instance = read_json(&dir.join("kxl.json"))?;
    let version = read_json(&dir.join("version.json"))?;
    let settings = instance
        .get("settings")
        .filter(|v| v.is_object())
        .unwrap_or(&p["settings"]);
    let java = ensure_java(core, &version, settings).await?;
    let auth = auth::session(
        core,
        string(p, "accountId")?,
        p["settings"]["clientId"].as_str().unwrap_or(""),
    )
    .await?;
    core.stage("检查游戏文件", 1, 4);
    if !assets_ready(core, &dir, &version) {
        core.stage("校验与下载游戏资源", 1, 4);
        prepare(core, &dir, &version).await?;
    } else {
        core.stage("游戏文件已就绪", 1, 4);
    }
    core.stopped()?;
    let native = dir.join("natives");
    std::fs::create_dir_all(&native).map_err(err)?;
    let mut cp = vec![];
    for lib in version["libraries"].as_array().ok_or("缺少依赖库")? {
        if !allowed(lib) {
            continue;
        }
        let name = string(lib, "name")?;
        let path = lib["downloads"]["artifact"]["path"]
            .as_str()
            .map(str::to_string)
            .unwrap_or(lib_path(name)?);
        let path = under(&core.root.join("libraries"), &path)?;
        if path.exists() {
            cp.push(path.to_string_lossy().to_string());
            if name.contains("natives-") {
                extract_natives(&path, &native)?;
            }
        }
        if let Some(n) = lib["natives"][os()].as_str() {
            let n = n.replace(
                "${arch}",
                if cfg!(target_pointer_width = "64") {
                    "64"
                } else {
                    "32"
                },
            );
            if let Some(path) = lib["downloads"]["classifiers"][&n]["path"].as_str() {
                extract_natives(&under(&core.root.join("libraries"), path)?, &native)?;
            }
        }
    }
    cp.push(dir.join("client.jar").to_string_lossy().to_string());
    let sep = if cfg!(windows) { ";" } else { ":" };
    let gamedir = if settings["isolation"] == "shared"
        || (settings["isolation"] == "modded" && instance["loader"] == "vanilla")
    {
        core.root.join("shared")
    } else {
        dir.clone()
    };
    std::fs::create_dir_all(&gamedir).map_err(err)?;
    let mut vars = BTreeMap::new();
    for (k, v) in [
        ("auth_player_name", auth.name.clone()),
        ("auth_uuid", auth.uuid.clone()),
        ("auth_access_token", auth.token.clone()),
        ("user_type", auth.kind.clone()),
        ("version_name", string(&instance, "version")?.into()),
        ("version_type", "release".into()),
        ("game_directory", gamedir.to_string_lossy().to_string()),
        (
            "assets_root",
            core.root.join("assets").to_string_lossy().to_string(),
        ),
        (
            "assets_index_name",
            version["assetIndex"]["id"].as_str().unwrap_or("").into(),
        ),
        ("natives_directory", native.to_string_lossy().to_string()),
        ("launcher_name", "Kynex Launcher".into()),
        ("launcher_version", crate::release::version()),
        ("classpath", cp.join(sep)),
        ("classpath_separator", sep.into()),
        (
            "library_directory",
            core.root.join("libraries").to_string_lossy().to_string(),
        ),
        ("user_properties", "{}".into()),
        (
            "clientid",
            p["settings"]["clientId"].as_str().unwrap_or("").into(),
        ),
        ("auth_xuid", auth.xuid.clone()),
        (
            "auth_session",
            format!("token:{}:{}", auth.token, auth.uuid),
        ),
        (
            "game_assets",
            core.root
                .join("assets/virtual")
                .join(version["assetIndex"]["id"].as_str().unwrap_or("legacy"))
                .to_string_lossy()
                .to_string(),
        ),
    ] {
        vars.insert(k.into(), v);
    }
    let memory = settings["memory"]
        .as_u64()
        .unwrap_or(4096)
        .clamp(512, 65536);
    let mut args = vec![format!("-Xmx{memory}M")];
    if let Some(server) = &auth.server {
        let agent = core.root.join("cache/authlib-injector.jar");
        let meta = core
            .get("https://authlib-injector.yushi.moe/artifact/latest.json")
            .await?;
        download(
            core,
            string(&meta, "download_url")?,
            &agent,
            meta["checksums"]["sha256"].as_str().unwrap_or(""),
        )
        .await?;
        args.push(format!("-javaagent:{}={}", agent.to_string_lossy(), server));
    }
    args.extend(argument_list(&version["arguments"]["jvm"], &vars));
    if !args.iter().any(|s| s == "-cp" || s == "-classpath") {
        args.extend([
            format!("-Djava.library.path={}", native.to_string_lossy()),
            "-cp".into(),
            cp.join(sep),
        ]);
    }
    args.push(string(&version, "mainClass")?.into());
    // Forge excludes the vanilla client from its module scan. KXL stores it as client.jar.
    if matches!(instance["loader"].as_str(), Some("forge" | "neoforge")) {
        for argument in &mut args {
            if argument.starts_with("-DignoreList=")
                && !argument.split(',').any(|name| name == "client.jar")
            {
                argument.push_str(",client.jar");
            }
        }
    }
    if let Some(s) = version["minecraftArguments"].as_str() {
        args.extend(shell_words::split(&substitute(s, &vars)).map_err(err)?)
    } else {
        args.extend(argument_list(&version["arguments"]["game"], &vars));
    }
    args.extend([
        "--width".into(),
        settings["width"]
            .as_u64()
            .unwrap_or(1280)
            .clamp(640, 7680)
            .to_string(),
        "--height".into(),
        settings["height"]
            .as_u64()
            .unwrap_or(720)
            .clamp(360, 4320)
            .to_string(),
    ]);
    core.stage("准备启动", 2, 4);
    core.stopped()?;
    let logs = dir.join("logs");
    std::fs::create_dir_all(&logs).map_err(err)?;
    let out = std::fs::File::create(logs.join("kxl-launch.log")).map_err(err)?;
    let child = {
        let mut command = Command::new(java);
        command
            .args(args)
            .current_dir(&gamedir)
            .stdin(Stdio::null())
            .stdout(Stdio::from(out.try_clone().map_err(err)?))
            .stderr(Stdio::from(out));
        hidden(&mut command).spawn().map_err(err)?
    };
    core.stage("游戏进程已启动", 4, 4);
    instance["lastPlayed"] = json!(std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(err)?
        .as_secs()
        .to_string());
    write_json(&dir.join("kxl.json"), &instance)?;
    let progress = core.progress.clone();
    std::thread::spawn(move || {
        let mut child = child;
        if let Ok(status) = child.wait() {
            progress(
                json!({"stage":if status.success(){"游戏已退出"}else{"游戏异常退出，请导入日志诊断"},"done":1,"total":1,"detail":format!("exit code {:?}",status.code())}),
            );
        }
    });
    Ok(json!(true))
}
fn extract_natives(path: &Path, to: &Path) -> Result<()> {
    let mut zip = zip::ZipArchive::new(std::fs::File::open(path).map_err(err)?).map_err(err)?;
    for i in 0..zip.len() {
        let mut e = zip.by_index(i).map_err(err)?;
        if let Some(p) = e.enclosed_name() {
            if let Some(name) = p.file_name() {
                let name = name.to_string_lossy();
                if name.ends_with(".dll") || name.ends_with(".so") || name.ends_with(".dylib") {
                    if e.size() > 100 * 1024 * 1024 {
                        return Err("本地库异常大".into());
                    }
                    let mut f = std::fs::File::create(to.join(name.as_ref())).map_err(err)?;
                    std::io::copy(&mut e, &mut f).map_err(err)?;
                }
            }
        }
    }
    Ok(())
}
pub(crate) fn resource_dir(core: &Core, p: &Value) -> Result<PathBuf> {
    let instance = core.instance(string(p, "id")?)?;
    let config = read_json(&instance.join("kxl.json"))?;
    let shared = config["settings"]["isolation"] == "shared"
        || (config["settings"]["isolation"] == "modded" && config["loader"] == "vanilla");
    let kind = string(p, "kind")?;
    if !["mods", "resourcepacks", "saves", "shaderpacks", "datapacks"].contains(&kind) {
        return Err("资源分类无效".into());
    }
    Ok(if shared {
        core.root.join("shared")
    } else {
        instance
    }
    .join(kind))
}
pub fn resources(core: &Core, p: &Value) -> Result<Value> {
    let dir = resource_dir(core, p)?;
    std::fs::create_dir_all(&dir).map_err(err)?;
    let mut out = vec![];
    for e in std::fs::read_dir(dir).map_err(err)?.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        out.push(json!({"name":name,"size":e.metadata().map_err(err)?.len(),"enabled":!name.ends_with(".disabled"),"dir":e.file_type().map(|t|t.is_dir()).unwrap_or(false)}));
    }
    out.sort_by_key(|v| v["name"].as_str().unwrap_or("").to_string());
    Ok(json!(out))
}
pub fn toggle_resource(core: &Core, p: &Value) -> Result<Value> {
    let dir = resource_dir(core, p)?;
    let name = safe_name(string(p, "name")?)?;
    if string(p, "kind")? == "saves" {
        return Err("存档不能停用".into());
    }
    let dest = if let Some(n) = name.strip_suffix(".disabled") {
        n.into()
    } else {
        format!("{name}.disabled")
    };
    if dir.join(&dest).exists() {
        return Err("目标资源已存在".into());
    }
    if string(p, "kind")? == "shaderpacks" && name.ends_with(".disabled") {
        for e in std::fs::read_dir(&dir).map_err(err)?.flatten() {
            let other = e.file_name().to_string_lossy().to_string();
            if e.path().is_file() && !other.ends_with(".disabled") {
                let target = dir.join(format!("{other}.disabled"));
                if !target.exists() {
                    std::fs::rename(e.path(), target).map_err(err)?;
                }
            }
        }
    }
    std::fs::rename(dir.join(name), dir.join(&dest)).map_err(err)?;
    if string(p, "kind")? == "shaderpacks" {
        let root = dir.parent().ok_or("实例目录无效")?;
        let enabled = if dest.ends_with(".disabled") {
            String::new()
        } else {
            dest
        };
        std::fs::create_dir_all(root.join("config")).map_err(err)?;
        let iris = root.join("config/iris.properties");
        let previous = std::fs::read_to_string(&iris).unwrap_or_default();
        let mut lines: Vec<_> = previous
            .lines()
            .filter(|l| !l.starts_with("shaderPack=") && !l.starts_with("enableShaders="))
            .map(str::to_owned)
            .collect();
        lines.push(format!("shaderPack={enabled}"));
        lines.push(format!("enableShaders={}", !enabled.is_empty()));
        std::fs::write(iris, lines.join("\n")).map_err(err)?;
    }
    Ok(json!(true))
}
async fn project_version(
    core: &Core,
    project: &str,
    game: &str,
    loader: &str,
    mods: bool,
) -> Result<Value> {
    safe_name(project)?;
    let mut url = reqwest::Url::parse(&format!(
        "https://api.modrinth.com/v2/project/{project}/version"
    ))
    .map_err(err)?;
    url.query_pairs_mut()
        .append_pair("game_versions", &json!([game]).to_string());
    if mods {
        url.query_pairs_mut()
            .append_pair("loaders", &json!([loader]).to_string());
    }
    let versions = core.get(url.as_str()).await?;
    versions
        .as_array()
        .and_then(|a| a.first())
        .cloned()
        .ok_or_else(|| format!("项目 {project} 没有兼容当前游戏与加载器的版本"))
}
pub async fn install_project(core: &Core, p: &Value) -> Result<Value> {
    let id = string(p, "id")?;
    let instance = read_json(&core.instance(id)?.join("kxl.json"))?;
    let kind = string(p, "kind")?;
    let loader = instance["loader"].as_str().unwrap_or("vanilla");
    let game = string(&instance, "version")?;
    let root_project = string(p, "project")?.to_string();
    let root_icon = p["iconUrl"].as_str().map(str::to_string);
    let first = project_version(core, &root_project, game, loader, kind == "mods").await?;
    let mut pending = std::collections::VecDeque::from([first]);
    let mut seen = std::collections::HashSet::new();
    let mut projects = std::collections::BTreeMap::new();
    let mut versions = vec![];
    while let Some(version) = pending.pop_front() {
        core.stopped()?;
        let vid = string(&version, "id")?.to_string();
        if !seen.insert(vid.clone()) {
            continue;
        }
        if seen.len() > 128 {
            return Err("依赖树过大，请改用整合包安装".into());
        }
        let pid = string(&version, "project_id")?.to_string();
        if let Some(previous) = projects.insert(pid.clone(), vid.clone()) {
            if previous != vid {
                return Err(format!("项目 {pid} 存在互不兼容的依赖版本"));
            }
        }
        if !version["game_versions"]
            .as_array()
            .map(|a| a.iter().any(|v| v == game))
            .unwrap_or(false)
        {
            return Err(format!("依赖 {pid} 不支持 Minecraft {game}"));
        }
        if kind == "mods"
            && !version["loaders"]
                .as_array()
                .map(|a| a.iter().any(|v| v == loader))
                .unwrap_or(false)
        {
            return Err(format!("依赖 {pid} 不支持 {loader}"));
        }
        if let Some(deps) = version["dependencies"].as_array() {
            for dep in deps.iter().filter(|d| d["dependency_type"] == "required") {
                if let Some(vid) = dep["version_id"].as_str() {
                    safe_name(vid)?;
                    pending.push_back(
                        core.get(&format!("https://api.modrinth.com/v2/version/{vid}"))
                            .await?,
                    );
                } else if let Some(pid) = dep["project_id"].as_str() {
                    pending
                        .push_back(project_version(core, pid, game, loader, kind == "mods").await?);
                } else {
                    return Err("依赖没有可下载的版本或项目 ID".into());
                }
            }
        }
        versions.push(version);
    }
    let dir = resource_dir(core, &json!({"id":id,"kind":kind}))?;
    std::fs::create_dir_all(&dir).map_err(err)?;
    let lockpath = core.instance(id)?.join("installed-projects.json");
    let mut lock = read_json(&lockpath).unwrap_or_else(|_| json!({}));
    let total = versions.len();
    let mut plans = Vec::with_capacity(total);
    for version in versions.iter().rev() {
        let files = version["files"].as_array().ok_or("资源没有文件")?;
        let file = files
            .iter()
            .find(|f| f["primary"] == true)
            .or(files.first())
            .ok_or("资源没有下载文件")?;
        let name = safe_name(string(file, "filename")?)?;
        let hash = string(&file["hashes"], "sha1")?;
        if hash.len() != 40 {
            return Err("资源缺少有效的 SHA-1 校验".into());
        }
        plans.push((
            string(version, "project_id")?.to_string(),
            string(version, "id")?.to_string(),
            name.to_string(),
            hash.to_string(),
            string(file, "url")?.to_string(),
        ));
    }
    tasks(
        core,
        plans
            .iter()
            .map(|(_, _, name, hash, url)| FileTask {
                url: url.clone(),
                path: dir.join(name),
                hash: hash.clone(),
            })
            .collect(),
        "安装资源与必需依赖",
        8,
    )
    .await?;
    for (pid, version, name, hash, _) in plans {
        if let Some(previous) = lock[pid.as_str()]["file"]
            .as_str()
            .filter(|old| *old != name)
        {
            safe_name(previous)?;
            let oldpath = dir.join(previous);
            if let Ok(bytes) = std::fs::read(&oldpath) {
                if format!("{:x}", Sha1::digest(&bytes))
                    == lock[pid.as_str()]["sha1"].as_str().unwrap_or("")
                {
                    let disabled = dir.join(format!("{previous}.disabled"));
                    if !disabled.exists() {
                        std::fs::rename(oldpath, disabled).map_err(err)?;
                    }
                }
            }
        }
        lock[pid.as_str()] = json!({
            "version":version,
            "file":name,
            "sha1":hash,
            "icon_url": if pid == root_project { root_icon.clone() } else { None }
        });
    }
    write_json(&lockpath, &lock)?;
    Ok(json!({"files":total}))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn pending_download_can_be_cancelled_without_waiting_for_network() {
        let directory = tempfile::tempdir().unwrap();
        let core = Core::new(directory.path().into(), Arc::new(|_| {})).unwrap();
        let cancelled = core.cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(30)).await;
            cancelled.store(true, Ordering::SeqCst);
        });
        let waiting = async { std::future::pending::<Result<()>>().await };
        let result = tokio::time::timeout(
            std::time::Duration::from_millis(500),
            wait_download(&core, waiting),
        )
        .await
        .unwrap();
        assert_eq!(result.unwrap_err(), "任务已取消");
    }
    #[test]
    fn library() {
        assert_eq!(
            lib_path("org.lwjgl:lwjgl:3.3.3:natives-windows").unwrap(),
            "org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-windows.jar"
        );
        assert!(lib_path("a:b:../evil").is_err());
    }
    #[test]
    fn rules() {
        assert!(!allowed(
            &json!({"rules":[{"action":"allow","features":{"is_demo_user":true}}]})
        ));
        assert!(allowed(&json!({})));
    }
    #[test]
    fn inherited() {
        let v = merge(
            json!({"arguments":{"game":["a"]},"libraries":[{"name":"g:a:1"}]}),
            json!({"arguments":{"game":["b"]},"libraries":[{"name":"g:a:2"}]}),
        );
        assert_eq!(v["arguments"]["game"], json!(["a", "b"]));
        assert_eq!(v["libraries"].as_array().unwrap().len(), 1);
    }
    #[test]
    fn preserves_native_classifiers() {
        let v = merge(
            json!({"libraries":[{"name":"org.lwjgl:lwjgl:3.3.1"},{"name":"org.lwjgl:lwjgl:3.3.1:natives-windows"},{"name":"org.lwjgl:lwjgl:3.3.1:natives-linux"}]}),
            json!({"libraries":[{"name":"net.fabricmc:fabric-loader:0.16.14"}]}),
        );
        assert_eq!(v["libraries"].as_array().unwrap().len(), 4);
    }
}
