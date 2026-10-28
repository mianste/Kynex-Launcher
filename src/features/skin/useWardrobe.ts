/** Try-on/equipped separation informed by Amethyst SkinsPage.tsx (MIT, 3aiya) and XMCL UserSkin.vue (MIT, ci010). See docs/SKIN-REFERENCE.md. */
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../../store";
import { api, desktop } from "../../lib/bridge";
import { defaultSkin } from "./textures";
import { readLocalSkins, saveLocalSkins, type LocalSkin } from "./library";
import { nameSkin, putSkin, sameAppearance } from "./wardrobeState";
export function useWardrobe() {
  const s = useStore(),
    account = s.accounts.find((x) => x.id === s.accountId);
  const ownsPreview = s.skinAccountId === (account?.id ?? "");
  const base = useMemo<LocalSkin>(
    () => ({
      id: "equipped",
      name: account?.name ? account.name + " 的皮肤" : "当前预览",
      texture: ownsPreview && s.skin ? s.skin : account?.skin || defaultSkin(),
      model:
        ownsPreview && s.skin ? s.skinModel : (account?.skinModel ?? "Classic"),
    }),
    [account?.id, account?.skin, account?.skinModel, s.skin, s.skinModel, s.skinAccountId],
  );
  const [skins, Skins] = useState(readLocalSkins),
    [equipped, Equipped] = useState<LocalSkin>(base),
    [selected, Selected] = useState<LocalSkin>(base);
  const [applying, Applying] = useState(false),
    [error, ErrorText] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    Equipped(base);
    Selected(base);
    ErrorText("");
  }, [base]);
  function commit(items: LocalSkin[]) {
    saveLocalSkins(items);
    Skins(items);
  }
  function select(entry: LocalSkin) {
    Selected({ ...entry });
    ErrorText("");
  }
  function save(entry: LocalSkin) {
    const clean = { ...entry, name: entry.name.trim() };
    if (!clean.name) throw new Error("请输入皮肤名称");
    commit(putSkin(skins, clean));
    select(clean);
  }
  function rename(id: string, name: string) {
    const items = nameSkin(skins, id, name);
    commit(items);
    if (selected.id === id) Selected((v) => ({ ...v, name: name.trim() }));
  }
  function remove(id: string) {
    commit(skins.filter((x) => x.id !== id));
    if (selected.id === id) Selected(equipped);
  }
  const dirty =
    !sameAppearance(selected, equipped) || (!!account && !account.skin);
  async function apply() {
    if (!dirty || applying) return;
    const entry = { ...selected },
      id = s.accountId;
    Applying(true);
    ErrorText("");
    try {
      const image = new Image();
      image.src = entry.texture;
      await image.decode();
      let remote = false;
      if (desktop && id && image.width === 64) {
        const r = await api<{ remote: boolean }>("apply_skin", {
          accountId: id,
          texture: entry.texture,
          model: entry.model,
        });
        remote = r.remote;
        await useStore.getState().refresh();
      }
      if (useStore.getState().accountId === id) {
        useStore.setState({
          skin: entry.texture,
          skinModel: entry.model,
          skinAccountId: id,
        });
        if (mounted.current) Equipped(entry);
      }
      s.notify(
        remote
          ? "已更新正版账号皮肤"
          : image.width !== 64
            ? "高清皮肤已应用到本地预览"
            : "皮肤已应用到本地预览",
      );
    } catch (e) {
      if (mounted.current) ErrorText(String(e).replace(/^Error: /, ""));
    } finally {
      if (mounted.current) Applying(false);
    }
  }
  return {
    skins,
    selected,
    equipped,
    dirty,
    applying,
    error,
    account,
    select,
    save,
    rename,
    remove,
    apply,
    reset: () => {
      Selected(equipped);
      ErrorText("");
    },
    setModel: (model: LocalSkin["model"]) => Selected((v) => ({ ...v, model })),
  };
}
