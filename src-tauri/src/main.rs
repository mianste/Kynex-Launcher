#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    #[cfg(feature = "desktop")]
    {
        // 正式版与预览版共用 productName，WebView2 默认数据目录会相同；
        // 两个通道同时运行时就会报“请求的资源在使用中”。按主程序名分开存放。
        if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_none() {
            if let (Ok(local), Ok(exe)) =
                (std::env::var("LOCALAPPDATA"), std::env::current_exe())
            {
                if let Some(name) = exe.file_stem().and_then(|value| value.to_str()) {
                    let dir = std::path::Path::new(&local)
                        .join("Kynex Launcher")
                        .join(format!("{name}-WebView2"));
                    let _ = std::fs::create_dir_all(&dir);
                    std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &dir);
                }
            }
        }
        kynex_core::run();
    }
}
