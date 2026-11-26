import { useEffect, useRef, useState } from "react";
import { Package } from "lucide-react";
import { api, desktop } from "../../lib/bridge";
// 模块级缓存：后端取回的 data URL 会复用，避免重复请求。
const iconCache = new Map();
const pending = new Map();
const MAX_PARALLEL = 8;
const CATALOG_ICON_TIMEOUT = 3200;
let active = 0;
const waiting = [];
async function withSlot(task) {
  if (active >= MAX_PARALLEL) {
    await new Promise((resolve) => waiting.push(resolve));
  } else {
    active += 1;
  }
  try {
    return await task();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  }
}
async function loadIcon(url, quick = false, needed = () => true) {
  const hit = iconCache.get(url);
  if (hit) return hit;
  const inflight = pending.get(url);
  if (inflight) return inflight;
  const request = withSlot(() =>
    needed() ? api("icon", { url, quick }) : Promise.resolve({ data: "" }),
  )
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
export function proxyUrl(url) {
  const raw = url.replace(/^https?:\/\//i, "");
  return `https://images.weserv.nl/?url=${encodeURIComponent(raw)}&w=96&h=96&fit=cover`;
}
/** 像素茶艺封面是整张 webp。公共 96px 代理对这个域名返回 400，对象存储也不接受缩小参数。 */
export function coverNeedsThumb(url) {
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
export function iconPlan(url) {
  return coverNeedsThumb(url)
    ? { src: url, onError: "cache" }
    : { src: url, onError: "proxy" };
}
function decodedIcon(url, timeout) {
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
    void image
      .decode()
      .then(() => resolve(image), reject)
      .finally(() => clearTimeout(timer));
  });
}
// Retain decoded images so the list can paint them as soon as it mounts.
const preparedIcons = new Map();
const isRemote = (url) => /^https:\/\//i.test(url);
function prepareIcon(url, original, fallback, timeout = CATALOG_ICON_TIMEOUT) {
  const key = JSON.stringify([url, original, fallback]);
  const existing = preparedIcons.get(key);
  if (existing) {
    preparedIcons.delete(key);
    preparedIcons.set(key, existing);
    return existing;
  }
  let finished = false;
  const staggered = (delay, fetch) =>
    new Promise((resolve, reject) => {
      window.setTimeout(() => {
        if (finished) reject(new Error("已取得图标"));
        else void fetch().then(resolve, reject);
      }, delay);
    });
  const candidates = [decodedIcon(url, timeout)];
  if (original && original !== url) {
    candidates.push(
      staggered(120, () => decodedIcon(original, timeout - 120)),
    );
  }
  if (isRemote(url)) {
    if (!coverNeedsThumb(url)) {
      candidates.push(
        staggered(380, () =>
          decodedIcon(proxyUrl(url), timeout - 380),
        ),
      );
    }
    if (desktop) {
      candidates.push(
        api("icon", { url, cacheOnly: true }).then(({ data }) =>
          decodedIcon(data, 1000),
        ),
      );
      candidates.push(
        staggered(160, () =>
          loadIcon(url, true, () => !finished).then((data) =>
            decodedIcon(data, 800),
          ),
        ),
      );
    }
  }
  if (fallback && fallback !== url && fallback !== original) {
    candidates.push(
      staggered(550, () => decodedIcon(fallback, timeout - 550)),
    );
  }
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(resolve, timeout);
  });
  const request = Promise.race([
    Promise.any(candidates).catch(() => undefined),
    deadline,
  ]).then((image) => {
    clearTimeout(timer);
    finished = true;
    if (!image && preparedIcons.get(key) === request) preparedIcons.delete(key);
    return image;
  });
  preparedIcons.set(key, request);
  if (preparedIcons.size > 160)
    preparedIcons.delete(preparedIcons.keys().next().value);
  return request;
}
export async function prepareProjectIcons(urls) {
  return new Map(
    await Promise.all(
      [...new Set(urls)].map(async (url) => {
        const image = await prepareIcon(url);
        return [url, image?.src ?? ""];
      }),
    ),
  );
}
export function prepareCatalogIcons(projects, timeout) {
  return Promise.all(
    projects.map(async (project) => {
      const screenshot = project.gallery?.[0];
      const thumbnail = screenshot?.thumbnailUrl || screenshot?.url;
      const primary = project.icon_url || project.icon_full_url || thumbnail;
      const image = primary
        ? await prepareIcon(
            primary,
            project.icon_full_url || screenshot?.url,
            thumbnail,
            timeout,
          )
        : undefined;
      return { ...project, displayIcon: image?.src };
    }),
  );
}
export function ProjectIcon(props) {
  return <ProjectIconImage key={props.url ?? ""} {...props} />;
}
function ProjectIconImage({
  url,
  name,
  priority = true,
  prepared = false,
  className = "project-icon",
  fallbackIcon,
}) {
  const link = url ?? "";
  const plan = link ? iconPlan(link) : { src: "", onError: "proxy" };
  const [src, Src] = useState(plan.src);
  const [loaded, Loaded] = useState(prepared && !!link);
  const step = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (prepared || !desktop || !/^https:\/\//i.test(link)) return;
    let live = true;
    void api("icon", { url: link, cacheOnly: true })
      .then(({ data }) => {
        if (live && data) {
          Src(data);
          Loaded(true);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [link, prepared]);
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
      void loadIcon(link).then((data) => {
        if (mounted.current) Src(data || "");
      });
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
          fetchPriority={
            coverNeedsThumb(link) ? (priority ? "high" : "low") : undefined
          }
          className={loaded ? "loaded" : ""}
          style={{ opacity: loaded ? 1 : 0 }}
          onLoad={() => Loaded(true)}
          onError={fallback}
        />
      ) : null}
      {(!loaded || !src) &&
        (fallbackIcon ?? <Package size={24} aria-hidden="true" />)}
    </div>
  );
}
