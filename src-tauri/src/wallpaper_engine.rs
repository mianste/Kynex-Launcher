//! Wallpaper Engine 动态壁纸扫描：读取 Steam 创意工坊 431960 中已订阅的壁纸。
//! 只把本地文件路径交给前端，由 WebView 通过 asset 协议播放，不复制壁纸文件。
use crate::*;
use std::path::{Path, PathBuf};

pub async fn scan() -> Result<Value> {
    let steam = steam_roots();
    Ok(scan_libraries(&steam))
}

fn steam_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(path) = steam_registry_path() {
        roots.push(path);
    }
    for key in ["ProgramFiles(x86)", "ProgramFiles"] {
        if let Ok(base) = std::env::var(key) {
            let candidate = Path::new(&base).join("Steam");
            if candidate.is_dir() {
                roots.push(candidate);
            }
        }
    }
    roots.sort();
    roots.dedup();
    roots
}

fn steam_registry_path() -> Option<PathBuf> {
    let output = std::process::Command::new("reg")
        .args(["query", r"HKCU\Software\Valve\Steam", "/v", "SteamPath"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let line = text.lines().find(|line| line.contains("SteamPath"))?;
    let value = line.split("REG_SZ").nth(1)?.trim().trim_matches('"');
    let path = PathBuf::from(value);
    path.is_dir().then_some(path)
}

fn library_roots(steam: &Path) -> Vec<PathBuf> {
    let mut roots = vec![steam.to_path_buf()];
    if let Ok(text) = std::fs::read_to_string(steam.join("steamapps/libraryfolders.vdf")) {
        for path in parse_library_paths(&text) {
            let candidate = PathBuf::from(path);
            if candidate.is_dir() && !roots.contains(&candidate) {
                roots.push(candidate);
            }
        }
    }
    roots
}

fn parse_library_paths(text: &str) -> Vec<String> {
    let Ok(re) = regex::Regex::new(r#""path"\s+"([^"]+)""#) else {
        return vec![];
    };
    re.captures_iter(text)
        .map(|captures| captures[1].replace("\\\\", "\\"))
        .collect()
}

fn scan_libraries(steam_roots: &[PathBuf]) -> Value {
    let mut wallpapers = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut installed = false;
    let mut workshop_found = false;
    let mut hidden = 0usize;
    for steam in steam_roots {
        for root in library_roots(steam) {
            if root.join("steamapps/common/wallpaper_engine").is_dir() {
                installed = true;
            }
            let workshop = root.join("steamapps/workshop/content/431960");
            if !workshop.is_dir() {
                continue;
            }
            workshop_found = true;
            let Ok(entries) = std::fs::read_dir(&workshop) else {
                continue;
            };
            for entry in entries.flatten() {
                let dir = entry.path();
                if !dir.is_dir() {
                    continue;
                }
                // 同一个 Steam 库可能通过多个 roots 出现，按目录去重（大小写、斜杠都归一）。
                if !seen.insert(
                    dir.to_string_lossy()
                        .replace('/', "\\")
                        .to_ascii_lowercase(),
                ) {
                    continue;
                }
                if let Some(item) = wallpaper_entry(&dir) {
                    // 只有视频壁纸能在 WebView 里真正播放；场景/Web 已隐藏。
                    if item["kind"] == "video" && item["video"].is_string() {
                        wallpapers.push(item);
                    } else {
                        hidden += 1;
                    }
                }
            }
        }
    }
    wallpapers.sort_by(|a, b| {
        let left = a["title"].as_str().unwrap_or("").to_lowercase();
        let right = b["title"].as_str().unwrap_or("").to_lowercase();
        left.cmp(&right)
    });
    wallpapers.truncate(300);
    json!({
        "installed": installed || workshop_found,
        "workshopFound": workshop_found,
        "hidden": hidden,
        "wallpapers": wallpapers,
    })
}

fn wallpaper_entry(dir: &Path) -> Option<Value> {
    let project = read_json(&dir.join("project.json")).ok()?;
    let kind = project["type"]
        .as_str()
        .unwrap_or("scene")
        .to_ascii_lowercase();
    let title = project["title"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| dir.file_name().map(|name| name.to_string_lossy().to_string()))?;
    let preview = ["preview.jpg", "preview.gif", "preview.png", "preview.jpeg"]
        .iter()
        .map(|name| dir.join(name))
        .find(|path| path.is_file())
        .map(|path| path.to_string_lossy().to_string());
    let video = if kind == "video" {
        let usable = |path: &Path| {
            path.is_file()
                && path
                    .metadata()
                    .map(|meta| meta.len() > 0)
                    .unwrap_or(false)
                && path
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .is_some_and(|extension| {
                        matches!(extension.to_ascii_lowercase().as_str(), "mp4" | "webm")
                    })
        };
        let named = project["file"]
            .as_str()
            .map(|name| dir.join(name))
            .filter(|path| usable(path));
        named.or_else(|| {
            std::fs::read_dir(dir)
                .ok()?
                .flatten()
                .map(|entry| entry.path())
                .find(|path| usable(path))
        })
        .map(|path| path.to_string_lossy().to_string())
    } else {
        None
    };
    if kind == "video" && video.is_none() {
        return None;
    }
    Some(json!({
        "id": dir.file_name()?.to_string_lossy(),
        "title": title,
        "kind": kind,
        "preview": preview,
        "video": video,
        "dir": dir.to_string_lossy(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_library_paths_and_unescapes_backslashes() {
        let vdf = r#"
"libraryfolders"
{
    "0" { "path" "C:\\Program Files (x86)\\Steam" }
    "1" { "path" "D:\\SteamLibrary" }
}
"#;
        assert_eq!(
            parse_library_paths(vdf),
            vec!["C:\\Program Files (x86)\\Steam", "D:\\SteamLibrary"]
        );
    }

    #[test]
    fn reads_video_wallpaper_project() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("431960");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("project.json"),
            r#"{"type":"video","file":"loop.mp4","title":"Neon City"}"#,
        )
        .unwrap();
        std::fs::write(dir.join("loop.mp4"), b"video").unwrap();
        std::fs::write(dir.join("preview.jpg"), b"jpg").unwrap();
        let item = wallpaper_entry(&dir).unwrap();
        assert_eq!(item["title"], "Neon City");
        assert_eq!(item["kind"], "video");
        assert!(item["video"].as_str().unwrap().ends_with("loop.mp4"));
        assert!(item["preview"].as_str().unwrap().ends_with("preview.jpg"));
    }

    #[test]
    fn scene_wallpaper_keeps_preview_without_video() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("999");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("project.json"),
            r#"{"type":"scene","file":"scene.pkg","title":"Forest"}"#,
        )
        .unwrap();
        std::fs::write(dir.join("preview.png"), b"png").unwrap();
        let item = wallpaper_entry(&dir).unwrap();
        assert_eq!(item["kind"], "scene");
        assert!(item["video"].is_null());
    }
}
