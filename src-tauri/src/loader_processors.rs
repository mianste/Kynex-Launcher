//! Execute the declared client processors without rewriting a signed installer.
//! Architecture reference: HMCL ForgeNewInstallTask (see docs/RESOURCE-LOADER-REFERENCE.md).
use crate::*;
use sha1::{Digest, Sha1};
use std::{collections::BTreeMap, io::{Read, Write}};

type Archive = zip::ZipArchive<std::fs::File>;

fn read_entry(archive: &mut Archive, name: &str) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    archive.by_name(name.trim_start_matches('/')).map_err(err)?.read_to_end(&mut bytes).map_err(err)?;
    Ok(bytes)
}
fn signed(archive: &Archive) -> bool {
    archive.file_names().any(|name| {
        let name = name.to_ascii_uppercase();
        name.starts_with("META-INF/") && [".SF", ".RSA", ".DSA", ".EC"].iter().any(|suffix| name.ends_with(suffix))
    })
}
fn artifact(root: &Path, coordinate: &str) -> Result<PathBuf> {
    engine::under(&root.join("libraries"), &engine::lib_path(coordinate)?)
}
fn substitute(value: &str, vars: &BTreeMap<String, String>, root: &Path) -> Result<String> {
    if let Some(literal) = value.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')) {
        return Ok(literal.into());
    }
    if let Some(coordinate) = value.strip_prefix('[').and_then(|v| v.strip_suffix(']')) {
        return Ok(artifact(root, coordinate)?.to_string_lossy().into_owned());
    }
    let pattern = regex::Regex::new(r"\{([^{}]+)\}").map_err(err)?;
    let mut result = value.to_owned();
    for captures in pattern.captures_iter(value) {
        let key = &captures[1];
        let replacement = vars.get(key).ok_or_else(|| format!("加载器变量未定义：{key}"))?;
        result = result.replace(&captures[0], replacement);
    }
    Ok(result)
}
fn main_class(jar: &Path) -> Result<String> {
    let mut archive = Archive::new(std::fs::File::open(jar).map_err(err)?).map_err(err)?;
    let text = String::from_utf8(read_entry(&mut archive, "META-INF/MANIFEST.MF")?).map_err(err)?;
    let mut unfolded = String::new();
    for line in text.lines().take_while(|line| !line.is_empty()) {
        if let Some(continuation) = line.strip_prefix(' ') { unfolded.push_str(continuation); }
        else { unfolded.push('\n'); unfolded.push_str(line); }
    }
    let name = unfolded.lines().find_map(|line| line.split_once(':').filter(|(key, _)| key.eq_ignore_ascii_case("Main-Class")).map(|(_, value)| value.trim().to_owned())).ok_or("加载器处理工具缺少 Main-Class")?;
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || "._$".contains(c)) {
        return Err("加载器处理工具入口无效".into());
    }
    Ok(name)
}
fn checked_output(core: &Core, work: &Path, output: &str) -> Result<PathBuf> {
    let path = PathBuf::from(output);
    if path.components().any(|c| matches!(c, std::path::Component::ParentDir)) || !(path.starts_with(&core.root) || path.starts_with(work)) {
        return Err("加载器输出路径超出游戏目录".into());
    }
    Ok(path)
}
fn outputs(core: &Core, work: &Path, processor: &Value, vars: &BTreeMap<String, String>) -> Result<Vec<(PathBuf, String)>> {
    processor["outputs"].as_object().into_iter().flatten().map(|(path, hash)| {
        let path = checked_output(core, work, &substitute(path, vars, &core.root)?)?;
        let hash = substitute(hash.as_str().ok_or("加载器输出校验值无效")?, vars, &core.root)?;
        if hash.len() != 40 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) { return Err("加载器输出校验值无效".into()); }
        Ok((path, hash))
    }).collect()
}
async fn outputs_valid(values: &[(PathBuf, String)]) -> Result<bool> {
    for (path, hash) in values {
        if !engine::cached_file_valid(path, hash).await? { return Ok(false); }
    }
    Ok(true)
}

pub(crate) async fn install_if_signed(core: &Core, installer: &Path, base: &Value, java: &str) -> Result<Option<Value>> {
    let mut archive = Archive::new(std::fs::File::open(installer).map_err(err)?).map_err(err)?;
    if !signed(&archive) { return Ok(None); }
    let profile: Value = serde_json::from_slice(&read_entry(&mut archive, "install_profile.json")?).map_err(err)?;
    if !profile["processors"].is_array() { return Ok(None); }
    if profile["minecraft"].as_str().is_some_and(|game| Some(game) != base["id"].as_str()) { return Err("加载器与游戏版本不匹配".into()); }
    let work = core.root.join("cache/loader-work").join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&work).map_err(err)?;
    let result = run(core, installer, base, java, &profile, &work, &mut archive).await;
    // The work directory is created above for this invocation only.
    let _ = std::fs::remove_dir_all(&work);
    result.map(Some)
}

