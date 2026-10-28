use crate::*;
pub fn info() -> Value {
    serde_json::from_str(include_str!("../../config/build-channel.json"))
        .expect("valid build channel")
}
pub fn version() -> String {
    info()["version"].as_str().unwrap_or("1.0.0").to_owned()
}
pub fn endpoints(core: &Core) -> Result<Vec<reqwest::Url>> {
    let config = read_json(&core.root.join("update-sources.json")).unwrap_or_else(|_| {
        serde_json::from_str(include_str!("../../config/update-sources.json"))
            .expect("valid update sources")
    });
    source_urls(&config, info()["channel"].as_str().unwrap_or("stable"))
}
fn source_urls(config: &Value, channel: &str) -> Result<Vec<reqwest::Url>> {
    let mut urls = Vec::new();
    for name in ["github", "lanzou", "website"] {
        let raw = config[channel][name].as_str().unwrap_or("").trim();
        if raw.is_empty() {
            continue;
        }
        let url = reqwest::Url::parse(raw).map_err(|_| "更新源地址无效".to_string())?;
        if url.scheme() != "https"
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("更新源必须使用有效的 HTTPS 地址".into());
        }
        if !urls.contains(&url) {
            urls.push(url);
        }
    }
    Ok(urls)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn blank_sources_never_trigger_network_or_cross_channels() {
        let config = json!({"stable":{"github":"","lanzou":"","website":""},"beta":{"github":"https://example.com/beta.json"}});
        assert!(source_urls(&config, "stable").unwrap().is_empty());
        assert_eq!(source_urls(&config, "beta").unwrap().len(), 1);
    }
    #[test]
    fn only_https_sources_are_accepted_and_duplicates_removed() {
        assert!(source_urls(&json!({"stable":{"github":"http://example.com"}}), "stable").is_err());
        assert_eq!(source_urls(&json!({"stable":{"github":"https://example.com/v1.json","website":"https://example.com/v1.json"}}),"stable").unwrap().len(),1);
    }
}
