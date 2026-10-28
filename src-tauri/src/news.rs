use crate::*;

const RSS: &str = "https://www.minecraft.net/en-us/feeds/community-content/rss";
const LAUNCHER_NEWS: &str = "https://launchercontent.mojang.com/news.json";
const IMAGE_BASE: &str = "https://launchercontent.mojang.com";

fn clean_html(value: &str) -> String {
    let without_tags = regex::Regex::new(r"(?is)<[^>]+>")
        .expect("valid tag regex")
        .replace_all(value, " ");
    without_tags
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn xml_field(block: &str, tag: &str) -> String {
    let pattern = format!(
        r"(?is)<{}(?:\s[^>]*)?>(.*?)</{}\s*>",
        regex::escape(tag),
        regex::escape(tag)
    );
    regex::Regex::new(&pattern)
        .ok()
        .and_then(|expression| expression.captures(block))
        .and_then(|captures| captures.get(1))
        .map(|value| {
            value
                .as_str()
                .trim()
                .strip_prefix("<![CDATA[")
                .and_then(|inner| inner.strip_suffix("]]>"))
                .unwrap_or(value.as_str().trim())
                .to_string()
        })
        .unwrap_or_default()
}

fn image_from(block: &str, description: &str) -> String {
    if let Some(value) =
        regex::Regex::new(r#"(?i)<(?:media:content|enclosure)[^>]+url=["'](https://[^"']+)["']"#)
            .expect("valid feed image regex")
            .captures(block)
            .and_then(|captures| captures.get(1))
    {
        return value.as_str().to_string();
    }
    regex::Regex::new(r#"(?i)<img[^>]+src=["'](https://[^"']+)["']"#)
        .expect("valid image regex")
        .captures(description)
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str().to_string())
        .unwrap_or_default()
}

fn parse_rss(xml: &str) -> Result<Value> {
    let item_pattern =
        regex::Regex::new(r"(?is)<item(?:\s[^>]*)?>(.*?)</item\s*>").expect("valid RSS item regex");
    let articles: Vec<Value> = item_pattern
        .captures_iter(xml)
        .filter_map(|captures| captures.get(1).map(|value| value.as_str()))
        .take(30)
        .enumerate()
        .filter_map(|(index, item)| {
            let link = clean_html(&xml_field(item, "link"));
            if !link.starts_with("https://") {
                return None;
            }
            let description = xml_field(item, "description");
            let guid = clean_html(&xml_field(item, "guid"));
            let id = if guid.is_empty() {
                format!("rss-{index}")
            } else {
                guid
            };
            let category = clean_html(&xml_field(item, "category"));
            let category = if category.is_empty() {
                "Minecraft 新闻".to_string()
            } else {
                category
            };
            Some(json!({
                "id": id,
                "title": clean_html(&xml_field(item, "title")),
                "summary": clean_html(&description),
                "published": clean_html(&xml_field(item, "pubDate")),
                "category": category,
                "image": image_from(item, &description),
                "url": link,
                "source": "Minecraft.net"
            }))
        })
        .collect();
    if articles.is_empty() {
        return Err("官方新闻源没有返回文章".into());
    }
    Ok(json!({"articles":articles,"source":"Minecraft.net RSS"}))
}

async fn current(core: &Core) -> Result<Value> {
    let response = core
        .http
        .get(RSS)
        .header(
            reqwest::header::ACCEPT,
            "application/rss+xml, application/xml;q=0.9",
        )
        .header(reqwest::header::ACCEPT_ENCODING, "identity")
        .timeout(std::time::Duration::from_secs(12))
        .send()
        .await
        .map_err(|error| format!("连接 Minecraft 官方新闻失败：{error}"))?
        .error_for_status()
        .map_err(|error| format!("Minecraft 官方新闻返回错误：{error}"))?
        .text()
        .await
        .map_err(|error| format!("读取 Minecraft 官方新闻失败：{error}"))?;
    parse_rss(&response)
}

async fn launcher_fallback(core: &Core) -> Result<Value> {
    let value: Value = core
        .http
        .get(LAUNCHER_NEWS)
        .header(reqwest::header::ACCEPT_ENCODING, "identity")
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(err)?
        .error_for_status()
        .map_err(err)?
        .json()
        .await
        .map_err(err)?;
    let articles: Vec<Value> = value["entries"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .take(24)
        .filter_map(|item| {
            let url = item["readMoreLink"].as_str()?.to_string();
            if !url.starts_with("https://") {
                return None;
            }
            let image = item["newsPageImage"]["url"]
                .as_str()
                .or_else(|| item["playPageImage"]["url"].as_str())
                .map(|path| {
                    if path.starts_with("https://") {
                        path.to_string()
                    } else {
                        format!("{IMAGE_BASE}{path}")
                    }
                })
                .unwrap_or_default();
            Some(json!({
                "id": item["id"],
                "title": item["title"],
                "summary": item["text"],
                "published": item["date"],
                "category": item["category"],
                "image": image,
                "url": url,
                "source": "Minecraft Launcher"
            }))
        })
        .collect();
    if articles.is_empty() {
        return Err("Minecraft Launcher 新闻源没有返回文章".into());
    }
    Ok(json!({"articles":articles,"source":"Minecraft Launcher 备用源"}))
}

pub async fn list(core: &Core, force: bool) -> Result<Value> {
    let cache = core.root.join("cache").join("minecraft-news.json");
    let fresh = !force
        && std::fs::metadata(&cache)
            .and_then(|meta| meta.modified())
            .and_then(|time| time.elapsed().map_err(std::io::Error::other))
            .map(|age| age < std::time::Duration::from_secs(30 * 60))
            .unwrap_or(false);
    if fresh {
        if let Ok(mut value) = read_json(&cache) {
            value["cached"] = json!(true);
            return Ok(value);
        }
    }

    let fetched = match current(core).await {
        Ok(value) => Ok(value),
        Err(primary) => match launcher_fallback(core).await {
            Ok(mut value) => {
                value["warning"] = json!(primary);
                Ok(value)
            }
            Err(backup) => Err(format!("{primary}；备用源：{backup}")),
        },
    };
    match fetched {
        Ok(value) => {
            let _ = write_json(&cache, &value);
            Ok(value)
        }
        Err(network_error) => match read_json(&cache) {
            Ok(mut value) => {
                value["cached"] = json!(true);
                value["stale"] = json!(true);
                value["warning"] = json!(network_error);
                Ok(value)
            }
            Err(_) => Err(network_error),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_official_rss_items() {
        let xml = r#"<rss><channel><item><title>Snapshot News</title><link>https://www.minecraft.net/article/test</link><description><![CDATA[<p>New blocks &amp; mobs.</p><img src="https://example.com/a.jpg">]]></description><pubDate>Tue, 27 Oct 2026 08:00:00 GMT</pubDate><category>Java</category><guid>one</guid></item></channel></rss>"#;
        let value = parse_rss(xml).unwrap();
        assert_eq!(value["articles"][0]["title"], "Snapshot News");
        assert_eq!(value["articles"][0]["summary"], "New blocks & mobs.");
        assert_eq!(value["articles"][0]["image"], "https://example.com/a.jpg");
    }
}
