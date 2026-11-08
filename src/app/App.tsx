import { DownloadTasks } from "../features/download/DownloadTasks";
import { progressBuffer } from "../lib/progressBuffer";
import { useModUpdateState, type ModScanEvent } from "../lib/modUpdateState";
import { RELEASE } from "../lib/release";
import { normalizeUiOpacity } from "../lib/appearance";
import { useAdaptiveText } from "../lib/useAdaptiveText";
import { ReleaseNotices } from "../features/updates/ReleaseNotices";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useState,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Rocket,
  Boxes,
  Download,
  UsersRound,
  Shirt,
  Activity,
  Settings as SettingsIcon,
  HelpCircle,
  Minus,
  X,
  Upload,
  RotateCw,
  PackagePlus,
  Newspaper,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Page } from "../lib/types";
import { useStore, guarded } from "../store";
import { api, assetUrl, desktop, onProgress, pickFile } from "../lib/bridge";
import { Home } from "../features/launch/Home";
import { Library, InstanceDetail } from "../features/library/Library";
import { Download as Discover } from "../features/download/Download";
import { News } from "../features/news/News";
import { Accounts } from "../features/account/Accounts";
const Skin = lazy(() =>
  import("../features/skin/Skin").then((module) => ({ default: module.Skin })),
);
import {
  AutomaticDiagnosis,
  useDiagnosis,
  type DiagnosisEvent,
} from "../features/diagnose/AiDiagnosis";
import { Diagnose } from "../features/diagnose/Diagnose";
import { Settings } from "../features/settings/Settings";
import { Help } from "../features/help/Help";
import { Modals } from "./Modals";
import { Splash, KxlMark } from "./Splash";
import {
  Button,
  Toast,
  ProgressBar,
  Badge,
  Card,
  Input,
  Chip,
  Switch,
  Tabs,
  Skeleton,
} from "../components/ui";
import wallpaper from "../assets/wallpaper-default.jpg";
import brandIcon from "../assets/kxl-icon.png";
import { MotionPage } from "../components/ui/Motion";
import { useSelectionMotion } from "../lib/useSelectionMotion";
const navigation: { id: Page; label: string; icon: ReactNode }[] = [
  { id: "home", label: "启动", icon: <Rocket /> },
  { id: "library", label: "版本", icon: <Boxes /> },
  { id: "discover", label: "下载", icon: <Download /> },
  { id: "news", label: "MC 新闻", icon: <Newspaper /> },
  { id: "account", label: "账号", icon: <UsersRound /> },
  { id: "skin", label: "皮肤", icon: <Shirt /> },
  { id: "diagnose", label: "诊断", icon: <Activity /> },
  { id: "settings", label: "设置", icon: <SettingsIcon /> },
  { id: "help", label: "帮助", icon: <HelpCircle /> },
];
export function App() {
  const s = useStore();
  const [ready, R] = useState(false);
  const [splash, S] = useState(
    !new URLSearchParams(location.search).has("nosplash"),
  );
  const [drag, D] = useState(false);
  const [tasksOpen, TasksOpen] = useState(false);
  const depth = useRef(0);
  const appRoot = useRef<HTMLElement>(null);
  useEffect(() => {
    const update = () =>
      appRoot.current?.style.setProperty(
        "--corner-aa",
        `${1.35 / Math.max(1, window.devicePixelRatio)}px`,
      );
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  useAdaptiveText(
    appRoot,
    s.settings.wallpaper,
    normalizeUiOpacity(s.settings.uiOpacity),
    s.page,
    s.settings.theme,
  );
  const navRoot = useRef<HTMLElement>(null);
  useSelectionMotion(navRoot);
  // 原生滚轮：自定义惯性在拖滚动条到底时会继续缓动，表现为“还在慢慢下滑”。
  const finish = useCallback(() => S(false), []);
  useEffect(() => {
    if (desktop) {
      localStorage.removeItem("kynex-window-state-v1");
      void api("show_main_window").catch((error) => s.notify(String(error)));
    }
  }, []);
  useEffect(() => {
    if (!desktop) return;
    let live = true;
    let stop: (() => void) | undefined;
    void import("@tauri-apps/api/webview").then(
      async ({ getCurrentWebview }) => {
        const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
          const payload = event.payload;
          const page = useStore.getState().page;
          const delegated = ["instance", "skin", "diagnose"].includes(page);
          window.dispatchEvent(
            new CustomEvent("kynex-native-drag", { detail: payload }),
          );
          if (payload.type === "leave" || payload.type === "drop") D(false);
          else if (!delegated) D(true);
          if (payload.type === "drop" && !delegated) {
            const path = payload.paths[0];
            if (/\.(zip|mrpack|curseforge)$/i.test(path))
              useStore.getState().show("pack", path);
            else
              useStore
                .getState()
                .notify("整窗拖入仅接受 .zip / .mrpack / .curseforge 整合包");
          }
        });
        if (live) stop = unlisten;
        else unlisten();
      },
    );
    return () => {
      live = false;
      stop?.();
    };
  }, []);
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let completionTimer: ReturnType<typeof setTimeout> | undefined;
    let modScanTimer: ReturnType<typeof setInterval> | undefined;
    let live = true;
    const progress = progressBuffer((events) => {
      if (!live) return;
      const tasks = { ...useStore.getState().tasks };
      for (const task of events) {
        const id = task.taskId || "legacy";
        tasks[id] = { ...tasks[id], ...task };
        if (task.error) s.notify(task.error);
      }
      const active = Object.values(tasks).filter(
        (t) => !t.finished && !t.error,
      );
      useStore.setState({ tasks, task: active.at(-1) || null });
    });
    const image = new Image();
    image.src = brandIcon;
    Promise.all([
      image.decode().catch(() => {}),
      desktop
        ? s.refresh().catch((e) => s.notify(String(e)))
        : Promise.resolve(),
    ]).finally(() => {
      if (live) R(true);
    });
    if (desktop) {
      onProgress((task) => {
        if ("modUpdateScan" in task) {
          if (
            task.directoryId &&
            task.directoryId !== useStore.getState().directoryId
          )
            return;
          useModUpdateState
            .getState()
            .receive(task.modUpdateScan as ModScanEvent);
          return;
        }
        const event = task as unknown as DiagnosisEvent;
        if (event.autoDiagnosis) {
          useDiagnosis.getState().receive(event);
          return;
        }
        progress.push(task);
      }).then((f) => {
        if (live) {
          cleanup = f;
          const prepareMods = () =>
            void api("scan_installed_mod_updates", {
              curseforgeKey: useStore.getState().settings.curseforgeKey,
            }).catch(() => {});
          prepareMods();
          modScanTimer = setInterval(prepareMods, 30 * 60_000);
        } else f();
      });
    }
    const change = () => {
      const p = location.hash.slice(1) as Page;
      if (
        [...navigation.map((x) => x.id), "instance", "components"].includes(p)
      )
        useStore.setState({ page: p });
    };
    window.addEventListener("hashchange", change);
    return () => {
      live = false;
      progress.dispose();
      if (completionTimer) clearTimeout(completionTimer);
      if (modScanTimer) clearInterval(modScanTimer);
      cleanup?.();
      window.removeEventListener("hashchange", change);
    };
  }, []);
  useEffect(() => {
    document.documentElement.style.setProperty("--accent", s.settings.accent);
    const hex = s.settings.accent.replace("#", "");
    if (/^[0-9a-f]{6}$/i.test(hex)) {
      const values = [0, 2, 4]
        .map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
        .map((value) =>
          value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
        );
      const luminance =
        values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
      document.documentElement.style.setProperty(
        "--on-accent",
        luminance > 0.179 ? "#172a35" : "#ffffff",
      );
    }
  }, [s.settings.accent]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      const root = appRoot.current;
      if (root) root.dataset.appearanceChanging = "true";
      const theme =
        s.settings.theme === "system"
          ? media.matches
            ? "light"
            : "dark"
          : s.settings.theme;
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
      requestAnimationFrame(() => {
        if (root) delete root.dataset.appearanceChanging;
      });
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [s.settings.theme]);
  async function importPack() {
    const path = await pickFile([
      { name: "整合包", extensions: ["zip", "mrpack", "curseforge"] },
    ]);
    if (path) s.show("pack", path);
  }
  async function drop(f: File) {
    if (!/\.(zip|mrpack|curseforge)$/i.test(f.name))
      throw new Error("支持拖入 .zip / .mrpack / .curseforge 整合包");
    if (!desktop) throw new Error("网页预览无法安装整合包，请使用桌面版");
    if (f.size > 100 * 1024 * 1024)
      throw new Error("超过 100 MB 的包请使用「导入整合包」选择文件");
    const bytes = new Uint8Array(await f.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const path = await api<string>("stage_pack", {
      name: f.name,
      base64: btoa(binary),
    });
    s.show("pack", path);
  }
  const screen: Record<Page, ReactNode> = {
    home: <Home />,
    library: <Library />,
    instance: <InstanceDetail />,
    discover: <Discover />,
    news: <News />,
    account: <Accounts />,
    skin: <Skin />,
    diagnose: <Diagnose />,
    settings: <Settings />,
    help: <Help />,
    components: <Components />,
  };
  const custom = s.settings.wallpaper.startsWith("data:");
  const dynamicVideo = s.settings.wallpaper.startsWith("video:")
    ? s.settings.wallpaper.slice("video:".length)
    : "";
  // 直接写在根节点上，切换页面/重渲染时不会出现某一帧还没拿到变量的情况。
  const uiPercent = normalizeUiOpacity(s.settings.uiOpacity);
  const uiAlpha = `${uiPercent}%`;
  // 保持视频与静态壁纸的模糊层稳定，滑杆只更新面板色；0% 时完全透出壁纸。
  const uiBlur = uiPercent === 0 ? "0px" : "26px";
  return (
    <main
      ref={appRoot}
      className={`app page-${s.page} ${splash ? "splash-active" : ""} ${dynamicVideo ? "video-wallpaper" : ""}`}
      style={{ "--ui-alpha": uiAlpha, "--ui-blur": uiBlur } as CSSProperties}
      onDragOverCapture={(e) => {
        if (
          (e.target as HTMLElement).closest(
            ".skin-stage,.dropzone,.resource-dropzone",
          )
        ) {
          depth.current = 0;
          D(false);
        }
      }}
      onDropCapture={() => {
        depth.current = 0;
        D(false);
      }}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        depth.current++;
        D(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) D(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        D(false);
        const f = e.dataTransfer.files[0];
        if (f) void guarded(() => drop(f));
      }}
    >
      <div
        className={`wallpaper ${s.settings.wallpaper === "dusk" ? "dusk" : ""} ${s.settings.wallpaper === "plain" ? "plain" : ""}`}
        style={{
          backgroundImage: `url(${custom ? s.settings.wallpaper : wallpaper})`,
        }}
      />
      {dynamicVideo && desktop && (
        <video
          key={dynamicVideo}
          className="wallpaper-video"
          crossOrigin="anonymous"
          src={assetUrl(dynamicVideo)}
          autoPlay
          muted
          loop
          playsInline
        />
      )}
      <div className="scrim" />
      <header className="chrome">
        <div className="drag-region" data-tauri-drag-region />
        <div className="window-controls">
          <button
            className="window-refresh"
            title="重播启动动画"
            aria-label="重播启动动画"
            onClick={() => S(true)}
          >
            <RotateCw size={13} />
          </button>
          <span className="window-divider" aria-hidden="true" />
          <button
            className="window-min"
            title="最小化"
            aria-label="最小化"
            onClick={() => desktop && getCurrentWindow().minimize()}
          >
            <Minus size={14} />
          </button>
          <button
            className="window-close"
            title="关闭窗口"
            aria-label="关闭窗口"
            onClick={() => desktop && getCurrentWindow().close()}
          >
            <X size={15} />
          </button>
        </div>
      </header>
      <nav className="nav motion-selection" ref={navRoot}>
        <button
          className="brand"
          aria-label="KXL 首页"
          onClick={() => s.setPage("home")}
        >
          <div className="logo">
            <KxlMark />
          </div>
          <b>KXL</b>
        </button>
        {navigation.map((n) => (
          <button
            key={n.id}
            title={n.label}
            aria-label={n.label}
            className={
              (s.page === "instance" ? "library" : s.page) === n.id ? "on" : ""
            }
            onClick={() => s.setPage(n.id)}
          >
            {n.icon}
            {n.id !== "help" && <span>{n.label}</span>}
          </button>
        ))}
      </nav>
      <MotionPage id={s.page}>
        <Suspense fallback={<div className="empty">正在加载…</div>}>
          {screen[s.page]}
        </Suspense>
      </MotionPage>
      {tasksOpen && <DownloadTasks onClose={() => TasksOpen(false)} />}
      <footer className="taskbar">
        <span className="status-dot" />
        <span className="task-stage" key={s.task?.stage ?? "ready"}>
          {s.task?.stage ?? (desktop ? "KXL 已就绪" : "网页预览 · 示例实例")}
        </span>
        {s.task && (
          <>
            <ProgressBar done={s.task.done} total={s.task.total} />
            <code>{s.task.detail ?? `${s.task.done}/${s.task.total}`}</code>
            {s.task.done < s.task.total && !s.task.error && (
              <button
                onClick={() =>
                  guarded(() => api("cancel", { taskId: s.task?.taskId }))
                }
              >
                取消
              </button>
            )}
          </>
        )}
        <button onClick={() => TasksOpen(true)}>
          <Download size={13} />
          下载任务
          {Object.values(s.tasks).filter((t) => !t.finished).length
            ? ` (${Object.values(s.tasks).filter((t) => !t.finished).length})`
            : ""}
        </button>
        <span className="grow" />
        <button onClick={() => guarded(importPack)}>
          <PackagePlus size={13} />
          导入整合包
        </button>
        <button
          className="mono"
          title="查看本次更新日志"
          onClick={() =>
            window.dispatchEvent(new Event("kynex-open-changelog"))
          }
        >
          KXL {RELEASE.displayVersion}
        </button>
      </footer>
      {drag && (
        <div className="drop-overlay">
          <Upload size={40} />
          <h2>松开以安装整合包</h2>
          <p>.zip / .mrpack / .curseforge</p>
        </div>
      )}
      <Modals />
      <AutomaticDiagnosis />
      <Toast />
      <ReleaseNotices ready={ready && !splash} />
      {splash && <Splash ready={ready} finish={finish} />}
    </main>
  );
}
function Components() {
  const [on, S] = useState(true);
  const [tab, T] = useState("状态一");
  return (
    <>
      <h1>基础组件</h1>
      <Card>
        <div className="actions">
          <Button primary>主要按钮</Button>
          <Button>次要按钮</Button>
          <Button disabled>禁用状态</Button>
          <Button busy>加载中</Button>
          <Badge tone="ok">成功</Badge>
          <Badge tone="warn">警告</Badge>
          <Badge tone="bad">错误</Badge>
        </div>
        <Input placeholder="输入框与焦点态" />
        <Chip active onClick={() => {}}>
          选中标签
        </Chip>
        <Switch label="开关" on={on} change={S} />
        <Tabs items={["状态一", "状态二"]} value={tab} onChange={T} />
        <Skeleton />
      </Card>
    </>
  );
}
