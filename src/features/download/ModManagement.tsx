import { useEffect, useState, useRef, useId, type ReactNode } from "react";
import { api, desktop, saveFile } from "../../lib/bridge";
import { useStore } from "../../store";
import { useModUpdateState, type ModUpdate } from "../../lib/modUpdateState";
export type { ModUpdate } from "../../lib/modUpdateState";
import { Button, Chip, OptionSelect, Modal, Badge } from "../../components/ui";
import { localizeProject } from "./modLocalization";
import type { Project, Resource } from "../../lib/types";
import "./resourceVersions.css";
type Version = {
  id: string;
  name: string;
  number: string;
  date: string;
  type: string;
  gameVersions?: string[];
  loaders?: string[];
  compatible?: boolean;
  filename?: string;
};
type VersionPage = { versions: Version[]; nextOffset?: number | null };
export function ResourceVersionPicker({
  project,
  id,
  kind = "mods",
  label = "模组",
  gameFilter = "",
  loaderFilter = "",
  close,
  install,
}: {
  project: Project;
  id: string;
  kind?: string;
  label?: string;
  gameFilter?: string;
  loaderFilter?: string;
  close: () => void;
  install: (id: string) => void;
}) {
  const s = useStore();
  const visualList = kind === "shaderpacks" || kind === "resourcepacks";
  const versionGroup = useId();
  const [rows, R] = useState<Version[]>([]);
  const [selected, S] = useState("");
  const [nextOffset, Next] = useState<number | null>(null);
  const [busy, B] = useState(true);
  const [moreBusy, MoreBusy] = useState(false);
  const [saving, Saving] = useState(false);
  const [error, E] = useState("");
  const generation = useRef(0);
  const chosen = rows.find((v) => v.id === selected);
  const [requirements, Requirements] = useState<{
    dependencies: { name: string; kind: string; installed: boolean }[];
    notes: string[];
  }>({ dependencies: [], notes: [] });
  const [requirementBusy, RequirementBusy] = useState(false);
  const [requirementError, RequirementError] = useState("");
  const [requirementRevision, RetryRequirements] = useState(0);
  useEffect(() => {
    let live = true;
    Requirements({ dependencies: [], notes: [] });
    RequirementError("");
    RequirementBusy(false);
    if (!chosen || chosen.compatible === false || !id || kind === "modpacks")
      return;
    RequirementBusy(true);
    void api<{
      dependencies: { name: string; kind: string; installed: boolean }[];
      notes: string[];
    }>("resource_requirements", {
      id,
      kind,
      project: project.project_id,
      source: project.source,
      versionId: chosen.id,
      curseforgeKey: s.settings.curseforgeKey,
    })
      .then((v) => {
        if (live) Requirements(v);
      })
      .catch((e) => {
        if (live) RequirementError(String(e));
      })
      .finally(() => {
        if (live) RequirementBusy(false);
      });
    return () => {
      live = false;
    };
  }, [
    id,
    kind,
    chosen?.id,
    chosen?.compatible,
    project.project_id,
    project.source,
    s.settings.curseforgeKey,
    requirementRevision,
  ]);
  async function loadPage(offset: number, token = generation.current) {
    if (offset === 0) B(true);
    else MoreBusy(true);
    E("");
    try {
      const reply = await api<VersionPage | Version[]>("project_versions", {
        id,
        kind,
        project: project.project_id,
        source: project.source,
        game: gameFilter,
        loader: loaderFilter,
        paged: true,
        offset,
        curseforgeKey: s.settings.curseforgeKey,
      });
      if (token !== generation.current) return;
      const values = Array.isArray(reply) ? reply : reply.versions;
      R((previous) => [
        ...new Map(
          [...(offset ? previous : []), ...values].map((v) => [v.id, v]),
        ).values(),
      ]);
      Next(Array.isArray(reply) ? null : (reply.nextOffset ?? null));
      if (offset === 0)
        S(
          values.find((v) => v.compatible !== false)?.id || values[0]?.id || "",
        );
    } catch (e) {
      if (token === generation.current) E(String(e));
    } finally {
      if (token === generation.current) {
        B(false);
        MoreBusy(false);
      }
    }
  }
  useEffect(() => {
    const token = ++generation.current;
    R([]);
    S("");
    Next(null);
    void loadPage(0, token);
    return () => {
      generation.current++;
    };
  }, [
    id,
    kind,
    project.project_id,
    project.source,
    gameFilter,
    loaderFilter,
    s.settings.curseforgeKey,
  ]);
  async function saveSelected() {
    if (!chosen || saving) return;
    Saving(true);
    E("");
    try {
      const path = await saveFile(
        chosen.filename ||
          `${project.slug || "resource"}.${kind === "mods" ? "jar" : "zip"}`,
      );
      if (!path) return;
      await api("download_resource_file", {
        id: id || undefined,
        source: project.source,
        project: project.project_id,
        versionId: chosen.id,
        kind,
        path,
        name: chosen.filename,
        curseforgeKey: s.settings.curseforgeKey,
      });
      s.notify("所选版本已下载到指定位置");
    } catch (e) {
      E(String(e));
    } finally {
      Saving(false);
    }
  }
  const requirementContent = (
    <>
      {requirementBusy && <p role="status">正在检查此版本的前置资源…</p>}
      {requirementError && (
        <div className="notice error">
          前置检查失败：{requirementError}
          <Button onClick={() => RetryRequirements((n) => n + 1)}>
            重试前置检查
          </Button>
        </div>
      )}
      {!!requirements.dependencies.length && (
        <div className="field">
          <b>此版本的必需前置</b>
          {requirements.dependencies.map((d, index) => (
            <p key={index}>
              {d.name} ·{" "}
              {(
                {
                  mods: "模组",
                  resourcepacks: "资源包",
                  shaderpacks: "光影",
                  datapacks: "数据包",
                } as Record<string, string>
              )[d.kind] || "资源"}{" "}
              · {d.installed ? "已安装匹配版本" : "将同时安装"}
            </p>
          ))}
        </div>
      )}
      {visualList && !!requirements.notes.length && <h4>使用提示</h4>}
      {requirements.notes.map((note, index) => (
        <p className="notice" key={index}>
          {note}
        </p>
      ))}
      {chosen?.compatible === false && (
        <div className="notice" role="status">
          此版本与当前实例不兼容，仍可另存为。安装时请先选择匹配的目标实例。
        </div>
      )}
    </>
  );
  const gameVersions = [...new Set(chosen?.gameVersions || [])].sort((a, b) =>
    b.localeCompare(a, undefined, { numeric: true }),
  );
  const releaseLabel = (v: Version) =>
    v.type === "release"
      ? "正式版"
      : v.type === "beta"
        ? "测试版 Beta"
        : "开发版 Alpha";
  return (
    <Modal
      title={
        visualList
          ? `选择${kind === "shaderpacks" ? "光影" : "材质包"}版本`
          : `选择 ${localizeProject(project).name} 的版本`
      }
      className={visualList ? "resource-version-modal" : ""}
      onClose={close}
      footer={
        <>
          <Button disabled={saving} onClick={close}>
            取消
          </Button>
          <Button
            busy={saving}
            disabled={busy || !chosen}
            onClick={() => void saveSelected()}
          >
            另存为
          </Button>
          <Button
            primary
            disabled={
              busy ||
              saving ||
              !chosen ||
              chosen.compatible === false ||
              (kind !== "modpacks" && !id) ||
              requirementBusy ||
              !!requirementError
            }
            onClick={() => install(selected)}
          >
            {kind === "datapacks" ? "下一步：选择存档" : "安装此版本"}
          </Button>
        </>
      }
    >
      {visualList ? (
        <div className="resource-version-picker">
          <div className="resource-version-intro">
            <h3>{localizeProject(project).name}</h3>
            <p>
              {[
                gameFilter ? `Minecraft ${gameFilter}` : "全部游戏版本",
                loaderFilter,
                project.source === "curseforge" ? "CurseForge" : "Modrinth",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="resource-version-columns">
            <section
              className="resource-version-catalogue"
              aria-label="可下载版本"
            >
              <div className="resource-version-list-heading">
                <h4>版本列表</h4>
                <span>已加载 {rows.length} 个版本</span>
              </div>
              {busy && <p role="status">正在获取版本…</p>}
              {error && (
                <div className="notice error">
                  {error}
                  <Button
                    disabled={busy || moreBusy}
                    onClick={() => void loadPage(nextOffset ?? 0)}
                  >
                    重试获取
                  </Button>
                </div>
              )}
              {!busy && !rows.length && !error && (
                <p>没有符合条件的版本，请返回下载页调整筛选。</p>
              )}
              {!!rows.length && (
                <div
                  className="resource-version-list"
                  role="radiogroup"
                  aria-label={`${label}版本`}
                >
                  {rows.map((v) => (
                    <label className="resource-version-row" key={v.id}>
                      <input
                        type="radio"
                        name={versionGroup}
                        value={v.id}
                        checked={selected === v.id}
                        onChange={() => S(v.id)}
                      />
                      <span className="resource-version-row-copy">
                        <strong>{v.name || v.number}</strong>
                        <span className="resource-version-row-meta">
                          <span>{releaseLabel(v)}</span>
                          {v.date && (
                            <time dateTime={v.date}>{v.date.slice(0, 10)}</time>
                          )}
                          {!!v.loaders?.length && (
                            <span>{v.loaders.join(" / ")}</span>
                          )}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {!busy && nextOffset !== null && (
                <Button
                  busy={moreBusy}
                  onClick={() => void loadPage(nextOffset)}
                >
                  加载更多历史版本
                </Button>
              )}
            </section>
            <aside
              className="resource-version-detail"
              aria-label="所选版本信息"
            >
              {chosen ? (
                <>
                  <h4>版本信息</h4>
                  <dl>
                    <div>
                      <dt>发布类型</dt>
                      <dd>{releaseLabel(chosen)}</dd>
                    </div>
                    <div>
                      <dt>发布时间</dt>
                      <dd>{chosen.date?.slice(0, 10) || "未标注"}</dd>
                    </div>
                    {!!chosen.loaders?.length && (
                      <div>
                        <dt>
                          {kind === "shaderpacks" ? "光影加载器" : "适用环境"}
                        </dt>
                        <dd>{chosen.loaders.join(" / ")}</dd>
                      </div>
                    )}
                  </dl>
                  <div className="resource-version-games">
                    <h4>支持的游戏版本</h4>
                    <p>
                      {gameVersions.length
                        ? gameVersions.length <= 3
                          ? gameVersions.join("、")
                          : `${gameFilter && gameVersions.includes(gameFilter) ? gameFilter : gameVersions.slice(0, 2).join("、")} 等 ${gameVersions.length} 个版本`
                        : "作者未标注"}
                    </p>
                    {gameVersions.length > 3 && (
                      <details>
                        <summary>查看全部游戏版本</summary>
                        <p>{gameVersions.join("、")}</p>
                      </details>
                    )}
                  </div>
                  {chosen.filename && (
                    <div className="resource-version-file">
                      <h4>下载文件</h4>
                      <p>{chosen.filename}</p>
                    </div>
                  )}
                  <div className="resource-version-requirements">
                    {requirementContent}
                  </div>
                </>
              ) : (
                <p>选择版本后查看支持信息和必需前置。</p>
              )}
            </aside>
          </div>
        </div>
      ) : (
        <>
          {" "}
          <p>
            请选择要安装的版本。
          </p>
          {(gameFilter || loaderFilter) && (
            <p className="muted">
              下载页已选：
              {[gameFilter && `Minecraft ${gameFilter}`, loaderFilter]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          {busy && <p role="status">正在获取版本…</p>}
          {error && (
            <div className="notice error">
              {error}
              <Button
                disabled={busy || moreBusy}
                onClick={() => void loadPage(nextOffset ?? 0)}
              >
                重试获取
              </Button>
            </div>
          )}
          {!busy && !rows.length && !error && (
            <p>没有符合筛选条件的版本，请返回下载页调整筛选。</p>
          )}
          {!!rows.length && rows.length > 1 && (
            <>
              <p className="muted">
                已加载 {rows.length} 个版本
                {nextOffset !== null ? "，还有更多历史版本" : ""}
              </p>
              <OptionSelect
                label={`${label}版本`}
                value={selected}
                onChange={S}
                options={rows.map((v) => ({
                  value: v.id,
                  label: `${v.name || v.number} · ${v.type === "release" ? "正式版" : v.type === "beta" ? "测试版" : "开发版"}`,
                  hint: [
                    v.gameVersions?.join(", ") || v.number,
                    v.loaders?.join(" / "),
                    v.date?.slice(0, 10),
                    v.compatible === false ? "不兼容当前实例" : "",
                  ]
                    .filter(Boolean)
                    .join(" · "),
                }))}
              />
            </>
          )}
          {rows.length === 1 && (
            <div className="single-version" role="status">
              <div className="single-version-copy">
                <strong>{rows[0].name || rows[0].number}</strong>
                <span className="single-version-meta">
                  {rows[0].date && (
                    <time dateTime={rows[0].date}>
                      {rows[0].date.slice(0, 10)}
                    </time>
                  )}
                  {!!rows[0].gameVersions?.length && (
                    <span>{rows[0].gameVersions.slice(0, 3).join("、")}</span>
                  )}
                  {!!rows[0].loaders?.length && (
                    <span>{rows[0].loaders.join(" / ")}</span>
                  )}
                  {rows[0].compatible === false && (
                    <span className="single-version-warn">不兼容当前实例</span>
                  )}
                </span>
              </div>
              <Badge tone="ok">唯一可用版本 · 已选中</Badge>
            </div>
          )}
          {!busy && nextOffset !== null && (
            <Button busy={moreBusy} onClick={() => void loadPage(nextOffset)}>
              加载更多历史版本
            </Button>
          )}
          {requirementContent}
        </>
      )}
    </Modal>
  );
}

export function DataPackWorldPicker({
  project,
  id,
  close,
  install,
}: {
  project: Project;
  id: string;
  close: () => void;
  install: (world: string) => void;
}) {
  const [worlds, Worlds] = useState<{ name: string }[]>([]);
  const [world, World] = useState("");
  const [error, E] = useState("");
  const [busy, B] = useState(true);
  useEffect(() => {
    let live = true;
    World("");
    Worlds([]);
    E("");
    B(true);
    if (!id) {
      B(false);
      return;
    }
    void api<{ name: string }[]>("datapack_worlds", { id })
      .then((v) => {
        if (live) Worlds(v);
      })
      .catch((e) => {
        if (live) E(String(e));
      })
      .finally(() => {
        if (live) B(false);
      });
    return () => {
      live = false;
    };
  }, [id]);
  return (
    <Modal
      title={`安装 ${localizeProject(project).name}`}
      onClose={close}
      footer={
        <>
          <Button onClick={close}>取消</Button>
          <Button
            primary
            disabled={!world || busy}
            onClick={() => install(world)}
          >
            安装到所选存档
          </Button>
        </>
      }
    >
      <p>安装兼容当前实例的数据包，请选择目标存档。</p>
      {busy ? (
        <p role="status">正在读取存档…</p>
      ) : error ? (
        <div className="notice error">{error}</div>
      ) : worlds.length ? (
        <OptionSelect
          label="数据包目标存档"
          value={world}
          onChange={World}
          options={[
            { value: "", label: "请选择存档", disabled: true },
            ...worlds.map((w) => ({ value: w.name, label: w.name })),
          ]}
        />
      ) : (
        <p>
          {id
            ? "此实例还没有存档，请先在游戏中创建世界。"
            : "请先在下载页选择目标实例。"}
        </p>
      )}
    </Modal>
  );
}

export type ModUpdateContext = {
  byFile: Map<string, ModUpdate>;
  busy: boolean;
  applying: boolean;
  checking: boolean;
  filter: string;
  update: (files?: string[]) => Promise<void>;
};
export function ModUpdates({
  id,
  refresh,
  revision = "",
  resources,
  resourcesReady = true,
  filter,
  onFilterChange: Filter,
  disabled = false,
  children,
}: {
  id: string;
  refresh: () => Promise<void>;
  revision?: string;
  resources: Resource[];
  resourcesReady?: boolean;
  filter: string;
  onFilterChange: (value: string) => void;
  disabled?: boolean;
  children: (state: ModUpdateContext) => ReactNode;
}) {
  const s = useStore();
  const [mode, M] = useState("manual");
  const [rows, R] = useState<ModUpdate[] | null>(() => useModUpdateState.getState().byId[id]?.rows ?? null);
  const [checking, Checking] = useState(() => useModUpdateState.getState().byId[id]?.checking ?? false);
  const [applying, Applying] = useState(false);
  const [error, E] = useState("");
  const [scanError, ScanError] = useState(() => useModUpdateState.getState().byId[id]?.error ?? "");
  const [summary, S] = useState("");
  const [scanRevision, ScanAgain] = useState(0);
  const scan = useRef(0);
  const nativeScan = useRef(false);
  const lastRevision = useRef<{ id: string; revision: string } | null>(null);
  const busy = checking || applying || disabled;
  const byFile = new Map((rows || []).map((r) => [r.file, r]));
  const available = resources.filter((r) => r.enabled && byFile.get(r.name)?.status === "update").length;
  const uncertain = resources.filter(
    (r) =>
      r.enabled &&
      (!byFile.has(r.name) ||
        ["error", "unknown"].includes(byFile.get(r.name)!.status) ||
        byFile.get(r.name)!.partial),
  ).length;
  useEffect(() => {
    let retry: number | undefined;
    nativeScan.current = false;
    const receive = () => {
      const state = useModUpdateState.getState().byId[id];
      if (!state) return;
      ++scan.current;
      clearTimeout(retry);
      nativeScan.current = state.checking;
      Checking(nativeScan.current);
      ScanError(state.error);
      R(state.rows);
      if (
        !state.checking && (state.error ||
        state.rows?.some((r) => r.status === "error" || r.partial))
      )
        retry = window.setTimeout(() => ScanAgain((n) => n + 1), 60_000);
    };
    receive();
    const stop = useModUpdateState.subscribe((state, previous) => {
      if (state.byId[id] !== previous.byId[id]) receive();
    });
    return () => {
      stop();
      clearTimeout(retry);
    };
  }, [id]);
  useEffect(() => {
    let live = true;
    const saved = useModUpdateState.getState().byId[id];
    R(saved?.rows ?? null);
    Checking(saved?.checking ?? false);
    ScanError(saved?.error ?? "");
    S("");
    Filter("all");
    if (desktop)
      void api<{ mode: string }>("mod_update_mode", { id })
        .then((v) => {
          if (live) M(v.mode);
        })
        .catch((e) => {
          if (live) E(String(e));
        });
    return () => {
      live = false;
    };
  }, [id]);
  useEffect(() => {
    // Initial results belong to the app's startup/download worker. Opening or
    // reopening this page must neither erase them nor start another request.
    if (!resourcesReady) return;
    const changed = lastRevision.current?.id === id && lastRevision.current.revision !== revision;
    lastRevision.current = { id, revision };
    if (!changed && !scanRevision) return;
    const serial = ++scan.current;
    if (!desktop || applying || nativeScan.current) return;
    Checking(true);
    ScanError("");
    const timer = window.setTimeout(() => {
      if (nativeScan.current || scan.current !== serial) return;
      void api<ModUpdate[]>("check_mod_updates", {
        id,
        curseforgeKey: s.settings.curseforgeKey,
      })
        .then((value) => {
          if (scan.current !== serial) return;
          useModUpdateState.getState().receive({
            id, generation: useModUpdateState.getState().byId[id]?.generation ?? 0,
            status: "done", rows: value,
          });
        })
        .catch((e) => {
          if (scan.current === serial) {
            useModUpdateState.getState().receive({
              id, generation: useModUpdateState.getState().byId[id]?.generation ?? 0,
              status: "error", error: String(e),
            });
          }
        })
        .finally(() => {
          if (scan.current === serial) Checking(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      ++scan.current;
    };
  }, [id, revision, resourcesReady, scanRevision, s.settings.curseforgeKey, applying]);
  async function update(files?: string[]) {
    if (busy) return;
    Applying(true);
    E("");
    try {
      const v = await api<{ updated: number }>("update_mods", {
        id,
        files,
        curseforgeKey: s.settings.curseforgeKey,
      });
      S(
        v.updated
          ? `已更新 ${v.updated} 个模组，旧文件已备份。`
          : "暂无需要安装的兼容更新。",
      );
      await refresh();
    } catch (e) {
      E(String(e));
      await refresh().catch(() => {});
    } finally {
      Applying(false);
      ScanAgain((n) => n + 1);
    }
  }
  return (
    <div className="mod-update-manager">
      <div className="mod-update-toolbar">
        <div>
          <h3>模组更新</h3>
          <p role="status">
            {applying
              ? "正在更新模组…"
              : checking && !rows?.length
                ? "正在自动检测模组版本…"
                : scanError
                  ? "检测暂未完成，将自动重试"
                  : rows
                    ? `已自动检测 · ${available} 个可更新${rows.some((r) => r.cached) ? " · 含缓存结果" : ""}`
                    : "等待自动检测"}
          </p>
        </div>
        <div className="actions">
          <OptionSelect
            label="更新方式"
            value={mode}
            disabled={!desktop || busy}
            options={[
              { value: "manual", label: "手动更新" },
              { value: "auto", label: "启动前自动更新" },
            ]}
            onChange={(value) => {
              void api("mod_update_mode", { id, mode: value })
                .then(() => M(value))
                .catch((e) => E(String(e)));
            }}
          />
          <Button
            primary
            disabled={!available || busy}
            busy={applying}
            onClick={() => void update()}
          >
            更新全部{available ? ` (${available})` : ""}
          </Button>
        </div>
      </div>
      <div className="mod-update-filters" role="group" aria-label="模组状态">
        {[
          ["all", "全部", resources.length],
          ["enabled", "已启用", resources.filter((r) => r.enabled).length],
          ["disabled", "已停用", resources.filter((r) => !r.enabled).length],
          ["update", "可更新", available],
          ["unknown", "待确认", uncertain],
        ].map(([value, title, count]) => (
          <Chip
            key={value}
            active={filter === value}
            onClick={() => Filter(String(value))}
          >
            {title} {count}
          </Chip>
        ))}
      </div>
      {mode === "auto" && (
        <p className="mod-update-note">
          启动前自动检测并更新；更新失败会恢复旧文件并暂停本次启动。
        </p>
      )}
      {(error || scanError) && (
        <p className="notice error" role="alert">
          {error || scanError}
        </p>
      )}
      {summary && (
        <p className="mod-update-summary" role="status">
          {summary}
        </p>
      )}
      {children({ byFile, busy, applying, checking, filter, update })}
    </div>
  );
}
