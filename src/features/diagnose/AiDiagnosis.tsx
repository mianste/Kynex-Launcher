import { create } from "zustand";
import { FormattedAnswer } from "../assistant/FormattedAnswer";
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
  unread: boolean;
  markRead: () => void;
  receive: (event: DiagnosisEvent) => void;
  close: () => void;
}>((set) => ({
  event: null,
  open: false,
  unread: false,
  markRead: () => set({unread:false}),
  receive: (event) =>
    set((s) => ({
      event: {
        ...s.event,
        ...event,
        error: event.error,
        report: event.status === "analyzing" ? undefined : event.report,
      },
      open: true,
      unread: true,
    })),
  close: () => set({ open: false }),
}));
export function DiagnosisResult({ event }: { event: DiagnosisEvent }) {
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
            <FormattedAnswer text={event.report || ""}/>
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
