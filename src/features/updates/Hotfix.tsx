import { create } from "zustand";
import { useEffect, useState } from "react";
import { api, desktop } from "../../lib/bridge";
import { Button, Modal, Row, Badge } from "../../components/ui";
import { useStore } from "../../store";
import { GUIDE_KEY } from "../assistant/Onboarding";
type Patch = { revision: number; notes: string };
type Status = {
  revision: number;
  notes: string;
  canRollback: boolean;
  available?: Patch;
};
const useHotfix = create<{ status: Status | null; set: (s: Status) => void }>(
  (set) => ({ status: null, set: (s) => set({ status: s }) }),
);
export function HotfixStartup({ ready }: { ready: boolean }) {
  useEffect(() => {
    if (!ready || !desktop) return;
    void api("hotfix_ready").catch(() => {});
    const check = () => {
      if (localStorage.getItem(GUIDE_KEY) !== "done") return;
      void api<{ status: string }>("hotfix_check")
        .then(async (reply) => {
          useHotfix.getState().set(await api<Status>("hotfix_status"));
          if (reply.status === "available")
            useStore
              .getState()
              .notify("有可用的小修复补丁，请到设置 → 更新查看。");
        })
        .catch(() => {});
    };
    if (useStore.getState().settings.checkUpdatesOnStartup !== false) check();
    window.addEventListener("kynex-guide-finished", check);
    return () => window.removeEventListener("kynex-guide-finished", check);
  }, [ready]);
  return null;
}
export function HotfixSettings() {
  const { status, set } = useHotfix();
  const s = useStore();
  const [busy, B] = useState(false);
  const [message, M] = useState("");
  const [confirm, C] = useState<"apply" | "rollback" | null>(null);
  useEffect(() => {
    if (desktop)
      void api<Status>("hotfix_status")
        .then(set)
        .catch((e) => M(String(e)));
  }, []);
  async function check() {
    B(true);
    M("");
    try {
      const reply = await api<{ status: string }>("hotfix_check");
      set(await api<Status>("hotfix_status"));
      M(
        reply.status === "available"
          ? "发现小修复补丁，可查看说明后应用。"
          : reply.status === "unpublished"
            ? "当前版本尚未发布热修复补丁。"
            : "当前没有需要应用的小修复。",
      );
    } catch (e) {
      M(String(e));
    } finally {
      B(false);
    }
  }
  async function apply() {
    if (!confirm) return;
    B(true);
    M("");
    try {
      await api(confirm === "apply" ? "hotfix_install" : "hotfix_rollback");
      location.reload();
    } catch (e) {
      M(String(e));
      C(null);
      B(false);
    }
  }
  const working =
    s.busy ||
    !!(
      s.task &&
      !s.task.finished &&
      s.task.done < s.task.total &&
      !s.task.error
    );
  return (
    <section className="hotfix-settings">
      <h3>小修复热更新</h3>
      <p>
        界面、文案与前端逻辑可以通过签名补丁更新，不改启动器版本号；核心功能更新仍使用完整安装包。应用补丁会刷新界面。
      </p>
      <Row title="当前界面补丁">
        <Badge>
          {status?.revision ? `修订 ${status.revision}` : "内置界面"}
        </Badge>
        <Button disabled={!desktop || busy} onClick={() => void check()}>
          检查小修复
        </Button>
        {status?.canRollback && (
          <Button disabled={busy || working} onClick={() => C("rollback")}>
            回退界面补丁
          </Button>
        )}
      </Row>
      {status?.available && (
        <div className="notice">
          <b>界面修订 {status.available.revision}</b>
          <p>{status.available.notes}</p>
          <Button primary disabled={busy || working} onClick={() => C("apply")}>
            应用修复
          </Button>
        </div>
      )}
      {working && <p>请先等待当前任务结束，再应用或回退界面补丁。</p>}
      {message && <p role="status">{message}</p>}
      {confirm && (
        <Modal
          title={confirm === "apply" ? "应用小修复" : "回退界面补丁"}
          onClose={() => {
            if (!busy) C(null);
          }}
          footer={
            <>
              <Button disabled={busy} onClick={() => C(null)}>
                取消
              </Button>
              <Button primary disabled={busy} onClick={() => void apply()}>
                {busy ? "正在校验…" : "确认并刷新界面"}
              </Button>
            </>
          }
        >
          <p>
            {confirm === "apply"
              ? status?.available?.notes
              : "恢复到上一个界面补丁，没有上一补丁时使用内置界面。"}
          </p>
          <p>
            游戏实例、账号与设置会保留，当前未发送的助手输入会在刷新后清空。补丁签名或版本校验失败时不会应用；新界面加载失败会自动回退。
          </p>
        </Modal>
      )}
    </section>
  );
}
