export type Page =
  | "home"
  | "library"
  | "instance"
  | "discover"
  | "workshop"
  | "news"
  | "account"
  | "skin"
  | "diagnose"
  | "settings"
  | "help"
  | "components";
export type Loader =
  "vanilla" | "fabric" | "quilt" | "forge" | "neoforge" | "optifine";
export type Game = "java" | "bedrock" | "dungeons" | "dungeons2" | "legends";
export interface Instance {
  id: string;
  name: string;
  version: string;
  loader: Loader;
  optifineVersion?: string;
  game: Game;
  path: string;
  lastPlayed?: string;
  icon?: string;
  packIcon?: string;
  packLogo?: string;
  modpack?: boolean;
  externalVersion?: string;
  settings: InstanceSettings;
}
export interface InstanceSettings {
  memory: number;
  java: string;
  width: number;
  height: number;
  isolation: "all" | "modded" | "shared" | "custom";
  gameDirectory?: string;
}
export interface GameDirectory {
  id: string;
  name: string;
  path: string;
  available: boolean;
}
export interface GameDirectories {
  activeId: string;
  items: GameDirectory[];
}
export interface Account {
  id: string;
  name: string;
  kind: "offline" | "microsoft" | "external";
  uuid: string;
  server?: string;
  skin?: string;
  skinModel?: "Classic" | "Slim";
  cape?: string;
  capeId?: string;
  capes?: { id: string; name: string; texture: string; active: boolean }[];
  uploadableTextures?: ("skin" | "cape")[];
}
export interface GameVersion {
  id: string;
  type: string;
  releaseTime: string;
  url: string;
}
export interface Resource {
  modIds?: string[];
  name: string;
  size: number;
  modified?: number | null;
  enabled: boolean;
  order?: number;
  version?: string;
  problems?: string[];
  dir?: boolean;
  icon_url?: string;
}
export interface Settings extends InstanceSettings {
  updateMode: "manual" | "automatic";
  checkUpdatesOnStartup: boolean;
  accent: string;
  wallpaper: string;
  /** 全局界面背景材质不透明度（0–100）；不改变文字与图标透明度。 */
  uiOpacity: number;
  theme: "dark" | "light" | "system" | "custom";
  customThemeColor: string;
  clientId: string;
  curseforgeKey: string;
  threads: number;
  downloadSource: "official" | "bmclapi";
  /** 启动前写入 options.txt 的游戏语言；none 表示保持实例原样。 */
  gameLanguage: "zh_cn" | "en_us" | "none";
}
export interface Task {
  directoryId?: string;
  taskId?: string;
  name?: string;
  action?: string;
  payload?: Record<string, unknown>;
  finished?: boolean;
  stage: string;
  done: number;
  total: number;
  detail?: string;
  error?: string;
}
export interface Project {
  project_id: string;
  title: string;
  description: string;
  downloads: number;
  project_type: string;
  slug: string;
  icon_url?: string | null;
  source?: "modrinth" | "curseforge";
}
export interface NewsArticle {
  id: string;
  title: string;
  summary: string;
  published: string;
  category: string;
  image: string;
  url: string;
  source: string;
}
export interface PackInfo {
  name: string;
  version: string;
  loader: Loader;
  count: number;
  format: string;
  path: string;
}
export interface Diagnostic {
  id: string;
  title: string;
  severity: "bad" | "warn";
  advice: string;
  lines: { number: number; text: string }[];
}
export const defaultInstanceSettings: InstanceSettings = {
  memory: 4096,
  java: "",
  width: 1280,
  height: 720,
  isolation: "all",
};
