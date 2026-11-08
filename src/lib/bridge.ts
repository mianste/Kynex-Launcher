import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Task } from "./types";
export const desktop = isTauri();
let gameDirectoryId = "";
export function setGameDirectoryContext(id: string) {
  gameDirectoryId = id;
}
export async function api<T>(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  if (!desktop) throw new Error("此功能需要 Kynex Launcher 桌面版。");
  return invoke<T>("dispatch", {
    action,
    payload: gameDirectoryId
      ? { directoryId: gameDirectoryId, ...payload }
      : payload,
  });
}
export async function pickFile(
  filters: { name: string; extensions: string[] }[],
  directory = false,
): Promise<string | null> {
  if (!desktop) throw new Error("选择本地游戏文件需要桌面版");
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const current = getCurrentWindow();
  const active = document.activeElement as HTMLElement | null;
  await Promise.all([
    current.setCursorVisible(true),
    current.setCursorIcon("default"),
  ]);
  const { open } = await import("@tauri-apps/plugin-dialog");
  try {
    const result = await open({ multiple: false, directory, filters });
    return typeof result === "string" ? result : null;
  } finally {
    await current.setCursorVisible(true);
    await current.setCursorIcon("default");
    await current.setFocus();
    active?.focus({ preventScroll: true });
  }
}
export async function pickFiles(
  filters: { name: string; extensions: string[] }[],
): Promise<string[]> {
  if (!desktop) throw new Error("选择本地文件需要桌面版");
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const current = getCurrentWindow();
  const active = document.activeElement as HTMLElement | null;
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
export async function pickVideoFile(): Promise<string | null> {
  return pickFile([
    { name: "视频壁纸", extensions: ["mp4", "webm", "mov", "m4v"] },
  ]);
}

/** 把本地绝对路径转换成 WebView 可加载的 asset 地址。 */
export function assetUrl(path: string): string {
  return convertFileSrc(path);
}

export async function pickImageFile(
  kind: "skin" | "wallpaper",
): Promise<File | null> {
  const path = await pickFile([
    {
      name: kind === "skin" ? "Minecraft PNG 皮肤" : "图片",
      extensions: kind === "skin" ? ["png"] : ["png", "jpg", "jpeg", "webp"],
    },
  ]);
  if (!path) return null;
  const image = await api<{ name: string; mime: string; base64: string }>(
    "read_image",
    { path, maxBytes: 5 * 1024 * 1024 },
  );
  const bytes = Uint8Array.from(atob(image.base64), (ch) => ch.charCodeAt(0));
  return new File([bytes], image.name, { type: image.mime });
}
export async function saveFile(
  defaultPath: string,
  filters?: { name: string; extensions: string[] }[],
): Promise<string | null> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const current = getCurrentWindow();
  const active = document.activeElement as HTMLElement | null;
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
export async function onProgress(fn: (task: Task) => void) {
  return listen<Task>("kynex-progress", (e) => fn(e.payload));
}
export async function external(url: string) {
  if (desktop) await api("open_url", { url });
  else window.open(url, "_blank", "noopener,noreferrer");
}
export function readableSize(bytes: number) {
  return bytes < 1048576
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1048576).toFixed(1)} MB`;
}
