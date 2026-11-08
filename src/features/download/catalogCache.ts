import { api } from "../../lib/bridge";
import type { Project } from "../../lib/types";

export type CatalogPage = {
  hits: Project[];
  total?: number;
  warning?: string;
  pageSize?: number;
};
type Payload = Record<string, unknown>;

// Kept only in this app process. Shared by page remounts and concurrent callers.
export class CatalogCache {
  private ready = new Map<string, { until: number; value: CatalogPage }>();
  private pending = new Map<string, Promise<CatalogPage>>();
  constructor(
    private fetch: (payload: Payload) => Promise<CatalogPage>,
    private now = Date.now,
  ) {}
  get(payload: Payload, force = false): Promise<CatalogPage> {
    const key = JSON.stringify(
      Object.fromEntries(
        Object.keys(payload)
          .sort()
          .map((k) => [k, payload[k]]),
      ),
    );
    const inflight = this.pending.get(key);
    if (inflight) return inflight;
    const cached = this.ready.get(key);
    if (!force && cached && cached.until > this.now()) {
      this.ready.delete(key);
      this.ready.set(key, cached);
      return Promise.resolve(cached.value);
    }
    this.ready.delete(key);
    const request = this.fetch(
      force ? { ...payload, force: true } : payload,
    ).then(
      (value) => {
        this.pending.delete(key);
        if (!value.warning) {
          this.ready.set(key, { value, until: this.now() + 5 * 60_000 });
          while (this.ready.size > 80)
            this.ready.delete(this.ready.keys().next().value!);
        }
        return value;
      },
      (error) => {
        this.pending.delete(key);
        throw error;
      },
    );
    this.pending.set(key, request);
    return request;
  }
}
export const catalogCache = new CatalogCache((payload) =>
  api<CatalogPage>("search", payload),
);

const identity = (p: Project) =>
  (p.slug || p.title).toLocaleLowerCase().replace(/[\s_-]/g, "");
export function appendCatalog(
  existing: Project[],
  incoming: Project[],
): Project[] {
  const seen = new Set(existing.map(identity));
  const appended = incoming
    .slice()
    .sort(
      (a, b) => b.downloads - a.downloads || a.title.localeCompare(b.title),
    );
  const result = existing.slice();
  for (const project of appended) {
    const key = identity(project);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(project);
    }
  }
  return result;
}
