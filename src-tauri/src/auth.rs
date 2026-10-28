use crate::*;
use uuid::Uuid;
const DEVICE: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode";
const TOKEN: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const TOKEN_LIVE: &str = "https://login.live.com/oauth20_token.srf";
fn account_path(c: &Core) -> PathBuf {
    c.root.join("accounts.json")
}
pub fn list(c: &Core) -> Result<Value> {
    if !account_path(c).exists() {
        return Ok(json!([]));
    }
    read_json(&account_path(c))
}
fn save(c: &Core, v: &Value) -> Result<Value> {
    let mut a = list(c)?.as_array().cloned().ok_or("账号数据损坏")?;
    a.retain(|x| x["id"] != v["id"]);
    a.push(v.clone());
    write_json(&account_path(c), &json!(a))?;
    Ok(v.clone())
}
fn credential(id: &str) -> Result<keyring::Entry> {
    keyring::Entry::new("Kynex Launcher", id).map_err(err)
}
fn store_secret(id: &str, v: &Value) -> Result<()> {
    credential(id)?
        .set_password(&v.to_string())
        .map_err(|e| format!("无法存入系统凭据库：{e}。账号凭据不会以明文落盘。"))
}
fn secret(id: &str) -> Result<Value> {
    serde_json::from_str(
        &credential(id)?
            .get_password()
            .map_err(|_| "无法读取登录凭据，请重新登录".to_string())?,
    )
    .map_err(err)
}
pub fn remove(c: &Core, id: &str) -> Result<Value> {
    let mut a = list(c)?.as_array().cloned().ok_or("账号数据损坏")?;
    a.retain(|x| x["id"] != id);
    write_json(&account_path(c), &json!(a))?;
    let _ = credential(id)?.delete_credential();
    Ok(json!(true))
}
pub fn offline(c: &Core, name: &str) -> Result<Value> {
    if name.len() < 3
        || name.len() > 16
        || !name.bytes().all(|x| x.is_ascii_alphanumeric() || x == b'_')
    {
        return Err("用户名需要 3–16 位字母、数字或下划线".into());
    }
    let mut bytes = md5::compute(format!("OfflinePlayer:{name}")).0;
    bytes[6] = (bytes[6] & 0x0f) | 0x30;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let uuid = Uuid::from_bytes(bytes).simple().to_string();
    save(
        c,
        &json!({"id":format!("offline-{uuid}"),"uuid":uuid,"name":name,"kind":"offline"}),
    )
}

async fn send_json_retry(
    request: reqwest::RequestBuilder,
    service: &str,
) -> Result<(reqwest::StatusCode, Value)> {
    let mut last = String::new();
    for attempt in 0..3 {
        let current = request
            .try_clone()
            .ok_or_else(|| format!("无法重试 {service} 请求"))?;
        match tokio::time::timeout(std::time::Duration::from_secs(25), current.send()).await {
            Ok(Ok(response)) => {
                let status = response.status();
                let text = response.text().await.map_err(err)?;
                let value = serde_json::from_str(&text).unwrap_or_else(
                    |_| json!({"error_description":text.chars().take(240).collect::<String>()}),
                );
                if (status.as_u16() == 429 || status.is_server_error()) && attempt < 2 {
                    last = format!("HTTP {}", status.as_u16());
                } else {
                    return Ok((status, value));
                }
            }
            Ok(Err(error)) => last = error.to_string(),
            Err(_) => last = "连接超时".into(),
        }
        tokio::time::sleep(std::time::Duration::from_millis(400 * (attempt + 1))).await;
    }
    Err(format!("{service} 暂时不可用：{last}"))
}

