import { RELEASE } from "../../lib/release";
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
} from "../../components/ui";
import { useStore, guarded, initialSettings } from "../../store";
import { useSelectionMotion } from "../../lib/useSelectionMotion";
import {
  api,
  desktop,
  external,
  pickFile,
  pickImageFile,
} from "../../lib/bridge";
export function Settings() {
  const s = useStore();
  const [category, C] = useState("启动");
  const [q, Q] = useState("");
  const content = useRef<HTMLDivElement>(null);
  const nav = useRef<HTMLElement>(null);
  useSelectionMotion(nav);
  useEffect(() => {
    content.current?.scrollTo({ top: 0 });
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
  const [msId, MsId] = useState(s.settings.clientId);
  const [msEmbedded, MsEmbedded] = useState(false);
  useEffect(() => {
    if (!desktop) return;
    let live = true;
    api<{ embedded?: boolean }>("microsoft_status", {
      clientId: s.settings.clientId,
    })
      .then((value) => {
        if (live) MsEmbedded(Boolean(value.embedded));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [s.settings.clientId]);
  const categories = ["启动", "Java 管理", "下载", "界面", "高级", "关于"];
  const categoryIcons = {
    启动: Rocket,
    "Java 管理": Coffee,
    下载: Download,
    界面: Palette,
    高级: SlidersHorizontal,
    关于: Info,
  } as const;
  const show = (name: string) => (!q ? category === name : true);
  const update = s.updateSettings;
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
    <section className="settings-page" aria-label="设置">
      <div className="page-head">
        <div>
          <h1>设置</h1>
          <p>你的习惯，你的启动方式。</p>
        </div>
        <SearchInput value={q} onChange={Q} placeholder="搜索设置分类" />
      </div>
      <div className="settings-layout">
        <nav className="settings-nav motion-selection-vertical" ref={nav}>
          {categories.map((c) => {
            const Icon = categoryIcons[c as keyof typeof categoryIcons];
            return (
              <button
                key={c}
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
        <div
          className="settings-content"
          ref={content}
          tabIndex={0}
          aria-label="设置内容"
        >
          {show("启动") &&
            (!q || "启动 内存 窗口 Java JVM 隔离".includes(q)) && (
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
              <Row
                title="游戏文件来源"
                hint="国内镜像失败时自动回退官方源，保留文件哈希校验。"
              >
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
                hint="核心固定最多 8 个文件并发，单文件校验失败自动重试 3 次。"
              >
                <Badge>8 个文件</Badge>
              </Row>
              <Row
                title="文件完整性"
                hint="有官方哈希的文件必须校验成功后才写入最终位置。"
              >
                <Badge tone="ok">SHA-1 / SHA-256</Badge>
              </Row>
              <p>
                连接测速显示当前网络的响应延迟；断点续传与可调并发尚未接入。
              </p>
            </Card>
          )}
          {show("界面") && (!q || "界面 主题 颜色 壁纸".includes(q)) && (
            <Card>
              <h3>外观</h3>
              <Row
                title="界面主题"
                hint="深色/浅色立即生效；跟随系统会自动响应 Windows 深浅色变化。"
              >
                <div className="theme-choices">
                  {(
                    [
                      { value: "light", label: "浅色", icon: Sun },
                      { value: "dark", label: "深色", icon: Moon },
                      { value: "system", label: "跟随系统", icon: Monitor },
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
              <Row title="强调色" hint="按钮、标签、进度与选中状态即时生效。">
                <div className="color-dots">
                  {["#6F9F94", "#7895A4", "#72A788", "#C59862", "#B87373"].map(
                    (color) => (
                      <button
                        aria-label={`强调色 ${color}`}
                        key={color}
                        className={s.settings.accent === color ? "on" : ""}
                        style={{ background: color }}
                        onClick={() => update({ accent: color })}
                      />
                    ),
                  )}
                </div>
              </Row>
              <Row title="自定义颜色">
                <input
                  aria-label="取色器"
                  type="color"
                  value={s.settings.accent}
                  onChange={(e) => update({ accent: e.target.value })}
                />
                <Input
                  aria-label="十六进制强调色"
                  value={s.settings.accent}
                  onChange={(e) => {
                    if (/^#[\da-f]{6}$/i.test(e.target.value))
                      update({ accent: e.target.value });
                  }}
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
            </Card>
          )}
          {show("高级") && (!q || "高级 微软 Client ID 数据".includes(q)) && (
            <Card>
              <h3>登录与数据</h3>
              <Row
                title="Microsoft 登录"
                hint={
                  msEmbedded
                    ? "官方登录凭据已内嵌，无需用户配置。"
                    : "开发版需要填写 Azure 应用注册的应用程序（客户端）ID。"
                }
              >
                {msEmbedded ? (
                  <Badge tone="ok">已内嵌</Badge>
                ) : (
                  <>
                    <Input
                      aria-label="Microsoft Client ID"
                      value={msId}
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      spellCheck={false}
                      onChange={(e) => MsId(e.target.value)}
                    />
                    <Button
                      onClick={() => {
                        const value = msId.trim();
                        if (
                          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                            value,
                          )
                        ) {
                          s.notify(
                            "Client ID 必须是 Azure 应用的 GUID，不能填写应用密码或密钥。",
                          );
                          return;
                        }
                        update({ clientId: value });
                        s.notify("Microsoft Client ID 已保存");
                      }}
                    >
                      保存
                    </Button>
                  </>
                )}
              </Row>
              <Row title="本地数据目录">
                <Button onClick={() => guarded(() => api("open_folder"))}>
                  打开
                </Button>
              </Row>
              <Row
                title="CurseForge 来源"
                hint="公开源码不内置项目 API Key，可通过 KXL_CURSEFORGE_API_KEY 环境变量配置。"
              >
                <Badge>自行配置</Badge>
              </Row>
              <Row title="恢复界面与全局默认设置" hint="不会删除实例和账号。">
                <Button
                  onClick={() => {
                    update(initialSettings);
                    s.notify("已恢复全局默认设置");
                  }}
                >
                  恢复默认
                </Button>
              </Row>
              <p>登录凭据仅保存到系统凭据库；日志诊断全部在本地完成。</p>
            </Card>
          )}
          {show("关于") && (!q || "关于 版本 GitHub 爱发电".includes(q)) && (
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
                  onClick={() => guarded(() => external(RELEASE.supportUrl))}
                >
                  爱发电主页
                </Button>
                <Button
                  disabled={!RELEASE.repositoryUrl}
                  title={
                    RELEASE.repositoryUrl ? "GitHub 仓库" : "仓库地址暂未配置"
                  }
                  onClick={() => guarded(() => external(RELEASE.repositoryUrl))}
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
