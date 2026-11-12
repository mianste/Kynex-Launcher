use crate::*;
use super::{policy,plan::PackPlan};
use std::io::{Read,Write};
pub fn client_only(path:&Path)->Result<Option<bool>>{let mut z=zip::ZipArchive::new(std::fs::File::open(path).map_err(err)?).map_err(err)?;if let Ok(mut f)=z.by_name("fabric.mod.json"){let mut s=String::new();f.by_ref().take(1024*1024).read_to_string(&mut s).map_err(err)?;let v:Value=serde_json::from_str(&s).map_err(err)?;return Ok(Some(v["environment"]=="client"));}if let Ok(mut f)=z.by_name("META-INF/mods.toml"){let mut s=String::new();f.by_ref().take(1024*1024).read_to_string(&mut s).map_err(err)?;let v:toml::Value=toml::from_str(&s).map_err(err)?;if v.get("clientSideOnly").and_then(|v|v.as_bool())==Some(true){return Ok(Some(true));}}Ok(None)}
pub fn properties()->&'static str{"online-mode=true\nserver-port=25565\nmax-players=10\nview-distance=8\nsimulation-distance=8\nmotd=Kynex Minecraft Server\n"}
fn copy_tree(root:&Path,to:&Path,relative:&str)->Result<()>{let source=policy::under(root,relative)?;if !source.exists(){return Ok(());}if source.is_dir(){std::fs::create_dir_all(policy::under(to,relative)?).map_err(err)?;for e in std::fs::read_dir(source).map_err(err)?{let e=e.map_err(err)?;let name=e.file_name().into_string().map_err(|_|"文件名无效")?;copy_tree(root,to,&format!("{relative}/{name}"))?;}}else{let target=policy::under(to,relative)?;std::fs::create_dir_all(target.parent().unwrap()).map_err(err)?;std::fs::copy(source,target).map_err(err)?;}Ok(())}
pub async fn create(core:&Core,task:&mut super::state::Task,plan:&PackPlan)->Result<Value>{
 let id=task.instance_id.clone();let id=id.as_str();let source=core.instance(id)?;let sid=uuid::Uuid::new_v4().to_string();let before=super::snapshot::server(core,id,&sid)?;task.snapshots.push(before);super::state::save(core,task,"state")?;let target=policy::under(&core.root,&format!("server/{sid}"))?;std::fs::create_dir_all(&target).map_err(err)?;let base=metadata::version(core,&plan.minecraft).await?;let java=engine::ensure_java(core,&base,&engine::defaults()).await?;let mut warnings=Vec::new();
 let server = &base["downloads"]["server"];
 let url = string(server, "url")?;
 let hash = string(server, "sha1")?;
 if hash.len() != 40 || !hash.bytes().all(|ch| ch.is_ascii_hexdigit()) { return Err("服务端文件校验值无效".into()); }
 let cache = policy::under(&core.root, &format!("cache/server-jars/{hash}.jar"))?;
 core.stage("下载并校验服务端", 0, 1);
 if let Err(first) = engine::download(core, url, &cache, hash).await {
    core.stopped()?;
    core.stage("用官方下载源续传服务端", 0, 1);
    let official = Core { download_source: Arc::new(std::sync::RwLock::new("official".into())), ..core.clone() };
    engine::download(&official, url, &cache, hash).await.map_err(|last| format!("{first}；官方续传失败：{last}"))?;
 }
 super::snapshot::replace_file(&cache, &target.join("server.jar"))?;
 core.stage("服务端文件已校验", 1, 1);
 let mut args=vec!["-jar".to_owned(),"server.jar".to_owned()];
 if plan.loader.kind=="fabric"||plan.loader.kind=="quilt"{
  let host=if plan.loader.kind=="fabric"{"meta.fabricmc.net"}else{"meta.quiltmc.org"};let api=if plan.loader.kind=="fabric"{2}else{3};let v=core.get(&format!("https://{host}/v{api}/versions/loader/{}/{}/server/json",plan.minecraft,plan.loader.version)).await?;
  let mut server_core=core.clone();server_core.root=target.clone();engine::prepare_dependency_libraries(&server_core,&v).await?;
  let mut paths=Vec::new();for lib in v["libraries"].as_array().into_iter().flatten(){if engine::allowed(lib){paths.push(format!("libraries/{}",engine::lib_path(string(lib,"name")?)?));}}
  paths.push("server.jar".into());let main=string(&v,"mainClass")?;if !main.chars().all(|c|c.is_ascii_alphanumeric()||"._$".contains(c)){return Err("服务端主类无效".into());}let separator=if cfg!(windows){";"}else{":"};args=vec!["-cp".into(),paths.join(separator),main.into()];
 }else if plan.loader.kind=="forge"||plan.loader.kind=="neoforge"{
  let coordinate=if plan.loader.kind=="forge"{format!("{}-{}",plan.minecraft,plan.loader.version)}else{plan.loader.version.clone()};let host=if plan.loader.kind=="forge"{"https://maven.minecraftforge.net/net/minecraftforge/forge"}else{"https://maven.neoforged.net/releases/net/neoforged/neoforge"};let installer=policy::under(&core.root,&format!("cache/server-{}-{coordinate}.jar",plan.loader.kind))?;engine::download(core,&format!("{host}/{coordinate}/{}-{coordinate}-installer.jar",plan.loader.kind),&installer,"").await?;
  let mut command=tokio::process::Command::new(&java);command.current_dir(&target).arg("-jar").arg(installer).arg("--installServer").arg(&target);engine::run_installer(core,&mut command,"安装服务端加载器").await?;
  let family=if plan.loader.kind=="forge"{"net/minecraftforge/forge"}else{"net/neoforged/neoforge"};let file=format!("libraries/{family}/{coordinate}/{}_args.txt",if cfg!(windows){"win"}else{"unix"});policy::under(&target,&file)?;args=vec![format!("@{file}")];
 }else if plan.loader.kind!="vanilla"{return Err("此加载器不支持生成服务端包，请选择原版、Fabric、Quilt、Forge 或 NeoForge。".into());}
 std::fs::create_dir_all(target.join("mods")).map_err(err)?;let mut removed=Vec::new();for entry in std::fs::read_dir(source.join("mods")).into_iter().flatten().flatten(){let name=entry.file_name().to_string_lossy().into_owned();if !name.ends_with(".jar"){continue;}let file=policy::under(&source,&format!("mods/{name}"))?;match client_only(&file)?{Some(true)=>{removed.push(name);continue;},None=>warnings.push(format!("{name} 未明确声明侧别，已保留，请核对作者说明。")),_=>{}}std::fs::copy(file,policy::under(&target,&format!("mods/{name}"))?).map_err(err)?;}
 for path in ["config","defaultconfigs"]{copy_tree(&source,&target,path)?;}
 std::fs::write(target.join("server.properties"),properties()).map_err(err)?;std::fs::write(target.join("eula.txt"),"eula=false\n").map_err(err)?;std::fs::write(target.join("user_jvm_args.txt"),format!("-Xms512M\n-Xmx{}M\n",plan.memory_mb)).map_err(err)?;
 let quote=|s:&str|format!("\"{}\"",s.replace('"',""));let run=args.iter().map(|s|quote(s)).collect::<Vec<_>>().join(" ");std::fs::write(target.join("start.bat"),format!("@echo off\r\ncd /d \"%~dp0\"\r\njava @user_jvm_args.txt {run} nogui\r\npause\r\n")).map_err(err)?;std::fs::write(target.join("start.sh"),format!("#!/bin/sh\ncd -- \"$(dirname -- \"$0\")\"\nexec java @user_jvm_args.txt {run} nogui\n")).map_err(err)?;
 write_json(&target.join("kxl-server.json"),&json!({"version":1,"id":sid,"sourceInstanceId":id,"args":args,"memoryMb":plan.memory_mb,"minecraft":plan.minecraft,"loader":plan.loader}))?;std::fs::write(target.join("README.md"),format!("# KXL 服务端包\n\nMinecraft {} / {}。请使用匹配的 Java，确保客户端与服务端模组一致。默认端口 25565，仅在确有需要时自行配置端口转发和防火墙。online-mode 保持 true。\n\n首次运行前请阅读 Minecraft EULA，默认 eula=false；启动器不会代你同意。\n",plan.minecraft,plan.loader.kind)).map_err(err)?;
 Ok(json!({"serverId":sid,"location":format!("当前游戏目录 server/{sid}"),"removedClientMods":removed,"warnings":warnings,"eulaAccepted":false}))
}
struct Owned(std::process::Child);impl Drop for Owned{fn drop(&mut self){let _=self.0.kill();let _=self.0.wait();}}
pub async fn verify(core:&Core,sid:&str,accept_eula:bool)->Result<Value>{
 safe_name(sid)?;let root=policy::under(&core.root,&format!("server/{sid}"))?;let meta=read_json(&policy::under(&root,"kxl-server.json")?)?;if !accept_eula{return Err("请先阅读并明确同意 Minecraft EULA，再验证服务端。".into());}
 let args:Vec<String>=serde_json::from_value(meta["args"].clone()).map_err(err)?;if args.len()>5||args.iter().any(|s|s.contains(['\n','\r'])){return Err("服务端启动参数无效".into());}
 validate_args(&root,&args)?;
 let base=metadata::version(core,string(&meta,"minecraft")?).await?;let java=engine::ensure_java(core,&base,&engine::defaults()).await?;std::fs::write(root.join("eula.txt"),"eula=true\n").map_err(err)?;
 let output=root.join("kxl-server-verify.log");let file=std::fs::File::create(&output).map_err(err)?;let memory=meta["memoryMb"].as_u64().unwrap_or(4096).clamp(512,65536);let mut command=std::process::Command::new(java);command.current_dir(&root).arg(format!("-Xmx{memory}M")).args(args).arg("nogui").stdin(std::process::Stdio::piped()).stdout(file.try_clone().map_err(err)?).stderr(file);let mut owned=Owned(crate::hidden(&mut command).spawn().map_err(err)?);let start=std::time::Instant::now();
 let _=start;wait_server(core,&mut Native{child:&mut owned.0,path:&output},std::time::Duration::from_secs(180)).await
}
trait ServerProcess{fn log(&self)->String;fn exited(&mut self)->Result<bool>;fn stop(&mut self)->Result<()>;}
struct Native<'a>{child:&'a mut std::process::Child,path:&'a Path}
impl ServerProcess for Native<'_>{fn log(&self)->String{super::verify::tail(self.path)}fn exited(&mut self)->Result<bool>{Ok(self.child.try_wait().map_err(err)?.is_some())}fn stop(&mut self)->Result<()>{if let Some(stdin)=self.child.stdin.as_mut(){stdin.write_all(b"stop\n").map_err(err)?;stdin.flush().map_err(err)?;}Ok(())}}
async fn wait_server<P:ServerProcess>(core:&Core,process:&mut P,limit:std::time::Duration)->Result<Value>{let start=std::time::Instant::now();loop{core.stopped()?;let log=process.log();if log.contains("Done ("){process.stop()?;for _ in 0..40{if process.exited()?{return Ok(json!({"verified":true,"stopped":true,"elapsedMs":start.elapsed().as_millis()}));}tokio::time::sleep(std::time::Duration::from_millis(250)).await;}return Ok(json!({"verified":true,"stopped":true,"note":"正常 stop 等待结束后由验证器清理自己的进程。"}));}if process.exited()?{return Err(format!("服务端提前退出：{}",super::verify::summary(&log)));}if start.elapsed()>=limit{return Err(format!("服务端验证超时：{}",super::verify::summary(&log)));}tokio::time::sleep(std::time::Duration::from_millis(250)).await;}}
fn validate_args(root:&Path,args:&[String])->Result<()>{
 if args==["-jar","server.jar"]{policy::under(root,"server.jar")?;return Ok(());}
 if args.len()==1{if let Some(path)=args[0].strip_prefix('@'){if path.starts_with("libraries/net/minecraftforge/forge/")||path.starts_with("libraries/net/neoforged/neoforge/"){if path.ends_with("_args.txt"){policy::under(root,path)?;return Ok(());}}}}
 if args.len()==3&&args[0]=="-cp"&&["net.fabricmc.loader.impl.launch.server.FabricServerLauncher","org.quiltmc.loader.impl.launch.server.QuiltServerLauncher","net.fabricmc.loader.impl.launch.knot.KnotServer","org.quiltmc.loader.impl.launch.knot.KnotServer"].contains(&args[2].as_str()){for path in args[1].split(if cfg!(windows){';'}else{':'}){if !path.starts_with("libraries/")&&path!="server.jar"{return Err("服务端类路径不在受控目录内".into());}policy::under(root,path)?;}return Ok(());}
 Err("服务端参数不在受控 Java 游戏启动范围内".into())
}
#[cfg(test)]mod tests{use super::*;#[test]fn secure_defaults(){let s=properties();assert!(s.contains("online-mode=true"));assert!(s.contains("server-port=25565"));assert!(s.contains("max-players=10"));}
 #[test]fn strips_client_metadata_and_blocks_unsafe_java_arguments(){let t=tempfile::tempdir().unwrap();let jar=t.path().join("client.jar");let mut z=zip::ZipWriter::new(std::fs::File::create(&jar).unwrap());z.start_file("fabric.mod.json",zip::write::SimpleFileOptions::default()).unwrap();z.write_all(b"{\"id\":\"client\",\"environment\":\"client\"}").unwrap();z.finish().unwrap();assert_eq!(client_only(&jar).unwrap(),Some(true));assert!(validate_args(t.path(),&["-jar".into(),"server.jar".into()]).is_ok());for args in [vec!["-javaagent:evil.jar".into()],vec!["-jar".into(),"../evil.jar".into()],vec!["@C:/secret.txt".into()]]{assert!(validate_args(t.path(),&args).is_err());}}
 #[tokio::test]async fn eula_is_never_accepted_implicitly(){let t=tempfile::tempdir().unwrap();let c=Core::new(t.path().into(),Arc::new(|_|{})).unwrap();let root=c.root.join("server/test");write_json(&root.join("kxl-server.json"),&json!({"id":"test","args":["-jar","server.jar"]})).unwrap();std::fs::write(root.join("eula.txt"),"eula=false\n").unwrap();assert!(verify(&c,"test",false).await.unwrap_err().contains("EULA"));assert_eq!(std::fs::read_to_string(root.join("eula.txt")).unwrap(),"eula=false\n");}
 struct Mock{done:bool,stopped:bool}impl ServerProcess for Mock{fn log(&self)->String{if self.done{"Done (1.0s)!".into()}else{String::new()}}fn exited(&mut self)->Result<bool>{Ok(self.stopped)}fn stop(&mut self)->Result<()>{self.stopped=true;Ok(())}}
 #[tokio::test]async fn injected_server_wait_sends_stop_and_times_out(){let t=tempfile::tempdir().unwrap();let c=Core::new(t.path().into(),Arc::new(|_|{})).unwrap();let mut process=Mock{done:true,stopped:false};assert_eq!(wait_server(&c,&mut process,std::time::Duration::from_secs(180)).await.unwrap()["verified"],true);assert!(process.stopped);let mut failed=Mock{done:false,stopped:false};assert!(wait_server(&c,&mut failed,std::time::Duration::ZERO).await.unwrap_err().contains("超时"));}
}
