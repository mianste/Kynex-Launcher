import { lazy, Suspense, useEffect, useState } from "react";
import { Button, Modal } from "../../components/ui";
import { api } from "../../lib/bridge";
import type { MinecraftAppearance } from "./minecraftAppearance";
import type { SchematicModel } from "./schematicGeometry";
import "./schematicPreview.css";

const SchematicViewport = lazy(() => import("./SchematicViewport"));

export type SchematicPreviewRequest =
  | { name: string; instanceId: string; directory?: string }
  | { name: string; catalogId: string; instanceId?: string };

export function SchematicPreviewDialog({ request, onClose }: {
  request: SchematicPreviewRequest;
  onClose: () => void;
}) {
  const [result, Result] = useState<{ model: SchematicModel; appearance?: MinecraftAppearance } | { error: string }>();
  useEffect(() => {
    let live = true;
    Result(undefined);
    const load = "catalogId" in request
      ? api<SchematicModel>("schematic_catalog_preview", { entry: request.catalogId })
      : api<SchematicModel>("schematic_preview", {
          id: request.instanceId,
          name: request.name,
          directory: request.directory,
        });
    void load.then(
      async (model) => {
        if (!live) return;
        const appearance = await api<MinecraftAppearance>("schematic_appearance", {
          id: request.instanceId, palette: model.palette, entities: model.entities,
        }).catch(() => undefined);
        if (live) Result({ model, appearance });
      },
      error => { if (live) Result({ error: String(error).replace(/^Error: /, "") }); },
    );
    return () => { live = false; };
  }, [request]);

  return (
    <Modal
      title="投影预览"
      className="schematic-preview-modal"
      onClose={onClose}
      footer={<Button onClick={onClose}>关闭</Button>}
    >
      <p className="schematic-preview-name">{request.name}</p>
      {!result ? (
        <div className="schematic-viewport"><p role="status">正在读取投影模型和 Minecraft 纹理…</p></div>
      ) : "error" in result ? (
        <div className="notice error" role="alert">{result.error}</div>
      ) : (
        <>
          <p className="schematic-preview-info">
            {result.model.size.join(" × ")} 方块
            {result.model.step > 1 && <> · 简化显示，每格相当于 {result.model.step} 个方块宽</>}
          </p>
          <Suspense fallback={<div className="schematic-viewport"><p role="status">正在生成模型…</p></div>}>
            <SchematicViewport model={result.model} appearance={result.appearance} />
          </Suspense>
        </>
      )}
    </Modal>
  );
}
