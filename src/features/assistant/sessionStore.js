export const SESSION_KEY = "kynex-assistant-sessions-v1";
const storage = () => globalThis.localStorage;
export function privateText(text) {
  return text
    .replace(/(?:Bearer\s+)[A-Za-z0-9._-]+/gi, "[密钥已隐藏]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[密钥已隐藏]")
    .replace(
      /(?:access[_-]?token|refresh[_-]?token|authorization|password|api[ _-]?key|--accessToken)[\s"':=]+[^\s",;}]+/gi,
      "[凭据已隐藏]",
    )
    .replace(/[A-Za-z]:[\\/][^\r\n"<>|]*/g, "[路径已隐藏]")
    .replace(/\\\\[^\r\n"<>|]*/g, "[路径已隐藏]")
    .replace(
      /\/(?:home|Users|tmp|var|mnt|Volumes|opt|srv|media|root|storage)\/[^\r\n"<>]*/g,
      "[路径已隐藏]",
    )
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[邮箱已隐藏]");
}
export function autoTitle(messages) {
  const user = messages.find((m) => m.role === "user");
  const first = user ? cleanMessage(user).content : "";
  return (
    Array.from(
      privateText(first)
        .replace(/[\r\n]+/g, " ")
        .trim(),
    )
      .slice(0, 24)
      .join("") || "新对话"
  );
}
function cleanMessage(raw) {
  const log =
    raw.role === "user" &&
    /(?:^|\n)\s*(?:at\s+[\w.$]+\(|\[\d{2}:\d{2}:\d{2}\]|Caused by:|\d{4}-\d\d-\d\d[^\n]*(?:ERROR|WARN))/m.test(
      raw.content,
    );
  const message = {
    role: raw.role,
    content: log
      ? "[日志内容仅用于当前分析，未写入历史]"
      : privateText(raw.content).slice(0, 60000),
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
  };
  if (raw.searches)
    message.searches = raw.searches
      .filter((s) => typeof s === "string")
      .slice(0, 3)
      .map(privateText);
  if (raw.recommendations)
    message.recommendations = raw.recommendations
      .slice(0, 12)
      .map((r) => ({
        name: privateText(r.name || ""),
        query: privateText(r.query || ""),
        category: privateText(r.category || ""),
        reason: privateText(r.reason || ""),
      }));
  if (raw.status)
    message.status = raw.status === "streaming" ? "cancelled" : raw.status;
  if (raw.error) message.error = privateText(raw.error);
  if (raw.model) message.model = privateText(raw.model);
  if (typeof raw.elapsedMs === "number" && raw.elapsedMs >= 0)
    message.elapsedMs = raw.elapsedMs;
  if (raw.usage) {
    message.usage = {};
    for (const key of ["prompt_tokens", "completion_tokens", "total_tokens"]) {
      const n = raw.usage[key];
      if (typeof n === "number" && Number.isSafeInteger(n) && n >= 0)
        message.usage[key] = n;
    }
  }
  return message;
}
function cleanSession(raw) {
  return {
    id: raw.id,
    title: privateText(raw.title || autoTitle(raw.messages)).slice(0, 80),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    messages: raw.messages.slice(-200).map(cleanMessage),
  };
}
export function loadSessions(store = storage()) {
  try {
    const data = JSON.parse(store.getItem(SESSION_KEY) || "[]");
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (s) =>
          !!s &&
          typeof s.id === "string" &&
          typeof s.title === "string" &&
          Number.isFinite(s.createdAt) &&
          Number.isFinite(s.updatedAt) &&
          Array.isArray(s.messages),
      )
      .map((s) =>
        cleanSession({
          ...s,
          messages: s.messages.filter(
            (m) =>
              m &&
              ["user", "assistant"].includes(m.role) &&
              typeof m.content === "string",
          ),
        }),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt)
      .slice(0, 30);
  } catch {
    return [];
  }
}
function write(sessions, store) {
  try {
    store.setItem(SESSION_KEY, JSON.stringify(sessions.slice(0, 30)));
  } catch {
    throw new Error(
      "历史保存失败，本地存储可能已满。请导出重要会话后清理历史。",
    );
  }
}
export function newSession(now = Date.now()) {
  return {
    id: crypto.randomUUID(),
    title: "新对话",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}
export function saveSession(session, store = storage()) {
  const clean = cleanSession({
    ...session,
    title:
      session.title === "新对话" ? autoTitle(session.messages) : session.title,
    messages: session.messages.slice(-200),
  });
  const sessions = [
    clean,
    ...loadSessions(store).filter((s) => s.id !== clean.id),
  ].sort((a, b) => b.updatedAt - a.updatedAt);
  write(sessions, store);
  return clean;
}
export function createSession(store = storage(), now = Date.now()) {
  return saveSession(newSession(now), store);
}
export function loadSession(id, store = storage()) {
  return loadSessions(store).find((s) => s.id === id);
}
export function renameSession(id, title, store = storage()) {
  const session = loadSession(id, store);
  if (!session) return;
  saveSession(
    {
      ...session,
      title: privateText(title.trim()).slice(0, 80) || "新对话",
      updatedAt: Date.now(),
    },
    store,
  );
}
export function deleteSession(id, store = storage()) {
  write(
    loadSessions(store).filter((s) => s.id !== id),
    store,
  );
}
export function clearSessions(store = storage()) {
  store.removeItem(SESSION_KEY);
}
export function exportMarkdown(session) {
  const clean = cleanSession(session);
  const time = (n) => new Date(n).toLocaleString("zh-CN", { hour12: false });
  return (
    [
      `# ${clean.title}`,
      `创建时间：${time(clean.createdAt)}`,
      ...clean.messages.map((m) =>
        [
          `## ${m.role === "user" ? "用户" : "AI 助手"} · ${time(m.createdAt || clean.createdAt)}`,
          m.content,
          m.status === "cancelled" ? "（已停止生成）" : "",
          ...(m.recommendations || []).map(
            (r) =>
              `- **${r.name}**（${r.category}）：${r.reason}\n  检索词：${r.query}`,
          ),
          m.searches?.length ? `搜索词：${m.searches.join("、")}` : "",
          m.model ? `模型：${m.model}` : "",
          m.elapsedMs !== undefined
            ? `耗时：${(m.elapsedMs / 1000).toFixed(1)}s`
            : "",
          m.usage
            ? m.usage.total_tokens !== undefined
              ? `Token：${m.usage.total_tokens}`
              : `输入 Token：${m.usage.prompt_tokens ?? "—"}；输出 Token：${m.usage.completion_tokens ?? "—"}`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      ),
    ].join("\n\n") + "\n"
  );
}