async fn exchange(c: &Core, access: &str) -> Result<(Value, String)> {
    let ticket = if access.starts_with("d=") {
        access.to_string()
    } else {
        format!("d={access}")
    };
    let (xbox_status, xbox) = send_json_retry(
        c.http
            .post("https://user.auth.xboxlive.com/user/authenticate")
            .json(&json!({"Properties":{"AuthMethod":"RPS","SiteName":"user.auth.xboxlive.com","RpsTicket":ticket},"RelyingParty":"http://auth.xboxlive.com","TokenType":"JWT"})),
        "Xbox Live 身份验证",
    )
    .await?;
    if !xbox_status.is_success() {
        return Err("Xbox Live 身份验证失败，请检查账号授权与网络后重试。".into());
    }
    let xbox_token = string(&xbox, "Token")?;
    let xbox_uhs = xbox["DisplayClaims"]["xui"][0]["uhs"]
        .as_str()
        .ok_or("Xbox 用户信息缺失")?;
    let (xsts_status, xsts) = send_json_retry(
        c.http
            .post("https://xsts.auth.xboxlive.com/xsts/authorize")
            .json(&json!({"Properties":{"SandboxId":"RETAIL","UserTokens":[xbox_token]},"RelyingParty":"rp://api.minecraftservices.com/","TokenType":"JWT"})),
        "Xbox XSTS 授权",
    )
    .await?;
    if !xsts_status.is_success() {
        return Err(format!("Xbox 授权失败：{}", xsts_hint(&xsts.to_string())));
    }
    let uhs = xsts["DisplayClaims"]["xui"][0]["uhs"]
        .as_str()
        .ok_or("Xbox 用户信息缺失")?;
    if uhs != xbox_uhs {
        return Err("Xbox 与 XSTS 返回了不同的用户身份，请退出微软账号后重新登录。".into());
    }
    let (mc_status, mc) = send_json_retry(
        c.http
            .post("https://api.minecraftservices.com/authentication/login_with_xbox")
            .json(&json!({"identityToken":format!("XBL3.0 x={uhs};{}",string(&xsts,"Token")?)})),
        "Minecraft 身份验证",
    )
    .await?;
    if !mc_status.is_success() {
        return Err(minecraft_login_error(mc_status.as_u16(), &mc));
    }
    let token = string(&mc, "access_token")?.to_string();
    let (entitlement_status, entitlements) = send_json_retry(
        c.http
            .get("https://api.minecraftservices.com/entitlements/mcstore")
            .bearer_auth(&token),
        "Minecraft 所有权验证",
    )
    .await?;
    if !entitlement_status.is_success()
        || entitlements["items"]
            .as_array()
            .map(Vec::is_empty)
            .unwrap_or(true)
    {
        return Err(
            "该 Microsoft 账号没有可用的 Minecraft Java 版所有权。请确认已购买游戏或订阅仍有效。"
                .into(),
        );
    }
    let (profile_status, profile) = send_json_retry(
        c.http
            .get("https://api.minecraftservices.com/minecraft/profile")
            .bearer_auth(&token),
        "Minecraft 档案服务",
    )
    .await?;
    if !profile_status.is_success() {
        return Err(if profile_status.as_u16() == 404 {
            "该 Microsoft 账号没有 Java 版 Minecraft 档案。请确认已购买 Java 版，且 Xbox 档案已完成。".to_string()
        } else {
            "无法获取 Minecraft 档案，请确认应用获准调用游戏服务后重试。".to_string()
        });
    }
    Ok((profile, token))
}
fn xsts_hint(body: &str) -> &'static str {
    if body.contains("2148916227") {
        "该微软账号似乎已被封禁，无法登录 Xbox。"
    } else if body.contains("2148916233") {
        "该账号还没有 Xbox 档案。请先在 xbox.com 创建档案后再登录。"
    } else if body.contains("2148916235") {
        "你所在的国家或地区无法登录 Xbox，请使用加速器或 VPN 后重试。"
    } else if body.contains("2148916238") {
        "该账号年龄不足，需要家长同意或修改出生日期后再登录。"
    } else {
        "请检查 Xbox 档案、家庭权限与应用授权。"
    }
}

fn minecraft_login_error(status: u16, body: &Value) -> String {
    let detail = body["errorMessage"]
        .as_str()
        .or_else(|| body["error_description"].as_str())
        .or_else(|| body["message"].as_str())
        .unwrap_or("");
    if detail
        .to_ascii_lowercase()
        .contains("invalid app registration")
    {
        return "微软与 Xbox 登录已成功，但 KXL 的 Client ID 尚未通过 Minecraft Services 白名单审核。请提交 App ID 审核并等待批准后再试。".into();
    }
    if status == 401 || status == 403 {
        return "Minecraft 服务拒绝了 Xbox 身份。请确认账号已创建 Xbox 档案，并使用拥有 Minecraft Java 版的账号登录。".into();
    }
    format!("Minecraft 登录失败（HTTP {status}），请稍后重试。")
}
pub struct PendingLogin {
    client: String,
    device: String,
    expires: std::time::Instant,
    next_poll: std::sync::Mutex<std::time::Instant>,
    interval: std::sync::atomic::AtomicU64,
    cancelled: AtomicBool,
    polling: AtomicBool,
}
const KXL_OFFICIAL_MICROSOFT_CLIENT_ID: &str = "";

