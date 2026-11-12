import { ColorPalette } from "./ColorPalette";
import { SettingsAction } from "./SettingsAction";
import { RELEASE } from "../../lib/release";
import { normalizeUiOpacity } from "../../lib/appearance";
import { useEffect, useRef, useState } from "react";
import {
  Coffee,
  Download,
  FolderOpen,
  Info,
  Monitor,
  Moon,
  Palette,
  Rocket,
  RotateCcw,
  Settings2,
  SlidersHorizontal,
  Sun,
  Upload,
} from "lucide-react";
import {
  Button,
  Card,
  Field,
  Input,
  MemorySlider,
  OptionSelect,
  Row,
  SearchInput,
  Badge,
  Switch,
} from "../../components/ui";
import { useStore, guarded, initialSettings } from "../../store";
import { useSelectionMotion } from "../../lib/useSelectionMotion";
import {
  api,
  assetUrl,
  desktop,
  external,
  pickFile,
  pickImageFile,
  pickVideoFile,
} from "../../lib/bridge";
import { DeepSeekSettings } from "../diagnose/AiDiagnosis";
import { consumeAiSettings } from "../../lib/settingsNavigation";
import { useGuideSection } from "../../lib/guideNavigation";

type WeWallpaper = {
  id: string;
  title: string;
  kind: string;
  preview?: string | null;
  video?: string | null;
  dir: string;
};
type WeScan = {
  installed: boolean;
  workshopFound: boolean;
  hidden?: number;
  wallpapers: WeWallpaper[];
};
export function Settings() {
  const s = useStore();
  const [category, C] = useState(() => (consumeAiSettings() ? "高级" : "启动"));
  const [q, Q] = useState("");
  useGuideSection("settings", (section) => {
    C(section);
    Q("");
  });
  const content = useRef<HTMLDivElement>(null);
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const focusModel = () =>
      requestAnimationFrame(() => {
        document
          .querySelector(".model-settings")
          ?.scrollIntoView({ block: "start" });
      });
    const openModel = () => {
      if (consumeAiSettings()) {
        Q("");
        C("高级");
        focusModel();
      }
    };
    if (category === "高级") focusModel();
    window.addEventListener("kynex-open-ai-settings", openModel);
    return () =>
      window.removeEventListener("kynex-open-ai-settings", openModel);
  }, []);
  useSelectionMotion(nav);
  useEffect(() => {
    content.current?.scrollTo({ top: 0 });
    if (category !== "启动" || q) return;
    const page = content.current?.closest<HTMLElement>(".page-content");
    page?.scrollTo({ top: 0 });
    const fixedWheel = (event: WheelEvent) => {
      if ((event.target as Element).closest('[role="listbox"],.choice-popover')) return;
      event.preventDefault();
    };
    page?.addEventListener("wheel", fixedWheel, { passive: false });
    return () => page?.removeEventListener("wheel", fixedWheel);
  }, [category, q]);
  const [java, J] = useState<
    { path: string; major: number; version: string }[]
  >([]);
  const [scanning, Sc] = useState(false);
  const [mirrorResults, MirrorResults] = useState<
    { source: string; ok: boolean; latency: number | null }[]
  >([]);
  const [testingMirror, TestingMirror] = useState(false);
  const [fillingJava, FillingJava] = useState(false);
  const categories = [
    "启动",
    "Java 管理",
    "下载",
    "界面",
    "更新",
    "高级",
    "关于",
  ];
  const categoryIcons = {
    启动: Rocket,
    "Java 管理": Coffee,
    下载: Download,
    界面: Palette,
    高级: SlidersHorizontal,
    关于: Info,
    更新: Download,
  } as const;
  const show = (name: string) => (!q ? category === name : true);
  const update = s.updateSettings;
  const opacityFrame = useRef(0);
  const opacityPending = useRef<number | null>(null);
  const opacityLabel = useRef<HTMLElement>(null);
  const opacityInput = useRef<HTMLInputElement>(null);
  // 非受控滑杆：拖动由浏览器原生更新，松手后才写回设置。
  useEffect(() => {
    const element = opacityInput.current;
    const value = normalizeUiOpacity(s.settings.uiOpacity);
    if (element && Number(element.value) !== value) {
      element.value = String(value);
    }
  }, [s.settings.uiOpacity]);
  // 拖动时直接改 CSS 变量（每帧最多一次），松手才写 store，避免整页重渲染导致掉帧。
  function previewOpacity(value: number) {
    opacityPending.current = value;
    if (opacityFrame.current) return;
    opacityFrame.current = requestAnimationFrame(() => {
      opacityFrame.current = 0;
      const next = opacityPending.current;
      if (next == null) return;
      const app = document.querySelector<HTMLElement>(".app");
      if (app) app.dataset.appearanceChanging = "true";
      app?.style.setProperty("--ui-alpha", `${next}%`);
      app?.style.setProperty("--ui-blur", next === 0 ? "0px" : "26px");
      app?.dispatchEvent(new Event("kynex-appearance-preview"));
      if (opacityLabel.current) opacityLabel.current.textContent = `${next}%`;
    });
  }
  function commitOpacity(value: number) {
    if (opacityFrame.current) {
      cancelAnimationFrame(opacityFrame.current);
      opacityFrame.current = 0;
    }
    opacityPending.current = null;
    const app = document.querySelector<HTMLElement>(".app");
    app?.style.setProperty("--ui-alpha", `${value}%`);
    app?.style.setProperty("--ui-blur", value === 0 ? "0px" : "26px");
    app?.dispatchEvent(new Event("kynex-appearance-preview"));
    update({ uiOpacity: value });
    requestAnimationFrame(() => {
      if (app) delete app.dataset.appearanceChanging;
    });
  }
  const [we, setWe] = useState<WeScan | null>(null);
  const [weBusy, setWeBusy] = useState(false);
  const dynamicWallpaper = s.settings.wallpaper.startsWith("video:");
  async function scanWallpaperEngine() {
    setWeBusy(true);
    try {
      setWe(await api<WeScan>("wallpaper_engine_scan"));
    } finally {
      setWeBusy(false);
    }
  }
  async function applyWallpaper(f: File) {
    if (f.size > 5 * 1024 * 1024) throw new Error("壁纸请使用 5 MB 以内的图片");
    const url = URL.createObjectURL(f);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(1920, img.width);
      canvas.height = Math.round((img.height * canvas.width) / img.width);
      canvas
        .getContext("2d")!
        .drawImage(img, 0, 0, canvas.width, canvas.height);
      update({ wallpaper: canvas.toDataURL("image/jpeg", 0.82) });
      s.setPage("home");
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return (
    <section
      className="settings-page"
      data-category={q ? "search" : category}
      aria-label="设置"
    >
      <div className="settings-layout">
        <aside className="settings-sidebar" aria-label="设置分类">
          <SearchInput value={q} onChange={Q} placeholder="搜索设置" />
          <nav className="settings-nav motion-selection-vertical" ref={nav}>
            {categories.map((c) => {
              const Icon = categoryIcons[c as keyof typeof categoryIcons];
              return (
                <button
                  key={c}
                  data-guide={`settings-${c}`}
                  className={category === c ? "on" : ""}
                  aria-current={category === c ? "page" : undefined}
                  onClick={() => {
                    C(c);
                    Q("");
                  }}
                >
                  <Icon size={16} />
                  <span>{c}</span>
                </button>
              );
            })}
          </nav>
        </aside>
        <div
          className="settings-content"
          ref={content}
          tabIndex={0}
          aria-label="设置内容"
        >
          {show("启动") &&
            (!q || "启动 内存 窗口 Java JVM 隔离 语言".includes(q)) && (
              <Card>
                <div className="settings-card-head">
                  <span className="settings-card-icon">
                    <Settings2 size={17} />
                  </span>
                  <div>
                    <h3>启动与性能</h3>
                    <p>调整游戏内存、Java 与实例隔离方式。</p>
                  </div>
                </div>
                <Row
                  title="内存分配"
                  hint="全局默认值；实例设置优先。拖动滑块选择，单位 MB。"
                >
                  <MemorySlider
                    label="全局内存"
                    value={s.settings.memory}
                    onChange={(memory) => update({ memory })}
                  />
                </Row>
                <Row
                  title="默认 Java 路径"
                  hint="留空时扫描本机并匹配版本清单要求。"
                >
                  <div className="setting-control">
                    <Input
                      aria-label="Java 路径"
                      placeholder="自动匹配"
                      value={s.settings.java}
                      onChange={(e) => update({ java: e.target.value })}
                    />
                    <Button
                      onClick={() =>
                        guarded(async () => {
                          const path = await pickFile([
                            { name: "Java", extensions: ["exe"] },
                          ]);
                          if (path) update({ java: path });
                        })
                      }
                    >
                      <FolderOpen size={14} />
                      浏览
                    </Button>
                  </div>
                </Row>
                <Row
                  title="游戏窗口大小"
                  hint="仅影响游戏窗口，启动器窗口保持固定尺寸。"
                >
                  <div className="window-size-control">
                    <div className="window-presets">
                      {[
                        [1280, 720],
                        [1600, 900],
                        [1920, 1080],
                      ].map(([w, h]) => (
                        <button
                          key={`${w}x${h}`}
                          className={
                            s.settings.width === w && s.settings.height === h
                              ? "on"
                              : ""
                          }
                          onClick={() => update({ width: w, height: h })}
                        >
                          {w}×{h}
                        </button>
                      ))}
                    </div>
                    <div className="window-size-inputs">
                      <Input
                        aria-label="窗口宽度"
                        type="number"
                        min={640}
                        value={s.settings.width}
                        onChange={(e) =>
                          update({ width: Number(e.target.value) })
                        }
                      />
                      <span>×</span>
                      <Input
                        aria-label="窗口高度"
                        type="number"
                        min={360}
                        value={s.settings.height}
                        onChange={(e) =>
                          update({ height: Number(e.target.value) })
                        }
                      />
                    </div>
                  </div>
                </Row>
                <Row title="版本隔离">
                  <OptionSelect
                    label="全局版本隔离"
                    className="drop-up"
                    value={s.settings.isolation}
                    onChange={(value) =>
                      update({
                        isolation: value as "all" | "modded" | "shared",
                      })
                    }
                    options={[
                      { value: "all", label: "全部独立" },
                      { value: "modded", label: "仅模组实例独立" },
                      { value: "shared", label: "共享游戏目录" },
                    ]}
                  />
                </Row>
                <Row
                  title="游戏语言"
                  hint="启动前写入实例的 options.txt；1.10 及以前自动改用大写后缀。"
                >
                  <OptionSelect
                    label="启动时游戏语言"
                    className="drop-up"
                    value={s.settings.gameLanguage}
                    onChange={(value) =>
                      update({
                        gameLanguage: value as "zh_cn" | "en_us" | "none",
                      })
                    }
                    options={[
                      { value: "zh_cn", label: "简体中文" },
                      { value: "en_us", label: "English" },
                      { value: "none", label: "不修改" },
                    ]}
                  />
                </Row>
              </Card>
            )}
          {show("Java 管理") && (!q || "Java 管理".includes(q)) && (
            <Card>
              <div className="spread">
                <h3>本机 Java 运行时</h3>
                <Button
                  busy={scanning}
                  onClick={() =>
                    guarded(async () => {
                      Sc(true);
                      try {
                        J(await api("java"));
                      } finally {
                        Sc(false);
                      }
                    })
                  }
                >
                  扫描 Java
                </Button>
              </div>
              {java.map((j) => (
                <div className="java-row" key={j.path}>
                  <Badge>Java {j.major}</Badge>
                  <code>{j.path}</code>
                  <Button onClick={() => update({ java: j.path })}>
                    设为默认
                  </Button>
                </div>
              ))}
              {!java.length && <p>扫描 PATH、JAVA_HOME 与常见安装目录。</p>}
              <Button
                onClick={() =>
                  guarded(() =>
                    external("https://adoptium.net/temurin/releases/"),
                  )
                }
              >
                下载 Java
              </Button>
              <Button
                busy={fillingJava}
                onClick={() =>
                  guarded(async () => {
                    FillingJava(true);
                    try {
                      for (const major of [8, 17, 21, 25]) {
                        await api("install_java", { major });
                      }
                      s.notify("Java 8 / 17 / 21 / 25 已补齐");
                    } finally {
                      FillingJava(false);
                    }
                  })
                }
              >
                自动补齐 Java 8 / 17 / 21 / 25
              </Button>
              <p>
                启动游戏时如果缺少对应 Java，会自动下载并继续，无需手动找路径。
              </p>
            </Card>
          )}
          {show("下载") && (!q || "下载 来源 并发".includes(q)) && (
            <Card>
              <h3>下载</h3>
              <Row title="游戏文件来源" hint="镜像下载失败时会改用官方地址。">
                <OptionSelect
                  label="下载镜像来源"
                  value={s.settings.downloadSource}
                  onChange={(value) =>
                    update({
                      downloadSource: value as "bmclapi" | "official",
                    })
                  }
                  options={[
                    {
                      value: "bmclapi",
                      label: "国内镜像优先 · BMCLAPI",
                      hint: "失败时自动回退 Mojang 官方源",
                    },
                    {
                      value: "official",
                      label: "仅官方源",
                      hint: "直连 Mojang，不经过镜像",
                    },
                  ]}
                />
                <Button
                  busy={testingMirror}
                  onClick={() =>
                    guarded(async () => {
                      TestingMirror(true);
                      try {
                        MirrorResults(await api("mirror_benchmark"));
                      } finally {
                        TestingMirror(false);
                      }
                    })
                  }
                >
                  连接测速
                </Button>
              </Row>
              {mirrorResults.map((r) => (
                <div className="kv" key={r.source}>
                  <span>
                    {r.source === "bmclapi"
                      ? "BMCLAPI 国内镜像"
                      : "Mojang 官方源"}
                  </span>
                  <Badge tone={r.ok ? "ok" : "warn"}>
                    {r.ok ? `${r.latency} ms` : "暂时不可用"}
                  </Badge>
                </div>
              ))}
              <p>
                镜像服务由 BMCLAPI / bangbang93
                提供。模组搜索、微软授权和无法映射的文件仍使用各自官方服务。
              </p>
              <Row
                title="下载并发"
                hint="1–16 个文件同时下载；中断后保留 .part，下次从断点继续。"
              >
                <div className="setting-control">
                  <Input
                    aria-label="下载并发"
                    type="number"
                    min={1}
                    max={16}
                    value={s.settings.threads}
                    onChange={(e) =>
                      update({
                        threads: Math.min(
                          16,
                          Math.max(1, Number(e.target.value) || 1),
                        ),
                      })
                    }
                  />
                  <Badge>{s.settings.threads} 个文件</Badge>
                </div>
              </Row>
              <p>
                连接测速显示当前网络的响应延迟；下载中断后会自动续传，并发数可在上方调整。
              </p>
            </Card>
          )}
          {show("界面") && (!q || "界面 主题 颜色 壁纸".includes(q)) && (
            <Card>
              <h3>外观</h3>
              <Row title="界面主题" hint="选择浅色、深色、跟随系统，或自己调色。">
                <div className="theme-choices">
                  {(
                    [
                      { value: "light", label: "浅色", icon: Sun },
                      { value: "dark", label: "深色", icon: Moon },
                      { value: "system", label: "跟随系统", icon: Monitor },
                      { value: "custom", label: "自定义", icon: Palette },
                    ] as const
                  ).map(({ value, label, icon: Icon }) => (
                    <button
                      key={value}
                      className={s.settings.theme === value ? "on" : ""}
                      aria-pressed={s.settings.theme === value}
                      onClick={() => update({ theme: value })}
                    >
                      <Icon size={14} />
                      {label}
                    </button>
                  ))}
                </div>
              </Row>
              {s.settings.theme === "custom" && (
                <Row title="主题底色">
                  <ColorPalette label="主题底色" value={s.settings.customThemeColor} onChange={(customThemeColor) => update({ customThemeColor })} />
                </Row>
              )}
              <Row title="强调色" hint="选择按钮和选中项的颜色。">
                <div className="color-dots">
                  {["#6F9F94", "#7895A4", "#72A788", "#C59862", "#B87373"].map(
                    (color) => (
                      <button
                        aria-label={`强调色 ${color}`}
                        key={color}
                        className={s.settings.accent.toLowerCase() === color.toLowerCase() ? "on" : ""}
                        style={{ background: color }}
                        onClick={() => update({ accent: color })}
                      />
                    ),
                  )}
                </div>
              </Row>
              <Row title="自定义强调色">
                <ColorPalette label="强调色" value={s.settings.accent} onChange={(accent) => update({ accent })} />
              </Row>
              <h4>主页壁纸</h4>
              <div className="wall-picker">
                <label
                  className="wall-upload"
                  onClick={(e) => {
                    if (desktop) {
                      e.preventDefault();
                      void guarded(async () => {
                        const f = await pickImageFile("wallpaper");
                        if (f) await applyWallpaper(f);
                      });
                    }
                  }}
                >
                  <Upload size={20} />
                  <span>
                    <b>上传自定义壁纸</b>
                    <small>PNG、JPG 或 WebP，最大 5 MB</small>
                  </span>
                  <input
                    className="wall-upload-input"
                    aria-label="上传自定义壁纸"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      void guarded(() => applyWallpaper(f));
                    }}
                  />
                </label>
              </div>
              <Row title="界面不透明度" hint="0% 全透明，100% 不透明。">
                <input
                  ref={opacityInput}
                  className="opacity-range"
                  aria-label="界面不透明度"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  defaultValue={normalizeUiOpacity(s.settings.uiOpacity)}
                  onInput={(e) => previewOpacity(Number(e.currentTarget.value))}
                  onPointerUp={(e) =>
                    commitOpacity(Number(e.currentTarget.value))
                  }
                  onPointerCancel={(e) =>
                    commitOpacity(Number(e.currentTarget.value))
                  }
                  onKeyUp={(e) => commitOpacity(Number(e.currentTarget.value))}
                  onBlur={(e) => commitOpacity(Number(e.currentTarget.value))}
                />
                <b ref={opacityLabel}>
                  {normalizeUiOpacity(s.settings.uiOpacity)}%
                </b>
              </Row>
              <h4>动态壁纸</h4>
              <Row
                title="Wallpaper Engine"
                hint="读取 Steam 创意工坊 431960 中已订阅的壁纸；只列出可以直接播放的视频壁纸，场景（.pkg）和 Web 壁纸无法在启动器内渲染，会自动隐藏。"
              >
                <Button
                  busy={weBusy}
                  onClick={() => void guarded(scanWallpaperEngine)}
                >
                  扫描 Wallpaper Engine
                </Button>
                <Button
                  onClick={() =>
                    void guarded(async () => {
                      const path = await pickVideoFile();
                      if (path) update({ wallpaper: "video:" + path });
                    })
                  }
                >
                  选择本地视频
                </Button>
                {dynamicWallpaper && (
                  <Button onClick={() => update({ wallpaper: "island" })}>
                    关闭动态壁纸
                  </Button>
                )}
              </Row>
              {we && !we.workshopFound && (
                <p className="hint">
                  没有找到 Wallpaper Engine 创意工坊目录：请先通过 Steam 安装
                  Wallpaper Engine，并订阅至少一个动态壁纸。
                </p>
              )}
              {we && we.workshopFound && we.wallpapers.length === 0 && (
                <p className="hint">
                  没有可以直接播放的视频壁纸
                  {we.hidden
                    ? `（已隐藏 ${we.hidden} 个场景/Web 或缺少视频文件的项目）`
                    : ""}
                  ，请订阅视频类型的动态壁纸。
                </p>
              )}
              {we && we.wallpapers.length > 0 && we.hidden ? (
                <p className="hint">
                  已隐藏 {we.hidden} 个场景/Web
                  或无法播放的项目，只显示可直接播放的视频壁纸。
                </p>
              ) : null}
              {we && we.wallpapers.length > 0 && (
                <div className="we-grid">
                  {we.wallpapers.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`we-card ${
                        item.video &&
                        s.settings.wallpaper === "video:" + item.video
                          ? "on"
                          : ""
                      }`}
                      title={`应用 ${item.title}（动态视频）`}
                      onClick={() => {
                        if (item.video)
                          update({ wallpaper: "video:" + item.video });
                      }}
                    >
                      <span className="we-preview">
                        {item.preview ? (
                          <img
                            src={assetUrl(item.preview)}
                            alt=""
                            loading="lazy"
                          />
                        ) : (
                          <span>WE</span>
                        )}
                      </span>
                      <span className="we-title">{item.title}</span>
                      <Badge>视频</Badge>
                    </button>
                  ))}
                </div>
              )}
            </Card>
          )}
          {show("更新") &&
            (!q || "更新 自动 手动 检测 新版 启动器".includes(q)) && (
              <Card>
                <h3>启动器更新</h3>
                <Row
                  title="启动时检测新版"
                  hint="同一个新版只自动提醒一次，主动检测仍可再次打开更新窗口。"
                >
                  <Switch
                    label="启动时检测新版"
                    on={s.settings.checkUpdatesOnStartup !== false}
                    change={(value) => update({ checkUpdatesOnStartup: value })}
                  />
                </Row>
                <Row
                  title="更新方式"
                  hint="自动下载安装会在检测到新版后下载、校验并运行更新安装程序。"
                >
                  <OptionSelect
                    label="启动器更新方式"
                    value={s.settings.updateMode || "manual"}
                    onChange={(value) =>
                      update({ updateMode: value as "manual" | "automatic" })
                    }
                    options={[
                      { value: "manual", label: "手动安装更新" },
                      { value: "automatic", label: "自动下载安装" },
                    ]}
                  />
                </Row>
                <Row title="当前版本" hint={RELEASE.label}>
                  <Badge>{RELEASE.displayVersion}</Badge>
                  <Button
                    onClick={() =>
                      window.dispatchEvent(new Event("kynex-check-update"))
                    }
                  >
                    检测新版
                  </Button>
                  <Button
                    onClick={() =>
                      window.dispatchEvent(new Event("kynex-open-changelog"))
                    }
                  >
                    查看更新日志
                  </Button>
                </Row>
              </Card>
            )}
          {show("高级") &&
            (!q ||
              "高级 微软 Client ID 数据 DeepSeek AI 助手 模型 API 连接 测试 日志分析 Key 密钥".includes(
                q,
              )) && (
              <Card>
                <DeepSeekSettings />
                <SettingsAction
                  icon={<FolderOpen size={18} />}
                  title="本地数据目录"
                  description="打开启动器的数据文件夹，查看本地文件。"
                >
                  <Button
                    onClick={() => guarded(() => api("open_data_folder"))}
                  >
                    打开目录
                  </Button>
                </SettingsAction>
                <SettingsAction
                  icon={<RotateCcw size={18} />}
                  title="恢复默认设置"
                  description="重置界面与全局偏好，保留游戏实例和账号。"
                >
                  <Button
                    onClick={() => {
                      update(initialSettings);
                      s.notify("已恢复全局默认设置");
                    }}
                  >
                    恢复默认
                  </Button>
                </SettingsAction>
              </Card>
            )}
          {show("关于") &&
            (!q || "关于 版本 GitHub 爱发电 官网 哔哩哔哩".includes(q)) && (
              <Card>
                <div className="about-brand">
                  <div className="logo">K</div>
                  <div>
                    <h2>Kynex Launcher</h2>
                    <p>{RELEASE.label}</p>
                  </div>
                </div>
                <div className="about-links">
                  <Button
                    onClick={() =>
                      guarded(() => external("https://kynexl.com.cn"))
                    }
                  >
                    官方网站
                  </Button>
                  <Button
                    onClick={() =>
                      guarded(() =>
                        external(
                          "https://space.bilibili.com/522722745?spm_id_from=333.1007.0.0",
                        ),
                      )
                    }
                  >
                    哔哩哔哩主页
                  </Button>
                  <Button
                    onClick={() => guarded(() => external(RELEASE.supportUrl))}
                  >
                    爱发电主页
                  </Button>
                  <Button
                    disabled={!RELEASE.repositoryUrl}
                    title={
                      RELEASE.repositoryUrl ? "GitHub 仓库" : "仓库地址暂未配置"
                    }
                    onClick={() =>
                      guarded(() => external(RELEASE.repositoryUrl))
                    }
                  >
                    GitHub 仓库
                  </Button>
                </div>
              </Card>
            )}
        </div>
      </div>
    </section>
  );
}
