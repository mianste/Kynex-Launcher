use crate::*;
use std::io::{Read, Seek, SeekFrom};
const LOG_LIMIT: usize = 256 * 1024;

pub fn read(core: &Core, p: &Value) -> Result<Value> {
    let c = game_directories::context(core, p)?;
    let instance = read_json(&c.instance(string(p, "id")?)?.join("kxl.json"))?;
    read_at(&game_directories::running_directory(&c, &instance)?)
}
fn read_at(root: &Path) -> Result<Value> {
    let mut attachments = vec![];
    let latest = root.join("logs/latest.log");
    if let Some(log) = read_log(root, &latest, "latest") { attachments.push(log); }
    let newest = std::fs::read_dir(root.join("crash-reports")).into_iter().flatten()
        .filter_map(|v| v.ok()).filter(|v| v.path().extension().is_some_and(|s| s.eq_ignore_ascii_case("txt")))
        .filter_map(|v| {let meta=v.metadata().ok()?; meta.is_file().then(||(meta.modified().ok(),v.path()))})
        .max_by(|a,b| a.0.cmp(&b.0).then_with(||a.1.cmp(&b.1)));
    if let Some((_, path)) = newest { if let Some(log)=read_log(root,&path,"crash") {attachments.push(log);} }
    let mut files: Vec<String> = std::fs::read_dir(root.join("mods")).into_iter().flatten().filter_map(|v|v.ok())
        .filter(|v|v.file_type().is_ok_and(|t|t.is_file()) && v.path().extension().is_some_and(|s|s.eq_ignore_ascii_case("jar")))
        .map(|v|v.file_name().to_string_lossy().into_owned()).collect();
    files.sort();
    Ok(json!({"attachments":attachments,"mods":{"count":files.len(),"files":files}}))
}
fn read_log(root: &Path, path: &Path, kind: &str) -> Option<Value> {
    let canonical = path.canonicalize().ok()?;
    if !canonical.starts_with(root.canonicalize().ok()?) { return None; }
    let mut file=std::fs::File::open(&canonical).ok()?;
    let length=file.metadata().ok()?.len();
    let truncated=length>LOG_LIMIT as u64;
    let mut data=vec![];
    if truncated {
        let marker=b"\n[log truncated: head and tail]\n";
        let half=(LOG_LIMIT-marker.len())/2;
        (&mut file).take(half as u64).read_to_end(&mut data).ok()?;
        data.extend_from_slice(marker);
        file.seek(SeekFrom::End(-(half as i64))).ok()?;
        (&mut file).take(half as u64).read_to_end(&mut data).ok()?;
    } else { (&mut file).take(LOG_LIMIT as u64).read_to_end(&mut data).ok()?; }
    let mut text=String::from_utf8_lossy(&data).into_owned();
    if text.len()>LOG_LIMIT {let mut end=LOG_LIMIT;while !text.is_char_boundary(end){end-=1;}text.truncate(end);}
    Some(json!({"kind":kind,"name":path.file_name()?.to_string_lossy(),"path":canonical.to_string_lossy(),"text":text,"truncated":truncated}))
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn missing_logs_and_mods_are_empty() {let dir=tempfile::tempdir().unwrap();let value=read_at(dir.path()).unwrap();assert_eq!(value["attachments"],json!([]));assert_eq!(value["mods"]["count"],0);}
    #[test] fn logs_are_bounded_and_mods_are_metadata_only() {
        let dir=tempfile::tempdir().unwrap(); let root=dir.path();
        for name in ["logs","mods","crash-reports"] {std::fs::create_dir(root.join(name)).unwrap();}
        std::fs::write(root.join("logs/latest.log"),format!("HEAD{}TAIL","中".repeat(LOG_LIMIT))).unwrap();
        std::fs::write(root.join("crash-reports/crash-new.txt"),"crash").unwrap();
        let old=root.join("crash-reports/crash-old.txt");std::fs::write(&old,"old").unwrap();
        std::fs::OpenOptions::new().write(true).open(&old).unwrap().set_times(std::fs::FileTimes::new().set_modified(std::time::UNIX_EPOCH+std::time::Duration::from_secs(10))).unwrap();
        std::fs::write(root.join("mods/a.jar"),"not a jar, must not be read").unwrap();
        std::fs::write(root.join("mods/b.jar.disabled"),"disabled").unwrap();
        let value=read_at(root).unwrap();let text=value["attachments"][0]["text"].as_str().unwrap();
        assert!(text.len()<=LOG_LIMIT);assert!(text.starts_with("HEAD"));assert!(text.ends_with("TAIL"));
        assert_eq!(value["attachments"].as_array().unwrap().len(),2);assert_eq!(value["mods"]["files"],json!(["a.jar"]));
        assert_eq!(value["attachments"][1]["name"],"crash-new.txt");
    }
}
