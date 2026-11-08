import { describe, expect, it } from "vitest";
import { parseInstallTarget } from "./installTarget";

describe("安装窗口入参", () => {
  it("只给版本时使用默认值", () => {
    expect(parseInstallTarget()).toEqual({ version: "1.20.1", preset: undefined });
    expect(parseInstallTarget("1.21.4")).toEqual({
      version: "1.21.4",
      preset: undefined,
    });
  });

  it("带加载器时解析出预选值", () => {
    expect(parseInstallTarget("1.20.1|forge")).toEqual({
      version: "1.20.1",
      preset: "forge",
    });
    expect(parseInstallTarget("1.20.1|optifine")).toEqual({
      version: "1.20.1",
      preset: "optifine",
    });
  });

  it("空版本或空加载器不会产生空字符串", () => {
    expect(parseInstallTarget("|fabric")).toEqual({
      version: "1.20.1",
      preset: "fabric",
    });
    expect(parseInstallTarget("1.20.1|")).toEqual({
      version: "1.20.1",
      preset: undefined,
    });
  });
});
