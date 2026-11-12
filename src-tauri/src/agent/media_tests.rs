use crate::*;
use std::io::{Read,Write};
fn server(response:&str)->(String,std::thread::JoinHandle<Vec<u8>>){let socket=std::net::TcpListener::bind("127.0.0.1:0").unwrap();let address=format!("http://{}/v1/audio/transcriptions",socket.local_addr().unwrap());let response=response.to_owned();let thread=std::thread::spawn(move||{let(mut stream,_)=socket.accept().unwrap();stream.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();let mut data=Vec::new();loop{let mut chunk=[0u8;4096];let n=stream.read(&mut chunk).unwrap();if n==0{break;}data.extend(&chunk[..n]);if let Some(end)=data.windows(4).position(|w|w==b"\r\n\r\n"){let headers=String::from_utf8_lossy(&data[..end]);let size=headers.lines().find_map(|line|line.to_lowercase().strip_prefix("content-length:").and_then(|s|s.trim().parse::<usize>().ok())).unwrap_or(0);if data.len()>=end+4+size{break;}}}write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",response.len(),response).unwrap();data});(address,thread)}
#[tokio::test]async fn voice_uses_real_multipart_and_returns_only_transcribed_text(){let(url,thread)=server(r#"{"text":"Minecraft 启动失败"}"#);let value=super::voice::request(&json!({"audio":"YXVkaW8=","durationMs":1000,"mime":"audio/webm"}),&json!({"endpoint":url,"model":"whisper-local","key":""})).await.unwrap();assert_eq!(value["text"],"Minecraft 启动失败");let data=String::from_utf8_lossy(&thread.join().unwrap()).into_owned();assert!(data.starts_with("POST /v1/audio/transcriptions"));assert!(data.contains("multipart/form-data"));assert!(data.contains("whisper-local"));assert!(data.contains("recording.webm"));assert!(!data.to_lowercase().contains("authorization:"));}
#[tokio::test]async fn voice_empty_text_is_actionable(){let(url,thread)=server(r#"{"text":""}"#);let error=super::voice::request(&json!({"audio":"YXVkaW8=","durationMs":1000,"mime":"audio/webm"}),&json!({"endpoint":url,"model":"local","key":""})).await.unwrap_err();assert!(error.contains("未识别到文字"));thread.join().unwrap();}

#[tokio::test]
async fn voice_retries_an_http_500_once() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/v1/audio/transcriptions", listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        for (status, response) in [("500 Internal Server Error", "{}"), ("200 OK", r#"{"text":"语音补试成功"}"#)] {
            let (mut socket, _) = listener.accept().unwrap();
            socket.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
            let mut body = Vec::new();
            loop {
                let mut buffer = [0; 4096];
                let n = socket.read(&mut buffer).unwrap();
                assert!(n > 0);
                body.extend_from_slice(&buffer[..n]);
                if let Some(end) = body.windows(4).position(|bytes| bytes == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&body[..end]).to_ascii_lowercase();
                    let length = headers.lines().find_map(|line| line.strip_prefix("content-length:"))
                        .unwrap().trim().parse::<usize>().unwrap();
                    if body.len() >= end + 4 + length { break; }
                }
            }
            write!(socket, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response}", response.len()).unwrap();
        }
    });
    let result = super::voice::request(
        &json!({"audio":"YXVkaW8=","durationMs":1000,"mime":"audio/webm"}),
        &json!({"endpoint":url,"model":"local","key":""}),
    ).await.unwrap();
    assert_eq!(result["text"], "语音补试成功");
    server.join().unwrap();
}
