import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Trash2 } from "lucide-react";
import { Button, Card, Badge, ChoiceSelect, Modal } from "../../components/ui";
import { api, desktop, readableSize } from "../../lib/bridge";
import { useStore } from "../../store";
import {
  useAgent,
  running,
  type AgentTask,
  type AgentEvent,
  type PackPlan,
} from "./agentStore";
import "./agent.css";
import { AgentAdvanced, TemplateGallery, ShareImport } from "./AgentAdvanced";
import { AgentTools, TranslationProgress } from "./AgentTools";
import { useGuideSection } from "../../lib/guideNavigation";
export function openWorkshop() {
  window.dispatchEvent(new Event("kynex-close-assistant"));
  useStore.getState().setPage("workshop");
}

export async function startWorkshop(request: string, mode = "confirm") {
  const s = useStore.getState(),
    a = useAgent.getState();
  openWorkshop();
  a.fail("");
  if (a.starting) return;
  useAgent.setState({ starting: true });
  try {
    const r = await api<{
      taskId?: string;
      task?: AgentTask;
      rejected?: boolean;
      reason?: string;
    }>("agent_start", {
      request,
      mode,
      autoConsent: mode === "auto",
      directoryId: s.directoryId,
    });
    if (r.rejected) {
      a.fail(r.reason || "此需求超出游戏范围。");
      return;
    }
    if (r.task) {
      a.receive({ taskId: r.task.id, type: "state", task: r.task });
      a.select(r.task.id);
    }
  } catch (e) {
    a.fail(String(e).replace(/^Error: /, ""));
  } finally {
    useAgent.setState({ starting: false });
  }
}
const operationNames: Record<string, string> = {
  snapshot_instance: "备份游戏文件",
  create_instance: "新建一套游戏",
  install_game: "安装游戏",
  install_loader: "安装加载器",
  install_mods_batch: "安装模组",
  install_resources: "安装资源包和光影",
  install_localization: "准备中文翻译",
  patch_config: "调整游戏设置",
  set_instance_settings: "设置内存和 Java",
  launch_verify: "试着启动游戏",
  finish: "完成搭建",
  repair_instance: "修复游戏",
  pack_update_apply: "更新整合包",
  pack_update_rollback: "恢复到更新前",
  migration_apply: "创建新版本游戏",
  performance_apply: "调整性能设置",
  localization_translate: "补上中文翻译",
  localization_community: "安装社区汉化",
  export_pack: "导出整合包",
};
const taskViews = [
  ["overview", "概览"],
  ["progress", "进度与备份"],
  ["localization", "汉化"],
  ["maintenance", "配置与排错"],
  ["versions", "更新与迁移"],
  ["export", "导出与分享"],
] as const;
type TaskView = (typeof taskViews)[number][0];

