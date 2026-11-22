import { describe, it, expect } from "vitest";
import { diagnose } from "../src/features/diagnose/logRules";
describe("日志诊断", () => {
  it("OOM 优先于通用退出码", () =>
    expect(
      diagnose("java.lang.OutOfMemoryError: Java heap space\nexit code -1").map(
        (x) => x.id,
      ),
    ).toEqual(["oom"]));
  it("Java 兼容性", () =>
    expect(
      diagnose("UnsupportedClassVersionError: class file version 65.0")[0].id,
    ).toBe("java"));
  it("缺少依赖", () =>
    expect(diagnose("Missing mod dependency fabric-api")[0].id).toBe(
      "dependency",
    ));
  it("正常日志不虚构问题", () =>
    expect(diagnose("[main/INFO] All loaded")).toEqual([]));
  it("GL 及准确行号", () => {
    const a = diagnose("hello\nGLFW error 65542");
    expect(a[0].id).toBe("gl");
    expect(a[0].lines[0].number).toBe(2);
  });
  it("Mixin", () =>
    expect(diagnose("MixinApplyError: crash")[0].id).toBe("mixin"));
  it("重复模组", () =>
    expect(diagnose("DuplicateModsFoundException")[0].id).toBe("duplicate"));
  it("方法不匹配", () =>
    expect(diagnose("java.lang.NoSuchMethodError")[0].id).toBe("method"));
  it("只有退出码时仅列线索", () =>
    expect(diagnose("exit code -1")[0].severity).toBe("warn"));
});
