import { useEffect, useRef, useState } from "react";
import { Upload, Link2, Search } from "lucide-react";
import { Button, Modal, Tabs, Field, Input } from "../../components/ui";
import { desktop, pickImageFile } from "../../lib/bridge";
import { decodeSkin, importRemote } from "./skinIO";
import { SkinSprite } from "./SkinSprite";
import type { LocalSkin } from "./library";
/** XMCL UserSkin's import → modified → save flow, adapted to React and a local wardrobe. */
export function SkinImport({
  initial,
  onClose,
  onSave,
}: {
  initial?: File;
  onClose: () => void;
  onSave: (entry: LocalSkin) => void;
}) {
  const [tab, Tab] = useState("本地文件"),
    [value, Value] = useState(""),
    [draft, Draft] = useState<LocalSkin | null>(null),
    [busy, Busy] = useState(false),
    [error, ErrorText] = useState("");
  const input = useRef<HTMLInputElement>(null),
    request = useRef<AbortController>(),
    sequence = useRef(0);
  async function enter(loader: (signal: AbortSignal) => Promise<LocalSkin>) {
    request.current?.abort();
    const c = new AbortController();
    request.current = c;
    const id = ++sequence.current;
    Busy(true);
    ErrorText("");
    try {
      const entry = await loader(c.signal);
      if (id === sequence.current && !c.signal.aborted) Draft(entry);
    } catch (e) {
      if (
        id === sequence.current &&
        !c.signal.aborted &&
        !(e instanceof DOMException && e.name === "AbortError")
      )
        ErrorText(String(e).replace(/^Error: /, ""));
    } finally {
      if (id === sequence.current) Busy(false);
    }
  }
  useEffect(() => {
    if (initial) void enter(() => decodeSkin(initial));
    return () => {
      sequence.current++;
      request.current?.abort();
    };
  }, []);
  function choose() {
    if (!desktop) {
      input.current?.click();
      return;
    }
    void enter(async () => {
      const f = await pickImageFile("skin");
      if (!f) throw new DOMException("取消", "AbortError");
      return decodeSkin(f);
    });
  }
  return (
    <Modal
      title="导入皮肤"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button
            primary
            busy={busy}
            disabled={!draft || !draft.name.trim()}
            onClick={() => {
              try {
                if (draft) onSave(draft);
              } catch (e) {
                ErrorText(String(e).replace(/^Error: /, ""));
              }
            }}
          >
            保存并预览
          </Button>
        </>
      }
    >
      <Tabs
        items={["本地文件", "图片链接", "玩家用户名"]}
        value={tab}
        onChange={(v) => {
          Tab(v);
          Value("");
          ErrorText("");
        }}
      />
      {tab === "本地文件" ? (
        <button className="wardrobe-dropzone" onClick={choose}>
          <Upload size={26} />
          <b>选择 PNG 皮肤</b>
          <span>也可直接拖入主预览区</span>
          <small>64×64 / 64×32 / HD 至 1024 · 最大 5 MB</small>
        </button>
      ) : (
        <div className="wardrobe-remote">
          <Field
            label={
              tab === "图片链接" ? "PNG 图片直链" : "Minecraft Java 玩家名"
            }
          >
            <Input
              aria-label={
                tab === "图片链接" ? "皮肤图片 URL" : "皮肤玩家用户名"
              }
              placeholder={tab === "图片链接" ? "https://…/skin.png" : "Notch"}
              value={value}
              onChange={(e) => Value(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && value.trim() && !busy)
                  void enter((signal) =>
                    importRemote(
                      tab === "图片链接" ? "url" : "username",
                      value,
                      signal,
                    ),
                  );
              }}
            />
          </Field>
          <Button
            busy={busy}
            disabled={!value.trim()}
            onClick={() =>
              void enter((signal) =>
                importRemote(
                  tab === "图片链接" ? "url" : "username",
                  value,
                  signal,
                ),
              )
            }
          >
            {tab === "图片链接" ? <Link2 size={15} /> : <Search size={15} />}
            导入皮肤
          </Button>
        </div>
      )}
      {draft && (
        <div className="wardrobe-import-result">
          <div className="wardrobe-import-sprite">
            <SkinSprite texture={draft.texture} model={draft.model} />
          </div>
          <div>
            <Field label="皮肤名称">
              <Input
                aria-label="皮肤名称"
                maxLength={32}
                value={draft.name}
                onChange={(e) => Draft({ ...draft, name: e.target.value })}
              />
            </Field>
            <Field label="模型已自动识别，也可手动选择">
              <Tabs
                items={["Classic", "Slim"]}
                value={draft.model}
                onChange={(m) =>
                  Draft({ ...draft, model: m as LocalSkin["model"] })
                }
              />
            </Field>
            <small>保存后先预览，点击应用才会更换皮肤。</small>
          </div>
        </div>
      )}
      {busy && <p role="status">正在下载皮肤…</p>}
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      <input
        hidden
        ref={input}
        type="file"
        accept="image/png"
        aria-label="上传 PNG 皮肤"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void enter(() => decodeSkin(file));
          e.target.value = "";
        }}
      />
    </Modal>
  );
}
