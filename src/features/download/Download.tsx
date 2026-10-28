import { ChoiceSelect } from "../../components/ui/ChoiceSelect";
import { useEffect, useRef, useState } from "react";
import {
  Download as DownloadIcon,
  RefreshCw,
  ArrowUpRight,
  PackagePlus,
  Flame,
  Boxes,
  Layers3,
  LoaderCircle,
} from "lucide-react";
import {
  Button,
  Chip,
  Badge,
  SearchInput,
  Empty,
  Skeleton,
  Modal,
} from "../../components/ui";
import { api, desktop, external, pickFile } from "../../lib/bridge";
import { useStore, guarded } from "../../store";
import type { GameVersion, Instance, Project } from "../../lib/types";
import { previewVersions } from "../../lib/mock";
import { expandResourceQuery, localizeProject } from "./modLocalization";
import { LoaderIcon } from "../../components/ui/LoaderIcon";

const categories = ["游戏本体", "加载器", "整合包", "模组", "资源包", "光影"];

const projectKinds: Record<string, { type: string; install: string }> = {
  整合包: { type: "modpack", install: "modpacks" },
  模组: { type: "mod", install: "mods" },
  资源包: { type: "resourcepack", install: "resourcepacks" },
  光影: { type: "shader", install: "shaderpacks" },
};

const aprilFools = (version: GameVersion) => {
  if (version.type === "release" || version.type.startsWith("old"))
    return false;
  const date = new Date(version.releaseTime);
  return date.getUTCMonth() === 3 && date.getUTCDate() <= 3;
};

interface Dependency {
  project_id: number | string;
  name: string;
  icon_url?: string | null;
  installed: boolean;
}

