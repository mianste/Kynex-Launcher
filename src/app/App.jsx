import { DownloadTasks } from "../features/download/DownloadTasks";
import { DownloadCompletions } from "../features/download/DownloadCompletions";
import { progressBuffer } from "../lib/progressBuffer";
import { useModUpdateState } from "../lib/modUpdateState";
import { RELEASE } from "../lib/release";
import {
  colorInk,
  normalizeHexColor,
  effectiveUiOpacity,
} from "../lib/appearance";
import {
  msUntilNextLocalMidnight,
  resolveActiveHoliday,
  shouldUseHolidayWallpaper,
} from "../lib/holidays";
import { holidayWallpaperUrl } from "../lib/holidayAssets";
import { LiquidGlass } from "../components/LiquidGlass";
import { HolidayAtmosphere } from "../components/HolidayAtmosphere";
import { HolidayIslandDecor } from "../components/HolidayIslandDecor";
import { Wallpaper } from "../components/Wallpaper";
import { resolveWallpaper } from "../lib/wallpaper";
import { useAdaptiveText } from "../lib/useAdaptiveText";
import { useMotionFeedback } from "../lib/motionFeedback";
import { ReleaseNotices } from "../features/updates/ReleaseNotices";
import { HotfixStartup } from "../features/updates/Hotfix";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  useRef,
} from "react";
import {
  Rocket,
  Boxes,
  Download,
  UsersRound,
  Shirt,
  Settings as SettingsIcon,
  HelpCircle,
  Minus,
  X,
  Upload,
  PackagePlus,
  Newspaper,
  Sparkles,
  Wrench,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useStore, guarded } from "../store";
