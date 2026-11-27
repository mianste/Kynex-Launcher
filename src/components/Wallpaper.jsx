import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { HolidayLiveWallpaper } from "./HolidayLiveWallpaper";

// Keep the displayed media until its replacement can actually paint. Frames
// compose in place, so reversing a fade never restores an old snapshot at 100%.
export function Wallpaper({
  value,
  effects,
  isHome,
  appRoot,
  onActiveChange,
  onError,
}) {
  const [layers, setLayers] = useState(() => [
    {
      ...value,
      ready: value.kind !== "video",
      visible: value.kind !== "video",
    },
  ]);
  const [active, setActive] = useState(value.kind === "video" ? "" : value.key);
  const latest = useRef(value.key);
  latest.current = value.key;
  const layerRef = useRef(layers);
  layerRef.current = layers;
  const cleanupTimer = useRef(0);
  const frames = useRef(new Set());
  const prepared = useRef(new Set());
  const errorHandler = useRef(onError);
  errorHandler.current = onError;

  function activate(key) {
    if (latest.current !== key) return;
    clearTimeout(cleanupTimer.current);
    setActive(key);
    setLayers((previous) => {
      const index = previous.findIndex((layer) => layer.key === key);
      if (index < 0) return previous;
      return previous.map((layer, position) => ({
        ...layer,
        visible: position <= index,
      }));
    });
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    cleanupTimer.current = setTimeout(
      () => {
        if (latest.current === key) {
          prepared.current = new Set([key]);
          setLayers((previous) =>
            previous.filter((layer) => layer.key === key),
          );
        }
      },
      reduce ? 0 : 520,
    );
  }
  function nextFrame(callback) {
    const frame = requestAnimationFrame(() => {
      frames.current.delete(frame);
      callback();
    });
    frames.current.add(frame);
  }
  function ready(key) {
    if (latest.current !== key || prepared.current.has(key)) return;
    prepared.current.add(key);
    setLayers((previous) =>
      previous.map((layer) =>
        layer.key === key ? { ...layer, ready: true } : layer,
      ),
    );
    nextFrame(() => nextFrame(() => activate(key)));
  }
  function failed(key) {
    if (latest.current !== key) return;
    setLayers((previous) =>
      previous.filter((layer) => layer.key !== key || layer.visible),
    );
    errorHandler.current?.("壁纸读取失败，已保留当前背景，请重新选择文件");
  }

  useEffect(() => {
    let live = true;
    setLayers((previous) =>
      previous.filter((layer) => layer.ready || layer.key === value.key),
    );
    const existing = layerRef.current.find((layer) => layer.key === value.key);
    if (existing) {
      if (existing.ready) activate(value.key);
      return;
    }
    const add = () => {
      if (!live || latest.current !== value.key) return;
      prepared.current.delete(value.key);
      setLayers((previous) => [
        ...previous.filter((layer) => layer.ready),
        { ...value, ready: value.kind !== "video", visible: false },
      ]);
      if (value.kind !== "video")
        nextFrame(() => nextFrame(() => activate(value.key)));
    };
    if (value.kind === "image") {
      const image = new Image();
      image.src = value.src;
      image
        .decode()
        .then(add)
        .catch(() => {
          if (live) failed(value.key);
        });
    } else add();
    return () => {
      live = false;
    };
  }, [value.key]);

  useLayoutEffect(() => {
    if (active)
      onActiveChange?.(layerRef.current.find((layer) => layer.key === active));
  }, [active, onActiveChange]);
  useEffect(
    () => () => {
      clearTimeout(cleanupTimer.current);
      frames.current.forEach(cancelAnimationFrame);
    },
    [],
  );

  return layers.map((layer) => (
    <div
      key={layer.key}
      className="wallpaper-frame"
      data-visible={layer.visible}
      data-active={layer.key === active}
      data-kind={layer.kind}
    >
      {layer.kind === "video" ? (
        <video
          className="wallpaper-video"
          crossOrigin="anonymous"
          src={layer.src}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          onLoadedData={() => ready(layer.key)}
          onCanPlay={() => ready(layer.key)}
          onError={() => failed(layer.key)}
        />
      ) : (
        <div
          className={`wallpaper ${layer.holidayId ? "holiday-wallpaper" : ""} ${layer.dusk ? "dusk" : ""} ${layer.kind === "plain" ? "plain" : ""}`}
          style={{
            backgroundImage: layer.src ? `url("${layer.src}")` : "none",
          }}
        />
      )}
      {layer.holidayId && (
        <HolidayLiveWallpaper
          holidayId={layer.holidayId}
          imageUrl={layer.src}
          active={effects && layer.key === active}
          isHome={isHome}
          appRoot={appRoot}
        />
      )}
    </div>
  ));
}
