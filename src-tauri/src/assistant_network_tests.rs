use super::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
struct Response { code: u16, content_type: Option<&'static str>, parts: Vec<String> }
fn response(code:u16, content_type:Option<&'static str>, text:String)->Response { Response{code,content_type,parts:vec![text]} }
async fn scenario(responses:Vec<Response>)->(String,tokio::sync::oneshot::Receiver<Vec<Value>>,tokio::task::JoinHandle<()>) {
    let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint=format!("http://{}/v1/chat/completions",listener.local_addr().unwrap());
    let (sender,receiver)=tokio::sync::oneshot::channel();
    let task=tokio::spawn(async move {
        let mut requests=vec![];
        for response in responses {
            let (mut socket,_)=listener.accept().await.unwrap();
            let mut raw=vec![];let mut buffer=[0u8;4096];
            loop {
                let n=socket.read(&mut buffer).await.unwrap();if n==0{return;}raw.extend_from_slice(&buffer[..n]);
                if let Some(end)=raw.windows(4).position(|v|v==b"\r\n\r\n") {
                    let headers=String::from_utf8_lossy(&raw[..end]);
                    let size=headers.lines().find_map(|line|line.to_ascii_lowercase().strip_prefix("content-length:").and_then(|n|n.trim().parse::<usize>().ok())).unwrap_or(0);
                    if raw.len()>=end+4+size {requests.push(serde_json::from_slice(&raw[end+4..end+4+size]).unwrap());break;}
                }
            }
            let length:usize=response.parts.iter().map(String::len).sum();
            let content_type=response.content_type.map(|v|format!("Content-Type: {v}\r\n")).unwrap_or_default();
            let headers=format!("HTTP/1.1 {} Test\r\n{content_type}Content-Length: {length}\r\nConnection: close\r\n\r\n",response.code);
            socket.write_all(headers.as_bytes()).await.unwrap();
            for part in response.parts {if socket.write_all(part.as_bytes()).await.is_err(){break;}tokio::time::sleep(Duration::from_millis(60)).await;}
        }
        let _=sender.send(requests);
    });
    (endpoint,receiver,task)
}
fn fixture()->(tempfile::TempDir,Core,Arc<Mutex<Vec<Value>>>) {
    let dir=tempfile::tempdir().unwrap();let events=Arc::new(Mutex::new(vec![]));let copy=events.clone();
    let core=Core::new(dir.path().into(),Arc::new(move|v|copy.lock().unwrap().push(v["event"].clone()))).unwrap();(dir,core,events)
}
async fn run(endpoint:&str,core:&Core)->Value {
    let p=json!({"requestId":uuid::Uuid::new_v4().to_string(),"purpose":"general","messages":[{"role":"user","content":"启动器测试"}],"attachments":[{"name":"fixture.log","text":"ERROR secret sk-test-secret test@example.com\nC:\\Users\\Private\\latest.log"}]});
    run_stream(core,&p,json!({"name":"fixture","model":"local-test","endpoint":endpoint,"key":""})).await.unwrap()
}
#[tokio::test] async fn retries_without_usage_options_then_falls_back_to_json() {
    let (endpoint,received,task)=scenario(vec![
        response(400,Some("application/json"),json!({"error":{"message":"include_usage unsupported"}}).to_string()),
        response(422,Some("application/json"),json!({"error":{"message":"stream unsupported"}}).to_string()),
        response(200,Some("application/json"),json!({"choices":[{"message":{"content":"检查 Java 版本"}}],"usage":{"completion_tokens":4}}).to_string()),
    ]).await;
    let (_dir,core,events)=fixture();run(&endpoint,&core).await;
    let requests=tokio::time::timeout(Duration::from_secs(3),received).await.unwrap().unwrap();
    assert_eq!(requests.len(),3);assert_eq!(requests[0]["stream_options"]["include_usage"],true);assert!(requests[1]["stream_options"].is_null());assert_eq!(requests[2]["stream"],false);
    let last=events.lock().unwrap().last().unwrap().clone();assert_eq!(last["reply"],"检查 Java 版本");assert_eq!(last["usage"],json!({"completion_tokens":4}));
    let sent=requests[0]["messages"].to_string();for secret in ["sk-test-secret","example.com","Private"]{assert!(!sent.contains(secret));}task.abort();
}
#[tokio::test] async fn missing_content_type_still_streams_and_missing_usage_is_null() {
    let answer="启动器测试。".repeat(20);
    let body=format!(": comment\n\ndata: {}\n\ndata: [DONE]\n\n",json!({"choices":[{"delta":{"content":answer}}]}));
    let (endpoint,_received,task)=scenario(vec![response(200,None,body)]).await;
    let (_dir,core,events)=fixture();run(&endpoint,&core).await;let events=events.lock().unwrap();
    assert!(events.iter().any(|v|v["delta"].is_string()));let last=events.last().unwrap();assert_eq!(last["reply"],answer);assert!(last["usage"].is_null());task.abort();
}
#[tokio::test] async fn error_after_partial_text_preserves_prior_delta_without_leaking_server_error() {
    let partial="检查启动器 Java 配置，然后逐项排查。".repeat(15);
    let response=Response{code:200,content_type:Some("text/event-stream"),parts:vec![format!("data: {}\n\n",json!({"choices":[{"delta":{"content":partial}}]})),"data: {\"error\":{\"message\":\"SERVER_PRIVATE_SECRET\"}}\n\n".into()]};
    let (endpoint,_received,task)=scenario(vec![response]).await;let (_dir,core,events)=fixture();run(&endpoint,&core).await;let events=events.lock().unwrap();
    assert!(events.iter().any(|v|v["delta"].is_string()));assert!(events.last().unwrap()["error"].is_string());assert!(!serde_json::to_string(&*events).unwrap().contains("SERVER_PRIVATE_SECRET"));task.abort();
}
#[tokio::test] async fn http_errors_have_actionable_safe_messages() {
    for code in [401,403,402,404,429,500] {
        let (endpoint,_received,task)=scenario(vec![response(code,Some("application/json"),"{\"error\":\"PRIVATE_SERVER_MESSAGE\"}".into())]).await;
        let (_dir,core,events)=fixture();run(&endpoint,&core).await;let events=events.lock().unwrap();let error=events.last().unwrap()["error"].as_str().unwrap();assert!(!error.contains("PRIVATE_SERVER_MESSAGE"));assert!(!error.is_empty());task.abort();
    }
}
#[tokio::test] async fn markdown_export_writes_utf8_and_redacts_sensitive_values() {
    let dir=tempfile::tempdir().unwrap();let path=dir.path().join("会话导出.md");
    let result=export_markdown(&json!({"path":path,"text":"# 中文会话\n\n## 用户\n检查 Java\n\n## AI 助手\n建议 Java 17\nsk-test-secret\nuser@example.com\nC:\\Users\\Private\\latest.log"})).unwrap();
    assert_eq!(result["saved"],true);let saved=std::fs::read_to_string(&path).unwrap();assert!(saved.contains("中文会话"));
    for secret in ["sk-test-secret","example.com","Private"]{assert!(!saved.contains(secret));}
    assert!(export_markdown(&json!({"path":dir.path().join("wrong.exe"),"text":"test"})).is_err());
    assert!(export_markdown(&json!({"path":"relative.md","text":"test"})).is_err());
    assert!(export_markdown(&json!({"path":path,"text":"x".repeat(4*1024*1024+1)})).is_err());
}
#[tokio::test]
#[ignore = "downloads a small public mod into an isolated temporary game directory"]
async fn live_small_mod_download_and_install() {
    use sha1::{Digest,Sha1};
    let dir=tempfile::tempdir().unwrap();
    let core=Core::new(dir.path().join("game"),Arc::new(|_|{})).unwrap();
    let instance=core.instance("assistant-download-test").unwrap();
    std::fs::create_dir_all(&instance).unwrap();
    write_json(&instance.join("kxl.json"),&json!({"id":"assistant-download-test","name":"下载测试","version":"1.20.1","loader":"fabric","game":"java","settings":{"isolation":"all","memory":4096}})).unwrap();
    let project=core.get("https://api.modrinth.com/v2/project/fabric-api").await.unwrap();
    let project_id=string(&project,"id").unwrap();
    let version=engine::project_version(&core,project_id,"1.20.1","fabric","mods").await.unwrap();
    let selected=resource_downloads::modrinth_file(&version,"mods").unwrap();
    assert!(selected["size"].as_u64().unwrap_or(0)<20*1024*1024,"sample mod must remain small");
    let filename=string(selected,"filename").unwrap().to_owned();
    let expected=string(&selected["hashes"],"sha1").unwrap().to_owned();
    let result=core.dispatch("install_project",json!({"id":"assistant-download-test","source":"modrinth","project":project_id,"versionId":version["id"],"kind":"mods","name":"Fabric API"})).await.unwrap();
    assert!(result["files"].as_u64().unwrap_or(0)>0);
    let installed=instance.join("mods").join(&filename);
    assert!(installed.canonicalize().unwrap().starts_with(dir.path().canonicalize().unwrap()));
    let bytes=std::fs::read(&installed).unwrap();assert_eq!(format!("{:x}",Sha1::digest(&bytes)),expected);
    let mut archive=zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();assert!(archive.by_name("fabric.mod.json").is_ok());
    let lock=read_json(&instance.join("installed-projects.json")).unwrap();assert_eq!(lock[project_id]["file"],filename);
    println!("PASS live Modrinth sample: compatible Fabric 1.20.1 version, isolated install, SHA-1 verified, valid jar, installation record verified; user instances untouched.");
}
