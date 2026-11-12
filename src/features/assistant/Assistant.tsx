import { useEffect, useRef, useState } from "react";
import { Bot, X, Send, RotateCcw, Copy, Check, History, Square, Download, Trash2, Pencil, Plus } from "lucide-react";
import { Button, Modal } from "../../components/ui";
import { api, desktop, pickFile, saveFile } from "../../lib/bridge";
import { useStore, guarded } from "../../store";
import type { Instance, Project } from "../../lib/types";
import { useDiagnosis } from "../diagnose/AiDiagnosis";
import { catalogCache, appendCatalog } from "../download/catalogCache";
import {
  localizeProject,
  resolveResourceQuery,
} from "../download/modLocalization";
import { ResourceVersionPicker } from "../download/ModManagement";
import "./assistant.css";
import { openAiSettings } from "../../lib/settingsNavigation";
import { FormattedAnswer } from "./FormattedAnswer";
import { useGuideSection } from "../../lib/guideNavigation";
import { RepairSuggestions } from "./RepairSuggestions";
import { useAssistantOcclusion } from "./useAssistantOcclusion";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { type Message, type Session, loadSessions, loadSession, saveSession, newSession, renameSession, deleteSession, clearSessions, exportMarkdown, autoTitle, privateText } from "./sessionStore";
import { streamReducer, type StreamEvent } from "./streamReducer";
import { useAssistantContext } from "./useAssistantContext";
import { openWorkshop, startWorkshop } from "./AgentPanel";
import { isBuildRequest } from "./agentStore";
import {prepareScreenshot,ScreenshotPreviews,ScreenshotButton,VoiceInput,type Screenshot} from "./AssistantMedia";
import {useInsights,InsightPanel} from "./AgentInsights";
export const openAssistant = () =>
  window.dispatchEvent(new Event("kynex-open-assistant"));
