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
} from "../../components/ui";
import { useStore, guarded, launch } from "../../store";
import {
  api,
  desktop,
  pickFile,
  pickImageFile,
  readableSize,
} from "../../lib/bridge";
import type { Game, Resource } from "../../lib/types";
export const games: { value: Game | "all"; label: string }[] = [
  { value: "all", label: "全部游戏" },
  { value: "java", label: "Java 版" },
];
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
export function GameChips({
  value,
  change,
}: {
  value: string;
  change: (s: string) => void;
}) {
  return (
    <div className="chips">
      {games.map((g) => (
        <Chip
          key={g.value}
          active={g.value === value}
          onClick={() => change(g.value)}
        >
          {g.label}
        </Chip>
      ))}
    </div>
  );
}
export function Library() {
  const s = useStore();
  const [q, Q] = useState("");
  const [game, G] = useState("all");
  const [type, T] = useState("全部");
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
      (game === "all" || i.game === game) &&
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
      <div className="page-head">
        <div>
          <h1>你的世界</h1>
          <p>游戏、服务器与存档，在这里井然有序。</p>
        </div>
        <div className="actions">
          <SearchInput
            value={q}
            onChange={Q}
            placeholder="搜索版本、服务器、存档"
          />
          <></>
          <Button primary onClick={() => s.setPage("discover")}>
            <Plus size={16} />
            新建
          </Button>
        </div>
      </div>
      <GameChips value={game} change={G} />
      <div className="chips">
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
                {i.icon ? (
                  <img className="instance-custom-icon" src={i.icon} alt="" />
                ) : (
                  <div className="cube">
                    <i />
                    <i />
                    <i />
                  </div>
                )}
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
                <></>
              </Card>
            ))}
        </div>
      ) : (
        <Empty
          title={
            game !== "java" && game !== "all"
              ? "通过官方客户端游玩"
              : "还没有匹配的内容"
          }
          detail={
            type === "服务器"
              ? "输入服务器地址，Kynex 会解析 SRV 并连接所选实例。"
              : type === "存档"
                ? "进入实例详情的「存档」标签查看本机世界。"
                : "安装版本后，它会出现在你的游戏库中。"
          }
        >
          <></>
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
export function InstanceDetail() {
  const s = useStore();
  const i = s.instances.find((i) => i.id === s.selected);
  const [tab, T] = useState("概览");
  const [rows, R] = useState<Resource[]>([]);
  const [q, Q] = useState("");
  const [error, E] = useState("");
  const [loading, Loading] = useState(false);
  const [dragging, Dragging] = useState(false);
  const ensuredLoaders = useRef(new Set<string>());
  const refreshResources = useCallback(async () => {
    if (!i || !tabKinds[tab] || !desktop) return;
    const value = await api<Resource[]>("resources", {
      id: i.id,
      kind: tabKinds[tab],
    });
    R((before) =>
      JSON.stringify(before) === JSON.stringify(value) ? before : value,
    );
  }, [i?.id, tab]);
  const importPaths = useCallback(
    async (paths: string[]) => {
      if (!i || !tabKinds[tab] || !paths.length) return;
      Loading(true);
      try {
        const value = await api<Resource[]>("import_resource_paths", {
          id: i.id,
          kind: tabKinds[tab],
          paths,
        });
        R(value);
        useStore.getState().notify(`已添加 ${paths.length} 个${tab}`);
      } finally {
        Loading(false);
        Dragging(false);
      }
    },
    [i?.id, tab],
  );
  useEffect(() => {
    E("");
    if (i && tabKinds[tab] && desktop) {
      let live = true;
      Loading(true);
      const update = () =>
        refreshResources()
          .catch((reason) => {
            if (live) E(String(reason));
          })
          .finally(() => {
            if (live) Loading(false);
          });
      void update();
      const timer = window.setInterval(update, 1500);
      window.addEventListener("focus", update);
      return () => {
        live = false;
        window.clearInterval(timer);
        window.removeEventListener("focus", update);
      };
    } else {
      R([]);
    }
  }, [i?.id, tab, refreshResources]);
  useEffect(() => {
    if (!desktop || !i || tab !== "Mod" || ensuredLoaders.current.has(i.id))
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
  return (
    <>
      <div className="detail-head">
        <button
          aria-label="返回版本"
          className="back"
          onClick={() => s.setPage("library")}
        >
          <ArrowLeft />
        </button>
        <div className="detail-cover">
          {i.icon ? (
            <img className="instance-detail-icon" src={i.icon} alt="" />
          ) : (
            <Box size={40} />
          )}
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
          "服务器",
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
              <Button onClick={() => s.setPage("diagnose")}>
                诊断游戏日志
              </Button>
              <></>
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
          className={`resource-dropzone ${dragging ? "dragging" : ""}`}
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
            <Button busy={loading} onClick={() => guarded(refreshResources)}>
              <RefreshCw size={14} /> 刷新
            </Button>
            <Button busy={loading} onClick={() => guarded(browseResource)}>
              <Upload size={14} /> 添加{tab}
            </Button>
            <Button
              onClick={() =>
                guarded(() =>
                  api("open_resource_folder", {
                    id: i.id,
                    kind: tabKinds[tab],
                  }),
                )
              }
            >
              <FolderOpen size={14} /> 打开{tab}文件夹
            </Button>
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
              数据包需要放在指定世界的 saves/世界名/datapacks
              中；这里显示实例级待安装文件。
            </div>
          )}
          {error && <div className="notice error">{error}</div>}
          {rows.length ? (
            <div className="resource-list">
              {rows
                .filter((r) => r.name.toLowerCase().includes(q.toLowerCase()))
                .map((r, n) => (
                  <div className="resource-row" key={r.name}>
                    <div className="resource-monogram">
                      <span>{r.name.slice(0, 2).toUpperCase()}</span>
                      {r.icon_url && (
                        <img
                          src={r.icon_url}
                          alt=""
                          loading="lazy"
                          onError={(event) => {
                            event.currentTarget.style.display = "none";
                          }}
                        />
                      )}
                    </div>
                    <div className="grow">
                      <b>{r.name.replace(/\.disabled$/, "")}</b>
                      <small>
                        {readableSize(r.size)} ·{" "}
                        {r.enabled ? "已启用" : "已停用"}
                      </small>
                    </div>
                    {r.problems?.map((problem) => (
                      <Badge key={problem} tone="warn">
                        {problem}
                      </Badge>
                    ))}
                    {tab === "存档" ? (
                      <></>
                    ) : (
                      <Switch
                        label={`${r.name} 启用`}
                        on={r.enabled}
                        change={() => guarded(() => toggle(r))}
                      />
                    )}
                    {tab === "资源包" && (
                      <>
                        <Button
                          disabled={!r.enabled || n === 0}
                          title="上移加载顺序"
                          onClick={() => guarded(() => moveResource(r, -1))}
                        >
                          <ArrowUp size={14} />
                        </Button>
                        <Button
                          disabled={
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
                  </div>
                ))}
            </div>
          ) : (
            <Empty
              title={`还没有${tab}`}
              detail={
                desktop
                  ? `把文件拖到这里，或打开${tab}文件夹添加；列表会自动刷新。`
                  : "网页预览不读取本机文件。"
              }
            />
          )}
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