function InstanceSelect({
  instances,
  value,
  onChange,
}: {
  instances: Instance[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <ChoiceSelect
      className="instance-select"
      aria-label="资源安装目标"
      value={value}
      onValueChange={onChange}
      disabled={!instances.length}
      options={
        instances.length
          ? instances.map((instance) => ({
              value: instance.id,
              label: instance.name,
              hint: `${instance.version} · ${instance.loader}${instance.optifineVersion ? " + OptiFine" : ""}`,
            }))
          : [{ value: "", label: "尚未安装实例", hint: "先安装一个 Java 实例" }]
      }
    />
  );
}

export function Download() {
  const s = useStore();
  const [kind, K] = useState("游戏本体");
  const [types, Ty] = useState(["release"]);
  const [q, Q] = useState("");
  const [source, Src] = useState<"all" | "modrinth" | "curseforge">("all");
  const [gameFilter, GameFilter] = useState("");
  const [loaderFilter, LoaderFilter] = useState("");
  const [versions, V] = useState<GameVersion[]>(desktop ? [] : previewVersions);
  const [projects, P] = useState<Project[]>([]);
  const [page, Page] = useState(0);
  const [total, Total] = useState(0);
  const [pending, Pending] = useState<{
    project: Project;
    dependencies: Dependency[];
  } | null>(null);
  const [installing, Installing] = useState(false);
  const [manifestBusy, ManifestBusy] = useState(false);
  const [searchBusy, SearchBusy] = useState(false);
  const [error, E] = useState("");
  const [pageSize, PageSize] = useState(30);
  const [searchRevision, RetrySearch] = useState(0);
  const request = useRef(0);
  const previousKind = useRef(kind);
  const target = s.instances.find((i) => i.id === s.selected);
  const expandedQuery = expandResourceQuery(q);
  const busy = manifestBusy || searchBusy;

  function refresh(force = false) {
    if (!desktop) return;
    ManifestBusy(true);
    E("");
    api<GameVersion[]>("manifest", { force })
      .then(V)
      .catch((e) => E(String(e)))
      .finally(() => ManifestBusy(false));
  }
  useEffect(() => refresh(false), []);
  useEffect(() => {
    Page(0);
  }, [kind, q, source, gameFilter, loaderFilter]);
  useEffect(() => {
    GameFilter(target?.version ?? "");
    LoaderFilter(target?.loader === "vanilla" ? "" : (target?.loader ?? ""));
  }, [target?.id]);
  useEffect(() => {
    const serial = ++request.current;
    const meta = projectKinds[kind];
    if (previousKind.current !== kind) {
      previousKind.current = kind;
      P([]);
      Total(0);
    }
    if (!desktop || !meta) {
      SearchBusy(false);
      return;
    }
    const timer = setTimeout(() => {
      SearchBusy(true);
      E("");
      const sources: Array<"modrinth" | "curseforge"> =
        source === "all" ? ["modrinth", "curseforge"] : [source];
      const merged = new Map<string, Project>();
      const totals = new Map<string, number>();
      const warnings: string[] = [];
      let successes = 0;

      const publish = () => {
        const hits = [...merged.values()]
          .sort((a, b) => b.downloads - a.downloads)
          .slice(0, 30);
        P(hits);
        Total([...totals.values()].reduce((sum, value) => sum + value, 0));
        PageSize(30);
      };

      void Promise.all(
        sources.map(async (selectedSource) => {
          try {
            const value = await api<{
              hits: Project[];
              total?: number;
              warning?: string;
              pageSize?: number;
            }>("search", {
              kind: meta.type,
              query: expandedQuery,
              source: selectedSource,
              game: gameFilter,
              loader: loaderFilter,
              curseforgeKey: s.settings.curseforgeKey,
              page,
            });
            if (serial !== request.current) return;
            successes += 1;
            totals.set(selectedSource, value.total ?? value.hits?.length ?? 0);
            for (const project of value.hits ?? []) {
              const key = (project.slug || project.title)
                .toLocaleLowerCase()
                .replace(/[\s_-]/g, "");
              const current = merged.get(key);
              if (!current || project.downloads > current.downloads) {
                merged.set(key, project);
              }
            }
            if (value.warning) warnings.push(value.warning);
            publish();
          } catch (error) {
            if (serial === request.current) {
              warnings.push(
                `${selectedSource === "modrinth" ? "Modrinth" : "CurseForge"} 暂时不可用：${String(error).replace(/^Error: /, "")}`,
              );
            }
          }
        }),
      ).then(() => {
        if (serial !== request.current) return;
        if (!successes) {
          P([]);
          Total(0);
          E(warnings.join("；") || "资源搜索暂时不可用，请稍后重试。");
        }
        SearchBusy(false);
      });
    }, 220);
    return () => clearTimeout(timer);
  }, [
    kind,
    expandedQuery,
    source,
    gameFilter,
    loaderFilter,
    page,
    searchRevision,
  ]);

  async function importPack() {
    const path = await pickFile([
      { name: "整合包", extensions: ["zip", "mrpack", "curseforge"] },
    ]);
    if (path) s.show("pack", path);
  }

  const visible = versions.filter((v) => {
    const group = aprilFools(v)
      ? "april"
      : v.type.startsWith("old")
        ? "old"
        : v.type;
    return (
      types.includes(group) && v.id.toLowerCase().includes(q.toLowerCase())
    );
  });
  const pages = Math.max(1, Math.ceil(total / pageSize));

  function turnPage(next: number) {
    Page(next);
    document
      .querySelector(".download-main")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function installProject(
    p: Project,
    mode: "check" | "deps" | "body" = "check",
  ) {
    if (installing) return;
    const projectSource = p.source === "curseforge" ? "curseforge" : "modrinth";
    if (mode === "check" && kind === "模组" && projectSource === "curseforge") {
      if (!s.selected) {
        E("先选择一个目标实例，再检查前置");
        return;
      }
      Installing(true);
      try {
        const result = await api<{ dependencies: Dependency[] }>(
          "project_dependencies",
          {
            id: s.selected,
            project: p.project_id,
            curseforgeKey: s.settings.curseforgeKey,
          },
        );
        const missing = (result.dependencies ?? []).filter(
          (dependency) => !dependency.installed,
        );
        if (missing.length) {
          Pending({ project: p, dependencies: missing });
          return;
        }
      } catch (e) {
        E(String(e).replace(/^Error: /, ""));
        return;
      } finally {
        Installing(false);
      }
    }
    Installing(true);
    try {
      if (kind === "整合包" && projectSource === "modrinth") {
        await external(`https://modrinth.com/modpack/${p.slug}`);
        s.notify("下载 .mrpack 后拖入窗口安装");
        return;
      }
      if (kind === "整合包") {
        await api("install_project", {
          project: p.project_id,
          kind: "modpacks",
          source: projectSource,
          settings: s.settings,
          curseforgeKey: s.settings.curseforgeKey,
        });
        await s.refresh();
        Pending(null);
        s.setPage("library");
        s.notify("整合包安装完成");
        return;
      }
      if (!s.selected) throw new Error("先选择资源安装目标");
      await api("install_project", {
        id: s.selected,
        project: p.project_id,
        iconUrl: p.icon_url,
        kind: projectKinds[kind].install,
        source: projectSource,
        curseforgeKey: s.settings.curseforgeKey,
        skipDependencies: mode === "body",
      });
      Pending(null);
      s.notify(mode === "body" ? "本体已安装，前置请按需补充" : "资源下载完成");
    } catch (e) {
      E(String(e).replace(/^Error: /, ""));
      Pending(null);
    } finally {
      Installing(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>发现新世界</h1>
          <p>从一个版本开始，让灵感落地。</p>
        </div>
        <div className="actions">
          <SearchInput
            value={q}
            onChange={Q}
            placeholder={
              kind === "模组"
                ? "搜索模组，支持中文 / English"
                : "搜索游戏版本或资源"
            }
          />
          <Button onClick={() => guarded(importPack)}>
            <PackagePlus size={15} />
            导入整合包
          </Button>
          <Button onClick={() => refresh(true)} disabled={manifestBusy}>
            <RefreshCw size={15} />
            刷新
          </Button>
        </div>
      </div>
      <div className="chips">
        {categories.map((t) => (
          <Chip key={t} active={kind === t} onClick={() => K(t)}>
            {t}
          </Chip>
        ))}
      </div>
      <div className="download-layout">
        <aside className="filters">
          <h4>版本类型</h4>
          {[
            ["release", "正式版"],
            ["snapshot", "预览版"],
            ["old", "远古版本"],
            ["april", "愚人节版"],
          ].map(([v, t]) => (
            <label key={v}>
              <input
                type="checkbox"
                checked={types.includes(v)}
                onChange={() =>
                  Ty((a) =>
                    a.includes(v) ? a.filter((x) => x !== v) : [...a, v],
                  )
                }
              />
              {t}
            </label>
          ))}
          <h4>下载来源</h4>
          <Badge>
            {s.settings.downloadSource === "bmclapi"
              ? "游戏：BMCLAPI 优先"
              : "游戏：Mojang 官方"}
          </Badge>
          <Badge tone="ok">资源：Modrinth</Badge>
          <Badge tone="warn">资源：CurseForge</Badge>
          <p>下载文件校验哈希，失败会重试。</p>
          <h4>目标实例</h4>
          <InstanceSelect
            instances={s.instances}
            value={s.selected}
            onChange={(id) => useStore.setState({ selected: id })}
          />
          <p className="target-instance-hint">
            {target
              ? `将安装到 ${target.name} · ${target.version} · ${target.loader}`
              : "先安装或选择一个 Java 实例，资源会按该实例的版本与加载器匹配。"}
          </p>
          <h4>运行环境</h4>
          <p>启动时自动识别 Java 要求；本机缺失时会自动下载并补齐。</p>
        </aside>
        <div className="download-main">
          {error && (
            <div role="alert" className="notice error">
              {error}
              <Button
                onClick={() =>
                  projectKinds[kind]
                    ? RetrySearch((value) => value + 1)
                    : refresh(true)
                }
              >
                重试
              </Button>
            </div>
          )}
          {manifestBusy && kind === "游戏本体" && <Skeleton />}
          {kind === "游戏本体" ? (
            <>
              <div className="spread section-tools">
                <span className="muted">
                  {visible.length} 个版本{!desktop ? " · 离线预览列表" : ""}
                </span>
                <Badge>
                  {s.settings.downloadSource === "bmclapi"
                    ? "BMCLAPI / Mojang"
                    : "官方版本清单"}
                </Badge>
              </div>
              <div className="timeline">
                {visible.slice(0, 150).map((v) => (
                  <div className="version-row" key={v.id}>
                    <span
                      className={`timeline-dot ${v.type === "release" ? "ok" : ""}`}
                    />
                    <b className="mono">{v.id}</b>
                    <span className="muted">{v.releaseTime.slice(0, 10)}</span>
                    <Badge>
                      {v.type === "release"
                        ? "正式版"
                        : aprilFools(v)
                          ? "愚人节版"
                          : v.type === "snapshot"
                            ? "预览版"
                            : "远古"}
                    </Badge>
                    <Button onClick={() => s.show("install", v.id)}>
                      <DownloadIcon size={14} />
                      安装
                    </Button>
                  </div>
                ))}
              </div>
              {!visible.length && !busy && (
                <Empty
                  title="没有匹配的版本"
                  detail="调整类型筛选或搜索词后再试。"
                />
              )}
            </>
          ) : kind === "加载器" ? (
            <div className="resource-list">
              {["Fabric", "Quilt", "Forge", "NeoForge", "OptiFine"].map((l) => (
                <div className="resource-row" key={l}>
                  <LoaderIcon loader={l} />
                  <div className="grow">
                    <b className="sr-only">{l}</b>
                    <small>
                      {l === "OptiFine"
                        ? "启动器内选择版本、下载并安装，兼容 Forge 可组合安装"
                        : "安装版本时自动查询兼容的加载器版本"}
                    </small>
                  </div>
                  <Button
                    onClick={() =>
                      s.show(
                        "install",
                        versions.find((v) => v.type === "release")?.id ??
                          "1.20.1",
                      )
                    }
                  >
                    选择版本
                  </Button>
                </div>
              ))}
            </div>
          ) : kind === "Java" ? (
            <Empty
              title="安装适合游戏的 Java"
              detail="1.20.1 通常使用 Java 17，1.20.5 及以后通常使用 Java 21；以版本清单为准。启动时缺失也会自动下载。"
            >
              <Button
                primary
                onClick={() =>
                  guarded(() =>
                    external("https://adoptium.net/temurin/releases/"),
                  )
                }
              >
                打开 Adoptium 官方下载
                <ArrowUpRight size={14} />
              </Button>
              <div
                className="actions"
                style={{ justifyContent: "center", marginTop: 16 }}
              >
                {[8, 17, 21, 25].map((major) => (
                  <Button
                    key={major}
                    onClick={() =>
                      guarded(async () => {
                        const runtime = await api<{ path: string }>(
                          "install_java",
                          { major },
                        );
                        s.updateSettings({ java: runtime.path });
                        s.notify("Java " + major + " 已安装并设为全局默认");
                      })
                    }
                  >
                    安装 Java {major}
                  </Button>
                ))}
              </div>
            </Empty>
          ) : kind === "世界" ? (
            <Empty
              title="导入你的世界"
              detail="将存档文件夹放进实例的 saves 目录，在游戏内选择世界载入。"
            />
          ) : (
            <>
              <div className="resource-filters" aria-label="资源筛选">
                <label>
                  <span>游戏版本</span>
                  <ChoiceSelect
                    value={gameFilter}
                    onValueChange={(selectedValue) => GameFilter(selectedValue)}
                  >
                    <option value="">全部版本</option>
                    {versions
                      .filter((v) => v.type === "release")
                      .slice(0, 160)
                      .map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.id}
                        </option>
                      ))}
                  </ChoiceSelect>
                </label>
                <label>
                  <span>加载器类型</span>
                  <ChoiceSelect
                    value={loaderFilter}
                    onValueChange={(selectedValue) =>
                      LoaderFilter(selectedValue)
                    }
                  >
                    <option value="">全部类型</option>
                    <option value="fabric">Fabric</option>
                    <option value="forge">Forge</option>
                    <option value="neoforge">NeoForge</option>
                    <option value="quilt">Quilt</option>
                  </ChoiceSelect>
                </label>
              </div>
              <div className="source-tabs" role="tablist" aria-label="资源来源">
                <button
                  role="tab"
                  aria-selected={source === "all"}
                  className={source === "all" ? "on" : ""}
                  onClick={() => Src("all")}
                >
                  <Layers3 size={15} />
                  全部来源
                </button>
                <button
                  role="tab"
                  aria-selected={source === "modrinth"}
                  className={source === "modrinth" ? "on" : ""}
                  onClick={() => Src("modrinth")}
                >
                  <Boxes size={15} />
                  Modrinth
                </button>
                <button
                  role="tab"
                  aria-selected={source === "curseforge"}
                  className={source === "curseforge" ? "on curseforge" : ""}
                  onClick={() => Src("curseforge")}
                >
                  <Flame size={15} />
                  CurseForge
                </button>
                {searchBusy && (
                  <span className="resource-searching" role="status">
                    <LoaderCircle size={13} />
                    正在更新结果
                  </span>
                )}
              </div>
              {projects.length ? (
                <div
                  className={
                    kind === "整合包" ? "project-grid" : "resource-list"
                  }
                >
                  {projects.map((p) => {
                    const localized = localizeProject(p);
                    return (
                      <article key={p.project_id} className="project-card">
                        <div className="project-icon">
                          {p.icon_url ? (
                            <img
                              src={p.icon_url}
                              alt=""
                              loading="lazy"
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
                              }}
                            />
                          ) : (
                            <span>{localized.name.slice(0, 2)}</span>
                          )}
                        </div>
                        <div className="project-copy">
                          <div className="project-title-line">
                            <h3>
                              {localized.name}
                              {localized.originalName && (
                                <small>｜{localized.originalName}</small>
                              )}
                            </h3>
                            <Badge
                              tone={p.source === "curseforge" ? "warn" : "ok"}
                            >
                              {p.source === "curseforge" ? (
                                <Flame size={11} />
                              ) : (
                                <Boxes size={11} />
                              )}
                              {p.source === "curseforge"
                                ? "CurseForge"
                                : "Modrinth"}
                            </Badge>
                          </div>
                          {localized.tags.length > 0 && (
                            <div className="project-tags">
                              {localized.tags.map((tag) => (
                                <span key={tag}>{tag}</span>
                              ))}
                            </div>
                          )}
                          <p>{localized.description}</p>
                          {localized.originalDescription && (
                            <small className="project-original-description">
                              {localized.originalDescription}
                            </small>
                          )}
                          <div className="project-meta">
                            <span>{p.downloads.toLocaleString()} 次下载</span>
                            <span>{gameFilter || "支持多个游戏版本"}</span>
                            <span>{loaderFilter || "多加载器"}</span>
                          </div>
                        </div>
                        <Button
                          primary
                          busy={installing}
                          onClick={() => void installProject(p)}
                        >
                          安装
                        </Button>
                      </article>
                    );
                  })}
                </div>
              ) : (
                !searchBusy && (
                  <Empty
                    title={desktop ? "没有找到资源" : "资源搜索需要桌面版"}
                    detail="可尝试中文名、英文名或功能词，例如“钠”“Sodium”“性能优化”。"
                  />
                )
              )}
              {searchBusy && projects.length === 0 && (
                <div className="resource-loading" aria-label="正在加载资源">
                  {Array.from({ length: 6 }, (_, index) => (
                    <div className="resource-skeleton-row" key={index}>
                      <i />
                      <span>
                        <b />
                        <small />
                        <small />
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {projects.length > 0 && (
                <div className="pagination">
                  <span>
                    共 {total.toLocaleString()} 个资源 · 第 {page + 1} / {pages}{" "}
                    页
                  </span>
                  <div className="actions">
                    <Button
                      disabled={page === 0 || busy}
                      onClick={() => turnPage(Math.max(0, page - 1))}
                    >
                      上一页
                    </Button>
                    <Button
                      disabled={page + 1 >= pages || busy}
                      onClick={() => turnPage(page + 1)}
                    >
                      下一页
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {pending && (
        <Modal
          title="需要安装前置"
          onClose={() => {
            if (!installing) Pending(null);
          }}
          footer={
            <>
              <Button disabled={installing} onClick={() => Pending(null)}>
                取消
              </Button>
              <Button
                disabled={installing}
                onClick={() => void installProject(pending.project, "body")}
              >
                仅安装本体
              </Button>
              <Button
                primary
                busy={installing}
                onClick={() => void installProject(pending.project, "deps")}
              >
                安装前置并继续
              </Button>
            </>
          }
        >
          <p>
            安装 <b>{pending.project.title}</b> 还需要以下必需前置：
          </p>
          <div className="dependency-list">
            {pending.dependencies.map((dependency) => (
              <div className="dependency-row" key={dependency.project_id}>
                <div className="dependency-icon">
                  {dependency.icon_url ? (
                    <img
                      src={dependency.icon_url}
                      alt=""
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  ) : (
                    <span>{dependency.name.slice(0, 2)}</span>
                  )}
                </div>
                <b>{dependency.name}</b>
                <Badge tone="warn">未安装</Badge>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
