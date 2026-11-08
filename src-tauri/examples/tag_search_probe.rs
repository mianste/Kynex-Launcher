use kynex_core::Core;
use serde_json::json;
use std::sync::Arc;

#[tokio::main]
async fn main() {
    let temp = std::env::temp_dir().join("kxl-tag-search-probe");
    let core = Core::new(temp, Arc::new(|_| {})).unwrap();
    for (label, params) in [
        (
            "CF 模组·科技",
            json!({"kind":"mod","query":"","source":"curseforge","game":"1.20.1","tag":"412/technology","page":0}),
        ),
        (
            "Modrinth 模组·科技",
            json!({"kind":"mod","query":"","source":"modrinth","game":"1.20.1","tag":"412/technology","page":0}),
        ),
        (
            "Modrinth 模组·游戏机制(仅 MR 分类)",
            json!({"kind":"mod","query":"","source":"modrinth","game":"1.20.1","tag":"/game-mechanics","page":0}),
        ),
        (
            "CF 数据包·科技",
            json!({"kind":"datapack","query":"","source":"curseforge","tag":"6951/technology","page":0}),
        ),
        (
            "CF 整合包·科技",
            json!({"kind":"modpack","query":"","source":"curseforge","tag":"4472/technology","page":0}),
        ),
        (
            "CF 光影·写实风",
            json!({"kind":"shader","query":"","source":"curseforge","tag":"6553/realistic","page":0}),
        ),
        (
            "Modrinth 资源包·16x",
            json!({"kind":"resourcepack","query":"","source":"modrinth","tag":"393/16x","page":0}),
        ),
        (
            "CF-only 分类在 Modrinth 应为空",
            json!({"kind":"mod","query":"","source":"modrinth","tag":"9026/","page":0}),
        ),
    ] {
        let value = core.dispatch("search", params).await.expect(label);
        let hits = value["hits"].as_array().cloned().unwrap_or_default();
        let total = value["total"].as_u64().unwrap_or(0);
        println!(
            "{label}: total={total} hits={} first={:?}",
            hits.len(),
            hits.first().map(|hit| hit["title"].clone())
        );
        if label.contains("应为空") {
            assert!(hits.is_empty(), "CF-only tag must not query Modrinth");
        } else {
            assert!(!hits.is_empty(), "{label} 没有返回任何结果");
        }
    }
    println!("TAG_SEARCH_OK");
}
