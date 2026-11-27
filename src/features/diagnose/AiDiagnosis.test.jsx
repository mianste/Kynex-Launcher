import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../store", () => ({ useStore: vi.fn(), guarded: vi.fn() }));
import { useDiagnosis } from "./AiDiagnosis";

describe("自动分析结果弹窗", () => {
  beforeEach(() =>
    useDiagnosis.setState({
      event: null,
      automaticResult: null,
      open: false,
      unread: false,
    }),
  );
  it("分析中不打开聊天，完成后展示完整结果并保留退出原因", () => {
    useDiagnosis
      .getState()
      .receive({
        autoDiagnosis: true,
        status: "analyzing",
        reason: "测试实例退出",
      });
    expect(useDiagnosis.getState().open).toBe(false);
    expect(useDiagnosis.getState().automaticResult).toBe(null);
    useDiagnosis
      .getState()
      .receive({
        autoDiagnosis: true,
        status: "done",
        report: "原因与处理建议",
      });
    expect(useDiagnosis.getState().automaticResult).toMatchObject({
      reason: "测试实例退出",
      report: "原因与处理建议",
    });
    useDiagnosis.getState().dismissAutomatic();
    expect(useDiagnosis.getState().automaticResult).toBe(null);
  });
  it("失败也可弹窗，手动分析继续走原来的聊天入口", () => {
    useDiagnosis
      .getState()
      .receive({ autoDiagnosis: true, status: "error", error: "连接失败" });
    expect(useDiagnosis.getState().automaticResult.error).toBe("连接失败");
    useDiagnosis
      .getState()
      .receive({ status: "analyzing", reason: "手动日志" });
    expect(useDiagnosis.getState().open).toBe(true);
    expect(useDiagnosis.getState().event.autoDiagnosis).toBe(false);
  });
});
