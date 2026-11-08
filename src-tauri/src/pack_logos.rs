use crate::*;
use sha2::{Digest,Sha256};
use futures_util::{stream,StreamExt};
fn same_name(a:&str,b:&str)->bool {a.trim().eq_ignore_ascii_case(b.trim())}
fn matching_hit(value:&Value,name:&str)->Option<Value>{value["hits"].as_array()?.iter().find(|v|v["project_type"]=="modpack" && v["title"].as_str().is_some_and(|title|same_name(title,name))).cloned()}
pub(crate) fn identity(p:&Value)->Value {json!({"source":p["source"],"projectId":p["project"],"iconUrl":p["iconUrl"]})}
async fn logo_url(core:&Core,project:&Value)->Option<String>{
 if let Some(url)=project["iconUrl"].as_str().filter(|s|!s.is_empty()){return Some(url.into());}
 if project["source"]=="curseforge" {
  let id=project["projectId"].as_u64().or_else(||project["projectId"].as_str()?.parse().ok())?;
  let key=curseforge::configured_key(core,"");let value=curseforge::project_info(core,id,key.as_deref()).await.ok()?;
  value["logo"]["thumbnailUrl"].as_str().or_else(||value["logo"]["url"].as_str()).map(str::to_string)
 }else {
  let id=project["projectId"].as_str()?;safe_name(id).ok()?;
  let value=core.get(&format!("https://api.modrinth.com/v2/project/{id}")).await.ok()?;value["icon_url"].as_str().map(str::to_string)
 }
}
fn allowed_logo(url:&str)->bool {reqwest::Url::parse(url).ok().is_some_and(|u|u.scheme()=="https" && u.username().is_empty() && u.password().is_none() && u.host_str().is_some_and(|h|["forgecdn.net","modrinth.com","mcimirror.top"].iter().any(|base|h==*base || h.ends_with(&format!(".{base}")))))}
pub(crate) async fn download(core:&Core,project:&Value)->Option<String>{
 let url=logo_url(core,project).await?;if !allowed_logo(&url){return None;}
 let key=format!("{:x}",Sha256::digest(url.as_bytes()));let path=core.root.join("cache/pack-icons").join(format!("{key}.json"));
 if let Ok(value)=read_json(&path){if let Some(image)=value["image"].as_str().filter(|s|s.starts_with("data:image/")){return Some(image.into());}}
 let lock=core.jobs.file_lock(&path);let _guard=lock.lock().await;
 let mut response=core.http.get(&url).timeout(std::time::Duration::from_secs(8)).send().await.ok()?.error_for_status().ok()?;
 if !allowed_logo(response.url().as_str()) || response.content_length().is_some_and(|s|s>2*1024*1024){return None;}
 let mut bytes=Vec::new();while let Some(chunk)=response.chunk().await.ok()? {if bytes.len()+chunk.len()>2*1024*1024{return None;}bytes.extend_from_slice(&chunk);}
 let image=resources::image_data(bytes)?;let _=write_json(&path,&json!({"image":image}));Some(image)
}
fn cached_project(core:&Core,name:&str)->Option<Value>{
 let entries=std::fs::read_dir(core.root.join("cache/resource-search")).ok()?;
 for entry in entries.flatten(){if let Ok(v)=read_json(&entry.path()){if let Some(hit)=matching_hit(&v,name){return Some(hit);}}}None
}
async fn repair(core:&Core,instance:Value){
 if instance["packIcon"].is_string() || instance["packLogo"].is_string(){return;}
 let cached=instance["name"].as_str().and_then(|name|cached_project(core,name));
 if instance["modpack"]!=true && !instance["packProject"].is_object() && cached.is_none(){return;}
 let Some(id)=instance["id"].as_str()else{return};let Ok(dir)=core.instance(id)else{return};
 let lock=core.jobs.file_lock(&dir.join("pack-logo"));let Ok(_guard)=lock.try_lock()else{return};
 let project=if instance["packProject"].is_object(){instance["packProject"].clone()}else{
  let Some(name)=instance["name"].as_str()else{return};
  let hit=if let Some(hit)=cached{Some(hit)}else{
   crate::search_projects(core,&json!({"kind":"modpack","query":name,"source":"all","game":instance["version"],"page":0})).await.ok().and_then(|v|matching_hit(&v,name))
  };
  let Some(hit)=hit else{return};identity(&json!({"source":hit["source"],"project":hit["project_id"],"iconUrl":hit["icon_url"]}))
 };
 let Some(image)=download(core,&project).await else{return};let path=dir.join("kxl.json");let Ok(mut current)=read_json(&path)else{return};
 current["packProject"]=project;current["packLogo"]=json!(image);let _=write_json(&path,&current);
}
pub async fn hydrate(core:&Core)->Result<Value>{
 let instances=core.instances()?.as_array().cloned().unwrap_or_default();
 stream::iter(instances.into_iter().map(|instance|repair(core,instance))).buffer_unordered(3).collect::<Vec<_>>().await;
 core.instances()
}
#[cfg(test)]mod tests{use super::*;
 #[test]fn metadata_matching_is_generic_and_exact(){for name in ["RLCraft","Other Pack","Custom Adventure"]{let hit=json!({"hits":[{"title":format!("{name} Addon"),"project_type":"modpack"},{"title":name,"project_type":"mod"},{"title":name,"project_type":"modpack","project_id":42}]});assert_eq!(matching_hit(&hit,name).unwrap()["project_id"],42);}assert!(matching_hit(&json!({"hits":[{"title":"Different Pack","project_type":"modpack"}]}),"Pack").is_none());}
 #[test]fn logo_hosts_do_not_accept_spoofed_domains(){assert!(allowed_logo("https://media.forgecdn.net/avatars/a.png"));assert!(allowed_logo("https://cdn.modrinth.com/data/icon.png"));for u in ["http://media.forgecdn.net/a.png","https://forgecdn.net.evil.test/a.png","https://127.0.0.1/icon.png","https://user@cdn.modrinth.com/a.png"]{assert!(!allowed_logo(u));}}
}
