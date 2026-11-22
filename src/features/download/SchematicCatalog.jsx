import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Box, Download, Eye, Upload } from "lucide-react";
import { Badge, Button, Empty } from "../../components/ui";
import { api, desktop, external, pickFile } from "../../lib/bridge";
import { guarded, useStore } from "../../store";
import { SchematicPreviewDialog } from "../library/SchematicPreviewDialog";
import entries from "../../../config/schematic-catalog.json";
import { prepareProjectIcons, ProjectIcon } from "./ProjectIcon";
import { CatalogCache } from "./catalogCache";
import { CatalogLoading } from "./CatalogLoading";
const PAGE_SIZE = 20;
const schematicCache = new CatalogCache(async (payload) => {
  const reply = await api("pixelmap_schematics", payload);
  const icons = await prepareProjectIcons(
    reply.hits.flatMap((row) => (row.icon ? [row.icon] : [])),
  );
  return {
    ...reply,
    warning: reply.partial ? "有些作品暂时无法确认是否可下载。" : undefined,
    hits: reply.hits.map((row) => ({
      ...row,
      displayIcon: row.icon ? icons.get(row.icon) : undefined,
    })),
  };
});
export function SchematicCatalog({ active = true, instanceId, query, pixelmapSlug }) {
  const [online, setOnline] = useState(!!pixelmapSlug);
  const [project, setProject] = useState(pixelmapSlug);
  const [page, setPage] = useState(0);
  const [response, setResponse] = useState();
  const [retry, setRetry] = useState(0);
  const previousRetry = useRef(0);
  const [preview, setPreview] = useState(null);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const search = query.trim().toLowerCase();
  const keyword = query.trim();
  const request = useMemo(
    () => ({ query: keyword, project: keyword ? undefined : project }),
    [keyword, project],
  );
  const current = response?.request === request && response.retry === retry ? response : undefined;
  const results = current?.results ?? schematicCache.peek(request);
  const searchError = current?.error;
  const visible = entries.filter((entry) =>
    [
      entry.name,
      entry.originalName,
      entry.description,
      entry.author,
      entry.format,
    ].some((field) => field.toLowerCase().includes(search)),
  );
  useEffect(() => {
    setPage(0);
  }, [request, retry]);
  useEffect(() => {
    if (!desktop || !online || !active || current) return;
    let live = true;
    const force = retry !== previousRetry.current;
    previousRetry.current = retry;
    if (!force && results) return;
    const timer = window.setTimeout(
      async () => {
        try {
          const reply = await schematicCache.get(request, force);
          if (live) setResponse({ request, retry, results: reply });
        } catch (cause) {
          if (live) setResponse({ request, retry, error: String(cause).replace(/^Error: /, "") });
        }
      },
      keyword ? 150 : 0,
    );
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [active, online, keyword, request, retry, current, results]);
  const pages = results ? Math.ceil(results.hits.length / PAGE_SIZE) : 0;
  async function save(entryId, remote) {
    if (!desktop || !instanceId || pending) return;
    setPending(entryId ?? "import");
    setError("");
    try {
      if (entryId) {
        await api("schematic_catalog_download", {
          id: instanceId,
          entry: entryId,
          name:
            remote?.name ?? entries.find((entry) => entry.id === entryId)?.name,
          source: remote ? "pixelmap" : undefined,
        });
        return;
      }
      const directoryId = useStore.getState().directoryId;
      const path = await pickFile([
        {
          name: "投影文件",
          extensions: ["litematic", "schem", "schematic", "nbt"],
        },
      ]);
      if (!path) return;
      const name = path.split(/[\\/]/).at(-1);
      const files = await api("import_resource_paths", {
        id: instanceId,
        kind: "schematics",
        paths: [path],
        ...(directoryId ? { directoryId } : {}),
      });
      const file = files.find((item) => item.name === name);
      if (!file) throw new Error("没有找到导入的投影文件");
      useStore.getState().notify("投影已导入目标实例");
      setPreview({ name: file.name, instanceId, directory: file.directory });
    } catch (cause) {
      setError(String(cause).replace(/^Error: /, ""));
    } finally {
      setPending("");
    }
  }
  if (!active) return null;
  return (
    <>
      <div className="spread section-tools schematic-catalog-tools">
        {desktop ? (
          <>
            <div className="source-tabs" role="tablist" aria-label="投影来源">
              <button
                role="tab"
                aria-selected={!online}
                className={!online ? "on" : ""}
                onClick={() => setOnline(false)}
              >
                内置作品
              </button>
              <button
                role="tab"
                aria-selected={online}
                className={online ? "on" : ""}
                onClick={() => {
                  setProject(undefined);
                  setOnline(true);
                }}
              >
                像素茶艺
              </button>
            </div>
            <Button
              disabled={!instanceId || !!pending}
              onClick={() => void save()}
            >
              <Upload size={15} />
              {pending === "import" ? "正在导入…" : "导入并预览"}
            </Button>
          </>
        ) : (
          <span className="muted">
            网页预览 · 下载到实例和建筑预览需要桌面版
          </span>
        )}
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {online ? (
        <>
          {searchError ? (
            <div className="notice error" role="alert">
              {searchError}
              <Button onClick={() => setRetry((n) => n + 1)}>重试</Button>
            </div>
          ) : !results ? (
            <CatalogLoading label="正在加载投影" />
          ) : (
            <>
              {results.warning && (
                <p className="notice" role="status">
                  {results.warning}
                </p>
              )}
              <div className="project-results">
                {results.hits
                  .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
                  .map((row) => (
                    <article
                      className="project-result-row schematic-catalog-row"
                      key={row.id}
                    >
                      <ProjectIcon
                        url={row.displayIcon}
                        name={row.name}
                        prepared
                      />
                      <div className="project-copy">
                        <div className="project-title-line">
                          <h3>{row.name}</h3>
                          <Badge>{row.format}</Badge>
                        </div>
                        {row.description && <p>{row.description}</p>}
                        {row.author && (
                          <div className="project-meta">作者 {row.author}</div>
                        )}
                      </div>
                      <div className="schematic-catalog-actions">
                        {row.page && (
                          <Button
                            onClick={() => guarded(() => external(row.page))}
                          >
                            查看原帖
                          </Button>
                        )}
                        <Button
                          primary
                          onClick={() => void save(row.id, row)}
                          disabled={!instanceId || !!pending}
                        >
                          <Download size={15} />
                          {pending === row.id ? "正在下载…" : "下载"}
                        </Button>
                      </div>
                    </article>
                  ))}
                {!results.hits.length && <Empty title="没有可下载的投影" />}
              </div>
              {project && !query.trim() ? (
                <Button onClick={() => setProject(undefined)}>
                  浏览像素茶艺投影
                </Button>
              ) : (
                pages > 1 && (
                  <div className="pagination">
                    <span>
                      第 {page + 1} / {pages} 页 · {results.hits.length} 个投影
                    </span>
                    <div className="actions">
                      <Button
                        disabled={page === 0}
                        onClick={() => setPage((n) => n - 1)}
                      >
                        上一页
                      </Button>
                      <Button
                        disabled={page + 1 >= pages}
                        onClick={() => setPage((n) => n + 1)}
                      >
                        下一页
                      </Button>
                    </div>
                  </div>
                )
              )}
            </>
          )}
        </>
      ) : (
        <div className="project-results">
          {visible.map((entry) => (
            <article
              className="project-result-row schematic-catalog-row"
              key={entry.id}
            >
              <div className="project-icon" aria-hidden="true">
                <Box size={24} />
              </div>
              <div className="project-copy">
                <div className="spread project-title-line">
                  <h3>
                    {entry.name} <small>{entry.originalName}</small>
                  </h3>
                  <Badge>{entry.format}</Badge>
                </div>
                <p>{entry.description}</p>
                <div className="row project-meta">
                  <span className="muted">{entry.author}</span>
                  <button
                    className="schematic-catalog-link"
                    onClick={() =>
                      void guarded(() => external(entry.licenseUrl))
                    }
                  >
                    {entry.license}
                    <ArrowUpRight size={12} />
                  </button>
                </div>
              </div>
              {desktop && (
                <div className="schematic-catalog-actions">
                  <Button
                    onClick={() =>
                      setPreview({
                        name: entry.name,
                        catalogId: entry.id,
                        instanceId,
                      })
                    }
                    disabled={!!pending}
                  >
                    <Eye size={15} />
                    预览
                  </Button>
                  <Button
                    primary
                    onClick={() => void save(entry.id)}
                    disabled={!instanceId || !!pending}
                  >
                    <Download size={15} />
                    {pending === entry.id ? "正在下载…" : "下载"}
                  </Button>
                </div>
              )}
            </article>
          ))}
          {!visible.length && <Empty title="没有匹配的投影" />}
        </div>
      )}
      {preview && (
        <SchematicPreviewDialog
          request={preview}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}
