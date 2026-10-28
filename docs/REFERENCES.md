# 参考来源与署名

## PCL

- 原地址：https://github.com/Hex-Dragon/PCL2 （检索时跳转到 https://github.com/Meloong-Git/PCL）
- 检查提交：`93ede5d9e638c99fcec853a9ba1eecd91ceee7f5`
- 源文件：https://github.com/Meloong-Git/PCL/blob/main/Plain%20Craft%20Launcher%202/Modules/Minecraft/ModLaunch.vb
- 阅读范围：`ModLaunch.vb` 的启动阶段，以及 `ModDownload.vb`、`ModDownloadLib.vb`、`ResourceSearcher.vb` 的源优先级、错峰回退、并发文件任务、双站资源搜索与筛选组织。KXL 仅采用这些架构思路，以 Rust 独立实现，未复制 PCL 的代码、控件或品牌资产。
- 署名：龙腾猫跃及 PCL 贡献者。PCL 仓库包含自定义《PCL 分发有限许可》及合理使用指南，不能视作 MIT 项目。本工程独立实现，不是 PCL 分支，不使用其源代码或品牌资产；关于页已署名和提供仓库链接。
- 许可原文：https://github.com/Meloong-Git/PCL/blob/main/LICENCE

## 启动动画检索

- Tauri 官方 splashscreen 例子：https://github.com/tauri-apps/tauri/tree/dev/examples/splashscreen
- SVG 描边动画思路：https://github.com/moarwick/react-mt-svg-lines

仅参考窗口启动生命周期与 stroke-dashoffset 的通用方法；不引入这些项目的运行库，不复制其图形。棱晶 K 图形由用户提供；按用户要求以图像编辑生成透明背景版本，保留于 `src/assets/kxl-icon.png`。切面轮廓、裁切和时间编排在 `src/app/Splash.tsx` 与 `src/styles.css` 中独立编写。

## 真实接口与文档

- Tauri 2：https://v2.tauri.app/
- Mojang 官方版本清单：https://piston-meta.mojang.com/mc/game/version_manifest_v2.json
- Fabric 元数据：https://meta.fabricmc.net/
- Quilt 元数据：https://meta.quiltmc.org/
- Forge 官方 Maven：https://maven.minecraftforge.net/
- NeoForge 官方 Maven：https://maven.neoforged.net/releases/
- Forge 兼容版本列表使用 BMCLAPI 元数据：https://bmclapi2.bangbang93.com/
- Modrinth API：https://docs.modrinth.com/api/
- Microsoft 设备授权：https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code
- authlib-injector：https://github.com/yushijinhun/authlib-injector

## HMCL

- 原地址：https://github.com/HMCL-dev/HMCL
- 阅读文件：`HMCLCore/src/main/java/org/jackhuang/hmcl/auth/OAuth.java` 与 `MicrosoftService.java`。
- 参考范围：设备代码轮询节奏、刷新令牌、Xbox/XSTS 身份一致性、Minecraft 所有权与档案检查。KXL 使用自己的 Microsoft 应用身份和 Rust 实现，不复制 HMCL 的 GPL 源码。

## SJMCL 与官方新闻

- SJMCL：https://github.com/UNIkeEN/SJMCL
- 仅参考其把资讯发现作为启动器一级入口的信息架构，以及用户随附提示中“悬浮导航、分层玻璃卡片、紧凑桌面布局”的视觉方向。SJMCL 使用 GPL-3.0，KXL 未复制其源代码、界面资源或实现。
- 新闻内容来自 Minecraft.net 官方 RSS：https://www.minecraft.net/en-us/feeds/community-content/rss
- Mojang Launcher 新闻 JSON 仅作为官方 RSS 不可用时的备用源：https://launchercontent.mojang.com/news.json

## MineRadio 与音乐平台

- MineRadio：https://github.com/KD-CHL/Mineradio
- 仅参考其“本地播放器与平台入口并存”的产品思路。MineRadio 使用 GPL-3.0，KXL 的 Tauri/React 播放器、队列和界面均为独立实现，未复制其源代码、视觉资产或品牌表达。
- 网易云音乐：https://music.163.com/
- 根据用户最终要求，在线音乐仅保留网易云：二维码、账号、歌单、搜索及播放地址直接请求网易云官方域名；登录会话仅保存在操作系统凭据库，不回传前端或写入整合包，不保存平台密码。不再展示其他平台入口。

## DangoMusic 音乐界面

