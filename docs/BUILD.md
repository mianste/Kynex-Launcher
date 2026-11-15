# 怎么编译公开版

先准备 Node.js 22 或更新版本、pnpm 11.25.0、Rust、WebView2 Runtime 和 Windows 的 C++ 构建工具。

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
cargo test --locked --no-default-features --manifest-path src-tauri/Cargo.toml
pnpm tauri build
```

日常改界面可以用 `pnpm dev` 看网页。需要读取游戏文件或测试下载时，使用 `pnpm tauri dev` 打开桌面版。自己编译的程序叫「Kynex Launcher Public」，会单独保存数据。

要用微软登录，可以在账号页填自己的应用编号，也可以设置环境变量 `KXL_MICROSOFT_CLIENT_ID`。要用 CurseForge 官方接口，可以在设置里填自己的密钥，也可以设置 `KXL_CURSEFORGE_API_KEY`。

公开版默认关闭自动更新。要给自己编译的版本提供更新，需要设置自己的更新地址和签名公钥。签名私钥请留在本机。

如果用 Windows GNU 工具编译，请把项目、构建缓存和临时文件夹放在纯英文路径下。GitHub 上使用 Windows MSVC 工具检查。
