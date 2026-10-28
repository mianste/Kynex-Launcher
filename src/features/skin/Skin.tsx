import { ChoiceSelect } from "../../components/ui/ChoiceSelect";
/** Wardrobe composition references Amethyst SkinHero/WardrobeStrip and XMCL UserSkin (MIT). */
import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import {
  Plus,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Download,
  Check,
  Layers,
  ArrowLeft,
  ArrowRight,
  Search,
  Pencil,
  Trash2,
  Shirt,
} from "lucide-react";
import { Button, Tabs, Switch, Modal, Input, Field } from "../../components/ui";
import { MotionPresence } from "../../components/ui/Motion";
import { api, desktop, pickImageFile } from "../../lib/bridge";
import { defaultSkin } from "./textures";
import {
  MinecraftViewer,
  FlatSkin,
  type ViewerHandle,
  type SkinMotion,
} from "./SkinViewer";
import { SkinSprite } from "./SkinSprite";
import { SkinImport } from "./SkinImport";
import { useWardrobe } from "./useWardrobe";
import { decodeCape } from "./cape";
import { sameAppearance } from "./wardrobeState";
import type { LocalSkin } from "./library";
export { defaultSkin } from "./textures";
export function Skin() {
  const w = useWardrobe(),
    viewer = useRef<ViewerHandle>(null),
    capeInput = useRef<HTMLInputElement>(null);
  const [mode, Mode] = useState<"3D" | "2D">("3D"),
    [unavailable, Unavailable] = useState(false),
    [loaded, Loaded] = useState(false),
    [renderError, RenderError] = useState("");
  const [section, Section] = useState("模型"),
    [motion, Motion] = useState<SkinMotion>("站立"),
    [rotate, Rotate] = useState(true),
    [outer, Outer] = useState(true);
  const [capeOn, CapeOn] = useState(false),
    [customCape, CustomCape] = useState<HTMLCanvasElement | null>(null),
    [equipment, Equipment] = useState<"cape" | "elytra">("cape");
  const [importOpen, ImportOpen] = useState(false),
    [dropped, Dropped] = useState<File>(),
    [drag, Drag] = useState(false),
    [query, Query] = useState(""),
    [edit, Edit] = useState<LocalSkin | null>(null),
    [editError, EditError] = useState(""),
    [deleting, Deleting] = useState(false);
  const [manualModel, ManualModel] = useState(false);
  const [detectedModel, DetectedModel] = useState(w.selected.model);
  useEffect(() => {
    DetectedModel(w.selected.model);
    ManualModel(false);
  }, [w.selected.texture, w.account?.id]);
  useEffect(() => {
    if (!desktop) return;
    const nativeDrop = (raw: Event) => {
      const detail = (raw as CustomEvent).detail as
        | { type: "enter" | "over" | "leave" }
        | { type: "drop"; paths: string[] };
      if (detail.type === "enter" || detail.type === "over") Drag(true);
      else if (detail.type === "leave") Drag(false);
      else if (detail.type === "drop") {
        Drag(false);
        const path = detail.paths[0];
        if (!path || !/\.png$/i.test(path)) return;
        void api<{ name: string; mime: string; base64: string }>("read_image", {
          path,
          maxBytes: 5 * 1024 * 1024,
        })
          .then((image) => {
            const bytes = Uint8Array.from(atob(image.base64), (char) =>
              char.charCodeAt(0),
            );
            Dropped(new File([bytes], image.name, { type: image.mime }));
            ImportOpen(true);
          })
          .catch((error) => RenderError(String(error).replace(/^Error: /, "")));
      }
    };
    window.addEventListener("kynex-native-drag", nativeDrop);
    return () => window.removeEventListener("kynex-native-drag", nativeDrop);
  }, []);
  const defaultEntry = useMemo<LocalSkin>(
    () => ({
      id: "default",
      name: "Steve",
      texture: defaultSkin(),
      model: "Classic",
    }),
    [],
  );
  const capeCanvas = useMemo(
    () => (capeOn ? customCape : null),
    [capeOn, customCape],
  );
  const fail = useCallback(() => {
      Unavailable(true);
      Mode("2D");
    }, []),
    ready = useCallback(() => Loaded(true), []),
    imageError = useCallback((s: string) => RenderError(s), []);
  const entries = [defaultEntry, ...w.skins].filter((e) =>
    e.name.toLowerCase().includes(query.toLowerCase()),
  );
  function select(entry: LocalSkin) {
    ManualModel(false);
    DetectedModel(entry.model);
    RenderError("");
    w.select(entry);
  }
  function openImport() {
    Dropped(undefined);
    ImportOpen(true);
  }
  async function capeFile(file: File) {
    try {
      CustomCape(await decodeCape(file));
      CapeOn(true);
      RenderError("");
    } catch (e) {
      RenderError(String(e).replace(/^Error: /, ""));
    }
  }
  function chooseCape() {
    if (!desktop) {
      capeInput.current?.click();
      return;
    }
    void (async () => {
      try {
        const file = await pickImageFile("skin");
        if (file) await capeFile(file);
      } catch (e) {
        RenderError(String(e));
      }
    })();
  }
  function exportSkin() {
    const a = document.createElement("a");
    a.href = w.selected.texture;
    a.download = "KXL-skin.png";
    a.click();
  }
  const saved = w.skins.some((x) => x.id === w.selected.id);
  return (
    <div className="wardrobe-page">
      <div className="page-head">
        <div>
          <h1>皮肤</h1>
          <p>查看、导入和管理你的 Minecraft 皮肤。</p>
        </div>
        <Button primary onClick={openImport}>
          <Plus size={16} />
          导入皮肤
        </Button>
      </div>
      <section className="wardrobe-studio">
        <div className="wardrobe-stage-wrap">
          <header className="wardrobe-stage-top">
            <span>
              <i className={unavailable ? "muted" : "live"} />
              {mode === "3D" ? "3D 预览" : "2D 预览"}
              <small>像素清晰</small>
            </span>
            <div role="tablist" aria-label="预览模式">
              {(["3D", "2D"] as const).map((v) => (
                <button
                  role="tab"
                  aria-selected={mode === v}
                  disabled={v === "3D" && unavailable}
                  className={mode === v ? "on" : ""}
                  key={v}
                  onClick={() => Mode(v)}
                >
                  {v}
                </button>
              ))}
            </div>
          </header>
          <div
            className={"wardrobe-stage" + (drag ? " is-dragging" : "")}
            data-viewer-status={
              unavailable ? "fallback" : loaded ? "ready" : "loading"
            }
            onDragOver={(e) => {
              e.preventDefault();
              Drag(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node))
                Drag(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              Drag(false);
              const file = e.dataTransfer.files[0];
              if (file) {
                Dropped(file);
                ImportOpen(true);
              }
            }}
          >
            <div className="wardrobe-halo" />
            <div className="wardrobe-floor" />
            <MinecraftViewer
              ref={viewer}
              texture={w.selected.texture}
              model={w.selected.model}
              motion={motion}
              rotate={rotate}
              outer={outer}
              cape={capeCanvas}
              equipment={equipment}
              zoom={0.85}
              mode={mode}
              onUnavailable={fail}
              onLoaded={ready}
              onError={imageError}
            />
            {mode === "2D" && (
              <FlatSkin
                texture={w.selected.texture}
                slim={w.selected.model === "Slim"}
                outer={outer}
              />
            )}
            {!loaded && !unavailable && (
              <span className="wardrobe-loading">正在加载皮肤…</span>
            )}
            {drag && (
              <div className="wardrobe-drop-overlay">
                <Plus size={30} />
                <b>松开鼠标导入皮肤</b>
              </div>
            )}
            <div className="wardrobe-camera">
              <button
                aria-label="缩小"
                title="缩小"
                disabled={mode === "2D"}
                onClick={() => viewer.current?.magnify(1.14)}
              >
                <ZoomOut size={17} />
              </button>
              <button
                aria-label="放大"
                title="放大"
                disabled={mode === "2D"}
                onClick={() => viewer.current?.magnify(1 / 1.14)}
              >
                <ZoomIn size={17} />
              </button>
              <span />
              <button
                aria-label="重置皮肤视角"
                title="重置视角"
                disabled={mode === "2D"}
                onClick={() => viewer.current?.reset()}
              >
                <RotateCcw size={17} />
              </button>
            </div>
            <div className="wardrobe-front-back">
              <button
                disabled={mode === "2D"}
                onClick={() => viewer.current?.face(false)}
              >
                <ArrowLeft size={13} />
                正面
              </button>
              <button
                disabled={mode === "2D"}
                onClick={() => viewer.current?.face(true)}
              >
                背面
                <ArrowRight size={13} />
              </button>
            </div>
          </div>
          <footer className="wardrobe-stage-bottom">
            <span>
              {mode === "3D" ? "拖动旋转　 /　 滚轮缩放" : "2D 预览 · 正反两面"}
            </span>
            <span>支持触控</span>
          </footer>
        </div>
        <aside className="wardrobe-inspector">
          <div className="wardrobe-current">
            <span className="wardrobe-eyebrow">
              {w.dirty ? "预览中 · 尚未应用" : "当前皮肤"}
            </span>
            <h2 title={w.selected.name}>{w.selected.name}</h2>
            <p className="wardrobe-model-tip">
              {w.selected.model} ·{" "}
              {w.selected.model === "Slim" ? "三像素细臂" : "四像素宽臂"}
            </p>
            <span className="wardrobe-account">
              {w.account?.name ?? "本地预览"}
              {w.account?.kind === "microsoft" ? " · 正版账号" : " · 本地皮肤"}
            </span>
          </div>
          <div className="wardrobe-settings">
            <Tabs
              items={["模型", "披风", "动画"]}
              value={section}
              onChange={Section}
            />
            <div className="wardrobe-setting-panel">
              {section === "模型" && (
                <>
                  <h3>模型设置</h3>
                  <p>导入时自动识别模型，也可手动调整。</p>
                  <Tabs
                    items={["自动", "Classic", "Slim"]}
                    value={manualModel ? w.selected.model : "自动"}
                    onChange={(m) => {
                      ManualModel(m !== "自动");
                      w.setModel(
                        m === "自动"
                          ? detectedModel
                          : (m as LocalSkin["model"]),
                      );
                    }}
                  />
                  <div className="wardrobe-setting-row">
                    <span>
                      <Layers size={15} />
                      皮肤外层<small>帽子、外套与衣袖第二层</small>
                    </span>
                    <Switch label="显示皮肤外层" on={outer} change={Outer} />
                  </div>
                  <div className="wardrobe-mini-note">
                    最近邻采样
                    <br />
                    高清皮肤保留原始纹素。
                  </div>
                </>
              )}
              {section === "披风" && (
                <>
                  <div className="wardrobe-setting-row">
                    <span>
                      显示披风<small>仅用于本地预览</small>
                    </span>
                    <Switch
                      label="显示披风"
                      on={capeOn}
                      change={(on) => {
                        if (on && !customCape) {
                          chooseCape();
                          return;
                        }
                        CapeOn(on);
                      }}
                    />
                  </div>
                  <Tabs
                    items={["披风", "鞘翅"]}
                    value={equipment === "cape" ? "披风" : "鞘翅"}
                    onChange={(v) =>
                      Equipment(v === "披风" ? "cape" : "elytra")
                    }
                  />
                  <p>
                    {customCape
                      ? "已加载你导入的披风"
                      : "未导入披风。请选择披风 PNG 文件。"}
                  </p>
                  <Button onClick={chooseCape}>导入披风 PNG</Button>
                  <small>披风和鞘翅使用同一张贴图，仅用于本地预览。</small>
                </>
              )}
              {section === "动画" && (
                <>
                  <div className="wardrobe-setting-row">
                    <span>
                      自动旋转<small>停止操作 3 秒后自动旋转</small>
                    </span>
                    <Switch label="自动旋转" on={rotate} change={Rotate} />
                  </div>
                  <Field label="预览动作">
                    <ChoiceSelect
                      className="input"
                      aria-label="预览动作"
                      value={motion}
                      onValueChange={(selectedValue) => Motion(selectedValue as SkinMotion)}
                    >
                      {["站立", "行走", "奔跑", "飞行", "静止"].map((n) => (
                        <option key={n} value={n}>
                          {n === "站立" ? "待机" : n}
                        </option>
                      ))}
                    </ChoiceSelect>
                  </Field>
                  <small>
                    遵循系统“减少动态效果”设置。触碰预览即暂停自转。
                  </small>
                </>
              )}
            </div>
          </div>
          <div className="wardrobe-apply">
            <p>
              {w.account?.kind === "microsoft"
                ? "标准皮肤可更新正版档案；HD 仅本地预览。"
                : "应用到本地预览；正版换肤需使用微软账号。"}
            </p>
            <Button
              primary
              busy={w.applying}
              disabled={!w.dirty}
              onClick={() => void w.apply()}
            >
              <Check size={16} />
              {w.dirty ? "应用皮肤" : "已应用"}
            </Button>
            <div>
              <button disabled={!w.dirty || w.applying} onClick={w.reset}>
                还原皮肤
              </button>
              <button onClick={exportSkin}>
                <Download size={13} />
                导出 PNG
              </button>
            </div>
          </div>
        </aside>
      </section>
      {unavailable && (
        <p className="wardrobe-fallback-note" role="status">
          当前设备不支持 WebGL，已切换到 2D 预览。仍可导入皮肤和切换模型。
        </p>
      )}
      {(w.error || renderError) && (
        <div role="alert" className="notice error">
          {w.error || renderError}
        </div>
      )}
      <section className="wardrobe-library">
        <header>
          <div>
            <Shirt size={17} />
            <h3>我的皮肤</h3>
            <span>{w.skins.length} / 24</span>
          </div>
          <label className="wardrobe-search">
            <Search size={14} />
            <input
              aria-label="搜索皮肤"
              placeholder="搜索皮肤…"
              value={query}
              onChange={(e) => Query(e.target.value)}
            />
          </label>
        </header>
        <div className="wardrobe-strip">
          <button className="wardrobe-add" onClick={openImport}>
            <Plus size={24} />
            <span>添加皮肤</span>
          </button>
          {entries.map((entry) => (
            <div
              className={
                "wardrobe-card" +
                (sameAppearance(entry, w.selected) ? " selected" : "")
              }
              key={entry.id}
            >
              <button
                className="wardrobe-card-select"
                aria-label={"预览 " + entry.name}
                aria-pressed={sameAppearance(entry, w.selected)}
                onClick={() => select(entry)}
              >
                <div className="wardrobe-card-scene">
                  <SkinSprite texture={entry.texture} model={entry.model} />
                  {sameAppearance(entry, w.equipped) && (
                    <span className="wardrobe-wearing">
                      <Check size={10} />
                      已应用
                    </span>
                  )}
                </div>
                <strong>{entry.name}</strong>
                <small>{entry.model}</small>
              </button>
              {entry.id !== "default" && (
                <button
                  className="wardrobe-edit"
                  title={"编辑 " + entry.name}
                  aria-label={"编辑 " + entry.name}
                  onClick={() => {
                    Edit({ ...entry });
                    EditError("");
                    Deleting(false);
                  }}
                >
                  <Pencil size={12} />
                </button>
              )}
            </div>
          ))}
          {entries.length === 0 && (
            <p className="wardrobe-empty">没有找到匹配的皮肤。</p>
          )}
        </div>
      </section>
      <MotionPresence>
        {importOpen && (
          <SkinImport
            initial={dropped}
            onClose={() => ImportOpen(false)}
            onSave={(entry) => {
              w.save(entry);
              ManualModel(false);
              DetectedModel(entry.model);
              ImportOpen(false);
              RenderError("");
            }}
          />
        )}
      </MotionPresence>
      <MotionPresence>
        {edit && (
          <Modal
            title="编辑皮肤"
            onClose={() => Edit(null)}
            footer={
              <>
                <Button onClick={() => Edit(null)}>取消</Button>
                <Button
                  primary
                  onClick={() => {
                    try {
                      w.rename(edit.id, edit.name);
                      Edit(null);
                    } catch (e) {
                      EditError(String(e).replace(/^Error: /, ""));
                    }
                  }}
                >
                  保存名称
                </Button>
              </>
            }
          >
            <div className="wardrobe-import-result">
              <div className="wardrobe-import-sprite">
                <SkinSprite texture={edit.texture} model={edit.model} />
              </div>
              <Field label="皮肤名称">
                <Input
                  aria-label="皮肤名称"
                  maxLength={32}
                  value={edit.name}
                  onChange={(e) => Edit({ ...edit, name: e.target.value })}
                />
              </Field>
            </div>
            {editError && <p role="alert">{editError}</p>}
            <div className="wardrobe-delete">
              {deleting ? (
                <>
                  <span>确定删除这个保存的皮肤？</span>
                  <Button onClick={() => Deleting(false)}>保留</Button>
                  <Button
                    onClick={() => {
                      w.remove(edit.id);
                      Edit(null);
                    }}
                  >
                    确认移除
                  </Button>
                </>
              ) : (
                <button onClick={() => Deleting(true)}>
                  <Trash2 size={14} />
                  删除皮肤
                </button>
              )}
            </div>
          </Modal>
        )}
      </MotionPresence>
      <input
        hidden
        ref={capeInput}
        type="file"
        accept="image/png"
        aria-label="上传 PNG 披风"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void capeFile(f);
          e.target.value = "";
        }}
      />
      {saved && <span className="sr-only">当前预览来自我的皮肤</span>}
    </div>
  );
}
