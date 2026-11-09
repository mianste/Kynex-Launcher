import { useEffect, useRef, useState } from "react";
import { Package } from "lucide-react";
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
 * 资源图标按顺序尝试：远程原图 → 图片代理 → 后端磁盘缓存。
 * 加载中和失败时显示通用图标，不在资源图片上叠加名称。
 */
export function ProjectIcon({
  url,
  name,
}: {
  url?: string | null;
  name: string;
}) {
  return <ProjectIconImage key={url ?? ""} url={url} name={name} />;
}

function ProjectIconImage({ url, name }: { url?: string | null; name: string }) {
  const link = url ?? "";
  const [src, Src] = useState(link);
  const [loaded, Loaded] = useState(false);
  const step = useRef(0);

  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

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
      void loadIcon(link).then((data) => { if (mounted.current) Src(data || ""); });
      return;
    }
    step.current = 3;
    Src("");
  }

  return (
    <div className="project-icon" role="img" aria-label={`${name} 图标`}>
      {src ? (
        <img
          src={src}
          alt=""
          decoding="async"
          className={loaded ? "loaded" : ""}
          style={{ opacity: loaded ? 1 : 0 }}
          onLoad={() => Loaded(true)}
          onError={fallback}
        />
      ) : null}
      {(!loaded || !src) && <Package size={24} aria-hidden="true" />}
    </div>
  );
}
