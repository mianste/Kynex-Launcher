import type { LocalSkin } from "./library";
export function sameAppearance(
  a: Pick<LocalSkin, "texture" | "model">,
  b: Pick<LocalSkin, "texture" | "model">,
): boolean {
  return a.texture === b.texture && a.model === b.model;
}
export function putSkin(items: LocalSkin[], entry: LocalSkin): LocalSkin[] {
  return [
    entry,
    ...items.filter((x) => x.id !== entry.id && !sameAppearance(x, entry)),
  ].slice(0, 24);
}
export function nameSkin(
  items: LocalSkin[],
  id: string,
  name: string,
): LocalSkin[] {
  const value = name.trim();
  if (!value || value.length > 32) throw new Error("皮肤名称需要 1–32 个字符");
  return items.map((x) => (x.id === id ? { ...x, name: value } : x));
}
