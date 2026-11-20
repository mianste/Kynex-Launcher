import { api, desktop } from "../../lib/bridge";
import type { Resource } from "../../lib/types";
import { prepareProjectIcons } from "../download/ProjectIcon";

type ResourceQuery = {
  id: string;
  directoryId?: string;
  kind: string;
  world?: string;
  curseforgeKey?: string;
};

const previews = new Map<string, {
  rows?: Resource[];
  request?: Promise<Resource[]>;
  updated: number;
}>();

function key({ directoryId, id, kind, world }: ResourceQuery) {
  return `${directoryId ?? ""}:${id}:${kind}:${world ?? ""}`;
}

async function findArtwork(query: ResourceQuery, names: string[], urls: Map<string, string>) {
  const action = query.kind === "saves" ? "map_world_covers" : "resource_artwork";
  // Up to three small batches at a time so a large pack does not monopolize disk or network.
  for (let start = 0; start < names.length; start += 72) {
    await Promise.all([start, start + 24, start + 48].filter((offset) => offset < names.length)
      .map(async (offset) => {
        const result = await api<Record<string, string>>(action, { ...query, names: names.slice(offset, offset + 24) }).catch(() => ({}));
        for (const [name, url] of Object.entries(result)) urls.set(name, url);
      }));
  }
}

async function prepareRows(query: ResourceQuery): Promise<Resource[]> {
  const rows = await api<Resource[]>("resources", query.kind === "schematics" ? { ...query, basic: true } : query);
  if (query.kind === "schematics") return rows;
  const known = prepareProjectIcons(rows.flatMap((row) => row.icon_url ? [row.icon_url] : []));
  const names = rows.filter((row) => !row.icon_url && (query.kind === "saves" ? row.dir : !row.dir)).map((row) => row.name);
  const urls = new Map<string, string>();
  let timer: number | undefined;
  if (names.length) {
    await Promise.race([
      findArtwork(query, names, urls),
      new Promise<void>((resolve) => { timer = window.setTimeout(resolve, 1800); }),
    ]).finally(() => window.clearTimeout(timer));
  }
  const matched = new Map(urls);
  const [knownImages, foundImages] = await Promise.all([known, prepareProjectIcons(matched.values())]);
  return rows.map((row) => {
    const icon = row.icon_url ? knownImages.get(row.icon_url) : foundImages.get(matched.get(row.name) ?? "");
    return { ...row, icon_url: icon || undefined };
  });
}

export function resourcePreview(query: ResourceQuery, refresh = false): Promise<Resource[]> {
  const scope = key(query);
  const current = previews.get(scope);
  if (current?.request) return refresh
    ? current.request.catch(() => {}).then(() => resourcePreview(query, true))
    : current.request;
  if (!refresh && current?.rows && Date.now() - current.updated < 8000) return Promise.resolve(current.rows);
  if (!current && previews.size >= 16) {
    const oldest = [...previews].find(([, entry]) => !entry.request)?.[0];
    if (oldest) previews.delete(oldest);
  }
  const entry = current ?? { updated: 0 };
  entry.request = prepareRows(query).then((rows) => {
    entry.rows = rows;
    entry.updated = Date.now();
    return rows;
  }).finally(() => { entry.request = undefined; });
  previews.set(scope, entry);
  return entry.request;
}

export function cachedResourcePreview(query: ResourceQuery) {
  return previews.get(key(query))?.rows;
}

export function warmInstanceResources(id: string, directoryId?: string, curseforgeKey?: string) {
  if (!desktop || !id) return;
  for (const kind of ["mods", "resourcepacks", "shaderpacks", "saves", "datapacks"]) {
    void resourcePreview({ id, directoryId, curseforgeKey, kind }).catch(() => {});
  }
}