async fn run(core: &Core, installer: &Path, base: &Value, java: &str, profile: &Value, work: &Path, archive: &mut Archive) -> Result<Value> {
    let version: Value = serde_json::from_slice(&read_entry(archive, profile["json"].as_str().unwrap_or("version.json"))?).map_err(err)?;
    let version_id = safe_name(string(&version, "id")?)?;
    let game = string(base, "id")?;
    // External tools receive a disposable copy, never the reusable vanilla JAR.
    let vanilla = core.root.join("versions").join(game).join(format!("{game}.jar"));
    let minecraft = work.join("minecraft.jar");
    std::fs::copy(&vanilla, &minecraft).map_err(|e| format!("复制原版客户端失败：{e}"))?;
    let mut libraries: Vec<Value> = profile["libraries"].as_array().cloned().unwrap_or_default();
    libraries.extend(version["libraries"].as_array().into_iter().flatten().cloned());
    if let Some(name) = profile["path"].as_str() { libraries.push(json!({"name":name})); }
    for library in libraries {
        let path = library["downloads"]["artifact"]["path"].as_str().map(str::to_owned).unwrap_or(engine::lib_path(string(&library, "name")?)?);
        let name = format!("maven/{path}");
        if archive.by_name(&name).is_err() { continue; }
        let bytes = read_entry(archive, &name)?;
        if let Some(hash) = library["downloads"]["artifact"]["sha1"].as_str().filter(|hash| !hash.is_empty()) {
            if !format!("{:x}", Sha1::digest(&bytes)).eq_ignore_ascii_case(hash) { return Err(format!("安装器内置依赖校验失败：{path}")); }
        }
        let target = engine::under(&core.root.join("libraries"), &path)?;
        if std::fs::read(&target).ok().as_deref() == Some(bytes.as_slice()) { continue; }
        std::fs::create_dir_all(target.parent().unwrap()).map_err(err)?;
        std::fs::write(target, bytes).map_err(err)?;
    }
    let mut vars: BTreeMap<String, String> = [
        ("SIDE", "client".into()), ("ROOT", core.root.to_string_lossy().into_owned()),
        ("INSTALLER", installer.to_string_lossy().into_owned()),
        ("LIBRARY_DIR", core.root.join("libraries").to_string_lossy().into_owned()),
        ("MINECRAFT_JAR", minecraft.to_string_lossy().into_owned()), ("MINECRAFT_VERSION", game.into()),
    ].into_iter().map(|(k,v)| (k.into(),v)).collect();
    let mut data: Vec<(String,String)> = profile["data"].as_object().into_iter().flatten().filter_map(|(key,value)| value["client"].as_str().map(|v| (key.clone(),v.to_owned()))).collect();
    while !data.is_empty() {
        let before = data.len();
        let mut pending = Vec::new();
        for (key, value) in data {
            if value.starts_with('/') {
                let dest = engine::under(work, value.trim_start_matches('/'))?;
                let bytes = read_entry(archive, &value)?;
                std::fs::create_dir_all(dest.parent().unwrap()).map_err(err)?;
                std::fs::File::create(&dest).map_err(err)?.write_all(&bytes).map_err(err)?;
                vars.insert(key, dest.to_string_lossy().into_owned());
            } else if let Ok(value) = substitute(&value, &vars, &core.root) { vars.insert(key, value); }
            else { pending.push((key,value)); }
        }
        if pending.len() == before { return Err("加载器数据包含无法解析的变量".into()); }
        data = pending;
    }
    let steps: Vec<&Value> = profile["processors"].as_array().unwrap().iter().filter(|p| !p["sides"].is_array() || p["sides"].as_array().unwrap().iter().any(|side| side == "client")).collect();
    for (index, processor) in steps.iter().enumerate() {
        core.stopped()?;
        core.stage("处理加载器客户端文件", index, steps.len());
        let args: Vec<String> = processor["args"].as_array().ok_or("加载器处理参数无效")?.iter().map(|v| substitute(v.as_str().ok_or("加载器处理参数无效")?, &vars, &core.root)).collect::<Result<_>>()?;
        let arg = |key: &str| args.windows(2).find(|v| v[0] == key).map(|v| v[1].as_str());
        if arg("--task") == Some("DOWNLOAD_MOJMAPS") && arg("--side") == Some("client") && arg("--version") == Some(game) {
            let output = checked_output(core, work, arg("--output").ok_or("映射输出路径缺失")?)?;
            let mapping = &base["downloads"]["client_mappings"];
            let hash = string(mapping,"sha1")?;
            if hash.len() != 40 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) { return Err("官方映射校验值无效".into()); }
            engine::download(core, string(mapping,"url")?, &output, hash).await?;
            continue;
        }
        let expected = outputs(core, work, processor, &vars)?;
        if !expected.is_empty() && outputs_valid(&expected).await? { continue; }
        let jar = artifact(&core.root, string(processor,"jar")?)?;
        let mut classpath: Vec<PathBuf> = processor["classpath"].as_array().into_iter().flatten().map(|v| artifact(&core.root, v.as_str().ok_or("加载器工具依赖无效")?)).collect::<Result<_>>()?;
        classpath.push(jar.clone());
        if let Some(missing) = classpath.iter().find(|p| !p.is_file()) { return Err(format!("加载器处理工具依赖缺失：{}", missing.display())); }
        let mut command = tokio::process::Command::new(java);
        command.current_dir(work).arg("-cp").arg(std::env::join_paths(&classpath).map_err(err)?).arg(main_class(&jar)?).args(&args);
        engine::run_installer(core, &mut command, "加载器处理").await?;
        if !outputs_valid(&expected).await? { return Err("加载器生成文件的校验值不匹配".into()); }
    }
    core.stage("处理加载器客户端文件", steps.len(), steps.len());
    // Publish a reusable version only after all processors have succeeded.
    write_json(&core.root.join("versions").join(&version_id).join(format!("{version_id}.json")), &version)?;
    Ok(version)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    #[ignore = "runs an isolated, signed fixture using a supplied local Java runtime"]
    async fn signed_installer_runs_processors_preserves_original_and_checks_outputs() {
        let fixture = PathBuf::from(std::env::var("KXL_PROCESSOR_FIXTURE").unwrap());
        let java = std::env::var("KXL_QA_JAVA").unwrap();
        let temp = tempfile::tempdir().unwrap();
        for (name, fails) in [("signed-loader.jar", false), ("signed-bad-output.jar", true)] {
            let core = Core::new(temp.path().join(if fails {"bad"} else {"good"}), Arc::new(|_|{})).unwrap();
            let installer = core.root.join("installer.jar");
            std::fs::copy(fixture.join(name), &installer).unwrap();
            let before = std::fs::read(&installer).unwrap();
            let vanilla = core.root.join("versions/1.21.1/1.21.1.jar");
            std::fs::create_dir_all(vanilla.parent().unwrap()).unwrap();
            std::fs::write(&vanilla, b"reusable-vanilla-client").unwrap();
            let mapping = artifact(&core.root, "test:maps:1.0@txt").unwrap();
            std::fs::create_dir_all(mapping.parent().unwrap()).unwrap();
            std::fs::write(mapping, b"verified-mappings").unwrap();
            let base = json!({"id":"1.21.1","downloads":{"client_mappings":{"url":"https://example.invalid/must-use-verified-cache","sha1":format!("{:x}",Sha1::digest(b"verified-mappings"))}}});
            let result = install_if_signed(&core, &installer, &base, &java).await;
            assert_eq!(std::fs::read(&installer).unwrap(), before);
            assert_eq!(std::fs::read(vanilla).unwrap(), b"reusable-vanilla-client");
            let published = core.root.join("versions/fixture-forge/fixture-forge.json");
            if fails { assert!(result.unwrap_err().contains("校验")); assert!(!published.exists()); }
            else { assert_eq!(result.unwrap().unwrap()["id"], "fixture-forge"); assert!(published.exists()); }
            assert_eq!(std::fs::read(core.root.join("libraries/result.bin")).unwrap(), b"processed");
        }
        println!("signed fixture: Java processor executed, installer bytes preserved, reusable vanilla preserved, corrupt outputs rejected");
        if let Ok(report) = std::env::var("KXL_QA_REPORT") {
            write_json(Path::new(&report), &json!({"processorExecuted":true,"originalInstallerPreserved":true,"originalVanillaPreserved":true,"verifiedMappingCache":true,"corruptOutputRejected":true})).unwrap();
        }
    }
    #[test]
    fn resolves_literals_coordinates_and_embedded_tokens() {
        let root = PathBuf::from("C:/game");
        let vars = BTreeMap::from([("SIDE".into(),"client".into()),("ROOT".into(),"C:/game".into())]);
        assert_eq!(substitute("'{SIDE}'", &vars, &root).unwrap(), "{SIDE}");
        assert_eq!(substitute("{ROOT}/libraries/{SIDE}", &vars, &root).unwrap(), "C:/game/libraries/client");
        assert!(substitute("[a.b:c:1.0:maps@txt]", &vars, &root).unwrap().replace('\\',"/").ends_with("a/b/c/1.0/c-1.0-maps.txt"));
        assert!(substitute("{UNKNOWN}", &vars, &root).is_err());
        assert!(substitute("[a:b:../bad]", &vars, &root).is_err());
    }
    #[test]
    fn prevents_outputs_outside_the_installation() {
        let temp = tempfile::tempdir().unwrap();
        let core = Core::new(temp.path().join("game"), Arc::new(|_|{})).unwrap();
        let work = core.root.join("work");
        assert!(checked_output(&core, &work, &core.root.join("libraries/output.jar").to_string_lossy()).is_ok());
        assert!(checked_output(&core, &work, &temp.path().join("private").to_string_lossy()).is_err());
        assert!(checked_output(&core, &work, &core.root.join("../private").to_string_lossy()).is_err());
    }
}
