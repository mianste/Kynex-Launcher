import { api } from "../../lib/bridge";
import type { Project } from "../../lib/types";
import { CatalogCache } from "./catalogCache";

export type Version = {
  id: string;
  name: string;
  number: string;
  date: string;
  type: string;
  gameVersions?: string[];
  loaders?: string[];
  compatible?: boolean;
  filename?: string;
  fileSource?: "CurseForge";
};

type VersionPage = { versions: Version[]; nextOffset?: number | null; warning?: string; unavailable?: string };

export const versionCatalog = new CatalogCache<VersionPage>(async (query) => {
  const reply = await api<VersionPage | Version[]>("project_versions", query);
  return Array.isArray(reply) ? { versions: reply } : reply;
});

export function versionQuery(project: Project, params: {
  id: string;
  kind: string;
  game: string;
  loader: string;
  curseforgeKey: string;
  directoryId: string;
}) {
  return {
    ...params,
    directoryId: params.directoryId || undefined,
    project: project.project_id,
    source: project.source || "modrinth",
    paged: true,
    offset: 0,
  };
}