- 项目：https://github.com/Sorihiko/DangoMusic
- 作者：Sorihiko；许可：GPL-3.0。
- 参考用户要求的侧栏、歌单、歌曲列表与底部播放栏层级，播放器由 Tauri/React 独立完成。本轮用户给出的 JAR 路径已不存在，未重新检查或反编译该文件，也未复制其 Java/Kotlin 源码、着色器、图标、字体或音乐服务实现。

## 加载器配套组件

- Fabric 官方安装说明：https://wiki.fabricmc.net/install
- Fabric API：https://modrinth.com/mod/fabric-api/versions
- Quilt Standard Libraries：https://modrinth.com/mod/qsl/versions
- 新建 Fabric/Quilt 实例时，KXL 分别通过 Modrinth 安装匹配版本的 Fabric API/QSL 及其依赖；旧实例在打开 Mod 页时检查本地 JAR 元数据并按需补齐。Forge/NeoForge 不添加不存在的通用必备 Mod。

下载的游戏文件、模组、运行库、官方安装器与 authlib-injector 各自遵循其权利人的许可，本源代码包不附送 Minecraft 游戏内容。

## 作者链接

产品：Kynex Launcher；缩写：KXL。作者：珂珂。
爱发电：https://afdian.com/a/keke_657

## 本次修订

- 皮肤查看器采用 MIT 许可的 skinview3d / skinview-utils：https://github.com/bs-community/skinview3d 。使用其 Three.js 模型、外层纹理、Slim、相机与动作实现；界面参考 NameMC 的简洁皮肤查看方式，不复制其站点脚本或皮肤作品。
- 正版登录额外少量参考 PCL `MyMsgLogin.xaml.vb` 的约 80–130 行，确认其「自动开网页、复制设备代码、后台轮询」交互。KXL 协议代码独立实现，仍需要自己的 Microsoft 应用身份。
- 国内镜像路由根据 BMCLAPI 文档：https://bmclapidoc.bangbang93.com/ 。游戏清单、客户端、资源与依赖优先镜像，失败退回官方；微软与 Xbox 认证不经过镜像。

- 官方皮肤流程参考：https://www.minecraft.net/en-us/article/what-is-minecraft-skin 。本次改为命名、模型选择、PNG 浏览、保存/保存并应用；不复制官方启动器资产。

- 动效补充参考：PCL FormMain.xaml.vb 的窗口淡入、位移缓出与轻回弹编排；KXL 以 Motion.tsx / motion.css 独立实现，不复制其源代码。

## 开源衣橱重做

实际参考 XMCL 与 Amethyst 的 MIT 皮肤查看器及衣橱源码；固定提交、文件链接和改造映射见 [SKIN-REFERENCE.md](SKIN-REFERENCE.md)。未移植 HMCL/TRS 的 GPL 源码。原先 NameMC 风格纵向页面已替换。

## 白色亚克力与兼容格式修订

- UI 设计指导：https://github.com/anthropics/skills/tree/main/skills/frontend-design 。安装并按其设计计划、实现和截图复查流程重新排版；保留原默认背景。
- Windows 窗口区域：https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowrgn 。外框抗锯齿修订清除 GDI 二值区域硬裁剪，保留透明窗口合成器的半透明边缘像素，避免原生裁剪与 CSS 圆角相交造成台阶。
- Modrinth 整合包标准：https://support.modrinth.com/en/articles/8802351-modrinth-modpack-format-mrpack 。按清单与 overrides 规范读写 MRPACK。
- Prism/MultiMC 组件结构：https://github.com/PrismLauncher/PrismLauncher/blob/develop/launcher/minecraft/PackProfile.cpp 。只参考 components/uid/version 数据格式，未复制实现代码。
- 加载器官方图标的逐项来源在 `src/assets/loaders/SOURCES.json` 中列明，用于识别对应项目。
- 音乐网页适配器已被原生网易云适配器替换，不再加载或抓取整张音乐网页。
# 2026-10-27 设置、音乐与动效修订

- 使用用户提供的 Kynex Launcher Source.zip 为本次基线，保留其中的登录与主题修改。
- 音乐原生数据请求固定为网易云域名，不再创建子 WebView 或 iframe；付费、地区和登录限制由平台返回结果决定，不绕过限制。
- PCL2 按钮和滚动的行为参考见 docs/MOTION.md，动画代码独立实现。
- 版本配置下载使用官方 SHA-1 校验、缓存复用和有时限的源竞速，取消可中断网络等待。
- 微软登录只参考 PCL 的设备码授权交互：复制设备码、系统浏览器授权、后台轮询；保持 KXL 自有 Client ID `[REDACTED]`，不使用 PCL 的应用身份。参考本地 PCL ModLaunch.vb 的设备授权流程，未复制实现。

