use crate::*;
use std::collections::HashMap;
use std::sync::{Mutex, Weak};
use tokio::sync::{Mutex as AsyncMutex, OwnedSemaphorePermit, Semaphore};

pub const TRANSLATION_CONCURRENCY: usize = 3;

pub(crate) fn download_completion(action: &str, payload: &Value, result: &Value) -> Option<Value> {
    let map = action == "install_map" || action == "install_project" && payload["kind"] == "worlds";
    let detail = if map {
        match result["status"].as_str()? {
            "installed" => None,
            "downloaded" => Some(result["note"].as_str().unwrap_or("文件已保存。").to_owned()),
            _ => return None,
        }
    } else {
        match action {
            "download_resource_file" => Some("文件已保存。".into()),
            "schematic_catalog_download" | "install_java" if result["alreadyPresent"] == true => {
                Some("已存在，可直接使用。".into())
            }
            "install_project" if result["files"].as_u64() == Some(0) => {
                Some("已存在，可直接使用。".into())
            }
            "install_project" if payload["kind"] == "datapacks" => payload["world"]
                .as_str()
                .map(|world| format!("已添加到「{world}」，请在游戏中启用。")),
            "install" | "install_project" | "import_pack" | "install_java" | "schematic_catalog_download" => None,
            "update_mods" => {
                let count = result["updated"].as_u64().filter(|&count| count > 0)?;
                Some(format!("已更新 {count} 个模组。"))
            }
            _ => return None,
        }
    };
    Some(json!({"title": "安装完成", "detail": detail}))
}

