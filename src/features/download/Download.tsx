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
} from "lucide-react";
import {
  Button,
  Chip,
  Badge,
  SearchInput,
  Empty,
  Skeleton,
} from "../../components/ui";
import { api, desktop, external, pickFile } from "../../lib/bridge";
import { useStore, guarded } from "../../store";
import type { GameVersion, Instance, Project } from "../../lib/types";
import { previewVersions } from "../../lib/mock";
import {
  resolveResourceQuery,
  localizeProject,
  loadModNames,
} from "./modLocalization";
import { ResourceVersionPicker, DataPackWorldPicker } from "./ModManagement";
import { resourceTags } from "./resourceTags";
import { ProjectIcon } from "./ProjectIcon";
import { catalogCache, appendCatalog } from "./catalogCache";
import "./downloadCatalog.css";
const categories = ["游戏本体", "整合包", "模组", "资源包", "光影", "数据包"];

const projectKinds: Record<string, { type: string; install: string }> = {
  整合包: { type: "modpack", install: "modpacks" },
  模组: { type: "mod", install: "mods" },
  资源包: { type: "resourcepack", install: "resourcepacks" },
  光影: { type: "shader", install: "shaderpacks" },
  数据包: { type: "datapack", install: "datapacks" },
};

type InstallSelection = {
  project: Project;
  category: string;
  targetId: string;
  game: string;
  loader: string;
};

