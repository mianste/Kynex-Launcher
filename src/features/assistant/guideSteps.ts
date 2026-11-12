import type { Page } from "../../lib/types";
export type GuideStep = {
  page: Page;
  target?: string;
  selector?: string;
  section?: string;
  title: string;
  text: string;
  requiresInstance?: boolean;
  assistant?: boolean;
};
export const GUIDE_STEPS: GuideStep[] = [
  {
    page: "home",
    target: "launch",
    title: "启动 · 进入游戏",
    text: "选好实例与账号后，从这里进入游戏。没有安装游戏时，先到下载页安装一个版本。引导会逐页带你查看全部主要功能，也可用下方菜单直接跳到想了解的页面。",
  },
  {
    page: "library",
    selector: ".game-directory-bar",
    title: "版本 · 游戏目录",
    text: "这里管理不同游戏目录。添加已有的 .minecraft 文件夹后，可以集中查看里面的版本；切换目录会切换当前显示的实例。",
  },
  {
    page: "library",
    selector: ".page-content .page-head",
    title: "版本 · 实例与存档",
    text: "搜索已安装的版本，进入实例详情管理资源；新建用于安装游戏。下方分类可查看实例与存档。",
  },
  ...[
    ["实例", "集中查看已安装实例，进入详情可以管理它的资源与设置。"],
    ["存档", "查看可识别的游戏世界；实例详情中的存档页提供更具体的世界管理。"],
  ].map(([section, text]) => ({
    page: "library" as const,
    section,
    target: "library-categories",
    title: `版本分类 · ${section}`,
    text,
  })),
  ...[
    [
      "概览",
      "查看游戏版本、加载器与运行目录；可以从详情页启动、打开目录、导出整合包和修改实例设置。",
    ],
    [
      "Mod",
      "查看模组、启用或禁用、导入新模组和检查更新。安装前核对游戏版本、加载器及前置依赖，建议分批添加后启动验证。",
    ],
    ["资源包", "管理材质与资源包，按需要启用、调整顺序或导入文件。"],
    [
      "存档",
      "查看本实例的世界，打开存档文件夹；操作前请备份重要存档。",
    ],
    [
      "光影",
      "管理本实例的光影文件；进入游戏后还需要对应的光影加载器和图形设置。",
    ],
    [
      "数据包",
      "选择具体存档后管理它的数据包；数据包作用于世界，不等同于模组。",
    ],
    ["服务器", "保存或选择服务器地址，使用正确的游戏版本与账号连接。"],
    ["设置", "这里修改的内存、Java、窗口和隔离目录只对当前实例生效。"],
  ].map(([section, text]) => ({
    page: "instance" as const,
    section,
    selector: `[role="tab"][data-guide-tab="${section}"]`,
    title: `实例详情 · ${section}`,
    text,
    requiresInstance: true,
  })),
  ...[
    [
      "游戏本体",
      "选择 Minecraft 游戏版本及 Forge、Fabric 等加载器，再确认实例名称进行安装。",
    ],
    [
      "整合包",
      "搜索并安装现成整合包，也可以用上方导入按钮导入 .mrpack 或整合包 ZIP 文件。",
    ],
    [
      "模组",
      "搜索模组，选择目标实例和匹配的游戏版本、加载器，查看前置后选择版本安装。",
    ],
    ["资源包", "查找材质与资源包，选择兼容版本下载后在游戏中启用。"],
    ["光影", "查找光影包，留意电脑配置及所需的 Iris、OptiFine 等加载器。"],
    ["数据包", "查找数据包并选择目标存档；安装后按游戏提示加载或启用。"],
  ].map(([section, text]) => ({
    page: "discover" as const,
    section,
    target: "download-categories",
    title: `下载 · ${section}`,
    text,
  })),
  {
    page: "workshop",
    selector: ".agent-panel .agent-controls",
    section: "overview",
    title: "工坊 · 新建和维护",
    text: "在顶部打开「工坊」。可以从玩法模板开始、导入分享码，或描述想做的整合包。要处理已安装的游戏，先在版本页选中实例，再点击「维护当前实例」。",
  },
  {
    page: "workshop",
    selector: ".agent-panel .agent-history",
    title: "工坊 · 任务记录",
    text: "点选任务后，右侧会显示概览和进度。任务结束后，可用旁边的垃圾桶删除记录；游戏和存档会保留。",
  },
  {
    page: "workshop",
    selector: ".agent-panel .agent-detail",
    section: "localization",
    title: "工坊 · 汉化与工具",
    text: "确认任务后打开「汉化」。先尝试安装匹配的社区汉化，再扫描并选中仍缺翻译的模组。确认用量后开始 AI 补译，页面会显示批次进度。重进游戏后查看译文。其他标签可排错、更新和导出。",
  },
  {
    page: "news",
    selector: ".news-toolbar",
    title: "MC 新闻 · 分类与刷新",
    text: "在这里搜索和刷新 Minecraft 新闻，下方可以切换新闻分类，点击文章查看来源。网络加载中或没有结果时，也可以稍后再试。",
  },
  {
    page: "account",
    target: "account-add",
    title: "账号 · 添加与切换",
    text: "添加微软、离线或外置认证账号，并设为默认角色。正版服务器需要有效的正版账号；已添加的账号也能进入皮肤页更换外观。",
  },
  {
    page: "skin",
    target: "skin-import",
    title: "皮肤 · 导入与预览",
    text: "导入皮肤 PNG，预览人物外观并应用到选定账号。正版或外置认证账号的同步能力以该账号服务支持为准。",
  },
  {
    page: "skin",
    selector: ".wardrobe-library > header",
    title: "皮肤 · 我的皮肤库",
    text: "这里保存和选择已导入的皮肤。可以搜索、预览、重命名或删除本地皮肤；预览后点击应用才会更换外观。",
  },
  ...[
    [
      "启动",
      "调整全局内存、默认 Java、窗口大小、版本隔离与游戏语言。实例自己的设置可单独覆盖。",
    ],
    [
      "Java 管理",
      "查看可用 Java、扫描或下载安装运行时。不同 Minecraft 与加载器版本可能需要不同 Java。",
    ],
    [
      "下载",
      "选择下载来源、调整并发数量及检查连接情况，下载任务可从底栏查看。",
    ],
    ["界面", "切换深浅主题、强调色、壁纸与透明度。AI 助手也会跟随这些设置。"],
    [
      "更新",
      "检查完整版本更新，也可检查同版本的签名小修复补丁；应用界面补丁会刷新界面，并支持回退。",
    ],
    [
      "高级",
      "添加与切换 AI 模型，自行填写 Key 并测试连接；下方可配置自动分析闪退、打开数据目录或恢复全局设置。",
    ],
    ["关于", "查看启动器版本、官方网站与项目相关链接。"],
  ].map(([section, text]) => ({
    page: "settings" as const,
    section,
    target: `settings-${section}`,
    title: `设置 · ${section}`,
    text,
  })),
  {
    page: "help",
    selector: ".page-content .page-head",
    title: "帮助 · 常见问题与重看引导",
    text: "这里提供安装、加载器、整合包、日志和皮肤等常见问题说明。任何时候都能从这里重新查看完整的全页面引导。",
  },
  {
    page: "home",
    assistant: true,
    section: "chat",
    target: "assistant-chat",
    title: "AI 助手 · 对话",
    text: "描述你的问题，结合所选实例进行问答。回复支持正常排版与复制；AI 设置可直接进入模型配置。",
  },
  {
    page: "home",
    assistant: true,
    section: "logs",
    target: "assistant-logs",
    title: "AI 助手 · 日志分析",
    text: "点击添加日志，默认打开当前游戏目录。选择日志文件后直接分析，结果与辅助修复方案显示在对话中；自动闪退报告也会保留。",
  },
  {
    page: "home",
    assistant: true,
    section: "mods",
    target: "assistant-mods",
    title: "AI 助手 · 整合包顾问",
    text: "对话可以推荐兼容模组。要搭建、汉化或维护整合包，点这里进入独立的「工坊」。使用 AI 前，先在设置里配置模型和密钥。",
  },
];
