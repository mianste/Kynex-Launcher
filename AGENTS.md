# Kynex Launcher
Tauri 2 + React 18 + TypeScript + Vite + Tailwind + Zustand. 中文文案，lucide-react 图标。
配色集中于 src/tokens.css，原型只读位于 prototype/。
运行 pnpm typecheck、pnpm test、pnpm build；Rust 核心 cargo test --no-default-features --manifest-path src-tauri/Cargo.toml。
真实桌面操作走 bridge，网页模式只提供明确标识的预览，不能假报安装或登录成功。
不可复制 PCL 源代码；docs/REFERENCES.md 记录少量流程参考和署名。
