import { useGuideSection, isGuideActive } from "../../lib/guideNavigation";
import { InstanceIcon } from "../../components/ui/LoaderIcon";
import { GameDirectoryBar } from "./GameDirectoryBar";
import { ResourceDeleteDialog } from "./ResourceDeleteDialog";
import { SchematicPreviewDialog } from "./SchematicPreviewDialog";
import { useResourceDragSelection } from "./useResourceDragSelection";
import { useModUpdateState } from "../../lib/modUpdateState";
import { ProjectIcon } from "../download/ProjectIcon";
import {
  cachedResourcePreview,
  resourcePreview,
  warmInstanceResources,
} from "./resourcePreviews";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Box,
  Globe,
  Plus,
  Settings,
  ArrowLeft,
  FolderOpen,
  Play,
  ArrowDown,
  ArrowUp,
  Trash2,
  RefreshCw,
  Upload,
  ImagePlus,
  PackageOpen,
  CheckSquare,
  CircleMinus,
  CircleCheck,
  Eye,
  Sun,
  Image as ImageIcon,
  Map as MapIcon,
} from "lucide-react";
import {
  Button,
  Chip,
  SearchInput,
  Badge,
  Empty,
  Tabs,
  Switch,
  Card,
  OptionSelect,
} from "../../components/ui";
import { useStore, guarded, launch, launchPreparing } from "../../store";
import {
  api,
  desktop,
  pickFile,
  pickFiles,
  pickImageFile,
  readableSize,
} from "../../lib/bridge";
function ResourceMark({ name, fallback }) {
  const base = name.replace(/\.(jar|litemod|zip)(\.disabled)?$/i, "");
  const localLabel = base.match(/^\[([\u4e00-\u9fff]{2})/u)?.[1];
  const words = base.split(/[^\p{L}]+/u).filter(Boolean);
  const first = words[0] ?? "";
  const mark =
    localLabel ??
    (words.length > 1
      ? `${first[0]}${words[1][0]}`
      : first.slice(0, 2)
    ).toUpperCase();
  return (
    <span className="resource-mark" aria-hidden="true">
      {mark || fallback}
    </span>
  );
}
async function chooseInstanceIcon(id) {
  const directoryId = useStore.getState().directoryId;
  const file = await pickImageFile("wallpaper");
  if (!file) return false;
  if (file.size > 2 * 1024 * 1024) throw new Error("实例图标不能大于 2 MB");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  const updated = await api("save_instance_icon", {
    directoryId,
    id,
    mime: file.type,
    base64: btoa(binary),
  });
  useStore.setState((state) =>
    state.directoryId === directoryId
      ? {
          instances: state.instances.map((instance) =>
            instance.id === id ? { ...instance, icon: updated.icon } : instance,
          ),
        }
      : {},
  );
  return true;
}
export function Library() {
  const s = useStore();
  const [q, Q] = useState("");
  const [type, T] = useState("全部");
  const hoveredInstance = useRef();
  useEffect(() => () => window.clearTimeout(hoveredInstance.current), []);
  const warmHoveredInstance = (id) => {
    window.clearTimeout(hoveredInstance.current);
    hoveredInstance.current = window.setTimeout(
      () => warmInstanceResources(id, s.directoryId, s.settings.curseforgeKey),
      240,
    );
  };
  useGuideSection("library", T);
  const [worlds, W] = useState([]);
  const worldSources = JSON.stringify(
    s.instances.map(({ id, name, version }) => ({ id, name, version })),
  );
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    Promise.all(
      JSON.parse(worldSources).map(async (i) =>
        (
          await api("resources", {
            directoryId: s.directoryId,
            id: i.id,
            kind: "saves",
          })
        )
          .filter((w) => w.dir !== false)
          .map((w) => ({
            name: w.name,
            id: i.id,
            instance: i.name,
            version: i.version,
          })),
      ),
    )
      .then((v) => {
        if (active) W(v.flat());
      })
      .catch((e) => {
        if (active) s.notify(String(e));
      });
    return () => {
      active = false;
    };
  }, [worldSources, s.directoryId]);
  const shown = s.instances.filter(
    (i) =>
      i.name.toLowerCase().includes(q.toLowerCase()) &&
      (type === "全部" || type === "实例"),
  );
  async function uploadIcon(id) {
    if (!(await chooseInstanceIcon(id))) return;
    s.notify("实例图标已更新");
  }
  return (
    <>
      <GameDirectoryBar />
      <div className="page-head">
        <h1>版本</h1>
        <div className="actions">
          <Button onClick={() => s.setPage("workshop")}>
            AI 整合包工坊（测试）
          </Button>
          <SearchInput
            value={q}
            onChange={Q}
            placeholder="搜索版本、存档"
          />
          <Button primary onClick={() => s.setPage("discover")}>
            <Plus size={16} />
            新建
          </Button>
        </div>
      </div>
      <div className="chips" data-guide="library-categories">
        {["全部", "实例", "存档"].map((t) => (
          <Chip key={t} active={t === type} onClick={() => T(t)}>
            {t}
          </Chip>
        ))}
      </div>
      {shown.length ? (
        <div className="library-grid">
          {shown.map((i, n) => (
            <div
              className={`instance-card game-${i.game}`}
              key={i.id}
              style={{ animationDelay: `${n * 30}ms` }}
              onPointerEnter={() => warmHoveredInstance(i.id)}
              onPointerLeave={() =>
                window.clearTimeout(hoveredInstance.current)
              }
              onFocus={() => warmHoveredInstance(i.id)}
            >
              <button
                className={`instance-cover cover-${i.loader}`}
                onClick={() => {
                  useStore.setState({ selected: i.id });
                  s.setPage("instance");
                }}
              >
                <InstanceIcon instance={i} cover />
                <Badge>
                  {i.loader.toUpperCase()}
                  {i.loader === "forge" && i.optifineVersion
                    ? " + OptiFine"
                    : ""}
                </Badge>
              </button>
              <div className="instance-body">
                <button
                  className="instance-title"
                  onClick={() => {
                    useStore.setState({ selected: i.id });
                    s.setPage("instance");
                  }}
                >
                  {i.name}
                </button>
                <p className="mono">Minecraft {i.version}</p>
                <div className="spread">
                  <Badge tone="ok">Java</Badge>
                  <div className="actions">
                    <Button
                      aria-label={`更换 ${i.name} 图标`}
                      title="更换实例图标"
                      onClick={() => guarded(() => uploadIcon(i.id))}
                    >
                      <ImagePlus size={14} />
                    </Button>
                    <Button
                      aria-label={`导出 ${i.name} 整合包`}
                      title="导出整合包"
                      onClick={() => s.show("export", i.id)}
                    >
                      <PackageOpen size={14} />
                    </Button>
                    <Button
                      aria-label={`${i.name} 版本设置`}
                      onClick={() => s.show("instance-settings", i.id)}
                    >
                      <Settings size={14} />
                    </Button>
                    <Button
                      aria-label={`删除 ${i.name}`}
                      title="删除版本"
                      onClick={() => s.show("remove-instance", i.id)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : type === "存档" && worlds.length ? (
        <div className="library-grid">
          {worlds
            .filter((w) => w.name.includes(q))
            .map((w) => (
              <Card key={w.id + w.name}>
                <FolderOpen size={28} />
                <h3>{w.name}</h3>
                <p>
                  {w.instance} · {w.version}
                </p>
              </Card>
            ))}
        </div>
      ) : (
        <Empty
          title="还没有匹配的内容"
          detail={
            type === "存档"
                ? "进入实例详情的「存档」标签查看本机世界。"
                : "安装版本后，它会出现在你的游戏库中。基岩版、地下城与传奇在「启动」页自动检测并启动。"
          }
        >
          <Button
            primary
            onClick={() => s.setPage("discover")}
          >
            浏览版本
          </Button>
        </Empty>
      )}
    </>
  );
}
const tabKinds = {
  Mod: "mods",
  资源包: "resourcepacks",
  存档: "saves",
  光影: "shaderpacks",
  数据包: "datapacks",
  投影: "schematics",
};
import { loadModNames, localModName } from "../download/modLocalization";
import { ModUpdates } from "../download/ModManagement";
import "./modUpdates.css";
import "./resourceManagement.css";
export function InstanceDetail() {
  const s = useStore();
  const i = s.instances.find((i) => i.id === s.selected);
  const [tab, T] = useState("概览");
  const vanilla = i?.loader === "vanilla";
  useEffect(() => {
    if (vanilla && ["Mod", "光影", "投影"].includes(tab)) T("概览");
  }, [vanilla, i?.id, tab]);
  useEffect(() => {
    if (i) warmInstanceResources(i.id, s.directoryId, s.settings.curseforgeKey);
  }, [i?.id, s.directoryId, s.settings.curseforgeKey]);
  useGuideSection("instance", T);
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
  const [rows, R] = useState([]);
  const [loadedResources, LoadedResources] = useState("");
  const [selectedResources, SelectResources] = useState([]);
  const [deleteRequest, DeleteRequestState] = useState(null);
  const [preview, Preview] = useState(null);
  const [resourceFilter, ResourceFilter] = useState("all");
  const cachedModRows = useModUpdateState(
    (state) => state.byId[s.selected]?.rows,
  );
  const [q, Q] = useState("");
  const [dataWorld, DataWorld] = useState("");
  const [dataWorlds, DataWorlds] = useState([]);
  useEffect(() => {
    let live = true;
    DataWorld("");
    DataWorlds([]);
    if (i && tab === "数据包" && desktop)
      void api("datapack_worlds", { id: i.id })
        .then((v) => {
          if (live && Array.isArray(v)) DataWorlds(v);
        })
        .catch((e) => {
          if (live) E(String(e));
        });
    return () => {
      live = false;
    };
  }, [i?.id, tab]);
  const [error, E] = useState("");
  const [loading, Loading] = useState(false);
  const [dragging, Dragging] = useState(false);
  const schematic = tab === "投影";
  const managed = ["Mod", "资源包", "光影", "数据包", "投影"].includes(tab);
  const currentResourceScope = `${s.directoryId}:${i?.id ?? ""}:${tabKinds[tab] ?? ""}:${tab === "数据包" ? dataWorld : ""}`;
  const resourceScope = useRef(currentResourceScope);
  resourceScope.current = currentResourceScope;
  const cachedRows = cachedResourcePreview({
    id: i?.id ?? "",
    kind: tabKinds[tab] ?? "",
    world: tab === "数据包" ? dataWorld : "",
    directoryId: s.directoryId,
  });
  const resourcesReady =
    loadedResources === currentResourceScope || !!cachedRows;
  const scopeRows =
    loadedResources === currentResourceScope ? rows : (cachedRows ?? []);
  const resourceBusy =
    loading ||
    !resourcesReady ||
    !!deleteRequest ||
    Object.values(s.tasks).some(
      (task) =>
        !task.finished &&
        !task.error &&
        task.payload?.id === i?.id &&
        ["install_project", "update_mods", "export_pack"].includes(
          task.action || "",
        ),
    );
  const updateMap = new Map(
    (cachedModRows || []).map((row) => [row.file, row]),
  );
  const visibleResources = scopeRows.filter(
    (r) =>
      (tab !== "Mod" ||
        (!r.dir && /\.(jar|litemod)(\.disabled)?$/i.test(r.name))) &&
      `${r.name} ${tab === "Mod" ? localModName(r.modIds, r.name) : ""}`
        .toLowerCase()
        .includes(q.toLowerCase()) &&
      (tab !== "Mod" ||
        resourceFilter === "all" ||
        (resourceFilter === "enabled" && r.enabled) ||
        (resourceFilter === "disabled" && !r.enabled) ||
        (resourceFilter === "update" &&
          updateMap.get(r.name)?.status === "update") ||
        (resourceFilter === "unknown" &&
          r.enabled &&
          (!updateMap.has(r.name) ||
            ["error", "unknown"].includes(updateMap.get(r.name).status) ||
            updateMap.get(r.name)?.partial))),
  );
  const visibleSignature = visibleResources.map((r) => r.name).join("\0");
  const dragSelection = useResourceDragSelection(
    visibleResources.map((r) => r.name),
    selectedResources,
    SelectResources,
    resourceBusy || !managed,
  );
  useEffect(() => {
    SelectResources([]);
    DeleteRequestState(null);
    ResourceFilter("all");
    Q("");
  }, [i?.id, tab, dataWorld]);
  useEffect(() => {
    const visible = new Set(visibleSignature.split("\0"));
    SelectResources((before) => {
      const next = before.filter((name) => visible.has(name));
      return next.length === before.length ? before : next;
    });
  }, [visibleSignature]);
  const ensuredLoaders = useRef(new Set());
  const schematicDirectory = useRef();
  const refreshResources = useCallback(
    async (force = true) => {
      if (!i || !tabKinds[tab] || !desktop) return;
      const scope = currentResourceScope;
      const value = await resourcePreview(
        {
          id: i.id,
          kind: tabKinds[tab],
          world: tab === "数据包" ? dataWorld || undefined : undefined,
          directoryId: s.directoryId || undefined,
          curseforgeKey: s.settings.curseforgeKey,
        },
        force,
      );
      if (resourceScope.current !== scope) return;
      E("");
      if (schematic && schematicDirectory.current !== value[0]?.directory)
        SelectResources([]);
      if (schematic) schematicDirectory.current = value[0]?.directory;
      R(value);
      LoadedResources(scope);
    },
    [
      i?.id,
      tab,
      dataWorld,
      schematic,
      currentResourceScope,
      s.directoryId,
      s.settings.curseforgeKey,
    ],
  );
  const importPaths = useCallback(
    async (paths) => {
      if (!i || !tabKinds[tab] || !paths.length) return;
      Loading(true);
      try {
        if (tab === "存档") {
          let imported = false;
          try {
            for (const path of paths) {
              await api("install_map", {
                id: i.id,
                source: "file",
                path,
                name: path.split(/[\\/]/).at(-1) ?? "地图",
              });
              imported = true;
            }
          } finally {
            if (imported && resourceScope.current === currentResourceScope) {
              await refreshResources();
            }
          }
          return;
        }
        await api("import_resource_paths", {
          id: i.id,
          kind: tabKinds[tab],
          world: tab === "数据包" ? dataWorld || undefined : undefined,
          paths,
        });
        if (resourceScope.current === currentResourceScope)
          await refreshResources();
        useStore
          .getState()
          .notify(`已添加 ${paths.length} 个${schematic ? "投影文件" : tab}`);
      } finally {
        if (resourceScope.current === currentResourceScope) {
          Loading(false);
          Dragging(false);
        }
      }
    },
    [i?.id, tab, dataWorld, schematic, currentResourceScope, refreshResources],
  );
  useEffect(() => {
    E("");
    if (i && tabKinds[tab] && desktop) {
      let live = true;
      let running = false;
      const update = () => {
        if (running || !live || document.hidden) return;
        running = true;
        return refreshResources(false)
          .catch((reason) => {
            if (live) E(String(reason));
          })
          .finally(() => {
            if (live) Loading(false);
            running = false;
          });
      };
      void update();
      const timer = window.setInterval(update, 10000);
      window.addEventListener("focus", update);
      return () => {
        live = false;
        window.clearInterval(timer);
        window.removeEventListener("focus", update);
      };
    } else {
      R([]);
      LoadedResources("");
    }
  }, [i?.id, tab, refreshResources]);
  useEffect(() => {
    if (
      isGuideActive() ||
      !desktop ||
      !i ||
      tab !== "Mod" ||
      ensuredLoaders.current.has(i.id)
    )
      return;
    ensuredLoaders.current.add(i.id);
    void api("ensure_loader_components", { id: i.id })
      .then(async (result) => {
        if (result.installed) {
          s.notify(`已自动补齐 ${result.label}`);
          await refreshResources();
        }
      })
      .catch((reason) => {
        ensuredLoaders.current.delete(i.id);
        E(String(reason).replace(/^Error: /, ""));
      });
  }, [i?.id, tab, refreshResources]);
  useEffect(() => {
    if (!desktop || !i || !tabKinds[tab]) return;
    const nativeDrop = (raw) => {
      const detail = raw.detail;
      if (detail.type === "enter" || detail.type === "over") Dragging(true);
      else if (detail.type === "leave") Dragging(false);
      else if (detail.type === "drop")
        void guarded(() => importPaths(detail.paths));
    };
    window.addEventListener("kynex-native-drag", nativeDrop);
    return () => window.removeEventListener("kynex-native-drag", nativeDrop);
  }, [i?.id, tab, importPaths]);
  if (!i)
    return (
      <Empty title="请选择一个实例">
        <Button onClick={() => s.setPage("library")}>返回游戏库</Button>
      </Empty>
    );
  async function moveResource(r, direction) {
    if (!i) return;
    await api("resource_move", {
      id: i.id,
      name: r.name,
      direction,
    });
    await refreshResources();
  }
  async function toggle(r) {
    if (!i) return;
    await api("toggle_resource", {
      id: i.id,
      kind: tabKinds[tab],
      world: tab === "数据包" ? dataWorld || undefined : undefined,
      name: r.name,
    });
    await refreshResources();
  }
  async function importDropped(files) {
    if (!i || !tabKinds[tab] || !desktop) return;
    if (tab === "存档") {
      Dragging(false);
      return;
    }
    const accepted = Array.from(files);
    if (!accepted.length) return;
    Loading(true);
    try {
      for (const file of accepted) {
        if (file.size > 120 * 1024 * 1024)
          throw new Error(`${file.name} 超过 120 MB`);
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 8192)
          binary += String.fromCharCode(
            ...bytes.subarray(offset, offset + 8192),
          );
        await api("import_resource", {
          id: i.id,
          kind: tabKinds[tab],
          world: tab === "数据包" ? dataWorld || undefined : undefined,
          name: file.name,
          base64: btoa(binary),
        });
      }
      await refreshResources();
      s.notify(`已添加 ${accepted.length} 个${schematic ? "投影文件" : tab}`);
    } finally {
      Loading(false);
      Dragging(false);
    }
  }
  async function browseResource() {
    if (!tabKinds[tab]) return;
    if (schematic) {
      const paths = await pickFiles([
        {
          name: "投影文件",
          extensions: ["litematic", "schematic", "schem", "nbt"],
        },
      ]);
      await importPaths(paths);
      return;
    }
    const path = await pickFile([
      {
        name: tab === "存档" ? "地图压缩包" : tab,
        extensions:
          tab === "存档"
            ? ["zip", "rar", "7z"]
            : [tab === "Mod" ? "jar" : "zip"],
      },
    ]);
    if (path) await importPaths([path]);
  }
  const modResources = scopeRows.filter(
    (r) => !r.dir && /\.(jar|litemod)(\.disabled)?$/i.test(r.name),
  );
  function selectResource(name) {
    if (resourceBusy) return;
    SelectResources((before) =>
      before.includes(name)
        ? before.filter((n) => n !== name)
        : [...before, name],
    );
  }
  function confirmResourceDelete(names) {
    if (!i || !names.length || resourceBusy) return;
    DeleteRequestState({
      id: i.id,
      kind: tabKinds[tab],
      world: tab === "数据包" ? dataWorld || undefined : undefined,
      directory: schematic ? scopeRows[0]?.directory : undefined,
      label: tab === "Mod" ? "模组" : schematic ? "投影文件" : tab,
      names,
      shared:
        i.settings.isolation === "shared" ||
        (i.settings.isolation === "modded" && i.loader === "vanilla"),
    });
  }
  function renderResources(updates) {
    if (desktop && !resourcesReady)
      return (
        <p className="resource-loading" role="status">
          正在读取{tab}…
        </p>
      );
    const visible = visibleResources;
    const DefaultIcon =
      tab === "光影"
        ? Sun
        : tab === "资源包"
          ? ImageIcon
          : tab === "存档"
            ? MapIcon
            : Box;
    return (
      <>
        {visible.length ? (
          <div
            className={`resource-list ${tab === "Mod" ? "mod-resource-list" : tab === "存档" ? "save-resource-list" : ""}`}
            {...(managed ? dragSelection : {})}
          >
            {visible.map((r, n) => {
              const update = updates?.byFile.get(r.name);
              const SelectionContent = managed ? "button" : "div";
              return (
                <div
                  className={`resource-row ${selectedResources.includes(r.name) ? "selected" : ""}`}
                  key={r.name}
                  data-resource-name={r.name}
                >
                  <SelectionContent
                    className="resource-selection-content"
                    {...(managed
                      ? {
                          type: "button",
                          "aria-label": `选择 ${r.name}`,
                          "aria-pressed": selectedResources.includes(r.name),
                          disabled: resourceBusy || updates?.applying,
                          onClick: () => selectResource(r.name),
                        }
                      : {})}
                  >
                    <ProjectIcon
                      className="resource-monogram"
                      name={r.name}
                      url={r.icon_url}
                      prepared
                      fallbackIcon={
                        tab === "存档" || schematic ? (
                          <DefaultIcon size={20} aria-hidden="true" />
                        ) : (
                          <ResourceMark
                            name={r.name}
                            fallback={<DefaultIcon size={20} />}
                          />
                        )
                      }
                    />
                    <div className="grow">
                      <b title={r.name}>
                        {tab === "Mod"
                          ? localModName(r.modIds, r.name) ||
                            r.name.replace(/\.disabled$/, "")
                          : r.name.replace(/\.disabled$/, "")}
                      </b>
                      <small title={r.name}>
                        {tab === "Mod" && localModName(r.modIds, r.name)
                          ? `${r.name.replace(/\.disabled$/, "")} · `
                          : ""}
                        {readableSize(r.size)}
                        {!schematic &&
                          (tab === "数据包"
                            ? r.enabled
                              ? " · 文件已就绪，游戏中确认启用"
                              : " · 文件已停用"
                            : r.enabled
                              ? " · 已启用"
                              : " · 已停用")}
                      </small>
                      {tab === "Mod" && (
                        <>
                          {(update?.current || r.version) && (
                            <small className="mod-update-version">
                              {update?.current || r.version}
                              {update?.status === "update" && update.latest && (
                                <>
                                  {" "}
                                  → <strong>{update.latest}</strong>
                                </>
                              )}
                            </small>
                          )}
                          {update?.source && (
                            <small className="mod-update-source">
                              {update.source === "modrinth"
                                ? "Modrinth"
                                : "CurseForge"}
                              {update.cached ? " · 缓存结果" : ""}
                              {update.partial ? " · 部分来源待确认" : ""}
                            </small>
                          )}
                          {update &&
                            ["unknown", "error"].includes(update.status) && (
                              <small
                                className="mod-update-message"
                                title={update.detail}
                              >
                                {update.detail}
                              </small>
                            )}
                          {!!r.problems?.length && (
                            <div className="mod-file-problems">
                              {r.problems.map((problem) => (
                                <Badge key={problem} tone="warn">
                                  {problem}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </SelectionContent>
                  {tab === "Mod" && (
                    <div
                      className="mod-row-state"
                      title={update?.warning || update?.detail}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Badge
                        tone={
                          update?.status === "update"
                            ? "warn"
                            : update?.status === "current" && !update.partial
                              ? "ok"
                              : "neutral"
                        }
                      >
                        {!r.enabled
                          ? "已停用"
                          : updates?.checking && !update
                            ? "检测中"
                            : update?.status === "update"
                              ? "可更新"
                              : update?.partial
                                ? "部分确认"
                                : update?.status === "current"
                                  ? "暂无更新"
                                  : update?.status === "error"
                                    ? "检测失败"
                                    : "未识别"}
                      </Badge>
                      {update?.status === "update" && (
                        <Button
                          disabled={updates?.busy}
                          onClick={() => void updates?.update([r.name])}
                        >
                          <ArrowUp size={14} />
                          更新
                        </Button>
                      )}
                    </div>
                  )}
                  {tab !== "Mod" &&
                    r.problems?.map((problem) => (
                      <Badge key={problem} tone="warn">
                        {problem}
                      </Badge>
                    ))}
                  <div
                    className="resource-row-actions"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {schematic && i && (
                      <Button
                        aria-label={"预览 " + r.name}
                        disabled={!desktop || resourceBusy}
                        onClick={() =>
                          Preview({
                            name: r.name,
                            instanceId: i.id,
                            directory: r.directory,
                          })
                        }
                      >
                        <Eye size={16} /> 预览
                      </Button>
                    )}
                    {!schematic && tab !== "存档" && (managed ? (
                        <Button
                          className="resource-enable-button"
                          role="switch"
                          aria-checked={r.enabled}
                          aria-label={`${r.name} 启用`}
                          title={r.enabled ? "停用" : "启用"}
                          disabled={resourceBusy || updates?.applying}
                          onClick={() => guarded(() => toggle(r))}
                        >
                          {r.enabled ? (
                            <CircleMinus size={16} />
                          ) : (
                            <CircleCheck size={16} />
                          )}
                        </Button>
                      ) : (
                        <Switch
                          label={`${r.name} 启用`}
                          disabled={resourceBusy || updates?.applying}
                          on={r.enabled}
                          change={() => guarded(() => toggle(r))}
                        />
                      ))}
                    {tab === "资源包" && (
                      <>
                        <Button
                          disabled={resourceBusy || !r.enabled || n === 0}
                          title="上移加载顺序"
                          onClick={() => guarded(() => moveResource(r, -1))}
                        >
                          <ArrowUp size={14} />
                        </Button>
                        <Button
                          disabled={
                            resourceBusy ||
                            !r.enabled ||
                            n === rows.filter((x) => x.enabled).length - 1
                          }
                          title="下移加载顺序"
                          onClick={() => guarded(() => moveResource(r, 1))}
                        >
                          <ArrowDown size={14} />
                        </Button>
                      </>
                    )}
                    {managed && (
                      <Button
                        className="resource-delete-button"
                        aria-label={`删除 ${r.name}`}
                        title="删除"
                        disabled={resourceBusy || updates?.applying}
                        onClick={() => confirmResourceDelete([r.name])}
                      >
                        <Trash2 size={16} />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty
            title={
              schematic && q.trim()
                ? "没有匹配的投影文件"
                : modResources.length && tab === "Mod"
                  ? "没有匹配的模组"
                  : `还没有${tab}`
            }
            detail={
              schematic && q.trim()
                ? "试试其他文件名。"
                : tab === "Mod" && modResources.length
                  ? "调整搜索词或状态筛选后再试。"
                  : desktop
                    ? `把文件拖到这里，或打开${tab}文件夹添加；列表会自动刷新。`
                    : "网页预览不读取本机文件。"
            }
          />
        )}
      </>
    );
  }
  return (
    <>
      {preview && (
        <SchematicPreviewDialog
          request={preview}
          onClose={() => Preview(null)}
        />
      )}
      {deleteRequest && (
        <ResourceDeleteDialog
          request={deleteRequest}
          close={() => DeleteRequestState(null)}
          completed={async (deleted) => {
            SelectResources((before) =>
              before.filter((name) => !deleted.includes(name)),
            );
            R((before) => before.filter((r) => !deleted.includes(r.name)));
            s.notify(`已将 ${deleted.length} 个文件移到回收站`);
            await refreshResources();
          }}
        />
      )}
      <div className="detail-head">
        <button
          aria-label="返回版本"
          className="back"
          onClick={() => s.setPage("library")}
        >
          <ArrowLeft />
        </button>
        <div className="detail-cover">
          <InstanceIcon instance={i} className="instance-detail-icon" />
        </div>
        <div className="grow">
          <h1>
            {i.name} <Badge tone="ok">Java</Badge>
          </h1>
          <p className="mono">
            Minecraft {i.version} · {i.loader}
            {i.loader === "forge" && i.optifineVersion
              ? " + OptiFine"
              : ""} · {i.settings.memory} MB
          </p>
        </div>
        <Button onClick={() => s.show("instance-settings", i.id)}>
          <Settings size={15} />
          版本设置
        </Button>
        <Button
          onClick={() =>
            guarded(async () => {
              if (!(await chooseInstanceIcon(i.id))) return;
              s.notify("实例图标已更新");
            })
          }
        >
          <ImagePlus size={15} />
          更换图标
        </Button>
        <Button onClick={() => guarded(() => api("open_folder", { id: i.id }))}>
          <FolderOpen size={15} />
          打开文件夹
        </Button>
        <Button onClick={() => s.show("remove-instance", i.id)}>
          <Trash2 size={15} />
          删除版本
        </Button>
        <Button onClick={() => s.show("export", i.id)}>
          <PackageOpen size={15} />
          导出整合包
        </Button>
        <Button primary busy={launchPreparing(s)} onClick={() => void launch()}>
          <Play size={15} />
          启动
        </Button>
      </div>
      <Tabs
        items={[
          "概览",
          ...(vanilla ? [] : ["Mod"]),
          "资源包",
          "存档",
          ...(vanilla ? [] : ["光影"]),
          "数据包",
          ...(vanilla ? [] : ["投影"]),
          "设置",
        ]}
        value={tab}
        onChange={T}
      />
      {tab === "概览" ? (
        <div className="two-col">
          <Card>
            <h3>实例信息</h3>
            {[
              ["游戏版本", i.version],
              ["加载器", i.loader],
              ["内存", `${i.settings.memory} MB`],
              ["Java", i.settings.java || "自动匹配"],
              ["目录", i.path],
              ["版本隔离", i.settings.isolation],
            ].map(([k, v]) => (
              <div className="kv" key={k}>
                <span>{k}</span>
                <span className="mono">{v}</span>
              </div>
            ))}
          </Card>
          <Card>
            <h3>快捷操作</h3>
            <p>每个实例都有自己的模组、配置与世界。</p>
            <div className="stack">
              <Button onClick={() => s.show("export", i.id)}>导出整合包</Button>
              <Button onClick={() => T("存档")}>管理存档</Button>
              <Button
                onClick={() =>
                  window.dispatchEvent(new Event("kynex-open-assistant"))
                }
              >
                AI 助手 / 日志分析
              </Button>
            </div>
          </Card>
        </div>
      ) : tab === "设置" ? (
        <Card>
          <h3>仅对本版本生效</h3>
          <p>实例内存、Java 路径、窗口大小与隔离目录。</p>
          <div className="actions">
            <Button primary onClick={() => s.show("instance-settings", i.id)}>
              编辑版本设置
            </Button>
            <Button onClick={() => T("投影")}>
              <FolderOpen size={15} /> 投影文件管理
            </Button>
          </div>
        </Card>
      ) : (
        <div
          className={`resource-dropzone ${managed ? "pcl-resource-page" : ""} ${selectedResources.length ? "has-selection" : ""} ${dragging ? "dragging" : ""}`}
          onKeyDown={(event) => {
            if (
              !managed ||
              resourceBusy ||
              (event.target instanceof HTMLInputElement &&
                event.target.type !== "checkbox")
            )
              return;
            if (
              (event.ctrlKey || event.metaKey) &&
              event.key.toLowerCase() === "a"
            ) {
              event.preventDefault();
              SelectResources(visibleResources.map((r) => r.name));
            } else if (event.key === "Delete" && selectedResources.length) {
              event.preventDefault();
              confirmResourceDelete(selectedResources);
            }
          }}
          onDragEnter={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (event.dataTransfer.types.includes("Files")) Dragging(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!event.currentTarget.contains(event.relatedTarget))
              Dragging(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void guarded(() => importDropped(event.dataTransfer.files));
          }}
        >
          <div className="spread section-tools">
            <SearchInput value={q} onChange={Q} placeholder={`搜索${tab}`} />
            <div
              className={`resource-management-actions${schematic ? " schematic-actions" : ""}`}
            >
              <Button
                disabled={schematic && !desktop}
                onClick={() =>
                  guarded(() =>
                    api("open_resource_folder", {
                      id: i.id,
                      kind: tabKinds[tab],
                      world:
                        tab === "数据包" ? dataWorld || undefined : undefined,
                    }),
                  )
                }
              >
                <FolderOpen size={14} /> 打开{tab}文件夹
              </Button>
              <Button
                disabled={resourceBusy}
                onClick={() => guarded(browseResource)}
              >
                <Upload size={14} />{" "}
                {schematic
                  ? "导入投影文件"
                  : tab === "存档"
                    ? "导入地图"
                    : "从文件安装"}
              </Button>
              {managed && (
                <Button
                  disabled={resourceBusy || !visibleResources.length}
                  onClick={() =>
                    SelectResources(
                      selectedResources.length === visibleResources.length
                        ? []
                        : visibleResources.map((r) => r.name),
                    )
                  }
                >
                  <CheckSquare size={14} />{" "}
                  {visibleResources.length > 0 &&
                  selectedResources.length === visibleResources.length
                    ? "取消全选"
                    : "全选"}
                </Button>
              )}
              <Button
                busy={loading}
                disabled={!!deleteRequest}
                onClick={() => guarded(refreshResources)}
              >
                <RefreshCw size={14} /> 刷新
              </Button>
            </div>
          </div>

          {dragging && (
            <div className="resource-drop-hint">
              <Upload size={28} />
              <b>松开以添加到{tab}文件夹</b>
              <span>
                {schematic
                  ? "文件会复制到当前投影文件夹"
                  : "文件会复制到当前实例，并立即出现在列表中"}
              </span>
            </div>
          )}
          {tab === "数据包" && (
            <div className="notice">
              <OptionSelect
                label="查看数据包的存档"
                value={dataWorld}
                onChange={DataWorld}
                options={[
                  { value: "", label: "实例级待安装文件" },
                  ...dataWorlds.map((w) => ({ value: w.name, label: w.name })),
                ]}
              />
              <p>
                {dataWorld
                  ? `当前查看 ${dataWorld} 的 datapacks 文件夹。`
                  : "可选择存档查看其中的数据包，或在下载页面选择数据包版本与目标存档。"}
              </p>
            </div>
          )}
          {error && <div className="notice error">{error}</div>}
          {schematic && desktop && (
            <p className="notice">
              导入后，在游戏里用默认快捷键 M 打开 Litematica
              菜单并选择「加载投影」。
            </p>
          )}
          {tab === "Mod" ? (
            <ModUpdates
              key={i.id}
              id={i.id}
              refresh={refreshResources}
              resources={modResources}
              resourcesReady={resourcesReady}
              filter={resourceFilter}
              onFilterChange={ResourceFilter}
              disabled={!!deleteRequest}
              revision={modResources
                .map((r) => `${r.name}:${r.size}:${r.modified ?? ""}`)
                .join("|")}
            >
              {(state) => renderResources(state)}
            </ModUpdates>
          ) : (
            renderResources()
          )}
          {managed && selectedResources.length > 0 && (
            <div
              className="resource-selection-bar"
              role="region"
              aria-label="已选资源操作"
            >
              <span>已选择 {selectedResources.length} 个文件</span>
              <Button
                disabled={resourceBusy}
                onClick={() => SelectResources([])}
              >
                取消选择
              </Button>
              <Button
                className="resource-delete-button"
                disabled={resourceBusy}
                onClick={() => confirmResourceDelete(selectedResources)}
              >
                <Trash2 size={16} /> 删除所选
              </Button>
            </div>
          )}
          {managed && <div className="resource-drag-count" aria-hidden="true" />}

          {tab === "资源包" && (
            <small className="muted">
              已写入本实例的 Minecraft 资源包配置；下次进入游戏生效。
            </small>
          )}
        </div>
      )}
    </>
  );
}
