import { loadSkinToCanvas, inferModelType } from "skinview-utils";
import { api, desktop } from "../../lib/bridge";
import type { LocalSkin } from "./library";

export const MAX_SKIN_BYTES = 5 * 1024 * 1024;
export type SkinModel = "Classic" | "Slim";
export type ModelChoice = "Auto" | SkinModel;
export interface RemoteSkin {
  name: string;
  base64: string;
  model?: SkinModel | null;
}
export function validateSkinSize(width: number, height: number) {
  const scale = width / 64;
  if (
    width < 64 ||
    width > 1024 ||
    !Number.isInteger(scale) ||
    (scale & (scale - 1)) !== 0 ||
    (height !== width && height !== width / 2)
  )
    throw new Error(
      "皮肤尺寸须为 64×64、64×32，或不超过 1024 的等比例高清 PNG",
    );
}
export async function decodeSkin(
  file: File,
  modelHint?: SkinModel | null,
): Promise<LocalSkin> {
  if (file.size > MAX_SKIN_BYTES) throw new Error("皮肤文件不可超过 5 MB");
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v))
    throw new Error("只支持 PNG 皮肤，请勿导入 JPEG 或仅修改文件后缀");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    validateSkinSize(image.width, image.height);
    const canvas = document.createElement("canvas");
    loadSkinToCanvas(canvas, image);
    const model =
      modelHint ??
      (image.width !== image.height
        ? "Classic"
        : inferModelType(canvas) === "slim"
          ? "Slim"
          : "Classic");
    return {
      id: crypto.randomUUID(),
      name: file.name.replace(/\.png$/i, "").slice(0, 32),
      texture: canvas.toDataURL("image/png"),
      model,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function fetchPublic(url: string, signal?: AbortSignal) {
  const u = new URL(url);
  if (u.protocol !== "https:" || u.username || u.password)
    throw new Error("图片地址必须是无账号密码的 HTTPS 直链");
  const response = await fetch(u, {
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
      : AbortSignal.timeout(20000),
    credentials: "omit",
  });
  if (!response.ok)
    throw new Error(
      response.status === 404
        ? "没有找到这个玩家或皮肤"
        : `下载失败（HTTP ${response.status}）`,
    );
  return response;
}
async function boundedPng(
  response: Response,
  signal?: AbortSignal,
): Promise<File> {
  if (Number(response.headers.get("content-length")) > MAX_SKIN_BYTES)
    throw new Error("皮肤文件不可超过 5 MB");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("服务器没有返回图片内容");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_SKIN_BYTES) throw new Error("皮肤文件不可超过 5 MB");
      chunks.push(new Uint8Array(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return new File(chunks, "图片链接.png", { type: "image/png" });
}
export async function importRemote(
  kind: "url" | "username",
  value: string,
  signal?: AbortSignal,
): Promise<LocalSkin> {
  const input = value.trim();
  if (kind === "username" && !/^[A-Za-z0-9_]{1,16}$/.test(input))
    throw new Error("玩家名应为 1–16 位英文、数字或下划线");
  if (desktop) {
    const result = await api<RemoteSkin>("skin_import", { kind, value: input });
    signal?.throwIfAborted();
    const data = Uint8Array.from(atob(result.base64), (ch) => ch.charCodeAt(0));
    return decodeSkin(
      new File([data], result.name + ".png", { type: "image/png" }),
      result.model,
    );
  }
  try {
    if (kind === "url")
      return await decodeSkin(
        await boundedPng(await fetchPublic(input, signal), signal),
      );
    const profile: { id: string; name: string } = await (
      await fetchPublic(
        `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(input)}`,
        signal,
      )
    ).json();
    if (!/^[0-9a-f]{32}$/i.test(profile.id))
      throw new Error("没有找到这个玩家");
    const session: { properties: { name: string; value: string }[] } = await (
      await fetchPublic(
        `https://sessionserver.mojang.com/session/minecraft/profile/${profile.id}`,
        signal,
      )
    ).json();
    const property = session.properties?.find((p) => p.name === "textures");
    if (!property) throw new Error("这位玩家尚无可读取的皮肤");
    const payload = JSON.parse(atob(property.value)) as {
      textures?: { SKIN?: { url: string; metadata?: { model?: string } } };
    };
    const skin = payload.textures?.SKIN;
    if (!skin) throw new Error("这位玩家尚无可读取的皮肤");
    const url = new URL(skin.url);
    if (url.hostname !== "textures.minecraft.net")
      throw new Error("玩家档案中的皮肤地址无效");
    url.protocol = "https:";
    const file = await boundedPng(await fetchPublic(url.href, signal), signal);
    return await decodeSkin(
      new File([file], profile.name + ".png", { type: "image/png" }),
      skin.metadata?.model === "slim" ? "Slim" : "Classic",
    );
  } catch (e) {
    if (e instanceof TypeError)
      throw new Error(
        "网页被远端跨域策略阻止；请使用桌面版皮肤导入，或先下载 PNG 再导入",
      );
    throw e;
  }
}
