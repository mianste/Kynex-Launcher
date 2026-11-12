use crate::*;
use super::{state::{self,Task,Step},plan::PackPlan,snapshot,policy,tools};
const STEPS:&[(&str,&str)]=&[("创建执行前快照","snapshot_instance"),("创建独立实例","create_instance"),("安装游戏与加载器","install_game"),("核验加载器","install_loader"),("安装模组及必需前置","install_mods_batch"),("安装资源包与光影","install_resources"),("社区汉化与中文","install_localization"),("写基础配置","patch_config"),("设置内存和 Java","set_instance_settings"),("启动验证","launch_verify"),("完成","finish")];
pub fn steps()->Vec<Step>{STEPS.iter().map(|(name,_)|Step{name:(*name).into(),status:"pending".into(),elapsed_ms:0,detail:String::new(),snapshot_id:String::new()}).collect()}
pub async fn run(core:&Core,task:&mut Task,account:&str,settings:&Value)->Result<()> {
 let p=task.plan.clone().ok_or("任务缺少计划")?;if p.hash()?!=task.confirmed_hash{return Err("计划在确认后发生变化，请重新确认".into());}
 let instance=core.instance(&task.instance_id)?;policy::absolute(&core.root,&instance)?;
 let lock=core.jobs.instance_lock(&task.instance_id);let _guard=jobs::wait(core,lock.lock()).await?;
 if task.steps.is_empty(){task.steps=steps();}
 for index in 0..STEPS.len(){
  if task.steps[index].status=="done"{continue;}
  if task.budget["executedSteps"].as_u64().unwrap_or(0)>=40{return Err("此任务已用完 40 步预算，请缩小计划。".into());}
  task.budget["executedSteps"]=json!(task.budget["executedSteps"].as_u64().unwrap_or(0)+1);
  core.stopped()?;task.current_step=index;task.status=if index==9{"verifying"}else{"executing"}.into();task.steps[index].status="running".into();state::save(core,task,"step")?;
  let started=std::time::Instant::now();
  let result=async{
   let sid=snapshot::create(core,&task.instance_id)?;if task.rollback_snapshot.is_empty(){task.rollback_snapshot=sid.clone();}task.snapshots.push(sid.clone());task.steps[index].snapshot_id=sid;state::save(core,task,"state")?;
   action(core,task,&p,index,account,settings).await
  }.await;
  task.steps[index].elapsed_ms=started.elapsed().as_millis() as u64;
  task.budget["spentMs"]=json!(task.budget["spentMs"].as_u64().unwrap_or(0)+task.steps[index].elapsed_ms);
  let bytes=core.agent_policy.as_ref().map(|p|p.bytes.load(Ordering::Relaxed)).unwrap_or(0);task.budget["downloadedBytes"]=json!(bytes);
  match result{Ok(detail)=>{task.steps[index].status="done".into();task.steps[index].detail=detail;task.audit.push(state::Audit{tool:STEPS[index].1.into(),result:"完成".into(),elapsed_ms:task.steps[index].elapsed_ms});state::save(core,task,"step")?;},Err(e)=>{task.steps[index].status="failed".into();task.steps[index].detail=ai_diagnose::redact(&e);return Err(e);}}
 }
 task.status="done".into();task.error.clear();state::save(core,task,"done")
}
async fn action(core:&Core,task:&mut Task,p:&PackPlan,index:usize,account:&str,settings:&Value)->Result<String>{
 let root=core.instance(&task.instance_id)?;
 match index{
  0=>Ok("已保存白名单配置与资源，存档不会进入快照。".into()),
  1=>{let file=policy::under(&root,"kxl.json")?;if file.exists(){let c=read_json(&file)?;if c["agentTaskId"]!=task.id{return Err("目标实例不属于此任务，已拒绝覆盖。".into());}}else{let mut s=engine::defaults();s["memory"]=json!(p.memory_mb);write_json(&file,&json!({"id":task.instance_id,"name":p.name,"version":p.minecraft,"loader":p.loader.kind,"game":"java","settings":s,"agentTaskId":task.id}))?;}Ok("已创建任务专属实例，现有实例不会被覆盖。".into())},
  2=>{
   let config=root.join("kxl.json");let already=read_json(&config).ok().is_some_and(|v|v["version"]==p.minecraft&&v["loader"]==p.loader.kind&&v["agentTaskId"]==task.id)&&root.join("version.json").is_file();
   if already{let v=read_json(&root.join("version.json"))?;if engine::cached_file_valid(&root.join("client.jar"),v["downloads"]["client"]["sha1"].as_str().unwrap_or("")).await?{return Ok("复用本任务已经安装并校验的游戏与加载器。".into());}}
   let mut s=engine::defaults();s["memory"]=json!(p.memory_mb);s["language"]=json!("zh_cn");
   let result=engine::install(core,&json!({"agentInstanceId":task.instance_id,"name":p.name,"version":p.minecraft,"loader":p.loader.kind,"loaderVersion":p.loader.version,"settings":s})).await;
   let mut value=result?;value["agentTaskId"]=json!(task.id);write_json(&config,&value)?;Ok("游戏及对应加载器已按真实版本目录安装。".into())
  },
  3=>{let v=read_json(&policy::under(&root,"kxl.json")?)?;if v["version"]!=p.minecraft||v["loader"]!=p.loader.kind{return Err("安装结果与确认的游戏/加载器不一致".into());}Ok("加载器与确认计划一致。".into())},
  4=>batch(core,task,&p.mods,"mods",p).await,
  5=>{let a=batch(core,task,&p.resource_packs,"resourcepacks",p).await?;let b=batch(core,task,&p.shaders,"shaderpacks",p).await?;Ok(format!("{a}；{b}"))},
  6=>super::localization::install(core,&task.instance_id,p).await,
  7=>{if p.config_patches.iter().any(|patch|patch.file!="options.txt"&&!root.join(&patch.file).exists()){if account.is_empty(){return Err("模组默认配置尚未生成，请选择账号后继续；将先启动生成默认配置，再停止并应用补丁。".into());}super::verify::run(core,&task.instance_id,account,settings).await?;}super::config_patch::options(&root,p)?;Ok("已只修改计划明确列出的配置键，并完成写后校验；后续会再次验证。".into())},
  8=>{let file=policy::under(&root,"kxl.json")?;let mut value=read_json(&file)?;value["settings"]["memory"]=json!(p.memory_mb);value["settings"]["java"]=json!("");value["settings"]["isolation"]=json!("all");write_json(&file,&value)?;Ok(format!("内存 {} MB；Java 按游戏版本自动匹配。",p.memory_mb))},
  9=>{if account.is_empty(){return Err("请选择一个游戏账号后继续启动验证；已安装内容和快照会保留。".into());}if task.mode=="auto"{super::repair::run(core,task,p,account,settings).await}else{super::verify::run(core,&task.instance_id,account,settings).await}},
  10=>Ok("整合包已搭建，启动验证通过。可在实例库管理或导出。".into()),
  _=>Err("步骤超过白名单".into())
 }
}
async fn batch(core:&Core,task:&mut Task,items:&[super::plan::Resource],kind:&str,p:&PackPlan)->Result<String>{
 let mut errors=Vec::new();let mut count=0;
 for r in items{
  core.stopped()?;super::plan::resource(core,r,&p.minecraft,&p.loader.kind,kind).await?;let payload=tools::payload(&task.instance_id,r,kind);
  let preview=resource_dependencies::preview(core,&payload).await?;
  let current=std::fs::read_dir(core.instance(&task.instance_id)?.join("mods")).into_iter().flatten().flatten().filter(|e|e.path().extension().is_some_and(|e|e=="jar")).count();
  let deps=preview["dependencies"].as_array().into_iter().flatten().filter(|r|r["kind"]=="mods"&&r["installed"]!=true).count();
  if current+deps+usize::from(kind=="mods")>80{return Err("加入必需前置后超过 80 模组预算，已停止。".into());}
  match resource_dependencies::install(core,&payload).await{Ok(_)=>count+=1,Err(e)=>{core.stopped()?;errors.push(format!("{}：{}",r.name,ai_diagnose::redact(&e)));}}
 }
 if !errors.is_empty(){return Err(format!("已处理其余可安装资源，但 {} 项安装失败，后续步骤已停止；可继续或回滚。\n{}",errors.len(),errors.join("\n")));}Ok(format!("{kind}：{count} 项及其必需前置已处理。"))
}
