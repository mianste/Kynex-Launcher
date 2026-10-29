//! Account-owned appearance, using Minecraft Services and authlib-injector APIs.
use crate::*;
use base64::{engine::general_purpose::STANDARD, Engine};
const PROFILE: &str = "https://api.minecraftservices.com/minecraft/profile";
pub(crate) fn account(c: &Core, id: &str) -> Result<Value> {
    auth::list(c)?
        .as_array()
        .and_then(|a| a.iter().find(|a| a["id"] == id))
        .cloned()
        .ok_or("请选择账号".into())
}
fn texture_url(value: &str) -> Result<String> {
    let mut url = reqwest::Url::parse(value).map_err(|_| "皮肤服务返回了无效图片地址")?;
    if url.scheme() == "http" {
        url.set_scheme("https").map_err(|_| "图片协议无效")?;
    }
    crate::skins::public_url(url.as_str())?;
    Ok(url.into())
}
pub(crate) fn microsoft_account(mut a: Value, profile: &Value) -> Result<Value> {
    if profile["id"] != a["uuid"] {
        return Err("皮肤档案与当前账号不一致".into());
    }
    a["skin"] = Value::Null;
    a["skinModel"] = json!("Classic");
    if let Some(skin) = profile["skins"]
        .as_array()
        .and_then(|s| s.iter().find(|s| s["state"] == "ACTIVE"))
    {
        a["skin"] = json!(texture_url(string(skin, "url")?)?);
        a["skinModel"] = json!(if skin["variant"] == "SLIM" {
            "Slim"
        } else {
            "Classic"
        });
    }
    let mut capes = Vec::new();
    if let Some(items) = profile["capes"].as_array() {
        for cape in items {
            capes.push(json!({"id":string(cape,"id")?,"name":cape["alias"].as_str().unwrap_or("正版披风"),"texture":texture_url(string(cape,"url")?)?,"active":cape["state"]=="ACTIVE"}));
        }
    }
    a["cape"] = capes
        .iter()
        .find(|v| v["active"] == true)
        .map(|v| v["texture"].clone())
        .unwrap_or(Value::Null);
    a["capeId"] = capes
        .iter()
        .find(|v| v["active"] == true)
        .map(|v| v["id"].clone())
        .unwrap_or(json!(""));
    a["capes"] = json!(capes);
    a["uploadableTextures"] = json!(["skin"]);
    Ok(a)
}
fn external_account(mut a: Value, profile: &Value) -> Result<Value> {
    if profile["id"] != a["uuid"] {
        return Err("外置皮肤档案与当前角色不一致".into());
    }
    let props = profile["properties"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let mut textures = json!({});
    if let Some(encoded) = props
        .iter()
        .find(|v| v["name"] == "textures")
        .and_then(|v| v["value"].as_str())
    {
        if encoded.len() > 256 * 1024 {
            return Err("外置皮肤档案过大".into());
        }
        let payload: Value = serde_json::from_slice(
            &STANDARD
                .decode(encoded)
                .map_err(|_| "外置皮肤档案编码无效")?,
        )
        .map_err(|_| "外置皮肤档案格式无效")?;
        textures = payload["textures"].clone();
    }
    a["skin"] = textures["SKIN"]["url"]
        .as_str()
        .map(texture_url)
        .transpose()?
        .map(Value::String)
        .unwrap_or(Value::Null);
    a["skinModel"] = json!(if textures["SKIN"]["metadata"]["model"] == "slim" {
        "Slim"
    } else {
        "Classic"
    });
    a["cape"] = textures["CAPE"]["url"]
        .as_str()
        .map(texture_url)
        .transpose()?
        .map(Value::String)
        .unwrap_or(Value::Null);
    a["capeId"] = json!(if a["cape"].is_string() { "current" } else { "" });
    a["capes"] = if a["cape"].is_string() {
        json!([{"id":"current","name":"当前外置披风","texture":a["cape"],"active":true}])
    } else {
        json!([])
    };
    a["uploadableTextures"] = json!(props
        .iter()
        .find(|v| v["name"] == "uploadableTextures")
        .and_then(|v| v["value"].as_str())
        .unwrap_or("")
        .split(',')
        .map(str::trim)
        .filter(|t| matches!(*t, "skin" | "cape"))
        .collect::<Vec<_>>());
    Ok(a)
}
pub(crate) async fn external_profile(c: &Core, a: &Value) -> Result<Value> {
    let uuid = string(a, "uuid")?;
    if uuid.len() != 32 || !uuid.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("外置角色 UUID 无效".into());
    }
    let server = string(a, "server")?.trim_end_matches('/');
    https(server)?;
    let response = c
        .http
        .get(format!(
            "{server}/sessionserver/session/minecraft/profile/{uuid}?unsigned=true"
        ))
        .timeout(std::time::Duration::from_secs(25))
        .send()
        .await
        .map_err(|_| "无法连接外置皮肤服务")?;
    let response = checked(response, "同步外置皮肤").await?;
    let profile: Value = response.json().await.map_err(|_| "外置皮肤档案无效")?;
    external_account(a.clone(), &profile)
}
async fn checked(response: reqwest::Response, operation: &str) -> Result<reqwest::Response> {
    if response.status().is_success() {
        Ok(response)
    } else {
        Err(format!(
            "{operation}失败（HTTP {}），请检查账号权限、登录状态与服务连接",
            response.status().as_u16()
        ))
    }
}
pub(crate) async fn microsoft_profile(c: &Core, a: &Value, token: &str) -> Result<Value> {
    let response = c
        .http
        .get(PROFILE)
        .bearer_auth(token)
        .timeout(std::time::Duration::from_secs(25))
        .send()
        .await
        .map_err(|_| "无法连接正版皮肤服务")?;
    let response = checked(response, "同步正版皮肤").await?;
    microsoft_account(
        a.clone(),
        &response.json().await.map_err(|_| "正版皮肤档案无效")?,
    )
}
pub async fn sync(c: &Core, id: &str) -> Result<Value> {
    let a = account(c, id)?;
    let updated = if a["kind"] == "microsoft" {
        // Refresh already retrieves the authenticated profile (including all owned capes).
        auth::session(c, id, "").await?;
        account(c, id)?
    } else if a["kind"] == "external" {
        external_profile(c, &a).await?
    } else {
        return Ok(a);
    };
    auth::save(c, &updated)
}
pub(crate) fn can_upload(a: &Value, kind: &str) -> bool {
    a["uploadableTextures"]
        .as_array()
        .is_some_and(|v| v.iter().any(|v| v == kind))
}
pub(crate) async fn upload_external(
    c: &Core,
    a: &Value,
    token: &str,
    kind: &str,
    bytes: Option<Vec<u8>>,
    model: &str,
) -> Result<()> {
    if !can_upload(a, kind) {
        return Err(format!(
            "此认证服务器未开放{}上传或修改权限",
            if kind == "skin" { "皮肤" } else { "披风" }
        ));
    }
    let url = format!(
        "{}/api/user/profile/{}/{kind}",
        string(a, "server")?.trim_end_matches('/'),
        string(a, "uuid")?
    );
    https(&url)?;
    let request = if let Some(bytes) = bytes {
        let mut form = reqwest::multipart::Form::new().part(
            "file",
            reqwest::multipart::Part::bytes(bytes)
                .file_name(format!("{kind}.png"))
                .mime_str("image/png")
                .map_err(err)?,
        );
        if kind == "skin" {
            form = form.text("model", if model == "Slim" { "slim" } else { "" });
        }
        c.http.put(url).multipart(form)
    } else {
        c.http.delete(url)
    };
    let response = request
        .bearer_auth(token)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|_| "无法连接外置皮肤服务")?;
    checked(response, "更新外置外观").await?;
    Ok(())
}
pub(crate) fn image_data(texture: &str, cape: bool) -> Result<Vec<u8>> {
    let encoded = texture
        .strip_prefix("data:image/png;base64,")
        .ok_or("请选择 PNG 图片")?;
    if encoded.len() > 7 * 1024 * 1024 {
        return Err("图片文件过大".into());
    }
    let data = STANDARD.decode(encoded).map_err(|_| "图片编码无效")?;
    let info = png::Decoder::new(std::io::Cursor::new(&data))
        .read_info()
        .map_err(|_| "PNG 图片无效")?;
    let (w, h) = (info.info().width, info.info().height);
    if !(64..=1024).contains(&w)
        || w % 64 != 0
        || !(w / 64).is_power_of_two()
        || (h * 2 != w && (cape || h != w))
    {
        return Err("图片尺寸不符合 Minecraft 皮肤或披风布局".into());
    }
    Ok(data)
}
pub async fn apply_cape(c: &Core, p: &Value) -> Result<Value> {
    let id = string(p, "accountId")?;
    let mut a = account(c, id)?;
    let cape_id = p["capeId"].as_str().unwrap_or("");
    if a["kind"] == "microsoft" {
        if p["texture"].is_string() {
            return Err("正版账号只能选择已拥有的披风，无法上传自定义披风".into());
        }
        let login = auth::session(c, id, "").await?;
        a = account(c, id)?;
        if !cape_id.is_empty()
            && !a["capes"]
                .as_array()
                .is_some_and(|v| v.iter().any(|v| v["id"] == cape_id))
        {
            return Err("只能选择当前正版账号拥有的披风".into());
        }
        let url = format!("{PROFILE}/capes/active");
        let request = if cape_id.is_empty() {
            c.http.delete(url)
        } else {
            c.http.put(url).json(&json!({"capeId":cape_id}))
        };
        let response = request
            .bearer_auth(&login.token)
            .timeout(std::time::Duration::from_secs(25))
            .send()
            .await
            .map_err(|_| "无法连接正版披风服务")?;
        checked(response, "更新正版披风").await?;
        a = microsoft_profile(c, &a, &login.token)
            .await
            .map_err(|e| format!("披风已提交，但重新同步失败：{e}"))?;
    } else if a["kind"] == "external" {
        a = external_profile(c, &a).await?;
        let bytes = p["texture"]
            .as_str()
            .map(|v| image_data(v, true))
            .transpose()?;
        let login = auth::session(c, id, "").await?;
        upload_external(c, &a, &login.token, "cape", bytes, "").await?;
        a = external_profile(c, &a)
            .await
            .map_err(|e| format!("披风已提交，但重新同步失败：{e}"))?;
    } else {
        if let Some(texture) = p["texture"].as_str() {
            image_data(texture, true)?;
            a["cape"] = json!(texture);
        } else {
            a["cape"] = Value::Null;
        }
    }
    auth::save(c, &a)?;
    Ok(json!({"account":a,"remote":a["kind"]!="offline"}))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn external_denied_upload_never_sends_or_saves() {
        let root = tempfile::tempdir().unwrap();
        let c=Core::new(root.path().to_path_buf(),Arc::new(|_|{})).unwrap();
        let a=json!({"uploadableTextures":["skin"]});
        let error=upload_external(&c,&a,"dummy","cape",Some(vec![1]),"").await.unwrap_err();
        assert!(error.contains("未开放")); assert!(!root.path().join("accounts.json").exists());
    }
    #[test]
    fn png_layouts_and_unowned_cape_upload_are_rejected() {
        assert!(image_data("data:image/png;base64,bm90LXBuZw==",false).is_err());
        assert!(image_data("https://example.com/skin.png",false).is_err());
        let skin=std::fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/assets/skins/steve.png")).unwrap();
        assert!(image_data(&format!("data:image/png;base64,{}",STANDARD.encode(skin)),false).is_ok());
    }
    #[test]
    fn microsoft_owned_capes_and_active_skin() {
        let a = json!({"uuid":"a"});
        let p = json!({"id":"a","skins":[{"state":"INACTIVE","url":"https://textures.minecraft.net/old"},{"state":"ACTIVE","url":"http://textures.minecraft.net/skin","variant":"SLIM"}],"capes":[{"id":"one","state":"INACTIVE","url":"https://textures.minecraft.net/one"},{"id":"two","state":"ACTIVE","url":"https://textures.minecraft.net/two","alias":"Migrator"}]});
        let v = microsoft_account(a.clone(), &p).unwrap();
        assert_eq!(v["skin"], "https://textures.minecraft.net/skin");
        assert_eq!(v["skinModel"], "Slim");
        assert_eq!(v["capeId"], "two");
        assert_eq!(v["capes"].as_array().unwrap().len(), 2);
        assert!(microsoft_account(json!({"uuid":"b"}), &p).is_err());
        let v = microsoft_account(v, &json!({"id":"a","skins":[],"capes":[]})).unwrap();
        assert!(v["skin"].is_null());
        assert!(v["cape"].is_null());
    }
    #[test]
    fn external_properties_and_permissions_do_not_invent_inventory() {
        let props = json!({"id":"a","properties":[{"name":"textures","value":STANDARD.encode(serde_json::to_vec(&json!({"textures":{"SKIN":{"url":"https://example.com/skin","metadata":{"model":"slim"}},"CAPE":{"url":"https://example.com/cape"}}})).unwrap())},{"name":"uploadableTextures","value":"skin,cape"}]});
        let v = external_account(json!({"uuid":"a"}), &props).unwrap();
        assert_eq!(v["skinModel"], "Slim");
        assert!(can_upload(&v, "skin"));
        assert!(can_upload(&v, "cape"));
        assert_eq!(v["capes"].as_array().unwrap().len(), 1);
        let v = external_account(v, &json!({"id":"a","properties":[]})).unwrap();
        assert!(!can_upload(&v, "cape"));
        assert!(v["cape"].is_null());
        assert!(v["skin"].is_null());
    }
}
