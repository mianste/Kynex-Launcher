import {
  createContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
export const MotionExitContext = createContext(false);
export function MotionPresence({ children, toast = false }) {
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
export function MotionPage({ id, children }) {
  const [entries, setEntries] = useState(() => [
    { id, children, leaving: false },
  ]);
  const exitTimer = useRef(0);

  useLayoutEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    setEntries((prev) => {
      const active = prev.find((e) => !e.leaving);
      if (active && active.id === id) {
        return prev.map((e) =>
          e.id === id ? { ...e, children, leaving: false } : e,
        );
      }

      if (exitTimer.current) {
        window.clearTimeout(exitTimer.current);
        exitTimer.current = 0;
      }

      const involvesHome = active && (active.id === "home" || id === "home");
      if (!active || reduced || !involvesHome) {
        return [{ id, children, leaving: false }];
      }

      const leavingEntry = { ...active, leaving: true };
      const nextEntry = { id, children, leaving: false };
      const duration = id === "home" ? 260 : 200;
      exitTimer.current = window.setTimeout(() => {
        exitTimer.current = 0;
        setEntries((curr) => curr.filter((e) => !e.leaving));
      }, duration);
      return [leavingEntry, nextEntry];
    });
  }, [id, children]);

  useEffect(
    () => () => {
      if (exitTimer.current) window.clearTimeout(exitTimer.current);
    },
    [],
  );

  return (
    <>
      {entries.map((entry) => (
        <section
          key={entry.id}
          aria-hidden={entry.leaving ? "true" : undefined}
          className={`page-content ${entry.id === "home" ? "home" : ""} ${
            entry.leaving ? "page-leaving" : "page-entering"
          }`}
        >
          {entry.children}
        </section>
      ))}
    </>
  );
}
export function Disclosure({
  title,
  children,
  initialOpen = false,
  className = "",
}) {
  const [open, Open] = useState(initialOpen),
    [height, Height] = useState(0);
  const content = useRef(null),
    wrapper = useRef(null);
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
