use crate::*;
use super::plan::{PackPlan,Resource};
pub const READ:&[&str]=&["get_instance_context","list_instance_mods","search_projects","get_project_versions","check_compatibility","read_config","read_latest_log","detect_hardware","get_game_versions","get_loader_versions"];
pub const WRITE:&[&str]=&["create_instance","install_game","install_loader","install_mods_batch","set_instance_settings","patch_config","install_localization","snapshot_instance","restore_snapshot","launch_verify","export_pack"];
pub fn permission(tool:&str)->Result<&'static str>{if READ.contains(&tool)||super::advanced::READ.contains(&tool){Ok("read")}else if WRITE.contains(&tool)||super::advanced::WRITE.contains(&tool){Ok("write")}else{Err("工坊工具不在白名单中".into())}}
pub fn instance(core:&Core,args:&Value)->Result<PathBuf>{let dir=core.instance(string(args,"id")?)?;super::policy::absolute(&core.root,&dir)?;let cfg=read_json(&super::policy::under(&dir,"kxl.json")?)?;let running=game_directories::running_directory(core,&cfg)?;super::policy::absolute(&core.root,&running)?;if running.canonicalize().map_err(err)?!=dir.canonicalize().map_err(err)?{return Err("工坊只操作独立实例，请先改为全部隔离。".into());}Ok(dir)}
fn bounded(text:String)->String {text.chars().take(16000).collect()}
pub async fn read(core:&Core,tool:&str,args:&Value)->Result<Value>{
 if permission(tool)?!="read"{return Err("规划阶段只允许只读工具".into());}
 match tool {
  "get_instance_context"=>{if args["id"].is_null(){return Ok(json!({"instance":null}));}let root=instance(core,args)?;let c=read_json(&super::policy::under(&root,"kxl.json")?)?;Ok(json!({"name":c["name"],"minecraft":c["version"],"loader":c["loader"],"memoryMb":c["settings"]["memory"]}))},
  "list_instance_mods"=>{let root=instance(core,args)?;let mods=super::policy::under(&root,"mods")?;Ok(json!(std::fs::read_dir(mods).into_iter().flatten().flatten().filter(|e|e.file_type().is_ok_and(|t|t.is_file())).map(|e|e.file_name().to_string_lossy().into_owned()).take(200).collect::<Vec<_>>()))},
  "search_projects"=>{let q=string(args,"query")?;if q.len()>200{return Err("搜索词过长".into());}let source=args["source"].as_str().unwrap_or("modrinth");if !["modrinth","curseforge"].contains(&source){return Err("搜索来源无效".into());}let p=json!({"source":source,"query":q,"kind":args["kind"].as_str().unwrap_or("mod"),"game":args["minecraft"].as_str().unwrap_or(""),"loader":args["loader"].as_str().unwrap_or(""),"page":0});let value=crate::search_projects(core,&p).await?;Ok(json!({"source":source,"hits":value["hits"].as_array().into_iter().flatten().take(5).map(|v|json!({"projectId":v["project_id"],"name":v["title"],"description":v["description"].as_str().unwrap_or("").chars().take(250).collect::<String>()})).collect::<Vec<_>>()}))},
  "get_project_versions"=>versions(core,args).await,
  "get_game_versions"=>{let m=metadata::manifest(core,false).await?;Ok(json!(m["versions"].as_array().into_iter().flatten().filter(|v|v["type"]=="release").take(40).map(|v|v["id"].clone()).collect::<Vec<_>>()))},
  "get_loader_versions"=>{let game=string(args,"minecraft")?;let loader=string(args,"loader")?;safe_name(game)?;let rows=loader_catalog::loaders(core,game,loader,false).await?;Ok(json!(rows.as_array().into_iter().flatten().take(12).cloned().collect::<Vec<_>>()))},
  "check_compatibility"=>{let mut plan=super::plan::parse(args.clone())?;super::plan::validate(core,&mut plan).await?;Ok(serde_json::to_value(plan).map_err(err)?)},
  "read_config"=>{let root=instance(core,args)?;Ok(json!({"text":super::config_patch::read(&root,string(args,"file")?)?}))},
  "read_latest_log"=>{let root=instance(core,args)?;let path=super::policy::under(&root,"logs/latest.log")?;if !path.exists(){return Ok(json!({"text":""}));}use std::io::{Read,Seek,SeekFrom};let mut file=std::fs::File::open(path).map_err(err)?;let size=file.metadata().map_err(err)?.len();file.seek(SeekFrom::Start(size.saturating_sub(16000))).map_err(err)?;let mut bytes=vec![];file.take(16000).read_to_end(&mut bytes).map_err(err)?;Ok(json!({"text":bounded(ai_diagnose::redact(&String::from_utf8_lossy(&bytes)))}))},
  "detect_hardware"=>Ok(super::performance::hardware()),
  _=>Err("工具不可用".into())
 }
}
async fn versions(core:&Core,p:&Value)->Result<Value>{
 let source=p["source"].as_str().unwrap_or("modrinth");let pid=string(p,"projectId")?;safe_name(pid)?;let game=string(p,"minecraft")?;safe_name(game)?;let loader=p["loader"].as_str().unwrap_or("fabric");let kind=p["kind"].as_str().unwrap_or("mods");
 if !["mods","resourcepacks","shaderpacks"].contains(&kind){return Err("资源类型无效".into());}
 if source=="modrinth" {let mut url=reqwest::Url::parse(&format!("https://api.modrinth.com/v2/project/{pid}/version")).map_err(err)?;url.query_pairs_mut().append_pair("game_versions",&json!([game]).to_string());if kind=="mods"{url.query_pairs_mut().append_pair("loaders",&json!([loader]).to_string());}let rows=core.get(url.as_str()).await?;Ok(json!({"source":source,"versions":rows.as_array().into_iter().flatten().take(5).map(|v|json!({"projectId":v["project_id"],"versionId":v["id"],"name":v["name"],"gameVersions":v["game_versions"],"loaders":v["loaders"],"bytes":v["files"][0]["size"]})).collect::<Vec<_>>()}))}
 else if source=="curseforge"{let key=curseforge::configured_key(core,"");let file=curseforge::best_file(core,pid.parse().map_err(|_|"项目 ID 无效")?,Some(game),(kind=="mods").then_some(loader),key.as_deref()).await?;Ok(json!({"source":source,"versions":[{"projectId":pid,"versionId":file["id"].as_u64().map(|v|v.to_string()),"name":file["displayName"],"bytes":file["fileLength"]}]}))}else{Err("资源来源无效".into())}
}
pub fn witnessed(plan:&PackPlan,evidence:&std::collections::HashSet<String>)->Result<()> {for r in plan.mods.iter().chain(&plan.resource_packs).chain(&plan.shaders){if !evidence.contains(&format!("{}:{}:{}",r.source,r.project_id,r.version_id)){return Err(format!("{} 未经过工具查询，请先获取真实项目和版本 ID",r.name));}}Ok(())}
pub fn record(value:&Value,evidence:&mut std::collections::HashSet<String>){for v in value["versions"].as_array().into_iter().flatten(){if let(Some(p),Some(id))=(v["projectId"].as_str(),v["versionId"].as_str()){evidence.insert(format!("{}:{p}:{id}",value["source"].as_str().unwrap_or("modrinth")));}}}
pub fn payload(id:&str,r:&Resource,kind:&str)->Value{json!({"id":id,"source":r.source,"project":if r.source=="curseforge"{json!(r.project_id.parse::<u64>().unwrap_or(0))}else{json!(r.project_id)},"versionId":r.version_id,"name":r.name,"kind":kind})}
#[cfg(test)]mod tests{use super::*;
 #[test]fn whitelist(){assert_eq!(permission("read_config").unwrap(),"read");assert_eq!(permission("patch_config").unwrap(),"write");for v in ["shell","http","read_password","delete_instance","unknown"]{assert!(permission(v).is_err());}}
}