export function Assistant({ ready }: { ready: boolean }) {
  const s = useStore();
  const d = useDiagnosis();
  const [open, O] = useState(false);
  const [logBusy, LogBusy] = useState(false);
  const [logSnapshot, LogSnapshot] = useState("");
  useGuideSection("assistant", (section) => {
    O(true);
  });
  const [text, V] = useState("");
  const [images,Images]=useState<Screenshot[]>([]);
  const imagesRef=useRef<Screenshot[]>([]);imagesRef.current=images;
  const mediaEpoch=useRef(0);
  const checkingImages=useRef(false);
  const insights=useInsights(ready,open,s.directoryId);
  function clearImages(){mediaEpoch.current++;imagesRef.current=[];Images([]);}
  async function addImages(files:File[]){const epoch=mediaEpoch.current;try{for(const file of files){if(imagesRef.current.length>=3)throw Error("一次最多添加 3 张截图。");const image=await prepareScreenshot(file);if(epoch!==mediaEpoch.current)return;if(imagesRef.current.length>=3)throw Error("一次最多添加 3 张截图。");imagesRef.current=[...imagesRef.current,image];Images(imagesRef.current);}}catch(e){E(String(e).replace(/^Error: /,""));}}
  useEffect(()=>()=>{mediaEpoch.current++;imagesRef.current=[];},[]);
  useEffect(()=>{if(!open)clearImages();},[open]);
  const [session, Session] = useState<Session>(() => loadSessions()[0] || newSession());
  const [messages, SetMessages] = useState<Message[]>(session.messages);
  function M(value: Message[] | ((previous: Message[]) => Message[])) {
    SetMessages(previous => (typeof value === "function" ? value(previous) : value).slice(-200));
  }
  const [historyItems, HistoryItems] = useState<Session[]>(() => loadSessions());
  const [historyOpen, HistoryOpen] = useState(false);
  const [renameId, RenameId] = useState("");
  const [renameTitle, RenameTitle] = useState("");
  const [pendingDelete, PendingDelete] = useState<string | null>(null);
  const [generationKind, GenerationKind] = useState("general");
  const [copied, Copied] = useState<number | null>(null);
  useEffect(() => Copied(null), [messages]);
  const [busy, B] = useState(false);
  const [error, E] = useState("");
  const [query, Q] = useState("");
  const [rows, R] = useState<Project[]>([]);
  const [searchBusy, SB] = useState(false);
  const [searched, Searched] = useState(false);
  const [picker, P] = useState<{
    project: Project;
    instance?: Instance;
    directoryId: string;
  } | null>(null);
  const [installing, I] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  useAssistantOcclusion(panel, open && ready);
  const serial = useRef(0);
  const instance = s.instances.find((i) => i.id === s.selected);
  const context = useAssistantContext(open, s.directoryId, instance?.id);
  const activeRequest = useRef<string | null>(null);
  const listenerReady = useRef<Promise<UnlistenFn> | null>(null);
  const follow = useRef(true);
  useEffect(()=>{
    if(!desktop||!open||historyOpen)return;
    const drop=(event:Event)=>{
      const {paths,position}=(event as CustomEvent<{paths:string[];position:{x:number;y:number}}>).detail;
      const box=panel.current?.querySelector(".assistant-compose")?.getBoundingClientRect();
      if(!box||!position)return;const x=position.x/window.devicePixelRatio,y=position.y/window.devicePixelRatio;
      if(x<box.left||x>box.right||y<box.top||y>box.bottom||!paths.some(path=>/\.(png|jpe?g|webp)$/i.test(path)))return;
      event.preventDefault();if(busy||logBusy)return;
      const epoch=mediaEpoch.current;
      void (async()=>{try{for(const path of paths.filter(path=>/\.(png|jpe?g|webp)$/i.test(path)).slice(0,3)){const image=await api<{base64:string;mime:string}>("assistant_read_screenshot",{path});if(epoch!==mediaEpoch.current)return;const bytes=Uint8Array.from(atob(image.base64),char=>char.charCodeAt(0));await addImages([new File([bytes],"截图",{type:image.mime})]);}}catch{E("无法读取拖入的截图，请选择 10 MB 以内的 PNG、JPEG 或 WebP 文件。");}})();
    };
    window.addEventListener("kynex-assistant-native-drop",drop);return()=>window.removeEventListener("kynex-assistant-native-drop",drop);
  },[open,historyOpen,busy,logBusy]);
  useEffect(() => {
    if (!desktop) return;
    const listening = listen<StreamEvent>("kynex-ai-stream", ({ payload }) => {
      if (payload.requestId !== activeRequest.current) return;
      M(previous => streamReducer(previous, payload));
      if (payload.done || payload.error) { activeRequest.current = null; B(false); }
    });
    listenerReady.current = listening;
    void listening.catch(() => E("无法订阅模型回复，请重启启动器重试。"));
    return () => {
      if (activeRequest.current) void api("ai_cancel", { requestId: activeRequest.current }).catch(() => {});
      activeRequest.current = null;
      void listening.then(unlisten => unlisten()).catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (busy || logBusy) return;
    try {
      const saved = saveSession({ ...session, title: session.title === "新对话" ? autoTitle(messages) : session.title, updatedAt: Date.now(), messages });
      Session(saved); HistoryItems(loadSessions());
    } catch (e) { E(String(e)); }
  }, [messages, busy, logBusy, session.id]);
  function stop() {
    const requestId = activeRequest.current;
    if (!requestId) return;
    activeRequest.current = null;
    M(previous => streamReducer(previous, { requestId, cancelled: true }));
    B(false);
    void api("ai_cancel", { requestId }).catch(() => E("停止请求未能送达模型服务；这边已停止显示回复，可以稍后再试。"));
  }
  function switchSession(next: Session) {
    if (busy || logBusy) return;
    Session(next); M(next.messages); LogSnapshot(""); E(""); R([]); Searched(false);clearImages();
    HistoryOpen(false); PendingDelete(null); follow.current = true;
  }
  function freshConversation() { switchSession(newSession()); }
  function removeHistory() {
    try {
      if (pendingDelete === "all") clearSessions();
      else if (pendingDelete) deleteSession(pendingDelete);
      if (pendingDelete === session.id || pendingDelete === "all") switchSession(newSession());
      HistoryItems(loadSessions()); PendingDelete(null);
    } catch { E("历史删除失败，请重试。"); }
  }
  async function exportHistory(id: string) {
    E("");
    try {
      const current = id === session.id ? { ...session, messages } : loadSession(id);
      if (!current) return;
      const content = exportMarkdown(current);
      if (desktop) {
        const path = await saveFile("KXL-对话记录.md", [{ name: "Markdown", extensions: ["md"] }]);
        if (!path) return;
        await api("assistant_export_markdown", { path, text: content });
      } else {
        const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
        const link = document.createElement("a"); link.href = url; link.download = "KXL-对话记录.md";
        document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      s.notify("会话已导出。");
    } catch { E("导出失败，请选择可写入的位置后重试。"); }
  }
  function regenerate(index: number) {
    const before = messages.slice(0, index);
    const user = before.map(m => m.role).lastIndexOf("user");
    if (user >= 0) void send(before[user].content, before.slice(0, user));
  }
  async function addLog() {
    if (busy || logBusy) return;
    LogBusy(true);
    E("");
    let analyzing = false;
    try {
      const directory = instance?.path || s.directories.find(v => v.id === s.directoryId)?.path;
      const path = await pickFile([{ name: "游戏日志", extensions: ["log", "txt", "json"] }], false, directory);
      if (!path) return;
      const text = await api<string>("read_log", { path });
      if (!text.trim()) throw new Error("这个日志文件是空的，请选择其他日志。");
      const name = path.split(/[\\/]/).pop() || "日志文件";
      LogSnapshot(text);
      M(previous => [...previous, { role: "user", content: `分析日志：${name}` }]);
      analyzing = true;
      d.receive({ status: "analyzing", reason: `正在分析 ${name}` });
      const result = await api<{ report: string }>("ai_diagnose", { text });
      d.receive({ status: "done", report: result.report, reason: name });
    } catch (e) {
      if (analyzing) d.receive({ status: "error", error: String(e).replace(/^Error: /, "") });
      else E(String(e).replace(/^Error: /, ""));
    } finally { LogBusy(false); }
  }
  useEffect(() => {
    const show = () => O(true);
    const hide = () => O(false);
    window.addEventListener("kynex-open-assistant", show);
    window.addEventListener("kynex-close-assistant", hide);
    return () => {
      window.removeEventListener("kynex-open-assistant", show);
      window.removeEventListener("kynex-close-assistant", hide);
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    panel.current
      ?.querySelector<HTMLElement>("button")
      ?.focus({ preventScroll: true });
    function key(e: KeyboardEvent) {
      if (document.querySelector(".overlay,.onboarding-tour")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        O(false);
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      before?.focus({ preventScroll: true });
    };
  }, [open]);
  useEffect(() => {
    if (d.open) {
      O(true);
      d.close();
    }
  }, [d.open]);
  useEffect(() => {
    if (d.event?.status === "done" && d.event.report) {
      const report = d.event.report;
      M((previous) => [
        ...previous,
        { role: "assistant", content: "## 日志分析\n\n" + report },
      ]);
    }
    if (d.event?.status === "error")
      E(d.event.error || "日志分析未完成，请重试");
  }, [d.event]);
  useEffect(() => {
    if (open && d.unread) d.markRead();
  }, [open, d.unread]);
  useEffect(() => {
    const body = scroll.current;
    if (!body) return;
    if (!messages.length && !busy) body.scrollTop = 0;
    else if (follow.current) body.scrollTop = body.scrollHeight;
  }, [messages, busy, open]);
  useEffect(() => {
    ++serial.current;
    R([]);
    Searched(false);
    SB(false);
    E("");
    P(null);
  }, [s.directoryId, s.selected]);
  async function send(value = text, base = messages) {
    if (!value.trim() || busy || logBusy || activeRequest.current || checkingImages.current) return;
    const content = value.trim();
    if(images.length){const epoch=mediaEpoch.current;checkingImages.current=true;try{const config=await api<{active:string;items:{id:string;supportsVision?:boolean}[]}>("ai_models");if(epoch!==mediaEpoch.current)return;if(!config.items.find(p=>p.id===config.active)?.supportsVision){E("当前模型不支持图片。请到 AI 设置换一个能看图的模型，也可以把报错文字贴过来。");return;}}catch{E("无法确认模型图片能力，请检查 AI 设置。");return;}finally{checkingImages.current=false;}}
    if(!images.length&&isBuildRequest(content)){V("");void startWorkshop(content);return;}
    const requestId = crypto.randomUUID();
    const purpose = !images.length&&/整合包|模组搭配|推荐.*模组|科技.*包|冒险.*包/.test(content) ? "modpack" : "general";
    const next: Message[] = [...base, { role: "user", content, createdAt: Date.now() }];
    activeRequest.current = requestId;
    M([...next, { role: "assistant", content: "", createdAt: Date.now(), requestId, status: "streaming" }]);
    V(""); B(true); E(""); GenerationKind(purpose); follow.current = true;
    const payload = {
      requestId, purpose,
      images:images.map(image=>image.data),
      messages: next.slice(-16).filter(m => m.content).map(({ role, content }) => ({ role, content })),
      attachments: context.attachments(),
      context: context.enabled.instance && instance ? {
        name: instance.name, version: instance.version, loader: instance.loader,
        memory: instance.settings.memory, java: instance.settings.java ? "手动配置" : "自动匹配",
      } : {},
    };
    clearImages();
    try {
      if (purpose === "general") {
        if (!listenerReady.current) throw new Error("回复通道尚未就绪，请稍后重试。");
        await listenerReady.current;
        if (activeRequest.current !== requestId) return;
        await api("ai_assistant_stream", payload);
      } else {
        const result = await api<{ reply: string; searches: string[]; recommendations: Message["recommendations"]; model?: string; usage?: Message["usage"]; elapsedMs?: number }>("ai_assistant", payload);
        if (activeRequest.current !== requestId) return;
        M(previous => streamReducer(previous, { requestId, done: true, reply: result.reply, model: result.model, usage: result.usage, elapsedMs: result.elapsedMs }).map(m => m.requestId === requestId ? { ...m, searches: result.searches, recommendations: result.recommendations } : m));
        activeRequest.current = null; B(false);
      }
    } catch (e) {
      if (activeRequest.current !== requestId) return;
      M(previous => streamReducer(previous, { requestId, error: privateText(String(e).replace(/^Error: /, "")) }));
      activeRequest.current = null; B(false);
    }
  }
  async function search(value = query) {
    if (!value.trim()) return;
    const token = ++serial.current;
    Q(value);
    SB(true);
    Searched(false);
    E("");
    R([]);
    try {
      const translated = await resolveResourceQuery(value.trim());
      const payload = {
        kind: "mod",
        query: translated,
        game: instance?.version || "",
        loader: instance?.loader === "vanilla" ? "" : instance?.loader || "",
        page: 0,
        curseforgeKey: s.settings.curseforgeKey,
      };
      const results = await Promise.allSettled(
        ["modrinth", "curseforge"].map((source) =>
          catalogCache.get({ ...payload, source }),
        ),
      );
      if (token !== serial.current) return;
      let found: Project[] = [];
      const failures: string[] = [];
      results.forEach((r, index) => {
        if (r.status === "fulfilled") {
          found = appendCatalog(
            found,
            r.value.hits.map((p) => ({
              ...p,
              source: index === 0 ? "modrinth" : "curseforge",
            })),
          );
          if (r.value.warning) failures.push(r.value.warning);
        } else
          failures.push(
            `${index === 0 ? "Modrinth" : "CurseForge"}：${String(r.reason)}`,
          );
      });
      R(found);
      E(failures.join("\n"));
      Searched(true);
    } catch (e) {
      if (token === serial.current) E(String(e));
    } finally {
      if (token === serial.current) SB(false);
    }
  }
  async function install(versionId: string) {
    if (!picker || installing) return;
    I(true);
    E("");
    try {
      if (!picker.instance) throw new Error("请先选择已安装的游戏实例");
      if (picker.directoryId !== useStore.getState().directoryId)
        throw new Error("游戏目录已切换，请重新选择安装目标");
      await api("install_project", {
        directoryId: picker.directoryId,
        id: picker.instance.id,
        project: picker.project.project_id,
        versionId,
        kind: "mods",
        name: picker.project.title,
        source: picker.project.source,
        curseforgeKey: s.settings.curseforgeKey,
      });
      s.notify(`模组已安装到「${picker.instance.name}」`);
      P(null);
    } catch (e) {
      E(String(e));
    } finally {
      I(false);
    }
  }
  const conversation = (
    <>
      {messages.map((m, n) => m.status === "streaming" && !m.content ? null : (
        <article className={`assistant-message ${m.role}`} key={n}>
          <header className="assistant-message-head">
            <span>
              {m.role === "assistant" && <Bot size={16} />}
              <b>{m.role === "user" ? "你" : "AI 助手"}</b>
            </span>
            {m.role === "assistant" && (
              <button
                aria-label={`复制第 ${n + 1} 条回复`}
                onClick={() =>
                  void guarded(async () => {
                    await navigator.clipboard.writeText(m.content);
                    Copied(n);
                  })
                }
              >
                {copied === n ? <Check size={14} /> : <Copy size={14} />}
                <span>{copied === n ? "已复制" : "复制"}</span>
              </button>
            )}
          </header>
          {m.role === "assistant" ? (
            <FormattedAnswer text={m.content} />
          ) : (
            <div>{m.content}</div>
          )}
          {m.status === "streaming" && <span className="assistant-stream-cursor" aria-label="正在生成">▍</span>}
          {m.role === "assistant" && <footer className="assistant-reply-meta">
            {m.model && <span>{m.model}</span>}
            {m.elapsedMs !== undefined && <span>{(m.elapsedMs / 1000).toFixed(1)}s</span>}
            {m.usage && <span>{m.usage.total_tokens !== undefined ? `${m.usage.total_tokens} 个计费单位` : `输入 ${m.usage.prompt_tokens ?? "—"} / 输出 ${m.usage.completion_tokens ?? "—"} 个计费单位`}</span>}
            {(m.status === "cancelled" || m.status === "error") && <>
              <span>{m.status === "cancelled" ? "已停止生成" : m.error || "生成中断"}</span>
              <button disabled={busy || logBusy} onClick={() => regenerate(n)}>重新生成</button>
            </>}
          </footer>}
          {m.recommendations?.map((r, index) => (
            <section className="assistant-recommendation" key={index}>
              <small>{r.category || "推荐模组"}</small>
              <b>{r.name}</b>
              <FormattedAnswer text={r.reason} />
              <Button onClick={() => void search(r.query)}>
                查看兼容版本：{r.name}
              </Button>
            </section>
          ))}
          {m.searches?.map((q) => (
            <Button key={q} onClick={() => void search(q)}>
              查找模组：{q}
            </Button>
          ))}
        </article>
      ))}
    </>
  );
  if (!ready) return null;
  return (
    <>
      <button
        className="assistant-orb"
        data-guide="assistant"
        aria-label="打开 AI 助手"
        aria-expanded={open}
        title="Kynex AI 助手"
        onClick={() => O(!open)}
      >
        <Bot size={29} />
        {(d.unread||insights.unread) && <span className={`assistant-dot${insights.unread?" insight-unread":""}`} />}
      </button>
      {open && (
        <section
          ref={panel}
          className="assistant-panel"
          role="region"
          aria-label="AI 助手"
          data-history={historyOpen || undefined}
        >
          <header className="assistant-header">
            <Bot size={23} />
            <div>
              <b>Kynex AI 助手</b>
            </div>
            <button aria-label="历史会话" aria-expanded={historyOpen} onClick={() => HistoryOpen(!historyOpen)}><History size={18}/></button>
            <button aria-label="收起 AI 助手" onClick={() => O(false)}>
              <X size={18} />
            </button>
          </header>
          <div className="assistant-body" ref={scroll} onScroll={() => {
            const node = scroll.current; if (node) follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 72;
          }}>
            <InsightPanel {...insights}/>
            {!messages.length && (
              <div className="assistant-welcome">
                <Bot size={36} />
                <h2>有什么可以帮你？</h2>
                <p>
                  问使用方法、分析报错，或一起搭配整合包，都可以直接告诉我。
                </p>
                {[
                  "怎么安装第一个游戏版本？",
                  "想做轻量冒险整合包，怎么搭配模组？",
                  "游戏闪退，应该怎样排查？",
                ].map((value) => (
                  <Button key={value} onClick={() => V(value)}>
                    {value}
                  </Button>
                ))}
              </div>
            )}
            <div className="assistant-conversation" aria-live="polite" aria-relevant="additions text">{conversation}</div>
            {logSnapshot && <RepairSuggestions text={logSnapshot} />}
            {((busy && !messages.some(m => m.requestId === activeRequest.current && m.content)) || d.event?.status === "analyzing") && (
              <div className="assistant-thinking" role="status">
                <span className="assistant-thinking-core" aria-hidden="true"><Bot size={21}/><i/><i/></span>
                <span><b>{busy ? (generationKind === "modpack" ? "正在生成搭配方案" : "正在思考") : "正在分析游戏日志"}</b><small>正在整理线索，请稍候</small></span>
                <span className="assistant-thinking-dots" aria-hidden="true"><i/><i/><i/></span>
              </div>
            )}
            {(searched || searchBusy) && <h3>兼容资源：{query}</h3>}
            {searchBusy && <p role="status">正在查询兼容模组…</p>}
            {searched && !rows.length && (
              <p>未找到匹配版本，请换一个推荐或核对游戏版本与加载器。</p>
            )}
            {rows.map((project) => {
              const localized = localizeProject(project);
              return (
                <article
                  className="assistant-project"
                  key={`${project.source}:${project.project_id}`}
                >
                  <b>{localized.name}</b>
                  <small>
                    {project.source} · {project.downloads.toLocaleString()}{" "}
                    次下载
                  </small>
                  <p>{localized.description}</p>
                  <Button
                    disabled={!desktop || installing}
                    onClick={() => {
                      E("");
                      P({ project, instance, directoryId: s.directoryId });
                    }}
                  >
                    选择版本 / 下载
                  </Button>
                </article>
              );
            })}
            {error && (
              <div className="notice error" role="alert">
                {error}
              </div>
            )}
          </div>
          <form
            className="assistant-compose"
            onDragOver={e=>{if(e.dataTransfer.types.includes("Files"))e.preventDefault();}}
            onDrop={e=>{if(e.dataTransfer.files.length){e.preventDefault();if(!busy&&!logBusy)void addImages(Array.from(e.dataTransfer.files));}}}
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <div className="assistant-quick-actions">
              <ScreenshotButton disabled={busy||logBusy||!desktop} add={files=>void addImages(files)}/>
              <VoiceInput disabled={busy||logBusy} onText={value=>V(previous=>previous?`${previous}\n${value}`:value)} onError={E}/>
              <Button type="button" disabled={busy||logBusy} onClick={openWorkshop}>整合包工坊</Button>
              <Button
                type="button"
                data-guide="assistant-logs"
                disabled={busy || logBusy || !desktop}
                onClick={() => void addLog()}
              >
                添加日志
              </Button>
              <Button
                type="button"
                data-guide="assistant-mods"
                onClick={() => {
                  V(
                    "我想制作一个整合包，请先了解我的玩法、版本、加载器和电脑配置，再推荐合适的模组组合。",
                  );
                  panel.current
                    ?.querySelector<HTMLTextAreaElement>(
                      ".assistant-compose textarea",
                    )
                    ?.focus();
                }}
              >
                整合包搭配
              </Button>
              <Button
                type="button"
                onClick={() => {
                  O(false);
                  openAiSettings();
                }}
              >
                AI 设置
              </Button>
            </div>
            <div className="assistant-context-tags" aria-label="本次一起发给助手的信息">
              {instance && <button type="button" aria-pressed={context.enabled.instance} onClick={() => context.toggle("instance")}>实例：{privateText(instance.name)}</button>}
              {context.value && <button type="button" aria-pressed={context.enabled.mods} onClick={() => context.toggle("mods")}>模组 {context.value.mods.count}</button>}
              {context.value?.attachments.map(log => <button key={log.kind} type="button" aria-pressed={context.enabled[log.kind]} onClick={() => context.toggle(log.kind)}>{log.kind === "latest" ? "最近一次游戏日志" : "闪退报告"}{log.truncated ? "（只取了部分内容）" : ""}</button>)}
            </div>
            {context.notice && <p className="assistant-context-notice">{context.notice}</p>}
            <ScreenshotPreviews images={images} remove={id=>{imagesRef.current=imagesRef.current.filter(image=>image.id!==id);Images(imagesRef.current);}}/>
            <textarea
              data-guide="assistant-chat"
              aria-label="发给 AI 助手的消息"
              maxLength={12000}
              placeholder="描述问题、粘贴报错，或说说你想制作的整合包…"
              value={text}
              onChange={(e) => V(e.target.value)}
              onPaste={e=>{const files=Array.from(e.clipboardData.files);if(files.length){e.preventDefault();if(!busy&&!logBusy)void addImages(files);}}}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div>
              <Button
                type="button"
                title="清空对话"
                disabled={busy || logBusy}
                onClick={freshConversation}
              >
                <RotateCcw size={15} />
              </Button>
              {busy ? <Button type="button" onClick={stop}><Square size={14}/>停止生成</Button> : <Button
                primary
                type="submit"
                disabled={busy || logBusy || !text.trim() || !desktop}
              >
                <Send size={15} />
                发送
              </Button>}
            </div>
          </form>
          {historyOpen && <section className="assistant-history" aria-label="历史会话列表">
            <header><b>历史会话</b><Button disabled={busy || logBusy} onClick={freshConversation}><Plus size={14}/>新对话</Button></header>
            {error && <div className="notice error" role="alert">{error}</div>}
            {pendingDelete ? <div role="alertdialog" aria-label="确认删除历史" className="assistant-history-confirm">
              <p>{pendingDelete === "all" ? "确定清空全部历史会话？导出后再删除可保留副本。" : "确定删除这个会话？"}</p>
              <Button onClick={() => PendingDelete(null)}>取消</Button><Button disabled={busy || logBusy} onClick={removeHistory}>确认删除</Button>
            </div> : <>
              <div className="assistant-history-list">{historyItems.map(item => <article key={item.id}>
                {renameId === item.id ? <form onSubmit={e => {
                  e.preventDefault();
                  try { renameSession(item.id, renameTitle); if (item.id === session.id) Session(old => ({ ...old, title: renameTitle.trim() || "新对话" })); HistoryItems(loadSessions()); RenameId(""); }
                  catch { E("重命名失败，请重试。"); }
                }}><input aria-label="会话名称" value={renameTitle} maxLength={80} onChange={e => RenameTitle(e.target.value)}/><button type="submit">保存名称</button><button type="button" onClick={() => RenameId("")}>取消</button></form> : <>
                  <button className="assistant-history-title" aria-current={item.id === session.id ? "true" : undefined} disabled={busy || logBusy} onClick={() => switchSession(item)}>{item.title}<small>{new Date(item.updatedAt).toLocaleString("zh-CN", {hour12: false})} · {item.messages.length} 条消息</small></button>
                  <div className="assistant-history-actions">
                    <button aria-label={"重命名会话：" + item.title} disabled={busy || logBusy} onClick={() => {RenameId(item.id); RenameTitle(item.title);}}><Pencil size={14}/></button>
                    <button aria-label={"导出会话：" + item.title} onClick={() => void exportHistory(item.id)}><Download size={14}/></button>
                    <button aria-label={"删除会话：" + item.title} disabled={busy || logBusy} onClick={() => PendingDelete(item.id)}><Trash2 size={14}/></button>
                  </div>
                </>}
              </article>)}</div>
              <footer><Button disabled={busy || logBusy || !historyItems.length} onClick={() => PendingDelete("all")}>清空全部历史</Button><Button onClick={() => HistoryOpen(false)}>返回对话</Button></footer>
            </>}
          </section>}
        </section>
      )}
      {picker && (
        <>
          <ResourceVersionPicker
            project={picker.project}
            id={picker.instance?.id || ""}
            gameFilter={picker.instance?.version || ""}
            loaderFilter={
              picker.instance?.loader === "vanilla"
                ? ""
                : picker.instance?.loader || ""
            }
            close={() => {
              if (!installing) P(null);
            }}
            install={(v) => {
              void install(v);
            }}
          />
          {installing && (
            <div className="assistant-installing" role="status">
              正在安装模组和它需要的其他模组…
            </div>
          )}
          {error && (
            <div className="assistant-installing" role="alert">
              {error}
            </div>
          )}
        </>
      )}
    </>
  );
}
