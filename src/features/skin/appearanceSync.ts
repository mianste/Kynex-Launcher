import { api } from "../../lib/bridge";
import type { Account } from "../../lib/types";
import { useStore } from "../../store";

const pending = new Map<string, Promise<Account>>();
const syncedAt = new Map<string, number>();
export function markAppearanceFresh(id: string) { syncedAt.set(id, Date.now()); }
export function syncAppearance(id: string, force = false): Promise<Account> {
  const current = useStore.getState().accounts.find((a) => a.id === id);
  if (!force && current && Date.now() - (syncedAt.get(id) || 0) < 60_000) return Promise.resolve(current);
  const running = pending.get(id);
  if (running) return running;
  const request = api<Account>("sync_appearance", { accountId: id }).then((value) => {
    markAppearanceFresh(id);
    return value;
  }).finally(() => pending.delete(id));
  pending.set(id, request);
  return request;
}
