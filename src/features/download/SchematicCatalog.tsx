import { useState } from "react";
import { ArrowUpRight, Box, Check, Download, Eye, FolderOpen, Upload } from "lucide-react";
import { Badge, Button, Empty } from "../../components/ui";
import { api, desktop, external, pickFile } from "../../lib/bridge";
import type { Resource } from "../../lib/types";
import { guarded, useStore } from "../../store";
import { SchematicPreviewDialog, type SchematicPreviewRequest } from "../library/SchematicPreviewDialog";
import entries from "../../../config/schematic-catalog.json";

type DownloadedSchematic = {
  name: string;
  directory: string;
  alreadyPresent: boolean;
};

export function SchematicCatalog({ instanceId, query }: { instanceId: string; query: string }) {
  const [preview, setPreview] = useState<SchematicPreviewRequest | null>(null);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<(DownloadedSchematic & {
    instanceId: string;
    directoryId: string;
  }) | null>(null);
  const search = query.trim().toLowerCase();
  const visible = entries.filter((entry) =>
    [entry.name, entry.originalName, entry.description, entry.author, entry.format]
      .some((field) => field.toLowerCase().includes(search)),
  );

  async function save(entryId?: string) {
    if (!desktop || !instanceId || pending) return;
    setPending(entryId ?? "import");
    setError("");
    setReceipt(null);
    const directoryId = useStore.getState().directoryId;
    try {
      if (entryId) {
        const file = await api<DownloadedSchematic>("schematic_catalog_download", {
          id: instanceId,
          entry: entryId,
          name: entries.find((entry) => entry.id === entryId)?.name,
        });
        setReceipt({ ...file, instanceId, directoryId });
        return;
      }
      const path = await pickFile([{ name: "投影文件", extensions: ["litematic", "schem", "schematic", "nbt"] }]);
      if (!path) return;
      const name = path.split(/[\\/]/).at(-1);
      const files = await api<Resource[]>("import_resource_paths", {
        id: instanceId, kind: "schematics", paths: [path],
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

  return (
    <>
      <div className="spread section-tools schematic-catalog-tools">
        <span className="muted">
          {desktop ? "免费下载 · 作品已标明作者和许可证" : "网页预览 · 下载到实例和建筑预览需要桌面版"}
        </span>
        {desktop && (
          <Button disabled={!instanceId || !!pending} onClick={() => void save()}>
            <Upload size={15} />{pending === "import" ? "正在导入…" : "导入并预览"}
          </Button>
        )}
      </div>
      {error && <div className="notice error" role="alert">{error}</div>}
      {receipt && (
        <div className="notice schematic-download-receipt">
          <div className="schematic-download-location" role="status">
            <strong><Check size={16} />{receipt.alreadyPresent ? "文件已在投影文件夹中" : "投影已下载"}</strong>
            <span>{receipt.name}</span>
            <span className="muted">{receipt.directory}</span>
          </div>
          <Button onClick={() => void guarded(() => api("open_resource_folder", {
            id: receipt.instanceId,
            kind: "schematics",
            directory: receipt.directory,
            ...(receipt.directoryId ? { directoryId: receipt.directoryId } : {}),
          }))}>
            <FolderOpen size={15} />打开投影文件夹
          </Button>
        </div>
      )}
      <div className="project-results">
        {visible.map((entry) => (
          <article className="project-result-row schematic-catalog-row" key={entry.id}>
            <div className="project-icon" aria-hidden="true"><Box size={24} /></div>
            <div className="project-copy">
              <div className="spread project-title-line">
                <h3>{entry.name} <small>{entry.originalName}</small></h3>
                <Badge>{entry.format}</Badge>
              </div>
              <p>{entry.description}</p>
              <div className="row project-meta">
                <span className="muted">{entry.author}</span>
                <button className="schematic-catalog-link" onClick={() => void guarded(() => external(entry.licenseUrl))}>
                  {entry.license}<ArrowUpRight size={12} />
                </button>
              </div>
            </div>
            {desktop && (
              <div className="schematic-catalog-actions">
                <Button onClick={() => setPreview({ name: entry.name, catalogId: entry.id, instanceId })} disabled={!!pending}>
                  <Eye size={15} />预览
                </Button>
                <Button primary onClick={() => void save(entry.id)} disabled={!instanceId || !!pending}>
                  <Download size={15} />{pending === entry.id ? "正在下载…" : "下载"}
                </Button>
              </div>
            )}
          </article>
        ))}
        {!visible.length && <Empty title="没有匹配的投影" />}
      </div>
      {preview && <SchematicPreviewDialog request={preview} onClose={() => setPreview(null)} />}
    </>
  );
}
