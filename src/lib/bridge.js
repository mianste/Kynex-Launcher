import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
export const desktop = isTauri();
let gameDirectoryId = "";
export function setGameDirectoryContext(id) {
  gameDirectoryId = id;
}
export async function api(action, payload = {}) {
  if (!desktop) throw new Error("此功能需要 Kynex Launcher 桌面版。");
  return invoke("dispatch", {
    action,
    payload: gameDirectoryId
      ? { directoryId: gameDirectoryId, ...payload }
      : payload,
  });
}
export async function pickFile(filters, directory = false, defaultPath) {
  if (!desktop) throw new Error("选择本地游戏文件需要桌面版");
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const current = getCurrentWindow();
  const active = document.activeElement;
  await Promise.all([
    current.setCursorVisible(true),
    current.setCursorIcon("default"),
  ]);
  const { open } = await import("@tauri-apps/plugin-dialog");
  try {
    const result = await open({
      multiple: false,
      directory,
      filters,
      defaultPath,
    });
    return typeof result === "string" ? result : null;
  } finally {
    await current.setCursorVisible(true);
    await current.setCursorIcon("default");
    await current.setFocus();
    active?.focus({ preventScroll: true });
  }
}
export async function pickFiles(filters) {
  if (!desktop) throw new Error("选择本地文件需要桌面版");
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const current = getCurrentWindow();
  const active = document.activeElement;
  await Promise.all([
    current.setCursorVisible(true),
    current.setCursorIcon("default"),
  ]);
  const { open } = await import("@tauri-apps/plugin-dialog");
  try {
    const result = await open({ multiple: true, directory: false, filters });
    return Array.isArray(result) ? result : result ? [result] : [];
  } finally {
    await current.setCursorVisible(true);
    await current.setCursorIcon("default");
    await current.setFocus();
    active?.focus({ preventScroll: true });
  }
}
export async function pickVideoFile() {
  return pickFile([
    { name: "视频壁纸", extensions: ["mp4", "webm", "mov", "m4v"] },
  ]);
}
/** 把本地绝对路径转换成 WebView 可加载的 asset 地址。 */
export function assetUrl(path) {
  return convertFileSrc(path);
}
export async function pickImageFile(kind) {
  const path = await pickFile([
    {
      name: kind === "skin" ? "Minecraft PNG 皮肤" : "图片",
      extensions: kind === "skin" ? ["png"] : ["png", "jpg", "jpeg", "webp"],
    },
  ]);
  if (!path) return null;
  const image = await api("read_image", { path, maxBytes: 5 * 1024 * 1024 });
  const bytes = Uint8Array.from(atob(image.base64), (ch) => ch.charCodeAt(0));
  return new File([bytes], image.name, { type: image.mime });
}
export async function saveFile(defaultPath, filters) {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const current = getCurrentWindow();
  const active = document.activeElement;
  await Promise.all([
    current.setCursorVisible(true),
    current.setCursorIcon("default"),
  ]);
  const { save } = await import("@tauri-apps/plugin-dialog");
  try {
    return await save({ defaultPath, filters });
  } finally {
    await current.setCursorVisible(true);
    await current.setCursorIcon("default");
    await current.setFocus();
    active?.focus({ preventScroll: true });
  }
}
export async function onProgress(fn) {
  return listen("kynex-progress", (e) => fn(e.payload));
}
export async function external(url) {
  if (desktop) await api("open_url", { url });
  else window.open(url, "_blank", "noopener,noreferrer");
}
export function readableSize(bytes) {
  return bytes < 1048576
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1048576).toFixed(1)} MB`;
}
