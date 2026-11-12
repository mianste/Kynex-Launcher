use crate::*;
use std::io::{Read,Seek,SeekFrom};
use std::sync::OnceLock;
pub fn ready(log:&str)->bool{["OpenGL","Sound engine started","Created: ","OpenAL initialized","Reloading ResourceManager"].iter().any(|s|log.contains(s))}
pub fn summary(log:&str)->String{let safe=ai_diagnose::agent_text(log);let rows:Vec<_>=safe.lines().collect();rows[rows.len().saturating_sub(30)..].join("\n").chars().take(4000).collect()}
pub fn tail(path:&Path)->String{let Ok(mut file)=std::fs::File::open(path)else{return String::new()};let n=file.metadata().map(|m|m.len()).unwrap_or(0);if file.seek(SeekFrom::Start(n.saturating_sub(32000))).is_err(){return String::new();}let mut out=vec![];if file.take(32000).read_to_end(&mut out).is_err(){return String::new();}String::from_utf8_lossy(&out).into_owned()}
#[cfg(windows)]
fn other_java()->Result<bool>{
 use windows_sys::Win32::{Foundation::{CloseHandle,INVALID_HANDLE_VALUE},System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot,Process32FirstW,Process32NextW,PROCESSENTRY32W,TH32CS_SNAPPROCESS}};
 unsafe{let handle=CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS,0);if handle==INVALID_HANDLE_VALUE{return Err("无法确认是否有其他游戏进程，请关闭游戏后重试。".into());}let mut entry:PROCESSENTRY32W=std::mem::zeroed();entry.dwSize=std::mem::size_of::<PROCESSENTRY32W>() as u32;let mut exists=Process32FirstW(handle,&mut entry)!=0;let mut found=false;while exists{let n=entry.szExeFile.iter().position(|v|*v==0).unwrap_or(entry.szExeFile.len());let name=String::from_utf16_lossy(&entry.szExeFile[..n]).to_lowercase();if name=="java.exe"||name=="javaw.exe"{found=true;break;}exists=Process32NextW(handle,&mut entry)!=0;}CloseHandle(handle);Ok(found)}
}
#[cfg(not(windows))]fn other_java()->Result<bool>{Ok(false)}
pub(super) fn ensure_idle()->Result<()>{if other_java()?{Err("检测到其他 Java/游戏进程，请关闭后再验证或修改实例。".into())}else{Ok(())}}
struct Owned(std::process::Child);
impl Drop for Owned{fn drop(&mut self){let _=self.0.kill();let _=self.0.wait();}}
pub async fn run(core:&Core,id:&str,account:&str,settings:&Value)->Result<String>{
 static GATE:OnceLock<tokio::sync::Mutex<()>>=OnceLock::new();let _guard=GATE.get_or_init(||tokio::sync::Mutex::new(())).lock().await;
 ensure_idle()?;
 core.stopped()?;let wall=std::time::SystemTime::now();let (child,logs)=engine::launch_child(core,&json!({"id":id,"accountId":account,"settings":settings})).await?;let mut owned=Owned(child);
 let start=std::time::Instant::now();let mut last=String::new();let mut ready_at=None;
 loop{
  core.stopped()?;last.clear();for path in &logs{if path.file_name().is_some_and(|n|n=="latest.log")&&std::fs::metadata(path).and_then(|m|m.modified()).is_ok_and(|t|t<wall){continue;}last.push_str(&tail(path));last.push('\n');}
  if let Some(status)=owned.0.try_wait().map_err(err)?{return Err(format!("verify_failed：游戏提前退出（{}）。\n{}\n可回滚到操作前快照。",status.code().map(|n|n.to_string()).unwrap_or_else(||"未知".into()),summary(&last)));}
  if ready(&last){let seen=ready_at.get_or_insert_with(std::time::Instant::now);if seen.elapsed().as_secs()>=3{return Ok(format!("检测到图形/音频初始化标记并继续观察，启动验证耗时 {:.1}s；验证进程已结束。此检查不代表所有玩法均无问题。",start.elapsed().as_secs_f64()));}}
  if start.elapsed().as_secs()>=60{return Err(format!("verify_failed：60 秒内未检测到主菜单初始化标记。\n{}\n可回滚到操作前快照。",summary(&last)));}
  tokio::time::sleep(std::time::Duration::from_millis(250)).await;
 }
}
#[cfg(test)]mod tests{use super::*;
 #[test]fn markers_and_redaction(){assert!(ready("Sound engine started"));assert!(!ready("ERROR missing dependency"));assert!(!summary("Bearer top-secret access_token=hidden").contains("top-secret"));}
}
