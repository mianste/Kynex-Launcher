pub mod auth;
pub mod curseforge;
pub mod engine;
mod metadata;
pub mod mirrors;
#[cfg(feature = "desktop")]
mod native_window;
pub mod news;
pub mod optifine;
pub mod packs;
pub mod release;
pub mod resources;
pub mod skins;
#[cfg(feature = "desktop")]
mod updates;
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
pub type Result<T> = std::result::Result<T, String>;
pub type Progress = Arc<dyn Fn(Value) + Send + Sync>;
#[derive(Clone)]
pub struct Core {
    pub root: PathBuf,
    pub http: reqwest::Client,
    pub progress: Progress,
    pub cancel: Arc<AtomicBool>,
    pub busy: Arc<AtomicBool>,
    pub mirror_failed_until: Arc<std::sync::Mutex<std::time::Instant>>,
    pub download_source: Arc<std::sync::RwLock<String>>,
    pub auth_sessions:
        Arc<std::sync::Mutex<std::collections::HashMap<String, Arc<auth::PendingLogin>>>>,

}
impl Core {
    pub fn new(root: PathBuf, progress: Progress) -> Result<Self> {
        std::fs::create_dir_all(&root).map_err(err)?;
        let source = read_json(&root.join("download-settings.json"))
            .ok()
            .and_then(|v| v["source"].as_str().map(str::to_string))
            .filter(|v| v == "official")
            .unwrap_or_else(|| "bmclapi".into());
        Ok(Self {
            root,
            http: reqwest::Client::builder()
                .user_agent(format!(
                    "Kynex Launcher/{} (independent launcher)",
                    crate::release::version()
                ))
                .connect_timeout(std::time::Duration::from_secs(8))
                .build()
                .map_err(err)?,
            progress,
            cancel: Arc::new(AtomicBool::new(false)),
            busy: Arc::new(AtomicBool::new(false)),
            mirror_failed_until: Arc::new(std::sync::Mutex::new(std::time::Instant::now())),
            download_source: Arc::new(std::sync::RwLock::new(source)),
            auth_sessions: Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
        })
    }
    pub fn stage(&self, stage: &str, done: usize, total: usize) {
        (self.progress)(json!({"stage":stage,"done":done,"total":total}));
    }
    pub async fn get(&self, url: &str) -> Result<Value> {
        https(url)?;
        let source = self.download_source.read().map_err(err)?.clone();
        let candidates = mirrors::active_candidates(self, url, &source);
        let fetch = |candidate: String| async move {
            self.http
                .get(candidate)
                .timeout(std::time::Duration::from_secs(15))
                .send()
                .await
                .map_err(err)?
                .error_for_status()
                .map_err(err)?
                .json()
                .await
                .map_err(err)
        };
        if candidates.len() == 1 {
            return fetch(candidates[0].clone()).await;
        }
        let primary_url = candidates[0].clone();
        let fallback_url = candidates[1].clone();
        let primary = fetch(primary_url.clone());
        let fallback = async {
            tokio::time::sleep(std::time::Duration::from_millis(900)).await;
            fetch(fallback_url).await
        };
        tokio::pin!(primary);
        tokio::pin!(fallback);
        tokio::select! {
            first = &mut primary => match first {
                Ok(value) => Ok(value),
                Err(primary_error) => {
                    mirrors::mark_failed(self);
                    fallback.await.map_err(|fallback_error| format!("{primary_error}；备用源：{fallback_error}"))
                }
            },
            second = &mut fallback => match second {
                Ok(value) => Ok(value),
                Err(fallback_error) => primary.await.map_err(|primary_error| {
                    mirrors::mark_failed(self);
                    format!("{primary_error}；备用源：{fallback_error}")
                }),
            }
        }
    }
    pub fn stopped(&self) -> Result<()> {
        if self.cancel.load(Ordering::Relaxed) {
            Err("任务已取消".into())
        } else {
            Ok(())
        }
    }
    pub fn instance(&self, id: &str) -> Result<PathBuf> {
        Ok(self.root.join("instances").join(safe_name(id)?))
    }
    pub fn instances(&self) -> Result<Value> {
        let dir = self.root.join("instances");
        std::fs::create_dir_all(&dir).map_err(err)?;
        let mut out = vec![];
        for e in std::fs::read_dir(dir).map_err(err)?.flatten() {
            let p = e.path().join("kxl.json");
            if let Ok(s) = std::fs::read_to_string(p) {
                if let Ok(v) = serde_json::from_str::<Value>(&s) {
                    out.push(v);
                }
            }
        }
        Ok(json!(out))
    }
    pub async fn dispatch(&self, action: &str, p: Value) -> Result<Value> {
        match action {
            "list_instances" => self.instances(),
            "list_accounts" => auth::list(self),
            "manifest" => {
                let m = metadata::manifest(self, p["force"].as_bool().unwrap_or(false)).await?;
                Ok(m["versions"].clone())
            }
            "loaders" => engine::loaders(self, string(&p, "game")?, string(&p, "loader")?).await,
            "optifine_versions" => optifine::releases(self, string(&p, "game")?).await,
            "install" | "launch" | "import_pack" | "install_project" | "install_java" => {
                if self
                    .busy
                    .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                    .is_err()
                {
                    return Err("另一个安装或启动任务正在执行".into());
                }
                self.cancel.store(false, Ordering::SeqCst);
                let result = match action {
                    "install" => engine::install(self, &p).await,
                    "install_java" => {
                        engine::install_java(self, p["major"].as_u64().unwrap_or(0)).await
                    }
                    "launch" => engine::launch(self, &p).await,
                    "import_pack" => packs::import(self, &p).await,
                    "install_project" if p["source"].as_str() == Some("curseforge") => {
                        if p["kind"].as_str() == Some("modpacks") {
                            curseforge::install_modpack(self, &p).await
                        } else {
                            curseforge::install_project(self, &p).await
                        }
                    }
                    _ => engine::install_project(self, &p).await,
                };
                self.busy.store(false, Ordering::SeqCst);
                if let Err(ref e) = result {
                    (self.progress)(json!({"stage":"任务结束","done":0,"total":1,"error":e}));
                } else {
                    self.stage("完成", 1, 1)
                }
                result
            }
            "cancel" => {
                self.cancel.store(true, Ordering::Relaxed);
                Ok(json!(true))
            }
            "save_instance" => {
                let mut v: Value = read_json(&self.instance(string(&p, "id")?)?.join("kxl.json"))?;
                v["settings"] = p["settings"].clone();
                if let Some(settings) = v["settings"].as_object_mut() {
                    settings.remove("jvm");
                }
                write_json(&self.instance(string(&p, "id")?)?.join("kxl.json"), &v)?;
                Ok(v)
            }
            "save_instance_icon" => {
                use base64::Engine;
                let id = string(&p, "id")?;
                let mime = string(&p, "mime")?;
                if !["image/png", "image/jpeg", "image/webp"].contains(&mime) {
                    return Err("实例图标只支持 PNG、JPEG 或 WebP".into());
                }
                let encoded = string(&p, "base64")?;
                if encoded.len() > 3 * 1024 * 1024 {
                    return Err("实例图标不能大于 2 MB".into());
                }
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(encoded)
                    .map_err(err)?;
                let valid = match mime {
                    "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
                    "image/jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
                    "image/webp" => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
                    _ => false,
                };
                if !valid || bytes.len() > 2 * 1024 * 1024 {
                    return Err("实例图标文件无效或超过 2 MB".into());
                }
                let path = self.instance(id)?.join("kxl.json");
                let mut instance = read_json(&path)?;
                instance["icon"] = json!(format!("data:{mime};base64,{encoded}"));
                write_json(&path, &instance)?;
                Ok(instance)
            }
            "resources" => resources::list(self, &p),
            "project_dependencies" => curseforge::dependencies(self, &p).await,
            "delete_instance" => {
                let id = string(&p, "id")?;
                let dir = self.instance(id)?;
                let name = read_json(&dir.join("kxl.json"))
                    .ok()
                    .and_then(|value| value["name"].as_str().map(str::to_string))
                    .unwrap_or_else(|| id.to_string());
                std::fs::remove_dir_all(&dir).map_err(err)?;
                Ok(json!({"name": name}))
            }
            "toggle_resource" => resources::toggle(self, &p),
            "resource_move" => resources::move_pack(self, &p),
            "import_resource" => resources::import_file(self, &p),
            "import_resource_paths" => resources::import_paths(self, &p),
            "ensure_loader_components" => resources::ensure_loader_components(self, &p).await,
            "offline_login" => auth::offline(self, string(&p, "name")?),
            "microsoft_start" => {
                auth::microsoft_start(self, p["clientId"].as_str().unwrap_or("")).await
            }
            "microsoft_status" => Ok(auth::microsoft_status(
                self,
                p["clientId"].as_str().unwrap_or(""),
            )),
            "microsoft_poll" => auth::microsoft_poll(self, string(&p, "flowId")?).await,
            "microsoft_cancel" => auth::microsoft_cancel(self, string(&p, "flowId")?),
            "download_config" => mirrors::configure(self, &p),
            "download_status" => {
                Ok(json!({"source":self.download_source.read().map_err(err)?.clone()}))
            }
            "mirror_benchmark" => mirrors::benchmark(self).await,
            "auth_server" => {
                let server = string(&p, "server")?.trim_end_matches('/');
                https(server)?;
                let meta = self.get(server).await?;
                if !meta["meta"].is_object() && !meta["skinDomains"].is_array() {
                    return Err("此地址不是可识别的 Yggdrasil 认证服务器".into());
                }
                Ok(
                    json!({"name":meta["meta"]["serverName"].as_str().unwrap_or("Yggdrasil 认证服务器")}),
                )
            }
            "external_login" => auth::external(self, &p).await,
            "delete_account" => auth::remove(self, string(&p, "id")?),
            "apply_skin" => auth::apply_skin(self, &p).await,
            "skin_import" => skins::import(&p).await,
            "stage_pack" => {
                use base64::Engine;
                let name = safe_name(string(&p, "name")?)?;
                if !["zip", "mrpack", "curseforge"]
                    .iter()
                    .any(|ext| name.to_lowercase().ends_with(&format!(".{ext}")))
                {
                    return Err("不支持的包扩展名".into());
                }
                let data = string(&p, "base64")?;
                if data.len() > 140 * 1024 * 1024 {
                    return Err("整合包过大，请使用文件选择器".into());
                }
                let data = base64::engine::general_purpose::STANDARD
                    .decode(data)
                    .map_err(err)?;
                let dir = self
                    .root
                    .join("imports")
                    .join(uuid::Uuid::new_v4().to_string());
                std::fs::create_dir_all(&dir).map_err(err)?;
                let path = dir.join(name);
                std::fs::write(&path, data).map_err(err)?;
                Ok(json!(path))
            }
            "inspect_pack" => packs::inspect(Path::new(string(&p, "path")?)),
            "export_pack" => packs::export(self, &p),
            "java" => engine::java_list_at(self),
            "search" => search_projects(self, &p).await,
            "news" => news::list(self, p["force"].as_bool().unwrap_or(false)).await,
            "read_image" => {
                use base64::Engine;
                let path = PathBuf::from(string(&p, "path")?);
                let limit = p["maxBytes"]
                    .as_u64()
                    .unwrap_or(5 * 1024 * 1024)
                    .min(5 * 1024 * 1024);
                if std::fs::metadata(&path).map_err(err)?.len() > limit {
                    return Err("图片超过允许大小".into());
                }
                let data = std::fs::read(&path).map_err(err)?;
                let mime = if data.starts_with(b"\x89PNG\r\n\x1a\n") {
                    "image/png"
                } else if data.starts_with(&[0xff, 0xd8, 0xff]) {
                    "image/jpeg"
                } else if data.starts_with(b"RIFF") && data.get(8..12) == Some(b"WEBP") {
                    "image/webp"
                } else {
                    return Err("请选择 PNG、JPEG 或 WebP 图片".into());
                };
                Ok(
                    json!({"name":path.file_name().map(|n|n.to_string_lossy()).unwrap_or_default(),"mime":mime,"base64":base64::engine::general_purpose::STANDARD.encode(data)}),
                )
            }
            "read_log" => {
                let path = PathBuf::from(string(&p, "path")?);
                if std::fs::metadata(&path).map_err(err)?.len() > 20 * 1024 * 1024 {
                    return Err("日志不能大于 20 MB".into());
                }
                Ok(json!(std::fs::read_to_string(path).map_err(err)?))
            }
            "environment" => Ok(
                json!({"os":std::env::consts::OS,"arch":std::env::consts::ARCH,"root":self.root,"java":engine::java_list_at(self)?}),
            ),
            #[cfg(feature = "desktop")]
            "open_folder" => {
                let path = if let Some(id) = p["id"].as_str() {
                    self.instance(id)?
                } else {
                    self.root.clone()
                };
                std::fs::create_dir_all(&path).map_err(err)?;
                open::that(path).map_err(err)?;
                Ok(json!(true))
            }
            #[cfg(feature = "desktop")]
            "open_resource_folder" => {
                let path = engine::resource_dir(self, &p)?;
                std::fs::create_dir_all(&path).map_err(err)?;
                open::that(path).map_err(err)?;
                Ok(json!(true))
            }
            #[cfg(feature = "desktop")]
            "open_url" => {
                let url = string(&p, "url")?;
                https(url)?;
                open::that(url).map_err(err)?;
                Ok(json!(true))
            }
            _ => Err(format!("未知操作：{action}")),
        }
    }
}

