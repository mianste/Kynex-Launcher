import { useLayoutEffect, useRef, useState, type RefObject } from "react";

type PreviewGeometry = {
  width: number;
  height: number;
  scale: number;
  canvas: { left: number; top: number; width: number; height: number };
};

export function useHomePreviewGeometry(
  editing: boolean,
  space: RefObject<HTMLDivElement>,
) {
  const [geometry, setGeometry] = useState<PreviewGeometry | null>(null);
  useLayoutEffect(() => {
    const container = space.current;
    const app = container?.closest<HTMLElement>(".app");
    const home = container?.closest<HTMLElement>(".home-layout");
    const dock = home?.querySelector<HTMLElement>(":scope > .home-dock");
    if (!editing || !container || !app || !home || !dock) return;

    function measure() {
      if (!container || !app || !home || !dock) return;
      const appBounds = app.getBoundingClientRect();
      const bounds = home.getBoundingClientRect();
      const dockBounds = dock.getBoundingClientRect();
      const style = getComputedStyle(container);
      const availableWidth =
        container.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight);
      const availableHeight =
        container.clientHeight -
        parseFloat(style.paddingTop) -
        parseFloat(style.paddingBottom);
      const left = bounds.left - appBounds.left;
      const top = bounds.top - appBounds.top + 9;
      const next = {
        width: appBounds.width,
        height: appBounds.height,
        scale: Math.min(
          1,
          availableWidth / appBounds.width,
          availableHeight / appBounds.height,
        ),
        canvas: {
          left,
          top,
          width: Math.max(1, bounds.width - 20),
          height: Math.max(1, dockBounds.top - appBounds.top - 17 - top),
        },
      };
      if (next.scale > 0) setGeometry(next);
    }

    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(container);
    resize.observe(app);
    resize.observe(home);
    resize.observe(dock);
    return () => resize.disconnect();
  }, [editing, space]);
  return geometry;
}

const layers = [
  ":scope > .wallpaper",
  ":scope > .wallpaper-video",
  ":scope > .top-navigation",
  ":scope > .chrome > .window-controls",
  ":scope .home-layout > .home-dock",
  ":scope > .assistant-orb",
  ":scope > .music-shell.compact .music-edge-dock",
  ":scope > .taskbar",
];

export function HomeWidgetPreviewChrome({
  width,
  height,
}: {
  width: number;
  height: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const preview = ref.current;
    const app = preview?.closest<HTMLElement>(".app");
    if (!preview || !app) return;

    function refresh() {
      if (!preview || !app) return;
      const origin = app.getBoundingClientRect();
      const children = layers.flatMap((selector) => {
        const source = app.querySelector<HTMLElement>(selector);
        if (!source) return [];
        const bounds = source.getBoundingClientRect();
        const copy =
          source instanceof HTMLVideoElement
            ? document.createElement("canvas")
            : (source.cloneNode(true) as HTMLElement);
        if (
          source instanceof HTMLVideoElement &&
          copy instanceof HTMLCanvasElement
        ) {
          copy.width = source.videoWidth;
          copy.height = source.videoHeight;
          if (copy.width && copy.height) {
            copy.getContext("2d")?.drawImage(source, 0, 0);
            copy.style.objectFit = "cover";
          }
        }
        if (!(source instanceof HTMLVideoElement)) {
          const originals = source.querySelectorAll("canvas");
          copy.querySelectorAll("canvas").forEach((canvas, index) => {
            const original = originals[index];
            if (original.width && original.height)
              canvas.getContext("2d")?.drawImage(original, 0, 0);
          });
        }
        copy
          .querySelectorAll(".home-popover")
          .forEach((popover) => popover.remove());
        for (const node of [
          copy,
          ...copy.querySelectorAll("[id], [data-guide]"),
        ]) {
          node.removeAttribute("id");
          node.removeAttribute("data-guide");
        }

        const wrapper = document.createElement("div");
        wrapper.className = "home-widget-preview-layer";
        Object.assign(wrapper.style, {
          left: bounds.left - origin.left + "px",
          top: bounds.top - origin.top + "px",
          width: bounds.width + "px",
          height: bounds.height + "px",
        });
        copy.style.setProperty("position", "static", "important");
        copy.style.setProperty("transform", "none", "important");
        copy.style.setProperty("translate", "none", "important");
        copy.style.setProperty("margin", "0", "important");
        copy.style.setProperty("width", "100%", "important");
        copy.style.setProperty("height", "100%", "important");
        wrapper.append(copy);
        return [wrapper];
      });
      preview.replaceChildren(...children);
      preview.inert = true;
    }

    refresh();
    const nav = app.querySelector(":scope > .top-navigation");
    const observer = new MutationObserver(refresh);
    if (nav)
      observer.observe(nav, {
        attributes: true,
        attributeFilter: ["data-open"],
      });
    return () => observer.disconnect();
  }, [width, height]);
  return (
    <div ref={ref} className="home-widget-preview-chrome" aria-hidden="true" />
  );
}
