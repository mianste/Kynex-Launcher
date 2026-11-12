import { useCallback, useEffect, useState } from "react";
import { api, desktop } from "../../lib/bridge";
import { Button } from "../../components/ui";
import { useStore } from "../../store";
export type Insight = {
  key: string;
  kind: string;
  title: string;
  message: string;
  instanceId?: string;
  seen?: boolean;
};
export function unreadInsights(items: Insight[]) {
  return items.some((item) => !item.seen);
}
export function useInsights(
  ready: boolean,
  open: boolean,
  directoryId: string,
) {
  const [items, Items] = useState<Insight[]>([]),
    [error, E] = useState("");
  const load = useCallback(
    async (check = false) => {
      try {
        const rows = await api<Insight[]>("agent_tool", {
          tool: check ? "insights_check" : "insights_list",
          directoryId,
          requestId: crypto.randomUUID(),
          args: { markRead: open },
        });
        if (Array.isArray(rows)) Items(rows);
        if (check && open) {
          const read = await api<Insight[]>("agent_tool", {
            tool: "insights_list",
            directoryId,
            args: { markRead: true },
          });
          if (Array.isArray(read)) Items(read);
        }
        E("");
      } catch {
        E("提醒检查暂未完成，可稍后重试。");
      }
    },
    [directoryId, open],
  );
  useEffect(() => {
    if (!ready || !desktop) return;
    void load();
    const check = () => void load(true);
    const startup = setTimeout(check, 2000),
      timer = setInterval(check, 6 * 3600000);
    return () => {
      clearTimeout(startup);
      clearInterval(timer);
    };
  }, [ready, directoryId]);
  useEffect(() => {
    if (ready && desktop) void load();
  }, [open, load, ready]);
  useEffect(() => {
    if (open && items.some((item) => !item.seen)) void load();
  }, [open, items, load]);
  async function dismiss(key: string, forever: boolean) {
    try {
      await api("agent_tool", {
        tool: "insights_dismiss",
        directoryId,
        confirmed: true,
        args: { key, forever },
      });
      await load();
    } catch {
      E("忽略提醒失败，请重试。");
    }
  }
  return {
    items,
    error,
    unread: unreadInsights(items),
    dismiss,
    refresh: () => load(true),
  };
}
export function InsightPanel({
  items,
  error,
  dismiss,
  refresh,
}: {
  items: Insight[];
  error: string;
  dismiss: (key: string, forever: boolean) => Promise<void>;
  refresh: () => Promise<void>;
}) {
  const s = useStore();
  return (
    <details className="agent-insights">
      <summary>实例提醒（{items.length}）</summary>
      <p>只提示，不会自动修改实例。结果仅保存在本机。</p>
      <Button type="button" onClick={() => void refresh()}>
        检查提醒
      </Button>
      {error && <p role="status">{error}</p>}
      {items.map((item) => (
        <article key={item.key}>
          <b>{item.title}</b>
          <p>{item.message}</p>
          <div className="agent-actions">
            {item.instanceId && (
              <Button
                type="button"
                onClick={() => {
                  useStore.setState({ selected: item.instanceId! });
                  s.setPage("library");
                }}
              >
                查看实例
              </Button>
            )}
            <Button type="button" onClick={() => void dismiss(item.key, false)}>
              忽略 7 天
            </Button>
            <Button type="button" onClick={() => void dismiss(item.key, true)}>
              永久忽略
            </Button>
          </div>
        </article>
      ))}
    </details>
  );
}
