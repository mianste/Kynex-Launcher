use crate::*;
use serde::{Deserialize,Serialize};
use super::plan::PackPlan;
use std::collections::HashMap;
use std::sync::{Mutex,OnceLock};
#[derive(Clone,Serialize,Deserialize,Debug)]
#[serde(rename_all="camelCase")]
pub struct Step {pub name:String,pub status:String,#[serde(default)]pub elapsed_ms:u64,#[serde(default)]pub detail:String,#[serde(default)]pub snapshot_id:String}
#[derive(Clone,Serialize,Deserialize,Debug)]
#[serde(rename_all="camelCase")]
pub struct Audit {pub tool:String,pub result:String,pub elapsed_ms:u64}
#[derive(Clone,Serialize,Deserialize,Debug)]
#[serde(rename_all="camelCase")]
pub struct Task {
 pub id:String,pub mode:String,pub status:String,pub request:String,pub plan:Option<PackPlan>,pub plan_hash:String,pub steps:Vec<Step>,pub current_step:usize,
 pub budget:Value,pub audit:Vec<Audit>,pub created_at:String,pub updated_at:String,pub error:String,
 pub directory_id:String,pub instance_id:String,pub snapshots:Vec<String>,#[serde(default)]pub confirmed_hash:String,#[serde(default)]pub rollback_snapshot:String,#[serde(default)]pub root_hash:String,#[serde(default)]pub results:std::collections::BTreeMap<String,Value>,#[serde(default)]pub maintenance:bool,
}
pub fn runtime()->&'static Mutex<HashMap<String,Arc<AtomicBool>>>{static R:OnceLock<Mutex<HashMap<String,Arc<AtomicBool>>>>=OnceLock::new();R.get_or_init(Mutex::default)}
pub fn path(core:&Core,id:&str)->Result<PathBuf>{uuid::Uuid::parse_str(id).map_err(|_|"任务 ID 无效")?;super::policy::under(&core.data_root,&format!("agent-tasks/{id}.json"))}
pub fn emit(core:&Core,task:&Task,kind:&str){(core.progress)(json!({"agent":true,"event":{"taskId":task.id,"type":kind,"task":task}}));}
pub fn save(core:&Core,task:&mut Task,kind:&str)->Result<()>{task.updated_at=super::policy::now().to_string();let target=path(core,&task.id)?;std::fs::create_dir_all(target.parent().unwrap()).map_err(err)?;let tmp=target.with_extension("tmp");write_json(&tmp,&serde_json::to_value(&task).map_err(err)?)?;std::fs::rename(&tmp,target).map_err(err)?;emit(core,task,kind);Ok(())}
pub fn load(core:&Core,id:&str)->Result<Task>{let file=path(core,id)?;if std::fs::metadata(&file).map_err(|_|"找不到任务，请重新打开工坊")?.len()>2*1024*1024{return Err("任务文件过大或损坏".into());}serde_json::from_value(read_json(&file)?).map_err(|_|"任务文件损坏，请重新生成计划".into())}
pub async fn list(core: &Core) -> Result<Vec<Task>> {
    let dir = core.data_root.join("agent-tasks");
    let mut result = Vec::new();
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let file = entry.path();
        if file.extension().is_none_or(|ext| ext != "json") { continue; }
        let Some(id) = file.file_stem().and_then(|name| name.to_str()) else { continue };
        let Ok(file) = path(core, id) else { continue };
        let lock = core.jobs.file_lock(&file);
        let _guard = lock.lock().await;
        let mut task = {
            let runtime = runtime().lock().map_err(err)?;
            let Ok(mut task) = load(core, id) else { continue };
            if !active(&task.status) || runtime.contains_key(id) {
                result.push(task);
                continue;
            }
            task.status = "failed".into();
            task.error = "任务在上次运行中中断，已完成步骤会保留；可继续或回滚。".into();
            task
        };
        save(core, &mut task, "state")?;
        result.push(task);
    }
    result.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(result)
}

pub async fn delete(core: &Core, id: &str) -> Result<()> {
    let file = path(core, id)?;
    let lock = core.jobs.file_lock(&file);
    let _guard = lock.lock().await;
    if runtime().lock().map_err(err)?.contains_key(id) {
        return Err("请先停止任务并等待当前步骤结束。".into());
    }
    match std::fs::remove_file(file) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("无法删除任务记录：{error}")),
    }
}
pub fn active(s:&str)->bool{matches!(s,"planning"|"classifying"|"executing"|"translating"|"verifying"|"repairing"|"updating"|"migrating")}
pub fn approve(task:&mut Task,hash:&str)->Result<()> {if task.plan.as_ref().ok_or("任务没有计划")?.hash()?!=hash||hash!=task.plan_hash{return Err("计划已改变，请查看新计划并重新确认".into());}if !matches!(task.status.as_str(),"awaiting_approval"|"failed"|"cancelled"){return Err("此任务当前不能开始或继续".into());}task.confirmed_hash=hash.into();Ok(())}
#[cfg(test)]mod tests{use super::*;
 #[tokio::test]async fn path_rejects_and_status(){let t=tempfile::tempdir().unwrap();let c=Core::new(t.path().into(),Arc::new(|_|{})).unwrap();assert!(path(&c,"../x").is_err());assert!(active("planning"));assert!(!active("awaiting_approval"));assert!(list(&c).await.unwrap().is_empty());}
}
