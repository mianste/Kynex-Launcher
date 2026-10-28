import { useEffect, useRef, useState, useCallback } from "react";
import { api, desktop, external } from "../../lib/bridge";
import { useStore } from "../../store";
import type { Account } from "../../lib/types";
interface Flow {
  flowId: string;
  userCode: string;
  verificationUri: string;
  interval: number;
  expiresIn: number;
}
interface Poll {
  status: "pending" | "success" | "denied" | "expired" | "failed";
  retryAfter?: number;
  message?: string;
  account?: Account;
}
export function useMicrosoftLogin() {
  const [flow, Flow] = useState<Flow | null>(null);
  const [busy, Busy] = useState(false);
  const [error, SetError] = useState("");
  const [message, Message] = useState("");
  const current = useRef<Flow | null>(null);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const mounted = useRef(true);
  const cancel = useCallback(() => {
    generation.current++;
    clearTimeout(timer.current);
    const old = current.current;
    current.current = null;
    if (old && desktop)
      void api("microsoft_cancel", { flowId: old.flowId }).catch(() => {});
    if (mounted.current) {
      Busy(false);
      Flow(null);
      Message("");
    }
  }, []);
  useEffect(
    () => () => {
      mounted.current = false;
      cancel();
    },
    [cancel],
  );
  async function start() {
    cancel();
    const id = ++generation.current;
    Busy(true);
    SetError("");
    Message("正在连接微软登录服务…");
    try {
      const pending = await api<Flow>("microsoft_start", {
        clientId: useStore.getState().settings.clientId,
      });
      if (id !== generation.current || !mounted.current) {
        void api("microsoft_cancel", { flowId: pending.flowId }).catch(
          () => {},
        );
        return;
      }
      current.current = pending;
      Flow(pending);
      let copied = false;
      try {
        await navigator.clipboard.writeText(pending.userCode);
        copied = true;
      } catch {}
      if (id !== generation.current || !mounted.current) return;
      let opened = false;
      try {
        await external(pending.verificationUri);
        opened = true;
      } catch {}
      if (id !== generation.current || !mounted.current) return;
      Message(
        `${copied ? "设备码已复制。" : "自动复制未成功，请点击下方复制设备码。"}${opened ? "请在微软网页粘贴设备码并完成授权，启动器会自动继续。" : "网页未能自动打开，请点击下方重新打开微软网页。"}`,
      );
      let failures = 0;
      const poll = async () => {
        if (id !== generation.current) return;
        try {
          const result = await api<Poll>("microsoft_poll", {
            flowId: pending.flowId,
          });
          if (id !== generation.current || !mounted.current) return;
          failures = 0;
          if (result.status === "pending") {
            timer.current = setTimeout(
              () => void poll(),
              Math.max(1, result.retryAfter ?? pending.interval) * 1000,
            );
            return;
          }
          if (result.status !== "success" || !result.account)
            throw new Error(result.message ?? "微软登录失败");
          current.current = null;
          await useStore.getState().refresh();
          useStore.setState({ accountId: result.account.id });
          useStore.getState().hide();
          useStore.getState().notify("已登录 " + result.account.name);
        } catch (e) {
          if (id !== generation.current || !mounted.current) return;
          if (++failures <= 2 && String(e).includes("网络")) {
            Message("网络暂时中断，正在重试…");
            timer.current = setTimeout(() => void poll(), 10000);
            return;
          }
          cancel();
          SetError(String(e).replace(/^Error: /, ""));
        }
      };
      timer.current = setTimeout(() => void poll(), pending.interval * 1000);
    } catch (e) {
      if (id !== generation.current || !mounted.current) return;
      cancel();
      SetError(String(e).replace(/^Error: /, ""));
    }
  }
  return {
    flow,
    busy,
    error,
    message,
    start,
    cancel,
    copy: async () => {
      if (flow) await navigator.clipboard.writeText(flow.userCode);
    },
    reopen: async () => {
      if (flow) await external(flow.verificationUri);
    },
  };
}