## OptiFine 直接安装与 Forge 组合

- [OptiFine 官方下载表](https://optifine.net/downloads)：游戏版本、OptiFine 发行版以及推荐 Forge 版本的关系；不把所有 Forge 版本视为兼容。
- [BMCLAPI 文档](https://bmclapidoc.bangbang93.com/)：读取 OptiFine 版本元数据，使用公开的版本下载接口在启动器内取得安装器。
- [HMCL OptiFineInstallTask](https://github.com/HMCL-dev/HMCL/blob/main/HMCLCore/src/main/java/org/jackhuang/hmcl/download/optifine/OptiFineInstallTask.java)：仅阅读其安装器格式和执行顺序，独立实现 Rust 适配；未复制 GPL 源码。原版安装运行安装器提供的补丁工具并使用其内含启动包装库；Forge 组合保留 Forge 启动入口，将官方通用安装 JAR 放入该实例使用的 mods 目录。
- 安装时重新验证游戏版本与已声明的 Forge 兼容版本；暂无发行版时显示空结果，不打开下载网页。Fabric、Quilt、NeoForge 不与 OptiFine 任意组合。

## 网易云扫码恢复

- [API Enhanced 的扫码检查适配](https://github.com/neteasecloudmusicapienhanced/api-enhanced/blob/main/module/login_qr_check.js) 与 [二维码密钥适配](https://github.com/neteasecloudmusicapienhanced/api-enhanced/blob/main/module/login_qr_key.js)：核对当前 type=3 参数及官方接口路径。仅参考请求协议，KXL 独立实现 Rust 会话隔离与 React 状态恢复，不使用公开代理服务器。
- 平台暂时异常或网络中断不会直接清除二维码；仅真正过期或用户刷新时结束当前二维码。登录已授权但歌单未返回时继续同步，避免误报扫码失败。

## 8821 官方验证修订

- 用户配合的真实扫码测试返回 8821，随后网页二维码请求返回 -462（网络环境风险）；不能以等待扫码 801 测试代替完整登录成功。
- [上游 8821 问题记录](https://github.com/chaunsin/netease-cloud-music/issues/26)：8821 与行为验证有关。KXL 不生成反作弊令牌、不伪造浏览器指纹或绕过验证。
- WEAPI 请求封装按 AES-CBC、RSA 公钥协议独立实现；[官方账号接口路径参考](https://github.com/neteasecloudmusicapienhanced/api-enhanced/blob/main/module/login_status.js)为 /api/w/nuser/account/get。
- 登录接口拒绝或要求验证时，在主窗口内加载网易云官方登录模块，由官方页面执行其验证流程。仅登录区域使用子 WebView；歌单、搜索和播放继续使用 KXL 原生界面，不恢复整页音乐网站。
- 官方登录页面没有启动器命令权限；所有 dispatch 仅接受 main WebView。导航限定网易域名，拒绝额外弹窗，主导航切换时关闭验证区域。

最终交互按用户要求保留原生二维码卡片：后台官方模块处理自己的登录 SDK 与授权，前端只显示其二维码图片及登录状态。只有平台确实要求人工验证时提供当前窗口内的验证步骤，不伪造或自动完成验证。正常歌单、歌曲和播放不展示整页网站。

Windows 凭据只保存必要的登录字段，使用系统凭据库的字节存储；后台网页的完整 Cookie 不回传前端、不写入源码包。图片显示统一采用 HTTPS 和 no-referrer。


## 标准音源与播放模式

- [上游标准音源参数](https://github.com/neteasecloudmusicapienhanced/api-enhanced/blob/master/module/song_url_v1.js)：核对 /api/song/enhance/player/url/v1 的 ids、level、encodeType 字段；KXL 独立请求 standard / mp3，不使用解锁音源服务。
- 真实 CDN 返回 403 时保留授权限制并显示中文提示，不将 HTML 当作音频，也不声称已修复平台拒绝。播放模式队列算法独立实现。

## 收藏音源与格式修复（2026-10-28）

通过真实对照定位到播放请求缺少 os=pc 平台字段，补齐后原 403 地址恢复有效音源。只在请求中声明桌面平台，不改变已保存账号会话。MP3 采用官方码率参数，FLAC 采用 lossless；按音频文件头确认实际格式。上游 [请求字段处理](https://github.com/neteasecloudmusicapienhanced/api-enhanced/blob/master/util/request.js) 与 [音源接口](https://github.com/neteasecloudmusicapienhanced/api-enhanced/blob/master/module/song_url.js) 仅用于核对协议；KXL 独立实现，不接入第三方解锁或公共代理。
