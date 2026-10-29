use crate::*;
use std::time::{Duration, Instant};
pub const BMCL: &str = "https://bmclapi2.bangbang93.com";
pub fn mirror_url(url: &str) -> Option<String> {
    let u = reqwest::Url::parse(url).ok()?;
    let resource_prefix = match u.host_str()? {
        "api.modrinth.com" => Some("https://mod.mcimirror.top/modrinth"),
        "cdn.modrinth.com" | "edge.forgecdn.net" | "mediafilez.forgecdn.net" | "media.forgecdn.net" => Some("https://mod.mcimirror.top"),
        _ => None,
    };
    if let Some(prefix) = resource_prefix {
        return Some(format!("{prefix}{}{}", u.path(), u.query().map(|q| format!("?{q}")).unwrap_or_default()));
    }
    let suffix = match u.host_str()? {
        "launchermeta.mojang.com"
        | "launcher.mojang.com"
        | "piston-meta.mojang.com"
        | "piston-data.mojang.com" => u.path().to_string(),
        "resources.download.minecraft.net" => format!("/assets{}", u.path()),
        "libraries.minecraft.net" | "maven.minecraftforge.net" | "maven.fabricmc.net" => {
            format!("/maven{}", u.path())
        }
        "maven.neoforged.net" => format!("/maven{}", u.path().strip_prefix("/releases").unwrap_or(u.path())),
        "maven.quiltmc.org" => format!("/maven{}",u.path().strip_prefix("/repository/release").unwrap_or(u.path())),
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
    if let Some(entry) = crate::curseforge::download_entry(url) {
        out.push(entry);
    }
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
    // Failure on a mod/resource host must not disable an unrelated Maven fallback.
    let maven = reqwest::Url::parse(url).ok().is_some_and(|u| matches!(u.host_str(),Some("maven.neoforged.net" | "maven.minecraftforge.net" | "maven.fabricmc.net" | "maven.quiltmc.org" | "libraries.minecraft.net")));
    if crate::curseforge::is_cdn_url(url) || maven {
        return candidates(url, source);
    }
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
pub async fn text(core: &Core, url: &str) -> Result<String> {
    https(url)?;
    let source=core.download_source.read().map_err(err)?.clone();
    let urls=active_candidates(core,url,&source);
    let mut last=String::new();
    for candidate in urls {
        core.stopped()?;
        let result=async {
            let response=core.http.get(&candidate).timeout(Duration::from_secs(12)).send().await.map_err(err)?.error_for_status().map_err(err)?;
            response.text().await.map_err(err)
        }.await;
        match result {Ok(text)=>return Ok(text),Err(error)=>last=error}
    }
    Err(format!("无法读取加载器版本列表：{last}"))
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
    fn loader_maven_routes_survive_unrelated_failures() {
        let temp=tempfile::tempdir().unwrap(); let c=Core::new(temp.path().into(),Arc::new(|_|{})).unwrap();mark_failed(&c);
        for (url,path) in [
          ("https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.259/neoforge-21.1.259-installer.jar","/net/neoforged/neoforge/21.1.259/neoforge-21.1.259-installer.jar"),
          ("https://maven.neoforged.net/releases/org/ow2/asm/asm/9.8/asm-9.8.jar","/org/ow2/asm/asm/9.8/asm-9.8.jar"),
          ("https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-loader/0.28.0/quilt-loader-0.28.0.jar","/org/quiltmc/quilt-loader/0.28.0/quilt-loader-0.28.0.jar")
        ] { let urls=active_candidates(&c,url,"bmclapi");assert_eq!(urls[0],format!("{BMCL}/maven{path}"));assert_eq!(urls.last().unwrap(),url);assert_eq!(candidates(url,"official"),vec![url]); }
    }
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
    fn resource_cdn_paths_and_filters_are_preserved() {
        assert_eq!(mirror_url("https://api.modrinth.com/v2/project/example/version?loaders=fabric").unwrap(), "https://mod.mcimirror.top/modrinth/v2/project/example/version?loaders=fabric");
        assert_eq!(mirror_url("https://mediafilez.forgecdn.net/files/1234/567/a.jar").unwrap(), "https://mod.mcimirror.top/files/1234/567/a.jar");
        assert_eq!(candidates("https://cdn.modrinth.com/data/a/versions/b/a.jar", "official").len(),1);
    }
    #[test]
    fn curseforge_entry_precedes_mirrors_and_survives_unrelated_cdn_failures() {
        let temp = tempfile::tempdir().unwrap();
        let core = Core::new(temp.path().into(),Arc::new(|_| {})).unwrap();
        mark_failed(&core);
        let legacy = "https://mediafilez.forgecdn.net/files/8925/075/a.jar";
        let urls = active_candidates(&core,legacy,"bmclapi");
        assert_eq!(urls[0],"https://edge.forgecdn.net/files/8925/075/a.jar");
        assert_eq!(urls[1],"https://mod.mcimirror.top/files/8925/075/a.jar");
        assert_eq!(urls[2],legacy);
        assert_eq!(candidates(legacy,"official").len(),2);
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
