use kynex_core::{Core, Result};
use serde_json::json;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
#[tokio::main]
async fn main() -> Result<()> {
    let mut arguments = std::env::args().skip(1);
    let root = PathBuf::from(
        arguments
            .next()
            .ok_or("provide a dedicated test output directory")?,
    );
    let game = arguments.next().unwrap_or_else(|| "1.20.1".into());
    let loader = arguments.next().unwrap_or_else(|| "vanilla".into());
    let loader_version = arguments.next().unwrap_or_default();
    let optifine = arguments.next().unwrap_or_default();
    let previous = Arc::new(Mutex::new((
        String::new(),
        Instant::now() - Duration::from_secs(3),
    )));
    let started = Instant::now();
    let core = Core::new(
        root,
        Arc::new(move |value| {
            let stage = value["stage"].as_str().unwrap_or("").to_string();
            let mut last = previous.lock().unwrap();
            if stage != last.0
                || last.1.elapsed() > Duration::from_secs(3)
                || value["error"].is_string()
            {
                println!("{value}");
                last.0 = stage;
                last.1 = Instant::now();
            }
        }),
    )?;
    let task = core.dispatch(
        "install",
        json!({"name":format!("Install verification {game} {loader}"),"version":game,"loader":loader,"loaderVersion":loader_version,"optifineVersion":optifine}),
    );
    let result = tokio::time::timeout(Duration::from_secs(1200), task)
        .await
        .map_err(|_| "installation smoke test exceeded 20 minutes".to_string())??;
    let path = PathBuf::from(
        result["path"]
            .as_str()
            .ok_or("missing instance directory")?,
    );
    if !path.join("client.jar").is_file() || !path.join("kxl.json").is_file() {
        return Err("installation did not commit its files".into());
    }
    println!(
        "Installed {} successfully in {:.1}s",
        result["version"],
        started.elapsed().as_secs_f64()
    );
    Ok(())
}
