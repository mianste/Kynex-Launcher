use crate::*;
use std::time::{Duration, Instant};
pub const BMCL: &str = "https://bmclapi2.bangbang93.com";
pub fn mirror_url(url: &str) -> Option<String> {
    let u = reqwest::Url::parse(url).ok()?;
    let suffix = match u.host_str()? {
        "launchermeta.mojang.com"
        | "launcher.mojang.com"
        | "piston-meta.mojang.com"
        | "piston-data.mojang.com" => u.path().to_string(),
        "resources.download.minecraft.net" => format!("/assets{}", u.path()),
        "libraries.minecraft.net" | "maven.minecraftforge.net" | "maven.fabricmc.net" => {
            format!("/maven{}", u.path())
        }
        "meta.fabricmc.net" => format!("/fabric-meta{}", u.path()),
        _ => return None,
    };
    Some(format!(
        "{BMCL}{suffix}{}",
        u.query().map(|q| format!("?{q}")).unwrap_or_default()
    ))
}
pub fn candidates(url: &str, source: &str) -> Vec<String> {
    let mut out = vec![];
    if source != "official" {
        if let Some(m) = mirror_url(url) {
            out.push(m)
        }
        if let Ok(parsed) = reqwest::Url::parse(url) {
            if parsed.host_str() == Some("libraries.minecraft.net") {
                out.push(format!("{BMCL}/libraries{}", parsed.path()));
            }
        }
    }
    out.push(url.to_string());
    out.dedup();
    out
}
pub fn active_candidates(core: &Core, url: &str, source: &str) -> Vec<String> {
    if core
        .mirror_failed_until
        .lock()
        .map(|until| *until > Instant::now())
        .unwrap_or(false)
    {
        vec![url.to_string()]
    } else {
        candidates(url, source)
    }
}
pub fn mark_failed(core: &Core) {
    if let Ok(mut until) = core.mirror_failed_until.lock() {
        *until = Instant::now() + Duration::from_secs(300);
    }
}
pub fn configure(core: &Core, p: &Value) -> Result<Value> {
    let source = string(p, "source")?;
    if !["bmclapi", "official"].contains(&source) {
        return Err("下载源无效".into());
    }
    *core.mirror_failed_until.lock().map_err(err)? = Instant::now();
    write_json(
        &core.root.join("download-settings.json"),
        &json!({"source":source}),
    )?;
    *core.download_source.write().map_err(err)? = source.into();
    Ok(json!({"source":source}))
}
pub async fn benchmark(core: &Core) -> Result<Value> {
    let work = |source: &'static str, url: String| async move {
        let start = Instant::now();
        let result = core
            .http
            .get(url)
            .timeout(Duration::from_secs(10))
            .send()
            .await;
        match result {
            Ok(r) if r.status().is_success() => {
                json!({"source":source,"ok":true,"latency":start.elapsed().as_millis()})
            }
            _ => json!({"source":source,"ok":false,"latency":null}),
        }
    };
    let (a, b) = tokio::join!(
        work(
            "bmclapi",
            format!("{BMCL}/mc/game/version_manifest_v2.json")
        ),
        work("official", crate::engine::MANIFEST.into())
    );
    Ok(json!([a, b]))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn maps_supported_urls() {
        assert_eq!(
            mirror_url("https://resources.download.minecraft.net/ab/abcdef").unwrap(),
            format!("{BMCL}/assets/ab/abcdef")
        );
        assert_eq!(
            mirror_url("https://libraries.minecraft.net/a/b.jar").unwrap(),
            format!("{BMCL}/maven/a/b.jar")
        );
        assert_eq!(
            mirror_url(crate::engine::MANIFEST).unwrap(),
            format!("{BMCL}/mc/game/version_manifest_v2.json")
        );
    }
    #[test]
    fn keeps_authentication_private() {
        assert!(mirror_url("https://api.minecraftservices.com/minecraft/profile").is_none());
        assert!(
            mirror_url("https://login.microsoftonline.com/consumers/oauth2/v2.0/token").is_none()
        );
    }
    #[test]
    fn official_fallback() {
        let urls = candidates(crate::engine::MANIFEST, "bmclapi");
        assert_eq!(urls.len(), 2);
        assert_eq!(urls[1], crate::engine::MANIFEST);
        assert_eq!(
            candidates(crate::engine::MANIFEST, "official"),
            vec![crate::engine::MANIFEST]
        );
    }
    #[test]
    fn library_has_both_bmcl_routes() {
        let urls = candidates("https://libraries.minecraft.net/a/b.jar", "bmclapi");
        assert_eq!(urls[0], format!("{BMCL}/maven/a/b.jar"));
        assert_eq!(urls[1], format!("{BMCL}/libraries/a/b.jar"));
        assert_eq!(urls[2], "https://libraries.minecraft.net/a/b.jar");
    }
}
