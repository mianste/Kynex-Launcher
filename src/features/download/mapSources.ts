export const MAP_COPYRIGHT_TITLE = "地图版权归原作者";
export const MAP_COPYRIGHT_BODY =
  "下载或使用前，请查看并遵守作者许可及站点规则。未经授权，不得转载、二次分发、商用或删除署名。如果遇到侵权内容，请停止使用。阅读这段提示不能代替许可，也不能自动免除责任。";

export type MapAction = "file" | "check" | "closed";
export type MapSourceId = "pixelmap" | "curseforge" | "sites";

export type MapEntry = {
  id: string;
  title: string;
  summary?: string;
  author?: string;
  previewUrl?: string;
  iconUrl?: string;
  pageUrl?: string;
  source: "pixelmap" | "curseforge";
  sourceLabel: string;
  action: MapAction;
  downloadNote?: string;
  versions?: string[];
  versionCount?: number;
  categories?: string[];
  views?: number;
  downloads?: number;
};

export type MapSite = {
  id: string;
  name: string;
  url: string;
  detail: string;
};

export type MapPage = {
  hits: MapEntry[];
  total: number;
  page: number;
  pageSize: number;
};

/** 已核实的地图站点。这些入口没有单张地图数据，不能当成已下载的地图。 */
export const MAP_SITES: MapSite[] = [
  {
    id: "pixelmap",
    name: "像素茶艺地图站",
    url: "https://goto.pixelmap.cc/maps",
    detail: "这是像素茶艺的资源中心站点，不是某一张地图。单张地图、作者和预览在「像素茶艺」列表里；只有该站托管的压缩包才会显示下载并安装。",
  },
  {
    id: "curseforge",
    name: "CurseForge 地图",
    url: "https://www.curseforge.com/minecraft/worlds",
    detail: "这是 CurseForge 的 Minecraft 地图分类站点，不是某一张地图。桌面版通过官方 API 列出并下载该分类中的地图。",
  },
  {
    id: "planetminecraft",
    name: "Planet Minecraft",
    url: "https://www.planetminecraft.com/projects/",
    detail: "这是 Planet Minecraft 的社区地图站点，不是某一张地图。没有接入可核验的单张地图下载接口。按钮只会打开原站，不会开始下载或安装。",
  },
  {
    id: "minecraftmaps",
    name: "Minecraft Maps",
    url: "https://www.minecraftmaps.com/",
    detail: "这是 Minecraft Maps 地图站点，不是某一张地图。没有接入可核验的单张地图下载接口。按钮只会打开原站，不会开始下载或安装。",
  },
];

const PIXELMAP_SEARCH = "https://goto.pixelmap.cc/api/open/v1/maps/search";

function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("https://")) return;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.protocol !== "https:") return;
    return url.toString();
  } catch {
    return;
  }
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function texts(value: unknown, take: number): { items?: string[]; count?: number } {
  if (!Array.isArray(value)) return {};
  const items = value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim());
  if (!items.length) return {};
  return { items: items.slice(0, take), count: items.length };
}

function pixelmapSlug(slug: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(slug) && slug.includes("_");
}

function pixelmapPage(url: unknown, slug: string): string | undefined {
  const parsed = httpsUrl(url);
  if (parsed) {
    try {
      const page = new URL(parsed);
      if (page.hostname === "goto.pixelmap.cc") return page.toString();
    } catch {
      return;
    }
  }
  return pixelmapSlug(slug) ? `https://goto.pixelmap.cc/maps/${slug}` : undefined;
}