async fn modrinth_search(core: &Core, p: &Value) -> Result<Value> {
    let kind = string(p, "kind")?;
    let page = p["page"].as_u64().unwrap_or(0);
    let mut facets = vec![vec![format!("project_type:{kind}")]];
    if let Some(game) = p["game"].as_str().filter(|value| !value.is_empty()) {
        facets.push(vec![format!("versions:{game}")]);
    }
    if matches!(kind, "mod" | "modpack") {
        if let Some(loader) = p["loader"].as_str().filter(|value| !value.is_empty()) {
            facets.push(vec![format!("categories:{loader}")]);
        }
    }
    let facets = serde_json::to_string(&facets).map_err(err)?;
    let offset = (page * 30).to_string();
    let mut value: Value = core
        .http
        .get("https://api.modrinth.com/v2/search")
        .query(&[
            ("query", p["query"].as_str().unwrap_or("")),
            ("facets", facets.as_str()),
            ("limit", "30"),
            ("offset", offset.as_str()),
            ("index", "downloads"),
        ])
        .timeout(std::time::Duration::from_secs(12))
        .send()
        .await
        .map_err(|error| format!("连接 Modrinth 失败：{error}"))?
        .error_for_status()
        .map_err(|error| format!("Modrinth 搜索失败：{error}"))?
        .json()
        .await
        .map_err(err)?;
    if let Some(hits) = value["hits"].as_array_mut() {
        for hit in hits {
            hit["source"] = json!("modrinth");
        }
    }
    let total = value["total_hits"]
        .as_u64()
        .or_else(|| value["hits"].as_array().map(|hits| hits.len() as u64))
        .unwrap_or(0);
    Ok(json!({"hits":value["hits"],"total":total,"page":page,"pageSize":30}))
}

