import { api } from "../../lib/bridge";
import { useStore } from "../../store";
const pending = new Map();
const syncedAt = new Map();
export function markAppearanceFresh(id) {
  syncedAt.set(id, Date.now());
}
export function syncAppearance(id, force = false) {
  const current = useStore.getState().accounts.find((a) => a.id === id);
  if (!force && current && Date.now() - (syncedAt.get(id) || 0) < 60_000)
    return Promise.resolve(current);
  const running = pending.get(id);
  if (running) return running;
  const request = api("sync_appearance", { accountId: id })
    .then((value) => {
      markAppearanceFresh(id);
      return value;
    })
    .finally(() => pending.delete(id));
  pending.set(id, request);
  return request;
}
