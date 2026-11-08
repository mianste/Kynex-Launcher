# 资源列表与签名安装器修复

参考源码在 2026-11-08 获取，仅用于阅读实现思路；未把外部项目代码或二进制打进启动器。

- PCL，提交 `93ede5d9e638c99fcec853a9ba1eecd91ceee7f5`：[ResourceSearcher.vb](https://github.com/Meloong-Git/PCL/blob/93ede5d9e638c99fcec853a9ba1eecd91ceee7f5/Plain%20Craft%20Launcher%202/Modules/Resource/ResourceSearcher.vb)。参考分类筛选、多个来源并发获取、保留已获取结果与翻页状态的做法。
- HMCL，提交 `a11873f4a2c20c822152494f8d285549a8c4d943`：[ModrinthRemoteAddonRepository.java](https://github.com/HMCL-dev/HMCL/blob/a11873f4a2c20c822152494f8d285549a8c4d943/HMCLCore/src/main/java/org/jackhuang/hmcl/addon/repository/ModrinthRemoteAddonRepository.java)，[ForgeNewInstallTask.java](https://github.com/HMCL-dev/HMCL/blob/a11873f4a2c20c822152494f8d285549a8c4d943/HMCLCore/src/main/java/org/jackhuang/hmcl/download/forge/ForgeNewInstallTask.java)。参考独立执行处理器、下载映射时复用校验缓存、隔离原版客户端副本，以及检查生成文件的做法。
- 实际反馈：[Kynex Launcher 问题 #1](https://github.com/mianste/Kynex-Launcher/issues/1)。用户随后提供了《超限征伐1.3.zip》和《潮汐界锚 1.11 地牢远征.mrpack》两个原包，均已在隔离目录完成真实导入。

## 本项目实现

资源页按来源复用内存缓存，合并相同的在途请求；服务端同一缓存项加锁合并并发读取，手动刷新跳过旧缓存。英文查询和内置中文别名不再等待完整名称索引。每个来源返回后立即展示，并独立预取下一页；慢来源只追加新条目，保持已展示项目及安装目标不变。全部来源模式展示双方本页的去重结果，页数取两个来源页数的最大值。

带签名的现代 Forge/NeoForge 安装器按原清单执行客户端处理器，不改写安装器、不移除签名。依赖从原安装器的 maven 目录按声明提取并检查 SHA-1；下载映射使用原有下载与校验缓存。其余步骤由原处理器的 Main-Class 和独立参数执行。外部处理器只拿到临时原版客户端副本，全部步骤与声明的输出校验通过后才发布版本配置。无签名及旧版安装器保留既有路径。

## 验证

- 缓存复用、请求合并、失败重试、不同过滤条件隔离、到期、强制刷新及稳定追加的单元检查。
- 慢来源挂起时快来源可展示；晚到结果不改变前排顺序；缓存查询不新增请求；下一页使用预取结果。
- 独立构造完整签名 JAR，先用 Java 正常运行确认签名有效，再验证映射缓存、真实 Java 处理器执行、安装器原件不变、原版客户端缓存不变、生成文件校验失败时不发布版本配置。
- 两个用户原包均完成 Minecraft 1.20.1、Forge 和清单资源安装。《超限征伐》使用 Forge 47.4.23；《潮汐界锚》使用带签名的 Forge 47.4.10，全部六步客户端处理器执行成功。导入测试复用已校验的公共依赖；未改动用户已有游戏，未验证进入世界游玩。

## 整合包外部文件地址

导入 MRPACK 时不再把 mediafilez.forgecdn.net 等 CurseForge CDN 地址拒之门外，复用现有 CDN 域名识别与 edge 下载入口。清单的多个受支持地址按顺序尝试，失败可换下一个；每个文件必须具备有效 SHA-1，继续拒绝 HTTP、伪装域名和带账号信息的地址。

## Windows 下载连接

在用户提供的原包中进一步复现了 Modrinth CDN 的证书链兼容故障。同一文件通过 Windows 系统验证能够正确下载并匹配 SHA-1。Windows 请求改用 Schannel 系统证书链构建，最低 TLS 1.2，证书和主机名验证保持启用；其他平台保留 Rustls。

## 下载优先级与失败重试

原包实测发现，中转地址可能长时间卡在 TACZ 大文件。Modrinth 文件优先使用官方 CDN，中转地址保留为失败备用，不更改项目来源或查询条件。该 57,465,167 字节文件经真实 Rust 下载器约 1.9 秒完成并通过 SHA-1 校验，速度仅代表本次网络环境。整合包文件按 SHA-1 缓存，重试或装到其他实例时校验后复用；再用不可用地址测试相同文件，确认可从缓存安装。

验证结果：`ui-report/revision/reported-packs.json`、`large-mod-cache.json`、`signed-installer.json`、`mrpack-cdn.json`。桌面核心 147 项通过，13 项外部网络或交互测试默认跳过；其中本次涉及的两个原包导入、签名样本、旧 CDN 和大文件缓存测试已分别显式运行通过。