async fn search_projects(core: &Core, p: &Value) -> Result<Value> {
    use sha2::{Digest, Sha256};

    let cache_input = json!({
        "kind": p["kind"],
        "query": p["query"],
        "source": p["source"],
        "game": p["game"],
        "loader": p["loader"],
        "page": p["page"],
    });
    let cache_key = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&cache_input).map_err(err)?)
    );
    let cache = core
        .root
        .join("cache")
        .join("resource-search")
        .join(format!("{cache_key}.json"));
    let fresh = std::fs::metadata(&cache)
        .and_then(|meta| meta.modified())
        .and_then(|time| time.elapsed().map_err(std::io::Error::other))
        .map(|age| age < std::time::Duration::from_secs(10 * 60))
        .unwrap_or(false);
    if fresh {
        if let Ok(mut value) = read_json(&cache) {
            value["cached"] = json!(true);
            return Ok(value);
        }
    }
    let source = p["source"].as_str().unwrap_or("all");
    let page = p["page"].as_u64().unwrap_or(0);
    let curseforge = || {
        curseforge::search(
            core,
            p["kind"].as_str().unwrap_or("mod"),
            p["query"].as_str().unwrap_or(""),
            p["game"].as_str(),
            p["loader"].as_str(),
            p["curseforgeKey"].as_str().unwrap_or(""),
            page,
        )
    };
    let value = match source {
        "modrinth" => modrinth_search(core, p).await,
        "curseforge" => curseforge().await,
        "all" => {
            let (modrinth, curseforge) = tokio::join!(modrinth_search(core, p), curseforge());
            if let (Err(a), Err(b)) = (&modrinth, &curseforge) {
                return Err(format!(
                    "两个资源源都不可用。Modrinth：{a}；CurseForge：{b}"
                ));
            }
            let mut hits = Vec::new();
            let mut seen = std::collections::HashSet::new();
            let mut total = 0_u64;
            let mut warnings = Vec::new();
            for (name, result) in [("Modrinth", modrinth), ("CurseForge", curseforge)] {
                match result {
                    Ok(value) => {
                        total = total.saturating_add(value["total"].as_u64().unwrap_or(0));
                        for hit in value["hits"].as_array().cloned().unwrap_or_default() {
                            let key = hit["slug"]
                                .as_str()
                                .or_else(|| hit["title"].as_str())
                                .unwrap_or("")
                                .to_lowercase()
                                .replace([' ', '-', '_'], "");
                            if seen.insert(key) {
                                hits.push(hit);
                            }
                        }
                    }
                    Err(error) => warnings.push(format!("{name} 暂时不可用：{error}")),
                }
            }
            hits.sort_by_key(|hit| std::cmp::Reverse(hit["downloads"].as_u64().unwrap_or(0)));
            hits.truncate(30);
            Ok(json!({
                "hits": hits,
                "total": total,
                "page": page,
                "pageSize": 30,
                "warning": if warnings.is_empty() { Value::Null } else { json!(warnings.join("；")) }
            }))
        }
        _ => Err("资源来源无效".into()),
    }?;
    // 缓存只是加速层；磁盘缓存写入失败不能让一次成功的在线搜索变成失败。
    let _ = write_json(&cache, &value);
    Ok(value)
}