fn configured_client(c: &Core, legacy: &str) -> Result<Option<String>> {
    let mut id = legacy.trim().to_string();
    if id.is_empty() {
        for key in ["KXL_MICROSOFT_CLIENT_ID", "KXL_MS_CLIENT_ID"] {
            if let Ok(value) = std::env::var(key) {
                if !value.trim().is_empty() {
                    id = value.trim().to_string();
                    break;
                }
            }
        }
    }
    if id.is_empty() {
        if let Some(value) = option_env!("KXL_MICROSOFT_CLIENT_ID") {
            id = value.trim().to_string();
        }
    }
    if id.is_empty() {
        if let Ok(value) = read_json(&c.root.join("microsoft-client.json")) {
            id = value["clientId"].as_str().unwrap_or("").trim().to_string();
        }
    }
    if id.is_empty() {
        return Ok(None);
    }
    Uuid::parse_str(&id).map_err(|_| {
        "微软登录尚未配置 Client ID。请在「账号 → 微软正版 → 登录配置」中填写 Azure 应用 Client ID。"
            .to_string()
    })?;
    Ok(Some(id))
}
fn embedded_client() -> Result<Option<String>> {
    let id = option_env!("KXL_MICROSOFT_CLIENT_ID")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(KXL_OFFICIAL_MICROSOFT_CLIENT_ID);
    if id.is_empty() { return Ok(None); }
    Uuid::parse_str(id)
        .map_err(|_| "内嵌的 Microsoft Client ID 格式无效，请开发者重新构建 KXL。".to_string())?;
    Ok(Some(id.to_string()))
}
fn login_client_id(c: &Core, legacy: &str) -> Result<String> {
    if let Some(id) = embedded_client()? {
        return Ok(id);
    }
    client_id(c, legacy)
}
fn client_id(c: &Core, legacy: &str) -> Result<String> {
    configured_client(c, legacy)?.ok_or_else(|| {
        "微软登录尚未配置 Client ID。请在「账号 → 微软正版 → 登录配置」中填写 Azure 应用 Client ID。"
            .to_string()
    })
}
pub fn microsoft_status(c: &Core, legacy: &str) -> Value {
    match embedded_client() {
        Ok(Some(id)) => {
            return json!({"configured": true, "clientId": id, "embedded": true});
        }
        Err(message) => {
            return json!({"configured": false, "embedded": true, "message": message});
        }
        Ok(None) => {}
    }
    match configured_client(c, legacy) {
        Ok(Some(id)) => json!({"configured": true, "clientId": id, "embedded": false}),
        Ok(None) => json!({"configured": false, "embedded": false}),
        Err(message) => json!({"configured": false, "embedded": false, "message": message}),
    }
}
pub async fn microsoft_start(c: &Core, legacy: &str) -> Result<Value> {
    let client = login_client_id(c, legacy)?;
    let (status, response) = send_json_retry(
        c.http.post(DEVICE).form(&[
            ("client_id", client.as_str()),
            ("scope", "XboxLive.signin offline_access"),
        ]),
        "Microsoft 设备登录",
    )
    .await?;
    if !status.is_success() {
        return Err(format!(
            "无法开始微软授权：{}",
            response["error_description"]
                .as_str()
                .or_else(|| response["error"].as_str())
                .unwrap_or("请检查 Azure 应用是否允许公共客户端设备代码登录")
        ));
    }
    let id = Uuid::new_v4().to_string();
    let interval = response["interval"].as_u64().unwrap_or(5).max(5);
    let expires = response["expires_in"].as_u64().unwrap_or(900).min(1800);
    let uri = string(&response, "verification_uri")?;
    https(uri)?;
    let uri_complete = response["verification_uri_complete"]
        .as_str()
        .unwrap_or(uri);
    https(uri_complete)?;
    let mut sessions = c.auth_sessions.lock().map_err(err)?;
    sessions.retain(|_, s| {
        !s.cancelled.load(Ordering::Relaxed) && s.expires > std::time::Instant::now()
    });
    sessions.insert(
        id.clone(),
        Arc::new(PendingLogin {
            client,
            device: string(&response, "device_code")?.to_string(),
            expires: std::time::Instant::now() + std::time::Duration::from_secs(expires),
            next_poll: std::sync::Mutex::new(
                std::time::Instant::now() + std::time::Duration::from_secs(interval),
            ),
            interval: std::sync::atomic::AtomicU64::new(interval),
            cancelled: AtomicBool::new(false),
            polling: AtomicBool::new(false),
        }),
    );
    Ok(
        json!({"flowId":id,"userCode":response["user_code"],"verificationUri":uri_complete,"interval":interval,"expiresIn":expires}),
    )
}
pub fn microsoft_cancel(c: &Core, id: &str) -> Result<Value> {
    if let Some(flow) = c.auth_sessions.lock().map_err(err)?.remove(id) {
        flow.cancelled.store(true, Ordering::SeqCst);
    }
    Ok(json!(true))
}
fn poll_status(error: &str, interval: u64) -> Value {
    match error {
        "authorization_pending" => json!({"status":"pending","retryAfter":interval}),
        "slow_down" => json!({"status":"pending","retryAfter":interval+5}),
        "authorization_declined" | "access_denied" => {
            json!({"status":"denied","message":"你取消了微软授权，可以重新登录。"})
        }
        "expired_token" => json!({"status":"expired","message":"授权已过期，请重新登录。"}),
        _ => json!({"status":"failed","message":"微软授权失败，请重新尝试。"}),
    }
}
pub async fn microsoft_poll(c: &Core, id: &str) -> Result<Value> {
    let flow = c
        .auth_sessions
        .lock()
        .map_err(err)?
        .get(id)
        .cloned()
        .ok_or("此登录请求已取消或失效")?;
    if flow.cancelled.load(Ordering::SeqCst) {
        return Err("登录已取消".into());
    }
    let now = std::time::Instant::now();
    if now >= flow.expires {
        microsoft_cancel(c, id)?;
        return Ok(poll_status("expired_token", 0));
    }
    let interval = flow.interval.load(Ordering::Relaxed);
    {
        let next = flow.next_poll.lock().map_err(err)?;
        if *next > now {
            return Ok(json!({"status":"pending","retryAfter":(*next-now).as_secs().max(1)}));
        }
    }
    if flow
        .polling
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Ok(json!({"status":"pending","retryAfter":interval}));
    }
    let result = async {
        let (_, response) = send_json_retry(
            c.http.post(TOKEN).form(&[
                ("client_id", flow.client.as_str()),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
                ("device_code", flow.device.as_str()),
                ("scope", "XboxLive.signin offline_access"),
            ]),
            "Microsoft 令牌服务",
        )
        .await?;
        if flow.cancelled.load(Ordering::SeqCst) {
            return Err("登录已取消".into());
        }
        if let Some(error) = response["error"].as_str() {
            let status = poll_status(error, interval);
            if error == "slow_down" {
                flow.interval.store(interval + 5, Ordering::Relaxed);
            }
            *flow.next_poll.lock().map_err(err)? = std::time::Instant::now()
                + std::time::Duration::from_secs(status["retryAfter"].as_u64().unwrap_or(interval));
            if status["status"] != "pending" {
                microsoft_cancel(c, id)?;
            }
            return Ok(status);
        }
        let (profile, token) = exchange(c, string(&response, "access_token")?).await?;
        if flow.cancelled.load(Ordering::SeqCst) {
            return Err("登录已取消".into());
        }
        let uuid = string(&profile, "id")?;
        let account_id = format!("microsoft-{uuid}");
        store_secret(
            &account_id,
            &json!({"refresh":response["refresh_token"],"token":token,"clientId":flow.client}),
        )?;
        let account = save(
            c,
            &json!({"id":account_id,"uuid":uuid,"name":profile["name"],"kind":"microsoft"}),
        )?;
        c.auth_sessions.lock().map_err(err)?.remove(id);
        Ok(json!({"status":"success","account":account}))
    }
    .await;
    flow.polling.store(false, Ordering::SeqCst);
    result
}
pub async fn external(c: &Core, p: &Value) -> Result<Value> {
    let server = string(p, "server")?.trim_end_matches('/');
    https(server)?;
    let response:Value=c.http.post(format!("{server}/authserver/authenticate")).json(&json!({"agent":{"name":"Minecraft","version":1},"username":string(p,"email")?,"password":string(p,"password")?,"clientToken":Uuid::new_v4().to_string(),"requestUser":true})).send().await.map_err(err)?.error_for_status().map_err(|_|"外置登录失败，请检查地址和凭据".to_string())?.json().await.map_err(err)?;
    if p["profile"].is_null() {
        let profiles = response["availableProfiles"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        if profiles.len() > 1 {
            return Ok(json!({"profiles":profiles}));
        }
    }
    let profile = if let Some(id) = p["profile"].as_str() {
        response["availableProfiles"]
            .as_array()
            .and_then(|a| a.iter().find(|a| a["id"] == id))
            .cloned()
            .ok_or("找不到选择的角色")?
    } else {
        response
            .get("selectedProfile")
            .filter(|v| v.is_object())
            .cloned()
            .or_else(|| response["availableProfiles"].as_array()?.first().cloned())
            .ok_or("此账号没有角色，请先创建角色")?
    };
    let uuid = string(&profile, "id")?;
    let id = format!("external-{:x}-{uuid}", md5::compute(server));
    store_secret(
        &id,
        &json!({"token":response["accessToken"],"clientToken":response["clientToken"]}),
    )?;
    save(
        c,
        &json!({"id":id,"uuid":uuid,"name":profile["name"],"kind":"external","server":server}),
    )
}
pub async fn apply_skin(c: &Core, p: &Value) -> Result<Value> {
    use base64::Engine;
    let id = string(p, "accountId")?;
    let accounts = list(c)?;
    let mut account = accounts
        .as_array()
        .and_then(|a| a.iter().find(|a| a["id"] == id))
        .cloned()
        .ok_or("请选择账号")?;
    let model = string(p, "model")?;
    if !["Classic", "Slim"].contains(&model) {
        return Err("皮肤模型无效".into());
    }
    let texture = string(p, "texture")?;
    let encoded = texture
        .strip_prefix("data:image/png;base64,")
        .ok_or("请选择 PNG 皮肤")?;
    if encoded.len() > 2 * 1024 * 1024 {
        return Err("皮肤文件过大".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(err)?;
    let info = png::Decoder::new(std::io::Cursor::new(&bytes))
        .read_info()
        .map_err(err)?;
    if info.info().width != 64 || ![32, 64].contains(&info.info().height) {
        return Err("皮肤必须为 64×64 或 64×32 PNG".into());
    }
    let remote = account["kind"] == "microsoft";
    if remote {
        let login = session(c, id, "").await?;
        let form = reqwest::multipart::Form::new()
            .text("variant", if model == "Slim" { "slim" } else { "classic" })
            .part(
                "file",
                reqwest::multipart::Part::bytes(bytes)
                    .file_name("skin.png")
                    .mime_str("image/png")
                    .map_err(err)?,
            );
        c.http
            .post("https://api.minecraftservices.com/minecraft/profile/skins")
            .bearer_auth(&login.token)
            .multipart(form)
            .send()
            .await
            .map_err(err)?
            .error_for_status()
            .map_err(|_| "更新正版皮肤失败，请检查账号登录状态与网络".to_string())?;
    }
    account["skin"] = json!(texture);
    account["skinModel"] = json!(model);
    save(c, &account)?;
    Ok(json!({"remote":remote,"account":account}))
}
async fn refresh_session(c: &Core, client: &str, refresh: &str) -> Result<Value> {
    let mut last = String::new();
    for endpoint in [TOKEN, TOKEN_LIVE] {
        let result = async {
            let (status, value) = send_json_retry(
                c.http.post(endpoint).form(&[
                    ("client_id", client),
                    ("grant_type", "refresh_token"),
                    ("refresh_token", refresh),
                    ("scope", "XboxLive.signin offline_access"),
                ]),
                "Microsoft 令牌刷新",
            )
            .await?;
            if status.is_success() && value["access_token"].is_string() {
                Ok(value)
            } else {
                Err(value["error_description"]
                    .as_str()
                    .or_else(|| value["error"].as_str())
                    .unwrap_or("刷新令牌已失效")
                    .to_string())
            }
        }
        .await;
        match result {
            Ok(value) => return Ok(value),
            Err(error) => last = error,
        }
    }
    Err(format!("登录已过期，请重新登录：{last}"))
}
pub struct Session {
    pub name: String,
    pub uuid: String,
    pub token: String,
    pub kind: String,
    pub server: Option<String>,
    pub xuid: String,
}
pub async fn session(c: &Core, id: &str, client: &str) -> Result<Session> {
    let accounts = list(c)?;
    let a = accounts
        .as_array()
        .and_then(|a| a.iter().find(|a| a["id"] == id))
        .ok_or("请先选择账号")?;
    let name = string(a, "name")?.into();
    let uuid = string(a, "uuid")?.into();
    let kind = string(a, "kind")?;
    let mut token = "0".to_string();
    let mut server = None;
    if kind == "microsoft" {
        let old = secret(id)?;
        let client = client_id(c, old["clientId"].as_str().unwrap_or(client))?;
        let response = refresh_session(c, &client, string(&old, "refresh")?).await?;
        let (profile, t) = exchange(c, string(&response, "access_token")?).await?;
        if profile["id"] != a["uuid"] {
            return Err("刷新后账号身份发生变化，请重新登录".into());
        }
        token = t;
        store_secret(
            id,
            &json!({"refresh":response["refresh_token"].as_str().unwrap_or(string(&old,"refresh")?),"token":token,"clientId":client}),
        )?;
    } else if kind == "external" {
        let old = secret(id)?;
        let url = string(a, "server")?;
        let response:Value=c.http.post(format!("{url}/authserver/refresh")).json(&json!({"accessToken":old["token"],"clientToken":old["clientToken"],"selectedProfile":{"id":a["uuid"],"name":a["name"]}})).send().await.map_err(err)?.error_for_status().map_err(|_|"外置会话已过期，请重新登录".to_string())?.json().await.map_err(err)?;
        token = string(&response, "accessToken")?.into();
        store_secret(id, &json!({"token":token,"clientToken":old["clientToken"]}))?;
        server = Some(url.into());
    }
    Ok(Session {
        name,
        uuid,
        token,
        kind: if kind == "microsoft" { "msa" } else { "legacy" }.into(),
        server,
        xuid: String::new(),
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn offline_id() {
        let tmp = tempfile::tempdir().unwrap();
        let c = Core::new(tmp.path().to_path_buf(), Arc::new(|_| {})).unwrap();
        assert!(offline(&c, "bad name").is_err());
        let a = offline(&c, "Notch").unwrap();
        assert_eq!(a["uuid"], "b50ad385829d3141a2167e7d7539ba7f");
    }
    #[tokio::test]
    async fn offline_can_equip_skin() {
        use base64::Engine;
        let tmp = tempfile::tempdir().unwrap();
        let c = Core::new(tmp.path().to_path_buf(), Arc::new(|_| {})).unwrap();
        let account = offline(&c, "SkinUser").unwrap();
        let bytes = std::fs::read(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/assets/skins/steve.png"),
        )
        .unwrap();
        let texture = format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        );
        let result = apply_skin(
            &c,
            &json!({"accountId":account["id"],"texture":texture,"model":"Classic"}),
        )
        .await
        .unwrap();
        assert_eq!(result["remote"], false);
        assert_eq!(result["account"]["skin"], json!(texture));
        let stored = list(&c).unwrap();
        assert_eq!(stored[0]["skin"], json!(texture));
    }
    #[test]
    fn pending_and_slowdown() {
        assert_eq!(poll_status("authorization_pending", 5)["retryAfter"], 5);
        assert_eq!(poll_status("slow_down", 5)["retryAfter"], 10);
        assert_eq!(poll_status("access_denied", 5)["status"], "denied");
        assert_eq!(poll_status("expired_token", 5)["status"], "expired");
    }
    #[test]
    fn invalid_app_registration_has_actionable_message() {
        let message = minecraft_login_error(
            403,
            &json!({"errorMessage":"Invalid app registration, see https://aka.ms/AppRegInfo"}),
        );
        assert!(message.contains("白名单审核"));
        assert!(message.contains("Client ID"));
    }
    #[test]
    fn cancellation_is_scoped() {
        let tmp = tempfile::tempdir().unwrap();
        let c = Core::new(tmp.path().to_path_buf(), Arc::new(|_| {})).unwrap();
        let flow = Arc::new(PendingLogin {
            client: String::new(),
            device: String::new(),
            expires: std::time::Instant::now() + std::time::Duration::from_secs(30),
            next_poll: std::sync::Mutex::new(std::time::Instant::now()),
            interval: std::sync::atomic::AtomicU64::new(5),
            cancelled: AtomicBool::new(false),
            polling: AtomicBool::new(false),
        });
        c.auth_sessions
            .lock()
            .unwrap()
            .insert("one".into(), flow.clone());
        microsoft_cancel(&c, "one").unwrap();
        assert!(flow.cancelled.load(Ordering::SeqCst));
        assert!(c.auth_sessions.lock().unwrap().is_empty());
    }
}
