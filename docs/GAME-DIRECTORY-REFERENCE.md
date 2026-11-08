# 自定义游戏目录

2026-11-09 阅读已获取的官方源码，独立实现本项目的目录功能，没有复制外部项目代码。

- PCL，提交 `93ede5d9e638c99fcec853a9ba1eecd91ceee7f5`：[PageSelectLeft.xaml.vb](https://github.com/Meloong-Git/PCL/blob/93ede5d9e638c99fcec853a9ba1eecd91ceee7f5/Plain%20Craft%20Launcher%202/Pages/PageSelectLeft.xaml.vb)。参考游戏文件夹列表、添加已有文件夹、当前选择和版本列表联动。
- HMCL，提交 `a11873f4a2c20c822152494f8d285549a8c4d943`：[GameDirectoryManager.java](https://github.com/HMCL-dev/HMCL/blob/a11873f4a2c20c822152494f8d285549a8c4d943/HMCL/src/main/java/org/jackhuang/hmcl/setting/GameDirectoryManager.java)、[GameSettings.java](https://github.com/HMCL-dev/HMCL/blob/a11873f4a2c20c822152494f8d285549a8c4d943/HMCL/src/main/java/org/jackhuang/hmcl/setting/GameSettings.java)、[LegacyGameSettingsMigrator.java](https://github.com/HMCL-dev/HMCL/blob/a11873f4a2c20c822152494f8d285549a8c4d943/HMCL/src/main/java/org/jackhuang/hmcl/setting/LegacyGameSettingsMigrator.java)。参考目录具有稳定标识、当前目录与当前版本分开管理，以及单版本运行目录的设置。

## 本项目行为

- 版本页提供游戏目录列表，可添加、切换、刷新、打开和移除。名称与绝对路径保存到原数据目录中的 `game-directories.json`；原默认游戏目录继续使用。
- 注册路径时检查绝对路径、重复位置和写入权限。选择上层文件夹时可识别其中的 `.minecraft`。未连接的磁盘显示不可用，用户仍可切换回默认目录；请求不会自动落到另一个目录。
- 读取标准 `versions/<名称>/<名称>.json`，合并继承配置并识别常见加载器。启动器自己的管理记录放在所选目录的 `instances` 中，不覆盖已有版本 JSON。已有 HMCL 运行路径配置可读取；没有明确配置时根据版本文件夹内的游戏数据选择初始运行目录，用户可在版本设置中调整。
- 单版本“版本隔离 → 自定义运行目录”接受手输和文件夹选择。游戏启动、模组、资源包、光影、存档、数据包及整合包导出使用同一个目录解析函数。修改路径不自动搬移旧文件。
- 移除游戏目录仅取消登记；移除外部版本仅隐藏管理记录，保留原目录文件。普通实例删除不会递归删除另设的运行目录。
- 账号、认证客户端设置、服务密钥和音乐等启动器数据继续使用原数据位置。下载与启动任务创建后持有所属目录；切换目录不更改已开始任务的位置。异步列表和模组扫描结果按目录隔离。

## 验证

桌面核心新增四组检查：配置保存与重复登记、任务目录快照、移除保留文件；独立资源/存档路径与账号位置；继承版本识别、设置保留与外部文件保留；无效路径拒绝。

`scripts/native-game-directories-check.mjs` 在完整桌面程序中通过界面添加目录、保存运行路径、切换目录、重新加载和移除目录，并调用真实后台检查自定义位置的模组、存档和原始 JSON。使用独立测试文件夹，结束后恢复此前的目录选择。结果见 `ui-report/revision/native-game-directories.json`。

此次没有进行真实 Minecraft 登录和进入世界的游戏测试。
