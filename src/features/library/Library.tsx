import { useGuideSection, isGuideActive } from "../../lib/guideNavigation";
import { InstanceIcon } from "../../components/ui/LoaderIcon";
import { GameDirectoryBar } from "./GameDirectoryBar";
import { ResourceDeleteDialog, type DeleteRequest } from "./ResourceDeleteDialog";
import { useResourceDragSelection } from "./useResourceDragSelection";
import { useModUpdateState } from "../../lib/modUpdateState";
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
import { useStore, guarded, launch } from "../../store";
import {
  api,
  desktop,
  pickFile,
  pickImageFile,
  readableSize,
} from "../../lib/bridge";
import type { Resource } from "../../lib/types";
async function chooseInstanceIcon(id: string) {
  const file = await pickImageFile("wallpaper");
  if (!file) return false;
  if (file.size > 2 * 1024 * 1024) throw new Error("实例图标不能大于 2 MB");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  await api("save_instance_icon", {
    id,
    mime: file.type,
    base64: btoa(binary),
  });
  return true;
}
export function Library() {
  const s = useStore();
  const [q, Q] = useState("");
  const [type, T] = useState("全部");
  useGuideSection("library", T);
  const [worlds, W] = useState<
    { name: string; id: string; instance: string; version: string }[]
  >([]);
  useEffect(() => {
    if (!desktop) return;
    Promise.all(
      s.instances.map(async (i) =>
        (await api<Resource[]>("resources", { id: i.id, kind: "saves" }))
          .filter((w) => w.dir !== false)
          .map((w) => ({
            name: w.name,
            id: i.id,
            instance: i.name,
            version: i.version,
          })),
      ),
    )
      .then((v) => W(v.flat()))
      .catch((e) => s.notify(String(e)));
  }, [s.instances]);
  const shown = s.instances.filter(
    (i) =>
      i.name.toLowerCase().includes(q.toLowerCase()) &&
      (type === "全部" || type === "实例"),
  );
  async function uploadIcon(id: string) {
    if (!(await chooseInstanceIcon(id))) return;
    await s.refresh();
    s.notify("实例图标已更新");
  }
  return (
    <>
      <GameDirectoryBar />
      <div className="page-head">
        <div className="actions">
          <Button onClick={() => s.setPage("workshop")}>AI 整合包工坊</Button>
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
            >
              <button
                className={`instance-cover cover-${i.loader}`}
                onClick={() => {
                  useStore.setState({ selected: i.id });
                  s.setPage("instance");
                }}
              >
                <InstanceIcon
                  instance={i}
                  className={
                    i.icon ? "instance-custom-icon" : "instance-default-icon"
                  }
                />
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
                <Button
                  primary
                  onClick={() => {
                    useStore.setState({ selected: w.id });
                    void guarded(() => api("open_resource_folder", { id: w.id, kind: "saves" }));
                  }}
                >
                  打开存档文件夹
                </Button>
              </Card>
            ))}
        </div>
      ) : (
        <Empty
          title="还没有匹配的内容"
          detail={
            type === "存档"
                ? "进入实例详情的「存档」标签查看本机世界。"
                : "安装版本后会显示在这里。"
          }
        >
          <Button
            primary
            onClick={() =>
              s.setPage("discover")
            }
          >
            浏览版本
          </Button>
        </Empty>
      )}
    </>
  );
}
const tabKinds: Record<string, string> = {
  Mod: "mods",
  资源包: "resourcepacks",
  存档: "saves",
  光影: "shaderpacks",
  数据包: "datapacks",
};
import { loadModNames, localModName } from "../download/modLocalization";
import { ModUpdates, type ModUpdateContext } from "../download/ModManagement";
import "./modUpdates.css";
import "./resourceManagement.css";
export function InstanceDetail() {
  const s = useStore();
  const i = s.instances.find((i) => i.id === s.selected);
  const [tab, T] = useState("概览");
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
  const [rows, R] = useState<Resource[]>([]);
  const [loadedResources, LoadedResources] = useState("");
  const [selectedResources, SelectResources] = useState<string[]>([]);
  const [deleteRequest, DeleteRequestState] = useState<DeleteRequest | null>(null);
  const [resourceFilter, ResourceFilter] = useState("all");
  const cachedModRows = useModUpdateState((state) => state.byId[s.selected]?.rows);
  const [q, Q] = useState("");
  const [dataWorld, DataWorld] = useState("");
  const [dataWorlds, DataWorlds] = useState<{ name: string }[]>([]);
  useEffect(() => {
    let live = true;
    DataWorld("");
    DataWorlds([]);
    if (i && tab === "数据包" && desktop)
      void api<{ name: string }[]>("datapack_worlds", { id: i.id })
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
  const managed = ["Mod", "资源包", "光影", "数据包"].includes(tab);
  const currentResourceScope = `${i?.id ?? ""}:${tabKinds[tab] ?? ""}:${tab === "数据包" ? dataWorld : ""}`;
  const resourceScope = useRef(currentResourceScope);
  resourceScope.current = currentResourceScope;
  const scopeRows = loadedResources === currentResourceScope ? rows : [];
  const resourceBusy = loading || loadedResources !== currentResourceScope || !!deleteRequest || Object.values(s.tasks).some((task) =>
    !task.finished && !task.error && task.payload?.id === i?.id && ["install_project", "update_mods", "export_pack"].includes(task.action || ""));
  const updateMap = new Map((cachedModRows || []).map((row) => [row.file, row]));
  const visibleResources = scopeRows.filter((r) => (tab !== "Mod" || !r.dir && /\.(jar|litemod)(\.disabled)?$/i.test(r.name)) &&
    `${r.name} ${tab === "Mod" ? localModName(r.modIds, r.name) : ""}`.toLowerCase().includes(q.toLowerCase()) &&
    (tab !== "Mod" || resourceFilter === "all" || resourceFilter === "enabled" && r.enabled || resourceFilter === "disabled" && !r.enabled ||
      resourceFilter === "update" && updateMap.get(r.name)?.status === "update" || resourceFilter === "unknown" && r.enabled &&
      (!updateMap.has(r.name) || ["error", "unknown"].includes(updateMap.get(r.name)!.status) || updateMap.get(r.name)?.partial)));
  const visibleSignature = visibleResources.map((r) => r.name).join("\0");
  const dragSelection = useResourceDragSelection(visibleResources.map((r) => r.name), selectedResources, SelectResources, resourceBusy || !managed);
  useEffect(() => {
    SelectResources([]); DeleteRequestState(null); ResourceFilter("all"); Q("");
  }, [i?.id, tab, dataWorld]);
  useEffect(() => {
    const visible = new Set(visibleSignature.split("\0"));
    SelectResources((before) => {
      const next = before.filter((name) => visible.has(name));
      return next.length === before.length ? before : next;
    });
  }, [visibleSignature]);
  const ensuredLoaders = useRef(new Set<string>());
  const resourceRequests = useRef(new Map<string, Promise<void>>());
  const resourceRows = useRef(new Map<string, Resource[]>());
  const displayedResourceScope = useRef("");
  const detailedResourceScopes = useRef(new Set<string>());
  const refreshResources = useCallback(async () => {
    if (!i || !tabKinds[tab] || !desktop) return;
    const scope = `${i.id}:${tabKinds[tab]}:${tab === "数据包" ? dataWorld : ""}`;
    const pending = resourceRequests.current.get(scope);
    if (pending) {
      const cached = resourceRows.current.get(scope);
      if (cached && resourceScope.current === scope) {
        R(cached); LoadedResources(scope); Loading(false); displayedResourceScope.current = scope;
      }
      return pending;
    }
    const payload = {
      id: i.id,
      kind: tabKinds[tab],
      world: tab === "数据包" ? dataWorld || undefined : undefined,
    };
    const request = (async () => {
    if (displayedResourceScope.current !== scope) {
    const first = resourceRows.current.get(scope) ?? await api<Resource[]>("resources", { ...payload, basic: true });
    resourceRows.current.set(scope, first);
    if (resourceScope.current === scope) {
      R(first);
      displayedResourceScope.current = scope;
      LoadedResources(scope);
      Loading(false);
    }
    }
    if (!detailedResourceScopes.current.has(scope) && tab !== "存档") {
      const initial = resourceRows.current.get(scope) || [];
      for (let offset = 0; offset < initial.length; offset += 32) {
        if (resourceScope.current !== scope) return;
        const preview = await api<Resource[]>("resources", { ...payload, previewNames: initial.slice(offset, offset + 32).map(row => row.name) });
        const byName = new Map(preview.map(row => [row.name, row]));
        const merged = (resourceRows.current.get(scope) || initial).map(row => byName.get(row.name) || row);
        resourceRows.current.set(scope, merged);
        if (resourceScope.current === scope) R(merged);
      }
    }
    const value = await api<Resource[]>("resources", payload);
    detailedResourceScopes.current.add(scope);
    if (resourceRows.current.size > 12) resourceRows.current.clear();
    resourceRows.current.set(scope, value);
    if (resourceScope.current !== scope) return;
    E("");
    R((before) =>
      before.length === value.length && before.every((row,n) => {
        const other = value[n];
        return row.name === other.name && row.size === other.size && row.modified === other.modified &&
          row.enabled === other.enabled && row.version === other.version && row.icon_url === other.icon_url &&
          row.order === other.order && JSON.stringify(row.modIds) === JSON.stringify(other.modIds) &&
          JSON.stringify(row.problems) === JSON.stringify(other.problems);
      }) ? before : value,
    );
    LoadedResources(scope);
    })().finally(() => resourceRequests.current.delete(scope));
    resourceRequests.current.set(scope, request);
    return request;
  }, [i?.id, tab, dataWorld]);
  const importPaths = useCallback(
    async (paths: string[]) => {
      if (!i || !tabKinds[tab] || !paths.length) return;
      Loading(true);
      try {
        const value = await api<Resource[]>("import_resource_paths", {
          id: i.id,
          kind: tabKinds[tab],
          world: tab === "数据包" ? dataWorld || undefined : undefined,
          paths,
        });
        R(value);
        useStore.getState().notify(`已添加 ${paths.length} 个${tab}`);
      } finally {
        Loading(false);
        Dragging(false);
      }
    },
    [i?.id, tab, dataWorld],
  );
  useEffect(() => {
    E("");
    if (i && tabKinds[tab] && desktop) {
      let live = true;
      LoadedResources("");
      Loading(true);
      let running = false;
      const update = () => {
        if (running || !live || document.hidden) return;
        running = true;
        return refreshResources()
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
      displayedResourceScope.current = "";
    }
  }, [i?.id, tab, refreshResources]);
  useEffect(() => {
    if (isGuideActive() || !desktop || !i || tab !== "Mod" || ensuredLoaders.current.has(i.id))
      return;
    ensuredLoaders.current.add(i.id);
    void api<{
      installed: boolean;
      required: boolean;
      label?: string;
    }>("ensure_loader_components", { id: i.id })
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
    const nativeDrop = (raw: Event) => {
      const detail = (raw as CustomEvent).detail as
        | { type: "enter" | "over"; paths?: string[] }
        | { type: "drop"; paths: string[] }
        | { type: "leave" };
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
  async function moveResource(r: Resource, direction: number) {
    if (!i) return;
    const value = await api<Resource[]>("resource_move", {
      id: i.id,
      name: r.name,
      direction,
    });
    R(value);
  }
  async function toggle(r: Resource) {
    if (!i) return;
    await api("toggle_resource", {
      id: i.id,
      kind: tabKinds[tab],
      world: tab === "数据包" ? dataWorld || undefined : undefined,
      name: r.name,
    });
    await refreshResources();
  }
  async function importDropped(files: FileList) {
    if (!i || !tabKinds[tab] || !desktop) return;
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
      s.notify(`已添加 ${accepted.length} 个${tab}`);
    } finally {
      Loading(false);
      Dragging(false);
    }
  }
  async function browseResource() {
    if (!tabKinds[tab]) return;
    const path = await pickFile([
      {
        name: tab === "Mod" ? "Mod" : tab,
        extensions: [tab === "Mod" ? "jar" : "zip"],
      },
    ]);
    if (path) await importPaths([path]);
  }
  const modResources = scopeRows.filter(
    (r) => !r.dir && /\.(jar|litemod)(\.disabled)?$/i.test(r.name),
  );
  function selectResource(name: string) {
    if (resourceBusy) return;
    SelectResources((before) => before.includes(name) ? before.filter((n) => n !== name) : [...before, name]);
  }
  function confirmResourceDelete(names: string[]) {
    if (!i || !names.length || resourceBusy) return;
    DeleteRequestState({ id: i.id, kind: tabKinds[tab], world: tab === "数据包" ? dataWorld || undefined : undefined,
      label: tab === "Mod" ? "模组" : tab, names, shared: i.settings.isolation === "shared" || i.settings.isolation === "modded" && i.loader === "vanilla" });
  }
  function renderResources(updates?: ModUpdateContext) {
    if (desktop && loadedResources !== currentResourceScope) return <p className="resource-loading" role="status">正在读取{tab}…</p>;
    const visible = visibleResources;
    return (
      <>
        {visible.length ? (
          <div
            className={`resource-list ${tab === "Mod" ? "mod-resource-list" : ""}`}
            {...(managed ? dragSelection : {})}
          >
            {visible.map((r, n) => {
              const update = updates?.byFile.get(r.name);
              const SelectionContent = managed ? "button" : "div";
              return (
                <div className={`resource-row ${selectedResources.includes(r.name) ? "selected" : ""}`} key={r.name}
                  data-resource-name={r.name}>
                  <SelectionContent className="resource-selection-content"
                    {...(managed ? { type: "button" as const, "aria-label": `选择 ${r.name}`, "aria-pressed": selectedResources.includes(r.name), disabled: resourceBusy || updates?.applying, onClick: () => selectResource(r.name) } : {})}>
                  <div className="resource-monogram">
                    {!r.icon_url && <span><Box size={20} /></span>}
                    {r.icon_url && (
                      <img
                        src={r.icon_url}
                        draggable={false}
                        alt=""
                        loading="lazy"
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                        }}
                      />
                    )}
                  </div>
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
                      {readableSize(r.size)} ·{" "}
                      {tab === "数据包"
                        ? r.enabled
                          ? "文件已就绪，游戏中确认启用"
                          : "文件已停用"
                        : r.enabled
                          ? "已启用"
                          : "已停用"}
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
                  <div className="resource-row-actions" onClick={(e) => e.stopPropagation()}>
                  {tab === "存档" ? (
                    <Button
                      primary
                      onClick={() => void guarded(() => api("open_resource_folder", { id: s.selected, kind: "saves" }))}
                    >
                      打开存档文件夹
                    </Button>
                  ) : managed ? (
                    <Button className="resource-enable-button" role="switch" aria-checked={r.enabled}
                      aria-label={`${r.name} 启用`} title={r.enabled ? "停用" : "启用"}
                      disabled={resourceBusy || updates?.applying} onClick={() => guarded(() => toggle(r))}>
                      {r.enabled ? <CircleMinus size={16} /> : <CircleCheck size={16} />}
                    </Button>
                  ) : (
                    <Switch
                      label={`${r.name} 启用`}
                      disabled={resourceBusy || updates?.applying}
                      on={r.enabled}
                      change={() => guarded(() => toggle(r))}
                    />
                  )}
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
                          resourceBusy || !r.enabled ||
                          n === rows.filter((x) => x.enabled).length - 1
                        }
                        title="下移加载顺序"
                        onClick={() => guarded(() => moveResource(r, 1))}
                      >
                        <ArrowDown size={14} />
                      </Button>
                    </>
                  )}
                  {managed && <Button className="resource-delete-button" aria-label={`删除 ${r.name}`} title="删除"
                    disabled={resourceBusy || updates?.applying} onClick={() => confirmResourceDelete([r.name])}><Trash2 size={16} /></Button>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty
            title={
              modResources.length && tab === "Mod"
                ? "没有匹配的模组"
                : `还没有${tab}`
            }
            detail={
              tab === "Mod" && modResources.length
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
      {deleteRequest && <ResourceDeleteDialog request={deleteRequest} close={() => DeleteRequestState(null)} completed={async (deleted) => {
        SelectResources((before) => before.filter((name) => !deleted.includes(name)));
        R((before) => before.filter((r) => !deleted.includes(r.name)));
        s.notify(`已将 ${deleted.length} 个文件移到回收站`);
        await refreshResources();
      }} />}
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
              await s.refresh();
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
        <Button primary busy={s.busy} onClick={() => void launch()}>
          <Play size={15} />
          启动
        </Button>
      </div>
      <Tabs
        items={[
          "概览",
          "Mod",
          "资源包",
          "存档",
          "光影",
          "数据包",
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
              <Button onClick={() => window.dispatchEvent(new Event("kynex-open-assistant"))}>
                AI 助手 / 日志分析
              </Button>

            </div>
          </Card>
        </div>
      ) : tab === "设置" ? (
        <Card>
          <h3>仅对本版本生效</h3>
          <p>实例内存、Java 路径、窗口大小与隔离目录。</p>
          <Button primary onClick={() => s.show("instance-settings", i.id)}>
            编辑版本设置
          </Button>
        </Card>
      ) : (
        <div
          className={`resource-dropzone ${managed ? "pcl-resource-page" : ""} ${selectedResources.length ? "has-selection" : ""} ${dragging ? "dragging" : ""}`}
          onKeyDown={(event) => {
            if (!managed || resourceBusy || event.target instanceof HTMLInputElement && event.target.type !== "checkbox") return;
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
              event.preventDefault(); SelectResources(visibleResources.map((r) => r.name));
            } else if (event.key === "Delete" && selectedResources.length) {
              event.preventDefault(); confirmResourceDelete(selectedResources);
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
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            )
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
            <div className="resource-management-actions">
            <Button
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
            <Button disabled={resourceBusy} onClick={() => guarded(browseResource)}>
              <Upload size={14} /> {managed ? "从文件安装" : `添加${tab}`}
            </Button>
            {managed && <Button disabled={resourceBusy || !visibleResources.length} onClick={() => SelectResources(
              selectedResources.length === visibleResources.length ? [] : visibleResources.map((r) => r.name))}>
              <CheckSquare size={14} /> {visibleResources.length > 0 && selectedResources.length === visibleResources.length ? "取消全选" : "全选"}
            </Button>}
            <Button busy={loading} disabled={!!deleteRequest} onClick={() => guarded(refreshResources)}>
              <RefreshCw size={14} /> 刷新
            </Button>
            </div>
          </div>

          {dragging && (
            <div className="resource-drop-hint">
              <Upload size={28} />
              <b>松开以添加到{tab}文件夹</b>
              <span>文件会复制到当前实例，并立即出现在列表中</span>
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
          {tab === "Mod" ? (
            <ModUpdates
              key={i.id}
              id={i.id}
              refresh={refreshResources}
              resources={modResources}
              resourcesReady={loadedResources === currentResourceScope}
              filter={resourceFilter}
              onFilterChange={ResourceFilter}
              disabled={!!deleteRequest}
              revision={modResources
                .map(
                  (r) => `${r.name}:${r.size}:${r.modified ?? ""}`,
                )
                .join("|")}
            >
              {(state) => renderResources(state)}
            </ModUpdates>
          ) : (
            renderResources()
          )}
          {managed && selectedResources.length > 0 && <div className="resource-selection-bar" role="region" aria-label="已选资源操作">
            <span>已选择 {selectedResources.length} 个文件</span>
            <Button disabled={resourceBusy} onClick={() => SelectResources([])}>取消选择</Button>
            <Button className="resource-delete-button" disabled={resourceBusy} onClick={() => confirmResourceDelete(selectedResources)}>
              <Trash2 size={16} /> 删除所选
            </Button>
          </div>}

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
