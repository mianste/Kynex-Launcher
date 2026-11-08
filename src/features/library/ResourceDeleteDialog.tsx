import { useCallback, useState } from "react";
import { Button, Modal } from "../../components/ui";
import { api } from "../../lib/bridge";

export type DeleteRequest = {
  id: string; kind: string; world?: string; label: string; names: string[]; shared: boolean;
};
export function ResourceDeleteDialog({ request, close, completed }: {
  request: DeleteRequest;
  close: () => void;
  completed: (deleted: string[]) => Promise<void>;
}) {
  const [busy, Busy] = useState(false);
  const [names, Names] = useState(request.names);
  const [error, ErrorText] = useState("");
  const dismiss = useCallback(() => { if (!busy) close(); }, [busy, close]);
  async function remove() {
    Busy(true); ErrorText("");
    try {
      const result = await api<{ deleted: string[]; failed: { name: string; error: string }[]; warnings: string[] }>("delete_resources", {
        id: request.id, kind: request.kind, world: request.world, names,
      });
      Names(result.failed.map((r) => r.name));
      if (result.deleted.length) await completed(result.deleted);
      if (result.failed.length || result.warnings.length) {
        ErrorText([...result.failed.map((r) => `${r.name}：${r.error}`), ...result.warnings].join("\n"));
      } else close();
    } catch (error) { ErrorText(String(error)); }
    finally { Busy(false); }
  }
  return <Modal title={`删除${request.label}`} onClose={dismiss} className="resource-delete-dialog" footer={<>
    <Button disabled={busy} onClick={dismiss}>{names.length ? "取消" : "关闭"}</Button>
    {!!names.length && <Button primary className="resource-delete-confirm" busy={busy} onClick={() => void remove()}>删除 {names.length} 个文件</Button>}
  </>}>
    <p>将所选{request.label}移到系统回收站，需要时可从回收站还原。</p>
    {request.world && <p className="muted">存档：{request.world}</p>}
    {request.shared && <p className="notice">当前使用共享目录，删除后会影响使用此目录的其他实例。</p>}
    <ul className="resource-delete-files">{names.map((name) => <li key={name}>{name}</li>)}</ul>
    {!!error && <p className="notice error" role="alert" style={{ whiteSpace: "pre-wrap" }}>{error}</p>}
  </Modal>;
}
