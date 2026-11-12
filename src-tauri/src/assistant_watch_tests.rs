use super::*;
use std::os::windows::process::CommandExt;
use tokio::sync::mpsc;

async fn collect(exit_code:u8, entered:bool, automatic:bool)->Vec<Value> {
    let dir=tempfile::tempdir().unwrap();let (sender,mut receiver)=mpsc::unbounded_channel();
    let core=Core::new(dir.path().join("game"),Arc::new(move|v|{let _=sender.send(v);})).unwrap();
    write_json(&core.data_root.join("ai-options.json"),&json!({"automatic":automatic})).unwrap();
    let log=dir.path().join("synthetic.log");
    std::fs::write(&log,if entered{"OpenAL initialized\nSound engine started\n"}else{"java.lang.OutOfMemoryError: Java heap space\n"}).unwrap();
    let child=std::process::Command::new("cmd.exe").args(["/d","/c",&format!("exit {exit_code}")])
        .creation_flags(0x08000000).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).spawn().unwrap();
    watch(&core,child,vec![log]);
    let mut events=vec![];
    tokio::time::timeout(std::time::Duration::from_secs(5),async {
        while let Some(event)=receiver.recv().await {
            let terminal=event["autoDiagnosis"]==true && event["status"]=="error";
            let closed=event["stage"].as_str().is_some_and(|s|s.contains("退出"));events.push(event);
            if terminal || (closed && (!automatic || (exit_code==0 && entered))){break;}
        }
    }).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(80)).await;
    while let Ok(event)=receiver.try_recv(){events.push(event);}
    events
}
#[tokio::test] async fn automatic_crash_diagnosis_respects_exit_and_enabled_setting() {
    let crash=collect(1,false,true).await;
    assert!(crash.iter().any(|v|v["autoDiagnosis"]==true&&v["status"]=="analyzing"));
    assert!(crash.iter().any(|v|v["autoDiagnosis"]==true&&v["status"]=="error"));
    // The isolated Core has no credentials, so this checks the full trigger
    // without calling a model, touching a game or changing the user's keys.
    let disabled=collect(1,false,false).await;
    assert!(!disabled.iter().any(|v|v["autoDiagnosis"]==true));
    let normal=collect(0,true,true).await;
    assert!(!normal.iter().any(|v|v["autoDiagnosis"]==true));
}
