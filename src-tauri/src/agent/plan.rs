use crate::*;
use serde::{Deserialize,Serialize};
use std::collections::BTreeMap;
use sha2::{Digest,Sha256};
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Loader {#[serde(rename="type")]pub kind:String,#[serde(default)]pub version:String}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Resource {pub source:String,pub project_id:String,pub version_id:String,pub name:String,#[serde(default="both")]pub side:String,#[serde(default)]pub reason:String,#[serde(default)]pub required:bool}
fn both()->String{"both".into()}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Localization {#[serde(default="none")]pub mode:String,#[serde(default)]pub note:String}
fn none()->String{"none".into()}
impl Default for Localization{fn default()->Self{Self{mode:none(),note:String::new()}}}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Patch {pub file:String,pub format:String,pub set:BTreeMap<String,Value>}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct PackPlan {
 pub version:u32,pub name:String,pub minecraft:String,pub loader:Loader,pub memory_mb:u64,#[serde(default="auto")]pub java:String,
 #[serde(default)]pub mods:Vec<Resource>,#[serde(default)]pub resource_packs:Vec<Resource>,#[serde(default)]pub shaders:Vec<Resource>,
 #[serde(default)]pub localization:Localization,#[serde(default)]pub options:BTreeMap<String,Value>,#[serde(default)]pub config_patches:Vec<Patch>,#[serde(default)]pub notes:Vec<String>,
 #[serde(default)]pub estimated_download_bytes:u64,#[serde(default)]pub warnings:Vec<String>,
}
fn auto()->String{"auto".into()}
impl PackPlan {
 pub fn hash(&self)->Result<String>{Ok(format!("{:x}",Sha256::digest(serde_json::to_vec(self).map_err(err)?)))}
 pub fn check(&self)->Result<()> {
  if self.version!=1||self.name.trim().is_empty()||self.name.chars().count()>80{return Err("计划名称或 schema 版本无效".into());}
  if self.java!="auto" {return Err("工坊 P0 仅允许自动选择 Java".into());}
  if !(512..=65536).contains(&self.memory_mb){return Err("内存须在 512–65536 MB 之间".into());}
  if self.mods.len()>80||self.resource_packs.len()+self.shaders.len()>20||self.config_patches.len()>20||self.estimated_download_bytes>super::policy::MAX_BYTES{return Err("计划超过模组、资源、配置或 2 GB 下载预算".into());}
  safe_name(&self.minecraft)?;if !["vanilla","fabric","quilt","forge","neoforge","optifine"].contains(&self.loader.kind.as_str()){return Err("加载器不受支持".into());}
  if !["cfpa","ai","both","none"].contains(&self.localization.mode.as_str()){return Err("汉化模式无效。".into());}
  if self.notes.len()>40||self.notes.iter().any(|s|s.len()>2000){return Err("计划说明过长".into());}
  for (key,value) in &self.options {super::config_patch::check_option(key,value)?;}
  for patch in &self.config_patches {super::config_patch::validate(patch)?;}
  let mut seen=std::collections::HashSet::new();
  for r in self.mods.iter().chain(&self.resource_packs).chain(&self.shaders){
   if !["modrinth","curseforge"].contains(&r.source.as_str())||!["client","server","both"].contains(&r.side.as_str())||r.name.len()>240||r.reason.len()>2000{return Err("资源来源、侧别或说明无效".into());}
   safe_name(&r.project_id)?;safe_name(&r.version_id)?;
   if !seen.insert(format!("{}:{}",r.source,r.project_id)){return Err("计划包含重复资源项目".into());}
  }Ok(())
 }
}
pub fn parse(value:Value)->Result<PackPlan>{let plan:PackPlan=serde_json::from_value(value).map_err(|_|"计划 JSON 缺少字段或包含不支持的字段")?;plan.check()?;Ok(plan)}
pub fn compatible_mr(v:&Value,r:&Resource,game:&str,loader:&str,kind:&str)->Result<u64>{
 if v["project_id"]!=r.project_id||v["id"]!=r.version_id||!v["game_versions"].as_array().is_some_and(|a|a.iter().any(|v|v==game))||(kind=="mods"&&!v["loaders"].as_array().is_some_and(|a|a.iter().any(|v|v==loader))){return Err(format!("{} 的真实版本与游戏/加载器不匹配",r.name));}
 let f=resource_downloads::modrinth_file(v,kind)?;super::policy::url(string(f,"url")?)?;
 let hash=string(&f["hashes"],"sha1")?;if hash.len()!=40||!hash.bytes().all(|b|b.is_ascii_hexdigit()){return Err("资源缺少可靠哈希".into());}
 f["size"].as_u64().filter(|n|*n>0).ok_or_else(||"资源缺少下载体积信息".into())
}
pub async fn resource(core:&Core,r:&Resource,game:&str,loader:&str,kind:&str)->Result<(u64,Value)> {
 if r.source=="modrinth" {
  let v=core.get(&format!("https://api.modrinth.com/v2/version/{}",r.version_id)).await?;
  let n=compatible_mr(&v,r,game,loader,kind)?;Ok((n,v))
 }else{
  let pid=r.project_id.parse().map_err(|_|"CurseForge 项目 ID 无效")?;let vid=r.version_id.parse().map_err(|_|"CurseForge 版本 ID 无效")?;
  let key=curseforge::configured_key(core,"");let v=curseforge::file_by_id(core,pid,vid,key.as_deref()).await?;
  if v["modId"]!=pid||v["id"]!=vid||v["isAvailable"]==false||!curseforge::compatible(&v,Some(game),(kind=="mods").then_some(loader)){return Err(format!("{} 的 CurseForge 版本不兼容",r.name));}
  super::policy::url(&curseforge::download_url(&v)?)?;if curseforge::file_hash(&v).len()!=40{return Err("CurseForge 文件缺少 SHA1 校验".into());}
  Ok((v["fileLength"].as_u64().filter(|n|*n>0).ok_or("缺少资源下载体积")?,v))
 }
}
pub async fn validate(core:&Core,plan:&mut PackPlan)->Result<()> {
 plan.check()?;
 let base=metadata::version(core,&plan.minecraft).await?;
 if base["id"]!=plan.minecraft{return Err("游戏版本不存在".into());}
 if plan.loader.kind!="vanilla"{let rows=loader_catalog::loaders(core,&plan.minecraft,&plan.loader.kind,false).await?;if !rows.as_array().is_some_and(|a|a.iter().any(|v|v.as_str()==Some(&plan.loader.version))){return Err("加载器版本与游戏不兼容或不存在".into());}}
 let mut bytes=base["downloads"]["client"]["size"].as_u64().unwrap_or(0);
 for lib in base["libraries"].as_array().into_iter().flatten().filter(|v|engine::allowed(v)){bytes+=lib["downloads"]["artifact"]["size"].as_u64().unwrap_or(0);}
 let mut unknown=false;
 if let Some(url)=base["assetIndex"]["url"].as_str(){let index=core.get(url).await?;bytes+=index["objects"].as_object().into_iter().flatten().map(|(_,v)|v["size"].as_u64().unwrap_or(0)).sum::<u64>();}else{unknown=true;}
 for (kind,items) in [("mods",&plan.mods),("resourcepacks",&plan.resource_packs),("shaderpacks",&plan.shaders)]{for r in items{core.stopped()?;bytes=bytes.checked_add(resource(core,r,&plan.minecraft,&plan.loader.kind,kind).await?.0).ok_or("下载体积溢出")?;}}
 plan.estimated_download_bytes=bytes;
 plan.warnings.retain(|s|!s.starts_with("预算提示："));
 plan.warnings.push("预算提示：加载器、Java、汉化和额外前置的体积将在实际下载时累计，累计超过 2 GB 会停止。".into());
 if unknown{plan.warnings.push("部分游戏文件体积无法预估，将按实际下载量执行预算。".into());}
 if plan.mods.iter().any(|r|r.side=="server"){return Err("客户端整合包不能直接安装仅服务端模组，请调整计划。".into());}
 plan.check()
}
#[cfg(test)] mod tests{use super::*;
 pub fn fixture()->Value{json!({"version":1,"name":"测试包","minecraft":"1.20.1","loader":{"type":"fabric","version":"0.16.9"},"memoryMb":4096,"mods":[]})}
 #[test] fn schema_and_budgets(){let p=parse(fixture()).unwrap();assert_eq!(p.hash().unwrap(),p.clone().hash().unwrap());for (k,v) in [("memoryMb",json!(511)),("estimatedDownloadBytes",json!(super::super::policy::MAX_BYTES+1)),("shell",json!("cmd")),("version",json!(2))]{let mut f=fixture();f[k]=v;assert!(parse(f).is_err());}assert!(parse(json!({"name":"x"})).is_err());}
 #[test] fn false_ids_or_mismatches(){let r=Resource{source:"modrinth".into(),project_id:"real".into(),version_id:"v1".into(),name:"x".into(),side:both(),reason:String::new(),required:false};for v in [json!({}),json!({"project_id":"fake","id":"v1","game_versions":["1.20.1"],"loaders":["fabric"]}),json!({"project_id":"real","id":"v1","game_versions":["1.21"],"loaders":["fabric"]})]{assert!(compatible_mr(&v,&r,"1.20.1","fabric","mods").is_err());}}
 #[test] fn mods_count(){let mut f=fixture();f["mods"]=json!((0..81).map(|n|json!({"source":"modrinth","projectId":format!("id{n}"),"versionId":"v","name":"x"})).collect::<Vec<_>>());assert!(parse(f).is_err());}
}
