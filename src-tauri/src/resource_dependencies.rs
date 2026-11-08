use crate::*;
use std::collections::{BTreeMap, VecDeque};
use sha1::{Digest, Sha1};

#[derive(Clone)]
struct Entry { project: Value, version: Value, kind: String, name: String, icon: Value }
fn mr_kind(info: &Value, version: &Value) -> Result<String> {
    if version["loaders"].as_array().is_some_and(|a|a.iter().any(|v|v=="datapack")) && version["files"].as_array().is_some_and(|a|a.iter().any(|f|f["filename"].as_str().is_some_and(|s|s.ends_with(".zip")))) { return Ok("datapacks".into()); }
    Ok(match info["project_type"].as_str() { Some("mod")=>"mods",Some("resourcepack")=>"resourcepacks",Some("shader")=>"shaderpacks",_=>return Err("不支持此类型的前置资源".into()) }.into())
}
fn cf_kind(info: &Value) -> Result<String> { Ok(match info["classId"].as_u64(){Some(6)=>"mods",Some(12)=>"resourcepacks",Some(6552)=>"shaderpacks",Some(6945)=>"datapacks",_=>return Err("不支持此类型的前置资源".into())}.into()) }
fn payload(p:&Value,e:&Entry)->Value { let mut v=p.clone();v["project"]=e.project.clone();v["versionId"]=e.version.clone();v["kind"]=json!(e.kind);v["name"]=json!(e.name);v["iconUrl"]=e.icon.clone();v["skipDependencies"]=json!(true);v }
fn installed(core:&Core,p:&Value,e:&Entry)->bool {
    let v=payload(p,e);
    let Ok(path)=resource_downloads::lock_path(core,&v) else{return false};
    let Ok(lock)=read_json(&path) else{return false};
    let pid=e.project.as_str().map(str::to_owned).unwrap_or_else(||e.project.to_string());
    let key=if p["source"]=="curseforge"{format!("cf-{pid}")}else{pid};
    let record=&lock[&key];
    if record["version"].to_string().trim_matches('"')!=e.version.to_string().trim_matches('"'){return false;}
    let Some(name)=record["file"].as_str().filter(|s|safe_name(s).is_ok()) else{return false};
    let Ok(dir)=resource_downloads::install_dir(core,&v) else{return false};
    std::fs::read(dir.join(name)).is_ok_and(|bytes|record["sha1"].as_str()==Some(format!("{:x}",Sha1::digest(bytes)).as_str()))
}
async fn plan(core:&Core,p:&Value)->Result<Vec<Entry>> {
    let config=read_json(&core.instance(string(p,"id")?)?.join("kxl.json"))?;
    let game=string(&config,"version")?;let loader=config["loader"].as_str().unwrap_or("vanilla");
    let kind=string(p,"kind")?;
    let mut queue=VecDeque::from([(p["project"].clone(),p["versionId"].as_str().map(str::to_owned),Some(kind.to_string()))]);
    let mut seen=BTreeMap::new();let mut entries=Vec::new();
    let cf=p["source"]=="curseforge";
    let key=curseforge::configured_key(core,p["curseforgeKey"].as_str().unwrap_or(""));
    while let Some((project,version,root_kind))=queue.pop_front(){
        core.stopped()?;
        if entries.len()>=128{return Err("前置资源过多，请改用整合包安装".into());}
        let (entry,deps)=if cf {
            let pid=project.as_u64().or_else(||project.as_str()?.parse().ok()).ok_or("前置项目 ID 无效")?;
            let info=curseforge::project_info(core,pid,key.as_deref()).await?;
            let kind=root_kind.unwrap_or(cf_kind(&info)?);
            let file=if let Some(vid)=version{curseforge::file_by_id(core,pid,vid.parse().map_err(|_|"前置版本 ID 无效")?,key.as_deref()).await?}else{curseforge::best_file(core,pid,Some(game),if kind=="mods"{Some(loader)}else{None},key.as_deref()).await?};
            if file["modId"].as_u64()!=Some(pid)||file["isAvailable"]==false||!curseforge::compatible(&file,if resource_downloads::needs_game_match(&kind){Some(game)}else{None},if kind=="mods"{Some(loader)}else{None}){return Err("前置文件不属于此项目或不兼容当前实例".into());}
            let deps=file["dependencies"].as_array().into_iter().flatten().filter(|d|d["relationType"]==3).map(|d|(d["modId"].clone(),None,None)).collect::<Vec<_>>();
            (Entry{project:json!(pid),version:json!(file["id"].to_string()),kind,name:info["name"].as_str().unwrap_or("前置资源").into(),icon:info["logo"]["thumbnailUrl"].as_str().or_else(||info["logo"]["url"].as_str()).map(|s|json!(s)).unwrap_or(Value::Null)},deps)
        }else{
            let mut info=if let Some(pid)=project.as_str(){safe_name(pid)?;Some(core.get(&format!("https://api.modrinth.com/v2/project/{pid}")).await?)}else{None};
            let file=if let Some(vid)=version{safe_name(&vid)?;core.get(&format!("https://api.modrinth.com/v2/version/{vid}")).await?}else{
                let pid=project.as_str().ok_or("前置项目 ID 无效")?;
                let resource_kind=root_kind.clone().unwrap_or_else(||if info.as_ref().is_some_and(|v|v["loaders"].as_array().is_some_and(|a|a.len()==1 && a[0]=="datapack")){"datapacks".into()}else{match info.as_ref().and_then(|v|v["project_type"].as_str()){Some("mod")=>"mods",Some("resourcepack")=>"resourcepacks",Some("shader")=>"shaderpacks",_=>"mods"}.into()});
                engine::project_version(core,pid,game,loader,&resource_kind).await?
            };
            let pid=string(&file,"project_id")?;
            if info.is_none(){info=Some(core.get(&format!("https://api.modrinth.com/v2/project/{pid}")).await?);}
            let info=info.unwrap();if info["id"]!=pid{return Err("所选前置版本不属于当前项目".into());}
            let kind=if let Some(kind)=root_kind{kind}else{mr_kind(&info,&file)?};
            if (resource_downloads::needs_game_match(&kind) && !file["game_versions"].as_array().is_some_and(|a|a.iter().any(|v|v==game))) || (kind=="mods"&&!file["loaders"].as_array().is_some_and(|a|a.iter().any(|v|v==loader))){return Err(format!("前置 {} 没有匹配当前实例的版本",info["title"].as_str().unwrap_or(pid)));}
            resource_downloads::modrinth_file(&file,&kind)?;
            let deps=file["dependencies"].as_array().into_iter().flatten().filter(|d|d["dependency_type"]=="required").map(|d|(d["project_id"].clone(),d["version_id"].as_str().map(str::to_owned),None)).collect::<Vec<_>>();
            (Entry{project:json!(pid),version:file["id"].clone(),kind,name:info["title"].as_str().unwrap_or(pid).into(),icon:info["icon_url"].clone()},deps)
        };
        let project=entry.project.to_string();
        if let Some(previous)=seen.insert(project,entry.version.clone()){if previous!=entry.version{return Err("必需前置要求了互不兼容的版本".into());}continue;}
        if p["skipDependencies"]!=true{queue.extend(deps);}
        entries.push(entry);
    }
    Ok(entries)
}
fn shader_notes(core:&Core,p:&Value)->Result<Vec<String>> {
    if p["kind"]!="shaderpacks"{return Ok(vec![]);}
    let config=read_json(&core.instance(string(p,"id")?)?.join("kxl.json"))?;
    let mods=resources::list(core,&json!({"id":p["id"],"kind":"mods"}))?;
    let ready=config["loader"]=="optifine"||config["optifineVersion"].as_str().is_some_and(|s|!s.is_empty())||mods.as_array().into_iter().flatten().filter(|r|r["enabled"]==true).any(|r|r["modIds"].as_array().into_iter().flatten().any(|id|matches!(id.as_str(),Some("iris"|"oculus"|"optifine"))));
    Ok(vec![if ready{"已检测到光影加载器，请在游戏的视频设置中选择光影。".into()}else{"未检测到光影加载器。需要与实例兼容的 Iris、Oculus 或 OptiFine；仅下载光影 ZIP 不会启用光影。已声明的必需前置将同时安装，未列出的加载器请自行安装，并查看作者说明。".into()}])
}
pub async fn preview(core:&Core,p:&Value)->Result<Value>{
    if p["kind"]=="modpacks"{return Ok(json!({"dependencies":[],"notes":["整合包按自身清单安装游戏、加载器与资源。"]}));}
    let entries=plan(core,p).await?;
    let deps=entries.iter().skip(1).map(|e|json!({"project_id":e.project,"versionId":e.version,"name":e.name,"kind":e.kind,"installed":installed(core,p,e)})).collect::<Vec<_>>();
    let mut notes=shader_notes(core,p)?;
    if deps.is_empty() && matches!(p["kind"].as_str(),Some("resourcepacks"|"datapacks")){notes.push("此版本未声明必需前置；普通资源包、数据包可由原版加载，特殊功能请以作者说明为准。".into());}
    Ok(json!({"dependencies":deps,"notes":notes}))
}
pub async fn install(core:&Core,p:&Value)->Result<Value>{
    let entries=plan(core,p).await?;
    let mut files=0;let mut mods_changed=false;
    for entry in entries.iter().rev(){
        if installed(core,p,entry){continue;}
        let v=payload(p,entry);
        let result=if p["source"]=="curseforge"{curseforge::install_project(core,&v).await?}else{engine::install_project(core,&v).await?};
        mods_changed|=entry.kind=="mods" && result["files"].as_u64().unwrap_or(0)>0;
        files+=result["files"].as_u64().unwrap_or(0);
    }
    Ok(json!({"files":files,"modsChanged":mods_changed}))
}
#[cfg(test)]mod tests{use super::*;
 #[test]fn resource_and_mod_dependencies_have_distinct_directories(){assert_eq!(mr_kind(&json!({"project_type":"mod"}),&json!({"loaders":["fabric"],"files":[{"filename":"a.jar"}]})).unwrap(),"mods");assert_eq!(mr_kind(&json!({"project_type":"mod"}),&json!({"loaders":["datapack"],"files":[{"filename":"a.zip"}]})).unwrap(),"datapacks");assert_eq!(cf_kind(&json!({"classId":12})).unwrap(),"resourcepacks");assert_eq!(cf_kind(&json!({"classId":6})).unwrap(),"mods");assert!(cf_kind(&json!({"classId":4471})).is_err());}
}
