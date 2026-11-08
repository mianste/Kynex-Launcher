/**
 * 资源分类表，与 PCL 的分类口径保持一致：
 * 标签写成「CurseForge 分类 ID/Modrinth 分类 slug」，
 * 某一边为空表示该来源没有这个分类（例如 `/game-mechanics` 只存在于 Modrinth）。
 *
 * CurseForge 分类 ID 与 Modrinth slug 均来自两个平台公开的分类定义。
 */
type TagOption = {
  value: string;
  label: string;
  group?: string;
  indent?: boolean;
};

const MOD: TagOption[] = [
  { value: "", label: "全部分类" },
  { value: "406/worldgen", label: "世界元素" },
  { value: "407/", label: "生物群系", indent: true },
  { value: "410/", label: "维度", indent: true },
  { value: "408/", label: "矿物与资源", indent: true },
  { value: "409/", label: "天然结构", indent: true },
  { value: "412/technology", label: "科技" },
  { value: "415/", label: "管道与物流", indent: true },
  { value: "4843/", label: "自动化", indent: true },
  { value: "417/", label: "能源", indent: true },
  { value: "4558/", label: "红石", indent: true },
  { value: "436/food", label: "食物与烹饪" },
  { value: "416/", label: "农业", indent: true },
  { value: "/game-mechanics", label: "游戏机制" },
  { value: "414/transportation", label: "运输" },
  { value: "420/storage", label: "仓储" },
  { value: "419/magic", label: "魔法" },
  { value: "422/adventure", label: "冒险" },
  { value: "424/decoration", label: "装饰" },
  { value: "411/mobs", label: "生物" },
  { value: "5191/utility", label: "实用" },
  { value: "434/equipment", label: "装备与工具" },
  { value: "9026/", label: "创造模式" },
  { value: "6814/optimization", label: "性能优化" },
  { value: "423/", label: "信息显示" },
  { value: "435/social", label: "服务器" },
  { value: "421/library", label: "支持库" },
];

const MODPACK: TagOption[] = [
  { value: "", label: "全部分类" },
  { value: "4484/", label: "多人" },
  { value: "/optimization", label: "性能优化" },
  { value: "4479/challenging", label: "硬核" },
  { value: "4483/combat", label: "战斗" },
  { value: "4478/quests", label: "任务" },
  { value: "4472/technology", label: "科技" },
  { value: "4473/magic", label: "魔法" },
  { value: "4475/adventure", label: "冒险" },
  { value: "/kitchen-sink", label: "水槽包" },
  { value: "4476/", label: "探索" },
  { value: "4477/", label: "小游戏" },
  { value: "4474/", label: "科幻" },
  { value: "4736/", label: "空岛" },
  { value: "5128/", label: "原版改良" },
  { value: "4487/", label: "FTB" },
  { value: "4480/", label: "基于地图" },
  { value: "4481/lightweight", label: "轻量整合" },
  { value: "4482/", label: "大型整合" },
];

const RESOURCEPACK: TagOption[] = [
  { value: "", label: "全部分类" },
  { value: "403/vanilla-like", label: "原版风", group: "风格" },
  { value: "400/realistic", label: "写实风", group: "风格" },
  { value: "401/", label: "现代风", group: "风格" },
  { value: "402/", label: "中世纪", group: "风格" },
  { value: "399/", label: "蒸汽朋克", group: "风格" },
  { value: "/themed", label: "主题化", group: "风格" },
  { value: "/simplistic", label: "简洁", group: "风格" },
  { value: "/decoration", label: "装饰", group: "风格" },
  { value: "/combat", label: "战斗", group: "风格" },
  { value: "/utility", label: "实用", group: "风格" },
  { value: "/tweaks", label: "改良", group: "风格" },
  { value: "/cursed", label: "鬼畜", group: "风格" },
  { value: "/entities", label: "含实体", group: "特性" },
  { value: "/audio", label: "含声音", group: "特性" },
  { value: "5244/fonts", label: "含字体", group: "特性" },
  { value: "/models", label: "含模型", group: "特性" },
  { value: "/locale", label: "含语言", group: "特性" },
  { value: "/gui", label: "含 UI", group: "特性" },
  { value: "/core-shaders", label: "核心着色器", group: "特性" },
  { value: "404/", label: "动态效果", group: "特性" },
  { value: "4465/modded", label: "兼容 Mod", group: "特性" },
  { value: "/8x-", label: "8x 或更低", group: "分辨率" },
  { value: "393/16x", label: "16x", group: "分辨率" },
  { value: "394/32x", label: "32x", group: "分辨率" },
  { value: "/48x", label: "48x", group: "分辨率" },
  { value: "395/64x", label: "64x", group: "分辨率" },
  { value: "396/128x", label: "128x", group: "分辨率" },
  { value: "397/256x", label: "256x", group: "分辨率" },
  { value: "398/512x+", label: "512x 或更高", group: "分辨率" },
];

const SHADER: TagOption[] = [
  { value: "", label: "全部分类" },
  { value: "6555/vanilla-like", label: "原版风", group: "风格" },
  { value: "6554/fantasy", label: "幻想风", group: "风格" },
  { value: "6553/realistic", label: "写实风", group: "风格" },
  { value: "/semi-realistic", label: "半写实风", group: "风格" },
  { value: "/cartoon", label: "卡通风", group: "风格" },
  { value: "/colored-lighting", label: "彩色光照", group: "特性" },
  { value: "/path-tracing", label: "路径追踪", group: "特性" },
  { value: "/pbr", label: "PBR", group: "特性" },
  { value: "/reflections", label: "反射", group: "特性" },
  { value: "/potato", label: "极低", group: "性能负荷" },
  { value: "/low", label: "低", group: "性能负荷" },
  { value: "/medium", label: "中", group: "性能负荷" },
  { value: "/high", label: "高", group: "性能负荷" },
  { value: "/vanilla", label: "原版可用", group: "加载器" },
  { value: "/iris", label: "Iris", group: "加载器" },
  { value: "/optifine", label: "OptiFine", group: "加载器" },
];

const DATAPACK: TagOption[] = [
  { value: "", label: "全部分类" },
  { value: "/worldgen", label: "世界元素" },
  { value: "6951/technology", label: "科技" },
  { value: "/game-mechanics", label: "游戏机制" },
  { value: "/transportation", label: "运输" },
  { value: "/storage", label: "仓储" },
  { value: "6952/magic", label: "魔法" },
  { value: "6948/adventure", label: "冒险" },
  { value: "6949/", label: "幻想" },
  { value: "/decoration", label: "装饰" },
  { value: "/mobs", label: "生物" },
  { value: "6953/utility", label: "实用" },
  { value: "/equipment", label: "装备与工具" },
  { value: "/optimization", label: "性能优化" },
  { value: "/social", label: "服务器" },
  { value: "6950/library", label: "支持库" },
  { value: "6946/", label: "Mod 相关" },
];

export const resourceTags: Record<string, TagOption[]> = {
  mod: MOD,
  modpack: MODPACK,
  resourcepack: RESOURCEPACK,
  shader: SHADER,
  datapack: DATAPACK,
};
