import { CatalogCache, appendCatalog, catalogCache } from "./catalogCache";
import { resolveResourceQuery } from "./modLocalization";

const sourceNames = {
  modrinth: "Modrinth",
  curseforge: "CurseForge",
  pixelmap: "像素茶艺",
};
const SECOND_SOURCE_WINDOW = 500;

// A slow source may finish warming its own cache, but cannot change this page after publication.
export function collectCatalogSources(requests, waitForAll) {
  return new Promise((resolve) => {
    let timer;
    let remaining = requests.length;
    const settled = [];
    function finish() {
      clearTimeout(timer);
      resolve(settled.slice().sort((a, b) => a.index - b.index));
    }
    function record(result) {
      settled.push(result);
      if (--remaining === 0) finish();
      else if (!waitForAll && timer === undefined && result.value?.hits?.length)
        timer = setTimeout(finish, SECOND_SOURCE_WINDOW);
    }
    requests.forEach((request, index) => {
      void request.then(
        (value) => record({ index, value }),
        (reason) => record({ index, reason }),
      );
    });
  });
}

function fetchSource(payload, force) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("等待来源响应超时")),
      force ? 9800 : 6500,
    );
  });
  return Promise.race([catalogCache.get(payload, force), deadline]).finally(
    () => clearTimeout(timer),
  );
}

export const resourcePages = new CatalogCache(
  async ({ force, ...view }) => {
    const { source, query, ...filters } = view;
    const translated = await resolveResourceQuery(query);
    const sources =
      source === "all"
        ? [filters.kind === "world" ? "pixelmap" : "modrinth", "curseforge"]
        : [source];
    const payloads = sources.map((selectedSource) => ({
      ...filters,
      query: translated,
      source: selectedSource,
      interactive: true,
    }));
    const requests = payloads.map(async (payload) => {
      const value = await fetchSource(payload, force === true);
      return {
        ...value,
        hits: value.hits ?? [],
      };
    });
    const results = await collectCatalogSources(requests, force === true);
    const prepared = results.map(({ index, value, reason }) => {
      if (!value) return { index, reason };
      return { index, value, reason, hits: value.hits ?? [] };
    });
    let projects = [];
    let total = 0;
    let pages = 1;
    const next = [];
    const failures = [];
    let available = false;
    for (const { index, value, reason, hits } of prepared) {
      if (!value) {
        failures.push(
          `${sourceNames[sources[index]]} 暂时不可用：${String(reason).replace(/^Error: /, "")}`,
        );
        continue;
      }
      available = true;
      const count = value.total ?? hits.length;
      const sourcePages = Math.ceil(
        count / (value.pageSize > 0 ? value.pageSize : 30),
      );
      projects = appendCatalog(projects, hits);
      total += count;
      pages = Math.max(pages, sourcePages);
      if (filters.page + 1 < sourcePages)
        next.push({ ...payloads[index], page: filters.page + 1 });
    }
    if (!available) throw new Error(failures.join("；"));
    // Keep returning to a page instantaneous for the session, including when one source was slow.
    // Do not permanently cache an empty page if a source failed or supplied fallback data.
    const incomplete =
      failures.length > 0 || results.some(({ value }) => value?.warning);
    return {
      projects,
      total,
      pages,
      next,
      warning: !projects.length && incomplete,
    };
  },
  Date.now,
  Infinity,
);
