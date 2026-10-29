use crate::*;
pub const GITHUB_ACCELERATOR: &str = "https://gh-proxy.com/";
pub fn delivery_urls(url: &reqwest::Url) -> Vec<reqwest::Url> {
    let original = url.as_str().strip_prefix(GITHUB_ACCELERATOR)
        .and_then(|value| reqwest::Url::parse(value).ok()).unwrap_or_else(|| url.clone());
    if original.scheme() == "https" && matches!(original.host_str(), Some("github.com" | "raw.githubusercontent.com"))
        && original.username().is_empty() && original.password().is_none() && original.port_or_known_default() == Some(443) {
        vec![reqwest::Url::parse(&format!("{GITHUB_ACCELERATOR}{original}")).expect("valid accelerator URL"), original]
    } else { vec![url.clone()] }
}
pub fn info() -> Value {
    serde_json::from_str(include_str!("../../config/build-channel.json"))
        .expect("valid build channel")
}
pub fn version() -> String {
    info()["version"].as_str().unwrap_or("1.1.0").to_owned()
}
pub fn endpoints(core: &Core) -> Result<Vec<reqwest::Url>> {
    let config = read_json(&core.root.join("update-sources.json")).unwrap_or_else(|_| {
        serde_json::from_str(include_str!("../../config/update-sources.json"))
            .expect("valid update sources")
    });
    source_urls(&config, info()["channel"].as_str().unwrap_or("stable"))
}
fn source_urls(config: &Value, channel: &str) -> Result<Vec<reqwest::Url>> {
    let raw = config[channel]["github"].as_str().unwrap_or("").trim();
    if raw.is_empty() {
        return Ok(Vec::new());
    }
    let url = reqwest::Url::parse(raw).map_err(|_| "GitHub 更新源地址无效".to_string())?;
    if url.scheme() != "https"
        || !matches!(
            url.host_str(),
            Some("github.com" | "raw.githubusercontent.com")
        )
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port_or_known_default() != Some(443)
    {
        return Err("更新源必须使用有效的 GitHub HTTPS 地址".into());
    }
    Ok(delivery_urls(&url))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn blank_sources_never_trigger_network_or_cross_channels() {
        let config = json!({"stable":{"github":""},"beta":{"github":"https://github.com/mianste/Kynex-Launcher/releases/download/updater-beta/beta.json"}});
        assert!(source_urls(&config, "stable").unwrap().is_empty());
        assert_eq!(source_urls(&config, "beta").unwrap().len(), 2);
    }
    #[test]
    fn only_github_https_sources_are_accepted() {
        for address in [
            "http://github.com/mianste/Kynex-Launcher",
            "https://example.com/update.json",
            "https://github.com.evil.example/update.json",
            "https://github.com:8443/update.json",
            "https://user@github.com/update.json",
        ] {
            assert!(
                source_urls(&json!({"stable":{"github":address}}), "stable").is_err(),
                "{address}"
            );
        }
        assert_eq!(source_urls(&json!({"stable":{"github":"https://raw.githubusercontent.com/mianste/Kynex-Launcher/main/stable.json"}}),"stable").unwrap().len(),2);
    }
    #[test]
    fn old_non_github_fields_cannot_add_update_sources() {
        let config = json!({"stable":{"github":"", "lanzou":"https://example.com/old.json", "website":"https://example.com/old.json"}});
        assert!(source_urls(&config, "stable").unwrap().is_empty());
    }
    #[test]
    fn accelerated_downloads_keep_an_official_fallback() {
        let official = reqwest::Url::parse("https://github.com/mianste/Kynex-Launcher/releases/download/updater-stable/app.exe").unwrap();
        let candidates = delivery_urls(&official);
        assert_eq!(candidates[1], official);
        assert_eq!(delivery_urls(&candidates[0]), candidates);
        assert_eq!(delivery_urls(&reqwest::Url::parse("https://github.com.evil.example/app.exe").unwrap()).len(), 1);
    }
}
