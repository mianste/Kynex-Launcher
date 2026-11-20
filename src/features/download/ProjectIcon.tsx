import { useEffect, useRef, useState, type ReactNode } from "react";
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
export function proxyUrl(url: string): string {
  const raw = url.replace(/^https?:\/\//i, "");
  return `https://images.weserv.nl/?url=${encodeURIComponent(raw)}&w=96&h=96&fit=cover`;
}

/** 像素茶艺封面是整张 webp。公共 96px 代理对这个域名返回 400，对象存储也不接受缩小参数。 */
export function coverNeedsThumb(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname === "oss.pixelmap.cc" &&
      parsed.pathname.includes("/pixelmap/covers/")
    );
  } catch {
    return false;
  }
}

export function iconPlan(url: string): { src: string; onError: "proxy" | "cache" } {
  return coverNeedsThumb(url)
    ? { src: url, onError: "cache" }
    : { src: url, onError: "proxy" };
}

function decodedIcon(url: string, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!url) {
      reject(new Error("没有图标"));
      return;
    }
    const image = new Image();
    image.referrerPolicy = "no-referrer";
    const timer = window.setTimeout(() => {
      image.removeAttribute("src");
      reject(new Error("图标加载超时"));
    }, timeout);
    image.src = url;
    void image.decode().then(() => resolve(url), reject).finally(() => clearTimeout(timer));
  });
}

const preparedRemoteIcons = new Map<string, Promise<string>>();

function prepareIcon(url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) return decodedIcon(url, 2200).catch(() => "");
  const known = preparedRemoteIcons.get(url);
  if (known) return known;
  const request = Promise.any([
    decodedIcon(url, 1400),
    ...(desktop ? [api<{ data: string }>("icon", { url, cacheOnly: true })
      .then((value) => decodedIcon(value?.data, 800))] : []),
  ]).catch(() => Promise.any([
    ...(!coverNeedsThumb(url) ? [decodedIcon(proxyUrl(url), 950)] : []),
    ...(desktop ? [Promise.race([
      loadIcon(url).then((data) => decodedIcon(data, 650)),
      new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("图标加载超时")), 950)),
    ])] : []),
  ])).catch(() => "");
  if (preparedRemoteIcons.size >= 512) {
    const oldest = preparedRemoteIcons.keys().next().value;
    if (oldest) preparedRemoteIcons.delete(oldest);
  }
  preparedRemoteIcons.set(url, request);
  void request.then((src) => {
    if (!src && preparedRemoteIcons.get(url) === request) preparedRemoteIcons.delete(url);
  });
  return request;
}

export async function prepareProjectIcons(urls: Iterable<string>): Promise<Map<string, string>> {
  return new Map(await Promise.all([...new Set(urls)].map(async (url) => [url, await prepareIcon(url)] as const)));
}

/**
 * 资源图标按顺序尝试：远程原图 → 图片代理 → 后端磁盘缓存。
 * 加载中和失败时显示通用图标，不在资源图片上叠加名称。
 */
type ProjectIconProps = {
  url?: string | null;
  name: string;
  priority?: boolean;
  prepared?: boolean;
  className?: string;
  fallbackIcon?: ReactNode;
};

export function ProjectIcon(props: ProjectIconProps) {
  return <ProjectIconImage key={props.url ?? ""} {...props} />;
}

function ProjectIconImage({
  url,
  name,
  priority = true,
  prepared = false,
  className = "project-icon",
  fallbackIcon,
}: ProjectIconProps) {
  const link = url ?? "";
  const plan = link ? iconPlan(link) : { src: "", onError: "proxy" as const };
  const [src, Src] = useState(plan.src);
  const [loaded, Loaded] = useState(prepared && !!link);
  const step = useRef(0);

  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  function fallback() {
    Loaded(false);
    if (prepared || !/^https?:\/\//i.test(link)) {
      Src("");
      return;
    }
    if (step.current === 0 && plan.onError === "proxy") {
      step.current = 1;
      Src(proxyUrl(link));
      return;
    }
    if (step.current < 2 && desktop) {
      step.current = 2;
      void loadIcon(link).then((data) => { if (mounted.current) Src(data || ""); });
      return;
    }
    step.current = 3;
    Src("");
  }

  return (
    <div className={className} role="img" aria-label={`${name} 图标`}>
      {src ? (
        <img
          src={src}
          alt=""
          decoding="async"
          draggable={false}
          referrerPolicy="no-referrer"
          loading={priority ? "eager" : "lazy"}
          fetchPriority={coverNeedsThumb(link) ? (priority ? "high" : "low") : undefined}
          className={loaded ? "loaded" : ""}
          style={{ opacity: loaded ? 1 : 0 }}
          onLoad={() => Loaded(true)}
          onError={fallback}
        />
      ) : null}
      {(!loaded || !src) && (fallbackIcon ?? <Package size={24} aria-hidden="true" />)}
    </div>
  );
}
