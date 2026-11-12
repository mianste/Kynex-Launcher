use crate::*;

#[derive(Debug, PartialEq)]
pub enum Event { Data(Value), Done }
#[derive(Default)]
pub struct Decoder { pending: Vec<u8>, data: Vec<String>, data_bytes: usize }
impl Decoder {
    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<Event>> {
        self.pending.extend_from_slice(bytes);
        if self.pending.len()>2*1024*1024 { return Err("模型返回的数据块过大，请更换模型重试".into()); }
        let mut events=vec![];
        while let Some(end)=self.pending.iter().position(|v|*v==b'\n') {
            let line=self.pending.drain(..=end).collect::<Vec<_>>();
            let text=std::str::from_utf8(&line[..end]).map_err(|_|"模型返回了无效文本编码")?.trim_end_matches('\r');
            self.line(text,&mut events)?;
            if matches!(events.last(),Some(Event::Done)) {self.pending.clear();break;}
        }
        Ok(events)
    }
    fn line(&mut self, line:&str, events:&mut Vec<Event>) -> Result<()> {
        if line.is_empty() {self.flush(events)?;}
        else if let Some(value)=line.strip_prefix("data:") {
            self.data_bytes+=value.len();if self.data_bytes>2*1024*1024 {return Err("模型响应数据块过大，请重试".into());}
            self.data.push(value.strip_prefix(' ').unwrap_or(value).to_owned());
        }
        Ok(())
    }
    fn flush(&mut self, events:&mut Vec<Event>) -> Result<()> {
        if self.data.is_empty(){return Ok(());}
        let raw=std::mem::take(&mut self.data).join("\n");
        self.data_bytes=0;
        if raw.trim()=="[DONE]" {events.push(Event::Done);return Ok(());}
        let value:Value=serde_json::from_str(&raw).map_err(|_|"模型流式响应格式无效，请重试或更换模型")?;
        if !value["error"].is_null() {return Err("模型服务返回错误，请检查模型名称、额度和接口配置".into());}
        events.push(Event::Data(value));Ok(())
    }
    pub fn finish(&mut self)->Result<Vec<Event>> {
        let mut events=vec![];let tail=std::mem::take(&mut self.pending);
        if !tail.is_empty() {self.line(std::str::from_utf8(&tail).map_err(|_|"模型返回了无效文本编码")?.trim_end_matches('\r'),&mut events)?;}
        self.flush(&mut events)?;Ok(events)
    }
}
pub fn usage(value:&Value)->Value {
    let input=value["prompt_tokens"].as_u64().or_else(||value["input_tokens"].as_u64());
    let output=value["completion_tokens"].as_u64().or_else(||value["output_tokens"].as_u64());
    let total=value["total_tokens"].as_u64().or_else(||input.zip(output).map(|(a,b)|a.saturating_add(b)));
    let mut result=serde_json::Map::new();
    for (name,number) in [("prompt_tokens",input),("completion_tokens",output),("total_tokens",total)] {if let Some(n)=number {result.insert(name.into(),json!(n));}}
    if result.is_empty(){Value::Null}else{Value::Object(result)}
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn normal_and_done() {let mut d=Decoder::default();assert_eq!(d.push(b"data: {\"choices\":[]}\r\n\r\ndata: [DONE]\r\n\r\n").unwrap(),vec![Event::Data(json!({"choices":[]})),Event::Done]);}
    #[test] fn chunked_unicode_and_multiline() {
        let raw=": comment\r\ndata: {\"choices\":\r\ndata: [{\"delta\":{\"content\":\"启动\"}}]}\r\n\r\n";
        let mut d=Decoder::default();let mut events=vec![];for byte in raw.as_bytes(){events.extend(d.push(&[*byte]).unwrap());}
        assert_eq!(events,vec![Event::Data(json!({"choices":[{"delta":{"content":"启动"}}]}))]);
    }
    #[test] fn eof_and_error() {let mut d=Decoder::default();assert!(d.push(b"data: [DONE]").unwrap().is_empty());assert_eq!(d.finish().unwrap(),vec![Event::Done]);assert!(Decoder::default().push(b"data: {\"error\":{\"message\":\"secret\"}}\n\n").unwrap_err().find("secret").is_none());}
    #[test] fn usage_whitelist() {assert_eq!(usage(&json!({"input_tokens":3,"output_tokens":4,"secret":"key"})),json!({"prompt_tokens":3,"completion_tokens":4,"total_tokens":7}));assert_eq!(usage(&json!({"prompt_tokens":-1})),Value::Null);}
}
