import { useEffect } from "react";

// One-shot compositor animation. No frame loop or React updates on pointer input.
export function pressWave(event, button = event.currentTarget) {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  if (button.disabled || !button.animate) return;
  const box = button.getBoundingClientRect();
  const size = Math.hypot(box.width, box.height) * 2;
  const wave = document.createElement("span");
  wave.className = "kxl-press-wave";
  wave.setAttribute("aria-hidden", "true");
  const centered = event.type === "click" && event.detail === 0;
  Object.assign(wave.style, {
    width: `${size}px`,
    height: `${size}px`,
    left: `${(centered ? box.width / 2 : event.clientX - box.left) - size / 2}px`,
    top: `${(centered ? box.height / 2 : event.clientY - box.top) - size / 2}px`,
  });
  for (const previous of button.querySelectorAll(".kxl-press-wave")) {
    previous.getAnimations().forEach((animation) => animation.cancel());
    previous.remove();
  }
  button.append(wave);
  const animation = wave.animate(
    [
      { transform: "scale(0.05)", opacity: 0.22 },
      { transform: "scale(1)", opacity: 0 },
    ],
    { duration: 440, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
  );
  animation.finished.catch(() => {}).finally(() => wave.remove());
}

// Existing bespoke controls share the same feedback without individual handlers.
export function useMotionFeedback(root) {
  useEffect(() => {
    const app = root.current;
    if (!app) return;
    const feedback = (event) => {
      if (event.type === "pointerdown" && event.button !== 0) return;
      if (event.type === "click" && event.detail !== 0) return;
      const button = event.target.closest?.(
        ".chip,.nav > button,.settings-nav button,.choice-trigger,.taskbar button,.music-main,.music-quick-play",
      );
      if (!button || button.classList.contains("btn") || !app.contains(button))
        return;
      pressWave(event, button);
    };
    app.addEventListener("pointerdown", feedback);
    app.addEventListener("click", feedback);
    return () => {
      app.removeEventListener("pointerdown", feedback);
      app.removeEventListener("click", feedback);
    };
  }, [root]);
}
