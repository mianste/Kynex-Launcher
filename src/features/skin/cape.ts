import { loadCapeToCanvas } from "skinview-utils";
import { MAX_SKIN_BYTES } from "./skinIO";
export async function decodeCape(file: File) {
  if (file.size > MAX_SKIN_BYTES) throw new Error("披风不可超过 5 MB");
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v))
    throw new Error("披风须为 PNG");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = image.width / 64;
    if (
      image.width < 64 ||
      image.width > 1024 ||
      image.width !== 2 * image.height ||
      !Number.isInteger(scale) ||
      (scale & (scale - 1)) !== 0
    )
      throw new Error("披风须为 64×32 或等比例高清 PNG");
    const canvas = document.createElement("canvas");
    loadCapeToCanvas(canvas, image);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Decode native-downloaded bytes without fetch(data:), which packaged CSP blocks.
export function capeFileFromData(texture: string): File {
  const prefix = "data:image/png;base64,";
  if (!texture.startsWith(prefix)) throw new Error("披风图片格式无效");
  const bytes = Uint8Array.from(atob(texture.slice(prefix.length)), (c) =>
    c.charCodeAt(0),
  );
  return new File([bytes], "cape.png", { type: "image/png" });
}