pub struct Jobs {
    slots: Arc<Semaphore>,
    pub download_slots: Semaphore,
    pub mod_scan_slots: Semaphore,
    pub translation_slots: Semaphore,
    active: Mutex<HashMap<String, Arc<AtomicBool>>>,
    locks: Mutex<HashMap<String, Weak<AsyncMutex<()>>>>,
    mod_scans: Mutex<HashMap<String, (u64, bool)>>,
}
impl Default for Jobs {
    fn default() -> Self {
        Self {
            slots: Arc::new(Semaphore::new(3)),
            download_slots: Semaphore::new(24),
            mod_scan_slots: Semaphore::new(2),
            translation_slots: Semaphore::new(TRANSLATION_CONCURRENCY),
            active: Mutex::new(HashMap::new()),
            locks: Mutex::new(HashMap::new()),
            mod_scans: Mutex::new(HashMap::new()),
        }
    }
}
impl Jobs {
    pub fn request_mod_scan(&self,id:&str)->bool{
        let mut scans=self.mod_scans.lock().unwrap();let scan=scans.entry(id.into()).or_insert((0,false));
        scan.0+=1;if scan.1{return false;}scan.1=true;true
    }
    pub fn mod_scan_generation(&self,id:&str)->u64{self.mod_scans.lock().unwrap().get(id).map(|v|v.0).unwrap_or(0)}
    pub fn finish_mod_scan(&self,id:&str,generation:u64)->bool{
        let mut scans=self.mod_scans.lock().unwrap();let Some(scan)=scans.get_mut(id)else{return true};
        if scan.0!=generation{return false;}scan.1=false;true
    }
    fn lock(&self, key: String) -> Arc<AsyncMutex<()>> {
        let mut locks = self.locks.lock().unwrap();
        locks.retain(|_, lock| lock.strong_count() > 0);
        if let Some(lock) = locks.get(&key).and_then(Weak::upgrade) {
            return lock;
        }
        let lock = Arc::new(AsyncMutex::new(()));
        locks.insert(key, Arc::downgrade(&lock));
        lock
    }
    pub fn file_lock(&self, path: &Path) -> Arc<AsyncMutex<()>> {
        self.lock(format!("file:{}", path.to_string_lossy().to_lowercase()))
    }
    pub fn instance_lock(&self, id: &str) -> Arc<AsyncMutex<()>> {
        self.lock(format!("instance:{id}"))
    }
    pub fn start(self: &Arc<Self>, action: &str, payload: &Value) -> Job {
        let id = uuid::Uuid::new_v4().to_string();
        let cancel = Arc::new(AtomicBool::new(false));
        self.active
            .lock()
            .unwrap()
            .insert(id.clone(), cancel.clone());
        let target = if let Some(id) = payload["id"].as_str() {
            format!("instance:{id}")
        } else if action == "install_java" {
            "java-runtime".into()
        } else {
            format!(
                "new:{}",
                payload["name"]
                    .as_str()
                    .or(payload["path"].as_str())
                    .unwrap_or(action)
            )
        };
        Job {
            id,
            cancel,
            target: self.lock(target),
            jobs: self.clone(),
        }
    }
    pub fn cancel(&self, id: Option<&str>) {
        for (key, cancel) in self.active.lock().unwrap().iter() {
            if id.is_none_or(|id| id == key) {
                cancel.store(true, Ordering::Relaxed);
            }
        }
    }
}
pub struct Job {
    pub id: String,
    pub cancel: Arc<AtomicBool>,
    pub target: Arc<AsyncMutex<()>>,
    jobs: Arc<Jobs>,
}
pub async fn wait<T>(core: &Core, future: impl std::future::Future<Output = T>) -> Result<T> {
    tokio::pin!(future);
    loop {
        tokio::select! { value = &mut future => return Ok(value), _ = tokio::time::sleep(std::time::Duration::from_millis(100)) => core.stopped()?, }
    }
}
impl Job {
    pub async fn acquire(&self, core: &Core) -> Result<OwnedSemaphorePermit> {
        let future = self.jobs.slots.clone().acquire_owned();
        tokio::pin!(future);
        loop {
            tokio::select! { permit = &mut future => return permit.map_err(err), _ = tokio::time::sleep(std::time::Duration::from_millis(100)) => core.stopped()?, }
        }
    }
}
impl Drop for Job {
    fn drop(&mut self) {
        self.jobs.active.lock().unwrap().remove(&self.id);
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn successful_resource_jobs_share_the_installation_completion_title() {
        for kind in ["mods", "resourcepacks", "shaderpacks", "datapacks", "modpacks"] {
            assert_eq!(download_completion("install_project", &json!({"kind":kind}), &json!({"files":1})).unwrap()["title"], "安装完成");
        }
        for action in ["install", "install_java", "import_pack", "schematic_catalog_download"] {
            assert_eq!(download_completion(action, &json!({}), &json!({})).unwrap()["title"], "安装完成");
        }
        assert_eq!(download_completion("install_map", &json!({}), &json!({"status":"installed"})).unwrap()["title"], "安装完成");
        assert_eq!(
            download_completion("install_map", &json!({}), &json!({"status":"downloaded","note":"仅保存压缩包"})),
            Some(json!({"title":"安装完成","detail":"仅保存压缩包"})),
        );
        assert_eq!(
            download_completion("download_resource_file", &json!({}), &json!({})),
            Some(json!({"title":"安装完成","detail":"文件已保存。"})),
        );
        assert_eq!(
            download_completion("install_project", &json!({"kind":"mods"}), &json!({"files":0})),
            Some(json!({"title":"安装完成","detail":"已存在，可直接使用。"})),
        );
        assert_eq!(
            download_completion("install_java", &json!({}), &json!({"alreadyPresent":true})),
            Some(json!({"title":"安装完成","detail":"已存在，可直接使用。"})),
        );
        assert!(download_completion("install_map", &json!({}), &json!({"status":"external"})).is_none());
        assert!(download_completion("launch", &json!({}), &json!({})).is_none());
        assert!(download_completion("update_mods", &json!({}), &json!({"updated":0})).is_none());
    }
    #[test]fn installed_mod_scans_coalesce_per_instance(){
        let jobs=Jobs::default();assert!(jobs.request_mod_scan("a"));let first=jobs.mod_scan_generation("a");
        assert!(!jobs.request_mod_scan("a"));assert!(jobs.request_mod_scan("b"));assert!(!jobs.finish_mod_scan("a",first));
        let next=jobs.mod_scan_generation("a");assert!(jobs.finish_mod_scan("a",next));assert!(jobs.request_mod_scan("a"));
    }
    #[tokio::test]
    async fn jobs_are_independent_and_same_target_serializes() {
        let jobs = Arc::new(Jobs::default());
        let a = jobs.start("install_project", &json!({"id":"a"}));
        let b = jobs.start("install_project", &json!({"id":"b"}));
        let same = jobs.start("launch", &json!({"id":"a"}));
        let _lock = a.target.lock().await;
        assert!(same.target.try_lock().is_err());
        assert!(b.target.try_lock().is_ok());
        jobs.cancel(Some(&a.id));
        assert!(a.cancel.load(Ordering::Relaxed));
        assert!(!b.cancel.load(Ordering::Relaxed));
        assert!(!same.cancel.load(Ordering::Relaxed));
        assert!(jobs.slots.try_acquire_many(3).is_ok());
        drop(_lock);
        drop(a);
        assert_eq!(jobs.active.lock().unwrap().len(), 2);
    }
    #[tokio::test]
    async fn shared_file_downloads_use_the_same_lock() {
        let jobs = Jobs::default();
        let a = jobs.file_lock(Path::new("libraries/a.jar"));
        let b = jobs.file_lock(Path::new("libraries/a.jar"));
        let _guard = a.lock().await;
        assert!(b.try_lock().is_err());
    }
    #[tokio::test]
    async fn resource_download_budget_is_shared_and_waiting_is_cancellable() {
        let root = tempfile::tempdir().unwrap();
        let core = Core::new(root.path().into(), Arc::new(|_| {})).unwrap();
        let permits = core.jobs.download_slots.acquire_many(24).await.unwrap();
        let other_job = core.clone();
        let cancelled = other_job.cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(30)).await;
            cancelled.store(true, Ordering::SeqCst);
        });
        let result = tokio::time::timeout(std::time::Duration::from_millis(500), wait(&other_job, other_job.jobs.download_slots.acquire())).await.unwrap();
        assert_eq!(result.unwrap_err(), "任务已取消");
        drop(permits);
        assert_eq!(core.jobs.download_slots.available_permits(),24);
    }
}
