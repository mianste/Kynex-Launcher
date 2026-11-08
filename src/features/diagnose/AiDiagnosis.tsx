import { create } from "zustand";
import { useEffect, useState } from "react";
import { api, desktop } from "../../lib/bridge";
import {
  Button,
  Card,
  Input,
  Row,
  Badge,
  Switch,
  Modal,
} from "../../components/ui";
import { useStore, guarded } from "../../store";
export type DiagnosisEvent = {
  autoDiagnosis?: boolean;
  status: string;
  report?: string;
  error?: string;
  reason?: string;
};
export const useDiagnosis = create<{
  event: DiagnosisEvent | null;
  open: boolean;
  receive: (event: DiagnosisEvent) => void;
  close: () => void;
}>((set) => ({
  event: null,
  open: false,
  receive: (event) =>
    set((s) => ({
      event: {
        ...s.event,
        ...event,
        error: event.error,
        report: event.status === "analyzing" ? undefined : event.report,
      },
      open: true,
    })),
  close: () => set({ open: false }),
}));
export function AutomaticDiagnosis() {
  const d = useDiagnosis();
  return d.open && d.event ? (
    <Modal
      title="游戏出错了"
      onClose={d.close}
      footer={
        <Button
          onClick={() => {
            d.close();
            useStore.getState().setPage("diagnose");
          }}
        >
          查看诊断页面
        </Button>
      }
    >
      <DiagnosisResult event={d.event} />
    </Modal>
  ) : null;
}
export function DiagnosisResult({ event }: { event: DiagnosisEvent }) {
  return (
    <div aria-live="polite">
      <p>{event.reason}</p>
      {event.status === "analyzing" ? (
        <p role="status">正在使用 DeepSeek 分析本次启动日志…</p>
      ) : event.error ? (
        <div className="notice error">{event.error}</div>
      ) : (
        <>
          <div
            style={{
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              maxHeight: 360,
              overflowY: "auto",
            }}
          >
            {event.report}
          </div>
          <Button
            onClick={() =>
              void guarded(async () => {
                await navigator.clipboard.writeText(event.report || "");
                useStore.getState().notify("诊断结果已复制");
              })
            }
          >
            复制诊断结果
          </Button>
        </>
      )}
    </div>
  );
}
export function DeepSeekSettings() {
  const s = useStore();
  const [key, K] = useState("");
  const [saved, S] = useState(false);
  const [automatic, A] = useState(true);
  const [busy, B] = useState(false);
  const [error, E] = useState("");
  useEffect(() => {
    if (!desktop) return;
    let live = true;
    Promise.all([
      api<{ configured: boolean }>("ai_key_status"),
      api<{ automatic: boolean }>("ai_options"),
    ])
      .then(([v, o]) => {
        if (live) {
          S(v.configured);
          A(o.automatic);
        }
      })
      .catch((e) => {
        if (live) E(String(e));
      });
    return () => {
      live = false;
    };
  }, []);
  async function save() {
    B(true);
    E("");
    try {
      await api("ai_key_save", { key });
      K("");
      S(true);
      s.notify("DeepSeek API Key 已保存到系统凭据库");
    } catch (e) {
      E(String(e));
    } finally {
      B(false);
    }
  }
  return (
    <>
      <h3>日志分析</h3>
      <p>
        仅支持
        DeepSeek。检测到游戏异常退出后自动分析日志，结果也会保留在诊断页面。
      </p>
      <Row
        title="DeepSeek API Key"
        hint="Key 保存在系统凭据库，不回显；留空不会覆盖。"
      >
        <Input
          type="password"
          aria-label="DeepSeek API Key"
          value={key}
          placeholder={saved ? "已配置，填写可替换" : "输入 DeepSeek API Key"}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => K(e.target.value)}
        />
        <Button
          busy={busy}
          disabled={!desktop || !key.trim()}
          onClick={() => void save()}
        >
          保存 Key
        </Button>
      </Row>
      <Row title="密钥状态">
        <Badge tone={saved ? "ok" : "warn"}>
          {saved ? "已配置" : "未配置"}
        </Badge>
        <Button
          disabled={!desktop || !saved || busy}
          onClick={() =>
            void guarded(async () => {
              await api("ai_key_remove");
              S(false);
              K("");
            })
          }
        >
          删除 Key
        </Button>
      </Row>
      <Row
        title="自动检测并诊断"
        hint="闪退或疑似未完成加载时，将脱敏后的日志片段发送至 DeepSeek，按你的 API 账户计费。"
      >
        <Switch
          label="自动分析游戏报错"
          on={automatic}
          change={() =>
            void guarded(async () => {
              await api("ai_options", { automatic: !automatic });
              A(!automatic);
            })
          }
        />
      </Row>
      {error && <div className="notice error">{error}</div>}
      <p>
        发送前会隐藏常见的密钥、邮箱和用户路径。你也可以关闭自动分析。
      </p>
    </>
  );
}