const aprilFools = (version: GameVersion) => {
  if (version.type === "release" || version.type.startsWith("old"))
    return false;
  const date = new Date(version.releaseTime);
  return date.getUTCMonth() === 3 && date.getUTCDate() <= 3;
};

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
  const [, NamesReady] = useState(0);
  useEffect(() => {
    let live = true;
    void loadModNames()
      .then(() => {
        if (live) NamesReady((n) => n + 1);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const [kind, K] = useState("游戏本体");
  useEffect(() => {
    if (desktop && kind === "游戏本体")
      void api("warm_loader_catalogs").catch(() => {});
  }, [kind]);
  const [types, Ty] = useState(["release"]);
  const [q, Q] = useState("");
  const [source, Src] = useState<"all" | "modrinth" | "curseforge">("all");
  const [tag, Tag] = useState("");
  const [gameFilter, GameFilter] = useState("");
  const [loaderFilter, LoaderFilter] = useState("");
  const [versions, V] = useState<GameVersion[]>(() => {
    if (!desktop) return previewVersions;
    try {
      return JSON.parse(
        localStorage.getItem("kynex-version-catalogue") || "[]",
      );
    } catch {
      return [];
    }
  });
  const [projects, P] = useState<Project[]>([]);
  const [page, Page] = useState(0);
  const [total, Total] = useState(0);
  const [versionProject, VP] = useState<InstallSelection | null>(null);
  const [dataProject, DP] = useState<
    (InstallSelection & { version: string }) | null
  >(null);
  const [manifestBusy, ManifestBusy] = useState(false);
  const [searchBusy, SearchBusy] = useState(false);
  const [sourceWarning, SourceWarning] = useState("");
  const [error, E] = useState("");
  const [pageCount, PageCount] = useState(1);
  const [searchRevision, RetrySearch] = useState(0);
  const request = useRef(0);
  const previousKind = useRef(kind);
  const previousQuery = useRef(q);
  const previousRevision = useRef(searchRevision);
  const target = s.instances.find((i) => i.id === s.selected);
  const busy = manifestBusy || (searchBusy && projects.length === 0);

  function refresh(force = false) {
    if (!desktop) return;
    ManifestBusy(true);
    E("");
    api<GameVersion[]>("manifest", { force })
      .then((value) => {
        V(value);
        localStorage.setItem("kynex-version-catalogue", JSON.stringify(value));
      })
      .catch((e) => E(String(e)))
      .finally(() => ManifestBusy(false));
  }
  useEffect(() => refresh(false), []);
  useEffect(() => {
    Page(0);
  }, [kind, q, source, gameFilter, loaderFilter, tag]);
  useEffect(() => {
    // 切换资源类型时清空搜索词，避免把上一类的关键词带进新列表。
    Tag("");
    Q("");
  }, [kind]);
  useEffect(() => {
    GameFilter(kind === "整合包" ? "" : (target?.version ?? ""));
    LoaderFilter(
      !["模组", "整合包"].includes(kind) ||
        kind === "整合包" ||
        target?.loader === "vanilla"
        ? ""
        : (target?.loader ?? ""),
    );
  }, [target?.id, kind]);
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
    SearchBusy(true);
    P([]);
    Total(0);
    SourceWarning("");
    const delay = previousQuery.current === q ? 0 : 160;
    previousQuery.current = q;
    const force = previousRevision.current !== searchRevision;
    previousRevision.current = searchRevision;
    const prefetchTimers: ReturnType<typeof setTimeout>[] = [];
    const timer = setTimeout(async () => {
      // 名称表只参与本次查询的计算，不在加载完成后重新发起同一个查询。
      const raw = q.trim();
      const searchQuery = await resolveResourceQuery(raw);
      if (serial !== request.current) return;
      SearchBusy(true);
      E("");
      const sources: Array<"modrinth" | "curseforge"> =
        source === "all" ? ["modrinth", "curseforge"] : [source];
      let visible: Project[] = [];
      const totals = new Map<string, number>();
      const warnings: string[] = [];
      let successes = 0;
      const payload = (selectedSource: string, next = page) => ({
        kind: meta.type,
        query: searchQuery,
        source: selectedSource,
        game: gameFilter,
        loader: loaderFilter,
        tag,
        curseforgeKey: s.settings.curseforgeKey,
        page: next,
      });

      void Promise.all(
        sources.map(async (selectedSource) => {
          try {
            const value = await catalogCache.get(
              payload(selectedSource),
              force,
            );
            if (serial !== request.current) return;
            successes += 1;
            totals.set(selectedSource, value.total ?? value.hits?.length ?? 0);
            // Publish the first source immediately. Late arrivals only append;
            // existing rows and their install targets never jump or change source.
            visible = appendCatalog(visible, value.hits ?? []);
            P(visible);
            Total([...totals.values()].reduce((sum, n) => sum + n, 0));
            PageCount(
              Math.max(
                1,
                ...[...totals.values()].map((n) => Math.ceil(n / 30)),
              ),
            );
            if ((page + 1) * 30 < (value.total ?? 0)) {
              prefetchTimers.push(
                setTimeout(() => {
                  if (serial === request.current)
                    void catalogCache
                      .get(payload(selectedSource, page + 1))
                      .catch(() => {});
                }, 500),
              );
            }
            if (value.warning) warnings.push(value.warning);
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
        SearchBusy(false);
        SourceWarning(warnings.join("；"));
        if (!successes) {
          P([]);
          Total(0);
          E(warnings.join("；") || "资源搜索暂时不可用，请稍后重试。");
          return;
        }
      });
    }, delay);
    return () => {
      clearTimeout(timer);
      prefetchTimers.forEach(clearTimeout);
      // 包括组件离开和下一次输入，旧请求都不能回写结果。
      if (request.current === serial) ++request.current;
    };
  }, [kind, q, source, gameFilter, loaderFilter, tag, page, searchRevision]);

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
  const pages = pageCount;

  function turnPage(next: number) {
    Page(next);
    document
      .querySelector(".download-main")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function installProject(
    selection: InstallSelection,
    versionId: string,
    world?: string,
  ) {
    const { project: p, category, targetId, game, loader } = selection;
    const projectSource = p.source === "curseforge" ? "curseforge" : "modrinth";
    E("");
    try {
      if (category === "整合包") {
        const instance = await api<Instance>("install_project", {
          project: p.project_id,
          versionId,
          name: p.title,
          game: game || undefined,
          loader: loader || undefined,
          kind: "modpacks",
          iconUrl: p.icon_url,
          source: projectSource,
          settings: s.settings,
          curseforgeKey: s.settings.curseforgeKey,
        });
        await s.refresh();
        useStore.setState({ selected: instance.id });
        s.notify("整合包安装完成");
        return;
      }
      if (!targetId) throw new Error("先选择资源安装目标");
      await api("install_project", {
        id: targetId,
        project: p.project_id,
        versionId,
        name: p.title,
        iconUrl: p.icon_url,
        kind: projectKinds[category].install,
        source: projectSource,
        curseforgeKey: s.settings.curseforgeKey,
        world,
      });
      s.notify(
        category === "数据包"
          ? `已安装到存档「${world}」，请在游戏中启用数据包。`
          : "资源下载完成",
      );
    } catch (e) {
      E(String(e).replace(/^Error: /, ""));
    }
  }

  return (
    <>
      {versionProject && (
        <ResourceVersionPicker
          project={versionProject.project}
          id={versionProject.targetId}
          kind={projectKinds[versionProject.category].install}
          label={versionProject.category}
          gameFilter={versionProject.game}
          loaderFilter={versionProject.loader}
          close={() => VP(null)}
          install={(version) => {
            const selection = versionProject;
            VP(null);
            if (selection.category === "数据包") DP({ ...selection, version });
            else void installProject(selection, version);
          }}
        />
      )}
      {dataProject && (
        <DataPackWorldPicker
          project={dataProject.project}
          id={dataProject.targetId}
          close={() => DP(null)}
          install={(world) => {
            const selection = dataProject;
            DP(null);
            void installProject(selection, selection.version, world);
          }}
        />
      )}
      <div className="page-head">
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
          <Button
            onClick={() =>
              projectKinds[kind] ? RetrySearch((n) => n + 1) : refresh(true)
            }
            disabled={busy}
          >
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
          {kind === "游戏本体" && (
            <>
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
            </>
          )}
          <h4>下载来源</h4>
          <Badge>
            {s.settings.downloadSource === "bmclapi"
              ? "游戏：BMCLAPI 优先"
              : "游戏：Mojang 官方"}
          </Badge>
          <Badge tone="ok">资源：Modrinth</Badge>
          <Badge tone="warn">资源：CurseForge</Badge>
          {kind !== "整合包" && (
            <>
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
            </>
          )}
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
          {manifestBusy && kind === "游戏本体" && !versions.length && (
            <Skeleton />
          )}
          {kind === "游戏本体" ? (
            <>
              <div className="spread section-tools">
                <span className="muted">
                  {visible.length} 个版本
                  {!desktop ? " · 离线预览列表" : ""}
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
              detail="将存档文件夹放进实例的 saves 目录，在「版本 → 存档」中一键载入。"
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
                {["模组", "整合包"].includes(kind) && (
                  <>
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
                  </>
                )}
                {resourceTags[projectKinds[kind]?.type] && (
                  <label>
                    <span>类型</span>
                    <ChoiceSelect
                      value={tag}
                      onValueChange={Tag}
                      options={resourceTags[projectKinds[kind].type]}
                      aria-label="资源分类"
                    />
                  </label>
                )}
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
              </div>
              {sourceWarning && (
                <details className="catalog-source-warning">
                  <summary>下载源连接失败</summary>
                  <p>{sourceWarning}</p>
                  <Button onClick={() => RetrySearch((n) => n + 1)}>
                    重试来源
                  </Button>
                </details>
              )}
              {projects.length ? (
                <div
                  className="project-results"
                  role="list"
                  aria-label={`${kind}资源列表`}
                  aria-busy={searchBusy}
                >
                  {projects.map((p) => {
                    const localized = localizeProject(p);
                    return (
                      <article
                        key={p.project_id}
                        className="project-result-row"
                        role="listitem"
                      >
                        <ProjectIcon url={p.icon_url} name={localized.name} />
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
                            {gameFilter && <span>Minecraft {gameFilter}</span>}
                            {loaderFilter &&
                              ["模组", "整合包"].includes(kind) && (
                                <span>{loaderFilter}</span>
                              )}
                          </div>
                        </div>
                        <Button
                          onClick={() => {
                            VP({
                              project: p,
                              category: kind,
                              targetId: s.selected,
                              game: gameFilter,
                              loader: loaderFilter,
                            });
                          }}
                        >
                          安装
                        </Button>
                      </article>
                    );
                  })}
                </div>
              ) : (
                !searchBusy &&
                !error && (
                  <Empty
                    title={desktop ? "没有找到资源" : "资源搜索需要桌面版"}
                    detail={
                      kind === "模组"
                        ? "可尝试中文名、英文名或功能词，例如“钠”“Sodium”“性能优化”。"
                        : "可尝试资源名称、英文名，或选择全部游戏版本。"
                    }
                  />
                )
              )}
              {searchBusy && projects.length === 0 && (
                <div
                  className="resource-loading catalog-loading"
                  role="status"
                  aria-label="正在加载资源"
                >
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
    </>
  );
}
