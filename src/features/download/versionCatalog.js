import { api } from "../../lib/bridge";
import { CatalogCache } from "./catalogCache";
export const versionCatalog = new CatalogCache(async (query) => {
  const reply = await api("project_versions", query);
  return Array.isArray(reply) ? { versions: reply } : reply;
});
export function versionQuery(project, params) {
  return {
    ...params,
    directoryId: params.directoryId || undefined,
    project: project.project_id,
    source: project.source || "modrinth",
    webOnly:
      (project.source === "curseforge" &&
        project.download_state === "closed") ||
      undefined,
    paged: true,
    offset: 0,
  };
}
