use crate::*;
use base64::Engine;
use futures_util::StreamExt;
use std::time::Duration;
const MAX_BYTES: usize = 5 * 1024 * 1024;

pub(crate) fn public_url(text: &str) -> Result<reqwest::Url> {
    let url = reqwest::Url::parse(text).map_err(|_| "请输入有效的 HTTPS 图片直链")?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return Err("只允许无账号密码的 HTTPS 图片直链".into());
    }
    let host = url.host_str().ok_or("图片地址没有域名")?;
    if host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.contains(':')
    {
        return Err("请使用公网图片直链".into());
    }
    if let Ok(ip) = host.parse::<std::net::Ipv4Addr>() {
        if ip.is_private()
            || ip.is_loopback()
            || ip.is_link_local()
            || ip.is_unspecified()
            || ip.is_multicast()
        {
            return Err("请使用公网图片直链".into());
        }
    }
    Ok(url)
}
fn client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(format!(
            "Kynex Launcher/{} (skin preview)",
            crate::release::version()
        ))
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(25))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 {
                attempt.error("图片跳转次数过多")
            } else if public_url(attempt.url().as_str()).is_err() {
                attempt.error("图片跳转地址不受支持")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(err)
}
async fn bytes(http: &reqwest::Client, url: &str, limit: usize) -> Result<Vec<u8>> {
    let response = http
        .get(public_url(url)?)
        .send()
        .await
        .map_err(|_| "未能连接远端，请检查网络后重试")?;
    if !response.status().is_success() {
        return Err(format!(
            "没有找到玩家或皮肤（HTTP {}）",
            response.status().as_u16()
        ));
    }
    if response.content_length().unwrap_or(0) > limit as u64 {
        return Err("远端文件超过体积限制".into());
    }
    let mut stream = response.bytes_stream();
    let mut data = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(err)?;
        if data.len() + chunk.len() > limit {
            return Err("远端文件超过体积限制".into());
        }
        data.extend_from_slice(&chunk);
    }
    Ok(data)
}
fn validate_png(data: &[u8]) -> Result<()> {
    let reader = png::Decoder::new(std::io::Cursor::new(data))
        .read_info()
        .map_err(|_| "请导入有效的 PNG 皮肤")?;
    let info = reader.info();
    let scale = info.width / 64;
    if !(64..=1024).contains(&info.width)
        || info.width % 64 != 0
        || !scale.is_power_of_two()
        || (info.height != info.width && info.height * 2 != info.width)
    {
        return Err("皮肤须为标准布局或不超过 1024 的等比例高清 PNG".into());
    }
    Ok(())
}
pub async fn texture(c: &Core, p: &Value) -> Result<Value> {
    use sha2::{Digest,Sha256};
    let url=public_url(string(p,"url")?)?;
    let dir=c.root.join("cache/appearance");
    let path=dir.join(format!("{:x}.png",Sha256::digest(url.as_str().as_bytes())));
    let data=if let Ok(data)=tokio::fs::read(&path).await { data } else {
        let data=bytes(&c.http,url.as_str(),MAX_BYTES).await?;
        let check=format!("data:image/png;base64,{}",base64::engine::general_purpose::STANDARD.encode(&data));
        crate::appearance::image_data(&check,p["cape"]==true)?;
        tokio::fs::create_dir_all(&dir).await.map_err(err)?;
        let tmp=dir.join(format!("{}.part",uuid::Uuid::new_v4()));
        tokio::fs::write(&tmp,&data).await.map_err(err)?;
        if tokio::fs::rename(&tmp,&path).await.is_err() { let _=tokio::fs::remove_file(&tmp).await; }
        data
    };
    let encoded = format!("data:image/png;base64,{}",base64::engine::general_purpose::STANDARD.encode(data));
    crate::appearance::image_data(&encoded,p["cape"]==true)?;
    Ok(json!(encoded))
}
pub async fn import(p: &Value) -> Result<Value> {
    let kind = string(p, "kind")?;
    let input = string(p, "value")?.trim();
    let http = client()?;
    let (url, name, model) = if kind == "url" {
        (
            public_url(input)?.to_string(),
            "图片链接".to_string(),
            Value::Null,
        )
    } else if kind == "username" {
        if input.is_empty()
            || input.len() > 16
            || !input
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_')
        {
            return Err("玩家名应为 1–16 位英文、数字或下划线".into());
        }
        let profile: Value = serde_json::from_slice(
            &bytes(
                &http,
                &format!("https://api.mojang.com/users/profiles/minecraft/{input}"),
                64 * 1024,
            )
            .await?,
        )
        .map_err(err)?;
        let id = string(&profile, "id")?;
        if id.len() != 32 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("玩家 UUID 无效".into());
        }
        let session: Value = serde_json::from_slice(
            &bytes(
                &http,
                &format!("https://sessionserver.mojang.com/session/minecraft/profile/{id}"),
                256 * 1024,
            )
            .await?,
        )
        .map_err(err)?;
        let value = session["properties"]
            .as_array()
            .and_then(|a| a.iter().find(|p| p["name"] == "textures"))
            .and_then(|p| p["value"].as_str())
            .ok_or("玩家档案中没有皮肤")?;
        let payload: Value = serde_json::from_slice(
            &base64::engine::general_purpose::STANDARD
                .decode(value)
                .map_err(err)?,
        )
        .map_err(err)?;
        let mut skin_url =
            reqwest::Url::parse(string(&payload["textures"]["SKIN"], "url")?).map_err(err)?;
        if skin_url.host_str() != Some("textures.minecraft.net") {
            return Err("玩家皮肤地址无效".into());
        }
        skin_url.set_scheme("https").map_err(|_| "皮肤协议无效")?;
        let model = if payload["textures"]["SKIN"]["metadata"]["model"] == "slim" {
            "Slim"
        } else {
            "Classic"
        };
        (
            skin_url.to_string(),
            string(&profile, "name")?.to_string(),
            json!(model),
        )
    } else {
        return Err("不支持的皮肤导入方式".into());
    };
    let data = bytes(&http, &url, MAX_BYTES).await?;
    validate_png(&data)?;
    Ok(
        json!({"name":name,"model":model,"base64":base64::engine::general_purpose::STANDARD.encode(data)}),
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn public_images_only() {
        assert!(public_url("https://textures.minecraft.net/texture/a").is_ok());
        for u in [
            "http://example.com/a.png",
            "https://localhost/a.png",
            "https://127.0.0.1/a.png",
            "https://192.168.1.2/a.png",
            "https://name:password@example.com/a.png",
        ] {
            assert!(public_url(u).is_err());
        }
    }
}
