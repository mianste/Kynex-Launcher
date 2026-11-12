use crate::*;
use std::sync::atomic::AtomicU64;
use std::time::{SystemTime, UNIX_EPOCH};
pub const MAX_BYTES:u64=2*1024*1024*1024;
pub struct Policy { pub bytes:AtomicU64, pub deadline:u64 }
pub fn now()->u64{SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()}
impl Policy {
 pub fn check(&self)->Result<()>{if now()>self.deadline{return Err("任务超过 30 分钟，请检查网络并从已完成步骤继续。".into());}if self.bytes.load(Ordering::Relaxed)>MAX_BYTES{return Err("任务下载超过 2 GB 预算，已停止。".into());}Ok(())}
 pub fn charge(&self,n:usize)->Result<()>{self.bytes.fetch_add(n as u64,Ordering::SeqCst);self.check()}
}
pub fn url(raw:&str)->Result<()> {
 let value=reqwest::Url::parse(raw).map_err(|_|"下载地址无效")?;
 let host=value.host_str().ok_or("下载地址缺少域名")?;
 // Official loader repositories are needed by the existing Minecraft installer.
 let hosts=["mojang.com","minecraft.net","modrinth.com","forgecdn.net","curseforge.com","curse.tools","bangbang93.com","bmclapi2.com","github.com","githubusercontent.com","githubassets.com","fabricmc.net","quiltmc.org","minecraftforge.net","neoforged.net","mcimirror.top","adoptium.net","adoptium.io"];
 if value.scheme()!="https"||!value.username().is_empty()||value.password().is_some()||value.fragment().is_some()||!hosts.iter().any(|h|host==*h||host.ends_with(&format!(".{h}"))){return Err("工坊已拦截不在 Minecraft 下载白名单中的地址。".into());}Ok(())
}
fn linked(meta:&std::fs::Metadata)->bool {
 #[cfg(windows)]{use std::os::windows::fs::MetadataExt;meta.file_attributes()&0x400!=0}
 #[cfg(not(windows))]{meta.file_type().is_symlink()}
}
pub fn under(root:&Path,relative:&str)->Result<PathBuf>{
 if relative.is_empty() || relative.contains('\\') || relative.contains(':') || relative.split('/').any(|s|s.is_empty()||s==".."||s==".") || Path::new(relative).is_absolute(){return Err("文件路径必须是实例中的安全相对路径。".into());}
 let base=root.canonicalize().map_err(|_|"目标目录不存在")?;let target=root.join(relative);
 let mut cursor=Some(target.as_path());
 while let Some(path)=cursor {if let Ok(meta)=std::fs::symlink_metadata(path){if linked(&meta){return Err("工坊不读写符号链接或目录联接。".into());}if !path.canonicalize().map_err(err)?.starts_with(&base){return Err("文件路径超出实例目录。".into());}}if path==root{break;}cursor=path.parent();}
 Ok(target)
}
pub fn absolute(root:&Path,path:&Path)->Result<()> {
 let relative=path.strip_prefix(root).map_err(|_|"工坊不允许读写游戏目录外的文件")?.to_str().ok_or("文件路径无效")?.replace('\\',"/");under(root,&relative).map(|_|())
}
pub fn scoped(core:&Core,cancel:Arc<AtomicBool>,bytes:u64,deadline:u64)->Result<Core>{
 let client=reqwest::Client::builder().user_agent("Kynex-Workshop/1").connect_timeout(std::time::Duration::from_secs(15)).timeout(std::time::Duration::from_secs(100))
 .redirect(reqwest::redirect::Policy::custom(|attempt|{if attempt.previous().len()>=5||url(attempt.url().as_str()).is_err(){attempt.error("工坊下载重定向被拒绝")}else{attempt.follow()}})).build().map_err(err)?;
 Ok(Core {http:client,cancel,agent_policy:Some(Arc::new(Policy{bytes:AtomicU64::new(bytes),deadline})),..core.clone()})
}
#[cfg(test)] mod tests {use super::*;
 #[test] fn domains(){assert!(url("https://cdn.modrinth.com/data/id/x.jar").is_ok());for s in ["http://cdn.modrinth.com/x","https://evilmodrinth.com/x","https://github.com.evil.org/x","https://u:p@github.com/x","https://127.0.0.1/x"]{assert!(url(s).is_err());}}
 #[test] fn paths(){let t=tempfile::tempdir().unwrap();for p in ["../secret","/abs","C:/secret","config/../secret","config\\x"]{assert!(under(t.path(),p).is_err());}assert!(under(t.path(),"config/x.json").is_ok());}
 #[cfg(unix)] #[test] fn link_escape(){let t=tempfile::tempdir().unwrap();let o=tempfile::tempdir().unwrap();std::os::unix::fs::symlink(o.path(),t.path().join("config")).unwrap();assert!(under(t.path(),"config/x").is_err());}
 #[test] fn budgets(){let p=Policy{bytes:AtomicU64::new(MAX_BYTES),deadline:now()+30};assert!(p.charge(1).is_err());assert!(Policy{bytes:AtomicU64::new(0),deadline:0}.check().is_err());}
}
