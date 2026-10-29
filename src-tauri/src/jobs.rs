use crate::*;
use std::collections::HashMap;
use std::sync::{Mutex, Weak};
use tokio::sync::{Mutex as AsyncMutex, OwnedSemaphorePermit, Semaphore};

pub struct Jobs {
    slots: Arc<Semaphore>,
    pub download_slots: Semaphore,
    active: Mutex<HashMap<String, Arc<AtomicBool>>>,
    locks: Mutex<HashMap<String, Weak<AsyncMutex<()>>>>,
}
impl Default for Jobs {
    fn default() -> Self {
        Self {
            slots: Arc::new(Semaphore::new(3)),
            download_slots: Semaphore::new(24),
            active: Mutex::new(HashMap::new()),
            locks: Mutex::new(HashMap::new()),
        }
    }
}
impl Jobs {
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
