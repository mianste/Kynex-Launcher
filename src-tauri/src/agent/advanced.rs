use crate::*;
use super::{state,policy,tools};
pub const READ:&[&str]=&["localization_coverage","config_inspect","keybind_check","pack_update_check","migration_plan","share_code_create","share_code_import","performance_analyze","template_list","template_apply","insights_check","insights_list"];
pub const WRITE:&[&str]=&["localization_community","localization_translate","localization_disable","config_apply_template","safe_mode_launch","bisect_mods","server_pack_create","server_pack_verify","repair_instance","export_pack","pack_update_apply","pack_update_rollback","migration_apply","share_code_save","performance_apply","insights_dismiss"];
pub async fn read(core:&Core,tool:&str,args:&Value)->Result<Value>{
 match tool{"template_list"=>return Ok(json!(super::templates::list())),"template_apply"=>return super::templates::apply(string(args,"templateId")?),"share_code_import"=>return super::share::preview(core,string(args,"code")?).await,"insights_check"=>return super::insights::check(core,args["force"]==true).await,"insights_list"=>return super::insights::list(core,args["markRead"]==true),_=>{}}
 let root=tools::instance(core,args)?;
 match tool{
  "pack_update_check"=>super::update::check(core,string(args,"id")?).await,
  "migration_plan"=>super::migration::plan(core,string(args,"id")?,args).await,
  "performance_analyze"=>super::performance::analyze(core,string(args,"id")?,args).await,
  "share_code_create"=>{let cfg=read_json(&root.join("kxl.json"))?;let rows=super::update::identities(core,string(args,"id")?)?;if rows.len()>80{return Err("已识别模组超过 80 个，请先缩小分享范围。".into());}let plan=super::plan::parse(args["plan"].clone()).or_else(|_|{super::plan::parse(json!({"version":1,"name":cfg["name"],"minecraft":cfg["version"],"loader":{"type":cfg["loader"],"version":cfg["loaderVersion"].as_str().unwrap_or("")},"memoryMb":cfg["settings"]["memory"].as_u64().unwrap_or(4096),"mods":rows.iter().map(|r|json!({"source":r["source"],"projectId":r["projectId"],"versionId":r["versionId"],"name":r["name"]})).collect::<Vec<_>>()}))})?;let mut plan=plan;super::plan::validate(core,&mut plan).await?;Ok(json!({"code":super::share::create(&plan)?,"note":"只分享计划和已识别资源 ID，不包含本地模组、账号、路径、日志或存档。"}))},
  "localization_coverage"=>{let rows=super::translation::coverage(&root)?;Ok(json!({"coverage":rows,"estimate":super::translation::estimate(&rows)}))},
  "config_inspect"=>{if let Some(file)=args["file"].as_str(){Ok(json!({"file":file,"text":super::config_patch::read(&root,file)?,"templates":super::config_patch::templates()}))}else{Ok(json!({"templates":super::config_patch::templates()}))}},
  "keybind_check"=>super::config_patch::keybinds(&root),_=>Err("未知只读工具".into())
 }
}
pub async fn execute(core:&Core,p:&Value)->Result<Value>{
 let name=string(p,"tool")?;
 let id=string(p,"taskId")?;
 let record_lock=core.jobs.file_lock(&state::path(core,id)?);
 let record_guard=record_lock.lock().await;
 let mut task=state::load(core,id)?;if task.confirmed_hash!=task.plan_hash||string(p,"planHash")?!=task.plan_hash{return Err("操作需要已确认且未修改的计划。".into());}if state::active(&task.status){return Err("任务仍在执行，请先停止或等待完成。".into());}
 let bound=super::bind(core,&task)?;let args=&p["args"];let root=bound.instance(&task.instance_id)?;
 if name=="config_apply_template"{super::config_patch::check_template(&bound,&task.instance_id,string(args,"templateId")?)?;}
 if p["confirmed"]!=true {
  drop(record_guard);
  if name=="performance_apply"{return super::performance::analyze(&bound,&task.instance_id,args).await;}
  if name=="localization_translate"{return super::translation::translate(&bound,&task.instance_id,false,&args["modIds"]).await;}
  if name=="config_apply_template"{let patches=super::config_patch::template_patches(string(args,"templateId")?)?;let preview=patches.iter().map(|patch|json!({"file":patch.file,"before":super::config_patch::read(&root,&patch.file).unwrap_or_default(),"set":patch.set})).collect::<Vec<_>>();return Ok(json!({"preview":preview,"requiresConfirmation":true}));}
  if name=="export_pack"{return super::export::estimate(&bound,&task.instance_id,args);}
  return Err("此操作需要单独确认后执行。".into());
 }
 if task.plan.as_ref().ok_or("任务缺少计划")?.hash()?!=task.plan_hash{return Err("计划内容已改变，请重新确认。".into());}
 if task.budget["executedSteps"].as_u64().unwrap_or(0)>=40{return Err("此任务已用完 40 步预算，请新建任务。".into());}
 let cancel=super::registered(&task.id)?;let _registration=super::Registration(task.id.clone());let scoped=super::scoped_task(&bound,&task,cancel)?;
 let previous=task.status.clone();task.status=match name{"localization_community"|"localization_translate"=>"translating","repair_instance"=>"repairing","pack_update_apply"=>"updating","migration_apply"=>"migrating",_=>"executing"}.into();task.error.clear();state::save(core,&mut task,"state")?;drop(record_guard);let started=std::time::Instant::now();
 let result=async{if name.starts_with("localization_"){scoped.stage("等待实例空闲",0,0);}let lock=core.jobs.instance_lock(&task.instance_id);let _guard=jobs::wait(&scoped,lock.lock()).await?;scoped.stopped()?;if name.starts_with("localization_"){scoped.stage("备份汉化前的文件",0,0);}task.budget["executedSteps"]=json!(task.budget["executedSteps"].as_u64().unwrap_or(0)+1);let sid=super::snapshot::create(&scoped,&task.instance_id)?;if task.rollback_snapshot.is_empty(){task.rollback_snapshot=sid.clone();}task.snapshots.push(sid);state::save(core,&mut task,"state")?;match name{
  "localization_community"=>super::localization::install_community(&scoped,&task.instance_id).await,
  "localization_translate"=>super::translation::translate(&scoped,&task.instance_id,true,&args["modIds"]).await,
  "localization_disable"=>super::translation::enable(&root,args["enabled"]==true).map(|_|json!({"enabled":args["enabled"]==true})),
  "config_apply_template"=>{let mut out=Ok(json!({"applied":true}));match super::config_patch::template_patches(string(args,"templateId")?){Ok(patches)=>{for patch in patches{if let Err(e)=super::config_patch::apply(&root,&patch){out=Err(e);break;}}},Err(e)=>out=Err(e)}out},
  "safe_mode_launch"|"bisect_mods"=>super::bisect::run(&scoped,&task.instance_id,p["accountId"].as_str().unwrap_or(""),&p["settings"],name=="bisect_mods",true).await,
  "server_pack_create"=>{let plan=task.plan.clone().ok_or("任务缺少计划")?;super::server_pack::create(&scoped,&mut task,&plan).await},
  "server_pack_verify"=>{let server=string(args,"serverId")?;if !task.results.get("server_pack_create").is_some_and(|v|v["serverId"]==server){return Err("服务端不属于此任务。".into());}task.snapshots.push(super::snapshot::server(&scoped,&task.instance_id,server)?);state::save(core,&mut task,"state")?;super::server_pack::verify(&scoped,server,args["acceptEula"]==true).await},
  "repair_instance"=>{let plan=task.plan.clone().ok_or("任务缺少计划")?;super::repair::run(&scoped,&mut task,&plan,p["accountId"].as_str().unwrap_or(""),&p["settings"]).await.map(|report|json!({"verified":true,"report":report}))},
  "export_pack"=>{let path=policy::under(&scoped.root,&format!("exports/{}.mrpack",task.id))?;super::export::run(&scoped,&task.instance_id,&path,args).await},
  "pack_update_apply"=>super::update::apply(&scoped,&mut task,args,p["accountId"].as_str().unwrap_or(""),&p["settings"]).await,
  "pack_update_rollback"=>{let sid=task.results.get("pack_update_apply").and_then(|v|v["rollbackSnapshotId"].as_str()).ok_or("没有可回滚的整合包更新")?.to_owned();let before=super::snapshot::restore(&scoped,&task.instance_id,&sid)?;task.snapshots.push(before);Ok(json!({"restored":true,"note":"已恢复更新前的文件和整合包来源。"}))},
  "migration_apply"=>super::migration::apply(&scoped,&mut task,args,p["accountId"].as_str().unwrap_or(""),&p["settings"]).await,
  "performance_apply"=>super::performance::apply(&scoped,&mut task,args,p["accountId"].as_str().unwrap_or(""),&p["settings"]).await,
  "share_code_save"=>{let code=string(args,"code")?;super::share::decode(code)?;let path=policy::under(&scoped.root,&format!("exports/{}.kxlpack",task.id))?;std::fs::create_dir_all(path.parent().unwrap()).map_err(err)?;std::fs::write(path,code).map_err(err)?;Ok(json!({"saved":true,"location":"当前游戏目录 exports/"}))},
  "insights_dismiss"=>super::insights::dismiss(&scoped,string(args,"key")?,args["forever"]==true),
  _=>Err("此写工具未注册。".into())
 }}.await;
 task.budget["downloadedBytes"]=json!(scoped.agent_policy.as_ref().unwrap().bytes.load(Ordering::Relaxed));task.budget["spentMs"]=json!(task.budget["spentMs"].as_u64().unwrap_or(0)+started.elapsed().as_millis() as u64);
 task.audit.push(state::Audit{tool:name.into(),result:if result.is_ok(){"完成"}else{"失败，已保留操作前快照"}.into(),elapsed_ms:started.elapsed().as_millis() as u64});
 match &result{Ok(value)=>{task.results.insert(name.into(),value.clone());task.status=if previous=="done"||(task.maintenance && matches!(name,"localization_translate"|"localization_community") && value["changed"]!=false)||(name=="repair_instance"&&task.current_step>=9&&value["verified"]==true){"done"}else{&previous}.into();task.error.clear();},Err(e)=>{task.status=if scoped.cancel.load(Ordering::SeqCst){"cancelled"}else{"failed"}.into();task.error=super::clean(e);}}
 state::save(core,&mut task,if result.is_ok(){"done"}else{"error"})?;result
}