export function mapFromPixelmap(item: unknown): MapEntry | undefined {
  if (!item || typeof item !== "object") return;
  const row = item as Record<string, unknown>;
  const title = text(row.title);
  if (!title) return;
  const slug = text(row.slug) ?? "";
  const slugOk = pixelmapSlug(slug);
  const pageUrl = pixelmapPage(row.url, slugOk ? slug : "");
  const id = slugOk ? slug : pageUrl;
  if (!id) return;
  const allowed = row.download_allowed === true && slugOk;
  const integrated = row.download_integrated === true;
  const action: MapAction = allowed && integrated ? "file" : allowed ? "check" : "closed";
  const downloadNote = action === "closed"
    ? slugOk
      ? "作者未开放下载，接口没有给出文件"
      : "接口没有给出可用的地图标识"
    : undefined;
  const versions = texts(row.versions, 3);
  const categories = texts(row.categories, 4);
  return {
    id,
    title,
    summary: text(row.summary),
    author: text(row.author),
    previewUrl: httpsUrl(row.preview_image),
    pageUrl,
    source: "pixelmap",
    sourceLabel: "像素茶艺",
    action,
    downloadNote,
    versions: versions.items,
    versionCount: versions.count,
    categories: categories.items,
    views: typeof row.views === "number" ? row.views : undefined,
  };
}

export function normalizeMapPage(value: unknown, fallbackPage: number): MapPage {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const hits = Array.isArray(row.hits)
    ? row.hits.map(normalizeMapEntry).filter((entry): entry is MapEntry => !!entry)
    : Array.isArray(row.items)
      ? row.items.map(mapFromPixelmap).filter((entry): entry is MapEntry => !!entry)
      : [];
  const total = typeof row.total === "number" ? row.total : hits.length;
  const page = typeof row.page === "number" ? row.page : fallbackPage;
  const pageSize = typeof row.pageSize === "number" ? row.pageSize : typeof row.limit === "number" ? row.limit : 20;
  return { hits, total, page, pageSize };
}

function normalizeMapEntry(value: unknown): MapEntry | undefined {
  if (!value || typeof value !== "object") return;
  const row = value as Record<string, unknown>;
  if (row.source === "pixelmap" && row.slug) return mapFromPixelmap(row);
  const title = text(row.title);
  const id = text(row.id);
  const source = row.source === "curseforge" || row.source === "pixelmap" ? row.source : undefined;
  if (!title || !id || !source) return mapFromPixelmap(row);
  const versions = texts(row.versions, 3);
  const categories = texts(row.categories, 4);
  return {
    id,
    title,
    summary: text(row.summary),
    author: text(row.author),
    previewUrl: httpsUrl(row.previewUrl),
    iconUrl: httpsUrl(row.iconUrl),
    pageUrl: httpsUrl(row.pageUrl),
    source,
    sourceLabel: text(row.sourceLabel) ?? (source === "pixelmap" ? "像素茶艺" : "CurseForge"),
    action: row.action === "file" || row.action === "check" || row.action === "closed"
      ? row.action
      : row.action === "download"
        ? "file"
        : "closed",
    downloadNote: text(row.downloadNote) ?? text(row.download_note),
    versions: versions.items,
    versionCount: typeof row.versionCount === "number" ? row.versionCount : versions.count,
    categories: categories.items,
    views: typeof row.views === "number" ? row.views : undefined,
    downloads: typeof row.downloads === "number" ? row.downloads : undefined,
  };
}

export async function searchPixelmapInBrowser(query: string, page: number, version: string): Promise<MapPage> {
  const url = new URL(PIXELMAP_SEARCH);
  const keyword = query.trim();
  if (keyword) url.searchParams.set("keyword", keyword);
  if (version.trim()) url.searchParams.set("version", version.trim());
  url.searchParams.set("page", String(page + 1));
  url.searchParams.set("limit", "20");
  url.searchParams.set("sort", "trend");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`像素茶艺接口返回 HTTP ${response.status}`);
  return normalizeMapPage(await response.json(), page);
}

export function mapActionLabel(entry: MapEntry, desktop: boolean): string {
  if (entry.action === "closed") return entry.downloadNote || "作者未开放下载，接口没有给出文件";
  if (!desktop) return "桌面版才能下载";
  return entry.action === "check" ? "下载" : "下载并安装";
}

export function mapStatusLabel(status: string): string {
  if (status === "installed") return "已安装到存档";
  if (status === "downloaded") return "已下载，尚未安装到存档";
  return "没有完成";
}

export function versionLabel(entry: MapEntry): string {
  const shown = entry.versions?.filter(Boolean) ?? [];
  if (!shown.length) return "";
  const count = entry.versionCount ?? shown.length;
  return count > shown.length ? `${shown.join("、")} 等 ${count} 个版本` : shown.join("、");
}
