mod jobs;
mod loader_catalog;
mod loader_processors;
mod game_directories;
#[cfg(test)]
mod public_scope_tests {
    #[test]
    fn reserved_modules_and_actual_service_settings_are_not_public() {
        let root=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        for relative in ["src/features/music","src/lib/gameDetection.ts","src-tauri/src/music_crypto.rs","src-tauri/src/music_native.rs","src-tauri/src/music_official.rs","src-tauri/src/games.rs","src-tauri/src/server.rs","config/microsoft-registration.json"] {
            assert!(!root.join(relative).exists(),"Reserved file: {relative}");
        }
        assert!(include_str!("../../config/updater-public-key.txt").trim().is_empty());
        let build:serde_json::Value=serde_json::from_str(include_str!("../../config/build-channel.json")).unwrap();
        assert_eq!(build["version"],"1.3.2");
        assert_eq!(build["identifier"],"com.keke.kynex.public");
    }
}
mod ai_diagnose;
mod mod_updates;
mod mod_check;
mod resource_downloads;
mod resource_dependencies;
mod pack_logos;
mod asset_download;
pub mod auth;
mod credentials;
mod appearance;
pub mod curseforge;
pub mod engine;
pub mod game_options;
mod icons;
mod wallpaper_engine;
mod metadata;
pub mod mirrors;
#[cfg(feature = "desktop")]
mod native_window;
pub mod news;
pub mod optifine;
pub mod packs;
pub mod release;
pub mod resources;
mod resource_delete;
mod pack_export;
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
    pub data_root: PathBuf,
    pub http: reqwest::Client,
    pub progress: Progress,
    pub cancel: Arc<AtomicBool>,
    pub busy: Arc<AtomicBool>,
    pub jobs: Arc<jobs::Jobs>,
    pub mirror_failed_until: Arc<std::sync::Mutex<std::time::Instant>>,
    pub download_source: Arc<std::sync::RwLock<String>>,
    pub auth_sessions:
        Arc<std::sync::Mutex<std::collections::HashMap<String, Arc<crate::auth::PendingLogin>>>>,
    /// 本次任务的文件下载并发上限，由设置的 threads 控制。
    pub threads: Arc<std::sync::atomic::AtomicUsize>,
}
impl Core {
    pub fn new(root: PathBuf, progress: Progress) -> Result<Self> {
        std::fs::create_dir_all(&root).map_err(err)?;
        let source = read_json(&root.join("download-settings.json"))
            .ok()
            .and_then(|v| v["source"].as_str().map(str::to_string))
            .filter(|v| v == "official")
            .unwrap_or_else(|| "bmclapi".into());
        let http = reqwest::Client::builder();
        // Schannel uses the Windows certificate-chain builder, including AIA
        // intermediates. Keep certificate and hostname verification enabled.
        #[cfg(windows)]
        let http = http.use_native_tls();
        #[cfg(not(windows))]
        let http = http.use_rustls_tls();
        let http = http.min_tls_version(reqwest::tls::Version::TLS_1_2);
        Ok(Self {
            data_root: root.clone(),
            root,
            http: http
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
            jobs: Arc::new(jobs::Jobs::default()),
            mirror_failed_until: Arc::new(std::sync::Mutex::new(std::time::Instant::now())),
            download_source: Arc::new(std::sync::RwLock::new(source)),
            threads: Arc::new(std::sync::atomic::AtomicUsize::new(8)),
            auth_sessions: Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
        })
    }
    pub fn stage(&self, stage: &str, done: usize, total: usize) {
        (self.progress)(json!({"stage":stage,"done":done,"total":total,"detail":null}));
    }
    /// 设置本次任务的文件下载并发（1–24，默认 8）。
    pub fn set_threads(&self, threads: usize) {
        self.threads
            .store(threads.clamp(1, 24), Ordering::Relaxed);
    }
    pub fn threads(&self) -> usize {
        self.threads.load(Ordering::Relaxed).clamp(1, 24)
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
        game_directories::discover(self)?;
        let dir = self.root.join("instances");
        std::fs::create_dir_all(&dir).map_err(err)?;
        let mut out = vec![];
        for e in std::fs::read_dir(dir).map_err(err)?.flatten() {
            let p = e.path().join("kxl.json");
            if let Ok(s) = std::fs::read_to_string(p) {
                if let Ok(mut v) = serde_json::from_str::<Value>(&s) {
                    if v["externalSource"].as_str().is_some_and(|p|!Path::new(p).is_dir()) {continue;}
                    if v["packIcon"].as_str().is_none() {
                        let icon=packs::installed_icon(&e.path()).or_else(||{
                            let running=game_directories::running_directory(self,&v).ok()?;
                            packs::installed_icon_named(&running,v["name"].as_str().unwrap_or(""))
                        });
                        if let Some(icon)=icon {v["packIcon"]=json!(icon);}
                    }
                    out.push(v);
                }
            }
        }
        Ok(json!(out))
    }
    pub async fn dispatch(&self, action: &str, p: Value) -> Result<Value> {
        match action {
            "game_directories" => return game_directories::list(self),
            "add_game_directory" | "select_game_directory" | "remove_game_directory" => return game_directories::change(self,action,&p).await,
            _ => {},
        }
        if game_directories::game_action(action) {
            return game_directories::context(self,&p)?.dispatch_at(action,p).await;
        }
        self.dispatch_at(action,p).await
    }
    async fn dispatch_at(&self, action: &str, p: Value) -> Result<Value> {
        match action {
            "list_instances" => self.instances(),
            "hydrate_pack_icons" => pack_logos::hydrate(self).await,
            "list_accounts" => auth::list(self),
            "manifest" => {
                let m = metadata::manifest(self, p["force"].as_bool().unwrap_or(false)).await?;
                Ok(m["versions"].clone())
            }
            "loaders" => loader_catalog::loaders(self, string(&p, "game")?, string(&p, "loader")?, p["force"].as_bool().unwrap_or(false)).await,
            "icon" => icons::fetch(self, &p).await,
            "wallpaper_engine_scan" => wallpaper_engine::scan().await,
            "warm_loader_catalogs" => loader_catalog::warm(self).await,
            "optifine_versions" => optifine::releases(self, string(&p, "game")?).await,
            "download_resource_file" | "update_mods" | "export_pack" | "install" | "launch" | "import_pack" | "install_project" | "install_java" => {
                let job = self.jobs.start(action, &p);
                (self.progress)(json!({"taskId":job.id,"stage":"排队等待","done":0,"total":1,"action":action,"payload":p}));
                let progress = self.progress.clone();
                let task_id = job.id.clone();
                let task_name = p["name"].as_str().or(p["project"].as_str()).or(p["id"].as_str()).unwrap_or(match action {"install_project" => "安装资源", "import_pack" => "导入整合包", "export_pack" => "导出整合包", "install_java" => "安装 Java", "launch" => "启动游戏", _ => "安装游戏"}).to_string();
                let task = Core {
                    cancel: job.cancel.clone(),
                    progress: Arc::new(move |mut value| {
                        value["taskId"] = json!(task_id);
                        value["name"] = json!(task_name);
                        progress(value);
                    }),
                    ..self.clone()
                };
                task.stage("排队等待", 0, 1);
                let result = async {
                    let _target = jobs::wait(&task, job.target.lock()).await?;
                    let _slot = job.acquire(&task).await?;
                    task.stopped()?;
                    task.stage(match action {"install_project" => "获取资源下载信息", "import_pack" => "读取整合包清单", "export_pack" => "读取导出内容", "install_java" => "准备 Java 环境", "launch" => "检查启动环境", _ => "读取游戏版本配置"}, 0, 1);
                let result = match action {
                    "install" => engine::install(&task, &p).await,
                    "install_java" => {
                        engine::install_java(&task, p["major"].as_u64().unwrap_or(0)).await
                    }
                    "download_resource_file" => resource_downloads::save(&task,&p).await,
                    "update_mods" => mod_updates::apply(&task, &p).await,
                    "export_pack" => pack_export::export(&task, &p).await,
                    "launch" => {
                        let config = read_json(&task.instance(string(&p,"id")?)?.join("kxl.json"))?;
                        if config["modUpdateMode"] == "auto" { mod_updates::apply(&task, &p).await?; }
                        engine::launch(&task, &p).await
                    },
                    "import_pack" => packs::import(&task, &p).await,
                    "install_project" if p["kind"].as_str() == Some("modpacks") && p["source"].as_str() != Some("curseforge") => packs::install_modrinth(&task, &p).await,
                    "install_project" if p["source"].as_str() == Some("curseforge") => {
                        if p["kind"].as_str() == Some("modpacks") {
                            curseforge::install_modpack(&task, &p).await
                        } else {
                            resource_dependencies::install(&task, &p).await
                        }
                    }
                    _ => resource_dependencies::install(&task, &p).await,
                };
                    result
                }.await;
                (task.progress)(json!({"stage":if result.is_ok(){"完成"}else{"任务失败"},"done":1,"total":1,"finished":true,"error":result.as_ref().err()}));
                if let Ok(value)=&result{mod_check::after_install(self,action,&p,value);}
                if action=="launch" && result.is_err() && !task.cancel.load(Ordering::Relaxed) {
                    let options=read_json(&task.data_root.join("ai-options.json")).unwrap_or_else(|_|json!({}));
                    if options["automatic"]!=false {
                        (task.progress)(json!({"autoDiagnosis":true,"status":"analyzing","reason":"游戏启动失败，正在分析本次启动错误"}));
                        let analysis=ai_diagnose::analyze(&task,&json!({"text":format!("Minecraft 启动准备失败：{}",result.as_ref().unwrap_err())})).await;
                        (task.progress)(match analysis {Ok(v)=>json!({"autoDiagnosis":true,"status":"done","report":v["report"]}),Err(e)=>json!({"autoDiagnosis":true,"status":"error","error":e})});
                    }
                }
                result
            }
            "cancel" => {
                self.jobs.cancel(p["taskId"].as_str());
                Ok(json!(true))
            }
            "save_instance" => {
                let lock=self.jobs.instance_lock(string(&p,"id")?);let _guard=lock.lock().await;
                let mut v: Value = read_json(&self.instance(string(&p, "id")?)?.join("kxl.json"))?;
                v["settings"] = p["settings"].clone();
                if v["settings"]["isolation"]=="custom" {
                    v["settings"]["gameDirectory"]=json!(game_directories::writable(string(&v["settings"],"gameDirectory")?)?);
                }
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
            "ai_options" => {
                let path=self.root.join("ai-options.json");
                if let Some(value)=p["automatic"].as_bool(){write_json(&path,&json!({"automatic":value}))?;}
                Ok(read_json(&path).unwrap_or_else(|_|json!({"automatic":true})))
            },
            "ai_key_status" => Ok(json!({"configured": ai_diagnose::configured(self)})),
            "ai_key_save" => ai_diagnose::save_key(self, &p),
            "ai_key_remove" => ai_diagnose::remove_key(self),
            "ai_diagnose" => ai_diagnose::analyze(self, &p).await,
            "project_versions" => mod_updates::versions(self, &p).await,
            "resource_requirements" => resource_dependencies::preview(self, &p).await,
            "datapack_worlds" => resource_downloads::worlds(self,&p),
            "check_mod_updates" => mod_updates::check(self, &p).await,
            "scan_installed_mod_updates" => mod_check::prepare_installed(self, &p),
            "mod_update_mode" => mod_updates::mode(self, &p),
            "resources" => resources::list(self, &p),
            "delete_resources" => resource_delete::remove(self, &p).await,
            "project_dependencies" => curseforge::dependencies(self, &p).await,
            "delete_instance" => {
                let id = string(&p, "id")?;
                let dir = self.instance(id)?;
                if let Ok(config)=read_json(&dir.join("kxl.json")) {game_directories::hide_external(self,&config)?;}
                let name = read_json(&dir.join("kxl.json"))
                    .ok()
                    .and_then(|value| value["name"].as_str().map(str::to_string))
                    .unwrap_or_else(|| id.to_string());
                std::fs::remove_dir_all(&dir).map_err(err)?;
                Ok(json!({"name": name}))
            }
            "toggle_resource" => resources::toggle(self, &p),
            "resource_move" => resources::move_pack(self, &p),
            "import_resource" => {
                let result=resources::import_file(self,&p);
                if let Ok(value)=&result{mod_check::after_install(self,action,&p,value);}result
            },
            "import_resource_paths" => {
                let result=resources::import_paths(self,&p);
                if let Ok(value)=&result{mod_check::after_install(self,action,&p,value);}result
            },
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
            "skin_texture" => skins::texture(self,&p).await,
            "sync_appearance" => appearance::sync(self, string(&p,"accountId")?).await,
            "apply_cape" => appearance::apply_cape(self, &p).await,
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
            "export_options" => pack_export::options(self, &p),
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
            "open_folder" | "open_data_folder" => {
                let path = if action=="open_data_folder" {self.data_root.clone()} else if let Some(id) = p["id"].as_str() {
                    game_directories::running_directory(self,&read_json(&self.instance(id)?.join("kxl.json"))?)?
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

async fn modrinth_search(
    core: &Core,
    p: &Value,
    category: Option<&str>,
) -> Result<Value> {
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
    if let Some(category) = category {
        facets.push(vec![format!("categories:{category}")]);
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
    let query = p["query"].as_str().unwrap_or("");
    if literal_search_required(query) {
        let count = value["hits"].as_array_mut().map(|hits| {
            hits.retain(|hit| literal_search_match(query, &[
                hit["title"].as_str().unwrap_or(""),
                hit["slug"].as_str().unwrap_or(""),
                hit["description"].as_str().unwrap_or(""),
            ]));
            hits.len()
        }).unwrap_or(0);
        value["total_hits"] = json!(count);
    }
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
        "queryPolicy": 2,
        "kind": p["kind"],
        "query": p["query"],
        "source": p["source"],
        "game": p["game"],
        "loader": p["loader"],
        "tag": p["tag"],
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
    let search_lock = core.jobs.file_lock(&cache);
    let _search_guard = search_lock.lock().await;
    let fresh = std::fs::metadata(&cache)
        .and_then(|meta| meta.modified())
        .and_then(|time| time.elapsed().map_err(std::io::Error::other))
        .map(|age| age < std::time::Duration::from_secs(10 * 60))
        .unwrap_or(false);
    if fresh && p["force"] != true {
        if let Ok(mut value) = read_json(&cache) {
            value["cached"] = json!(true);
            return Ok(value);
        }
    }
    let source = p["source"].as_str().unwrap_or("all");
    let page = p["page"].as_u64().unwrap_or(0);
    // 标签形如「CurseForge 分类 ID/Modrinth 分类 slug」：
    // "406/worldgen" 两边同时筛选，"/game-mechanics" 只筛 Modrinth，"9026/" 只筛 CurseForge。
    let tag = p["tag"].as_str().unwrap_or("");
    let (category_cf, category_mr) = split_tag(tag);
    let curseforge = || async {
        if tag.starts_with('/') {
            return Ok(json!({"hits": [], "total": 0, "page": page, "pageSize": 30}));
        }
        curseforge::search(
            core,
            p["kind"].as_str().unwrap_or("mod"),
            p["query"].as_str().unwrap_or(""),
            p["game"].as_str(),
            p["loader"].as_str(),
            category_cf,
            p["curseforgeKey"].as_str().unwrap_or(""),
            page,
        )
        .await
    };
    let modrinth = || async {
        if tag.ends_with('/') {
            return Ok(json!({"hits": [], "total": 0, "page": page, "pageSize": 30}));
        }
        modrinth_search(core, p, category_mr).await
    };
    let value = match source {
        "modrinth" => modrinth().await,
        "curseforge" => curseforge().await,
        "all" => {
            let (modrinth, curseforge) = tokio::join!(modrinth(), curseforge());
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

// Search engines may drop a punctuation-only query and return their default
// catalogue. Only show literal matches in that case, never the popular list.
pub(crate) fn literal_search_required(query: &str) -> bool {
    !query.trim().is_empty() && !query.chars().any(char::is_alphanumeric)
}
pub(crate) fn literal_search_match(query: &str, fields: &[&str]) -> bool {
    fields.iter().any(|text| text.contains(query.trim()))
}

/// 拆分「CurseForge 分类 ID/Modrinth 分类 slug」形式的资源标签。
/// 任一侧为空表示该来源不支持这个分类。
fn split_tag(tag: &str) -> (Option<u64>, Option<&str>) {
    match tag.split_once('/') {
        Some((cf, mr)) => (
            cf.parse::<u64>().ok(),
            Some(mr).filter(|slug| !slug.is_empty()),
        ),
        None => (tag.parse::<u64>().ok(), None),
    }
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
/// Instance titles are JSON metadata; their directories use validated UUIDs.
/// Do not apply Windows filename restrictions to names from pack catalogues.
pub fn instance_display_name(s: &str) -> Result<&str> {
    if s.trim().is_empty() || s.chars().count() > 512 || s.chars().any(char::is_control) {
        Err("名称不能为空、超过 512 个字或包含控制字符".into())
    } else {
        Ok(s)
    }
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
    #[test]
    fn symbol_searches_do_not_display_an_unfiltered_catalogue() {
        for query in ["+", "++", "🙂", "?", "\""] {
            assert!(super::literal_search_required(query));
            assert!(!super::literal_search_match(query, &["Popular mod", "Default catalogue"]));
            assert!(super::literal_search_match(query, &[&format!("A {query} resource")]));
        }
        for query in ["", "  ", "a", "ab", "玉", "A&B+中🙂"] {
            assert!(!super::literal_search_required(query));
        }
    }
    use super::*;
    #[test]
    fn instance_titles_are_not_filesystem_paths() {
        for title in ["All the Mods 10: To the Sky ATM10SKY", "CON", "整合包 / 冒险：第一章"] {
            assert_eq!(instance_display_name(title).unwrap(), title);
            assert!(safe_name(title).is_err());
        }
        assert!(instance_display_name(&"中".repeat(100)).is_ok());
        for title in ["", "  ", "bad\nname", "bad\0name"] {
            assert!(instance_display_name(title).is_err());
        }
        assert!(instance_display_name(&"中".repeat(513)).is_err());
    }
    #[test]
    fn custom_running_directory_pack_logo_is_used_in_the_shared_instance_list() {
        let temp=tempfile::tempdir().unwrap();let c=Core::new(temp.path().join("launcher"),Arc::new(|_|{})).unwrap();
        let running=temp.path().join("external-game");std::fs::create_dir_all(running.join("config/fancymenu/assets")).unwrap();
        std::fs::write(running.join("config/fancymenu/assets/10sky.png"),include_bytes!("../../src/assets/loaders/minecraft.png")).unwrap();
        write_json(&c.instance("test").unwrap().join("kxl.json"),&json!({"id":"test","name":"ATM10SKY","settings":{"isolation":"custom","gameDirectory":running}})).unwrap();
        assert!(c.instances().unwrap()[0]["packIcon"].as_str().unwrap().starts_with("data:image/png;base64,"));
    }
    #[test]
    fn paths() {
        for s in ["../evil", "a/b", "C:\\x", "..", "NUL", "a."] {
            assert!(safe_name(s).is_err());
        }
        assert!(safe_name("1.20.1-Fabric").is_ok());
    }

    #[test]
    fn tag_splits_into_both_platforms() {
        assert_eq!(split_tag("406/worldgen"), (Some(406), Some("worldgen")));
        assert_eq!(split_tag("/game-mechanics"), (None, Some("game-mechanics")));
        assert_eq!(split_tag("9026/"), (Some(9026), None));
        assert_eq!(split_tag(""), (None, None));
    }
}
