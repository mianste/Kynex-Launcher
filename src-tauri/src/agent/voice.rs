use crate::*;
use base64::{Engine,engine::general_purpose::STANDARD};
fn key(core:&Core)->String{format!("ai-voice:{}",core.data_root.to_string_lossy())}
pub fn config(core:&Core,p:&Value)->Result<Value>{let mut saved=credentials::load(&key(core)).unwrap_or_else(|_|json!({"endpoint":"","model":"","key":""}));match p["op"].as_str().unwrap_or("list"){"save"=>{let mut next=p.clone();super::super::ai_diagnose::validate_voice_provider(&next)?;let changed=saved["endpoint"]!=next["endpoint"];let secret=next["key"].as_str().filter(|s|!s.is_empty()).map(str::to_owned).or_else(||if !changed{saved["key"].as_str().map(str::to_owned)}else{None}).unwrap_or_default();let local=reqwest::Url::parse(string(&next,"endpoint")?).ok().is_some_and(|u|u.scheme()=="http"&&matches!(u.host_str(),Some("localhost"|"127.0.0.1"|"[::1]"|"::1")));if (!local&&secret.is_empty())||secret.len()>4096||secret.chars().any(char::is_whitespace){return Err("请输入有效语音 Key；地址变更后需重新填写，不能沿用旧服务密钥。".into());}next["key"]=json!(secret);credentials::store(&key(core),&next)?;saved=next;},"clear"=>{credentials::remove(&key(core))?;saved=json!({"endpoint":"","model":"","key":""});},"list"=>{},_=>return Err("未知语音设置操作".into())}Ok(json!({"endpoint":saved["endpoint"],"model":saved["model"],"configured":saved["endpoint"].as_str().is_some_and(|s|!s.is_empty())&&saved["model"].as_str().is_some_and(|s|!s.is_empty())}))}
pub fn audio(p:&Value)->Result<(Vec<u8>,&str)>{let encoded=string(p,"audio")?;let duration=p["durationMs"].as_u64().ok_or("缺少录音时长")?;let mime=string(p,"mime")?;if duration==0||duration>60000{return Err("录音须非空且不超过 60 秒。".into());}if !["audio/webm","audio/ogg","audio/wav","audio/mp4"].contains(&mime){return Err("不支持这种录音格式。".into());}if encoded.len()>14*1024*1024{return Err("录音超过 10 MB。".into());}let bytes=STANDARD.decode(encoded).map_err(|_|"录音编码无效")?;if bytes.is_empty()||bytes.len()>10*1024*1024{return Err("录音为空或超过 10 MB。".into());}Ok((bytes,mime))}
pub async fn transcribe(core:&Core,p:&Value)->Result<Value>{let provider=credentials::load(&key(core)).map_err(|_|"请先在 AI 设置中配置语音转写服务。")?;request(p,&provider).await}

pub(super) async fn request(p: &Value, provider: &Value) -> Result<Value> {
    let (bytes, mime) = audio(p)?;
    ai_diagnose::validate_voice_provider(provider)?;
    let client = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(15)).timeout(std::time::Duration::from_secs(45))
        .build().map_err(err)?;
    let endpoint = string(provider, "endpoint")?;
    let model = string(provider, "model")?;
    let secret = provider["key"].as_str().unwrap_or("");
    let ext = match mime { "audio/ogg" => "ogg", "audio/wav" => "wav", "audio/mp4" => "m4a", _ => "webm" };
    let send = || async {
        let part = reqwest::multipart::Part::bytes(bytes.clone()).file_name(format!("recording.{ext}"))
            .mime_str(mime).map_err(err)?;
        let body = reqwest::multipart::Form::new().text("model", model.to_owned()).text("response_format", "json").part("file", part);
        let request = client.post(endpoint).multipart(body);
        let request = if secret.is_empty() { request } else { request.bearer_auth(secret) };
        request.send().await.map_err(|_| "语音服务连接失败或超时，请检查地址和网络。".to_owned())
    };
    let first = send().await;
    let retry = match &first {
        Ok(response) => matches!(response.status().as_u16(), 500 | 502 | 503 | 504),
        Err(_) => true,
    };
    let response = if retry {
        tokio::time::sleep(std::time::Duration::from_millis(700)).await;
        send().await?
    } else { first? };
    if !response.status().is_success() {
        return Err(format!("语音服务没有接收这段录音（错误 {}）。请检查语音地址、模型和密钥。", response.status().as_u16()));
    }
    let value: Value = response.json().await.map_err(|_| "语音服务没有返回可读取的文字。")?;
    let text = value["text"].as_str().filter(|text| !text.trim().is_empty()).ok_or("语音服务未识别到文字，请重试。")?;
    if text.chars().count() > 12000 { return Err("识别出的文字太长，请分几次录音。".into()); }
    Ok(json!({"text":ai_diagnose::agent_text(text)}))
}
#[cfg(test)]mod tests{use super::*;#[test]fn audio_limits(){assert!(audio(&json!({"audio":"AA==","durationMs":1000,"mime":"audio/webm"})).is_ok());for p in [json!({"audio":"AA==","durationMs":60001,"mime":"audio/webm"}),json!({"audio":"AA==","durationMs":1000,"mime":"text/html"}),json!({"audio":"","durationMs":1000,"mime":"audio/webm"})]{assert!(audio(&p).is_err());}}}
