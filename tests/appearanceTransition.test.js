import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("react-dom", () => ({ flushSync: (fn) => fn() }));
const settings = {
  theme: "light",
  wallpaper: "island",
  holidayThemeEnabled: false,
};
let apply;
beforeEach(() => {
  vi.resetModules();
  apply = vi.fn();
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.stubGlobal("document", { hidden: false });
  vi.stubGlobal("requestAnimationFrame", (callback) => {
    callback(0);
    return 1;
  });
});
afterEach(() => vi.unstubAllGlobals());
describe("外观过渡", () => {
  it("keeps slider and game settings outside the snapshot transition", async () => {
    const { changesAppearance, transitionAppearance } =
      await import("../src/lib/appearanceTransition");
    expect(changesAppearance({ memory: 4096, uiOpacity: 59 })).toBe(false);
    expect(changesAppearance({ theme: "liquid" })).toBe(true);
    await transitionAppearance(settings, { theme: "liquid" }, apply);
    expect(apply).toHaveBeenCalledExactlyOnceWith({ theme: "liquid" });
  });
  it("commits background switches immediately and cancels stale theme snapshots", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const skip = vi.fn();
    document.startViewTransition = (callback) => {
      const done = Promise.resolve().then(callback);
      return {
        updateCallbackDone: done,
        ready: done,
        finished: done,
        skipTransition: skip,
      };
    };
    const { transitionAppearance } =
      await import("../src/lib/appearanceTransition");
    const first = transitionAppearance(settings, { theme: "dark" }, apply);
    const second = transitionAppearance(
      settings,
      { holidayThemeEnabled: false, holidayWallpaper: false },
      apply,
    );
    expect(apply).toHaveBeenCalledExactlyOnceWith({
      theme: "dark",
      holidayThemeEnabled: false,
      holidayWallpaper: false,
    });
    await Promise.all([first, second]);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(skip).toHaveBeenCalledOnce();
  });
  it("interrupts the old snapshot and commits only the latest queued theme", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const snapshots = [];
    document.startViewTransition = (callback) => {
      const done = Promise.resolve().then(callback);
      const snapshot = {
        updateCallbackDone: done,
        ready: done,
        finished: done,
        skipTransition: vi.fn(),
      };
      snapshots.push(snapshot);
      return snapshot;
    };
    const { transitionAppearance } =
      await import("../src/lib/appearanceTransition");
    const first = transitionAppearance(settings, { theme: "dark" }, apply);
    const second = transitionAppearance(settings, { theme: "liquid" }, apply);
    await Promise.all([first, second]);
    expect(snapshots[0].skipTransition).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledExactlyOnceWith({ theme: "liquid" });
  });
  it("uses a short fallback without delaying the saved preference on older browsers", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const animate = vi.fn();
    document.querySelector = () => ({ animate });
    const { transitionAppearance } =
      await import("../src/lib/appearanceTransition");
    await transitionAppearance(settings, { theme: "dark" }, apply);
    expect(apply).toHaveBeenCalledExactlyOnceWith({ theme: "dark" });
    expect(animate).toHaveBeenCalledOnce();
  });
});
