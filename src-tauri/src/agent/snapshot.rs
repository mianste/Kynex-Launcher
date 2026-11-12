use crate::*;
use sha2::{Digest,Sha256};
use std::collections::BTreeMap;
const ROOTS:&[&str]=&["kxl.json","version.json","client.jar","installed-projects.json","options.txt","config","defaultconfigs","kubejs","scripts","mods","resourcepacks","shaderpacks"];
pub(super) fn hash(path:&Path)->Result<String>{use std::io::Read;let mut file=std::fs::File::open(path).map_err(err)?;let mut digest=Sha256::new();let mut buf=[0u8;65536];loop{let n=file.read(&mut buf).map_err(err)?;if n==0{break;}digest.update(&buf[..n]);}Ok(format!("{:x}",digest.finalize()))}
pub(super) fn replace_file(source:&Path,target:&Path)->Result<()>{
 if target.is_file()&&hash(source)?==hash(target)?{return Ok(());}
 let temp=target.with_extension(format!("kxl-{}.tmp",uuid::Uuid::new_v4()));
 let result=std::fs::copy(source,&temp).and_then(|_|std::fs::rename(&temp,target));
 if result.is_err(){let _=std::fs::remove_file(&temp);}result.map_err(err)
}
fn files(root:&Path,relative:&str,out:&mut BTreeMap<String,String>)->Result<()> {
 let path=super::policy::under(root,relative)?;if !path.exists(){return Ok(());}
 let meta=std::fs::symlink_metadata(&path).map_err(err)?;
 if meta.is_dir(){for entry in std::fs::read_dir(&path).map_err(err)?{let entry=entry.map_err(err)?;let name=entry.file_name().into_string().map_err(|_|"快照文件名无效")?;files(root,&format!("{relative}/{name}"),out)?;}}
 else if meta.is_file(){if out.len()>=20000{return Err("快照文件超过 20000 个，请手动备份。".into());}out.insert(relative.into(),hash(&path)?);}Ok(())
}
const SERVER_ROOTS:&[&str]=&["server.jar","kxl-server.json","server.properties","eula.txt","user_jvm_args.txt","start.bat","start.sh","config","defaultconfigs","mods","libraries"];
fn allowed(file:&str,roots:&[&str])->bool{roots.iter().any(|r|file==*r||file.starts_with(&format!("{r}/")))}
pub fn create(core:&Core,id:&str)->Result<String>{
 capture(core,id,&format!("instances/{id}"),ROOTS)
}
pub(super) fn server(core:&Core,id:&str,server_id:&str)->Result<String>{uuid::Uuid::parse_str(server_id).map_err(|_|"服务端 ID 无效")?;capture(core,id,&format!("server/{server_id}"),SERVER_ROOTS)}
fn capture(core:&Core,id:&str,source:&str,roots:&[&str])->Result<String>{
 let instance=super::policy::under(&core.root,source)?;super::policy::absolute(&core.root,&instance)?;
 std::fs::create_dir_all(&instance).map_err(err)?;
 let sid=uuid::Uuid::new_v4().to_string();let mut manifest=BTreeMap::new();for root in roots{files(&instance,root,&mut manifest)?;}
 let relative=format!("snapshots/{id}/{sid}");let snapshot=super::policy::under(&core.data_root,&relative)?;std::fs::create_dir_all(&snapshot).map_err(err)?;
 for file in manifest.keys(){let source=super::policy::under(&instance,file)?;let target=super::policy::under(&snapshot,file)?;std::fs::create_dir_all(target.parent().unwrap()).map_err(err)?;std::fs::copy(source,target).map_err(err)?;}
 write_json(&snapshot.join("manifest.json"),&json!({"version":1,"instanceId":id,"sourceRelative":source,"files":manifest}))?;Ok(sid)
}
pub fn restore(core:&Core,id:&str,sid:&str)->Result<String>{
 safe_name(id)?;safe_name(sid)?;let snapshot=super::policy::under(&core.data_root,&format!("snapshots/{id}/{sid}"))?;
 let value=read_json(&super::policy::under(&snapshot,"manifest.json")?)?;if value["instanceId"]!=id||value["version"]!=1{return Err("快照不属于此实例或版本不受支持".into());}
 let manifest=value["files"].as_object().ok_or("快照清单无效")?;
 let default_source=format!("instances/{id}");let source=value["sourceRelative"].as_str().unwrap_or(&default_source);let roots=if source==default_source{ROOTS}else if source.strip_prefix("server/").is_some_and(|s|uuid::Uuid::parse_str(s).is_ok()){SERVER_ROOTS}else{return Err("快照目标不属于实例或服务端目录".into());};
 for(file,expected)in manifest{if !allowed(file,roots){return Err("快照包含非白名单文件".into());}if expected.as_str()!=Some(hash(&super::policy::under(&snapshot,file)?)?.as_str()){return Err("快照文件哈希校验失败，未回滚".into());}}
 let before=capture(core,id,source,roots)?;let instance=super::policy::under(&core.root,source)?;
 let mut current=BTreeMap::new();for root in roots{files(&instance,root,&mut current)?;}
 for file in current.keys(){if !manifest.contains_key(file){std::fs::remove_file(super::policy::under(&instance,file)?).map_err(err)?;}}
 for (file,expected) in manifest{if current.get(file).is_some_and(|s|expected.as_str()==Some(s)){continue;}let target=super::policy::under(&instance,file)?;std::fs::create_dir_all(target.parent().unwrap()).map_err(err)?;replace_file(&super::policy::under(&snapshot,file)?,&target)?;}
 Ok(before)
}
#[cfg(test)] mod tests {use super::*;
 #[test]fn replacing_a_hardlink_keeps_shared_cache_unchanged(){let t=tempfile::tempdir().unwrap();let cached=t.path().join("cached.jar");let instance=t.path().join("instance.jar");let next=t.path().join("next.jar");std::fs::write(&cached,b"old").unwrap();std::fs::hard_link(&cached,&instance).unwrap();replace_file(&cached,&instance).unwrap();std::fs::write(&next,b"new").unwrap();replace_file(&next,&instance).unwrap();assert_eq!(std::fs::read(cached).unwrap(),b"old");assert_eq!(std::fs::read(instance).unwrap(),b"new");}
 #[test]fn server_snapshot_leaves_world_untouched(){let t=tempfile::tempdir().unwrap();let c=Core::new(t.path().into(),Arc::new(|_|{})).unwrap();let server_id=uuid::Uuid::new_v4().to_string();let sid=server(&c,"instance",&server_id).unwrap();let root=c.root.join(format!("server/{server_id}"));std::fs::write(root.join("eula.txt"),"eula=true").unwrap();std::fs::create_dir(root.join("world")).unwrap();std::fs::write(root.join("world/level.dat"),b"world").unwrap();restore(&c,"instance",&sid).unwrap();assert!(!root.join("eula.txt").exists());assert_eq!(std::fs::read(root.join("world/level.dat")).unwrap(),b"world");}
 #[test] fn roundtrip_and_tampering(){let t=tempfile::tempdir().unwrap();let c=Core::new(t.path().into(),Arc::new(|_|{})).unwrap();let d=c.instance("x").unwrap();std::fs::create_dir_all(d.join("mods")).unwrap();std::fs::create_dir_all(d.join("saves")).unwrap();std::fs::write(d.join("mods/old.jar"),b"old").unwrap();std::fs::write(d.join("saves/keep"),b"world").unwrap();let sid=create(&c,"x").unwrap();std::fs::write(d.join("mods/new.jar"),b"new").unwrap();std::fs::write(d.join("mods/old.jar"),b"changed").unwrap();restore(&c,"x",&sid).unwrap();assert_eq!(std::fs::read(d.join("mods/old.jar")).unwrap(),b"old");assert!(!d.join("mods/new.jar").exists());assert_eq!(std::fs::read(d.join("saves/keep")).unwrap(),b"world");std::fs::write(c.data_root.join(format!("snapshots/x/{sid}/mods/old.jar")),b"tampered").unwrap();assert!(restore(&c,"x",&sid).is_err());assert!(restore(&c,"x","../escape").is_err());}
}
