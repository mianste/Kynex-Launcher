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
export class CatalogCache<T = CatalogPage> {
  private ready = new Map<string, { until: number; value: T }>();
  private pending = new Map<string, Promise<T>>();
  constructor(
    private fetch: (payload: Payload) => Promise<T>,
    private now = Date.now,
  ) {}
  private key(payload: Payload) {
    return JSON.stringify(
      Object.fromEntries(
        Object.keys(payload)
          .sort()
          .map((k) => [k, payload[k]]),
      ),
    );
  }
  peek(payload: Payload): T | undefined {
    const cached = this.ready.get(this.key(payload));
    return cached && cached.until > this.now() ? cached.value : undefined;
  }
  get(payload: Payload, force = false): Promise<T> {
    const key = this.key(payload);
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
        if (!(value && typeof value === "object" && "warning" in value && value.warning)) {
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
export function appendCatalog<T extends Project>(existing: T[], incoming: T[]): T[] {
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
