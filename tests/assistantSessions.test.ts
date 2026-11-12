import { describe, it, expect } from "vitest";
import { SESSION_KEY, createSession, saveSession, loadSessions, loadSession, renameSession, deleteSession, clearSessions, autoTitle, exportMarkdown, type StorageLike, type Message } from "../src/features/assistant/sessionStore";
function memory(): StorageLike {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
}
describe("assistant session history", () => {
  it("creates, loads, switches and automatically names sessions", () => {
    const store = memory(); const a = createSession(store, 1); const b = createSession(store, 2);
    saveSession({ ...a, updatedAt: 3, messages: [{ role: "user", content: "如何安装\nFabric？" }] }, store);
    expect(loadSessions(store)[0].id).toBe(a.id);
    expect(loadSession(a.id, store)?.title).toBe("如何安装 Fabric？");
    expect(loadSession(b.id, store)?.messages).toEqual([]);
    expect(autoTitle([{ role: "user", content: "中".repeat(30) }])).toBe("中".repeat(24));
    expect(autoTitle([])).toBe("新对话");
  });
  it("renames and deletes without changing other sessions", () => {
    const store = memory(); const a = createSession(store); const b = createSession(store);
    renameSession(a.id, "整合包方案", store);
    expect(loadSession(a.id, store)?.title).toBe("整合包方案");
    deleteSession(a.id, store);
    expect(loadSession(a.id, store)).toBeUndefined(); expect(loadSession(b.id, store)).toBeDefined();
    clearSessions(store); expect(loadSessions(store)).toEqual([]);
  });
  it("keeps 30 recent sessions and the latest 200 messages", () => {
    const store = memory(); const oldest = createSession(store, 0);
    for (let i = 1; i <= 35; i++) createSession(store, i);
    expect(loadSessions(store)).toHaveLength(30); expect(loadSession(oldest.id, store)).toBeUndefined();
    const current = loadSessions(store)[0];
    saveSession({ ...current, messages: Array.from({ length: 205 }, (_, n) => ({ role: "user", content: `${n}` })) }, store);
    const messages = loadSession(current.id, store)!.messages;
    expect(messages).toHaveLength(200); expect(messages[0].content).toBe("5"); expect(messages[199].content).toBe("204");
  });
  it("never serializes attachments, full paths, secrets or pasted log bodies", () => {
    const store = memory(); const session = createSession(store);
    const messages: Message[] = [
      { role: "user", content: "分析\n[12:00:00] ERROR SECRET_LOG_BODY", createdAt: 1 },
      { role: "assistant", content: "sk-hidden-secret\na@example.com\nC:\\Users\\Alice\\game\\logs\\latest.log\n/home/alice/game/latest.log", createdAt: 2, status: "streaming", requestId: "inflight", usage: { total_tokens: 10 }, model: "test" },
    ];
    saveSession({ ...session, messages, attachments: [{ text: "NEVER_STORE_RAW_LOG" }] } as typeof session, store);
    const raw = store.getItem(SESSION_KEY)!;
    for (const secret of ["sk-hidden-secret", "a@example.com", "Alice", "/home/alice", "SECRET_LOG_BODY", "NEVER_STORE_RAW_LOG", "inflight"]) expect(raw).not.toContain(secret);
    expect(loadSession(session.id, store)!.messages[1].status).toBe("cancelled");
  });
  it("exports roles, timestamps, answers, recommendations and search terms", () => {
    const store = memory(); const session = createSession(store, 1);
    const markdown = exportMarkdown({ ...session, title: "冒险方案", messages: [{ role: "user", content: "推荐模组", createdAt: 1 }, { role: "assistant", content: "建议分批安装", createdAt: 2, searches: ["Sodium"], recommendations: [{ name: "Sodium", query: "Sodium", category: "优化", reason: "改善性能" }] }] });
    for (const value of ["# 冒险方案", "## 用户", "## AI 助手", "创建时间", "建议分批安装", "改善性能", "搜索词：Sodium"]) expect(markdown).toContain(value);
  });
  it("handles corrupt storage and reports storage quota failures", () => {
    const store = memory(); store.setItem(SESSION_KEY, "invalid"); expect(loadSessions(store)).toEqual([]);
    const broken: StorageLike = { ...store, setItem() { throw Error("quota"); } };
    expect(() => createSession(broken)).toThrow("历史保存失败");
  });
});