pub fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
/// Windows GUI 程序启动控制台子进程时隐藏黑色命令提示框。
pub fn hidden(cmd: &mut std::process::Command) -> &mut std::process::Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}
/// 异步版本，用于加载器安装器与游戏启动。
pub fn hidden_async(cmd: &mut tokio::process::Command) -> &mut tokio::process::Command {
    #[cfg(windows)]
    {
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}
pub fn string<'a>(p: &'a Value, k: &str) -> Result<&'a str> {
    p[k].as_str().ok_or_else(|| format!("缺少参数 {k}"))
}
pub fn safe_name(s: &str) -> Result<&str> {
    if s.is_empty()
        || s.len() > 128
        || s == "."
        || s == ".."
        || s.ends_with('.')
        || s.ends_with(' ')
        || s.chars()
            .any(|c| c.is_control() || "/\\:*?\"<>|".contains(c))
    {
        Err("名称含不允许的字符或过长".into())
    } else {
        let first = s.split('.').next().unwrap_or("").to_uppercase();
        if ["CON", "PRN", "AUX", "NUL"].contains(&first.as_str())
            || ((first.starts_with("COM") || first.starts_with("LPT"))
                && first.len() == 4
                && first.as_bytes()[3].is_ascii_digit()
                && first.as_bytes()[3] != b'0')
        {
            Err("名称是系统保留字".into())
        } else {
            Ok(s)
        }
    }
}
pub fn https(url: &str) -> Result<()> {
    if reqwest::Url::parse(url).map_err(err)?.scheme() != "https" {
        return Err("只允许 HTTPS 地址".into());
    }
    Ok(())
}
pub fn read_json(path: &Path) -> Result<Value> {
    serde_json::from_str(&std::fs::read_to_string(path).map_err(err)?).map_err(err)
}
pub fn write_json(path: &Path, v: &Value) -> Result<()> {
    if let Some(p) = path.parent() {
        std::fs::create_dir_all(p).map_err(err)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(v).map_err(err)?).map_err(err)?;
    std::fs::rename(&tmp, path).map_err(err)
}
#[cfg(all(feature = "desktop", windows))]
fn copy_tree(from: &Path, to: &Path) {
    let _ = std::fs::create_dir_all(to);
    if let Ok(entries) = std::fs::read_dir(from) {
        for entry in entries.flatten() {
            let source = entry.path();
            let target = to.join(entry.file_name());
            if source.is_dir() {
                copy_tree(&source, &target);
            } else {
                let _ = std::fs::copy(&source, &target);
            }
        }
    }
}
#[cfg(feature = "desktop")]
pub fn run() {
    use tauri::{Emitter, Manager};
    // 旧版 WebView2 配置目录可能被上一次异常退出的进程锁住或损坏，导致
    // CreateWebView2Environment 返回 0x800700AA / 0x8000FFFF。使用独立的
    // 版本化目录，并在首次切换时复制旧的 Local Storage，保留界面设置和皮肤库。
    #[cfg(windows)]
    if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_none() {
        if let Some(local) = dirs::data_local_dir() {
            let base = local.join(if crate::release::info()["channel"] == "beta" { "com.keke.kynex.beta" } else { "com.keke.kynex" });
            let profile = base.join("EBWebView-v2");
            let old_storage = base.join("EBWebView").join("Default").join("Local Storage");
            let new_storage = profile.join("Default").join("Local Storage");
            if !new_storage.exists() && old_storage.exists() {
                let _ = std::fs::create_dir_all(profile.join("Default"));
                copy_tree(&old_storage, &new_storage);
            }
            if std::fs::create_dir_all(&profile).is_ok() {
                std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &profile);
            }
        }
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_updater::Builder::new()
                .pubkey(include_str!("../../config/updater-public-key.txt").trim())
                .build(),
        )
        .manage(updates::Updates::default())
        .setup(|app| {
            let handle = app.handle().clone();
            let root = app.path().app_data_dir()?.join("game");
            let core = Core::new(
                root,
                Arc::new(move |v| {
                    let _ = handle.emit("kynex-progress", v);
                }),
            )
            .map_err(std::io::Error::other)?;
            app.manage(core);
            if let Some(window) = app.get_webview_window("main") {
                native_window::prepare(&window).map_err(std::io::Error::other)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![dispatch])
        .run(tauri::generate_context!())
        .expect("Kynex Launcher 无法启动");
}
#[cfg(feature = "desktop")]
#[tauri::command]
async fn dispatch(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    core: tauri::State<'_, Core>,
    action: String,
    payload: Value,
) -> Result<Value> {
    if webview.label() != "main" {
        return Err("此操作仅允许启动器主界面调用".into());
    }
    if action == "check_update" {
        return updates::check(&app, &core).await;
    }
    if action == "install_update" {
        return updates::install(&app).await;
    }
    if action == "show_main_window" {
        use tauri::Manager;
        let window = app.get_webview_window("main").ok_or("主窗口不存在")?;
        native_window::prepare(&window)?;
        native_window::center_for_startup(&window)?;
        window.show().map_err(err)?;
        return Ok(json!(true));
    }
    core.dispatch(&action, payload).await
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn paths() {
        for s in ["../evil", "a/b", "C:\\x", "..", "NUL", "a."] {
            assert!(safe_name(s).is_err());
        }
        assert!(safe_name("1.20.1-Fabric").is_ok());
    }
}
