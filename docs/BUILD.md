# 编译公开源码

需要 Node.js 22+、pnpm 11.25.0、Rust stable、WebView2 Runtime，以及 Tauri 的 Windows C++ 构建环境。

先运行 `pnpm install --frozen-lockfile`，再运行 `pnpm typecheck`、`pnpm test`、`pnpm build` 和 `cargo test --locked --no-default-features --manifest-path src-tauri/Cargo.toml`。

`pnpm dev` 仅打开网页预览，不能操作本机游戏；`pnpm tauri dev` 运行桌面开发版；`pnpm tauri build` 生成公开构建的安装器。公开构建使用独立名称和数据目录。

微软登录通过 `KXL_MICROSOFT_CLIENT_ID` 或账号页登录配置提供自己的 Client ID；CurseForge 官方接口通过 `KXL_CURSEFORGE_API_KEY` 或本地配置提供 Key。AI 对话和补译使用「AI 设置」中配置的模型，需要语音转写时也可在该页面配置语音接口。

公开构建默认不启用自动更新。若需要更新，请自行生成和保存签名私钥，填写公钥与更新地址；私钥不要提交到仓库。

Windows GNU 构建时，项目、构建缓存及临时目录应使用纯英文路径，避免 windres 无法读取图标。GitHub Actions 使用 Windows MSVC 环境执行检查和桌面编译。
