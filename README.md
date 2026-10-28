# Kynex Launcher · 开发者预览版 beta 1

这是 Kynex Launcher 开发者预览版 beta 1 的公开源码部分。基于现有预览版整理，仅剥离不公开的模块，没有加入功能优化或修改登录、启动行为。

## 公开范围

包含 Java 版实例安装与启动、加载器、Modrinth／CurseForge 资源、整合包导入导出、账号与皮肤、资源与存档文件管理、新闻、诊断和设置。

不公开且不包含以下模块的前后端实现、专用样式、测试和打包产物：

- 音乐模块。
- 一键进服、一键进入存档。
- 本地 Minecraft 基岩版、地下城 1／2、传奇的检测与启动。

存档文件管理与普通 Java 版启动保留。完整预览版安装器与公开源码的功能范围不同；此仓库不包含保留模块的二进制文件。

## 构建

使用 Node.js 22+、pnpm 11.25.0、Rust 稳定版及 Tauri 2 的 Windows 构建环境。

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
cargo test --locked --no-default-features --manifest-path src-tauri/Cargo.toml
pnpm tauri build
```

构建目标为开发者预览版 beta 1；安装器输出在 `src-tauri/target/release/bundle/nsis/`。自行构建默认不生成更新签名。更新源沿用原项目的空配置；私钥、账号凭据和 API 密钥不随源码分发。

微软授权沿用预览版原有实现，实际登录依赖官方应用服务权限与账号所有权。CurseForge API 密钥由使用者自行配置。

## 许可

公开源码采用 [MIT](LICENSE)，第三方依赖与素材保留各自权利，见 [第三方声明](docs/THIRD-PARTY-NOTICES.txt)。未公开模块不属于本仓库的许可范围。项目与 Mojang、Microsoft、PCL 无关联，请通过官方渠道购买 Minecraft。

[爱发电](https://afdian.com/a/keke_657) · [GitHub](https://github.com/mianste/Kynex-Launcher)
