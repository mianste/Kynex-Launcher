//! 下载资源图标的本地缓存：远程 CDN（尤其 ForgeCDN）在国内可能很慢，
//! 首次取回后写入 `cache/icons`，后续搜索结果直接读缓存，避免每次刷新都重新拉图。

use crate::*;
use base64::Engine;
use sha2::{Digest, Sha256};

fn cache_path(core: &Core, url: &str) -> PathBuf {
    let key = format!("{:x}", Sha256::digest(url.as_bytes()));
    core.root.join("cache/icons").join(format!("{key}.img"))
}

fn image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF8") {
        Some("image/gif")
    } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else if bytes.starts_with(b"\x00\x00\x01\x00") {
        Some("image/x-icon")
    } else {
        None
    }
}

fn data_url(mime: &str, bytes: &[u8]) -> String {
    format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

pub async fn fetch(core: &Core, p: &Value) -> Result<Value> {
    let url = string(p, "url")?;
    https(url)?;
    let path = cache_path(core, url);
    if let Ok(bytes) = tokio::fs::read(&path).await {
        if let Some(mime) = image_mime(&bytes) {
            return Ok(json!({ "data": data_url(mime, &bytes) }));
        }
    }
    let bytes = match download(core, url, 15).await {
        Ok(bytes) => bytes,
        Err(direct) => {
            // ForgeCDN 在国内可能连不上；用公共图片代理再试一次，成功后再落盘。
            let proxy = proxy_url(url);
            download(core, &proxy, 15)
                .await
                .map_err(|proxy_error| format!("{direct}；图片代理：{proxy_error}"))?
        }
    };
    if bytes.len() > 2 * 1024 * 1024 {
        return Err("图标文件过大".into());
    }
    let Some(mime) = image_mime(&bytes) else {
        return Err("不支持的图标格式".into());
    };
    if let Some(parent) = path.parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }
    let _ = tokio::fs::write(&path, &bytes).await;
    Ok(json!({ "data": data_url(mime, &bytes) }))
}

async fn download(core: &Core, url: &str, seconds: u64) -> Result<Vec<u8>> {
    let response = core
        .http
        .get(url)
        .header("accept", "image/png,image/webp,image/jpeg,image/*;q=0.8")
        .timeout(std::time::Duration::from_secs(seconds))
        .send()
        .await
        .map_err(|error| format!("图标下载失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "图标下载失败：HTTP {}",
            response.status().as_u16()
        ));
    }
    Ok(response.bytes().await.map_err(err)?.to_vec())
}

/// `images.weserv.nl` 的图片代理地址，`url` 参数不带协议头。
fn proxy_url(url: &str) -> String {
    let host_and_path = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .unwrap_or(url);
    let mut proxy = reqwest::Url::parse("https://images.weserv.nl/").expect("proxy base");
    proxy
        .query_pairs_mut()
        .append_pair("url", host_and_path)
        .append_pair("w", "96")
        .append_pair("h", "96")
        .append_pair("fit", "cover");
    proxy.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_common_icon_formats() {
        assert_eq!(image_mime(b"\x89PNG\r\n\x1a\nrest"), Some("image/png"));
        assert_eq!(image_mime(&[0xff, 0xd8, 0xff, 0x00]), Some("image/jpeg"));
        assert_eq!(image_mime(b"GIF89a"), Some("image/gif"));
        assert_eq!(image_mime(b"RIFF\0\0\0\0WEBPVP8 "), Some("image/webp"));
        assert_eq!(image_mime(b"\x00\x00\x01\x00rest"), Some("image/x-icon"));
        assert_eq!(image_mime(b"<html>"), None);
    }

    #[test]
    fn cache_key_is_stable_and_path_safe() {
        let root = tempfile::tempdir().unwrap();
        let core = crate::Core::new(root.path().to_path_buf(), std::sync::Arc::new(|_| {})).unwrap();
        let a = cache_path(&core, "https://media.forgecdn.net/a.png");
        let b = cache_path(&core, "https://media.forgecdn.net/a.png");
        let c = cache_path(&core, "https://media.forgecdn.net/b.png");
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert!(a.starts_with(root.path()));
    }

    #[test]
    fn proxy_url_drops_scheme_and_limits_size() {
        let proxy = proxy_url("https://media.forgecdn.net/avatars/a.png");
        assert!(proxy.starts_with("https://images.weserv.nl/"));
        assert!(proxy.contains("media.forgecdn.net"));
        assert!(proxy.contains("w=96"));
        assert!(!proxy.contains("https%3A%2F%2Fmedia"));
    }
}
