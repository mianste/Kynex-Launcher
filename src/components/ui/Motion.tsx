import {
  createContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
export const MotionExitContext = createContext(false);
export function MotionPresence({
  children,
  toast = false,
}: {
  children: ReactElement | null | false;
  toast?: boolean;
}) {
  const [shown, Shown] = useState(children),
    [leaving, Leaving] = useState(false);
  useLayoutEffect(() => {
    if (children) {
      Shown(children);
      Leaving(false);
      return;
    }
    Leaving(true);
    const t = setTimeout(
      () => Shown(null),
      matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 120,
    );
    return () => clearTimeout(t);
  }, [children]);
  return shown ? (
    <MotionExitContext.Provider value={leaving}>
    <div
      className={`motion-presence ${toast ? "toast-presence" : ""} ${leaving ? "is-exiting" : ""}`}
    >
      {shown}
    </div>
    </MotionExitContext.Provider>
  ) : null;
}
export function MotionPage({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const surface = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const motion = surface.current?.animate(
      [
        { opacity: 0, transform: "translateY(10px)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 240, easing: "cubic-bezier(.22,1,.36,1)" },
    );
    return () => motion?.cancel();
  }, [id]);
  return (
    <section
      ref={surface}
      key={id}
      className={`page-content ${id === "home" ? "home" : ""} page-entering`}
    >
      {children}
    </section>
  );
}
export function Disclosure({
  title,
  children,
  initialOpen = false,
  className = "",
}: {
  title: string;
  children: ReactNode;
  initialOpen?: boolean;
  className?: string;
}) {
  const [open, Open] = useState(initialOpen),
    [height, Height] = useState(0);
  const content = useRef<HTMLDivElement>(null),
    wrapper = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = content.current;
    if (!el) return;
    const update = () => Height(el.getBoundingClientRect().height);
    const observer = new ResizeObserver(update);
    observer.observe(el);
    update();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (wrapper.current) wrapper.current.inert = !open;
  }, [open]);
  return (
    <div className={`disclosure ${className}`}>
      <button
        className="disclosure-toggle"
        aria-expanded={open}
        onClick={() => Open(!open)}
      >
        <span className={open ? "on" : ""}>›</span>
        {title}
      </button>
      <div
        className="disclosure-height"
        ref={wrapper}
        aria-hidden={!open}
        style={{ height: open ? height : 0 }}
      >
        <div ref={content}>{children}</div>
      </div>
    </div>
  );
}
