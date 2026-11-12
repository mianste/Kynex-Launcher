import { useLayoutEffect, type RefObject } from "react";

// Cut only the floating panel's footprint out of the foreground beneath it.
// The page keeps its size and position; the wallpaper remains visible through
// the assistant even at zero opacity, without a second layer of page text.
export function useAssistantOcclusion(
  panel: RefObject<HTMLElement>,
  open: boolean,
) {
  useLayoutEffect(() => {
    if (!open || !panel.current) return;
    const touched = new Set<HTMLElement>();
    let frame = 0;
    const resize = new ResizeObserver(() => schedule());
    const clear = (element: HTMLElement) => {
      delete element.dataset.assistantObscured;
      element.style.removeProperty("--assistant-cutout");
    };
    function update() {
      frame = 0;
      const surface = panel.current;
      if (!surface) return;
      const box = surface.getBoundingClientRect();
      const layers = document.querySelectorAll<HTMLElement>(
        ".app > .nav,.app > .page-content,.app > .music-shell,.app > .taskbar",
      );
      const present = new Set(layers);
      for (const old of touched)
        if (!present.has(old)) {
          resize.unobserve(old);
          clear(old);
          touched.delete(old);
        }
      for (const layer of layers) {
        if (!touched.has(layer)) {
          touched.add(layer);
          resize.observe(layer);
        }
        const r = layer.getBoundingClientRect();
        if (
          !r.width || !r.height ||
          box.right <= r.left ||
          box.left >= r.right ||
          box.bottom <= r.top ||
          box.top >= r.bottom
        ) {
          clear(layer);
          continue;
        }
        const scaleX = layer.offsetWidth / r.width;
        const scaleY = layer.offsetHeight / r.height;
        const left = (box.left - r.left - 1) * scaleX;
        const top = (box.top - r.top - 1) * scaleY;
        const right = (box.right - r.left + 1) * scaleX;
        const bottom = (box.bottom - r.top + 1) * scaleY;
        const radius = (parseFloat(getComputedStyle(surface).borderTopLeftRadius) || 20) + 1;
        const rx = radius * scaleX;
        const ry = radius * scaleY;
        // Leave the layer's own edge and shadow intact outside the cutout.
        const extent = 4 * Math.max(innerWidth, innerHeight, layer.offsetWidth, layer.offsetHeight);
        const path = `M${-extent} ${-extent}H${extent}V${extent}H${-extent}Z M${left + rx} ${top}H${right - rx}Q${right} ${top} ${right} ${top + ry}V${bottom - ry}Q${right} ${bottom} ${right - rx} ${bottom}H${left + rx}Q${left} ${bottom} ${left} ${bottom - ry}V${top + ry}Q${left} ${top} ${left + rx} ${top}Z`;
        layer.style.setProperty(
          "--assistant-cutout",
          `path(evenodd, "${path}")`,
        );
        layer.dataset.assistantObscured = "true";
      }
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(update);
    }
    resize.observe(panel.current);
    const mutations = new MutationObserver(schedule);
    const app = panel.current.closest(".app");
    if (app) mutations.observe(app, { childList: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("animationend", schedule, true);
    update();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("animationend", schedule, true);
      touched.forEach(clear);
    };
  }, [open, panel]);
}
