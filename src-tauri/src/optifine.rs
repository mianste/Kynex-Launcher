//! OptiFine's published installer format, implemented independently.
use crate::*;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    pub value: String,
    pub filename: String,
    pub edition: String,
    pub patch: String,
    pub forge: Option<String>,
}
fn decode(list: &Value) -> Vec<Release> {
    let mut releases: Vec<_> = list
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|row| {
            let edition = row["type"].as_str()?;
            let patch = row["patch"].as_str()?;
            let filename = row["filename"].as_str()?;
            if [edition, patch, filename]
                .iter()
                .any(|v| safe_name(v).is_err())
                || !filename.ends_with(".jar")
            {
                return None;
            }
            let forge = row["forge"].as_str().and_then(|text| {
                let candidate = text.trim().strip_prefix("Forge ").unwrap_or(text.trim());
                (!candidate.is_empty() && candidate.chars().all(|c| c.is_ascii_digit() || c == '.'))
                    .then(|| candidate.to_string())
            });
            Some(Release {
                value: format!("{edition}_{patch}"),
                filename: filename.into(),
                edition: edition.into(),
                patch: patch.into(),
                forge,
            })
        })
        .collect();
    releases.sort_by(|a, b| b.patch.cmp(&a.patch));
    releases.dedup_by(|a, b| a.value == b.value);
    releases
}
pub async fn releases(core: &Core, game: &str) -> Result<Value> {
    safe_name(game)?;
    let path = core
        .root
        .join("cache/optifine")
        .join(format!("{game}.json"));
    if path
        .metadata()
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.elapsed().ok())
        .is_some_and(|age| age.as_secs() < 3600)
    {
        if let Ok(value) = read_json(&path) {
            return Ok(value);
        }
    }
    let response = core
        .http
        .get(format!("https://bmclapi2.bangbang93.com/optifine/{game}"))
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(err)?;
    let result = if response.status() == reqwest::StatusCode::NOT_FOUND {
        vec![]
    } else {
        decode(
            &response
                .error_for_status()
                .map_err(err)?
                .json::<Value>()
                .await
                .map_err(err)?,
        )
    };
    let value = json!(result);
    write_json(&path, &value)?;
    Ok(value)
}
pub async fn selected(
    core: &Core,
    game: &str,
    value: &str,
    forge: Option<&str>,
) -> Result<Release> {
    let list: Vec<Release> = serde_json::from_value(releases(core, game).await?).map_err(err)?;
    let release = list
        .into_iter()
        .find(|r| r.value == value)
        .ok_or("所选游戏版本没有这个 OptiFine 版本，请重新选择")?;
    if let Some(forge) = forge {
        if release.forge.as_deref() != Some(forge) {
            return Err(format!(
                "此 OptiFine 对应 Forge {}，请使用匹配的 Forge 版本",
                release.forge.as_deref().unwrap_or("暂无兼容版本")
            ));
        }
    }
    Ok(release)
}
fn validate(path: &Path) -> Result<()> {
    let mut zip = zip::ZipArchive::new(std::fs::File::open(path).map_err(err)?)
        .map_err(|_| "OptiFine 下载内容不是有效的 JAR，已停止安装".to_string())?;
    if zip.by_name("optifine/OptiFineTweaker.class").is_err() {
        return Err("下载的文件缺少 OptiFine 启动类".into());
    }
    Ok(())
}
fn local_library(core: &Core, name: &str, relative: &str, bytes: &[u8]) -> Result<Value> {
    let path = core.root.join("libraries").join(relative);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(err)?;
    }
    std::fs::File::create(&path)
        .map_err(err)?
        .write_all(bytes)
        .map_err(err)?;
    Ok(
        json!({"name":name,"downloads":{"artifact":{"path":relative,"url":"https://optifine.net/","sha1":format!("{:x}",sha1::Sha1::digest(bytes))}}}),
    )
}
use sha1::Digest;

