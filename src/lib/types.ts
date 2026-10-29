export type Page =
  | "home"
  | "library"
  | "instance"
  | "discover"
  | "news"
  | "account"
  | "skin"
  | "diagnose"
  | "settings"
  | "help"
  | "components";
export type Loader =
  "vanilla" | "fabric" | "quilt" | "forge" | "neoforge" | "optifine";
export type Game = "java";
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
  settings: InstanceSettings;
}
export interface InstanceSettings {
  memory: number;
  java: string;
  width: number;
  height: number;
  isolation: "all" | "modded" | "shared";
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
  name: string;
  size: number;
  enabled: boolean;
  order?: number;
  version?: string;
  problems?: string[];
  dir?: boolean;
  icon_url?: string;
}
export interface Settings extends InstanceSettings {
  accent: string;
  wallpaper: string;
  theme: "dark" | "light" | "system";
  clientId: string;
  curseforgeKey: string;
  threads: number;
  downloadSource: "official" | "bmclapi";
}
export interface Task {
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
