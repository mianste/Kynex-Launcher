import { describe, expect, it } from "vitest";
import { resourceInstallKey, hasResourceInstall } from "../src/lib/resourceInstallState";
import type { Project, Task } from "../src/lib/types";
const project: Project = { project_id: "same", slug: "same", title: "示例", description: "", downloads: 1, project_type: "mod", source: "modrinth" };
const task: Task = { action: "install_project", payload: { project: "same", source: "modrinth", kind: "mods", id: "one" }, stage: "下载", done: 0, total: 1 };
describe("资源安装按钮的独立状态", () => {
  it("只锁定同来源、资源类型、项目和目标的安装按钮", () => {
    expect(hasResourceInstall({ a: task }, project, "mods", "one")).toBe(true);
    expect(hasResourceInstall({ a: task }, { ...project, project_id: "other" }, "mods", "one")).toBe(false);
    expect(hasResourceInstall({ a: task }, { ...project, source: "curseforge" }, "mods", "one")).toBe(false);
    expect(hasResourceInstall({ a: task }, project, "resourcepacks", "one")).toBe(false);
    expect(hasResourceInstall({ a: task }, project, "mods", "two")).toBe(false);
  });
  it("成功、失败和取消结束后均可再次安装", () => {
    for (const end of [{ finished: true }, { error: "下载失败" }, { finished: true, error: "任务已取消" }]) {
      expect(hasResourceInstall({ a: { ...task, ...end } }, project, "mods", "one")).toBe(false);
    }
  });
  it("整合包不绑定已选实例，其他类型的目标和来源不会混用", () => {
    expect(resourceInstallKey(project, "modpacks", "one")).toBe(resourceInstallKey(project, "modpacks", "two"));
    expect(resourceInstallKey(project, "mods", "one")).not.toBe(resourceInstallKey(project, "mods", "two"));
    expect(resourceInstallKey(project, "mods", "one")).not.toBe(resourceInstallKey({ ...project, source: "curseforge" }, "mods", "one"));
  });
});
