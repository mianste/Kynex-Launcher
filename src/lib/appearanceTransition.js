import { flushSync } from "react-dom";
const appearanceKeys = new Set([
  "theme",
  "accent",
  "customThemeColor",
  "wallpaper",
  "holidayThemeEnabled",
  "holidayWallpaper",
  "holidayRegion",
  "holidayWindowDays",
  "holidayDismissed",
]);
export function changesAppearance(patch) {
  return Object.keys(patch).some((key) => appearanceKeys.has(key));
}

let revision = 0;
let pending = {};
let active;
export async function transitionAppearance(settings, patch, apply) {
  const request = ++revision;
  pending = { ...pending, ...patch };
  active?.skipTransition();
  let applied = false;
  const commit = () => {
    if (request !== revision || applied) return;
    applied = true;
    const latest = pending;
    pending = {};
    flushSync(() => apply(latest));
  };
  // Backgrounds have their own ready-to-paint layers. Root snapshots would
  // resurrect an earlier holiday/video frame when another switch is clicked.
  if (
    Object.keys(patch).some(
      (key) => key === "wallpaper" || key.startsWith("holiday"),
    )
  ) {
    commit();
    return;
  }
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || document.hidden) {
    commit();
    return;
  }
  if (!document.startViewTransition) {
    commit();
    return;
  }
  try {
    const transition = document.startViewTransition(async () => {
      commit();
      // Let cached wallpaper decoding and readable-ink calibration settle
      // before capturing the new appearance.
      // Rendering is paused during this callback, so waiting for rAF here
      // would deadlock the browser's snapshot capture.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    active = transition;
    transition.ready.catch(() => {});
    transition.finished
      .catch(() => {})
      .finally(() => {
        if (active === transition) active = undefined;
      });
    await transition.updateCallbackDone;
  } catch {
    commit();
  }
}
