use kynex_core::{engine, mirrors, Core};
use serde_json::json;
use std::sync::Arc;
#[tokio::main]
async fn main() {
    let core = Core::new(
        std::env::temp_dir().join("kxl-mirror-revision-probe"),
        Arc::new(|_| {}),
    )
    .unwrap();
    println!(
        "candidates {:?}",
        mirrors::candidates(engine::MANIFEST, "bmclapi")
    );
    let m = core.get(engine::MANIFEST).await.unwrap();
    println!(
        "manifest {} versions",
        m["versions"].as_array().unwrap().len()
    );
    let ver = m["versions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["id"] == "1.20.1")
        .unwrap();
    let v = core.get(ver["url"].as_str().unwrap()).await.unwrap();
    let index = core
        .get(v["assetIndex"]["url"].as_str().unwrap())
        .await
        .unwrap();
    let hash = index["objects"]
        .as_object()
        .unwrap()
        .values()
        .find(|v| v["size"].as_u64().unwrap_or(0) > 1000 && v["size"].as_u64().unwrap_or(0) < 10000)
        .unwrap()["hash"]
        .as_str()
        .unwrap();
    let url = format!(
        "https://resources.download.minecraft.net/{}/{}",
        &hash[..2],
        hash
    );
    let a = core.root.join("mirror-asset.bin");
    engine::download(&core, &url, &a, hash).await.unwrap();
    mirrors::configure(&core, &json!({"source":"official"})).unwrap();
    let b = core.root.join("official-asset.bin");
    engine::download(&core, &url, &b, hash).await.unwrap();
    assert_eq!(std::fs::read(a).unwrap(), std::fs::read(b).unwrap());
    println!("MIRROR_OFFICIAL_HASH_MATCH {hash}");
    println!("benchmark {}", mirrors::benchmark(&core).await.unwrap());
}
