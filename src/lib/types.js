// Shared data structures used by the launcher UI and desktop commands.

/** @typedef {"home" | "library" | "instance" | "discover" | "workshop" | "news" | "account" | "skin" | "diagnose" | "settings" | "help" | "components"} Page */

/** @typedef {"vanilla" | "fabric" | "quilt" | "forge" | "neoforge" | "optifine"} Loader */

/** @typedef {"java" | "bedrock" | "dungeons" | "dungeons2" | "legends"} Game */

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   version: string,
 *   loader: Loader,
 *   optifineVersion?: string,
 *   game: Game,
 *   path: string,
 *   lastPlayed?: string,
 *   icon?: string,
 *   packIcon?: string,
 *   packLogo?: string,
 *   modpack?: boolean,
 *   externalVersion?: string,
 *   settings: InstanceSettings,
 * }} Instance
 */

/**
 * @typedef {{
 *   memory: number,
 *   java: string,
 *   width: number,
 *   height: number,
 *   isolation: "all" | "modded" | "shared" | "custom",
 *   gameDirectory?: string,
 * }} InstanceSettings
 */

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   path: string,
 *   available: boolean,
 * }} GameDirectory
 */

/**
 * @typedef {{
 *   activeId: string,
 *   items: GameDirectory[],
 * }} GameDirectories
 */

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   kind: "offline" | "microsoft" | "external",
 *   uuid: string,
 *   server?: string,
 *   skin?: string,
 *   skinModel?: "Classic" | "Slim",
 *   cape?: string,
 *   capeId?: string,
 *   capes?: { id: string; name: string; texture: string; active: boolean }[],
 *   uploadableTextures?: ("skin" | "cape")[],
 * }} Account
 */

/**
 * @typedef {{
 *   id: string,
 *   type: string,
 *   releaseTime: string,
 *   url: string,
 * }} GameVersion
 */

/**
 * @typedef {{
 *   modIds?: string[],
 *   name: string,
 *   size: number,
 *   modified?: number | null,
 *   enabled: boolean,
 *   order?: number,
 *   version?: string,
 *   problems?: string[],
 *   dir?: boolean,
 *   directory?: string,
 *   icon_url?: string,
 * }} Resource
 */

/**
 * @typedef {InstanceSettings & {
 *   updateMode: "manual" | "automatic",
 *   checkUpdatesOnStartup: boolean,
 *   accent: string,
 *   wallpaper: string,
 *   uiOpacity: number,
 *   theme: "dark" | "light" | "system" | "custom",
 *   customThemeColor: string,
 *   clientId: string,
 *   curseforgeKey: string,
 *   threads: number,
 *   downloadSource: "official" | "bmclapi",
 *   gameLanguage: "zh_cn" | "en_us" | "none",
 * }} Settings
 */

/**
 * @typedef {{
 *   directoryId?: string,
 *   taskId?: string,
 *   name?: string,
 *   action?: string,
 *   payload?: Record<string, unknown>,
 *   finished?: boolean,
 *   stage: string,
 *   done: number,
 *   total: number,
 *   detail?: string,
 *   error?: string,
 *   completion?: { title: string; detail?: string | null },
 * }} Task
 */

/**
 * @typedef {{
 *   project_id: string,
 *   title: string,
 *   description: string,
 *   downloads: number,
 *   project_type: string,
 *   slug: string,
 *   icon_url?: string | null,
 *   icon_full_url?: string | null,
 *   gallery?: { url: string; thumbnailUrl?: string | null; title?: string | null }[],
 *   source?: "modrinth" | "curseforge" | "pixelmap",
 *   author?: string,
 *   page_url?: string,
 *   download_state?: "file" | "check" | "closed",
 *   download_note?: string,
 * }} Project
 */

/** @typedef {{id: string, title: string, name?: string, detail?: string | null}} CompletionNotice */

/**
 * @typedef {{
 *   id: string,
 *   title: string,
 *   summary: string,
 *   published: string,
 *   category: string,
 *   image: string,
 *   url: string,
 *   source: string,
 * }} NewsArticle
 */

/**
 * @typedef {{
 *   id: "bedrock" | "dungeons" | "dungeons2" | "legends",
 *   name: string,
 *   installed: boolean,
 *   appId?: string,
 *   note?: string,
 * }} DetectedGame
 */

/**
 * @typedef {{
 *   host: string,
 *   port: number,
 *   motd: string,
 *   online: number,
 *   max: number,
 *   latency: number,
 *   version: string,
 *   srv: boolean,
 * }} ServerInfo
 */

/**
 * @typedef {{
 *   name: string,
 *   version: string,
 *   loader: Loader,
 *   count: number,
 *   format: string,
 *   path: string,
 * }} PackInfo
 */

/**
 * @typedef {{
 *   id: string,
 *   title: string,
 *   severity: "bad" | "warn",
 *   advice: string,
 *   lines: { number: number; text: string }[],
 * }} Diagnostic
 */

/** @type {InstanceSettings} */
export const defaultInstanceSettings = {
  memory: 4096,
  java: "",
  width: 1280,
  height: 720,
  isolation: "all",
};