import { api, assetUrl, desktop, onProgress, pickFile } from "../lib/bridge";
import { Home } from "../features/launch/Home";
import { warmInstanceResources } from "../features/library/resourcePreviews";
const Skin = lazy(() =>
  import("../features/skin/Skin").then((module) => ({ default: module.Skin })),
);
import { useDiagnosis, DiagnosisPopup } from "../features/diagnose/AiDiagnosis";
import { Assistant } from "../features/assistant/Assistant";
import {
  AgentPanel,
  useWorkshopEvents,
} from "../features/assistant/AgentPanel";
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
import brandIcon from "../assets/kxl-icon.png";
import { MotionPage } from "../components/ui/Motion";
import { useSelectionMotion } from "../lib/useSelectionMotion";
const Library = lazy(() =>
  import("../features/library/Library").then((module) => ({
    default: module.Library,
  })),
);
const InstanceDetail = lazy(() =>
  import("../features/library/Library").then((module) => ({
    default: module.InstanceDetail,
  })),
);
const Discover = lazy(() =>
  import("../features/download/Download").then((module) => ({
    default: module.Download,
  })),
);
const News = lazy(() =>
  import("../features/news/News").then((module) => ({ default: module.News })),
);
const Accounts = lazy(() =>
  import("../features/account/Accounts").then((module) => ({
    default: module.Accounts,
  })),
);
const Settings = lazy(() =>
  import("../features/settings/Settings").then((module) => ({
    default: module.Settings,
  })),
);
const Help = lazy(() =>
  import("../features/help/Help").then((module) => ({ default: module.Help })),
);
const navigation = [
  { id: "home", label: "启动", icon: <Rocket /> },
  { id: "library", label: "版本", icon: <Boxes /> },
  { id: "discover", label: "下载", icon: <Download /> },
  { id: "workshop", label: "工坊", icon: <Wrench /> },
  { id: "news", label: "MC 新闻", icon: <Newspaper /> },
  { id: "account", label: "账号", icon: <UsersRound /> },
  { id: "skin", label: "皮肤", icon: <Shirt /> },
  { id: "settings", label: "设置", icon: <SettingsIcon /> },
  { id: "help", label: "帮助", icon: <HelpCircle /> },
];
export function App() {
  const s = useStore();
  useWorkshopEvents();
  const [ready, R] = useState(false);
  useEffect(() => {
    if (!ready || !desktop || !["library", "instance"].includes(s.page)) return;
    const id = s.selected || s.instances[0]?.id;
    if (!id) return;
    const timer = window.setTimeout(
      () => warmInstanceResources(id, s.directoryId, s.settings.curseforgeKey),
      150,
    );
    return () => window.clearTimeout(timer);
  }, [
    ready,
    s.page,
    s.selected,
    s.instances[0]?.id,
    s.directoryId,
    s.settings.curseforgeKey,
  ]);
  const [splash, S] = useState(
    !new URLSearchParams(location.search).has("nosplash"),
  );
  useEffect(() => {
    if (s.page === "diagnose") {
      s.setPage("home");
      window.dispatchEvent(new Event("kynex-open-assistant"));
    }
  }, [s.page]);
  const [drag, D] = useState(false);
  const [tasksOpen, TasksOpen] = useState(false);
  const depth = useRef(0);
  const appRoot = useRef(null);
  const [displayedWallpaper, setDisplayedWallpaper] = useState(null);
  useMotionFeedback(appRoot);
  const [todayTick, setTodayTick] = useState(() => Date.now());
  useEffect(() => {
    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setTodayTick(Date.now());
        arm();
      }, msUntilNextLocalMidnight());
    };
    const onVisible = () => {
      if (!document.hidden) setTodayTick(Date.now());
    };
    arm();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  const activeHoliday = resolveActiveHoliday(s.settings, new Date(todayTick));
  const activeHolidayId = activeHoliday?.holiday.id ?? "";
  const holidayAccentLight = activeHoliday?.holiday.accent.light ?? "";
  const holidayAccentDark = activeHoliday?.holiday.accent.dark ?? "";
  const effectsOn = s.settings.holidayEffects !== false;
  const holidayEffectsOn = !!activeHoliday && effectsOn;
  const useHolidayArt = shouldUseHolidayWallpaper(
    s.settings.wallpaper,
    s.settings,
    activeHoliday,
  );
  const holidayArtUrl = useHolidayArt
    ? holidayWallpaperUrl(activeHolidayId)
    : null;
  const customSurface =
    !activeHoliday && s.settings.theme === "custom"
      ? (normalizeHexColor(s.settings.customThemeColor) ?? "#f7fafc")
      : undefined;
  const everydayAccent = normalizeHexColor(s.settings.accent) ?? "#3d7c88";
  useLayoutEffect(() => {
    const media = matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      const app = appRoot.current;
      if (app) app.dataset.appearanceChanging = "true";
      const root = document.documentElement;
      const customInk = customSurface ? colorInk(customSurface) : undefined;
      const theme = customInk
        ? customInk === "#000000"
          ? "light"
          : "dark"
        : s.settings.theme === "system"
          ? media.matches
            ? "light"
            : "dark"
          : s.settings.theme === "custom"
            ? colorInk(
                normalizeHexColor(s.settings.customThemeColor) ?? "#f7fafc",
              ) === "#000000"
              ? "light"
              : "dark"
            : s.settings.theme === "liquid"
              ? "dark"
              : s.settings.theme;
      const accent = activeHolidayId
        ? (theme === "light"
            ? holidayAccentLight || holidayAccentDark
            : holidayAccentDark || holidayAccentLight) || everydayAccent
        : everydayAccent;
      root.dataset.theme = theme;
      root.dataset.material =
        s.settings.theme === "liquid" ? "liquid" : "standard";
      root.style.colorScheme = theme;
      if (activeHolidayId) {
        root.dataset.holiday = activeHolidayId;
        root.dataset.holidayEffects = holidayEffectsOn ? "true" : "false";
      } else {
        delete root.dataset.holiday;
        delete root.dataset.holidayEffects;
      }
      root.style.setProperty("--accent", accent);
      root.style.setProperty("--on-accent", colorInk(accent));
      root.toggleAttribute("data-custom-theme", !!customSurface);
      if (customSurface && customInk) {
        root.style.setProperty("--custom-surface", customSurface);
        root.style.setProperty("--custom-ink", customInk);
      } else {
        root.style.removeProperty("--custom-surface");
        root.style.removeProperty("--custom-ink");
      }
      // Commit theme colours while transitions are disabled, before restoring them.
      if (app) getComputedStyle(app).backgroundColor;
      requestAnimationFrame(() => {
        if (app) delete app.dataset.appearanceChanging;
      });
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [
    activeHolidayId,
    holidayAccentLight,
    holidayAccentDark,
    holidayEffectsOn,
    customSurface,
    everydayAccent,
    s.settings.theme,
    s.settings.customThemeColor,
  ]);
  useAdaptiveText(
    appRoot,
    displayedWallpaper?.key || holidayArtUrl || s.settings.wallpaper,
    effectiveUiOpacity(s.settings),
    s.page,
    activeHolidayId
      ? `holiday:${activeHolidayId}:${s.settings.theme}`
      : (customSurface ?? s.settings.theme),
  );
  const navRoot = useRef(null);
  const navigationToggle = useRef(null);
  const [navPinned, setNavPinned] = useState(true);
  const [navHover, setNavHover] = useState(false);
  const navOpen = navHover ? !navPinned : navPinned;
  useSelectionMotion(navRoot);
  useLayoutEffect(() => {
    if (navRoot.current) navRoot.current.inert = !navOpen;
  }, [navOpen]);
  function openPage(page) {
    s.setPage(page);
  }
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
    let stop;
    void import("@tauri-apps/api/webview").then(
      async ({ getCurrentWebview }) => {
        const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
          const payload = event.payload;
          if (
            payload.type === "drop" &&
            !window.dispatchEvent(
              new CustomEvent("kynex-assistant-native-drop", {
                detail: payload,
                cancelable: true,
              }),
            )
          ) {
            D(false);
            return;
          }
          const page = useStore.getState().page;
          const delegated =
            ["instance", "skin", "diagnose"].includes(page) ||
            !!document.querySelector(".assistant-body .diagnose-layout");
          const directPack =
            payload.type === "drop" &&
            /\.(mrpack|curseforge)$/i.test(payload.paths[0]);
          window.dispatchEvent(
            new CustomEvent("kynex-native-drag", {
              detail: directPack ? { type: "leave" } : payload,
            }),
          );
          if (payload.type === "leave" || payload.type === "drop") D(false);
          else if (!delegated) D(true);
          if (payload.type === "drop" && (!delegated || directPack)) {
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
    let cleanup;
    let modScanTimer;
    let modStartupTimer;
    let live = true;
    const progress = progressBuffer((events) => {
      if (!live) return;
      const tasks = { ...useStore.getState().tasks };
      const completed = [];
      for (const task of events) {
        const id = task.taskId;
        if (!id) continue;
        if (
          task.finished &&
          !task.error &&
          task.completion &&
          !tasks[id]?.finished
        ) {
          completed.push({
            id,
            name: task.name ?? tasks[id]?.name,
            ...task.completion,
          });
        }
        tasks[id] = { ...tasks[id], ...task };
        if (task.error) s.notify(task.error);
      }
      if (completed.length) s.addCompletions(completed);
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
          useModUpdateState.getState().receive(task.modUpdateScan);
          return;
        }
        const event = task;
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
          modStartupTimer = setTimeout(prepareMods, 10000);
          modScanTimer = setInterval(prepareMods, 30 * 60_000);
        } else f();
      });
    }
    const change = () => {
      const p = location.hash.slice(1);
      if (
        [...navigation.map((x) => x.id), "instance", "components"].includes(p)
      )
        useStore.setState({ page: p });
    };
    window.addEventListener("hashchange", change);
    return () => {
      live = false;
      progress.dispose();
      if (modScanTimer) clearInterval(modScanTimer);
      if (modStartupTimer) clearTimeout(modStartupTimer);
      cleanup?.();
      window.removeEventListener("hashchange", change);
    };
  }, []);
  async function importPack() {
    const path = await pickFile([
      { name: "整合包", extensions: ["zip", "mrpack", "curseforge"] },
    ]);
    if (path) s.show("pack", path);
  }
  async function drop(f) {
    if (!/\.(zip|mrpack|curseforge)$/i.test(f.name))
      throw new Error("支持拖入 .zip / .mrpack / .curseforge 整合包");
    if (!desktop) throw new Error("网页预览无法安装整合包，请使用桌面版");
    const upload = await api("prepare_pack_upload", {
      name: f.name,
      size: f.size,
    });
    const response = await fetch(upload.url, {
      method: "POST",
      body: f,
      headers: { "Content-Type": "application/octet-stream" },
    });
    if (!response.ok)
      throw new Error("无法保存拖入的整合包，请检查磁盘空间后重试。");
    s.show("pack", upload.path);
  }
  const openDownloads = () => TasksOpen(true);
  const screen = {
    home: <Home />,
    library: <Library />,
    instance: <InstanceDetail />,
    discover: <Discover />,
    workshop: <AgentPanel />,
    news: <News />,
    account: <Accounts />,
    skin: <Skin />,
    diagnose: <Home />,
    settings: <Settings />,
    help: <Help />,
    components: <Components />,
  };
  const requestedWallpaper = resolveWallpaper(s.settings, activeHoliday);
  const background =
    requestedWallpaper.kind === "video"
      ? desktop
        ? { ...requestedWallpaper, src: assetUrl(requestedWallpaper.src) }
        : { key: "preview-video", kind: "plain", src: "" }
      : requestedWallpaper;
  // 直接写在根节点上，切换页面/重渲染时不会出现某一帧还没拿到变量的情况。
  const uiPercent = effectiveUiOpacity(s.settings);
  const uiAlpha = `${uiPercent}%`;
  // 保持视频与静态壁纸的模糊层稳定，滑杆只更新面板色；0% 时完全透出壁纸。
  const uiBlur = uiPercent === 0 ? "0px" : "26px";
  return (
    <main
      ref={appRoot}
      className={`app page-${s.page} ${splash ? "splash-active" : ""} ${displayedWallpaper?.kind === "video" ? "video-wallpaper" : ""}`}
      data-native-window={desktop ? "" : undefined}
      data-default-wallpaper={
        (displayedWallpaper?.default ??
        (!holidayArtUrl && s.settings.wallpaper === "island"))
          ? ""
          : undefined
      }
      style={{ "--ui-alpha": uiAlpha, "--ui-blur": uiBlur }}
      onDragOverCapture={(e) => {
        if (e.target.closest(".skin-stage,.dropzone,.resource-dropzone")) {
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
      <Wallpaper
        value={background}
        effects={holidayEffectsOn}
        isHome={s.page === "home"}
        appRoot={appRoot}
        onActiveChange={setDisplayedWallpaper}
        onError={s.notify}
      />
      <div className="scrim" />
      <HolidayAtmosphere
        holidayId={activeHolidayId}
        accent={everydayAccent}
        enabled={effectsOn}
        appRoot={appRoot}
        page={s.page}
      />
      <header className="chrome">
        <div className="drag-region" data-tauri-drag-region />
        <div className="window-controls">
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
      <div
        className="top-navigation"
        data-open={navOpen}
        data-hover-preview={!navPinned && navHover}
        onPointerLeave={() => setNavHover(false)}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !navPinned) return;
          event.stopPropagation();
          setNavPinned(false);
          setNavHover(false);
          navigationToggle.current?.focus({ preventScroll: true });
        }}
      >
        <button
          ref={navigationToggle}
          className="navigation-notch"
          data-guide="navigation-toggle"
          aria-label={navPinned ? "收起导航" : "打开导航"}
          aria-expanded={navOpen}
          aria-controls="launcher-navigation"
          onPointerEnter={(event) => {
            if (event.pointerType !== "touch") setNavHover(true);
          }}
          onPointerLeave={() => {
            if (navPinned) setNavHover(false);
          }}
          onPointerCancel={() => setNavHover(false)}
          onClick={() => {
            setNavHover(false);
            setNavPinned((open) => !open);
          }}
        >
          <span aria-hidden="true" />
        </button>
        <nav
          id="launcher-navigation"
          className="nav motion-selection"
          aria-label="主导航"
          aria-hidden={!navOpen}
          ref={navRoot}
        >
          <span className="liquid-selection" aria-hidden="true">
            <i />
            <i />
          </span>
          <HolidayIslandDecor
            holidayId={activeHolidayId}
            effectsOn={holidayEffectsOn}
          />
          <button
            className="brand"
            aria-label="KXL 首页"
            onClick={() => openPage("home")}
          >
            <div className="logo">
              <KxlMark />
            </div>
            <b>KXL</b>
          </button>
          {navigation.map((n) => {
            const current =
              (s.page === "instance" ? "library" : s.page) === n.id;
            return (
              <button
                key={n.id}
                title={n.label}
                data-guide={n.id}
                aria-label={n.id === "workshop" ? "AI 整合包工坊" : n.label}
                aria-current={current ? "page" : undefined}
                className={current ? "on" : ""}
                onClick={() => openPage(n.id)}
              >
                {n.icon}
                {n.id !== "help" && <span>{n.label}</span>}
              </button>
            );
          })}
        </nav>
      </div>
      <MotionPage id={s.page}>
        <Suspense
          fallback={
            <div
              className="page-load-skeleton"
              role="status"
              aria-label="正在加载页面"
            >
              <Skeleton />
              <Skeleton />
              <Skeleton />
            </div>
          }
        >
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
        <button onClick={openDownloads}>
          <Download size={13} />
          下载任务
          {Object.values(s.tasks).filter((t) => !t.finished).length
            ? ` (${Object.values(s.tasks).filter((t) => !t.finished).length})`
            : ""}
        </button>
        <span className="grow" />
        {activeHoliday && (
          <button
            className="holiday-pill"
            title="节日主题设置"
            onClick={() => {
              s.setPage("settings");
              window.setTimeout(
                () =>
                  window.dispatchEvent(
                    new Event("kynex-open-holiday-settings"),
                  ),
                30,
              );
            }}
          >
            <Sparkles size={12} />
            {activeHoliday.holiday.name}主题
          </button>
        )}
        {s.page !== "home" && (
          <button onClick={() => guarded(importPack)}>
            <PackagePlus size={13} />
            导入整合包
          </button>
        )}
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
      <DiagnosisPopup />
      {s.settings.theme === "liquid" && (
        <LiquidGlass ready={ready && !splash} />
      )}
      <Assistant ready={ready && !splash} />
      <Toast />
      <DownloadCompletions
        items={s.completions}
        dismiss={s.dismissCompletion}
      />
      <ReleaseNotices ready={ready && !splash} />
      <HotfixStartup ready={ready && !splash} />
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
