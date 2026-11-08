use kynex_core::{engine, auth, Core};
use serde_json::{json, Value};
use std::{path::PathBuf, sync::Arc};

#[tokio::main]
async fn main() -> Result<(), String> {
    let root = PathBuf::from(std::env::var("KXL_LIVE_ROOT").map_err(|e| e.to_string())?);
    let id = std::env::var("KXL_LIVE_INSTANCE").map_err(|e| e.to_string())?;
    let core = Core::new(root.clone(), Arc::new(|event| {
        if let Some(stage) = event["stage"].as_str() { println!("{stage}"); }
    }))?;
    let accounts = auth::list(&core)?;
    let account = accounts.as_array().and_then(|a| a.first()).ok_or("没有可用于验证的已有账号")?;
    let instance: Value = serde_json::from_slice(&std::fs::read(root.join("instances").join(&id).join("kxl.json")).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    engine::launch(&core,&json!({"id":id,"accountId":account["id"],"settings":instance["settings"]})).await?;
    // Keep the process waiter alive during startup, without reading or printing session tokens.
    tokio::time::sleep(std::time::Duration::from_secs(20)).await;
    Ok(())
}