const statuses: Record<string, string> = {
  classifying: "检查需求",
  planning: "正在查询真实资源并规划",
  awaiting_approval: "等待确认",
  executing: "正在搭建",
  translating: "正在处理汉化",
  verifying: "正在启动验证",
  done: "已完成",
  failed: "已停止，请查看原因",
  cancelled: "已取消",
  updating: "正在更新",
  migrating: "正在迁移",
  repairing: "正在修复",
};
export function PlanCard({
  plan,
  maintenance = false,
}: {
  plan: PackPlan;
  maintenance?: boolean;
}) {
  const [details, setDetails] = useState<"mods" | "settings" | null>(null);
  return (
    <Card className="agent-plan">
      <h3>{plan.name}</h3>
      <div className="agent-facts">
        <Badge>{plan.minecraft}</Badge>
        <Badge>
          {plan.loader.type} {plan.loader.version}
        </Badge>
        <Badge>{plan.memoryMb} MB</Badge>
        <Badge>{plan.mods.length} 个模组</Badge>
        <Badge>预计 {readableSize(plan.estimatedDownloadBytes)}</Badge>
      </div>
      <p>
        {maintenance
          ? "这里先打开当前这套游戏的维护工具。每次改动前，还会请你确认。"
          : "确认后会另建一套游戏，下载需要的文件，并按方案设置。"}
      </p>
      {plan.mods.length > 0 && (
        <Button type="button" onClick={() => setDetails("mods")}>
          查看模组清单（{plan.mods.length}）
        </Button>
      )}
      {details === "mods" && (
        <Modal
          title="模组清单"
          className="agent-workshop-modal"
          wide
          onClose={() => setDetails(null)}
        >
          {plan.mods.map((r) => (
            <article
              className="agent-resource"
              key={`${r.source}:${r.projectId}`}
            >
              <b>{r.name}</b>
              <small>
                {r.source === "modrinth" ? "Modrinth" : "CurseForge"} ·{" "}
                {r.side === "client"
                  ? "玩家端"
                  : r.side === "server"
                    ? "服务器端"
                    : "两边都能用"}{" "}
                · {r.required ? "必需" : "可选"}
              </small>
              <p>{r.reason}</p>
              <small>
                资源 ID{" "}
                <code>
                  {r.projectId} / {r.versionId}
                </code>
              </small>
            </article>
          ))}
        </Modal>
      )}
      {[...plan.notes, ...plan.warnings].map((s, i) => (
        <p className="agent-note" key={i}>
          {s}
        </p>
      ))}
      <Button type="button" onClick={() => setDetails("settings")}>
        资源、汉化和配置详情
      </Button>
      {details === "settings" && (
        <Modal
          title="资源、汉化和配置详情"
          className="agent-workshop-modal"
          wide
          onClose={() => setDetails(null)}
        >
          <pre>
            {JSON.stringify(
              {
                resourcePacks: plan.resourcePacks,
                shaders: plan.shaders,
                localization: plan.localization,
                options: plan.options,
                configPatches: plan.configPatches,
              },
              null,
              2,
            )}
          </pre>
        </Modal>
      )}
    </Card>
  );
}
export function useWorkshopEvents() {
  useEffect(() => {
    if (!desktop) return;
    let alive = true;
    const subscription = listen<AgentEvent>("kynex-agent", ({ payload }) => {
      if (!alive) return;
      const store = useAgent.getState();
      const completed =
        payload.task?.status === "done" &&
        store.tasks.find((task) => task.id === payload.taskId)?.status !==
          "done";
      store.receive(payload);
      if (payload.type === "error" && payload.task?.error)
        useStore.getState().notify(payload.task.error);
      if (completed)
        void useStore
          .getState()
          .refresh()
          .catch(() => {});
    });
    void subscription
      .then(() => api<AgentTask[]>("agent_list"))
      .then((tasks) => {
        if (!alive) return;
        const store = useAgent.getState();
        const receivedIds = new Set(store.tasks.map((task) => task.id));
        store.replace([
          ...store.tasks,
          ...tasks.filter((task) => !receivedIds.has(task.id)),
        ]);
      })
      .catch((error) => {
        if (alive)
          useAgent.getState().fail(String(error).replace(/^Error: /, ""));
      });
    return () => {
      alive = false;
      void subscription.then((fn) => fn()).catch(() => {});
    };
  }, []);
}

