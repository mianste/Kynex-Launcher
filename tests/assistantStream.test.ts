import { describe, it, expect } from "vitest";
import { streamReducer } from "../src/features/assistant/streamReducer";
import type { Message } from "../src/features/assistant/sessionStore";
const initial = (): Message[] => [{ role: "user", content: "如何安装？" }, { role: "assistant", content: "", status: "streaming", requestId: "a" }];
describe("assistant stream reducer", () => {
  it("appends chunks to the matching request without mutating prior state", () => {
    const before = initial(); const after = streamReducer(before, { requestId: "a", delta: "检查 Java" });
    expect(before[1].content).toBe(""); expect(after[1].content).toBe("检查 Java");
    expect(streamReducer(after, { requestId: "b", delta: "wrong session" })).toEqual(after);
  });
  it("uses the final redacted answer, model, usage and time", () => {
    const partial = streamReducer(initial(), { requestId: "a", delta: "部分内容" });
    const result = streamReducer(partial, { requestId: "a", done: true, reply: "脱敏后的最终回复", usage: { total_tokens: 20 }, elapsedMs: 1200, model: "local" });
    expect(result[1]).toMatchObject({ content: "脱敏后的最终回复", status: "done", usage: { total_tokens: 20 }, elapsedMs: 1200, model: "local" });
  });
  it("keeps partial text on stop and ignores late delta/completion events", () => {
    const partial = streamReducer(initial(), { requestId: "a", delta: "已生成内容" });
    const stopped = streamReducer(partial, { requestId: "a", cancelled: true });
    expect(stopped[1]).toMatchObject({ content: "已生成内容", status: "cancelled" });
    expect(streamReducer(stopped, { requestId: "a", delta: "late" })).toEqual(stopped);
    expect(streamReducer(stopped, { requestId: "a", done: true, reply: "late" })).toEqual(stopped);
  });
  it("keeps partial text and marks a retriable error", () => {
    const partial = streamReducer(initial(), { requestId: "a", delta: "已生成内容" });
    expect(streamReducer(partial, { requestId: "a", error: "连接中断" })[1]).toMatchObject({ content: "已生成内容", status: "error", error: "连接中断" });
  });
});
