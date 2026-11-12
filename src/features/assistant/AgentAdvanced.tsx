import { useEffect, useRef, useState } from "react";
import { Button, Modal } from "../../components/ui";
import { api, readableSize, desktop } from "../../lib/bridge";
import { useStore } from "../../store";
import { useAgent, type AgentTask, type PackPlan, running } from "./agentStore";
import { ToolResult } from "./AgentTools";
type Template = {
  id: string;
  name: string;
  description: string;
  minecraft: string;
  loader: string;
  memoryMb: number;
};
type Migration = {
  sourceInstanceId: string;
  target: { minecraft: string; loader: string; loaderVersion: string };
  mappings: {
    name: string;
    action: string;
    reason: string;
    newProjectId: string;
    newVersionId: string;
  }[];
  unresolved: string[];
  configWarnings: string[];
  estimatedDownloadBytes: number;
};
export function TemplateGallery({
  onSelect,
}: {
  onSelect: (request: string) => void;
}) {
  const s = useStore();
  const [open, setOpen] = useState(false);
  const [items, Items] = useState<Template[]>([]);
  const [error, E] = useState("");
  useEffect(() => {
    if (desktop)
      void api<Template[]>("agent_tool", {
        tool: "template_list",
        directoryId: s.directoryId,
        args: {},
      })
        .then((v) => Items(Array.isArray(v) ? v : []))
        .catch(() => {});
  }, [s.directoryId]);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        玩法模板
      </Button>
      {open && (
        <Modal title="从玩法模板开始" wide onClose={() => setOpen(false)}>
          {error && <p role="alert">{error}</p>}
          <div className="agent-template-grid">
            {items.map((t) => (
              <button
                type="button"
                key={t.id}
                onClick={() =>
                  void api<{ request: string }>("agent_tool", {
                    tool: "template_apply",
                    directoryId: s.directoryId,
                    args: { templateId: t.id },
                  })
                    .then((v) => {
                      onSelect(v.request);
                      setOpen(false);
                    })
                    .catch((e) => E(String(e)))
                }
              >
                <b>{t.name}</b>
                <small>
                  {t.minecraft} · {t.loader} · {t.memoryMb} MB
                </small>
                <p>{t.description}</p>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
export function ShareImport() {
  const s = useStore(),
    a = useAgent();
  const [open, setOpen] = useState(false);
  const [code, Code] = useState("");
  const [preview, P] = useState<{ plan: PackPlan; importHash: string } | null>(
    null,
  );
  const [error, E] = useState("");
  const [busy, B] = useState(false);
  async function inspect() {
    B(true);
    E("");
    try {
      const result = await api<{ plan: PackPlan; importHash: string }>(
        "agent_tool",
        {
          tool: "share_code_import",
          directoryId: s.directoryId,
          requestId: crypto.randomUUID(),
          args: { code },
        },
      );
      P(result);
    } catch (e) {
      E(String(e).replace(/^Error: /, ""));
    } finally {
      B(false);
    }
  }
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        导入分享码
      </Button>
      {open && !preview && (
        <Modal
          title="导入分享码或 .kxlpack"
          className="agent-workshop-modal"
          onClose={() => setOpen(false)}
        >
          <textarea
            aria-label="分享码"
            value={code}
            onChange={(e) => Code(e.target.value)}
            maxLength={8192}
            placeholder="粘贴 KXL1 开头的分享码"
          />
          <label className="btn">
            选择分享文件
            <input
              type="file"
              accept=".kxlpack"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 8192) {
                  E("分享文件不能超过 8 KB。");
                  return;
                }
                void file.text().then(Code);
                e.target.value = "";
              }}
              hidden
            />
          </label>
          <Button
            type="button"
            busy={busy}
            disabled={!code.trim()}
            onClick={() => void inspect()}
          >
            检查并预览
          </Button>
          {error && (
            <div role="alert" className="notice error">
              {error}
            </div>
          )}
        </Modal>
      )}
      {open && preview && (
        <Modal title="预览分享计划" onClose={() => P(null)}>
          <h3>{preview.plan.name}</h3>
          <p>
            {preview.plan.minecraft} · {preview.plan.loader.type}{" "}
            {preview.plan.loader.version} · {preview.plan.mods.length} 个模组
          </p>
          <p>
            已重新查询真实版本。导入只创建待确认任务，开始搭建前还会再次确认。
          </p>
          {preview.plan.mods.map((r) => (
            <p key={`${r.source}:${r.projectId}`}>
              <b>{r.name}</b> · {r.projectId} / {r.versionId}
            </p>
          ))}
          <Button
            type="button"
            primary
            busy={busy}
            onClick={() => {
              B(true);
              void api<{ task: AgentTask }>("agent_import_plan", {
                directoryId: s.directoryId,
                plan: preview.plan,
                importHash: preview.importHash,
                confirmed: true,
              })
                .then((v) => {
                  a.receive({ taskId: v.task.id, type: "plan", task: v.task });
                  a.select(v.task.id);
                  setOpen(false);
                  P(null);
                })
                .catch((e) => E(String(e)))
                .finally(() => B(false));
            }}
          >
            确认导入为新任务
          </Button>
          {error && (
            <div role="alert" className="notice error">
              {error}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
export function AgentAdvanced({
  task,
  group,
}: {
  task: AgentTask;
  group: "versions" | "share" | "performance";
}) {
  const s = useStore(),
    a = useAgent();
  const [busy, B] = useState(false);
  const [error, E] = useState("");
  const [data, D] = useState<Record<string, unknown> | null>(null);
  const [pending, P] = useState<{
    tool: string;
    args: Record<string, unknown>;
    title: string;
  } | null>(null);
  const [migration, M] = useState<{
    plan: Migration;
    migrationHash: string;
  } | null>(null);
  const [target, Target] = useState("1.21.1");
  const [loader, Loader] = useState("fabric");
  const [loaderVersion, LV] = useState("");
  const [copyConfigs, CC] = useState(true);
  const [copySaves, CS] = useState(false);
  const [drop, Drop] = useState(false);
  const [preset, Preset] = useState("balanced");
  const [installMods, IM] = useState(false);
  const [share, Share] = useState("");
  const request = useRef<string | null>(null);
  useEffect(() => {
    E("");
    D(null);
    M(null);
    Share("");
    P(null);
  }, [task.id]);
  async function call(
    tool: string,
    args: Record<string, unknown> = {},
    write = false,
  ) {
    if (busy) return null;
    B(true);
    E("");
    request.current = write ? task.id : crypto.randomUUID();
    try {
      const result = await api<Record<string, unknown>>("agent_tool", {
        taskId: task.id,
        planHash: task.planHash,
        directoryId: task.directoryId,
        tool,
        args: { id: task.instanceId, ...args },
        requestId: write ? undefined : request.current,
        confirmed: write,
        accountId: s.accountId,
        settings: s.settings,
      });
      D(result);
      if (write) {
        const next = await api<AgentTask>("agent_get", { taskId: task.id });
        a.receive({ taskId: next.id, type: "state", task: next });
        await s.refresh();
        if (typeof result.newTaskId === "string") {
          const target = await api<AgentTask>("agent_get", {
            taskId: result.newTaskId,
          });
          a.receive({ taskId: target.id, type: "state", task: target });
          a.select(target.id);
        }
      }
      return result;
    } catch (e) {
      E(String(e).replace(/^Error: /, ""));
      return null;
    } finally {
      request.current = null;
      B(false);
    }
  }
  if (!task.confirmedHash) return null;
  const disabled = busy || running(task.status);
  const update = data?.preview as
    | {
        available?: boolean;
        differences?: Record<string, string[]>;
        downloadBytes?: number;
        current?: { versionNumber: string };
        candidate?: {
          versionId?: string;
          versionNumber: string;
          notes: string;
          estimatedDownloadBytes: number;
        };
        preservedUserFiles?: string[];
        warnings?: string[];
      }
    | undefined;
  return (
    <div className="agent-advanced">
      <div className="agent-tools-grid">
        {group === "versions" && (
          <section>
            <h4>在线整合包更新</h4>
            {!!data?.ignoredVersion && (
              <Button
                type="button"
                onClick={() => {
                  localStorage.removeItem(
                    `kynex-pack-ignore:${task.instanceId}`,
                  );
                  D(null);
                }}
              >
                清除忽略记录
              </Button>
            )}
            <p>
              仅支持已记录来源的 Modrinth / CurseForge
              整合包。手动搭建的包可用模组管理更新。
            </p>
            <div className="agent-actions">
              <Button
                type="button"
                disabled={disabled}
                onClick={() =>
                  void call("pack_update_check").then((v) => {
                    const preview = v?.preview as
                      | {
                          candidate?: {
                            versionId?: string;
                            versionNumber?: string;
                          };
                        }
                      | undefined;
                    const version =
                      preview?.candidate?.versionId ||
                      preview?.candidate?.versionNumber;
                    if (
                      version &&
                      localStorage.getItem(
                        `kynex-pack-ignore:${task.instanceId}`,
                      ) === version
                    ) {
                      D({
                        note: "你已忽略此发行版本，可清除忽略后重新检查。",
                        ignoredVersion: version,
                      });
                    }
                  })
                }
              >
                检查整合包更新
              </Button>
              <Button
                type="button"
                disabled={disabled || !task.results?.pack_update_apply}
                onClick={() =>
                  P({
                    tool: "pack_update_rollback",
                    args: {},
                    title: "恢复到更新前",
                  })
                }
              >
                恢复到更新前
              </Button>
            </div>
            {update?.candidate && (
              <article className="agent-update-card">
                <b>
                  {update.current?.versionNumber} →{" "}
                  {update.candidate.versionNumber}
                </b>
                <p>
                  文件下载约 {readableSize(update.downloadBytes || 0)}
                  ，整合包文件约{" "}
                  {readableSize(update.candidate.estimatedDownloadBytes || 0)}。
                </p>
                <p>{update.candidate.notes || "暂无更新说明"}</p>
                {Object.entries(update.differences || {}).map(
                  ([kind, files]) => (
                    <section className="agent-difference" key={kind}>
                      <h5>
                        {(
                          {
                            added: "新增",
                            changed: "更改",
                            removed: "移除未修改的管理文件",
                            preserved: "保留用户文件",
                          } as Record<string, string>
                        )[kind] || kind}
                        （{files.length}）
                      </h5>
                      {files.map((file, i) => (
                        <p key={i}>{file}</p>
                      ))}
                    </section>
                  ),
                )}
                {update.warnings?.map((v, i) => (
                  <p key={i}>{v}</p>
                ))}
                <div className="agent-actions">
                  <Button
                    type="button"
                    primary
                    disabled={disabled || !update.available}
                    onClick={() =>
                      P({
                        tool: "pack_update_apply",
                        args: { updateHash: data?.updateHash },
                        title: "确认更新整合包",
                      })
                    }
                  >
                    更新并验证
                  </Button>
                  <Button type="button" onClick={() => D(null)}>
                    稍后
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      const id = `kynex-pack-ignore:${task.instanceId}`;
                      localStorage.setItem(
                        id,
                        update.candidate!.versionId ||
                          update.candidate!.versionNumber,
                      );
                      D(null);
                      s.notify("已忽略此发行版本。");
                    }}
                  >
                    忽略此版本
                  </Button>
                </div>
              </article>
            )}
          </section>
        )}
        {group === "versions" && (
          <section>
            <h4>迁移到新版本</h4>
            <p>
              会另外建一套游戏，旧的还可以继续玩。找不到合适版本的模组会单独列出来。
            </p>
            <label>
              目标 Minecraft
              <input
                className="input"
                aria-label="迁移目标 Minecraft"
                value={target}
                onChange={(e) => Target(e.target.value)}
              />
            </label>
            <div className="agent-actions">
              {["vanilla", "fabric", "quilt", "forge", "neoforge"].map((v) => (
                <Button
                  type="button"
                  key={v}
                  aria-pressed={loader === v}
                  onClick={() => {
                    Loader(v);
                    LV("");
                  }}
                >
                  {v === "vanilla" ? "原版" : v}
                </Button>
              ))}
            </div>
            <label>
              目标加载器版本（留空查询兼容版本）
              <input
                className="input"
                aria-label="迁移加载器版本"
                value={loaderVersion}
                onChange={(e) => LV(e.target.value)}
              />
            </label>
            <Button
              type="button"
              disabled={disabled}
              onClick={() =>
                void call("migration_plan", {
                  target: { minecraft: target, loader, loaderVersion },
                }).then((v) => {
                  if (v?.plan)
                    M(
                      v as unknown as {
                        plan: Migration;
                        migrationHash: string;
                      },
                    );
                })
              }
            >
              查看换版本方案
            </Button>
            {migration && (
              <>
                <div className="agent-migration-compare">
                  <div>
                    <b>原实例</b>
                    <p>{task.plan?.name}</p>
                    <p>
                      {task.plan?.minecraft} · {task.plan?.loader.type}
                    </p>
                  </div>
                  <div>
                    <b>新实例</b>
                    <p>
                      {migration.plan.target.minecraft} ·{" "}
                      {migration.plan.target.loader}{" "}
                      {migration.plan.target.loaderVersion}
                    </p>
                    <p>
                      模组下载约{" "}
                      {readableSize(migration.plan.estimatedDownloadBytes)}
                    </p>
                  </div>
                </div>
                {[
                  ["keep", "保留"],
                  ["replace", "替换"],
                  ["drop", "不迁移"],
                ].map(([kind, label]) => (
                  <section className="agent-difference" key={kind}>
                    <h5>
                      {label}（
                      {
                        migration.plan.mappings.filter((v) => v.action === kind)
                          .length
                      }
                      ）
                    </h5>
                    {migration.plan.mappings
                      .filter((v) => v.action === kind)
                      .map((v, i) => (
                        <p key={i}>
                          <b>{v.name}</b> · {v.reason}
                        </p>
                      ))}
                  </section>
                ))}
                {migration.plan.unresolved.length > 0 && (
                  <div className="notice error">
                    <b>找不到合适版本的模组</b>
                    {migration.plan.unresolved.map((v, i) => (
                      <p key={i}>{v}</p>
                    ))}
                    <label>
                      <input
                        type="checkbox"
                        checked={drop}
                        onChange={(e) => Drop(e.target.checked)}
                      />
                      我确认这些项目不迁移到新实例
                    </label>
                  </div>
                )}
                {migration.plan.configWarnings.map((v, i) => (
                  <p key={i}>{v}</p>
                ))}
                <label>
                  <input
                    type="checkbox"
                    checked={copyConfigs}
                    onChange={(e) => CC(e.target.checked)}
                  />
                  复制可以沿用的设置
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={copySaves}
                    onChange={(e) => CS(e.target.checked)}
                  />
                  单独备份并复制存档（跨版本可能转换世界）
                </label>
                <Button
                  type="button"
                  primary
                  disabled={
                    disabled || (migration.plan.unresolved.length > 0 && !drop)
                  }
                  onClick={() =>
                    P({
                      tool: "migration_apply",
                      args: {
                        ...migration,
                        copyConfigs,
                        copySaves,
                        allowUnresolved: drop,
                      },
                      title: "确认创建新版本游戏",
                    })
                  }
                >
                  确认换版本方案
                </Button>
              </>
            )}
          </section>
        )}
        {group === "share" && (
          <section>
            <h4>分享计划</h4>
            <p>
              只包含安全计划和真实资源 ID，不包含
              Key、路径、日志、存档或未识别本地模组。
            </p>
            <Button
              type="button"
              disabled={disabled}
              onClick={() =>
                void call("share_code_create", { plan: task.plan }).then(
                  (v) => {
                    if (typeof v?.code === "string") Share(v.code);
                  },
                )
              }
            >
              生成分享码
            </Button>
            {share && (
              <>
                <textarea readOnly aria-label="生成的分享码" value={share} />
                <div className="agent-actions">
                  <Button
                    type="button"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(share)
                        .then(() => s.notify("分享码已复制。"))
                        .catch(() => E("复制失败，请手动选择分享码。"))
                    }
                  >
                    复制分享码
                  </Button>
                  <Button
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      P({
                        tool: "share_code_save",
                        args: { code: share },
                        title: "保存分享文件",
                      })
                    }
                  >
                    保存 .kxlpack
                  </Button>
                </div>
              </>
            )}
          </section>
        )}
        {group === "performance" && (
          <section>
            <h4>性能建议</h4>
            <div className="agent-actions">
              {[
                ["low", "低配"],
                ["balanced", "均衡"],
                ["high", "高配"],
              ].map(([id, label]) => (
                <label key={id}>
                  <input
                    type="radio"
                    name={`performance-${task.id}`}
                    checked={preset === id}
                    onChange={() => Preset(id)}
                  />
                  {label}
                </label>
              ))}
            </div>
            <label>
              <input
                type="checkbox"
                checked={installMods}
                onChange={(e) => IM(e.target.checked)}
              />
              查询并安装本地性能表中的兼容优化模组
            </label>
            <Button
              type="button"
              disabled={disabled}
              onClick={() =>
                void call("performance_analyze", { preset, installMods })
              }
            >
              分析硬件与当前配置
            </Button>
            {!!data?.proposal && (
              <>
                <PerformancePreview data={data} />
                <Button
                  type="button"
                  primary
                  disabled={disabled}
                  onClick={() =>
                    P({
                      tool: "performance_apply",
                      args: {
                        preset,
                        installMods,
                        performanceHash: data.performanceHash,
                      },
                      title: "应用性能建议并验证",
                    })
                  }
                >
                  应用并验证
                </Button>
              </>
            )}
          </section>
        )}
      </div>
      {busy && (
        <div role="status">
          <p>正在处理。改动前会先备份。</p>
          <Button
            type="button"
            onClick={() =>
              request.current &&
              void api("agent_cancel", { taskId: request.current }).catch((e) =>
                E(String(e)),
              )
            }
          >
            停止本次操作
          </Button>
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {data && <ToolResult data={data} />}
      {pending && (
        <Modal title={pending.title} onClose={() => P(null)}>
          <p>
            {pending.tool === "migration_apply"
              ? "会按方案创建并启动一套新游戏。勾选的存档会先备份，再复制过去。"
              : pending.tool === "pack_update_apply"
                ? "会先下载新版，再更新整合包的文件。自己的模组、设置和存档会保留。要是新版启动失败，会恢复更新前的状态。"
                : "会先备份，再按你看到的方案操作。"}
          </p>
          <Button
            primary
            type="button"
            busy={busy}
            onClick={() => {
              const next = pending;
              P(null);
              void call(next.tool, next.args, true);
            }}
          >
            确认执行
          </Button>
        </Modal>
      )}
    </div>
  );
}
export function PerformancePreview({
  data,
}: {
  data: Record<string, unknown>;
}) {
  const hardware = data.hardware as
    | {
        cpu?: string;
        logicalCores?: number;
        memoryMb?: number;
        gpus?: { name: string; vramMb: number }[];
      }
    | undefined;
  const current = data.current as
    | {
        memoryMb?: number;
        modCount?: number;
        shaderCount?: number;
        options?: Record<string, unknown>;
      }
    | undefined;
  const proposal = data.proposal as
    | {
        memoryMb?: number;
        options?: Record<string, unknown>;
        mods?: { name: string }[];
        estimatedDownloadBytes?: number;
      }
    | undefined;
  const optionLabels: Record<string, string> = {
    renderDistance: "渲染距离",
    simulationDistance: "模拟距离",
    maxFps: "帧率上限",
  };
  return (
    <div className="agent-performance">
      <h4>本地硬件</h4>
      <p>
        {hardware?.cpu || "CPU 型号未能读取"} · {hardware?.logicalCores || "—"}{" "}
        逻辑核心
      </p>
      <p>
        系统内存 {hardware?.memoryMb ? `${hardware.memoryMb} MB` : "未能读取"}
      </p>
      {hardware?.gpus?.map((g, i) => (
        <p key={i}>
          {g.name} · {g.vramMb > 0 ? `${g.vramMb} MB 专用显存` : "共享显存"}
        </p>
      ))}
      <div className="agent-migration-compare">
        <div>
          <b>当前</b>
          <p>内存 {current?.memoryMb || "—"} MB</p>
          <p>
            {current?.modCount || 0} 个模组 · {current?.shaderCount || 0}{" "}
            个光影文件
          </p>
          {Object.entries(current?.options || {}).map(([k, v]) => (
            <p key={k}>
              {optionLabels[k] || k}：{String(v)}
            </p>
          ))}
        </div>
        <div>
          <b>建议</b>
          <p>内存 {proposal?.memoryMb || "—"} MB</p>
          {Object.entries(proposal?.options || {}).map(([k, v]) => (
            <p key={k}>
              {optionLabels[k] || k}：{String(v)}
            </p>
          ))}
          {proposal?.mods?.map((m, i) => (
            <p key={i}>兼容候选：{m.name}</p>
          ))}
        </div>
      </div>
      <p>
        候选模组预计下载 {readableSize(proposal?.estimatedDownloadBytes || 0)}
        。模组需要的其他文件另算。
      </p>
      <p>只报告实际修改及启动耗时，不承诺 FPS 提升。</p>
    </div>
  );
}
