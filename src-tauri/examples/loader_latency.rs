use kynex_core::Core;
use serde_json::json;
use std::{sync::Arc, time::Instant};

#[tokio::main]
async fn main() {
    let temp = tempfile::tempdir().unwrap();
    let core = Core::new(temp.path().into(), Arc::new(|_| {})).unwrap();
    let mut report = Vec::new();
    for pass in ["cold", "cached"] {
        let work = ["fabric", "quilt", "forge", "neoforge"].map(|loader| {
            let core = &core;
            async move {
                let start = Instant::now();
                let rows = core.dispatch("loaders", json!({"game":"26.3","loader":loader})).await.unwrap();
                let rows = rows.as_array().unwrap();
                assert!(!rows.is_empty(), "26.3 {loader} should be available");
                json!({"pass":pass,"loader":loader,"milliseconds":start.elapsed().as_millis(),"versions":rows.len(),"first":rows.first()})
            }
        });
        report.extend(futures_util::future::join_all(work).await);
    }
    for loader in ["fabric", "quilt", "forge", "neoforge"] {
        assert_eq!(
            core.dispatch("loaders", json!({"game":"b1.8.1","loader":loader}))
                .await
                .unwrap(),
            json!([])
        );
    }
    // Cached shared catalogues also serve a different game without another request.
    let start = Instant::now();
    let rows = core
        .dispatch("loaders", json!({"game":"1.20.1","loader":"quilt"}))
        .await
        .unwrap();
    assert!(!rows.as_array().unwrap().is_empty());
    report.push(json!({"pass":"different-game-cached","loader":"quilt","milliseconds":start.elapsed().as_millis(),"versions":rows.as_array().unwrap().len()}));
    println!("{}", serde_json::to_string_pretty(&report).unwrap());
}
