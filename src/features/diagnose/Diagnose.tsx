import { Disclosure } from "../../components/ui/Motion";
import { useEffect, useState, useRef } from "react";
import { Upload, FileText, Clipboard, AlertTriangle } from "lucide-react";
import { Button, Badge, Card, Empty } from "../../components/ui";
import { diagnose } from "./logRules";
import { useStore, guarded } from "../../store";
import { api, desktop } from "../../lib/bridge";
export function Diagnose() {
  const s = useStore();
  const [text, T] = useState("");
  const [name, N] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const results = diagnose(text);
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
        <div>
          <h1>诊断</h1>
          <p>从日志里找线索，让下一次启动更顺利。</p>
        </div>
        <Badge>本地分析 · 不上传日志</Badge>
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
          {results.map((r) => (
            <Card key={r.id} className="verdict">
              <div className="actions">
                <Badge tone={r.severity}>
                  {r.severity === "bad" ? "错误" : "线索"}
                </Badge>
                <h2>{r.title}</h2>
              </div>
              <p>{r.advice}</p>
              <small>
                匹配 {r.lines.length} 处 · 规则匹配结果需结合完整日志判断
              </small>
              <pre>
                {r.lines.map((l) => (
                  <div key={l.number}>
                    <span className="line-no">{l.number}</span>
                    {l.text}
                  </div>
                ))}
              </pre>
              <div className="actions">
                {r.id === "oom" && (
                  <Button
                    primary
                    onClick={() => s.show("instance-settings", s.selected)}
                  >
                    调整实例内存
                  </Button>
                )}
                <Button
                  onClick={() =>
                    guarded(async () => {
                      await navigator.clipboard.writeText(
                        `${r.title}\n${r.advice}\n${r.lines.map((l) => `${l.number}: ${l.text}`).join("\n")}`,
                      );
                      s.notify("诊断报告已复制");
                    })
                  }
                >
                  复制报告
                </Button>
              </div>
            </Card>
          ))}
          {text && !results.length && (
            <Empty
              title="没有匹配到已知规则"
              detail="这不代表日志正常。可先搜索 ERROR、Caused by 或 Exception，结合完整调用链判断。"
            />
          )}
          <Disclosure
            className="log-input"
            initialOpen={!text}
            title={name || "也可以直接粘贴日志文本"}
          >
            <textarea
              aria-label="游戏日志文本"
              value={text}
              onChange={(e) => T(e.target.value)}
              placeholder="把日志粘贴到这里，立即分析…"
            />
          </Disclosure>
        </div>
        <aside>
          <Card>
            <h3>环境快照</h3>
            {[
              [
                "当前实例",
                s.instances.find((i) => i.id === s.selected)?.name ?? "未选择",
              ],
              ["内存", `${s.settings.memory} MB`],
              ["Java", s.settings.java || "自动匹配"],
              ["分析模式", "本机规则引擎"],
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
