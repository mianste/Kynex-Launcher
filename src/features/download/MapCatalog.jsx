import { useEffect, useRef, useState } from "react";
import { Download, FolderOpen, Upload } from "lucide-react";
import { Badge, Button, ChoiceSelect, Empty } from "../../components/ui";
import { ProjectIcon } from "./ProjectIcon";
import { api, desktop, pickFile } from "../../lib/bridge";
import { guarded, useStore } from "../../store";
import {
  MAP_COPYRIGHT_BODY,
  MAP_COPYRIGHT_TITLE,
  mapActionLabel,
  mapStatusLabel,
  searchPixelmapInBrowser,
  versionLabel,
} from "./mapSources";
const sources = [
  { id: "pixelmap", label: "像素茶艺" },
  { id: "curseforge", label: "CurseForge" },
];
export function MapCatalog({
  query,
  instanceId,
  instanceName,
  versions,
  refreshToken,
}) {
  const [source, setSource] = useState("pixelmap");
  const [version, setVersion] = useState("");
  const [page, setPage] = useState(0);
  const [result, setResult] = useState({
    hits: [],
    total: 0,
    page: 0,
    pageSize: 20,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");
  const [receipt, setReceipt] = useState(null);
  const request = useRef(0);
  const filter = `${source}|${version}|${query}|${refreshToken}`;
  const previousFilter = useRef(filter);
  useEffect(() => {
    if (previousFilter.current !== filter) {
      previousFilter.current = filter;
      if (page !== 0) {
        setPage(0);
        return;
      }
    }
    if (!desktop && source === "curseforge") {
      setLoading(false);
      setError("");
      setResult({ hits: [], total: 0, page: 0, pageSize: 20 });
      return;
    }
    const serial = ++request.current;
    const timer = setTimeout(
      () => {
        void load(serial);
      },
      query.trim() ? 180 : 0,
    );
    return () => clearTimeout(timer);
  }, [filter, page]);
  async function load(serial) {
    setLoading(true);
    setError("");
    try {
      const value = desktop
        ? await api("map_search", {
            source,
            query: query.trim(),
            game: version,
            page,
            curseforgeKey: useStore.getState().settings.curseforgeKey,
          })
        : await searchPixelmapInBrowser(query, page, version);
      if (serial !== request.current) return;
      setResult(value);
    } catch (cause) {
      if (serial !== request.current) return;
      setResult({ hits: [], total: 0, page, pageSize: 20 });
      const message = String(cause).replace(/^Error: /, "");
      setError(
        message.includes("Failed to fetch") || message.includes("NetworkError")
          ? "网页预览连不上像素茶艺接口。桌面版会通过开放 API 读取地图；这里没有下载，也没有安装。"
          : message,
      );
    } finally {
      if (serial === request.current) setLoading(false);
    }
  }
  async function install(entry) {
    if (!desktop || entry.action === "closed" || !instanceId || pending) return;
    setPending(entry.id);
    setError("");
    setReceipt(null);
    const directoryId = useStore.getState().directoryId;
    try {
      const value = await api("install_map", {
        source: entry.source,
        project: entry.id,
        id: instanceId,
        name: entry.title,
        previewUrl: entry.previewUrl || undefined,
        game: version,
        curseforgeKey: useStore.getState().settings.curseforgeKey,
      });
      if (value.status !== "installed" && value.status !== "downloaded") {
        throw new Error(value.note || "地图没有下载或安装");
      }
      setReceipt({ ...value, instanceId, directoryId });
    } catch (cause) {
      setError(String(cause).replace(/^Error: /, ""));
    } finally {
      setPending("");
    }
  }
  async function importArchive() {
    if (!desktop || !instanceId || pending) return;
    const path = await pickFile([
      { name: "地图压缩包", extensions: ["zip", "rar", "7z"] },
    ]);
    if (!path) return;
    setPending("import");
    setError("");
    setReceipt(null);
    const directoryId = useStore.getState().directoryId;
    try {
      const value = await api("install_map", {
        source: "file",
        path,
        id: instanceId,
        name: path.split(/[\\/]/).at(-1) ?? "地图",
      });
      if (value.status !== "installed" && value.status !== "downloaded") {
        throw new Error(value.note || "地图没有导入");
      }
      setReceipt({ ...value, instanceId, directoryId });
    } catch (cause) {
      setError(String(cause).replace(/^Error: /, ""));
    } finally {
      setPending("");
    }
  }
  const pages = Math.max(
    1,
    Math.ceil(result.total / Math.max(1, result.pageSize)),
  );
  return (
    <div className="map-catalog">
      <aside className="map-copyright" role="note">
        <strong>{MAP_COPYRIGHT_TITLE}</strong>
        <p>{MAP_COPYRIGHT_BODY}</p>
      </aside>
      <div className="source-tabs" role="tablist" aria-label="地图来源">
        {sources.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={source === item.id}
            className={source === item.id ? "on" : ""}
            onClick={() => setSource(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="spread section-tools map-catalog-tools">
        <span className="muted">
          {desktop
            ? instanceName
              ? `点安装后下载到 ${instanceName} 的存档，已有存档不会被覆盖。`
              : "先选择一个 Java 实例，才能把地图安装到存档。"
            : source === "curseforge"
              ? "网页预览不能查询或下载 CurseForge 地图，也不会编造列表。"
              : "网页预览。像素茶艺能返回的地图会显示在这里，但不能在这里下载或安装。"}
        </span>
        {desktop && source !== "sites" && (
          <Button
            disabled={!instanceId || !!pending}
            onClick={() => void importArchive()}
          >
            <Upload size={15} />
            {pending === "import" ? "正在导入…" : "导入压缩包"}
          </Button>
        )}
      </div>
      {source !== "sites" && (desktop || source === "pixelmap") && (
        <div className="resource-filters" aria-label="资源筛选">
          <label>
            <span>游戏版本</span>
            <ChoiceSelect
              value={version}
              onValueChange={setVersion}
              aria-label="地图游戏版本"
            >
              <option value="">全部版本</option>
              {versions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </ChoiceSelect>
          </label>
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {receipt && (
        <div className="notice map-receipt" role="status">
          <div>
            <strong>{mapStatusLabel(receipt.status)}</strong>
            {receipt.note && <p>{receipt.note}</p>}
          </div>
          <div className="map-receipt-actions">
            {receipt.status === "installed" && (
              <Button
                onClick={() =>
                  void guarded(() =>
                    api("open_resource_folder", {
                      id: receipt.instanceId,
                      kind: "saves",
                      ...(receipt.directoryId
                        ? { directoryId: receipt.directoryId }
                        : {}),
                    }),
                  )
                }
              >
                <FolderOpen size={15} />
                打开存档文件夹
              </Button>
            )}
            {receipt.archive && (
              <Button
                onClick={() =>
                  void guarded(() =>
                    api("open_resource_folder", {
                      id: receipt.instanceId,
                      kind: "map-downloads",
                      ...(receipt.directoryId
                        ? { directoryId: receipt.directoryId }
                        : {}),
                    }),
                  )
                }
              >
                <FolderOpen size={15} />
                打开已下载的压缩包
              </Button>
            )}
          </div>
        </div>
      )}
      {!desktop && source === "curseforge" ? (
        <Empty
          title="CurseForge 地图需要桌面版"
          detail="网页预览不会查询 CurseForge，也不会编造地图列表。桌面版使用官方 API 和你自己的密钥。"
        />
      ) : (
        <>
          {loading && result.hits.length === 0 && (
            <p className="muted" role="status">
              正在读取地图…
            </p>
          )}
          <div className="project-results" aria-busy={loading}>
            {result.hits.map((entry) => {
              const versionsText = versionLabel(entry);
              return (
                <article
                  className="project-result-row map-row"
                  key={`${entry.source}-${entry.id}`}
                >
                  <ProjectIcon
                    url={entry.previewUrl || entry.iconUrl}
                    name={entry.title}
                  />
                  <div className="project-copy">
                    <div className="project-title-line">
                      <h3>{entry.title}</h3>
                      <Badge>{entry.sourceLabel}</Badge>
                    </div>
                    {entry.summary && <p>{entry.summary}</p>}
                    <div className="project-meta">
                      <span>
                        {entry.author ? `作者 ${entry.author}` : "未提供作者"}
                      </span>
                      <span>{entry.sourceLabel}</span>
                      {typeof entry.views === "number" && (
                        <span>{entry.views.toLocaleString()} 次浏览</span>
                      )}
                      {typeof entry.downloads === "number" && (
                        <span>{entry.downloads.toLocaleString()} 次下载</span>
                      )}
                      {versionsText && <span>{versionsText}</span>}
                    </div>
                  </div>
                  <div className="map-actions">
                    {entry.action === "closed" ? (
                      <span className="map-download-note">
                        {mapActionLabel(entry, desktop)}
                      </span>
                    ) : (
                      <Button
                        primary
                        disabled={!desktop || !instanceId || !!pending}
                        onClick={() => void install(entry)}
                      >
                        <Download size={15} />
                        {pending === entry.id
                          ? "正在处理…"
                          : mapActionLabel(entry, desktop)}
                      </Button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          {!loading && !error && result.hits.length === 0 && (
            <Empty
              title="没有找到地图"
              detail="可以换一个搜索词或游戏版本。没有结果并不代表已经下载。"
            />
          )}
          {result.total > result.pageSize && (
            <div className="pagination">
              <span>
                共 {result.total.toLocaleString()} 条 · 第 {page + 1} / {pages}{" "}
                页
              </span>
              <div className="actions">
                <Button
                  disabled={page === 0 || loading}
                  onClick={() => setPage((current) => Math.max(0, current - 1))}
                >
                  上一页
                </Button>
                <Button
                  disabled={page + 1 >= pages || loading}
                  onClick={() => setPage((current) => current + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
