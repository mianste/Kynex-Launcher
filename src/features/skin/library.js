export function readLocalSkins() {
  try {
    const items = JSON.parse(localStorage.getItem("kynex-skins") ?? "[]");
    return items
      .flatMap((v, n) => {
        if (typeof v === "string")
          return [
            {
              id: "legacy-" + n,
              name: "本地皮肤 " + (n + 1),
              texture: v,
              model: "Classic",
            },
          ];
        if (
          v &&
          typeof v === "object" &&
          "texture" in v &&
          typeof v.texture === "string"
        ) {
          const x = v;
          return [
            {
              id: x.id || "local-" + n,
              name: x.name || "本地皮肤 " + (n + 1),
              texture: x.texture,
              model: x.model === "Slim" ? "Slim" : "Classic",
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
export function saveLocalSkins(items) {
  localStorage.setItem("kynex-skins", JSON.stringify(items));
}
