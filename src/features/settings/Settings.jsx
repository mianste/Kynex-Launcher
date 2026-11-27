import { ColorPalette } from "./ColorPalette";
import { SettingsAction } from "./SettingsAction";
import { RELEASE } from "../../lib/release";
import { effectiveUiOpacity } from "../../lib/appearance";
import {
  changesAppearance,
  transitionAppearance,
} from "../../lib/appearanceTransition";
import {
  findNextHoliday,
  formatChineseMonthDay,
  formatHolidayRange,
  resolveActiveHoliday,
} from "../../lib/holidays";
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
  Sparkles,
  Sun,
  Upload,
} from "lucide-react";
import {
  Button,
  Card,
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
import {
  argumentError,
  hasArgumentPreset,
  toggleArgumentPreset,
} from "../../lib/launchArguments";
import "./launch-settings.css";
export function Settings() {
  const s = useStore();
  const [category, C] = useState(() => (consumeAiSettings() ? "高级" : "启动"));
  const [q, Q] = useState("");
  useGuideSection("settings", (section) => {
    C(section);
    Q("");
  });
  const content = useRef(null);
  const nav = useRef(null);
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
    const openHoliday = () => {
      Q("");
      C("界面");
      requestAnimationFrame(() => {
        document
          .querySelector(".holiday-settings-card")
          ?.scrollIntoView({ block: "start", behavior: "smooth" });
      });
    };
    if (category === "高级") focusModel();
    window.addEventListener("kynex-open-ai-settings", openModel);
    window.addEventListener("kynex-open-holiday-settings", openHoliday);
    return () => {
      window.removeEventListener("kynex-open-ai-settings", openModel);
      window.removeEventListener("kynex-open-holiday-settings", openHoliday);
    };
  }, []);
  useSelectionMotion(nav);
  useEffect(() => {
    content.current?.scrollTo({ top: 0 });
  }, [category, q]);
  const [java, J] = useState([]);
  const [scanning, Sc] = useState(false);
  const [mirrorResults, MirrorResults] = useState([]);
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
  };
  const show = (name) => (!q ? category === name : true);
  function update(patch) {
    const apply = (latest) => {
      s.updateSettings(latest);
    };
    if (changesAppearance(patch))
      return transitionAppearance(s.settings, patch, apply);
    apply(patch);
  }
  const opacityFrame = useRef(0);
  const opacityPending = useRef(null);
  const opacityLabel = useRef(null);
  const opacityInput = useRef(null);
  // 非受控滑杆：拖动由浏览器原生更新，松手后才写回设置。
  useEffect(() => {
    const element = opacityInput.current;
    const value = effectiveUiOpacity(s.settings);
    if (element && Number(element.value) !== value) {
      element.value = String(value);
    }
    if (opacityLabel.current) opacityLabel.current.textContent = `${value}%`;
  }, [s.settings.uiOpacity, s.settings.liquidOpacity, s.settings.theme]);
  // 拖动时直接改 CSS 变量（每帧最多一次），松手才写 store，避免整页重渲染导致掉帧。
  function previewOpacity(value) {
    opacityPending.current = value;
    if (opacityFrame.current) return;
    opacityFrame.current = requestAnimationFrame(() => {
      opacityFrame.current = 0;
      const next = opacityPending.current;
      if (next == null) return;
      const app = document.querySelector(".app");
      if (app) app.dataset.appearanceChanging = "true";
      app?.style.setProperty("--ui-alpha", `${next}%`);
      app?.style.setProperty("--ui-blur", next === 0 ? "0px" : "26px");
      app?.dispatchEvent(new Event("kynex-appearance-preview"));
      if (opacityLabel.current) opacityLabel.current.textContent = `${next}%`;
    });
  }
  function commitOpacity(value) {
    if (opacityFrame.current) {
      cancelAnimationFrame(opacityFrame.current);
      opacityFrame.current = 0;
    }
    opacityPending.current = null;
    const app = document.querySelector(".app");
    app?.style.setProperty("--ui-alpha", `${value}%`);
    app?.style.setProperty("--ui-blur", value === 0 ? "0px" : "26px");
    app?.dispatchEvent(new Event("kynex-appearance-preview"));
    update(
      s.settings.theme === "liquid"
        ? { liquidOpacity: value }
        : { uiOpacity: value },
    );
    requestAnimationFrame(() => {
      if (app) delete app.dataset.appearanceChanging;
    });
  }
  const [we, setWe] = useState(null);
  const [weBusy, setWeBusy] = useState(false);
  const dynamicWallpaper = s.settings.wallpaper.startsWith("video:");
  const nowDate = new Date();
  const activeHoliday = resolveActiveHoliday(s.settings, nowDate);
  const nextHoliday = findNextHoliday(s.settings, nowDate);
  const dismissedCount = Object.keys(s.settings.holidayDismissed || {}).length;
  async function scanWallpaperEngine() {
    setWeBusy(true);
    try {
      setWe(await api("wallpaper_engine_scan"));
    } finally {
      setWeBusy(false);
    }
  }
  async function applyWallpaper(f) {
    if (f.size > 5 * 1024 * 1024) throw new Error("壁纸请使用 5 MB 以内的图片");
    const url = URL.createObjectURL(f);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(1920, img.width);
      canvas.height = Math.round((img.height * canvas.width) / img.width);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      await update({ wallpaper: canvas.toDataURL("image/jpeg", 0.82) });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const toggleArgPreset = (field, snippet) => {
    if (argumentError(s.settings[field] ?? "")) return;
    update({ [field]: toggleArgumentPreset(s.settings[field] ?? "", snippet) });
  };
  const jvmArgsValue = s.settings.jvmArgs ?? "";
  const gameArgsValue = s.settings.gameArgs ?? "";
  const jvmQuoteError = argumentError(jvmArgsValue);
  const gameQuoteError = argumentError(gameArgsValue);
  const jvmPresets = [
    {
      label: "G1GC 优化",
      value:
        "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200",
    },
    {
      label: "忽略 Forge 证书",
      value:
        "-Dfml.ignoreInvalidMinecraftCertificates=true -Dfml.ignorePatchDiscrepancies=true",
    },
    {
      label: "UTF-8 编码",
      value: "-Dfile.encoding=UTF-8",
    },
  ];
  const gamePresets = [{ label: "全屏启动", value: "--fullscreen" }];
  return (
    <section
      className="settings-page"
      data-category={q ? "search" : category}
      aria-label="设置"
    >
      <div className="page-head">
        <h1>设置</h1>
      </div>
      <div className="settings-layout">
        <aside className="settings-sidebar" aria-label="设置分类">
          <SearchInput value={q} onChange={Q} placeholder="搜索设置" />
          <nav className="settings-nav motion-selection-vertical" ref={nav}>
            {categories.map((c) => {
              const Icon = categoryIcons[c];
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
            (!q ||
              "启动 内存 窗口 标题 全屏 Java JVM 隔离 语言 自定义 信息 替换 标记 启动参数 参数".includes(
                q,
              )) && (
              <Card className="launch-settings-card">
                <div className="settings-card-head">
                  <span className="settings-card-icon">
                    <Settings2 size={17} />
                  </span>
                  <h3>启动与性能</h3>
                </div>
                <div className="launch-settings-grid">
                  <Row title="内存分配">
                    <MemorySlider
                      label="全局内存"
                      value={s.settings.memory}
                      onChange={(memory) => update({ memory })}
                    />
                  </Row>
                  <div className="launch-settings-window">
                    <Row title="游戏窗口大小">
                      <div className="window-size-control">
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
                          <span aria-hidden="true">×</span>
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
                        <div
                          className="window-presets"
                          role="group"
                          aria-label="窗口大小预设"
                        >
                          {[
                            [1280, 720],
                            [1600, 900],
                            [1920, 1080],
                          ].map(([w, h]) => {
                            const selected =
                              s.settings.width === w && s.settings.height === h;
                            return (
                              <button
                                key={`${w}x${h}`}
                                type="button"
                                className={selected ? "on" : ""}
                                aria-pressed={selected}
                                onClick={() => update({ width: w, height: h })}
                              >
                                {w} × {h}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </Row>
                  </div>
                  <div className="launch-settings-java">
                    <Row title="默认 Java 路径">
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
                  </div>
                  <div className="launch-settings-game">
                    <Row title="版本隔离">
                      <OptionSelect
                        label="全局版本隔离"
                        className="drop-up"
                        value={s.settings.isolation}
                        onChange={(isolation) => update({ isolation })}
                        options={[
                          { value: "all", label: "全部独立" },
                          { value: "modded", label: "仅模组实例独立" },
                          { value: "shared", label: "共享游戏目录" },
                        ]}
                      />
                    </Row>
                    <Row title="游戏语言">
                      <OptionSelect
                        label="启动时游戏语言"
                        className="drop-up"
                        value={s.settings.gameLanguage}
                        onChange={(gameLanguage) => update({ gameLanguage })}
                        options={[
                          { value: "zh_cn", label: "简体中文" },
                          { value: "en_us", label: "English" },
                          { value: "none", label: "不修改" },
                        ]}
                      />
                    </Row>
                  </div>
                  <div className="launch-settings-game">
                    <Row
                      title="全屏启动"
                      hint="以全屏打开游戏；关闭后使用上面的窗口尺寸。"
                    >
                      <Switch
                        label="全屏启动"
                        on={s.settings.fullscreen === true}
                        change={(fullscreen) => update({ fullscreen })}
                      />
                    </Row>
                    <Row
                      title="自定义版本信息"
                      hint="显示在游戏窗口顶部，支持 {version}、{user} 等标记；下次启动生效，留空保留游戏默认标题。"
                    >
                      <Input
                        aria-label="自定义版本信息"
                        maxLength={256}
                        placeholder="例如 KXL · {version} · {user}"
                        value={s.settings.customInfo ?? ""}
                        onChange={(e) => update({ customInfo: e.target.value })}
                      />
                    </Row>
                  </div>
                  <div className="launch-settings-args">
                    <h4 className="launch-advanced-title">高级启动参数</h4>
                    <Row title="自定义 JVM 参数">
                      <div className="launch-arg-field">
                        <div className="setting-control">
                          <textarea
                            rows={3}
                            spellCheck={false}
                            aria-label="自定义 JVM 参数"
                            aria-invalid={!!jvmQuoteError}
                            className="input launch-arg-input"
                            placeholder="例如：-XX:+UseG1GC -XX:+UnlockExperimentalVMOptions"
                            value={jvmArgsValue}
                            onChange={(e) =>
                              update({ jvmArgs: e.target.value })
                            }
                          />
                          <Button
                            disabled={!jvmArgsValue.trim()}
                            onClick={() => update({ jvmArgs: "" })}
                          >
                            <RotateCcw size={13} />
                            清空
                          </Button>
                        </div>
                        <div
                          className="launch-arg-presets"
                          role="group"
                          aria-label="常用 JVM 参数快捷添加"
                        >
                          {jvmPresets.map((preset) => {
                            const active = hasArgumentPreset(
                              jvmArgsValue,
                              preset.value,
                            );
                            return (
                              <button
                                key={preset.label}
                                type="button"
                                className={active ? "on" : ""}
                                aria-pressed={active}
                                disabled={
                                  !!argumentError(
                                    s.settings[
                                      preset.value.startsWith("--")
                                        ? "gameArgs"
                                        : "jvmArgs"
                                    ] ?? "",
                                  )
                                }
                                onClick={() =>
                                  toggleArgPreset("jvmArgs", preset.value)
                                }
                              >
                                {preset.label}
                              </button>
                            );
                          })}
                        </div>
                        {jvmQuoteError && (
                          <small className="launch-arg-error">
                            {jvmQuoteError}
                          </small>
                        )}
                      </div>
                    </Row>
                    <Row title="自定义游戏参数">
                      <div className="launch-arg-field">
                        <div className="setting-control">
                          <textarea
                            rows={3}
                            spellCheck={false}
                            aria-label="自定义游戏参数"
                            aria-invalid={!!gameQuoteError}
                            className="input launch-arg-input"
                            placeholder="例如：--fullscreen"
                            value={gameArgsValue}
                            onChange={(e) =>
                              update({ gameArgs: e.target.value })
                            }
                          />
                          <Button
                            disabled={!gameArgsValue.trim()}
                            onClick={() => update({ gameArgs: "" })}
                          >
                            <RotateCcw size={13} />
                            清空
                          </Button>
                        </div>
                        <div
                          className="launch-arg-presets"
                          role="group"
                          aria-label="常用游戏参数快捷添加"
                        >
                          {gamePresets.map((preset) => {
                            const active = hasArgumentPreset(
                              gameArgsValue,
                              preset.value,
                            );
                            return (
                              <button
                                key={preset.label}
                                type="button"
                                className={active ? "on" : ""}
                                aria-pressed={active}
                                onClick={() =>
                                  toggleArgPreset("gameArgs", preset.value)
                                }
                              >
                                {preset.label}
                              </button>
                            );
                          })}
                        </div>
                        {gameQuoteError && (
                          <small className="launch-arg-error">
                            {gameQuoteError}
                          </small>
                        )}
                      </div>
                    </Row>
                    <p className="launch-arg-note">
                      全局参数在实例未指定同类参数时生效。JVM
                      参数在主类之前，游戏参数在末尾；空格或换行分隔参数，含空格路径请用引号包裹。内存优先使用上面的设置，避免重复填写
                      -Xmx / -Xms。
                    </p>
                    <details className="launch-arg-help">
                      <summary>替换标记与填写示例</summary>
                      <p>
                        JVM
                        参数、游戏参数和自定义版本信息支持以下标记，启动时替换为当前实例的值。
                      </p>
                      <dl>
                        {[
                          ["{user}", "玩家名"],
                          ["{uuid}", "玩家 UUID"],
                          ["{version}", "Minecraft 版本"],
                          ["{name}", "实例文件夹名"],
                          ["{minecraft}", "游戏根目录"],
                          ["{verpath}", "实例目录"],
                          ["{verindie}", "实际游戏目录"],
                        ].map(([token, label]) => (
                          <div key={token}>
                            <dt>{token}</dt>
                            <dd>{label}</dd>
                          </div>
                        ))}
                      </dl>
                      <p>
                        路径标记包含末尾分隔符，建议使用单引号包裹路径。原有的{" "}
                        <code>{"$" + "{game_directory}"}</code> 等 Minecraft
                        标记继续支持。
                      </p>
                      <p>
                        JVM 示例：
                        <code>
                          {'-Dmy.gameDir="' + "$" + '{game_directory}"'}
                        </code>
                      </p>
                    </details>
                  </div>
                </div>
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
                      downloadSource: value,
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
                <div key={r.source}>
                  <div className="kv">
                    <span>
                      {r.source === "bmclapi"
                        ? "BMCLAPI 国内镜像"
                        : "Mojang 官方源"}
                    </span>
                    <Badge tone={r.ok ? "ok" : "warn"}>
                      {r.ok ? `${r.latency} ms` : "暂时不可用"}
                    </Badge>
                  </div>
                  {!r.ok && r.reason && <p className="muted">{r.reason}</p>}
                </div>
              ))}
              <p>
                镜像服务由 BMCLAPI / bangbang93
                提供。模组搜索、微软授权和无法映射的文件仍使用各自官方服务。
              </p>
              <Row
                title="下载并发"
                hint="1–64 个文件同时处理，适用于游戏资源和整合包；推荐 16–32。"
              >
                <div className="setting-control">
                  <Input
                    aria-label="下载并发"
                    type="number"
                    min={1}
                    max={64}
                    value={s.settings.threads}
                    onChange={(e) =>
                      update({
                        threads: Math.min(
                          64,
                          Math.max(1, Number(e.target.value) || 1),
                        ),
                      })
                    }
                  />
                  <Badge>{s.settings.threads} 个文件</Badge>
                  {[16, 32, 64].map((threads) => (
                    <Button
                      key={threads}
                      aria-pressed={s.settings.threads === threads}
                      onClick={() => update({ threads })}
                    >
                      {threads}
                    </Button>
                  ))}
                </div>
              </Row>
              <p>
                连接测速显示响应延迟；已有文件会先校验复用，未完成的文件会重新下载，并发数可在上方调整。
              </p>
            </Card>
          )}
          {show("界面") &&
            (!q ||
              "界面 主题 玻璃主题 颜色 壁纸 节日 圣诞 春节 万圣 动效 拖尾".includes(
                q,
              )) && (
              <>
                <Card>
                  <h3>外观</h3>
                  <Row
                    title="界面主题"
                    hint="选择浅色、深色、玻璃主题、跟随系统，或自己调色。"
                  >
                    <div className="theme-choices">
                      {[
                        { value: "light", label: "浅色", icon: Sun },
                        { value: "dark", label: "深色", icon: Moon },
                        { value: "liquid", label: "玻璃主题", icon: Sparkles },
                        { value: "system", label: "跟随系统", icon: Monitor },
                        { value: "custom", label: "自定义", icon: Palette },
                      ].map(({ value, label, icon: Icon }) => (
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
                  {s.settings.theme === "liquid" && (
                    <div className="liquid-theme-note">
                      <Sparkles size={18} aria-hidden="true" />
                      <div>
                        <b>玻璃主题</b>
                        <span>
                          边缘折射、流光高光与通透面板，配色跟随强调色和节日。可用下方不透明度调整通透程度。
                        </span>
                      </div>
                    </div>
                  )}
                  {s.settings.theme === "custom" && (
                    <Row title="主题底色">
                      <ColorPalette
                        label="主题底色"
                        value={s.settings.customThemeColor}
                        onChange={(customThemeColor) =>
                          update({ customThemeColor })
                        }
                      />
                    </Row>
                  )}
                  <Row title="强调色" hint="选择按钮和选中项的颜色。">
                    <div className="color-dots">
                      {[
                        "#6F9F94",
                        "#7895A4",
                        "#72A788",
                        "#C59862",
                        "#B87373",
                      ].map((color) => (
                        <button
                          aria-label={`强调色 ${color}`}
                          key={color}
                          className={
                            s.settings.accent.toLowerCase() ===
                            color.toLowerCase()
                              ? "on"
                              : ""
                          }
                          style={{ background: color }}
                          onClick={() => update({ accent: color })}
                        />
                      ))}
                    </div>
                  </Row>
                  <Row title="自定义强调色">
                    <ColorPalette
                      label="强调色"
                      value={s.settings.accent}
                      onChange={(accent) => update({ accent })}
                    />
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
                      defaultValue={effectiveUiOpacity(s.settings)}
                      onInput={(e) =>
                        previewOpacity(Number(e.currentTarget.value))
                      }
                      onPointerUp={(e) =>
                        commitOpacity(Number(e.currentTarget.value))
                      }
                      onPointerCancel={(e) =>
                        commitOpacity(Number(e.currentTarget.value))
                      }
                      onKeyUp={(e) =>
                        commitOpacity(Number(e.currentTarget.value))
                      }
                      onBlur={(e) =>
                        commitOpacity(Number(e.currentTarget.value))
                      }
                    />
                    <b ref={opacityLabel}>{effectiveUiOpacity(s.settings)}%</b>
                  </Row>
                  <Row title="鼠标拖尾与点击动效">
                    <Switch
                      label="鼠标拖尾与点击动效"
                      on={s.settings.holidayEffects !== false}
                      change={(holidayEffects) => update({ holidayEffects })}
                    />
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
                      没有找到 Wallpaper Engine 创意工坊目录：请先通过 Steam
                      安装 Wallpaper Engine，并订阅至少一个动态壁纸。
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
                <Card className="holiday-settings-card">
                  <div className="settings-card-head">
                    <span className="settings-card-icon">
                      <Sparkles size={17} />
                    </span>
                    <h3>节日主题</h3>
                  </div>
                  <div className="holiday-status-banner">
                    <div className="holiday-status-info">
                      {activeHoliday ? (
                        <>
                          <strong>
                            {`现在是${activeHoliday.holiday.name}主题`}
                            <Badge tone="ok">
                              {`还剩 ${activeHoliday.daysLeft} 天`}
                            </Badge>
                          </strong>
                          <span>
                            {formatHolidayRange(
                              activeHoliday.windowStart,
                              activeHoliday.windowEnd,
                            )}
                          </span>
                        </>
                      ) : (
                        <>
                          <strong>现在是平时主题</strong>
                          <span>
                            {s.settings.holidayThemeEnabled === false
                              ? "已关闭自动切换。"
                              : nextHoliday
                                ? `下次自动切换：${nextHoliday.holiday.name}（${formatChineseMonthDay(nextHoliday.windowStart)}，还有 ${nextHoliday.daysUntilStart} 天）`
                                : "到节日会自动切换。"}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="holiday-status-actions">
                      {activeHoliday ? (
                        <Button
                          onClick={() => {
                            update({
                              holidayDismissed: {
                                ...(s.settings.holidayDismissed || {}),
                                [activeHoliday.occurrenceKey]: true,
                              },
                            });
                            s.notify(
                              `这次${activeHoliday.holiday.name}先不用节日主题`,
                            );
                          }}
                        >
                          这次先不用
                        </Button>
                      ) : null}
                      {dismissedCount > 0 && (
                        <Button
                          onClick={() => {
                            update({ holidayDismissed: {} });
                            s.notify("已恢复跳过的节日");
                          }}
                        >
                          恢复跳过的节日
                        </Button>
                      )}
                    </div>
                  </div>
                  <Row title="自动切换节日主题">
                    <Switch
                      label="自动切换节日主题"
                      on={s.settings.holidayThemeEnabled !== false}
                      change={(holidayThemeEnabled) =>
                        update({ holidayThemeEnabled })
                      }
                    />
                  </Row>
                  <Row title="节日壁纸">
                    <Badge>视频壁纸不会换</Badge>
                    <Switch
                      label="节日壁纸"
                      on={s.settings.holidayWallpaper !== false}
                      change={(holidayWallpaper) =>
                        update({ holidayWallpaper })
                      }
                    />
                  </Row>
                </Card>
              </>
            )}
          {show("更新") &&
            (!q || "更新 自动 手动 检测 新版 启动器".includes(q)) && (
              <Card>
                <h3>启动器更新</h3>
                <Row
                  title="启动时检测新版"
                  hint={
                    s.settings.updateMode === "automatic"
                      ? "自动模式会在启动时和运行期间检测新版。"
                      : "同一个新版只自动提醒一次，主动检测仍可再次打开更新窗口。"
                  }
                >
                  <Switch
                    label="启动时检测新版"
                    on={
                      s.settings.updateMode === "automatic" ||
                      s.settings.checkUpdatesOnStartup !== false
                    }
                    disabled={s.settings.updateMode === "automatic"}
                    change={(value) => update({ checkUpdatesOnStartup: value })}
                  />
                </Row>
                <Row
                  title="更新方式"
                  hint="手动模式先询问，自动模式直接下载。两种方式都在后台下载，安装完成后重新打开启动器。"
                >
                  <OptionSelect
                    label="启动器更新方式"
                    value={s.settings.updateMode || "manual"}
                    onChange={(value) => update({ updateMode: value })}
                    options={[
                      { value: "manual", label: "确认后下载安装" },
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
