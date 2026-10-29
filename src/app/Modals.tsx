import { ChoiceSelect } from "../components/ui/ChoiceSelect";
import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy, Globe, ShieldCheck, Settings2 } from "lucide-react";
import {
  Button,
  Field,
  Input,
  MemorySlider,
  Modal,
  OptionSelect,
  Tabs,
  SearchInput,
  Badge,
  Empty,
} from "../components/ui";
import { useStore, guarded, launch } from "../store";
import { api, desktop, external, saveFile } from "../lib/bridge";
import type {
  Instance,
  Loader,
  InstanceSettings,
  PackInfo,
  Account,
  Resource,
} from "../lib/types";
import { readLocalSkins } from "../features/skin/library";
import { defaultSkin } from "../features/skin/textures";
import { SkinSprite } from "../features/skin/SkinSprite";
import { useMicrosoftLogin } from "../features/account/useMicrosoftLogin";
import { MotionPresence } from "../components/ui/Motion";
import { LoaderIcon, loaderLabels } from "../components/ui/LoaderIcon";
const loaderNames: Loader[] = [
  "vanilla",
  "fabric",
  "quilt",
  "forge",
  "neoforge",
  "optifine",
];
export function Modals() {
  const s = useStore();
  const modal = s.modal;
  return (
    <MotionPresence>
      {modal ? (
        <ModalContent
          key={`${modal.kind}-${modal.data}`}
          kind={modal.kind}
          data={modal.data}
        />
      ) : null}
    </MotionPresence>
  );
}
function ModalContent({ kind, data }: { kind: string; data?: string }) {
  switch (kind) {
    case "versions":
      return <Versions />;
    case "install":
      return <Install version={data ?? "1.20.1"} />;
    case "login":
      return <Login />;
    case "instance-settings":
      return <VersionSettings id={data} />;
    case "pack":
      return <Pack path={data ?? ""} />;
    case "export":
      return <Export id={data} />;
    case "remove-account":
      return <RemoveAccount id={data ?? ""} />;
    case "remove-instance":
      return <RemoveInstance id={data ?? ""} />;
    default:
      return null;
  }
}
function Versions() {
  const s = useStore();
  const [q, Q] = useState("");
  const [selected, S] = useState(s.selected);
  return (
    <Modal
      title="选择版本"
      footer={
        <>
          <Button onClick={s.hide}>取消</Button>
          <Button
            primary
            disabled={!selected}
            onClick={() => {
              useStore.setState({ selected });
              s.hide();
            }}
          >
            使用此版本
          </Button>
        </>
      }
    >
      <SearchInput value={q} onChange={Q} placeholder="搜索实例名称" />
      <div className="version-options">
        {s.instances
          .filter((i) => i.name.toLowerCase().includes(q.toLowerCase()))
          .map((i) => (
            <button
              key={i.id}
              className={i.id === selected ? "on" : ""}
              onClick={() => S(i.id)}
            >
              <div className="mini-cube" />
              <div className="grow">
                <b>{i.name}</b>
                <small className="mono">
                  {i.version} · {i.loader}
                </small>
              </div>
              {i.id === selected && <Check size={18} />}
            </button>
          ))}
        {!s.instances.length && (
          <Empty title="先安装一个版本">
            <Button
              onClick={() => {
                s.hide();
                s.setPage("discover");
              }}
            >
              去下载
            </Button>
          </Empty>
        )}
      </div>
    </Modal>
  );
}
type OptiFineRelease = {
  value: string;
  filename: string;
  edition: string;
  patch: string;
  forge: string | null;
};
function Install({ version }: { version: string }) {
  const s = useStore();
  const [loader, L] = useState<Loader>("vanilla");
  const [versions, V] = useState<string[]>([]);
  const [lv, LV] = useState("");
  const [name, N] = useState(`${version}-Vanilla`);
  const [error, E] = useState("");
  const [loading, B] = useState(false);
  const [installing, I] = useState(false);
  const [optifine, setOptifine] = useState<OptiFineRelease[]>([]);
  const [optifineLoading, setOptifineLoading] = useState(false);
  const [optifineError, setOptifineError] = useState("");
  const [addon, setAddon] = useState("");
  useEffect(() => {
    let active = true;
    setOptifine([]);
    setAddon("");
    setOptifineError("");
    if (!desktop) return;
    setOptifineLoading(true);
    api<OptiFineRelease[]>("optifine_versions", { game: version })
      .then((rows) => {
        if (active) setOptifine(rows);
      })
      .catch((error) => {
        if (active) setOptifineError(String(error));
      })
      .finally(() => {
        if (active) setOptifineLoading(false);
      });
    return () => {
      active = false;
    };
  }, [version]);
  useEffect(() => {
    N(
      `${version}-${loader === "vanilla" ? "Vanilla" : loader[0].toUpperCase() + loader.slice(1)}`,
    );
    V([]);
    LV("");
    E("");
    setAddon("");
    B(false);
    if (loader === "vanilla" || loader === "optifine" || !desktop) return;
    let active = true;
    B(true);
    api<string[]>("loaders", { game: version, loader })
      .then((v) => {
        if (active) {
          V(v);
          LV(v[0] ?? "");
        }
      })
      .catch((e) => {
        if (active) E(String(e));
      })
      .finally(() => {
        if (active) B(false);
      });
    return () => {
      active = false;
    };
  }, [loader, version]);
  useEffect(() => {
    if (loader === "optifine") LV(optifine[0]?.value ?? "");
  }, [loader, optifine]);
  const compatibleOptifine = optifine.filter(
    (row) => row.forge && versions.includes(row.forge),
  );
  const addonRelease = optifine.find((row) => row.value === addon);
  const invalidAddon = !!addon && addonRelease?.forge !== lv;
  async function install(onlyVanilla = false) {
    I(true);
    s.hide();
    try {
      await api("install", {
        version,
        loader: onlyVanilla ? "vanilla" : loader,
        loaderVersion: lv,
        optifineVersion: onlyVanilla ? "" : addon,
        name,
        settings: s.settings,
      });
      await s.refresh();
      s.notify("实例安装完成");
    } finally {
      I(false);
    }
  }
  return (
    <Modal
      title={`安装 Minecraft ${version}`}
      wide
      footer={
        <>
          <Button disabled={installing} onClick={s.hide}>
            取消
          </Button>
          <Button
            busy={installing}
            onClick={() => guarded(() => install(true))}
          >
            仅安装原版
          </Button>
          <Button
            primary
            busy={installing}
            disabled={
              loading ||
              (loader !== "vanilla" && !lv) ||
              (loader === "optifine" && optifineLoading) ||
              invalidAddon
            }
            onClick={() => guarded(() => install())}
          >
            开始安装
          </Button>
        </>
      }
    >
      <p className="muted">选择基础加载器；Forge 可追加兼容的 OptiFine。</p>
      <div className="loader-grid">
        {loaderNames.map((l) => (
          <button
            key={l}
            title={loaderLabels[l]}
            aria-label={loaderLabels[l]}
            onClick={() => L(l)}
            className={loader === l ? "on" : ""}
          >
            <LoaderIcon loader={l} />
            <span className="loader-name">
              {
                {
                  vanilla: "原版",
                  fabric: "Fabric",
                  quilt: "Quilt",
                  forge: "Forge",
                  neoforge: "NeoForge",
                  optifine: "OptiFine",
                }[l]
              }
            </span>
            {loader === l && <Check size={14} />}
          </button>
        ))}
      </div>
      {loader === "optifine" ? (
        <Field
          label="OptiFine 版本"
          hint={
            optifineLoading
              ? "正在读取版本…"
              : optifine.length
                ? "直接下载并安装到此实例。"
                : "所选 Minecraft 版本暂无可用的 OptiFine。"
          }
        >
          <OptionSelect
            label="OptiFine 版本"
            value={lv}
            onChange={LV}
            disabled={optifineLoading || !optifine.length}
            options={optifine.map((row) => ({
              value: row.value,
              label: row.value,
              hint: row.patch.includes("pre") ? "预览版" : "正式版",
            }))}
          />
        </Field>
      ) : (
        loader !== "vanilla" && (
          <Field
            label="加载器版本"
            hint={
              loading ? "正在查询兼容版本…" : "仅列出所选游戏版本的兼容结果。"
            }
          >
            <div className="loader-version">
              <OptionSelect
                label="加载器版本"
                className="drop-up"
                value={lv}
                onChange={LV}
                options={versions.map((value) => ({
                  value,
                  label: value,
                }))}
              />
              <small>
                {loading ? "正在读取版本…" : `${versions.length} 个兼容版本`}
              </small>
            </div>
          </Field>
        )
      )}
      {loader === "forge" && (
        <section className="install-addon">
          <div className="install-addon-heading">
            <LoaderIcon loader="optifine" />
            <div className="grow">
              <b>同时安装 OptiFine</b>
              <small>
                {optifineLoading
                  ? "正在查询兼容版本…"
                  : compatibleOptifine.length
                    ? "选择后自动匹配对应 Forge，直接在启动器内安装。"
                    : "此游戏版本暂无已声明兼容的 Forge + OptiFine 组合。"}
              </small>
            </div>
            <button
              type="button"
              role="switch"
              aria-label="同时安装 OptiFine"
              aria-checked={!!addon}
              className={`switch ${addon ? "on" : ""}`}
              disabled={!compatibleOptifine.length}
              onClick={() => {
                const row =
                  compatibleOptifine.find((row) => row.forge === lv) ??
                  compatibleOptifine[0];
                if (addon) {
                  setAddon("");
                } else if (row) {
                  setAddon(row.value);
                  LV(row.forge!);
                }
              }}
            >
              <i />
            </button>
          </div>
          {!!addon && (
            <Field
              label="OptiFine 版本"
              hint={
                invalidAddon
                  ? `需要 Forge ${addonRelease?.forge}，请重新选择兼容的组合。`
                  : `匹配 Forge ${addonRelease?.forge}`
              }
            >
              <OptionSelect
                label="OptiFine 附加版本"
                value={addon}
                onChange={(value) => {
                  const row = compatibleOptifine.find(
                    (row) => row.value === value,
                  );
                  if (row) {
                    setAddon(value);
                    LV(row.forge!);
                  }
                }}
                options={compatibleOptifine.map((row) => ({
                  value: row.value,
                  label: row.value,
                  hint: `Forge ${row.forge}`,
                }))}
              />
            </Field>
          )}
        </section>
      )}
      {(loader === "optifine" || loader === "forge") && optifineError && (
        <div className="notice error">{optifineError}</div>
      )}
      {error && <div className="notice error">{error}</div>}
      <Field label="实例名称">
        <Input
          value={name}
          maxLength={80}
          onChange={(e) => N(e.target.value)}
        />
      </Field>
      {!desktop && (
        <div className="notice">网页仅预览界面。实际安装请运行桌面版。</div>
      )}
      {installing && (
        <div className="notice">
          正在安装，请留意窗口底部的真实任务进度。
          <Button onClick={() => guarded(() => api("cancel"))}>取消任务</Button>
        </div>
      )}
    </Modal>
  );
}
export function SettingsFields({
  value,
  change,
}: {
  value: InstanceSettings;
  change: (v: InstanceSettings) => void;
}) {
  const set = (v: Partial<InstanceSettings>) => change({ ...value, ...v });
  return (
    <div className="form-grid">
      <Field label="内存分配">
        <MemorySlider
          value={value.memory}
          onChange={(memory) => set({ memory })}
        />
      </Field>
      <Field label="Java 可执行文件" hint="留空自动匹配">
        <Input
          value={value.java}
          placeholder="java / java.exe 路径"
          onChange={(e) => set({ java: e.target.value })}
        />
      </Field>
      <Field label="窗口宽度">
        <Input
          type="number"
          min={640}
          max={7680}
          value={value.width}
          onChange={(e) => set({ width: Number(e.target.value) })}
        />
      </Field>
      <Field label="窗口高度">
        <Input
          type="number"
          min={360}
          max={4320}
          value={value.height}
          onChange={(e) => set({ height: Number(e.target.value) })}
        />
      </Field>
      <Field label="版本隔离">
        <ChoiceSelect
          aria-label="版本隔离"
          className="input"
          value={value.isolation}
          onValueChange={(selectedValue) =>
            set({ isolation: selectedValue as InstanceSettings["isolation"] })
          }
        >
          <option value="all">全部独立</option>
          <option value="modded">仅模组实例独立</option>
          <option value="shared">共享目录</option>
        </ChoiceSelect>
      </Field>
    </div>
  );
}
function VersionSettings({ id }: { id?: string }) {
  const s = useStore();
  const instance = s.instances.find((i) => i.id === (id || s.selected));
  const [value, V] = useState<InstanceSettings>(
    instance?.settings ?? s.settings,
  );
  const [busy, B] = useState(false);
  return (
    <Modal
      title={`版本设置 · ${instance?.name ?? "未选择实例"}`}
      footer={
        <>
          <Button onClick={s.hide}>取消</Button>
          <Button
            primary
            busy={busy}
            disabled={!instance}
            onClick={() =>
              guarded(async () => {
                if (!instance) return;
                B(true);
                try {
                  await api("save_instance", {
                    id: instance.id,
                    settings: value,
                  });
                  await s.refresh();
                  s.hide();
                  s.notify("实例设置已保存");
                } finally {
                  B(false);
                }
              })
            }
          >
            保存
          </Button>
        </>
      }
    >
      <SettingsFields value={value} change={V} />
      <div className="notice">
        仅对此版本生效。共享目录中的文件会被使用同一共享目录的版本共同读取。
      </div>
    </Modal>
  );
}
function Login() {
  const s = useStore();
  const [tab, T] = useState("微软正版");
  const [name, N] = useState("");
  const [email, EM] = useState("");
  const [password, PW] = useState("");
  const [server, SV] = useState("https://littleskin.cn/api/yggdrasil");
  const microsoft = useMicrosoftLogin();
  const [busy, B] = useState(false);
  const [error, E] = useState("");
  const [profiles, PR] = useState<{ id: string; name: string }[]>([]);
  const [profile, PF] = useState("");
  const [skinChoice, SkinChoice] = useState("default");
  const localSkins = readLocalSkins();
  const [authMeta, AuthMeta] = useState<{ name: string } | null>(null);
  const [checking, Checking] = useState(false);
  const [clientId, ClientId] = useState(s.settings.clientId);
  const [configOpen, ConfigOpen] = useState(false);
  const [msConfigured, MsConfigured] = useState(false);
  const [msEmbedded, MsEmbedded] = useState(false);
  useEffect(() => {
    if (!desktop) return;
    let live = true;
    api<{ configured: boolean; embedded?: boolean }>("microsoft_status", {
      clientId: s.settings.clientId,
    })
      .then((value) => {
        if (live) {
          MsConfigured(value.configured);
          MsEmbedded(Boolean(value.embedded));
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [s.settings.clientId]);
  useEffect(() => {
    if (/Client ID|配置/.test(microsoft.error)) ConfigOpen(true);
  }, [microsoft.error]);
  function cleanServer() {
    const raw = server
      .trim()
      .replace(/^authlib-injector:yggdrasil-server:/i, "");
    const value = raw.startsWith("https%3A") ? decodeURIComponent(raw) : raw;
    const u = new URL(value);
    if (u.protocol !== "https:") throw new Error("认证服务器需要 HTTPS 地址");
    return u.toString().replace(/\/$/, "");
  }
  async function checkServer() {
    Checking(true);
    try {
      const url = cleanServer();
      const meta = await api<{ name: string }>("auth_server", { server: url });
      AuthMeta(meta);
      SV(url);
      return url;
    } finally {
      Checking(false);
    }
  }
  async function doLogin() {
    B(true);
    E("");
    let skinWarning = "";
    try {
      let added: Account | undefined;
      if (tab === "离线") {
        const account = await api<Account>("offline_login", { name });
        added = account;
        const chosen =
          skinChoice === "default"
            ? { texture: defaultSkin(), model: "Classic" as const }
            : localSkins.find((x) => x.id === skinChoice);
        if (chosen) {
          try {
            await api("apply_skin", {
              accountId: account.id,
              texture: chosen.texture,
              model: chosen.model,
            });
          } catch (e) {
            skinWarning = String(e).replace(/^Error: /, "");
          }
        }
      } else if (tab === "外置认证") {
        const checkedServer = await checkServer();
        const v = await api<
          Account | { profiles: { id: string; name: string }[] }
        >("external_login", {
          server: checkedServer,
          email,
          password,
          profile: profile || null,
        });
        if ("profiles" in v) {
          PR(v.profiles);
          PF(v.profiles[0]?.id ?? "");
          return;
        }
        added = v;
      }
      await s.refresh();
      if (added) useStore.setState({ accountId: added.id });
      s.hide();
      s.notify(
        skinWarning ? `账号已添加；皮肤应用失败：${skinWarning}` : "账号已添加",
      );
      PW("");
    } catch (e) {
      E(String(e));
    } finally {
      B(false);
    }
  }
  return (
    <Modal
      title="添加账号"
      footer={
        <>
          <Button
            disabled={busy}
            onClick={() => {
              microsoft.cancel();
              s.hide();
            }}
          >
            取消
          </Button>
          <Button
            primary
            busy={busy || microsoft.busy}
            disabled={tab === "离线" && !/^[A-Za-z0-9_]{3,16}$/.test(name)}
            onClick={() =>
              tab === "微软正版" ? void microsoft.start() : void doLogin()
            }
          >
            {tab === "微软正版"
              ? microsoft.busy
                ? "正在等待网页授权…"
                : "微软账号登录"
              : "登录"}
          </Button>
        </>
      }
    >
      <Tabs
        items={["微软正版", "离线", "外置认证"]}
        value={tab}
        onChange={(t) => {
          microsoft.cancel();
          T(t);
          E("");
          PW("");
        }}
      />
      {tab === "微软正版" ? (
        <div className="microsoft-login">
          <div className="microsoft-login-icon" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </div>
          <h3>使用微软账号登录 Minecraft</h3>
          <p>在微软官方网站完成登录，KXL 将自动读取你的 Java 版游戏档案。</p>
          <div className="microsoft-login-steps">
            <span>1　自动复制设备码</span>
            <span>2　在微软网页粘贴授权</span>
            <span>3　自动完成登录</span>
          </div>
          {microsoft.flow && (
            <div className="microsoft-device">
              <small>如果网页要求设备代码，请粘贴下方代码</small>
              <div className="device-code">{microsoft.flow.userCode}</div>
              <div className="actions">
                <Button onClick={() => guarded(microsoft.copy)}>
                  <Copy size={14} />
                  复制设备码
                </Button>
                <Button onClick={() => guarded(microsoft.reopen)}>
                  <Globe size={14} />
                  重新打开微软网页
                </Button>
              </div>
            </div>
          )}
          {microsoft.message && (
            <p role="status" className="microsoft-status">
              {microsoft.message}
            </p>
          )}
          {microsoft.error && (
            <div role="alert" className="notice error">
              {microsoft.error}
            </div>
          )}
          {!msEmbedded && (
            <div className="microsoft-config">
              <button
                type="button"
                className="text-button"
                onClick={() => ConfigOpen((value) => !value)}
              >
                <Settings2 size={13} />
                登录配置（Client ID）
                {s.settings.clientId || msConfigured ? (
                  <span className="ok-text">已配置</span>
                ) : (
                  <span className="warn-text">未配置</span>
                )}
              </button>
              {configOpen && (
                <div className="microsoft-config-panel">
                  <p>
                    微软登录需要一个属于 KXL 的 Azure 应用 Client
                    ID。没有它时，官方不会允许任何启动器读取 Minecraft 档案。
                  </p>
                  <Field
                    label="Microsoft Client ID"
                    hint="Azure 应用注册里的应用程序（客户端）ID，格式为 GUID。"
                  >
                    <Input
                      value={clientId}
                      onChange={(e) => ClientId(e.target.value)}
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      spellCheck={false}
                    />
                  </Field>
                  <div className="actions">
                    <Button
                      primary
                      onClick={() => {
                        const value = clientId.trim();
                        if (
                          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                            value,
                          )
                        ) {
                          E(
                            "Client ID 必须是 Azure 应用的 GUID，例如 00000000-0000-0000-0000-000000000000。",
                          );
                          return;
                        }
                        s.updateSettings({ clientId: value });
                        ClientId(value);
                        MsConfigured(true);
                        E("");
                        ConfigOpen(false);
                        s.notify("Microsoft Client ID 已保存，现在可以登录");
                      }}
                    >
                      保存并使用
                    </Button>
                    <Button
                      onClick={() =>
                        guarded(() =>
                          external(
                            "https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
                          ),
                        )
                      }
                    >
                      打开 Azure
                    </Button>
                  </div>
                  <small>
                    在 Azure 中启用「公共客户端设备授权」，并为应用授予
                    Minecraft 服务权限。Client ID 不是密码，可安全保存在本机。
                  </small>
                </div>
              )}
            </div>
          )}
          <small>密码只在微软网页输入；关闭窗口会取消本次登录。</small>
        </div>
      ) : tab === "离线" ? (
        <>
          <Field label="用户名" hint="3–16 位字母、数字或下划线">
            <Input
              autoComplete="username"
              value={name}
              maxLength={16}
              onChange={(e) => N(e.target.value)}
              placeholder="请输入你的用户名"
            />
          </Field>
          <Field
            label="离线皮肤"
            hint="创建账号时会直接装配所选皮肤，之后也能在账号页更换。"
          >
            <div className="offline-skin-grid">
              <button
                type="button"
                className={
                  "offline-skin-option " +
                  (skinChoice === "default" ? "on" : "")
                }
                onClick={() => SkinChoice("default")}
              >
                <SkinSprite texture={defaultSkin()} model="Classic" />
                <span>
                  <b>默认皮肤</b>
                  <small>Steve · Classic</small>
                </span>
                {skinChoice === "default" && <Check size={13} />}
              </button>
              {localSkins.map((skin) => (
                <button
                  type="button"
                  key={skin.id}
                  className={
                    "offline-skin-option " +
                    (skinChoice === skin.id ? "on" : "")
                  }
                  onClick={() => SkinChoice(skin.id)}
                >
                  <SkinSprite texture={skin.texture} model={skin.model} />
                  <span>
                    <b>{skin.name}</b>
                    <small>{skin.model}</small>
                  </span>
                  {skinChoice === skin.id && <Check size={13} />}
                </button>
              ))}
            </div>
            {!localSkins.length && (
              <small className="muted">
                还没有自定义皮肤，先去皮肤页导入，再回来选择。
              </small>
            )}
          </Field>
          <Button
            onClick={() => {
              s.hide();
              s.setPage("skin");
            }}
          >
            管理皮肤库
          </Button>
          <div className="notice">
            离线身份适用于单人游戏与允许离线账号的服务器。请通过官方渠道购买
            Minecraft。
          </div>
        </>
      ) : (
        <>
          <Field label="认证服务器地址">
            <Input
              value={server}
              onChange={(e) => {
                SV(e.target.value);
                AuthMeta(null);
                PR([]);
                PF("");
              }}
              type="url"
            />
          </Field>
          <div className="chips">
            <Button
              busy={checking}
              onClick={() =>
                guarded(async () => {
                  await checkServer();
                })
              }
            >
              检查认证服务器
            </Button>
            <Button onClick={() => SV("https://littleskin.cn/api/yggdrasil")}>
              LittleSkin
            </Button>
          </div>
          {authMeta && (
            <div className="notice">
              <ShieldCheck size={15} />
              已识别：{authMeta.name}
            </div>
          )}
          <Field label="邮箱或用户名">
            <Input
              autoComplete="username"
              value={email}
              onChange={(e) => EM(e.target.value)}
            />
          </Field>
          <Field label="密码">
            <Input
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(e) => PW(e.target.value)}
            />
          </Field>
          {profiles.length > 0 && (
            <Field label="选择角色">
              <ChoiceSelect
                aria-label="外置认证角色"
                className="input"
                value={profile}
                onValueChange={(selectedValue) => PF(selectedValue)}
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </ChoiceSelect>
            </Field>
          )}
          <p className="muted">
            <ShieldCheck size={14} /> 凭据只发送到上述 HTTPS 认证地址。
          </p>
        </>
      )}
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
    </Modal>
  );
}
function Pack({ path }: { path: string }) {
  const s = useStore();
  const [info, I] = useState<PackInfo | null>(null);
  const [name, N] = useState("");
  const [error, E] = useState("");
  const [busy, B] = useState(false);
  useEffect(() => {
    api<PackInfo>("inspect_pack", { path })
      .then((v) => {
        I(v);
        N(v.name);
      })
      .catch((e) => E(String(e)));
  }, [path]);
  return (
    <Modal
      title="安装整合包"
      footer={
        <>
          <Button
            disabled={busy}
            onClick={() => {
              s.hide();
            }}
          >
            取消
          </Button>
          <Button
            primary
            busy={busy}
            disabled={!info}
            onClick={() =>
              guarded(async () => {
                B(true);
                try {
                  s.hide();
                  const instance = await api<Instance>("import_pack", {
                    path,
                    name,
                    settings: s.settings,
                    curseforgeKey: s.settings.curseforgeKey,
                  });
                  await s.refresh();
                  useStore.setState({ selected: instance.id });
                  s.notify("整合包安装完成");
                } finally {
                  B(false);
                }
              })
            }
          >
            确认安装
          </Button>
        </>
      }
    >
      {info ? (
        <>
          <Badge>{info.format}</Badge>
          <h2>{info.name}</h2>
          {[
            ["游戏版本", info.version],
            ["加载器", info.loader],
            ["资源数量", String(info.count)],
          ].map(([k, v]) => (
            <div className="kv" key={k}>
              <span>{k}</span>
              <b>{v}</b>
            </div>
          ))}
          <Field label="新实例名称">
            <Input value={name} onChange={(e) => N(e.target.value)} />
          </Field>
          <p className="muted">
            安装到独立的新实例目录，失败会清理未完成实例。
          </p>
        </>
      ) : (
        <p>正在读取包清单…</p>
      )}
      {error && <div className="notice error">{error}</div>}
    </Modal>
  );
}
function Export({ id }: { id?: string }) {
  const s = useStore();
  const [format, setFormat] = useState("mrpack");
  const [include, I] = useState(["mods", "config"]);
  const [busy, B] = useState(false);
  return (
    <Modal
      title="导出整合包"
      footer={
        <>
          <Button onClick={s.hide}>取消</Button>
          <Button
            primary
            busy={busy}
            onClick={() =>
              guarded(async () => {
                const path = await saveFile(
                  format === "mrpack"
                    ? "Minecraft-modpack.mrpack"
                    : "Minecraft-modpack.zip",
                );
                if (!path) return;
                B(true);
                try {
                  await api("export_pack", {
                    id: id ?? s.selected,
                    path,
                    include,
                    format,
                  });
                  s.hide();
                  s.notify("整合包已导出");
                } finally {
                  B(false);
                }
              })
            }
          >
            选择位置并导出
          </Button>
        </>
      }
    >
      <p>选择你要分享的内容。账号、访问令牌和启动日志不会包含在包中。</p>
      <div className="export-checks">
        {[
          ["mods", "Mod"],
          ["config", "配置"],
          ["saves", "存档"],
          ["resourcepacks", "资源包"],
          ["shaderpacks", "光影"],
          ["datapacks", "数据包"],
        ].map(([v, t]) => (
          <label key={v}>
            <input
              type="checkbox"
              checked={include.includes(v)}
              onChange={() =>
                I((a) => (a.includes(v) ? a.filter((x) => x !== v) : [...a, v]))
              }
            />
            {t}
          </label>
        ))}
      </div>
      <Field label="格式">
        <ChoiceSelect
          className="input"
          aria-label="整合包导出格式"
          value={format}
          onValueChange={(selectedValue) => setFormat(selectedValue)}
        >
          <option value="mrpack">
            Modrinth MRPACK（推荐，主流启动器通用）
          </option>
          <option value="universal">
            通用 ZIP（Modrinth + CurseForge 双清单）
          </option>
          <option value="curseforge">CurseForge ZIP</option>
          <option value="multimc">MultiMC / Prism ZIP</option>
          <option value="kynex">KXL ZIP（旧版兼容）</option>
        </ChoiceSelect>
        <small>
          MRPACK、CurseForge 和 MultiMC
          使用对应的标准目录结构，可在支持该格式的启动器中导入。
        </small>
      </Field>
      <div className="notice">
        导出包包含所选目录中的文件，分享前请检查模组分发许可与存档隐私。
      </div>
    </Modal>
  );
}
function RemoveInstance({ id }: { id: string }) {
  const s = useStore();
  const instance = s.instances.find((i) => i.id === id);
  return (
    <Modal
      title="删除版本"
      footer={
        <>
          <Button onClick={s.hide}>取消</Button>
          <Button
            primary
            onClick={() =>
              guarded(async () => {
                await api("delete_instance", { id });
                await s.refresh();
                s.hide();
                s.notify(`已删除 ${instance?.name ?? "版本"}`);
              })
            }
          >
            删除版本
          </Button>
        </>
      }
    >
      <p>
        删除 {instance?.name ?? "这个版本"} 的整个实例目录，包括其中的
        Mod、资源包、存档和配置，且无法恢复。
      </p>
      <div className="notice">
        账号资料、共享目录和其他实例不会被删除。正在运行的游戏需要先退出。
      </div>
    </Modal>
  );
}
function RemoveAccount({ id }: { id: string }) {
  const s = useStore();
  return (
    <Modal
      title="移除账号"
      footer={
        <>
          <Button onClick={s.hide}>取消</Button>
          <Button
            primary
            onClick={() =>
              guarded(async () => {
                await api("delete_account", { id });
                await s.refresh();
                s.hide();
              })
            }
          >
            移除
          </Button>
        </>
      }
    >
      <p>
        移除 {s.accounts.find((a) => a.id === id)?.name}{" "}
        的本地账号记录及系统保存的登录凭据？游戏与存档会保留。
      </p>
    </Modal>
  );
}
