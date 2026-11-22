import { describe, expect, it, vi } from "vitest";
import {
  CatalogCache,
  appendCatalog,
} from "../src/features/download/catalogCache";
import { collectCatalogSources } from "../src/features/download/resourcePages";
describe("resource catalog reuse", () => {
  it("shares an in-flight request and reuses its completed result", async () => {
    let calls = 0,
      finish;
    const cache = new CatalogCache(() => {
      calls++;
      return new Promise((resolve) => (finish = resolve));
    });
    const a = cache.get({ query: "a", page: 0 }),
      b = cache.get({ page: 0, query: "a" });
    expect(calls).toBe(1);
    finish({ hits: [] });
    await Promise.all([a, b]);
    await cache.get({ query: "a", page: 0 });
    expect(calls).toBe(1);
  });
  it("isolates filters, expires cached data and supports explicit refresh", async () => {
    let calls = 0,
      now = 0;
    const cache = new CatalogCache(
      async () => {
        calls++;
        return { hits: [] };
      },
      () => now,
    );
    await cache.get({ source: "modrinth", page: 0 });
    await cache.get({ source: "curseforge", page: 0 });
    await cache.get({ source: "modrinth", page: 1 });
    expect(calls).toBe(3);
    await cache.get({ source: "modrinth", page: 0 }, true);
    expect(calls).toBe(4);
    now = 300001;
    await cache.get({ source: "modrinth", page: 0 });
    expect(calls).toBe(5);
  });
  it("retries failed requests without retaining a rejected promise", async () => {
    let calls = 0;
    const cache = new CatalogCache(async () => {
      if (++calls === 1) throw Error("offline");
      return { hits: [] };
    });
    await expect(cache.get({ query: "a" })).rejects.toThrow("offline");
    await expect(cache.get({ query: "a" })).resolves.toEqual({ hits: [] });
  });
  it("keeps the published page readable while an explicit refresh runs or fails", async () => {
    let calls = 0;
    const cache = new CatalogCache(
      async () => {
        if (++calls === 1) return { hits: ["original"] };
        throw Error("offline");
      },
      Date.now,
      Infinity,
    );
    const input = { query: "a" };
    await cache.get(input);
    const refresh = cache.get(input, true);
    expect(cache.peek(input)).toEqual({ hits: ["original"] });
    await expect(refresh).rejects.toThrow("offline");
    expect(cache.peek(input)).toEqual({ hits: ["original"] });
  });
  it("publishes a populated source after the brief wait and leaves it stable", async () => {
    vi.useFakeTimers();
    try {
      let finishSlow;
      const early = { hits: ["fast"] };
      const late = new Promise((resolve) => {
        finishSlow = resolve;
      });
      const page = collectCatalogSources([Promise.resolve(early), late], false);
      await vi.advanceTimersByTimeAsync(500);
      const shown = await page;
      finishSlow({ hits: ["slow"] });
      await late;
      expect(shown).toEqual([{ index: 0, value: early }]);
    } finally {
      vi.useRealTimers();
    }
  });
  it("waits for a slower source if the first source is empty or on manual refresh", async () => {
    vi.useFakeTimers();
    try {
      for (const force of [false, true]) {
        let finishSlow;
        const late = new Promise((resolve) => {
          finishSlow = resolve;
        });
        const fast = { hits: force ? ["fast"] : [] };
        const shown = vi.fn();
        const page = collectCatalogSources(
          [Promise.resolve(fast), late],
          force,
        ).then(shown);
        await vi.advanceTimersByTimeAsync(1000);
        expect(shown).not.toHaveBeenCalled();
        const slow = { hits: ["slow"] };
        finishSlow(slow);
        await page;
        expect(shown).toHaveBeenCalledWith([
          { index: 0, value: fast },
          { index: 1, value: slow },
        ]);
      }
    } finally {
      vi.useRealTimers();
    }
  });
  it("appends a late source without moving rows or switching duplicate install identities", () => {
    const project = (slug, downloads, source) => ({
      slug,
      title: slug,
      downloads,
      source,
      project_id: source + slug,
      description: "",
      project_type: "mod",
    });
    const early = project("jade", 10, "modrinth"),
      late = project("new", 999, "curseforge");
    const merged = appendCatalog(
      [early],
      [project("jade", 9999, "curseforge"), late],
    );
    expect(merged).toEqual([early, late]);
    expect(merged[0]).toBe(early);
  });
});
