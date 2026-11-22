import { api } from "../../lib/bridge";
// Kept only in this app process. Shared by page remounts and concurrent callers.
export class CatalogCache {
  fetch;
  now;
  lifetime;
  ready = new Map();
  pending = new Map();
  constructor(fetch, now = Date.now, lifetime = 5 * 60_000) {
    this.fetch = fetch;
    this.now = now;
    this.lifetime = lifetime;
  }
  key(payload) {
    return JSON.stringify(
      Object.fromEntries(
        Object.keys(payload)
          .sort()
          .map((k) => [k, payload[k]]),
      ),
    );
  }
  peek(payload) {
    const cached = this.ready.get(this.key(payload));
    return cached && cached.until > this.now() ? cached.value : undefined;
  }
  get(payload, force = false) {
    const key = this.key(payload);
    const inflight = this.pending.get(key);
    if (inflight) return inflight;
    const cached = this.ready.get(key);
    if (!force && cached && cached.until > this.now()) {
      this.ready.delete(key);
      this.ready.set(key, cached);
      return Promise.resolve(cached.value);
    }
    const request = this.fetch(
      force ? { ...payload, force: true } : payload,
    ).then(
      (value) => {
        this.pending.delete(key);
        if (!(
          value &&
          typeof value === "object" &&
          "warning" in value &&
          value.warning
        )) {
          this.ready.delete(key);
          this.ready.set(key, { value, until: this.now() + this.lifetime });
          while (this.ready.size > 80)
            this.ready.delete(this.ready.keys().next().value);
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
  api("search", payload),
);
const identity = (p) =>
  (p.slug || p.title).toLocaleLowerCase().replace(/[\s_-]/g, "");
export function appendCatalog(existing, incoming) {
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
