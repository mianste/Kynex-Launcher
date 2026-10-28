import { useLayoutEffect, type RefObject } from "react";
export function useSelectionMotion(
  root: RefObject<HTMLElement>,
  selector = "button.on",
) {
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const update = () => {
      const selected = node.querySelector<HTMLElement>(selector);
      if (!selected) {
        node.style.setProperty("--selection-ready", "0");
        return;
      }
      const box = selected.getBoundingClientRect(),
        parent = node.getBoundingClientRect();
      for (const [name, value] of Object.entries({
        x: box.x - parent.x,
        y: box.y - parent.y,
        width: box.width,
        height: box.height,
      }))
        node.style.setProperty(`--selection-${name}`, `${value}px`);
      node.style.setProperty("--selection-ready", "1");
    };
    const observer = new MutationObserver(update);
    observer.observe(node, {
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "aria-selected", "aria-current"],
    });
    const resize = new ResizeObserver(update);
    resize.observe(node);
    update();
    return () => {
      observer.disconnect();
      resize.disconnect();
    };
  }, [root, selector]);
}
