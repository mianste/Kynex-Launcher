import { create } from "zustand";
import { FormattedAnswer } from "../assistant/FormattedAnswer";
import { Button, Modal } from "../../components/ui";
import { useStore, guarded } from "../../store";
export const useDiagnosis = create((set) => ({
  event: null,
  automaticResult: null,
  dismissAutomatic: () => set({ automaticResult: null }),
  open: false,
  unread: false,
  markRead: () => set({ unread: false }),
  receive: (event) =>
    set((s) => ({
      event: {
        ...s.event,
        ...event,
        autoDiagnosis: event.autoDiagnosis === true,
        error: event.error,
        report: event.status === "analyzing" ? undefined : event.report,
      },
      open: event.autoDiagnosis !== true,
      ...(event.autoDiagnosis === true &&
      ["done", "error"].includes(event.status)
        ? { automaticResult: { ...s.event, ...event } }
        : {}),
      unread: true,
    })),
  close: () => set({ open: false }),
}));
export function DiagnosisPopup() {
  const event = useDiagnosis((state) => state.automaticResult);
  const close = useDiagnosis((state) => state.dismissAutomatic);
  if (!event) return null;
  return (
    <Modal
      title={
        event.error ? "游戏异常退出 · 分析未完成" : "游戏异常退出 · AI 分析结果"
      }
      onClose={close}
      footer={
        <Button primary onClick={close}>
          知道了
        </Button>
      }
    >
      <DiagnosisResult event={event} />
    </Modal>
  );
}

export function DiagnosisResult({ event }) {
  return (
    <div aria-live="polite">
      <p>{event.reason}</p>
      {event.status === "analyzing" ? (
        <p role="status">正在使用所选模型分析本次启动日志…</p>
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
            <FormattedAnswer text={event.report || ""} />
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
export { ModelSettings as DeepSeekSettings } from "../assistant/ModelSettings";
