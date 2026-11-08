import { useLayoutEffect, useRef, type RefObject } from "react";
import { chooseInk, type InkDecision } from "./adaptiveInk";

/**
 * Pick a solid ink colour for text sitting on translucent panels.
 *
 * Runs in a layout effect and re-evaluates synchronously after DOM mutations,
 * so colours are applied before the browser paints. There is no visible
 * "refresh" where text first renders in the theme colour and then switches.
 * Readable ink is retained; a sustained contrast change is needed to switch.
 */
export function useAdaptiveText(
  root: RefObject<HTMLElement>,
  wallpaper: string,
  opacity: number,
  page: string,
  theme: string,
) {
  const cachedImage = useRef<{ url: string; image: HTMLImageElement }>();
  const inkDecisions = useRef(new Map<HTMLElement, InkDecision>());
  useLayoutEffect(() => {
    const app = root.current;
    if (!app) return;
    const clearAll = () => {
      for (const node of app.querySelectorAll<HTMLElement>("[data-adaptive-ink]")) {
        delete node.dataset.adaptiveInk;
        node.style.removeProperty("--adaptive-ink");
        node.style.removeProperty("--adaptive-edge");
      }
    };
    let live = true;
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 320;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const colorCanvas = document.createElement("canvas");
    colorCanvas.width = colorCanvas.height = 1;
    const colors = colorCanvas.getContext("2d", { willReadFrequently: true })!;
    const decisions = inkDecisions.current;
    let settlingTimer = 0;

    const background = app.querySelector<HTMLElement>(".wallpaper");
    const url = background
      ? getComputedStyle(background).backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1]
      : undefined;
    if (url && cachedImage.current?.url !== url) {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.src = url;
      cachedImage.current = { url, image };
    }
    const image = url ? cachedImage.current?.image : undefined;

    const luminance = (rgb: number[]) =>
      rgb
        .map((value) => {
          const n = value / 255;
          return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
        })
        .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);

    const reset = (node: HTMLElement) => {
      delete node.dataset.adaptiveInk;
      node.style.removeProperty("--adaptive-ink");
      node.style.removeProperty("--adaptive-edge");
      decisions.delete(node);
    };

    const update = () => {
      if (!live || document.hidden) return;
      const alpha = Number.parseFloat(getComputedStyle(app).getPropertyValue("--ui-alpha"));
      if (alpha >= 92) {
        clearAll();
        decisions.clear();
        return;
      }
      const box = app.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const height = Math.max(1, Math.round((canvas.width * box.height) / box.width));
      if (canvas.height !== height) canvas.height = height;

      const frame = app.querySelector<HTMLVideoElement>(".wallpaper-video");
      let pixels: Uint8ClampedArray | undefined;
      try {
        const source =
          frame && frame.videoWidth
            ? frame
            : image?.complete && image.naturalWidth
              ? image
              : null;
        const width = source instanceof HTMLVideoElement ? source.videoWidth : source?.naturalWidth;
        const sourceHeight =
          source instanceof HTMLVideoElement ? source.videoHeight : source?.naturalHeight;
        if (source && width && sourceHeight && wallpaper !== "plain") {
          const scale = Math.max(canvas.width / width, canvas.height / sourceHeight);
          ctx.drawImage(
            source,
            (canvas.width - width * scale) / 2,
            (canvas.height - sourceHeight * scale) / 2,
            width * scale,
            sourceHeight * scale,
          );
          pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        }
        // Wait for the real wallpaper instead of briefly painting fallback ink.
        if (!source && url && image && !image.complete) return;
      } catch {
        /* An unavailable/tinted video frame falls back to the theme surface. */
      }

      const parsed = new Map<string, number[]>();
      const styles = new Map<HTMLElement, CSSStyleDeclaration>();
      const style = (node: HTMLElement) => {
        let value = styles.get(node);
        if (!value) {
          value = getComputedStyle(node);
          styles.set(node, value);
        }
        return value;
      };
      const rgba = (color: string) => {
        let value = parsed.get(color);
        if (!value) {
          colors.clearRect(0, 0, 1, 1);
          colors.fillStyle = color;
          colors.fillRect(0, 0, 1, 1);
          value = [...colors.getImageData(0, 0, 1, 1).data];
          parsed.set(color, value);
        }
        return value;
      };

      const base = rgba(style(app).getPropertyValue("--bg")).slice(0, 3);
      const seen = new Set<HTMLElement>();
      const candidates = app.querySelectorAll<HTMLElement>(
        "h1,h2,h3,h4,h5,p,small,b,strong,label,time,button,span,div,li,a,summary,dt,dd,td,th,pre,code,input,textarea,figcaption,output",
      );
      for (const node of candidates) {
        if (
          node.closest(
            ".switch,.project-icon,.music-artwork,.native-qr,.color-dots,[data-fixed-ink]",
          )
        ) {
          continue;
        }
        const textNodes = [...node.childNodes].filter(
          (child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim(),
        );
        const field = node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement;
        if (field && node instanceof HTMLInputElement && !["text", "search", "password", "email", "url", "number"].includes(node.type)) continue;
        if (!textNodes.length && !field) continue;
        const rects = (field ? [node.getBoundingClientRect()] : textNodes
          .flatMap((text) => {
            const range = document.createRange();
            range.selectNodeContents(text);
            return [...range.getClientRects()];
          }))
          .filter(
            (rect) =>
              rect.width > 0 &&
              rect.height > 0 &&
              rect.bottom >= box.top &&
              rect.top <= box.bottom &&
              rect.right >= 0 &&
              rect.left <= viewportWidth &&
              rect.bottom >= 0 &&
              rect.top <= viewportHeight,
          );
        if (!rects.length) continue;
        seen.add(node);
        const samples: number[][] = [];
        for (const rect of rects) {
          for (let y = 0; y < 3; y += 1) {
            for (let x = 0; x < 5; x += 1) {
              const px = Math.min(
                canvas.width - 1,
                Math.max(
                  0,
                  Math.floor(
                    ((rect.left - box.left + (rect.width * (x + 0.5)) / 5) / box.width) *
                      canvas.width,
                  ),
                ),
              );
              const py = Math.min(
                canvas.height - 1,
                Math.max(
                  0,
                  Math.floor(
                    ((rect.top - box.top + (rect.height * (y + 0.5)) / 3) / box.height) *
                      canvas.height,
                  ),
                ),
              );
              samples.push([0, 1, 2].map((channel) =>
                pixels ? pixels[(py * canvas.width + px) * 4 + channel] : base[channel],
              ));
            }
          }
        }
        const parents: HTMLElement[] = [];
        for (
          let parent: HTMLElement | null = node;
          parent && parent !== app;
          parent = parent.parentElement
        ) {
          parents.push(parent);
        }
        for (const parent of parents.reverse()) {
          const color = rgba(style(parent).backgroundColor);
          const alpha = color[3] / 255;
          for (let channel = 0; channel < 3; channel += 1) {
            for (const rgb of samples) {
              rgb[channel] = color[channel] * alpha + rgb[channel] * (1 - alpha);
            }
          }
        }
        // Ignore isolated pixels at either extreme while retaining local contrast.
        const levels = samples.map(luminance).sort((a, b) => a - b);
        const whiteScore = 1.05 / (levels[Math.floor((levels.length - 1) * 0.9)] + 0.05);
        const blackScore = (levels[Math.floor((levels.length - 1) * 0.1)] + 0.05) / 0.05;
        const decision = chooseInk(decisions.get(node), whiteScore, blackScore, performance.now());
        decisions.set(node, decision);
        if (decision.pending && !settlingTimer) {
          settlingTimer = window.setTimeout(() => { settlingTimer = 0; update(); }, 650);
        }
        const ink = decision.ink === "light" ? "#ffffff" : "#000000";
        if (!node.dataset.adaptiveInk) node.dataset.adaptiveInk = "true";
        if (node.style.getPropertyValue("--adaptive-ink") !== ink) {
          node.style.setProperty("--adaptive-ink", ink);
        }
      }
      for (const node of [...decisions.keys()]) {
        if (!node.isConnected) decisions.delete(node);
        else if (!seen.has(node) && node.closest("[data-fixed-ink]")) reset(node);
      }
    };

    // Compute synchronously so the first painted frame already has the final ink.
    update();
    image?.addEventListener("load", update);
    image?.addEventListener("error", update);

    let queued = false;
    const scheduleSync = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        update();
      });
    };
    let frameRequest = 0;
    const scheduleFrame = () => {
      if (frameRequest) return;
      frameRequest = requestAnimationFrame(() => {
        frameRequest = 0;
        update();
      });
    };
    const observer = new MutationObserver(scheduleSync);
    observer.observe(app, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["class", "open", "aria-expanded"] });
    app.addEventListener("kynex-appearance-preview", scheduleSync);
    app.addEventListener("focusin", scheduleFrame);
    app.addEventListener("focusout", scheduleFrame);
    const themeObserver = new MutationObserver(scheduleSync);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    window.addEventListener("resize", scheduleFrame, { passive: true });
    // Scrolling must never run the sampler per frame: wait until it settles,
    // then run in an idle slice.
    let scrollTimer = 0;
    const idle = (callback: () => void) => {
      const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
      if (ric) ric(callback, { timeout: 400 });
      else window.setTimeout(callback, 120);
    };
    const onScroll = () => {
      window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => idle(update), 260);
    };
    app.addEventListener("scroll", onScroll, { capture: true, passive: true });
    app.addEventListener("scrollend", scheduleFrame, { passive: true });
    // Follow video luminance without sampling on every playback frame.
    const video = app.querySelector<HTMLVideoElement>(".wallpaper-video");
    const interval = video ? window.setInterval(update, 1000) : 0;
    video?.addEventListener("loadeddata", scheduleFrame);
    video?.addEventListener("seeked", scheduleFrame);
    return () => {
      live = false;
      image?.removeEventListener("load", update);
      image?.removeEventListener("error", update);
      window.clearTimeout(settlingTimer);
      if (interval) window.clearInterval(interval);
      video?.removeEventListener("loadeddata", scheduleFrame);
      video?.removeEventListener("seeked", scheduleFrame);
      if (frameRequest) cancelAnimationFrame(frameRequest);
      window.clearTimeout(scrollTimer);
      observer.disconnect();
      themeObserver.disconnect();
      app.removeEventListener("kynex-appearance-preview", scheduleSync);
      app.removeEventListener("focusin", scheduleFrame);
      app.removeEventListener("focusout", scheduleFrame);
      window.removeEventListener("resize", scheduleFrame);
      app.removeEventListener("scroll", onScroll, true);
      app.removeEventListener("scrollend", scheduleFrame);
      // Keep the last ink while this effect re-runs (e.g. while dragging the
      // opacity slider); only remove it when adaptive mode is disabled.
      if (opacity >= 92) clearAll();
    };
  }, [root, wallpaper, opacity, page, theme]);
}
