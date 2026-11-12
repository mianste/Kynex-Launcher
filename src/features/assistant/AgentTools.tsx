import { useEffect, useState } from "react";
import { Button, Modal } from "../../components/ui";
import { api, readableSize } from "../../lib/bridge";
import { useStore } from "../../store";
import { useAgent, type AgentTask, running } from "./agentStore";
type Coverage = {
  modId: string;
  total: number;
  existing: number;
  community: number;
  missing: Record<string, string>;
};
const labels: Record<string, string> = {
  localization_translate: "用 AI 翻译缺少的文字",
  localization_community: "安装社区汉化",
  localization_disable: "打开或关闭 AI 翻译",
  config_apply_template: "应用配置模板",
  safe_mode_launch: "安全模式验证",
  bisect_mods: "分批找出有问题的模组",
  repair_instance: "修复并重新验证",
  server_pack_create: "生成服务端包",
  server_pack_verify: "验证服务端",
  export_pack: "导出整合包",
};
export function ToolResult({ data }: { data: Record<string, unknown> }) {
  const [showDetails, setShowDetails] = useState(false);
  const estimate = (data.estimate || data) as Record<string, unknown>;
  return (
    <div className="agent-result-summary">
      {typeof estimate.characters === "number" &&
        typeof data.translatedEntries !== "number" && (
          <p>
            待翻译 {estimate.characters.toLocaleString()} 字符，估算{" "}
            {Number(estimate.estimatedTokens || 0).toLocaleString()}{" "}
            个计费单位。实际费用由模型服务商决定。
          </p>
        )}
      {typeof estimate.estimatedBytes === "number" && (
        <p>打包前大约多大：{readableSize(estimate.estimatedBytes)}</p>
      )}
      {typeof data.location === "string" && <p>保存位置：{data.location}</p>}
      {typeof data.report === "string" && (
        <p className="agent-result-report">{data.report}</p>
      )}
      {typeof data.note === "string" && <p>{data.note}</p>}
      {data.verified === true && <p>验证通过，验证进程已结束。</p>}
      {data.applied === true && <p>配置已应用。</p>}
      {typeof data.enabled === "boolean" && (
        <p>AI 翻译已{data.enabled ? "启用" : "禁用"}。</p>
      )}
      {typeof data.translatedEntries === "number" && (
        <p>
          已写入 {data.translatedEntries.toLocaleString()} 条译文
          {Number(data.remainingEntries) > 0
            ? "，还有 " +
              Number(data.remainingEntries).toLocaleString() +
              " 条待补译"
            : ""}
          。重新进入游戏后查看。
        </p>
      )}
      {typeof data.translatedEntries !== "number" &&
        Array.isArray(data.completedMods) && (
          <p>已补上 {data.completedMods.length} 个模组缺少的中文翻译。</p>
        )}
      {["warnings", "failures", "removedClientMods", "suspects"].map((key) =>
        Array.isArray(data[key]) && data[key].length > 0 ? (
          <div key={key}>
            <b>
              {
                {
                  warnings: "请注意",
                  failures: "已跳过或失败",
                  removedClientMods: "服务器包已移除的玩家端模组",
                  suspects: "可能有问题的模组",
                }[key]
              }
            </b>
            <ul>
              {(data[key] as unknown[]).map((s, i) => (
                <li key={i}>{String(s)}</li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
      {Array.isArray(data.preview) && (
        <div>
          {(
            data.preview as {
              file: string;
              before: string;
              set: Record<string, unknown>;
            }[]
          ).map((p, i) => (
            <div key={i}>
              <b>{p.file}</b>
              <p>当前内容</p>
              <pre>{p.before || "文件尚未生成"}</pre>
              <p>计划修改的键</p>
              <pre>{JSON.stringify(p.set, null, 2)}</pre>
            </div>
          ))}
        </div>
      )}
      <Button
        type="button"
        aria-expanded={showDetails}
        onClick={() => setShowDetails(!showDetails)}
      >
        {showDetails ? "收起技术详情" : "查看技术详情"}
      </Button>
      {showDetails && <pre>{JSON.stringify(data, null, 2)}</pre>}
    </div>
  );
}
export function TranslationProgress({ task }: { task: AgentTask }) {
  const progress = useAgent((state) => state.progress[task.id]);
  const [stopping, setStopping] = useState(false);
  const total = progress?.total ?? 0;
  const done = progress?.done ?? 0;
  return (
    <div className="agent-translation-progress">
      <div className="agent-actions">
        <span role="status">
          {stopping ? "正在停止…" : progress?.stage || "正在准备汉化"}
          {total > 0 && " · " + done + " / " + total + " 批"}
        </span>
        <Button
          type="button"
          disabled={stopping}
          onClick={() => {
            setStopping(true);
            void api("agent_cancel", { taskId: task.id }).catch((error) => {
              setStopping(false);
              useStore.getState().notify(String(error));
            });
          }}
        >
          停止汉化
        </Button>
      </div>
      <progress
        aria-label="汉化进度"
        max={Math.max(1, total)}
        value={total > 0 ? done : undefined}
      />
    </div>
  );
}

export function AgentTools({
  task,
  group,
}: {
  task: AgentTask;
  group: "localization" | "maintenance" | "export";
}) {
  const s = useStore(),
    a = useAgent();
  const [coverage, Coverage] = useState<Coverage[]>([]);
  const [selectedMods, SelectedMods] = useState<string[]>([]);
  const [data, D] = useState<Record<string, unknown> | null>(null);
  const [pending, P] = useState<{
    tool: string;
    args: Record<string, unknown>;
  } | null>(null);
  const [busy, B] = useState(false);
  const [error, E] = useState("");
  const [template, T] = useState("balanced");
  const [eula, Eula] = useState(false);
  const [exports, Exports] = useState({
    includeConfig: true,
    includeLocalization: true,
    includeReadme: true,
    includeModList: true,
    includeLicense: true,
  });
  useEffect(() => {
    D(null);
    Coverage([]);
    SelectedMods([]);
    E("");
    P(null);
  }, [task.id]);
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => E(""), 5000);
    return () => clearTimeout(timer);
  }, [error]);
  const payload = {
    taskId: task.id,
    planHash: task.planHash,
    accountId: s.accountId,
    settings: s.settings,
    args: { id: task.instanceId },
  };
  async function call(
    tool: string,
    args: Record<string, unknown> = {},
    confirmed = false,
  ) {
    B(true);
    E("");
    if (confirmed) D(null);
    try {
      const result = await api<Record<string, unknown>>("agent_tool", {
        ...payload,
        tool,
        args: { id: task.instanceId, ...args },
        confirmed,
      });
      D(result);
      if (Array.isArray(result.coverage)) {
        const rows = result.coverage as Coverage[];
        Coverage(rows);
        SelectedMods(
          rows
            .filter((r) => Object.keys(r.missing).length > 0)
            .slice(0, 20)
            .map((r) => r.modId),
        );
      }
      const current = await api<AgentTask>("agent_get", { taskId: task.id });
      a.receive({ taskId: task.id, type: "state", task: current });
      return result;
    } catch (e) {
      const message = String(e).replace(/^Error: /, "");
      if (message !== "任务已取消") E(message);
    } finally {
      B(false);
    }
  }
  async function prepare(tool: string, args: Record<string, unknown> = {}) {
    if (
      [
        "localization_translate",
        "config_apply_template",
        "export_pack",
      ].includes(tool)
    ) {
      const result = await call(tool, args);
      if (!result) return;
    } else D(null);
    P({ tool, args });
  }
  const serverId = (
    task.results?.server_pack_create as { serverId?: string } | undefined
  )?.serverId;
  if (!task.confirmedHash) return null;
  return (
    <div className="agent-tools">
      <div className="agent-tools-grid">
        {group === "localization" && (
          <section>
            <h4>补上中文翻译</h4>
            <p>先安装匹配的社区汉化，再用 AI 补译剩余文字。</p>
            <div className="agent-actions">
              <Button
                type="button"
                disabled={busy || running(task.status)}
                onClick={() => P({ tool: "localization_community", args: {} })}
              >
                安装社区汉化
              </Button>
              <Button
                type="button"
                disabled={busy || running(task.status)}
                onClick={() => void call("localization_coverage")}
              >
                看看哪些文字还没翻译
              </Button>
            </div>
            {coverage.map((row) => (
              <div key={row.modId}>
                <label>
                  <input
                    type="checkbox"
                    checked={selectedMods.includes(row.modId)}
                    disabled={
                      !Object.keys(row.missing).length ||
                      (!selectedMods.includes(row.modId) &&
                        selectedMods.length >= 20)
                    }
                    onChange={(e) =>
                      SelectedMods((ids) =>
                        e.target.checked
                          ? [...ids, row.modId]
                          : ids.filter((id) => id !== row.modId),
                      )
                    }
                  />
                  <b>{row.modId}</b>
                </label>
                <progress
                  max={Math.max(1, row.total)}
                  value={row.existing + row.community}
                  aria-label={`${row.modId} 中文翻译进度`}
                />
                <small>
                  模组已有 {row.existing} · 社区 {row.community} · 缺失{" "}
                  {Object.keys(row.missing).length}
                </small>
              </div>
            ))}
            <div className="agent-actions">
              <Button
                type="button"
                disabled={
                  busy || running(task.status) || selectedMods.length === 0
                }
                onClick={() =>
                  void prepare("localization_translate", {
                    modIds: selectedMods,
                  })
                }
              >
                看看需要翻译多少
              </Button>
              <Button
                type="button"
                disabled={busy || running(task.status)}
                onClick={() =>
                  P({ tool: "localization_disable", args: { enabled: false } })
                }
              >
                关闭 AI 翻译
              </Button>
              <Button
                type="button"
                disabled={busy || running(task.status)}
                onClick={() =>
                  P({ tool: "localization_disable", args: { enabled: true } })
                }
              >
                打开 AI 翻译
              </Button>
            </div>
          </section>
        )}
        {group === "maintenance" && (
          <section>
            <h4>配置与键位</h4>
            <div className="agent-actions">
              {[
                ["balanced", "通用均衡"],
                ["low-memory", "轻量显示"],
                ["sodium-balanced", "Sodium 均衡"],
              ].map(([id, label]) => (
                <label key={id}>
                  <input
                    type="radio"
                    name={`config-template-${task.id}`}
                    checked={template === id}
                    onChange={() => T(id)}
                  />
                  {label}
                </label>
              ))}
            </div>
            <div className="agent-actions">
              <Button
                type="button"
                disabled={busy || running(task.status)}
                onClick={() =>
                  void prepare("config_apply_template", {
                    templateId: template,
                  })
                }
              >
                预览配置差异
              </Button>
              <Button
                type="button"
                disabled={busy || running(task.status)}
                onClick={() => void call("keybind_check")}
              >
                检查键位冲突
              </Button>
            </div>
          </section>
        )}
        {group === "maintenance" && (
          <section>
            <h4>启动排查</h4>
            <p>
              助手会先备份，再尝试修复，最多试三次。显卡驱动的问题需要你按提示处理。
            </p>
            <div className="agent-actions">
              {["repair_instance", "safe_mode_launch", "bisect_mods"].map(
                (tool) => (
                  <Button
                    type="button"
                    key={tool}
                    disabled={busy || running(task.status)}
                    onClick={() => P({ tool, args: {} })}
                  >
                    {labels[tool]}
                  </Button>
                ),
              )}
            </div>
          </section>
        )}
        {group === "export" && (
          <section>
            <h4>服务端包</h4>
            <p>在游戏目录的 server/ 中生成，默认保持正版验证与 eula=false。</p>
            <Button
              type="button"
              disabled={busy || running(task.status)}
              onClick={() => P({ tool: "server_pack_create", args: {} })}
            >
              生成服务端包
            </Button>
            {serverId && (
              <>
                <p>
                  服务器文件已准备好。结果会告诉你哪些模组已从服务器包移除，哪些还需要确认。
                </p>
                <label>
                  <input
                    type="checkbox"
                    checked={eula}
                    onChange={(e) => Eula(e.target.checked)}
                  />
                  我已阅读并同意{" "}
                  <a
                    href="https://www.minecraft.net/eula"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Minecraft EULA
                  </a>
                </label>
                <Button
                  type="button"
                  disabled={!eula || busy || running(task.status)}
                  onClick={() =>
                    P({
                      tool: "server_pack_verify",
                      args: { serverId, acceptEula: true },
                    })
                  }
                >
                  验证服务端
                </Button>
              </>
            )}
          </section>
        )}
        {group === "export" && (
          <section>
            <h4>导出 mrpack</h4>
            <div className="agent-export-options">
              {(
                [
                  ["includeConfig", "配置"],
                  ["includeLocalization", "汉化资源"],
                  ["includeReadme", "说明文档"],
                  ["includeModList", "模组清单"],
                  ["includeLicense", "第三方版权提示"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={exports[key]}
                    onChange={(e) =>
                      Exports((v) => ({ ...v, [key]: e.target.checked }))
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
            <Button
              type="button"
              disabled={busy || running(task.status) || task.status !== "done"}
              onClick={() => void prepare("export_pack", exports)}
            >
              查看大小并导出
            </Button>
          </section>
        )}
      </div>
      {group === "localization" && task.status === "translating" && (
        <TranslationProgress task={task} />
      )}
      {busy && task.status !== "translating" && <p role="status">正在处理…</p>}
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {data && (
        <section className="agent-tool-result">
          <h4>本次结果</h4>
          {typeof data.estimatedBytes === "number" && (
            <p>打包前大约多大：{readableSize(data.estimatedBytes)}</p>
          )}
          <ToolResult data={data} />
        </section>
      )}
      {pending && (
        <Modal
          title={labels[pending.tool] || "确认操作"}
          onClose={() => P(null)}
        >
          <p>
            {pending.tool === "bisect_mods"
              ? "二分可能启动 5–8 次，耗时约 10–15 分钟；将临时禁用模组并逐步验证，结束后恢复原状态，仅保留最终有证据定位的禁用项。"
              : pending.tool === "localization_community"
                ? "将下载匹配当前游戏版本和加载器的社区资源包。重新进入游戏后生效。"
                : pending.tool === "localization_translate"
                  ? "翻译会使用你设置的模型，可能产生费用。每次最多翻译 20 个模组，总共 20 万字。先看下方估算再确认。"
                  : pending.tool === "server_pack_verify"
                    ? "已确认 EULA 后将写入 eula=true，启动服务端并等待 Done，随后发送 stop；最长 180 秒。"
                    : "助手会先备份这套游戏，再开始你确认的操作。"}
          </p>
          {data && <ToolResult data={data} />}
          <Button
            type="button"
            primary
            busy={busy}
            onClick={() => {
              const next = pending;
              P(null);
              void call(next.tool, next.args, true).then((result) => {
                if (result && next.tool === "localization_community") {
                  Coverage([]);
                  SelectedMods([]);
                }
              });
            }}
          >
            确认{labels[pending.tool]}
          </Button>
        </Modal>
      )}
    </div>
  );
}
