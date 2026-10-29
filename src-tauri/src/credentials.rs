//! Versioned, atomic credential chunks. Every byte remains in the OS vault.
use crate::*;
use sha2::{Digest, Sha256};
use std::sync::Mutex;
const PREFIX: &[u8] = b"KXL-VAULT-2\n";
const CHUNK: usize = 2048;
const MAX: usize = 128 * 1024;
static LOCK: Mutex<()> = Mutex::new(());
#[derive(serde::Serialize, serde::Deserialize)]
struct Manifest {
    generation: String,
    count: usize,
    size: usize,
    hash: String,
}
fn entry(id: &str) -> Result<keyring::Entry> {
    keyring::Entry::new("Kynex Launcher", id).map_err(err)
}
fn part(id: &str, m: &Manifest, i: usize) -> String {
    format!("{id}:{}:{i}", m.generation)
}
fn manifest(bytes: &[u8]) -> Result<Option<Manifest>> {
    let Some(json) = bytes.strip_prefix(PREFIX) else {
        return Ok(None);
    };
    let m: Manifest = serde_json::from_slice(json).map_err(|_| "账号凭据索引损坏")?;
    if uuid::Uuid::parse_str(&m.generation).is_err()
        || m.size == 0
        || m.size > MAX
        || m.count != m.size.div_ceil(CHUNK)
    {
        return Err("账号凭据索引无效".into());
    }
    Ok(Some(m))
}
fn clean(id: &str, m: &Manifest) {
    for i in 0..m.count {
        if let Ok(e) = entry(&part(id, m, i)) {
            let _ = e.delete_credential();
        }
    }
}
pub fn store(id: &str, value: &Value) -> Result<()> {
    let _guard = LOCK.lock().map_err(err)?;
    let data = serde_json::to_vec(value).map_err(err)?;
    if data.len() > MAX {
        return Err("登录凭据超过安全存储上限".into());
    }
    let root = entry(id)?;
    let previous = root
        .get_secret()
        .ok()
        .and_then(|v| manifest(&v).ok().flatten());
    let next = Manifest {
        generation: uuid::Uuid::new_v4().to_string(),
        count: data.len().div_ceil(CHUNK),
        size: data.len(),
        hash: format!("{:x}", Sha256::digest(&data)),
    };
    let write = (|| -> Result<()> {
        for (i, bytes) in data.chunks(CHUNK).enumerate() {
            entry(&part(id, &next, i))?.set_secret(bytes).map_err(err)?;
        }
        let mut header = PREFIX.to_vec();
        header.extend(serde_json::to_vec(&next).map_err(err)?);
        root.set_secret(&header).map_err(err)
    })();
    if let Err(error) = write {
        clean(id, &next);
        return Err(format!(
            "无法存入系统凭据库：{error}。账号凭据不会以明文落盘。"
        ));
    }
    if let Some(old) = previous {
        clean(id, &old);
    }
    Ok(())
}
pub fn load(id: &str) -> Result<Value> {
    let _guard = LOCK.lock().map_err(err)?;
    let root = entry(id)?;
    let bytes = root
        .get_secret()
        .map_err(|_| "无法读取登录凭据，请重新登录")?;
    if let Some(m) = manifest(&bytes)? {
        let mut data = Vec::with_capacity(m.size);
        for i in 0..m.count {
            let bytes = entry(&part(id, &m, i))?
                .get_secret()
                .map_err(|_| "账号凭据缺失，请重新登录")?;
            if bytes.len() > CHUNK {
                return Err("账号凭据长度无效".into());
            }
            data.extend(bytes);
        }
        if data.len() != m.size || format!("{:x}", Sha256::digest(&data)) != m.hash {
            return Err("账号凭据校验失败，请重新登录".into());
        }
        return serde_json::from_slice(&data).map_err(|_| "账号凭据格式无效".into());
    }
    // Old Windows set_password records are UTF-16; other stores may use UTF-8.
    serde_json::from_slice(&bytes)
        .or_else(|_| {
            let text = root.get_password().unwrap_or_default();
            serde_json::from_str(&text)
        })
        .map_err(|_| "无法读取登录凭据，请重新登录".into())
}
pub fn remove(id: &str) -> Result<()> {
    let _guard = LOCK.lock().map_err(err)?;
    let root = entry(id)?;
    if let Ok(bytes) = root.get_secret() {
        if let Some(m) = manifest(&bytes)? {
            clean(id, &m);
        }
    }
    match root.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(err(e)),
    }
}
#[cfg(all(test, windows))]
mod tests {
    use super::*;
    struct Cleanup(String);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = remove(&self.0);
        }
    }
    #[test]
    fn windows_long_credentials_roundtrip_migrate_and_cleanup() {
        let id = Cleanup(format!("qa-vault-{}", uuid::Uuid::new_v4()));
        entry(&id.0)
            .unwrap()
            .set_password(r#"{"refresh":"旧版凭据"}"#)
            .unwrap();
        assert_eq!(load(&id.0).unwrap()["refresh"], "旧版凭据");
        let value = json!({"refresh":"测试令牌".repeat(5000),"clientId":"dummy"});
        store(&id.0, &value).unwrap();
        assert_eq!(load(&id.0).unwrap(), value);
        assert!(store(&id.0, &json!({"refresh":"x".repeat(MAX+1)})).is_err());
        assert_eq!(load(&id.0).unwrap(), value);
        let old = manifest(&entry(&id.0).unwrap().get_secret().unwrap())
            .unwrap()
            .unwrap();
        store(&id.0, &json!({"refresh":"new"})).unwrap();
        assert!(matches!(
            entry(&part(&id.0, &old, 0)).unwrap().get_secret(),
            Err(keyring::Error::NoEntry)
        ));
        let m = manifest(&entry(&id.0).unwrap().get_secret().unwrap())
            .unwrap()
            .unwrap();
        entry(&part(&id.0, &m, 0))
            .unwrap()
            .set_secret(b"corrupt")
            .unwrap();
        assert!(load(&id.0).unwrap_err().contains("校验失败"));
        remove(&id.0).unwrap();
        assert!(matches!(
            entry(&part(&id.0, &m, 0)).unwrap().get_secret(),
            Err(keyring::Error::NoEntry)
        ));
        assert!(matches!(
            entry(&id.0).unwrap().get_secret(),
            Err(keyring::Error::NoEntry)
        ));
    }
}
