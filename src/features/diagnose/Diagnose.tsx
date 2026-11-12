import { Disclosure } from "../../components/ui/Motion";
import { useEffect, useState, useRef } from "react";
import { Upload, FileText, Clipboard, AlertTriangle } from "lucide-react";
import { Button, Badge, Card } from "../../components/ui";
import { DiagnosisResult, useDiagnosis } from "./AiDiagnosis";
import { useStore, guarded } from "../../store";
import { api, desktop } from "../../lib/bridge";
import { RepairSuggestions } from "../assistant/RepairSuggestions";
import { openAiSettings } from "../../lib/settingsNavigation";
export function Diagnose({
  showResult = true,
  onAnalyzed,
}: { showResult?: boolean; onAnalyzed?: (text: string) => void } = {}) {
  const s = useStore();
  const [text, T] = useState("");
  const [name, N] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const d = useDiagnosis();
  const [busy, B] = useState(false);
  const [error, E] = useState("");
  async function analyze() {
    B(true);
    E("");
    try {
      const result = await api<{ report: string }>("ai_diagnose", { text });
      d.receive({
        status: "done",
        report: result.report,
        reason: "手动导入日志",
      });
      d.close();
      onAnalyzed?.(text);
    } catch (e) {
      E(String(e));
    } finally {
      B(false);
    }
  }
  async function read(f: File) {
    if (f.size > 20 * 1024 * 1024) throw new Error("日志不能超过 20 MB");
    if (!/\.(txt|log|json)$/i.test(f.name))
      throw new Error("请选择 .txt / .log / .json 文件");
    N(f.name);
    T(await f.text());
  }
  useEffect(() => {
    if (!desktop) return;
    const nativeDrop = (raw: Event) => {
      const detail = (raw as CustomEvent).detail as
        | { type: "drop"; paths: string[] }
        | { type: "enter" | "over" | "leave" };
      if (detail.type !== "drop") return;
      const path = detail.paths[0];
      if (!path) return;
      void guarded(async () => {
        if (!/\.(txt|log|json)$/i.test(path))
          throw new Error("请选择 .txt / .log / .json 文件");
        T(await api<string>("read_log", { path }));
        N(path.split(/[\\/]/).pop() || "日志文件");
      });
    };
    window.addEventListener("kynex-native-drag", nativeDrop);
    return () => window.removeEventListener("kynex-native-drag", nativeDrop);
  }, []);
  return (
    <>
      <div className="page-head">
        <Badge>AI 日志分析</Badge>
      </div>
      <div className="diagnose-layout">
        <div>
          <div
            className="dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const f = e.dataTransfer.files[0];
              if (f) void guarded(() => read(f));
            }}
          >
            <Upload size={28} />
            <b>拖入 crash-report 或 latest.log</b>
            <span>支持 .txt / .log / .json · 单文件最大 20 MB</span>
            <div className="actions">
              <Button onClick={() => file.current?.click()}>
                <FileText size={14} />
                浏览文件
              </Button>
              <Button
                onClick={() =>
                  guarded(async () => {
                    T(await navigator.clipboard.readText());
                    N("剪贴板");
                  })
                }
              >
                <Clipboard size={14} />
                粘贴文本
              </Button>
            </div>
            <input
              hidden
              ref={file}
              type="file"
              accept=".txt,.log,.json"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void guarded(() => read(f));
              }}
            />
          </div>
          <Card>
            <h2>模型分析</h2>
            <p>
              请先在「设置 → 高级」选好模型并填入密钥。助手会先隐藏日志里的敏感信息，再发给你选的模型。服务商可能会收费。
            </p>
            <Button
              primary
              busy={busy}
              disabled={!desktop || !text.trim()}
              onClick={() => void analyze()}
            >
              分析日志
            </Button>
            {showResult && <Button onClick={openAiSettings}>AI 设置</Button>}
            {error && <div className="notice error">{error}</div>}
            {showResult && d.event && <DiagnosisResult event={d.event} />}
          </Card>
          <RepairSuggestions text={text} />
          <Disclosure
            className="log-input"
            initialOpen={!text}
            title={name || "也可以直接粘贴日志文本"}
          >
            <textarea
              aria-label="游戏日志文本"
              value={text}
              onChange={(e) => T(e.target.value)}
              placeholder="把游戏日志粘贴到这里"
            />
          </Disclosure>
        </div>
        <aside>
          <Card>
            <h3>当前设置</h3>
            {[
              [
                "当前实例",
                s.instances.find((i) => i.id === s.selected)?.name ?? "未选择",
              ],
              ["内存", `${s.settings.memory} MB`],
              ["Java", s.settings.java || "自动匹配"],
              ["分析服务", "当前所选模型"],
            ].map(([k, v]) => (
              <div className="kv" key={k}>
                <span>{k}</span>
                <b>{v}</b>
              </div>
            ))}
          </Card>
          <Card>
            <AlertTriangle size={20} />
            <h3>看最早的异常</h3>
            <p>
              后续报错可能只是连锁反应。优先检查第一个 Caused by
              和加载失败的模组。
            </p>
          </Card>
        </aside>
      </div>
    </>
  );
}
