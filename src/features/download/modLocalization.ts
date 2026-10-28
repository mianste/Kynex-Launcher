import type { Project } from "../../lib/types";

interface ModTranslation {
  match: string[];
  name: string;
  description: string;
  tags: string[];
  search: string;
}

const translations: ModTranslation[] = [
  {
    match: ["sodium", "钠"],
    name: "钠",
    description: "高性能渲染优化模组，显著改善游戏帧率与流畅度。",
    tags: ["性能优化", "客户端"],
    search: "Sodium",
  },
  {
    match: ["iris-shaders", "iris", "iris shaders", "鸢尾", "光影加载器"],
    name: "Iris 光影",
    description: "兼容 Fabric 的光影加载器，可搭配 Sodium 使用。",
    tags: ["光影", "渲染"],
    search: "Iris Shaders",
  },
  {
    match: ["lithium", "锂"],
    name: "锂",
    description: "优化游戏逻辑、方块与实体运算，减少服务器和客户端负载。",
    tags: ["性能优化", "通用"],
    search: "Lithium",
  },
  {
    match: ["indium", "铟"],
    name: "铟",
    description: "为 Sodium 补充 Fabric 渲染 API 兼容支持。",
    tags: ["渲染", "兼容"],
    search: "Indium",
  },
  {
    match: ["entityculling", "entity culling", "实体渲染机制优化", "实体剔除"],
    name: "实体渲染机制优化",
    description: "跳过不可见实体和方块实体的渲染，降低画面负载。",
    tags: ["性能优化", "客户端"],
    search: "Entity Culling",
  },
  {
    match: ["cloth-config", "cloth config", "cloth config api", "布料配置"],
    name: "布料配置 API",
    description: "为模组提供统一配置界面的常用前置库。",
    tags: ["前置", "配置"],
    search: "Cloth Config API",
  },
  {
    match: ["fabric-api", "fabric api", "fabric前置"],
    name: "Fabric API",
    description: "Fabric 模组常用的核心接口与运行前置。",
    tags: ["前置", "Fabric"],
    search: "Fabric API",
  },
  {
    match: ["modernfix", "modern fix", "现代化修复"],
    name: "现代化修复",
    description: "改善启动速度、内存占用并修复多项现代版本性能问题。",
    tags: ["性能优化", "通用"],
    search: "ModernFix",
  },
  {
    match: ["ferrite-core", "ferritecore", "铁氧体磁芯"],
    name: "铁氧体磁芯",
    description: "减少方块状态等数据占用的内存。",
    tags: ["内存优化", "通用"],
    search: "FerriteCore",
  },
  {
    match: ["immediatelyfast", "immediately fast", "立即加速"],
    name: "立即加速",
    description: "优化界面、粒子和实体等即时渲染路径。",
    tags: ["性能优化", "客户端"],
    search: "ImmediatelyFast",
  },
  {
    match: ["jei", "just enough items", "物品管理器", "物品查询"],
    name: "JEI 物品管理器",
    description: "查看物品、配方与用途的经典辅助模组。",
    tags: ["配方", "辅助"],
    search: "Just Enough Items JEI",
  },
  {
    match: ["jade", "玉", "信息显示"],
    name: "玉",
    description: "在准星指向方块或实体时显示实用信息。",
    tags: ["信息显示", "辅助"],
    search: "Jade",
  },
  {
    match: ["appleskin", "apple skin", "苹果皮"],
    name: "苹果皮",
    description: "显示食物饱食度与隐藏的饱和度信息。",
    tags: ["界面", "辅助"],
    search: "AppleSkin",
  },
  {
    match: ["journeymap", "journey map", "旅行地图"],
    name: "旅行地图",
    description: "提供实时小地图、全屏地图和路径点功能。",
    tags: ["地图", "探索"],
    search: "JourneyMap",
  },
  {
    match: [
      "xaeros-minimap",
      "xaero's minimap",
      "xaero minimap",
      "xaero小地图",
    ],
    name: "Xaero 的小地图",
    description: "轻量的实时小地图与路径点工具。",
    tags: ["地图", "客户端"],
    search: "Xaero's Minimap",
  },
  {
    match: ["the-twilight-forest", "twilight forest", "暮色森林"],
    name: "暮色森林",
    description: "加入大型冒险维度、遗迹、首领与完整探索流程。",
    tags: ["冒险", "维度"],
    search: "Twilight Forest",
  },
  {
    match: ["create", "机械动力"],
    name: "机械动力",
    description: "围绕旋转动力、自动化生产与机械装置构建的科技模组。",
    tags: ["科技", "自动化"],
    search: "Create",
  },
  {
    match: ["botania", "植物魔法"],
    name: "植物魔法",
    description: "以花朵、魔力与自然装置为核心的魔法科技模组。",
    tags: ["魔法", "自动化"],
    search: "Botania",
  },
  {
    match: [
      "applied-energistics-2",
      "applied energistics 2",
      "ae2",
      "应用能源",
    ],
    name: "应用能源 2",
    description: "提供数字化存储、网络管理与自动合成系统。",
    tags: ["科技", "存储"],
    search: "Applied Energistics 2",
  },
  {
    match: ["farmers-delight", "farmer's delight", "农夫乐事"],
    name: "农夫乐事",
    description: "扩展烹饪、农作物与食物制作体验。",
    tags: ["农业", "食物"],
    search: "Farmer's Delight",
  },
];

const keywordTranslations: Array<[string, string]> = [
  ["性能优化", "performance optimization"],
  ["内存优化", "memory optimization"],
  ["光影", "shader"],
  ["小地图", "minimap"],
  ["地图", "map"],
  ["前置", "library api"],
  ["配方", "recipe"],
  ["背包", "backpack"],
  ["存储", "storage"],
  ["科技", "technology"],
  ["魔法", "magic"],
  ["冒险", "adventure"],
  ["建筑", "building"],
  ["装饰", "decoration"],
  ["生物", "mobs creatures"],
  ["世界生成", "world generation"],
  ["农业", "farming"],
  ["食物", "food"],
  ["传送", "teleport waystones"],
  ["信息显示", "information overlay"],
  ["优化", "optimization"],
];

const normalize = (value: string) =>
  value
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s_'’\-.]+/g, "");

export function expandResourceQuery(query: string) {
  const value = query.trim();
  if (!value) return "";
  const normalized = normalize(value);
  const exact = translations.find((entry) =>
    entry.match.some((candidate) => normalize(candidate) === normalized),
  );
  if (exact) return exact.search;
  let expanded = value;
  for (const [chinese, english] of keywordTranslations) {
    expanded = expanded.replaceAll(chinese, ` ${english} `);
  }
  return expanded.replace(/\s+/g, " ").trim();
}

export function localizeProject(project: Project) {
  const keys = [project.slug, project.title].map(normalize);
  const entry = translations.find((candidate) =>
    candidate.match.some((alias) => keys.includes(normalize(alias))),
  );
  if (!entry) {
    return {
      name: project.title,
      originalName: "",
      description: project.description,
      originalDescription: "",
      tags: [] as string[],
    };
  }
  return {
    name: entry.name,
    originalName: entry.name === project.title ? "" : project.title,
    description: entry.description,
    originalDescription: project.description,
    tags: entry.tags,
  };
}