export function AgentPanel() {
  const a = useAgent();
  const s = useStore();
  const [request, R] = useState("");
  const [taskView, setTaskView] = useState<{ id: string; view: TaskView }>({
    id: "",
    view: "overview",
  });
  const [busy, B] = useState(false);
  const [automatic, Automatic] = useState(false);
  const [snapshot, Snapshot] = useState("");
  const [confirm, C] = useState<"build" | "rollback" | null>(null);
  const [deleteTask, setDeleteTask] = useState<AgentTask | null>(null);
  const task = a.tasks.find((t) => t.id === a.selected);
  const active = !!task && running(task.status);
  const view = task && taskView.id === task.id ? taskView.view : "overview";
  useGuideSection("workshop", (section) => {
    if (!task) return;
    const next = taskViews.find(([key]) => key === section)?.[0];
    if (
      next &&
      (next === "overview" || next === "progress" || task.confirmedHash)
    ) {
      setTaskView({ id: task.id, view: next });
    }
  });
  useEffect(() => {
    if (!a.error) return;
    const timer = setTimeout(() => useAgent.getState().fail(""), 5000);
    return () => clearTimeout(timer);
  }, [a.error]);
  useEffect(() => {
    Snapshot("");
  }, [task?.id]);

  async function deleteRecord() {
    if (!deleteTask || busy) return;
    B(true);
    a.fail("");
    try {
      await api("agent_delete", { taskId: deleteTask.id });
      a.remove(deleteTask.id);
      setDeleteTask(null);
      s.notify("已删除任务记录");
    } catch (e) {
      a.fail(String(e).replace(/^Error: /, ""));
      setDeleteTask(null);
    } finally {
      B(false);
    }
  }
  async function action(
    command: string,
    payload: Record<string, unknown> = {},
  ) {
    if (!task || busy) return;
    B(true);
    a.fail("");
    try {
      await api(command, {
        taskId: task.id,
        planHash: task.planHash,
        accountId: s.accountId,
        settings: s.settings,
        ...payload,
      });
      const next = await api<AgentTask>("agent_get", { taskId: task.id });
      a.receive({ taskId: next.id, type: "state", task: next });
    } catch (e) {
      a.fail(String(e).replace(/^Error: /, ""));
    } finally {
      B(false);
      C(null);
    }
  }
  return (
    <section className="agent-panel" aria-label="AI 整合包工坊">
      <header>
        <h1>AI 整合包工坊</h1>
        <div className="agent-actions">
          <Button
            type="button"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("kynex-open-guide", {
                  detail: { page: "workshop" },
                }),
              )
            }
          >
            使用引导
          </Button>
          <Button
            type="button"
            onClick={() =>
              window.dispatchEvent(new Event("kynex-open-assistant"))
            }
          >
            返回对话
          </Button>
        </div>
      </header>
      <div className="agent-workspace">
        <aside className="agent-sidebar">
          <Card className="agent-controls">
            <div className="agent-actions">
              <TemplateGallery onSelect={R} />
              <ShareImport />
              <Button
                type="button"
                disabled={active || busy || !s.selected}
                onClick={() => {
                  B(true);
                  void api<{ task: AgentTask }>("agent_attach", {
                    directoryId: s.directoryId,
                    id: s.selected,
                  })
                    .then((v) => {
                      a.receive({
                        taskId: v.task.id,
                        type: "plan",
                        task: v.task,
                      });
                      a.select(v.task.id);
                    })
                    .catch((e) => a.fail(String(e)))
                    .finally(() => B(false));
                }}
              >
                维护当前实例
              </Button>
            </div>
            <label className="agent-request">
              想制作什么整合包？
              <textarea
                value={request}
                onChange={(e) => R(e.target.value)}
                placeholder="例如：做一个 1.20.1 Fabric 轻量冒险包，4GB 内存"
                disabled={active || busy}
              />
            </label>
            <label className="agent-automatic">
              <input
                type="checkbox"
                checked={automatic}
                onChange={(e) => Automatic(e.target.checked)}
                disabled={active || busy}
              />
              确认后自动搭建。启动失败时最多尝试修复三次。
            </label>
            <div className="agent-actions">
              <Button
                type="button"
                primary
                busy={a.starting}
                disabled={active || busy || !request.trim()}
                onClick={() =>
                  void startWorkshop(request, automatic ? "auto" : "confirm")
                }
              >
                生成计划
              </Button>
            </div>
          </Card>
          {a.error && (
            <div className="notice error" role="alert">
              {a.error}
            </div>
          )}
          <Card className="agent-history">
            <h2>任务记录（{a.tasks.length}）</h2>
            {a.tasks.length === 0 && <p>暂无任务</p>}
            <ul className="agent-task-list">
              {a.tasks.map((record) => {
                const name = record.plan?.name || record.request.slice(0, 24);
                return (
                  <li key={record.id}>
                    <button
                      type="button"
                      onClick={() => a.select(record.id)}
                      aria-pressed={a.selected === record.id}
                    >
                      <strong>{name}</strong>
                      <small>{statuses[record.status] || record.status}</small>
                    </button>
                    {!running(record.status) && (
                      <Button
                        type="button"
                        title="删除任务记录"
                        aria-label={"删除任务记录：" + name}
                        disabled={busy}
                        onClick={() => setDeleteTask(record)}
                      >
                        <Trash2 size={16} />
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        </aside>
        <Card className="agent-detail" key={task?.id || "empty"}>
          {task ? (
            <>
              {view !== "overview" && (
                <h2 className="agent-selected-title">
                  {task.plan?.name || task.request.slice(0, 24)}
                </h2>
              )}
              <div className="agent-status" role="status">
                <b>{statuses[task.status] || task.status}</b>
                <span>
                  已下载 {readableSize(task.budget.downloadedBytes || 0)} / 2 GB
                </span>
              </div>
              {task.status === "translating" && view !== "localization" && (
                <TranslationProgress task={task} />
              )}
              {active && task.status !== "translating" && (
                <>
                  <progress
                    max={Math.max(1, task.steps.length)}
                    value={task.steps.filter((v) => v.status === "done").length}
                    aria-label="工坊步骤进度"
                  />
                  <p>{a.progress[task.id]?.stage}</p>
                  <Button
                    type="button"
                    onClick={() =>
                      void api("agent_cancel", { taskId: task.id }).catch((e) =>
                        a.fail(String(e)),
                      )
                    }
                  >
                    停止任务
                  </Button>
                </>
              )}
              <nav className="agent-tabs" aria-label="任务详情">
                {taskViews
                  .filter(
                    ([key]) =>
                      key === "overview" ||
                      key === "progress" ||
                      task.confirmedHash,
                  )
                  .map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={view === key}
                      data-workshop-view={key}
                      onClick={() => setTaskView({ id: task.id, view: key })}
                    >
                      {label}
                    </button>
                  ))}
              </nav>
              <div hidden={view !== "overview"} className="agent-tab-content">
                {task.plan && (
                  <PlanCard plan={task.plan} maintenance={task.maintenance} />
                )}
                {task.status === "awaiting_approval" && (
                  <div className="agent-actions">
                    <Button
                      type="button"
                      onClick={() => {
                        s.notify("计划已保存在本地任务记录中。");
                      }}
                    >
                      仅保存计划
                    </Button>
                    <Button type="button" primary onClick={() => C("build")}>
                      {task.maintenance ? "启用维护工具" : "开始搭建"}
                    </Button>
                    <Button
                      type="button"
                      onClick={() => void action("agent_cancel")}
                    >
                      取消
                    </Button>
                  </div>
                )}
                {["failed", "cancelled"].includes(task.status) &&
                  !task.maintenance &&
                  !!task.confirmedHash && (
                    <div className="agent-actions">
                      <Button
                        type="button"
                        disabled={busy}
                        onClick={() => void action("agent_resume")}
                      >
                        从已完成步骤继续
                      </Button>
                      {task.rollbackSnapshot && (
                        <Button
                          type="button"
                          disabled={busy}
                          onClick={() => C("rollback")}
                        >
                          回滚到执行前
                        </Button>
                      )}
                    </div>
                  )}
                {task.status === "done" && (
                  <div className="agent-actions">
                    <Button
                      type="button"
                      onClick={() => {
                        useStore.setState({ selected: task.instanceId });
                        s.setPage("library");
                      }}
                    >
                      在实例库查看
                    </Button>
                    <Button
                      type="button"
                      disabled={busy}
                      onClick={() => C("rollback")}
                    >
                      回滚
                    </Button>
                  </div>
                )}
              </div>
              <div hidden={view !== "progress"} className="agent-tab-content">
                {task.error && (
                  <section className="agent-log-section">
                    <h3>最近一次结果</h3>
                    <p>{task.error}</p>
                  </section>
                )}
                {!!task.steps.length && (
                  <ol className="agent-timeline">
                    {task.steps.map((step, i) => (
                      <li key={i} data-status={step.status}>
                        <div>
                          <b>{step.name}</b>
                          <span>
                            {step.status === "done"
                              ? "完成"
                              : step.status === "running"
                                ? "进行中"
                                : step.status === "failed"
                                  ? "失败"
                                  : "等待"}
                            {step.elapsedMs > 0
                              ? ` · ${(step.elapsedMs / 1000).toFixed(1)}s`
                              : ""}
                          </span>
                        </div>
                        {step.detail && <p>{step.detail}</p>}
                      </li>
                    ))}
                  </ol>
                )}
                {task.snapshots.length > 0 && (
                  <section className="agent-log-section">
                    <h3>从备份恢复</h3>
                    <ChoiceSelect
                      aria-label="选择备份"
                      value={snapshot}
                      onValueChange={Snapshot}
                      options={[
                        { value: "", label: "开始前的备份" },
                        ...task.snapshots.map((id, index) => ({
                          value: id,
                          label: `第 ${index + 1} 份备份`,
                          hint: task.steps.find(
                            (step) => step.snapshotId === id,
                          )?.name,
                        })),
                      ]}
                    />
                    <Button
                      type="button"
                      disabled={active || busy}
                      onClick={() => C("rollback")}
                    >
                      恢复这份备份
                    </Button>
                  </section>
                )}
                {!!task.audit.length && (
                  <section className="agent-log-section">
                    <h3>操作记录</h3>
                    {task.audit.map((v, i) => (
                      <p key={i}>
                        {operationNames[v.tool] ?? "工坊操作"} · {v.result} ·{" "}
                        {(v.elapsedMs / 1000).toFixed(1)}s
                      </p>
                    ))}
                  </section>
                )}
                {!task.error &&
                  task.steps.length === 0 &&
                  task.snapshots.length === 0 &&
                  task.audit.length === 0 && (
                    <p className="muted">任务开始后会显示进度和操作记录。</p>
                  )}
              </div>
              {task.confirmedHash && (
                <>
                  <div hidden={view !== "localization"}>
                    <AgentTools task={task} group="localization" />
                  </div>
                  <div
                    hidden={view !== "maintenance"}
                    className="agent-tab-content"
                  >
                    <AgentTools task={task} group="maintenance" />
                    <AgentAdvanced task={task} group="performance" />
                  </div>
                  <div hidden={view !== "versions"}>
                    <AgentAdvanced task={task} group="versions" />
                  </div>
                  <div hidden={view !== "export"} className="agent-tab-content">
                    <AgentTools task={task} group="export" />
                    <AgentAdvanced task={task} group="share" />
                  </div>
                </>
              )}
            </>
          ) : (
            <p className="agent-empty">
              生成计划或选择任务后，在这里查看详情。
            </p>
          )}
        </Card>
      </div>
      {deleteTask && (
        <Modal
          title="删除任务记录"
          onClose={() => {
            if (!busy) setDeleteTask(null);
          }}
        >
          <p>
            删除「{deleteTask.plan?.name || deleteTask.request.slice(0, 24)}
            」的任务记录？对应的游戏、存档和模组会保留。
          </p>
          <div className="agent-actions">
            <Button
              type="button"
              disabled={busy}
              onClick={() => setDeleteTask(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              primary
              busy={busy}
              onClick={() => void deleteRecord()}
            >
              删除记录
            </Button>
          </div>
        </Modal>
      )}
      {confirm && task && (
        <Modal
          title={
            confirm === "build"
              ? task.maintenance
                ? "确认启用维护工具"
                : "确认搭建整合包"
              : "确认回滚"
          }
          onClose={() => C(null)}
        >
          <p>
            {confirm === "build"
              ? task.maintenance
                ? "只关联当前实例并启用维护工具，此步不会安装资源或修改配置。每次实际写操作仍需单独确认。"
                : "将创建独立实例并下载游戏、加载器、模组和它们需要的文件，写入计划列出的配置，最后短暂启动游戏验证。每步操作前都会备份。请先关闭其他游戏。"
              : "将恢复本任务执行前的配置和资源，存档不会被修改；恢复前会再次备份当前状态。"}
          </p>
          {confirm === "build" && !s.accountId && (
            <p>请先在启动器选择账号；没有账号时可以安装，但启动验证会暂停。</p>
          )}
          <Button
            primary
            type="button"
            busy={busy}
            onClick={() =>
              void action(
                confirm === "build" ? "agent_confirm" : "agent_tool",
                confirm === "rollback"
                  ? {
                      tool: "restore_snapshot",
                      confirmed: true,
                      args: { snapshotId: snapshot || task.rollbackSnapshot },
                    }
                  : {},
              )
            }
          >
            确认{confirm === "build" ? "并开始" : "回滚"}
          </Button>
        </Modal>
      )}
    </section>
  );
}
