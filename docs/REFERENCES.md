# 参考来源与署名

## 项目语言

- [HMCL 构建说明](https://github.com/HMCL-dev/HMCL/blob/main/docs/Contributing.md)用于参考由 Java 承担启动器主体、构建工具负责生成可执行文件的组织方式。
- [PCL 公开仓库](https://github.com/Meloong-Git/PCL)用于参考将主要逻辑集中在同一语言的组织方式。KXL 的迁移继续使用自己的代码和数据格式。

## PCL

### 多游戏启动（2026-11-28）

- 按用户要求，参考 PCL 官方仓库的多开使用反馈：[多个游戏共用 DLL 导致占用](https://github.com/Meloong-Git/PCL/issues/2011)、[启动期间切换版本导致任务错乱](https://github.com/Meloong-Git/PCL/issues/1969)。署名龙腾猫跃及 PCL 贡献者；仅将公开问题场景与用户操作流程用于回归验证。
- KXL 使用 Java 与 React 独立实现：按游戏目录与实例记录准备状态，每次启动捕获自己的版本和账号参数；同一版本启动完成后可继续启动，已有进程保持运行；每次启动使用独立的原生库目录及输出日志，退出时清理对应临时文件。本次未复制 PCL 源码、控件或品牌资产。

- 原地址：https://github.com/Hex-Dragon/PCL2 （检索时跳转到 https://github.com/Meloong-Git/PCL）
- 检查提交：`93ede5d9e638c99fcec853a9ba1eecd91ceee7f5`
- 源文件：https://github.com/Meloong-Git/PCL/blob/main/Plain%20Craft%20Launcher%202/Modules/Minecraft/ModLaunch.vb
- 阅读范围：`ModLaunch.vb` 的启动阶段，以及 `ModDownload.vb`、`ModDownloadLib.vb`、`ResourceSearcher.vb` 的源优先级、错峰回退、并发文件任务、双站资源搜索与筛选组织。KXL 仅采用这些架构思路，以 Rust 独立实现，未复制 PCL 的代码、控件或品牌资产。
- 署名：龙腾猫跃及 PCL 贡献者。PCL 仓库包含自定义《PCL 分发有限许可》及合理使用指南，不能视作 MIT 项目。本工程独立实现，不是 PCL 分支，不使用其源代码或品牌资产；关于页已署名和提供仓库链接。
- 资源页参考 PCL 的搜索加载和项目图标呈现流程。KXL 并行查询所选来源，并在当前页的图标准备完成后一次显示本页结果。
- 许可原文：https://github.com/Meloong-Git/PCL/blob/main/LICENCE
- 下载完成提示参考 [PCL 帮助中的左下角提示条](https://github.com/Meloong-Git/PCL/wiki/%E8%87%AA%E5%AE%9A%E4%B9%89%E4%BA%8B%E4%BB%B6#%E5%BC%B9%E5%87%BA%E6%8F%90%E7%A4%BA)，KXL 使用自身主题、控件和任务结果。
- 头像流程参考：[PCL 旧版 UUID 默认皮肤规则](https://github.com/Meloong-Git/PCL/blob/93ede5d9e638c99fcec853a9ba1eecd91ceee7f5/Plain%20Craft%20Launcher%202/Modules/Minecraft/ModMinecraft.vb#L1395-L1417)及[皮肤头像预览行为](https://github.com/Meloong-Git/PCL/blob/8c8b1066bff6476a14437a14bc16a281e25145bd/Plain%20Craft%20Launcher%202/Pages/PageLaunch/MySkin.xaml.vb#L74-L128)。KXL 独立使用 Java UUID 哈希的奇偶位选择 Steve 或 Alex，并将游戏皮肤正脸与外层合成。仅用于启动器内显示，纹理来源见 `src/assets/skins/SOURCES.json`。

## 启动动画检索

- Tauri 官方 splashscreen 例子：https://github.com/tauri-apps/tauri/tree/dev/examples/splashscreen
- SVG 描边动画思路：https://github.com/moarwick/react-mt-svg-lines

仅参考窗口启动生命周期与 stroke-dashoffset 的通用方法；不引入这些项目的运行库，不复制其图形。棱晶 K 图形由用户提供；按用户要求以图像编辑生成透明背景版本，保留于 `src/assets/kxl-icon.png`。切面轮廓、裁切和时间编排在 `src/app/Splash.jsx` 与 `src/styles.css` 中独立编写。

## 真实接口与文档

- Tauri 2：https://v2.tauri.app/
- Mojang 官方版本清单：https://piston-meta.mojang.com/mc/game/version_manifest_v2.json
- Fabric 元数据：https://meta.fabricmc.net/
- Quilt 元数据：https://meta.quiltmc.org/
- Forge 官方 Maven：https://maven.minecraftforge.net/
- NeoForge 官方 Maven：https://maven.neoforged.net/releases/
- Forge 兼容版本列表使用 BMCLAPI 元数据：https://bmclapi2.bangbang93.com/
- Modrinth API：https://docs.modrinth.com/api/
- 像素茶艺地图站开放平台：https://goto.pixelmap.cc/maps/pixelmap_official_openplatform 。投影目录通过公开搜索和作品详情识别作者提供的投影文件，并保留原帖及作者信息。
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

## 投影文件管理

- 参考 [Litematica 使用说明](https://github.com/maruohon/litematica/wiki/Frequently-Asked-Questions#loading-a-schematic) 与 [Sakura-Ryoko 维护分支的配置定义](https://github.com/sakura-ryoko/litematica/blob/1.21.8/src/main/java/fi/dy/masa/litematica/config/Configs.java)，核对默认 `schematics` 目录、游戏内加载入口和自定义投影目录设置。启动器读取配置并管理本地文件。
- 投影预览按 [Litematica 方块容器](https://github.com/maruohon/litematica/tree/pre-rewrite/fabric/1.21.1-masa/src/main/java/fi/dy/masa/litematica/schematic/container) 和 [Sponge 投影规范](https://github.com/SpongePowered/Schematic-Specification) 核对数据布局，独立读取投影的方块坐标与状态。
- 方块外观按 [Fabric 方块模型文档](https://docs.fabricmc.net/develop/blocks/block-models) 解释 JSON 模型、状态和纹理。优先读取已安装的 Minecraft Java 客户端，缺少可读取的客户端时从 [Mojang 版本清单](https://piston-meta.mojang.com/mc/game/version_manifest_v2.json) 记录的地址缓存并校验 1.21.11 客户端。Minecraft 模型和纹理用于本机预览，安装包只包含读取和绘制逻辑。
- 缺失的方块属性查 [Misode mcmeta 的 Java 原版方块注册表](https://github.com/misode/mcmeta#summary)（各 `<版本>-summary` 标签下的 `blocks/data.min.json`），例如省略轴向的原木沿 Y 轴。使用 `scripts/package-minecraft-preview-defaults.py` 把已核验的注册表精简为版本间的默认值变化。投影明确保存的属性始终优先，玩家的投影文件保持原样。
- 箱子、床、潜影盒和告示牌的方块实体预览参考 [AZO234 的 mc_schem_viewer](https://github.com/AZO234/mc_schem_viewer/blob/main/src/textures.js) 了解实体贴图的布局与双箱的拼接方向，结合 [Fabric 方块实体渲染文档](https://docs.fabricmc.net/develop/blocks/block-entity-renderer) 核对普通方块模型和实体外观的区别。KXL 独立实现静态几何，纹理仍取自 Minecraft Java 客户端。
- 实体坐标参考 [LitematicWebViewer 的区域解析](https://github.com/Gudu-Z/LitematicWebViewer/blob/main/src/litematica.js) 与 [Sponge v3 规范](https://github.com/SpongePowered/Schematic-Specification/blob/master/versions/schematic-3.md)。模型首次使用时从 [InventivetalentDev 的 Java 实体模型导出](https://github.com/InventivetalentDev/minecraft-entity-models) 下载固定修订并校验 SHA-1，原版贴图来自本机 Minecraft 客户端。启动器独立构建 Three.js 网格，安装包不附送游戏模型或纹理，投影内容在本机解析。
- 投影下载内置 [Block Library 的三份 CC0 原创建筑](https://blocklibrary.net/guides/original-builds.html#source-and-reuse) 的重新封装文件。这三份文件按作者公开的 [小屋](https://blocklibrary.net/guides/plans/cabin.json)、[凉亭](https://blocklibrary.net/guides/plans/pavilion.json) 和 [石桥](https://blocklibrary.net/guides/plans/bridge.json) 方块坐标及状态生成，保留作品署名。将三份公开 JSON 放进同一目录后，可以运行 `python scripts/package-block-library-schematics.py <目录>` 重新生成。清单记录内置文件的 SHA-256，供预览和保存前校验。

## Java 下载与加载器

- 参考 HMCL 处理新版 Forge 安装器、旧版内置依赖和 OptiFine 补丁的流程。KXL 用自己的安装代码读取发行文件并调用其中声明的客户端处理器。 [HMCL 加载器实现](https://github.com/HMCL-dev/HMCL/tree/main/HMCLCore/src/main/java/org/jackhuang/hmcl/download)
- Forge 和 NeoForge 使用官方 Maven 目录和安装器校验文件，OptiFine 从发布页取得版本和 Forge 兼容信息。 [Forge Maven](https://maven.minecraftforge.net/)、[NeoForge Maven](https://maven.neoforged.net/releases/)、[OptiFine 下载](https://optifine.net/downloads)
- 资源搜索和文件版本按平台提供的分页及兼容性字段读取。用户填写的 CurseForge API 密钥只用于官方接口。 [Modrinth 接口](https://docs.modrinth.com/api/operations/searchprojects/)、[CurseForge 接口](https://docs.curseforge.com/rest-api/)

## 整合包拖拽

- 参考 PCL 对嵌套整合包的识别流程，以及 HMCL 拖入文件后打开安装向导的交互。KXL 使用 Java 读取归档目录及版本清单。 [PCL 2.8.10 更新日志](https://github.com/Meloong-Git/PCL/discussions/5071) · [HMCL 稳定版更新日志](https://docs.hmcl.net/changelog/stable.html)

## 资源目录加载

- PCL 保存已经获取的搜索结果和来源偏移量，已有足够结果时直接取对应页。HMCL 在列表首次打开时发起搜索，用请求编号丢弃过时的响应，并按 URL 缓存和合并图标请求。 [PCL 资源搜索](https://github.com/Meloong-Git/PCL/blob/main/Plain%20Craft%20Launcher%202/Modules/Resource/ResourceSearcher.vb) · [HMCL 资源列表](https://github.com/HMCL-dev/HMCL/blob/main/HMCL/src/main/java/org/jackhuang/hmcl/ui/instances/DownloadListPage.java) · [HMCL 图片加载](https://github.com/HMCL-dev/HMCL/blob/main/HMCL/src/main/java/org/jackhuang/hmcl/util/RemoteImageLoader.java)
- KXL 独立实现按筛选和页码缓存列表，图标与列表一起显示。慢来源后续返回时缓存该来源结果，当前列表保持稳定。

## 启动设置与参数（2026-11-28）

- 功能与替换标记参考 [PCL 官方帮助](https://github.com/Meloong-Git/PCL/wiki/替换标记)，署名龙腾猫跃及 PCL 贡献者。仅参考设置分类与用户可见行为，未复制 PCL 源码。
- KXL 独立实现全屏、自定义窗口标题及玩家/版本/路径标记；未声明兼容 PCL 全部设置或标记。旧版 Minecraft 的服务器参数和新版 Quick Play 分别处理。

- 按用户验收反馈移除初始内存与默认直连服务器；“自定义版本信息”保留原设置名称，改为游戏进程窗口标题，使用 Windows EnumWindows / GetWindowThreadProcessId 定位本次游戏窗口，再通过有超时的 WM_SETTEXT 更新 Unicode 标题，不改游戏 JAR。接口参考 [Microsoft Win32 文档](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendmessagetimeoutw)。

## 用户提供的液态玻璃资料（2026-11-28）

参考用户提供的八份 YeMotion 液态玻璃资料包：第20期控件、第9期拟态动效、形变菜单、拖拽、搜索框、歌词播放器、8件套和透明边缘折射。署名画心人（simot0etf）与资料包注明的原作者。仅参考边缘厚度、局部折射、高光、胶囊形态及动作连续性，KXL 独立实现 CSS 材质与低分辨率静态位移图，不引入资料包的整屏 WebGL 引擎、歌曲、示例背景或品牌资源。群友来源的源码未直接复制。
AI 异常退出结果弹窗参考 PCL 的“错误结果集中展示”流程：[官方更新说明](https://github.com/Meloong-Git/PCL/discussions/8634)，未复制分析代码或界面。

页面转场与加载反馈另参考用户提供的「第八期 8个页面动效资料包」（PageMotion Pack，画心人，MIT）：采用双向转场、骨架占位和即时校验反馈的思路，未增加滑动删除等用户未要求的数据操作。

导航指示器的短暂融合参考用户提供的「融球效果资料包实验台」（画心人 / simot0etf），独立采用小区域 SVG 模糊与 Alpha 阈值合成，不过滤文字，也不运行常驻的融球模拟。

用户另提供「液态玻璃第二期详细资料包 LiquidGlass-Pack-v2」（画心人，MIT），参考局部法线折射、细亮边与开关/滑块形变的视觉原则。项目未引入其中的 TSX 或 GLSL 文件，交付仍为 Java、JavaScript 和 Python。

玻璃材质集中在设置中的“玻璃主题”，沿用原壁纸、强调色和节日配色。采用静态边缘位移图、局部背景模糊与 CSS 高光；长列表条目不逐行增加背景滤镜。主题单独保存透明度，切回其他主题保留原设置。字体适配按实际壁纸缩放、节日遮罩和面板叠色计算，转场结束后再次校准；静态背景即时更新，视频背景保留稳定阈值。

交互动效在既有转场上叠加短时的控件反馈：标签回弹、菜单文字进入、勾选描画、滑杆按压、图标悬停与按钮扫光。以 CSS 和短时 WAAPI 实现，连点中断旧水波，闲置时无新增循环；减少动态效果时保留可操作状态。节日判断、节日壁纸和装饰继续使用既有流程。

主题与强调色更换采用浏览器 View Transition 的短时快照淡入淡出。壁纸单独使用可衔接的背景层：图片解码、视频首帧就绪后才淡入，等待时保留当前背景与视频播放；过渡后释放旧层。节日开关不经过整页历史快照，上传图片留在当前页，首页切出时卸载旧首页组件。参考 [MDN View Transition 接口文档](https://developer.mozilla.org/en-US/docs/Web/API/Document/startViewTransition)，不引入额外动效运行库。聚焦提示以控件内反馈代替额外描边，保留键盘输入与导航。
