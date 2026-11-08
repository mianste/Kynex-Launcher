//! 启动前同步 `options.txt`：游戏语言、窗口模式等。
//!
//! 行为约定参考 PCL 的启动前处理：语言代码在旧版本（1.10 及以前）必须写成
//! 大写后缀（`zh_CN`），否则 1.1~1.5 会崩溃、1.6~1.10 会回退英文；
//! 1.11 起只认小写（`zh_cn`）。这里按实例版本号自动选择大小写。

use crate::{err, Result};
use std::path::{Path, PathBuf};

/// 把用户偏好（zh_cn / en_us / none）换算成实际写入的语言代码。
/// 返回 `None` 表示不修改 `options.txt`。
pub fn target_language(preference: &str, version_id: &str) -> Option<String> {
    let language = match preference {
        "none" => return None,
        "en_us" => "en_us",
        _ => "zh_cn",
    };
    Some(normalize(language, version_id))
}

/// 1.10 及以前需要大写后缀；1.11 起使用小写。
fn normalize(language: &str, version_id: &str) -> String {
    let minor = minor_version(version_id);
    if minor.is_some_and(|minor| minor <= 10) {
        let split = language.len().saturating_sub(2);
        format!("{}{}", &language[..split], language[split..].to_uppercase())
    } else {
        language.to_string()
    }
}

/// 从 `1.7.10` / `1.20.1` 这类版本号里取出次版本号（7、20）。
/// 快照或其他无法识别的版本返回 `None`，此时按新版本处理。
pub fn minor_version(version_id: &str) -> Option<u32> {
    let mut parts = version_id.trim().split('.');
    let major = parts.next()?.parse::<u32>().ok()?;
    let minor = parts.next()?.parse::<u32>().ok()?;
    if major == 1 {
        Some(minor)
    } else {
        None
    }
}

/// 找到应该写入的 `options.txt`。
///
/// 实例根目录没有 `options.txt` 时，兼容 Yosbr 模组把配置放在
/// `config/yosbr/options.txt` 的情况；两者都没有则创建实例根目录下的文件。
fn options_path(game_dir: &Path) -> PathBuf {
    let primary = game_dir.join("options.txt");
    if primary.exists() {
        return primary;
    }
    let yosbr = game_dir.join("config").join("yosbr").join("options.txt");
    if yosbr.exists() {
        return yosbr;
    }
    primary
}

/// 在保留其余行的前提下写入或替换一行 `lang:`。
fn set_language(text: &str, language: &str) -> String {
    let newline = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let mut replaced = false;
    let mut lines: Vec<String> = text
        .lines()
        .map(|line| {
            if !replaced && line.trim_start().starts_with("lang:") {
                replaced = true;
                format!("lang:{language}")
            } else {
                line.to_string()
            }
        })
        .collect();
    if !replaced {
        lines.push(format!("lang:{language}"));
    }
    let mut result = lines.join(newline);
    result.push_str(newline);
    result
}

/// 启动前应用语言设置。返回实际写入的语言代码；设置为 `none` 时返回 `None`。
///
/// 失败时返回错误，调用方可以忽略它继续启动（与 PCL 只弹提示的行为一致）。
pub fn apply_language(
    game_dir: &Path,
    version_id: &str,
    preference: &str,
) -> Result<Option<String>> {
    let Some(language) = target_language(preference, version_id) else {
        return Ok(None);
    };
    let path = options_path(game_dir);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(err)?;
    }
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let updated = set_language(&existing, &language);
    if updated != existing {
        let temp = path.with_extension("txt.kxl-tmp");
        std::fs::write(&temp, updated.as_bytes()).map_err(err)?;
        std::fs::rename(&temp, &path).map_err(err)?;
    }
    Ok(Some(language))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_versions_use_upper_case_suffix() {
        assert_eq!(target_language("zh_cn", "1.7.10").as_deref(), Some("zh_CN"));
        assert_eq!(target_language("zh_cn", "1.10").as_deref(), Some("zh_CN"));
        assert_eq!(target_language("zh_cn", "1.12.2").as_deref(), Some("zh_cn"));
        assert_eq!(target_language("zh_cn", "1.21.4").as_deref(), Some("zh_cn"));
        assert_eq!(target_language("zh_cn", "24w14a").as_deref(), Some("zh_cn"));
    }

    #[test]
    fn none_preference_skips_write() {
        assert_eq!(target_language("none", "1.20.1"), None);
        assert_eq!(target_language("en_us", "1.20.1").as_deref(), Some("en_us"));
    }

    #[test]
    fn replaces_existing_language_and_keeps_other_lines() {
        let text = "fullscreen:true\nlang:en_us\nfov:0.5\n";
        let updated = set_language(text, "zh_cn");
        assert!(updated.contains("fullscreen:true"));
        assert!(updated.contains("fov:0.5"));
        assert!(updated.contains("lang:zh_cn"));
        assert!(!updated.contains("lang:en_us"));
        assert_eq!(updated.matches("lang:").count(), 1);
    }

    #[test]
    fn appends_language_when_missing() {
        let updated = set_language("fov:0.5\n", "zh_cn");
        assert!(updated.contains("fov:0.5\nlang:zh_cn\n"));
    }

    #[test]
    fn keeps_crlf_files_consistent() {
        let updated = set_language("fov:0.5\r\nlang:en_us\r\n", "zh_cn");
        assert_eq!(updated, "fov:0.5\r\nlang:zh_cn\r\n");
    }

    #[test]
    fn writes_into_instance_directory() {
        let dir = tempfile::tempdir().unwrap();
        let game = dir.path();
        let applied = apply_language(game, "1.20.1", "zh_cn").unwrap();
        assert_eq!(applied.as_deref(), Some("zh_cn"));
        let text = std::fs::read_to_string(game.join("options.txt")).unwrap();
        assert_eq!(text, "lang:zh_cn\n");
    }

    #[test]
    fn prefers_yosbr_when_primary_missing() {
        let dir = tempfile::tempdir().unwrap();
        let yosbr = dir.path().join("config").join("yosbr");
        std::fs::create_dir_all(&yosbr).unwrap();
        std::fs::write(yosbr.join("options.txt"), "lang:en_us\n").unwrap();
        apply_language(dir.path(), "1.20.1", "zh_cn").unwrap();
        assert!(!dir.path().join("options.txt").exists());
        assert_eq!(
            std::fs::read_to_string(yosbr.join("options.txt")).unwrap(),
            "lang:zh_cn\n"
        );
    }
}
