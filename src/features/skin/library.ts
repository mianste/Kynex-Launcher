export interface LocalSkin {
  id: string;
  name: string;
  texture: string;
  model: "Classic" | "Slim";
}
export function readLocalSkins(): LocalSkin[] {
  try {
    const items = JSON.parse(
      localStorage.getItem("kynex-skins") ?? "[]",
    ) as unknown[];
    return items
      .flatMap((v, n) => {
        if (typeof v === "string")
          return [
            {
              id: "legacy-" + n,
              name: "本地皮肤 " + (n + 1),
              texture: v,
              model: "Classic" as const,
            },
          ];
        if (
          v &&
          typeof v === "object" &&
          "texture" in v &&
          typeof v.texture === "string"
        ) {
          const x = v as LocalSkin;
          return [
            {
              id: x.id || "local-" + n,
              name: x.name || "本地皮肤 " + (n + 1),
              texture: x.texture,
              model:
                x.model === "Slim" ? ("Slim" as const) : ("Classic" as const),
            },
          ];
        }
        return [];
      })
      .slice(0, 24);
  } catch {
    return [];
  }
}
export function saveLocalSkins(items: LocalSkin[]) {
  localStorage.setItem("kynex-skins", JSON.stringify(items));
}
