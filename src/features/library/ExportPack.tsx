import { useEffect, useState } from "react";
import { PackageOpen, RotateCcw } from "lucide-react";
import { Button, ChoiceSelect, Field, Input, Modal } from "../../components/ui";
import { api, readableSize, saveFile } from "../../lib/bridge";
import { useStore } from "../../store";
import "./exportPack.css";
type Group = { id: string; label: string; description: string; parent: string; defaultChecked: boolean; items: { path: string; name: string; dir: boolean; size?: number }[] };
type Options = { instance: { name: string; version: string; loader: string; loaderVersion?: string; optifineVersion?: string }; groups: Group[] };
export function ExportPack({ id }: { id?: string }) {
  const s = useStore();
  const instanceId = id ?? s.selected;
  const [options, Options] = useState<Options | null>(null);
  const [selected, Selected] = useState<string[]>([]);
  const [choices, Choices] = useState<Record<string, string[]>>({});
  const [format, Format] = useState("mrpack");
  const [name, Name] = useState("");
  const [version, Version] = useState("1.0.0");
  const [bundle, Bundle] = useState(false);
  const [busy, Busy] = useState(false);
  const [error, ErrorText] = useState("");
  const [retry, Retry] = useState(0);
  function defaults(value: Options) {
    Selected(value.groups.filter((g) => g.defaultChecked).map((g) => g.id));
    Choices(Object.fromEntries(value.groups.map((g) => [g.id, g.items.map((f) => f.path)])));
    Bundle(false);
  }
  useEffect(() => {
    let live = true; Options(null); ErrorText("");
    void api<Options>("export_options", { id: instanceId }).then((value) => {
      if (!live) return;
      Options(value); Name(value.instance.name); defaults(value);
      if (value.instance.loader === "optifine" || value.instance.optifineVersion) Format("kynex");
    }).catch((e) => { if (live) ErrorText(String(e)); });
    return () => { live = false; };
  }, [instanceId, retry]);
  const enabled = (group: Group) => selected.includes(group.id) && (!group.parent || !options?.groups.some((g) => g.id === group.parent) || selected.includes(group.parent));
  const requiresKxl = options?.instance.loader === "optifine" || !!options?.instance.optifineVersion;
  async function exportPack() {
    if (!options || busy) return;
    const packName = name.trim() || options.instance.name;
    const packVersion = version.trim() || "1.0.0";
    const stem = `${packName}-${packVersion}`.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-");
    const extension = format === "mrpack" ? "mrpack" : "zip";
    const target = await saveFile(`${stem}.${extension}`, [{ name: format === "mrpack" ? "Modrinth 整合包" : "整合包 ZIP", extensions: [extension] }]);
    if (!target) return;
    const path = target.toLowerCase().endsWith(`.${extension}`) ? target : `${target}.${extension}`;
    Busy(true); ErrorText("");
    try {
      const result = await api<{ path: string; files: number; onlineFiles: number; embeddedFiles: number; warnings: string[] }>("export_pack", {
        id: instanceId, path, name: packName, packVersion, format, selectionVersion: 1,
        include: options.groups.filter(enabled).map((g) => g.id), choices,
        bundleResources: format !== "mrpack" || bundle,
      });
      s.hide(); s.notify(`整合包已导出：${result.files} 个文件，${result.onlineFiles} 个按清单下载${result.warnings.length ? "；部分来源未确认的资源已直接打包" : ""}`);
    } catch (e) { ErrorText(String(e)); }
    finally { Busy(false); }
  }
  return <Modal title="导出整合包" wide className="export-pack-dialog" footer={<>
    <Button onClick={s.hide}>{busy ? "转到后台" : "取消"}</Button>
    <Button primary busy={busy} disabled={!options || requiresKxl && format !== "kynex"} onClick={() => void exportPack()}><PackageOpen size={16} />开始导出</Button>
  </>}>
    {options ? <>
      <div className="export-metadata">
        <Field label="整合包名称"><Input aria-label="整合包名称" maxLength={100} value={name} disabled={busy} onChange={(e) => Name(e.target.value)} /></Field>
        <Field label="整合包版本"><Input aria-label="整合包版本" maxLength={100} value={version} disabled={busy} onChange={(e) => Version(e.target.value)} /></Field>
      </div>
      <section className="export-options" aria-label="导出内容">
        <div className="export-options-heading"><b>导出内容</b><Button disabled={busy} onClick={() => defaults(options)}><RotateCcw size={13} />重置</Button></div>
        <label className="export-option"><input type="checkbox" checked disabled /><span>游戏本体</span><small>Minecraft {options.instance.version}{options.instance.loader !== "vanilla" ? ` · ${options.instance.loader} ${options.instance.loaderVersion ?? ""}` : " · 原版"}</small></label>
        <small className="export-game-hint">保留游戏及加载器版本信息，导入时安装对应版本。</small>
        {options.groups.map((group) => {
          const parentOff = !!group.parent && options.groups.some((g) => g.id === group.parent) && !selected.includes(group.parent);
          if (parentOff) return null;
          return <div className={group.parent || group.id === "options" ? "export-child" : "export-group"} key={group.id}>
            <label className="export-option"><input type="checkbox" aria-label={`导出${group.label}`} checked={selected.includes(group.id)} disabled={busy}
              onChange={() => Selected((before) => before.includes(group.id) ? before.filter((v) => v !== group.id) : [...before, group.id])} />
              <span>{group.label}</span><small>{group.description}</small>
            </label>
            {enabled(group) && <details className="export-file-options" open={["resourcepacks", "shaderpacks", "saves", "datapacks"].includes(group.id)}>
              <summary>选择具体内容（已选 {choices[group.id]?.length ?? 0} / {group.items.length}）</summary>
              <div>{group.items.map((file) => <label className="export-option" key={file.path}>
                <input type="checkbox" aria-label={`导出文件 ${file.path}`} checked={choices[group.id]?.includes(file.path) ?? false} disabled={busy} onChange={() => Choices((before) => ({ ...before,
                  [group.id]: before[group.id]?.includes(file.path) ? before[group.id].filter((v) => v !== file.path) : [...before[group.id] ?? [], file.path],
                }))} />
                <span title={file.path}>{file.name}</span><small>{file.dir ? "文件夹" : file.size !== undefined ? readableSize(file.size) : ""}</small>
              </label>)}</div>
            </details>}
          </div>;
        })}
      </section>
      {(options.instance.loader === "optifine" || options.instance.optifineVersion) && <p className="notice">此实例含 OptiFine，请使用 KXL ZIP 保留完整加载器配置。</p>}
      <details className="export-advanced" open>
        <summary>高级选项</summary>
        <Field label="导出格式"><ChoiceSelect className="input" aria-label="整合包导出格式" value={format} disabled={busy} onValueChange={Format}>
          <option value="mrpack" disabled={requiresKxl}>Modrinth MRPACK（推荐）</option><option value="universal" disabled={requiresKxl}>通用 ZIP（双清单）</option>
          <option value="curseforge" disabled={requiresKxl}>CurseForge ZIP</option><option value="multimc" disabled={requiresKxl}>MultiMC / Prism ZIP</option><option value="kynex">KXL ZIP</option>
        </ChoiceSelect></Field>
        <label className="export-option"><input type="checkbox" aria-label="打包资源文件" checked={format !== "mrpack" || bundle} disabled={busy || format !== "mrpack"} onChange={(e) => Bundle(e.target.checked)} />
          <span>打包资源文件，以避免导入时再次下载这些文件</span></label>
        <p className="muted">{format === "mrpack" && !bundle ? "按文件哈希确认 Modrinth 托管资源并生成下载清单，未识别的文件直接打包。" : "直接包含所选模组和资源文件；Minecraft 本体与加载器仍按清单安装。"}</p>
        <p className="muted">地图、JEI 个人信息及存档默认不选。分享前请检查所选配置与资源的分发许可。</p>
      </details>
    </> : !error ? <p role="status">正在读取此实例可导出的内容…</p> : null}
    {!!error && <div className="notice error" role="alert">{error}{!options && <Button onClick={() => Retry((v) => v + 1)}>重试</Button>}</div>}
  </Modal>;
}
