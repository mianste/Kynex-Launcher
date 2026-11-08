import { useEffect, useRef, useState } from "react";
import { api, desktop } from "../../lib/bridge";

// 模块级缓存：后端取回的 data URL 会复用，避免重复请求。
const iconCache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

// 后端图标请求限流，最多同时 4 个。
const MAX_PARALLEL = 4;
let active = 0;
const waiting: Array<() => void> = [];
async function withSlot<T>(task: () => Promise<T>): Promise<T> {
  if (active >= MAX_PARALLEL) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  active += 1;
  try {
    return await task();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}

async function loadIcon(url: string): Promise<string> {
  const hit = iconCache.get(url);
  if (hit) return hit;
  const inflight = pending.get(url);
  if (inflight) return inflight;
  const request = withSlot(() => api<{ data: string }>("icon", { url }))
    .then((value) => {
      const data = value?.data ?? "";
      if (data) iconCache.set(url, data);
      return data;
    })
    .catch(() => "")
    .finally(() => pending.delete(url));
  pending.set(url, request);
  return request;
}

/** 公共图片代理：WebView 能直接加载，绕开桌面端 HTTP 客户端连不上 ForgeCDN 的情况。 */
function proxyUrl(url: string): string {
  const raw = url.replace(/^https?:\/\//i, "");
  return `https://images.weserv.nl/?url=${encodeURIComponent(raw)}&w=96&h=96&fit=cover`;
}

/**
 * 资源图标按顺序尝试：远程原图 → 图片代理 → 后端磁盘缓存，全部失败才显示文字占位。
 * 图片加载中或失败时文字占位盖在图片上方，不会再出现白色空方块。
 */
export function ProjectIcon({
  url,
  name,
}: {
  url?: string | null;
  name: string;
}) {
  const link = url ?? "";
  const [src, Src] = useState(link);
  const [loaded, Loaded] = useState(false);
  const step = useRef(0);

  useEffect(() => {
    step.current = 0;
    Loaded(false);
    Src(link);
  }, [link]);

  function fallback() {
    Loaded(false);
    if (!link) {
      Src("");
      return;
    }
    if (step.current === 0) {
      step.current = 1;
      Src(proxyUrl(link));
      return;
    }
    if (step.current === 1 && desktop) {
      step.current = 2;
      void loadIcon(link).then((data) => Src(data || ""));
      return;
    }
    step.current = 3;
    Src("");
  }

  return (
    <div className="project-icon">
      {src ? (
        <img
          src={src}
          alt=""
          decoding="async"
          className={loaded ? "loaded" : ""}
          onLoad={() => Loaded(true)}
          onError={fallback}
        />
      ) : null}
      {(!loaded || !src) && <span>{name.slice(0, 2)}</span>}
    </div>
  );
}
