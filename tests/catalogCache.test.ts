import { describe, expect, it } from "vitest";
import {
  CatalogCache,
  appendCatalog,
} from "../src/features/download/catalogCache";
import type { Project } from "../src/lib/types";

describe("resource catalog reuse", () => {
  it("shares an in-flight request and reuses its completed result", async () => {
    let calls = 0,
      finish!: (v: { hits: Project[] }) => void;
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
  it("appends a late source without moving rows or switching duplicate install identities", () => {
    const project = (
      slug: string,
      downloads: number,
      source: "modrinth" | "curseforge",
    ): Project => ({
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
