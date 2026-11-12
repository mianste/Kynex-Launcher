use crate::*;
use base64::Engine;
use std::{borrow::Cow, collections::BTreeMap, io::Read, sync::Mutex};
#[cfg(feature="desktop")]
use tauri::utils::assets::{AssetKey, AssetsIter, CspHash};
const MAX_ZIP: usize = 30 * 1024 * 1024;
const MAX_FILES: u64 = 100 * 1024 * 1024;
#[derive(Clone)]
struct Bundle { revision:u64, notes:String, files:BTreeMap<String,Vec<u8>> }
struct RuntimeState { active:Option<Bundle>, previous:Option<Bundle>, candidate:Option<Value>, trial:bool, highest:u64 }
pub struct HotfixState { root:PathBuf, state:Mutex<RuntimeState>, busy:AtomicBool }
fn verify(bytes:&[u8], signature:&str)->Result<()> {
    let decode=|v:&str| -> Result<String> { String::from_utf8(base64::engine::general_purpose::STANDARD.decode(v.trim()).map_err(|_|"补丁签名编码错误")?).map_err(|_|"补丁签名格式错误".into()) };
    let key=minisign_verify::PublicKey::decode(&decode(include_str!("../../config/updater-public-key.txt"))?).map_err(|_|"补丁公钥无效")?;
    let sig=minisign_verify::Signature::decode(&decode(signature)?).map_err(|_|"补丁签名无效")?;
    key.verify(bytes,&sig,false).map_err(|_|"补丁签名校验失败，未应用补丁".into())
}
fn safe_asset(name:&str)->bool {
    !name.is_empty() && !name.starts_with('/') && !name.contains(['\\',':','\0']) && name.split('/').all(|p| !p.is_empty() && p!="." && p!="..") && matches!(name.rsplit('.').next(),Some("html"|"js"|"css"|"json"|"png"|"jpg"|"jpeg"|"svg"|"webp"|"woff"|"woff2"|"ttf"|"ico"|"wasm"))
}
fn unpack(bytes:&[u8],base:&str,channel:&str)->Result<Bundle> {
    if bytes.len()>MAX_ZIP {return Err("补丁文件过大".into());}
    let mut zip=zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|_|"无效补丁压缩包")?;
    if zip.len()>4096 {return Err("补丁文件数量过多".into());}
    let mut files=BTreeMap::new(); let mut total=0u64;
    for index in 0..zip.len() {
        let mut f=zip.by_index(index).map_err(err)?;
        if f.is_dir(){continue;}
        let name=f.name().to_string();
        if !safe_asset(&name) || f.unix_mode().is_some_and(|m|m & 0o170000 == 0o120000) {return Err("补丁包含非法文件路径或文件类型".into());}
        total=total.checked_add(f.size()).ok_or("补丁体积异常")?;
        if total>MAX_FILES || f.size()>20*1024*1024 {return Err("补丁解压体积过大".into());}
        let mut data=Vec::new();f.by_ref().take(20*1024*1024+1).read_to_end(&mut data).map_err(err)?;
        if data.len()>20*1024*1024 || files.insert(name,data).is_some(){return Err("补丁包含过大或重复文件".into());}
    }
    let meta:Value=serde_json::from_slice(files.remove("hotfix.json").ok_or("补丁缺少元数据")?.as_slice()).map_err(|_|"补丁元数据无效")?;
    if meta["baseVersion"]!=base || meta["channel"]!=channel || meta["schema"]!=1 {return Err("补丁与当前版本或通道不匹配".into());}
    let revision=meta["revision"].as_u64().filter(|v|*v>0).ok_or("补丁修订号无效")?;
    if !files.contains_key("index.html") || !files.keys().any(|p|p.ends_with(".js")){return Err("补丁缺少完整界面资源".into());}
    Ok(Bundle{revision,notes:meta["notes"].as_str().unwrap_or("小问题修复").chars().take(2000).collect(),files})
}
impl HotfixState {
    pub fn new(root:PathBuf)->Self {
        let root=root.join("hotfix").join(release::version());
        let mut pointer:Value=read_json(&root.join("active.json")).unwrap_or(json!({}));
        if pointer["trial"]==true {
            pointer["active"]=pointer["previous"].clone();pointer["previous"]=Value::Null;pointer["trial"]=json!(false);
            let _=write_json(&root.join("active.json"),&pointer);
        }
        let load=|revision:Option<u64>| -> Option<Bundle> {
            let rev=revision?;let bytes=std::fs::read(root.join(format!("r{rev}.zip"))).ok()?;
            let sig=std::fs::read_to_string(root.join(format!("r{rev}.sig"))).ok()?;
            verify(&bytes,&sig).ok()?;let build=release::info();
            let bundle=unpack(&bytes,&release::version(),build["channel"].as_str()?).ok()?;
            (bundle.revision==rev).then_some(bundle)
        };
        let active=load(pointer["active"].as_u64());let previous=load(pointer["previous"].as_u64());
        let highest=pointer["highest"].as_u64().unwrap_or(0);
        Self{root,state:Mutex::new(RuntimeState{active,previous,candidate:None,trial:false,highest}),busy:AtomicBool::new(false)}
    }
    fn persist(&self,s:&RuntimeState)->Result<()> {
        write_json(&self.root.join("active.json"),&json!({"active":s.active.as_ref().map(|b|b.revision),"previous":s.previous.as_ref().map(|b|b.revision),"trial":s.trial,"highest":s.highest}))
    }
    pub fn status(&self)->Result<Value> {
        let s=self.state.lock().map_err(err)?;
        Ok(json!({"revision":s.active.as_ref().map(|b|b.revision).unwrap_or(0),"notes":s.active.as_ref().map(|b|b.notes.clone()).unwrap_or_default(),"trial":s.trial,"available":s.candidate,"canRollback":s.active.is_some()}))
    }
    pub fn healthy(&self)->Result<Value> {let mut s=self.state.lock().map_err(err)?;s.trial=false;self.persist(&s)?;Ok(json!(true))}
    pub fn rollback(&self)->Result<Value> {
        let mut s=self.state.lock().map_err(err)?;let previous=s.previous.take();let current=s.active.take();s.active=previous;s.trial=false;
        if let Err(e)=self.persist(&s){s.previous=s.active.take();s.active=current;return Err(e);}
        Ok(json!(true))
    }
    fn asset(&self,key:&str)->Option<Vec<u8>> {self.state.lock().ok()?.active.as_ref()?.files.get(key.trim_start_matches('/')).cloned()}
    pub async fn check(&self,core:&Core)->Result<Value> {
        self.state.lock().map_err(err)?.candidate=None;
        if include_str!("../../config/updater-public-key.txt").trim().is_empty() {
            return Ok(json!({"status":"unconfigured"}));
        }
        let build=release::info();let channel=build["channel"].as_str().unwrap_or("stable");
        let url=format!("https://github.com/mianste/Kynex-Launcher/releases/download/hotfix-{channel}/manifest.json");
        let mut last=String::new();
        for url in release::delivery_urls(&reqwest::Url::parse(&url).map_err(err)?) {
            let response=match core.http.get(url).timeout(std::time::Duration::from_secs(8)).send().await {Ok(v)=>v,Err(_)=>{last="连接补丁源失败".into();continue;}};
            if response.status()==reqwest::StatusCode::NOT_FOUND {return Ok(json!({"status":"unpublished"}));}
            if !response.status().is_success(){last="补丁源暂不可用".into();continue;}
            let mut response=response;let mut bytes=Vec::new();
            while let Some(chunk)=response.chunk().await.map_err(|_|"读取补丁清单失败")? {if bytes.len()+chunk.len()>128*1024{return Err("补丁清单过大".into());}bytes.extend_from_slice(&chunk);}
            let manifest:Value=serde_json::from_slice(&bytes).map_err(|_|"补丁清单格式错误")?;
            let mut s=self.state.lock().map_err(err)?;s.candidate=None;
            if manifest["baseVersion"]!=release::version() || manifest["channel"]!=channel {return Ok(json!({"status":"current"}));}
            let rev=manifest["revision"].as_u64().ok_or("补丁修订号无效")?;
            if rev<=s.highest{return Ok(json!({"status":"current"}));}
            let url=string(&manifest,"url")?;
            if !url.starts_with("https://github.com/mianste/Kynex-Launcher/releases/download/") {return Err("补丁下载地址无效".into());}
            string(&manifest,"signature")?;s.candidate=Some(manifest.clone());
            return Ok(json!({"status":"available","patch":manifest}));
        }
        Err(last)
    }
    pub async fn install(&self,core:&Core)->Result<Value> {
        if self.busy.swap(true,Ordering::Relaxed){return Err("正在应用补丁".into());}
        let result=self.install_inner(core).await;self.busy.store(false,Ordering::Relaxed);result
    }
    async fn install_inner(&self,core:&Core)->Result<Value> {
        let candidate=self.state.lock().map_err(err)?.candidate.clone().ok_or("请先检查补丁")?;
        let url=reqwest::Url::parse(string(&candidate,"url")?).map_err(err)?;
        let mut downloaded=None;
        for url in release::delivery_urls(&url) {
            let Ok(mut response)=core.http.get(url).timeout(std::time::Duration::from_secs(90)).send().await else{continue};
            if !response.status().is_success(){continue;}
            let mut bytes=Vec::new();
            while let Some(chunk)=response.chunk().await.map_err(|_|"补丁下载中断")? {if bytes.len()+chunk.len()>MAX_ZIP{return Err("补丁文件过大".into());}bytes.extend_from_slice(&chunk);}
            if verify(&bytes,string(&candidate,"signature")?).is_ok(){downloaded=Some(bytes);break;}
        }
        let bytes=downloaded.ok_or("补丁下载或签名校验失败，未应用任何文件")?;
        self.activate(bytes,string(&candidate,"signature")?,Some(&candidate["revision"]))
    }
    fn activate(&self,bytes:Vec<u8>,signature:&str,expected:Option<&Value>)->Result<Value> {
        verify(&bytes,signature)?;
        let build=release::info();let bundle=unpack(&bytes,&release::version(),build["channel"].as_str().unwrap_or("stable"))?;
        if expected.is_some_and(|v|*v!=bundle.revision) {return Err("补丁修订号不匹配".into());}
        let mut s=self.state.lock().map_err(err)?;
        if bundle.revision<=s.highest{return Err("不能重复应用或降级补丁".into());}
        std::fs::create_dir_all(&self.root).map_err(err)?;
        std::fs::write(self.root.join(format!("r{}.zip",bundle.revision)),bytes).map_err(err)?;
        std::fs::write(self.root.join(format!("r{}.sig",bundle.revision)),signature).map_err(err)?;
        let old=s.active.take();let old_previous=s.previous.take();let highest=s.highest;
        s.previous=old;s.highest=bundle.revision;s.active=Some(bundle);s.trial=true;s.candidate=None;
        if let Err(e)=self.persist(&s){s.active=s.previous.take();s.previous=old_previous;s.highest=highest;s.trial=false;return Err(e);}
        Ok(json!({"applied":true}))
    }
}
#[cfg(feature="desktop")]
pub struct HotfixAssets { pub embedded:Option<Box<dyn tauri::Assets<tauri::Wry>>>,pub state:Arc<HotfixState> }
#[cfg(feature="desktop")]
impl tauri::Assets<tauri::Wry> for HotfixAssets {
    fn setup(&self,app:&tauri::App<tauri::Wry>){if let Some(e)=&self.embedded{e.setup(app);}}
    fn get(&self,key:&AssetKey)->Option<Cow<'_,[u8]>> {self.state.asset(key.as_ref()).map(Cow::Owned).or_else(||self.embedded.as_ref()?.get(key))}
    fn iter(&self)->Box<AssetsIter<'_>> {self.embedded.as_ref().map(|e|e.iter()).unwrap_or_else(||Box::new(std::iter::empty()))}
    fn csp_hashes(&self,key:&AssetKey)->Box<dyn Iterator<Item=CspHash<'_>>+'_> {self.embedded.as_ref().map(|e|e.csp_hashes(key)).unwrap_or_else(||Box::new(std::iter::empty()))}
}
#[cfg(test)] mod tests {use super::*;
    #[test]
    #[ignore = "requires a locally signed fixture, never publishes it"]
    fn signed_patch_lifecycle(){
        let path=std::env::var("KXL_HOTFIX_FIXTURE").expect("fixture path");
        let bytes=std::fs::read(&path).unwrap();let signature=std::fs::read_to_string(format!("{path}.sig")).unwrap();
        let temp=tempfile::tempdir().unwrap();let root=temp.path().join("game");
        let state=HotfixState::new(root.clone());
        let bad=state.activate(bytes.clone(),&signature,Some(&json!(999999)));
        assert!(bad.is_err());assert_eq!(state.status().unwrap()["revision"],0);
        state.activate(bytes.clone(),&signature,None).unwrap();
        assert!(state.asset("index.html").is_some());assert_eq!(state.status().unwrap()["trial"],true);
        let unhealthy=HotfixState::new(root.clone());assert_eq!(unhealthy.status().unwrap()["revision"],0);
        // Restore a first application in another isolated profile, then acknowledge a successful boot.
        let other=temp.path().join("healthy");let healthy=HotfixState::new(other.clone());
        healthy.activate(bytes.clone(),&signature,None).unwrap();healthy.healthy().unwrap();
        let reloaded=HotfixState::new(other);assert!(reloaded.status().unwrap()["revision"].as_u64().unwrap()>0);
        let mut tampered=bytes;let index=tampered.len()/2;tampered[index]^=1;
        assert!(reloaded.activate(tampered,&signature,None).is_err());
        reloaded.rollback().unwrap();assert_eq!(reloaded.status().unwrap()["revision"],0);
    }
    fn zip_bytes(meta:Value,extra:&str)->Vec<u8>{use std::io::Write;let mut writer=zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));for (name,data) in [("hotfix.json",meta.to_string()),("index.html","<script src='/assets/app.js'></script>".into()),(extra,"ok".into())]{writer.start_file(name,zip::write::SimpleFileOptions::default()).unwrap();writer.write_all(data.as_bytes()).unwrap();}writer.finish().unwrap().into_inner()}
    #[test] fn bounded_assets_and_base_binding(){let meta=json!({"schema":1,"baseVersion":"test","channel":"stable","revision":1});let bytes=zip_bytes(meta.clone(),"assets/app.js");assert_eq!(unpack(&bytes,"test","stable").unwrap().revision,1);assert!(unpack(&bytes,"other","stable").is_err());assert!(unpack(&bytes,"test","beta").is_err());assert!(unpack(&zip_bytes(meta,"../app.js"),"test","stable").is_err());for path in ["/abs.js","C:/file.js","a\\file.js","a/../app.js","evil.exe"]{assert!(!safe_asset(path));}}
    #[test] fn invalid_signature_rejected(){assert!(verify(b"bad patch","invalid").is_err());}
}
