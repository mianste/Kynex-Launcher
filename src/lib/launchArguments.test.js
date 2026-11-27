import { describe, it, expect } from "vitest";
import { parseLaunchArguments, argumentError, toggleArgumentPreset } from "./launchArguments";

describe("启动参数编辑", () => {
  it("切换预设后保留空格、引号、换行和 Windows 路径的含义", () => {
    const raw = `-Ddir='C:\\Game Folder\\'\n-Dquote=\"a'b\" -Duser='{user}'`;
    const added = toggleArgumentPreset(raw, "-XX:+UseG1GC");
    expect(parseLaunchArguments(added)).toEqual([...parseLaunchArguments(raw), "-XX:+UseG1GC"]);
    expect(parseLaunchArguments(toggleArgumentPreset(added, "-XX:+UseG1GC"))).toEqual(parseLaunchArguments(raw));
  });
  it("校验与桌面一致，不把普通反斜杠当成转义符", () => {
    expect(argumentError('"C:\\Games\\Minecraft"')).toBe("");
    expect(argumentError('"C:\\Games\\Minecraft\\"')).toContain("引号");
    expect(argumentError("x\0")).toContain("无效");
  });
});
