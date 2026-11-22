import { ChoiceSelect } from "../../components/ui/ChoiceSelect";
import { useGuideSection } from "../../lib/guideNavigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { previewVersions } from "../../lib/mock";
import { localizeProject, loadModNames } from "./modLocalization";
import { ResourceVersionPicker, DataPackWorldPicker } from "./ModManagement";
import { resourceTags } from "./resourceTags";
import { ProjectIcon } from "./ProjectIcon";
import { prefetchGalleryImage } from "./ResourceGallery";
import { catalogCache } from "./catalogCache";
import { resourcePages } from "./resourcePages";
import { CatalogLoading } from "./CatalogLoading";
import { versionCatalog, versionQuery } from "./versionCatalog";
import { SchematicCatalog } from "./SchematicCatalog";
import { CopyrightNotice } from "./CopyrightNotice";
import "./downloadCatalog.css";
const categories = [
  "游戏本体",
  "整合包",
  "模组",
  "资源包",
  "光影",
  "数据包",
  "地图",
  "投影",
];
const projectKinds = {
  整合包: { type: "modpack", install: "modpacks" },
  模组: { type: "mod", install: "mods" },
  资源包: { type: "resourcepack", install: "resourcepacks" },
  光影: { type: "shader", install: "shaderpacks" },
  数据包: { type: "datapack", install: "datapacks" },
  地图: { type: "world", install: "worlds" },
};
const aprilFools = (version) => {
  if (version.type === "release" || version.type.startsWith("old"))
    return false;
  const date = new Date(version.releaseTime);
  return date.getUTCMonth() === 3 && date.getUTCDate() <= 3;
};
function InstanceSelect({ instances, value, onChange }) {
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
  useGuideSection("discover", (section) => {
    if (categories.includes(section)) selectKind(section);
  });
  const [types, Ty] = useState(["release"]);
  const [views, setViews] = useState({});
  const target = s.instances.find((i) => i.id === s.selected);
  const targetKey = JSON.stringify([s.directoryId, target?.id, target?.version, target?.loader]);
  const saved = views[kind];
  const criteria = {
    q: saved?.q ?? "",
    source: saved?.source ?? "all",
    tag: saved?.tag ?? "",
    gameFilter: kind === "整合包" ? "" : (target?.version ?? ""),
    loaderFilter: kind === "模组" && target?.loader !== "vanilla" ? (target?.loader ?? "") : "",
    page: 0,
    ...(saved?.targetKey === targetKey ? saved : {}),
  };
  const { q, source, tag, gameFilter, loaderFilter, page } = criteria;
  function setCriteria(changes) {
    if (Object.entries(changes).every(([field, value]) => criteria[field] === value)) return;
    E("");
    setViews((all) => ({
      ...all,
      [kind]: { ...criteria, page: 0, ...changes, targetKey },
    }));
  }
  const [versions, V] = useState(() => {
    if (!desktop) return previewVersions;
    try {
      return JSON.parse(
        localStorage.getItem("kynex-version-catalogue") || "[]",
      );
    } catch {
      return [];
    }
  });
  const [versionProject, VP] = useState(null);
  const [schematicJump, SchematicJump] = useState();
  const [schematicsVisited, setSchematicsVisited] = useState(false);
  const [seenCopyright, SeenCopyright] = useState("");
  const dismissCopyright = useCallback(() => SeenCopyright(kind), [kind]);
  const [dataProject, DP] = useState(null);
  const [manifestBusy, ManifestBusy] = useState(false);
  const [actionError, E] = useState("");
  const [searchState, setSearchState] = useState();
  const [searchRevision, RetrySearch] = useState(0);
  const request = useRef(0);
  const projectPrefetch = useRef();
  const previousQuery = useRef({ kind, query: q.trim() });
  const previousRevision = useRef(searchRevision);
  function selectKind(next) {
    if (next === kind) return;
    K(next);
    E("");
    SeenCopyright("");
    if (next === "投影") setSchematicsVisited(true);
  }
  const projectKind = projectKinds[kind]?.type;
  const payload = useMemo(() => ({
    kind: projectKind,
    query: q.trim(),
    source,
    game: gameFilter,
    loader: kind === "地图" ? "" : loaderFilter,
    tag: kind === "地图" ? "" : tag,
    curseforgeKey: s.settings.curseforgeKey,
    directoryId: s.directoryId,
    page,
  }), [projectKind, q, source, gameFilter, loaderFilter, tag, s.settings.curseforgeKey, s.directoryId, page]);
  const state = searchState?.payload === payload && searchState.revision === searchRevision
    ? searchState
    : undefined;
  const cached = projectKind && desktop ? resourcePages.peek(payload) : undefined;
  const result = state?.value?.warning ? (cached ?? state.value) : (state?.value ?? cached);
  const { projects = [], total = 0, pages = 1 } = result ?? {};
  const error = state?.error || actionError;
  const refreshing = state?.loading || previousRevision.current !== searchRevision;
  const searchBusy = desktop && !!projectKind && (refreshing || (!result && !state?.error));
  const busy =
    (kind === "游戏本体" && manifestBusy) ||
    (searchBusy && projects.length === 0);
  useEffect(() => () => clearTimeout(projectPrefetch.current), []);
  function prefetchProject(project) {
    if (
      !desktop ||
      !projectKinds[kind] ||
      (kind === "地图" &&
        project.download_state === "closed" &&
        project.source !== "curseforge")
    )
      return;
    clearTimeout(projectPrefetch.current);
    const serial = request.current;
    const query = versionQuery(project, {
      id: s.selected,
      kind: projectKinds[kind].install,
      game: gameFilter,
      loader: loaderFilter,
      directoryId: s.directoryId,
      curseforgeKey: s.settings.curseforgeKey,
    });
    projectPrefetch.current = setTimeout(() => {
      if (serial !== request.current) return;
      prefetchGalleryImage(project.gallery?.[0]);
      void versionCatalog.get(query).catch(() => {});
    }, 150);
  }
  function refresh(force = false) {
    if (!desktop) return;
    ManifestBusy(true);
    E("");
    api("manifest", { force })
      .then((value) => {
        V(value);
        localStorage.setItem("kynex-version-catalogue", JSON.stringify(value));
      })
      .catch((e) => E(String(e)))
      .finally(() => ManifestBusy(false));
  }
  const manifestRequested = useRef(false);
  useEffect(() => {
    if (kind !== "游戏本体" || manifestRequested.current) return;
    manifestRequested.current = true;
    if (desktop) void api("warm_loader_catalogs").catch(() => {});
    refresh(false);
  }, [kind]);
  useEffect(() => {
    const serial = ++request.current;
    if (!desktop || !projectKind) return;
    const prior = previousQuery.current;
    const delay = prior.kind === kind && prior.query !== payload.query ? 160 : 0;
    previousQuery.current = { kind, query: payload.query };
    const force = previousRevision.current !== searchRevision;
    previousRevision.current = searchRevision;
    if (!force && resourcePages.peek(payload)) return;
    if (force) {
      E("");
      setSearchState({ payload, revision: searchRevision, loading: true });
    }
    const timer = setTimeout(async () => {
      try {
        const value = await resourcePages.get(payload, force);
        if (serial === request.current)
          setSearchState({ payload, revision: searchRevision, value });
      } catch (cause) {
        if (serial === request.current)
          setSearchState({ payload, revision: searchRevision, error: cause.message || String(cause) });
      }
    }, delay);
    return () => {
      clearTimeout(timer);
      if (request.current === serial) ++request.current;
    };
  }, [kind, projectKind, payload, searchRevision]);
  useEffect(() => {
    if (!result?.next.length || searchBusy) return;
    // Warm only next-page metadata once the foreground page is idle.
    let idle;
    const timer = setTimeout(() => {
      const prefetch = () => {
        for (const input of result.next) void catalogCache.get(input).catch(() => {});
      };
      if (window.requestIdleCallback) idle = window.requestIdleCallback(prefetch);
      else prefetch();
    }, 1800);
    return () => {
      clearTimeout(timer);
      if (idle !== undefined) window.cancelIdleCallback(idle);
    };
  }, [result, searchBusy]);
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
  function turnPage(next) {
    setCriteria({ page: next });
    document
      .querySelector(".download-main")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  async function installProject(selection, versionId, world) {
    const { project: p, category, targetId, game, loader } = selection;
    const projectSource =
      p.source === "curseforge"
        ? "curseforge"
        : p.source === "pixelmap"
          ? "pixelmap"
          : "modrinth";
    if (category !== "整合包" && !targetId) {
      s.notify("先选择资源安装目标");
      return;
    }
    E("");
    try {
      if (category === "整合包") {
        const instance = await api("install_project", {
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
        return;
      }
      if (category === "地图") {
        await api("install_map", {
          id: targetId,
          project: p.project_id,
          versionId,
          name: p.title,
          game: game || undefined,
          previewUrl: p.gallery?.[0] || undefined,
          source: projectSource,
          curseforgeKey: s.settings.curseforgeKey,
        });
        return;
      }
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
    } catch (e) {
      if (category === "数据包") throw e;
      // 地图安装失败由对应的下载任务显示，资源列表只报告查询错误。
      if (category === "地图") return;
      E(String(e).replace(/^Error: /, ""));
    }
  }
  return (
    <>
      {(kind === "地图" || kind === "投影") && seenCopyright !== kind && (
        <CopyrightNotice key={kind} kind={kind} onClose={dismissCopyright} />
      )}
      {versionProject && (
        <ResourceVersionPicker
          key={versionProject.targetId}
          project={versionProject.project}
          id={versionProject.targetId}
          kind={projectKinds[versionProject.category].install}
          label={versionProject.category}
          gameFilter={versionProject.game}
          loaderFilter={versionProject.loader}
          targetControls={
            versionProject.category === "数据包" && (
              <div className="spread resource-version-target">
                <span>目标实例</span>
                <InstanceSelect
                  instances={s.instances}
                  value={versionProject.targetId}
                  onChange={(id) => {
                    const instance = s.instances.find((item) => item.id === id);
                    if (!instance) return;
                    useStore.setState({ selected: id });
                    VP(
                      (selection) =>
                        selection && {
                          ...selection,
                          targetId: id,
                          game: instance.version,
                        },
                    );
                  }}
                />
              </div>
            )
          }
          close={() => VP(null)}
          openSchematic={(slug) => {
            SchematicJump((jump) => ({ slug, revision: (jump?.revision ?? 0) + 1 }));
            setViews((all) => ({ ...all, 投影: { ...all.投影, q: "" } }));
            VP(null);
            selectKind("投影");
          }}
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
          targetName={
            s.instances.find((item) => item.id === dataProject.targetId)
              ?.name ?? ""
          }
          close={() => DP(null)}
          install={async (world) => {
            await installProject(dataProject, dataProject.version, world);
            DP(null);
          }}
        />
      )}
      <div className="page-head">
        <h1>下载</h1>
        <div className="actions">
          <SearchInput
            value={q}
            onChange={(value) => setCriteria({ q: value })}
            placeholder={
              kind === "模组"
                ? "搜索模组，支持中文 / English"
                : kind === "投影"
                  ? "搜索投影"
                  : kind === "地图"
                    ? "搜索地图"
                    : "搜索游戏版本或资源"
            }
          />
          {kind !== "投影" && kind !== "地图" && (
            <Button onClick={() => guarded(importPack)}>
              <PackagePlus size={15} />
              导入整合包
            </Button>
          )}
          {kind !== "投影" && (
            <Button
              onClick={() =>
                projectKinds[kind] ? RetrySearch((n) => n + 1) : refresh(true)
              }
              disabled={busy || searchBusy}
            >
              <RefreshCw size={15} />
              刷新
            </Button>
          )}
        </div>
      </div>
      <div className="chips" data-guide="download-categories">
        {categories.map((t) => (
          <Chip key={t} active={kind === t} onClick={() => selectKind(t)}>
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
          <h4>{kind === "投影" ? "作品来源" : "下载来源"}</h4>
          {kind === "投影" ? (
            <>
              <Badge>GitHub</Badge>
              <Badge>Block Library</Badge>
              <Badge>像素茶艺</Badge>
            </>
          ) : kind === "地图" ? (
            <>
              <Badge tone="ok">资源：像素茶艺</Badge>
              <Badge tone="warn">资源：CurseForge</Badge>
            </>
          ) : (
            <>
              <Badge>
                {s.settings.downloadSource === "bmclapi"
                  ? "游戏：BMCLAPI 优先"
                  : "游戏：Mojang 官方"}
              </Badge>
              <Badge tone="ok">资源：Modrinth</Badge>
              <Badge tone="warn">资源：CurseForge</Badge>
            </>
          )}
          {kind !== "整合包" && (
            <>
              <h4>目标实例</h4>
              <InstanceSelect
                instances={s.instances}
                value={s.selected}
                onChange={(id) => useStore.setState({ selected: id })}
              />
              <p className="target-instance-hint">
                {kind === "投影"
                  ? target
                    ? `投影将保存到 ${target.name} 的投影文件夹`
                    : "选择一个 Java 实例后可保存投影。"
                  : kind === "地图"
                    ? target
                      ? `点安装后下载到 ${target.name} 的存档文件夹，已有存档不会被覆盖。`
                      : "选择一个 Java 实例后才能安装地图。"
                    : target
                      ? `将安装到 ${target.name} · ${target.version} · ${target.loader}`
                      : "先安装或选择一个 Java 实例，资源会按该实例的版本与加载器匹配。"}
              </p>
            </>
          )}
        </aside>
        <div className="download-main">
          {kind !== "投影" && error && (
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
          {schematicsVisited && (
            <SchematicCatalog
              key={schematicJump?.revision ?? 0}
              active={kind === "投影"}
              query={views.投影?.q ?? ""}
              pixelmapSlug={schematicJump?.slug}
              instanceId={target?.id ?? ""}
            />
          )}
          {kind === "投影" ? null : kind === "游戏本体" ? (
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
                        const runtime = await api("install_java", { major });
                        s.updateSettings({ java: runtime.path });
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
                    onValueChange={(value) => setCriteria({ gameFilter: value })}
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
                        onValueChange={(value) => setCriteria({ loaderFilter: value })}
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
                {kind !== "地图" && resourceTags[projectKinds[kind]?.type] && (
                  <label>
                    <span>类型</span>
                    <ChoiceSelect
                      value={tag}
                      onValueChange={(value) => setCriteria({ tag: value })}
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
                  onClick={() => setCriteria({ source: "all" })}
                >
                  <Layers3 size={15} />
                  全部来源
                </button>
                <button
                  role="tab"
                  aria-selected={
                    source === (kind === "地图" ? "pixelmap" : "modrinth")
                  }
                  className={
                    source === (kind === "地图" ? "pixelmap" : "modrinth")
                      ? "on"
                      : ""
                  }
                  onClick={() => setCriteria({ source: kind === "地图" ? "pixelmap" : "modrinth" })}
                >
                  <Boxes size={15} />
                  {kind === "地图" ? "像素茶艺" : "Modrinth"}
                </button>
                <button
                  role="tab"
                  aria-selected={source === "curseforge"}
                  className={source === "curseforge" ? "on curseforge" : ""}
                  onClick={() => setCriteria({ source: "curseforge" })}
                >
                  <Flame size={15} />
                  CurseForge
                </button>
              </div>
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
                        key={`${p.source}:${p.project_id}`}
                        className="project-result-row"
                        role="listitem"
                        onPointerEnter={() => prefetchProject(p)}
                        onPointerLeave={() =>
                          clearTimeout(projectPrefetch.current)
                        }
                      >
                        <ProjectIcon
                          url={p.displayIcon}
                          prepared
                          name={localized.name}
                        />
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
                                : p.source === "pixelmap"
                                  ? "像素茶艺"
                                  : "Modrinth"}
                            </Badge>
                          </div>
                          {kind !== "地图" && localized.tags.length > 0 && (
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
                            {p.author && <span>作者 {p.author}</span>}
                            <span>
                              {p.downloads.toLocaleString()}{" "}
                              {p.source === "pixelmap" ? "次浏览" : "次下载"}
                            </span>
                            {gameFilter && <span>Minecraft {gameFilter}</span>}
                            {loaderFilter &&
                              ["模组", "整合包"].includes(kind) && (
                                <span>{loaderFilter}</span>
                              )}
                          </div>
                        </div>
                        <Button
                          onFocus={() => prefetchProject(p)}
                          onBlur={() => clearTimeout(projectPrefetch.current)}
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
                    title={
                      !desktop
                        ? "资源搜索需要桌面版"
                        : kind === "地图"
                          ? "没有找到地图"
                          : "没有找到资源"
                    }
                    detail={
                      kind === "模组"
                        ? "可尝试中文名、英文名或功能词，例如“钠”“Sodium”“性能优化”。"
                        : kind === "地图"
                          ? "可以换一个搜索词或游戏版本。"
                          : "可尝试资源名称、英文名，或选择全部游戏版本。"
                    }
                  />
                )
              )}
              {searchBusy && projects.length === 0 && (
                <CatalogLoading label="正在加载资源" />
              )}
              {(!searchBusy || !!result) &&
                (projects.length > 0 || page > 0 || pages > 1) && (
                  <div className="pagination">
                    <span>
                      {kind !== "地图" &&
                        `共 ${total.toLocaleString()} 个资源 · `}
                      第 {page + 1} / {pages} 页
                    </span>
                    <div className="actions">
                      <Button
                        disabled={page === 0 || searchBusy}
                        onClick={() => turnPage(Math.max(0, page - 1))}
                      >
                        上一页
                      </Button>
                      <Button
                        disabled={page + 1 >= pages || searchBusy}
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
