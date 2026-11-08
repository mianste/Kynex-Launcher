import { describe, expect, it } from "vitest";
import {
  expandResourceQuery,
  localizeProject,
  loadModNames,
  localModName,
} from "../src/features/download/modLocalization";

describe("模组中文搜索与显示", () => {
  it("把常见中文名转换为英文项目查询", () => {
    expect(expandResourceQuery("钠")).toBe("Sodium");
    expect(expandResourceQuery("玉")).toBe("Jade");
    expect(expandResourceQuery("锂")).toBe("Lithium");
    expect(expandResourceQuery("铟")).toBe("Indium");
    expect(expandResourceQuery("暮色森林")).toBe("Twilight Forest");
  });

  it("支持中文类型关键词并保留英文搜索", () => {
    expect(expandResourceQuery("性能优化")).toBe("performance optimization");
    expect(expandResourceQuery("Sodium")).toBe("Sodium");
  });

  it("常见模组显示中文名并保留英文原名", () => {
    const localized = localizeProject({
      project_id: "AANobbMI",
      slug: "sodium",
      title: "Sodium",
      description: "A modern rendering engine.",
      downloads: 1,
      project_type: "mod",
      source: "modrinth",
    });
    expect(localized.name).toBe("钠");
    expect(localized.originalName).toBe("Sodium");
    expect(localized.tags).toContain("性能优化");
  });
});

it("完整中文名索引使用平台精确对应，不把相似名字误认成原模组", async () => {
  await loadModNames();
  const p = {
    project_id: "x",
    slug: "mekanism",
    title: "Mekanism",
    description: "",
    downloads: 0,
    project_type: "mod",
    source: "curseforge" as const,
  };
  expect(localizeProject(p).name).toMatch(/[\u3400-\u9fff]/);
  expect(localizeProject(p).originalName).toBe("Mekanism");
  expect(
    localizeProject({ ...p, slug: "unknown-project", title: "Unknown project" })
      .name,
  ).toBe("Unknown project");
  expect(localModName(["mekanism"])).toMatch(/[\u3400-\u9fff]/);
  expect(expandResourceQuery(localizeProject(p).name)).toBe("Mekanism");
});
