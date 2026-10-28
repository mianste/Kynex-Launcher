import { useEffect, type RefObject } from "react";

/** Mouse wheel easing; precision touchpad input and scrollbar dragging stay native. */
export function useSmoothWheel(root: RefObject<HTMLElement>) {
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let owner: HTMLElement | null = null;
    let target = 0;
    let frame = 0;
    let previous = 0;
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      owner = null;
    };
    const tick = (now: number) => {
      if (!owner?.isConnected || reduced.matches) {
        stop();
        return;
      }
      const dt = Math.min(40, now - previous || 16);
      previous = now;
      target = Math.max(
        0,
        Math.min(owner.scrollHeight - owner.clientHeight, target),
      );
      const remaining = target - owner.scrollTop;
      if (Math.abs(remaining) < 0.6) {
        owner.scrollTop = target;
        stop();
        return;
      }
      owner.scrollTop += remaining * (1 - Math.exp(-dt / 75));
      frame = requestAnimationFrame(tick);
    };
    const wheel = (event: WheelEvent) => {
      if (
        event.ctrlKey ||
        event.shiftKey ||
        reduced.matches ||
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
      )
        return;
      if (event.deltaMode === 0 && Math.abs(event.deltaY) < 50) {
        stop();
        return;
      }
      const start = event.target as HTMLElement;
      if (start.closest("input,textarea,select,[contenteditable='true']"))
        return;
      let scroll: HTMLElement | null = start;
      while (scroll && element.contains(scroll)) {
        if (
          /(auto|scroll)/.test(getComputedStyle(scroll).overflowY) &&
          scroll.scrollHeight > scroll.clientHeight + 1
        )
          break;
        scroll = scroll.parentElement;
      }
      if (!scroll || !element.contains(scroll)) return;
      event.preventDefault();
      const amount =
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? scroll.clientHeight
            : 1);
      if (owner !== scroll) {
        stop();
        owner = scroll;
        target = scroll.scrollTop;
      }
      target = Math.max(
        0,
        Math.min(scroll.scrollHeight - scroll.clientHeight, target + amount),
      );
      if (!frame) {
        previous = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };
    element.addEventListener("wheel", wheel, { passive: false });
    element.addEventListener("pointerdown", stop, true);
    element.addEventListener("keydown", stop, true);
    return () => {
      stop();
      element.removeEventListener("wheel", wheel);
      element.removeEventListener("pointerdown", stop, true);
      element.removeEventListener("keydown", stop, true);
    };
  }, [root]);
}