pub async fn install(
    core: &Core,
    game: &str,
    release: &Release,
    forge: bool,
    java: &str,
    dir: &Path,
    version: &mut Value,
) -> Result<()> {
    let installer = core.root.join("cache/optifine").join(&release.filename);
    core.stage("下载 OptiFine", 0, 1);
    if validate(&installer).is_err() {
        crate::engine::download(
            core,
            &format!(
                "https://bmclapi2.bangbang93.com/optifine/{game}/{}/{}",
                release.edition, release.patch
            ),
            &installer,
            "",
        )
        .await?;
    }
    if let Err(error) = validate(&installer) {
        let _ = std::fs::remove_file(&installer);
        return Err(error);
    }
    if forge {
        // Forge discovers the official universal installer as a mod; its main class is preserved.
        std::fs::create_dir_all(dir.join("mods")).map_err(err)?;
        std::fs::copy(&installer, dir.join("mods").join(&release.filename)).map_err(err)?;
    } else {
        core.stage("安装 OptiFine 补丁", 0, 1);
        let coordinate = format!("{game}_{}", release.value);
        let relative = format!("optifine/OptiFine/{coordinate}/OptiFine-{coordinate}.jar");
        let patched = core.root.join("libraries").join(&relative);
        std::fs::create_dir_all(patched.parent().unwrap()).map_err(err)?;
        let has_patcher = {
            let mut zip =
                zip::ZipArchive::new(std::fs::File::open(&installer).map_err(err)?).map_err(err)?;
            let found = zip.by_name("optifine/Patcher.class").is_ok();
            found
        };
        if has_patcher {
            let mut command = tokio::process::Command::new(java);
            command
                .arg("-cp")
                .arg(&installer)
                .arg("optifine.Patcher")
                .arg(dir.join("client.jar"))
                .arg(&installer)
                .arg(&patched);
            crate::engine::run_installer(core, &mut command, "OptiFine 补丁").await?;
        } else {
            std::fs::copy(&installer, &patched).map_err(err)?;
        }
        validate(&patched)?;
        let bytes = std::fs::read(&patched).map_err(err)?;
        let library = local_library(
            core,
            &format!("optifine:OptiFine:{coordinate}"),
            &relative,
            &bytes,
        )?;
        let wrapper = {
            let mut zip =
                zip::ZipArchive::new(std::fs::File::open(&installer).map_err(err)?).map_err(err)?;
            let wrapper_version = if let Ok(mut file) = zip.by_name("launchwrapper-of.txt") {
                let mut text = String::new();
                file.read_to_string(&mut text).map_err(err)?;
                Some(text.trim().to_string())
            } else {
                None
            };
            let (entry, name, path) = if let Some(v) = wrapper_version {
                safe_name(&v)?;
                (
                    format!("launchwrapper-of-{v}.jar"),
                    format!("optifine:launchwrapper-of:{v}"),
                    format!("optifine/launchwrapper-of/{v}/launchwrapper-of-{v}.jar"),
                )
            } else {
                (
                    "launchwrapper-2.0.jar".into(),
                    "optifine:launchwrapper:2.0".into(),
                    "optifine/launchwrapper/2.0/launchwrapper-2.0.jar".into(),
                )
            };
            let result = if let Ok(mut file) = zip.by_name(&entry) {
                let mut bytes = Vec::new();
                file.read_to_end(&mut bytes).map_err(err)?;
                Some(local_library(core, &name, &path, &bytes)?)
            } else {
                None
            };
            result
        };
        let libraries = version["libraries"]
            .as_array_mut()
            .ok_or("缺少游戏依赖库")?;
        libraries.push(library);
        libraries
            .push(wrapper.unwrap_or_else(|| json!({"name":"net.minecraft:launchwrapper:1.12"})));
        version["mainClass"] = json!("net.minecraft.launchwrapper.Launch");
        if version["arguments"].is_object() {
            let args = version["arguments"]["game"]
                .as_array_mut()
                .ok_or("游戏启动参数无效")?;
            args.extend([json!("--tweakClass"), json!("optifine.OptiFineTweaker")]);
        } else {
            version["minecraftArguments"] = json!(format!(
                "{} --tweakClass optifine.OptiFineTweaker",
                version["minecraftArguments"].as_str().unwrap_or("")
            ));
        }
    }
    core.stage("OptiFine 安装完成", 1, 1);
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn compatibility_comes_from_published_metadata() {
        let rows = decode(
            &json!([{"type":"HD_U","patch":"I6","filename":"OptiFine_1.20.1_HD_U_I6.jar","forge":"Forge 47.2.18"},{"type":"HD_U","patch":"J1","filename":"OptiFine.jar","forge":"N/A"},{"type":"../bad","patch":"x","filename":"bad.jar"}]),
        );
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[1].forge.as_deref(), Some("47.2.18"));
        assert_eq!(rows[0].forge, None);
    }
    #[test]
    fn html_is_not_an_installer() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bad.jar");
        std::fs::write(&path, b"<html>error</html>").unwrap();
        assert!(validate(&path).is_err());
    }
}
