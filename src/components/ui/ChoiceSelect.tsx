import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
type Choice = {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  group?: string;
  indent?: boolean;
};
type Props = {
  value?: string | number;
  onValueChange: (value: string) => void;
  children?: ReactNode;
  options?: Choice[];
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
  title?: string;
  name?: string;
};
function optionText(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      typeof child === "string" || typeof child === "number"
        ? String(child)
        : isValidElement<{ children?: ReactNode }>(child)
          ? optionText(child.props.children)
          : "",
    )
    .join("");
}
function choices(children: ReactNode): Choice[] {
  return Children.toArray(children).flatMap((child) => {
    if (
      !isValidElement<{
        value?: string | number;
        children?: ReactNode;
        disabled?: boolean;
      }>(child)
    )
      return [];
    return child.type === "option"
      ? [
          {
            value: String(
              child.props.value ?? optionText(child.props.children),
            ),
            label: optionText(child.props.children),
            disabled: child.props.disabled,
          },
        ]
      : choices(child.props.children);
  });
}
export function ChoiceSelect({
  value,
  onValueChange,
  children,
  options: supplied,
  className = "",
  disabled,
  "aria-label": label = "选择",
  title,
  name,
}: Props) {
  const options = supplied ?? choices(children);
  const selected = options.findIndex((item) => item.value === String(value));
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(Math.max(0, selected));
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    width: 200,
    height: 260,
  });
  const trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  const search = useRef({ text: "", time: 0 });
  const id = useId();
  const enabled = (index: number) => !options[index]?.disabled;
  function close() {
    setOpen(false);
    setClosing(true);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setClosing(false),
      matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 100);
    requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  }
  function choose(index: number) {
    if (!enabled(index)) return;
    onValueChange(options[index].value);
    close();
    trigger.current?.focus({ preventScroll: true });
  }
  function show() {
    if (disabled || !options.length) return;
    setActive(Math.max(0, selected));
    clearTimeout(closeTimer.current);
    setClosing(false);
    setOpen(true);
  }
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useLayoutEffect(() => {
    if ((!open && !closing) || !menu.current) return;
    const root = document.querySelector(".app");
    const restored = new Map<HTMLElement, { value: string; priority: string }>();
    const shield = () => {
      // Cut the covered region out of the interface beneath the portal. The
      // actual wallpaper remains visible even when the menu itself is clear.
      for (const [node, old] of restored) node.style.setProperty("clip-path", old.value, old.priority);
      restored.clear();
      const bounds = { left: position.left, top: position.top, right: position.left + position.width, bottom: position.top + menu.current!.offsetHeight };
      for (const node of root?.querySelectorAll<HTMLElement>("*") ?? []) {
        if (!(node instanceof HTMLElement) || node.closest(".wallpaper,.wallpaper-video,.scrim,.ui-tint,.choice-popover")) continue;
        const r = node.getBoundingClientRect();
        if (!r.width || !r.height || r.left >= bounds.right || r.right <= bounds.left || r.top >= bounds.bottom || r.bottom <= bounds.top) continue;
        const sx = node.offsetWidth / r.width, sy = node.offsetHeight / r.height;
        const l = (bounds.left - r.left) * sx, t = (bounds.top - r.top) * sy;
        const right = (bounds.right - r.left) * sx, bottom = (bounds.bottom - r.top) * sy;
        const rx = 16 * sx, ry = 16 * sy;
        const extent = Math.max(innerWidth, innerHeight, r.width, r.height) * 4;
        restored.set(node, { value: node.style.getPropertyValue("clip-path"), priority: node.style.getPropertyPriority("clip-path") });
        node.style.setProperty("clip-path", `path(evenodd, "M ${-extent} ${-extent} H ${extent} V ${extent} H ${-extent} Z M ${l + rx} ${t} H ${right - rx} Q ${right} ${t} ${right} ${t + ry} V ${bottom - ry} Q ${right} ${bottom} ${right - rx} ${bottom} H ${l + rx} Q ${l} ${bottom} ${l} ${bottom - ry} V ${t + ry} Q ${l} ${t} ${l + rx} ${t} Z")`);
      }
    };
    shield();
    const resize = new ResizeObserver(shield);
    resize.observe(menu.current);
    return () => {
      resize.disconnect();
      for (const [node, old] of restored) node.style.setProperty("clip-path", old.value, old.priority);
    };
  }, [open, closing, position]);
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const place = () => {
      const r = trigger.current!.getBoundingClientRect(),
        edge = 14;
      const requested = Math.min(292, options.length * 44 + 12),
        below = innerHeight - r.bottom - edge - 6,
        above = r.top - edge - 6;
      const down = below >= Math.min(requested, 190) || below >= above;
      const height = Math.min(requested, Math.max(80, down ? below : above));
      const width = Math.min(Math.max(r.width, 220), innerWidth - edge * 2);
      setPosition({
        left: Math.max(edge, Math.min(r.left, innerWidth - width - edge)),
        top: down ? r.bottom + 6 : r.top - height - 6,
        width,
        height,
      });
    };
    const outside = (event: PointerEvent) => {
      if (
        !menu.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        close();
    };
    const scroll = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) place();
    };
    place();
    menu.current?.focus({ preventScroll: true });
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", place);
    document.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", scroll, true);
    };
  }, [open, options.length]);
  useEffect(() => {
    if (open)
      document
        .getElementById(`${id}-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, open, id]);
  function keyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "Tab") {
      close();
      return;
    }
    if (
      ["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (!open) {
        show();
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        choose(active);
        return;
      }
      const direction = event.key === "ArrowUp" ? -1 : 1;
      let next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? options.length - 1
            : (active + direction + options.length) % options.length;
      for (let n = 0; n < options.length && !enabled(next); n++)
        next = (next + direction + options.length) % options.length;
      setActive(next);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      const now = performance.now();
      search.current = {
        text:
          (now - search.current.time < 700 ? search.current.text : "") +
          event.key.toLowerCase(),
        time: now,
      };
      const match = options.findIndex(
        (item) =>
          !item.disabled &&
          item.label.toLowerCase().startsWith(search.current.text),
      );
      if (match >= 0) {
        if (!open) show();
        setActive(match);
        event.preventDefault();
      }
    }
  }
  return (
    <div className={`choice-select ${className.replace(/\binput\b/g, "")}`}>
      {name && <input type="hidden" name={name} value={value ?? ""} />}
      <button
        type="button"
        ref={trigger}
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        disabled={disabled}
        title={title ?? options[selected]?.label}
        className={`choice-trigger ${open ? "open" : ""}`}
        onClick={() => (open ? close() : show())}
        onKeyDown={keyDown}
      >
        <span>
          <b>{options[selected]?.label ?? options[0]?.label ?? "请选择"}</b>
          {options[selected]?.hint && <small>{options[selected].hint}</small>}
        </span>
        <ChevronDown size={15} />
      </button>
      {(open || closing) &&
        createPortal(
          <div
            className={`choice-popover ${closing ? "is-closing" : ""}`}
            aria-hidden={closing || undefined}
            ref={menu}
            style={{
              position: "fixed",
              left: position.left,
              top: position.top,
              width: position.width,
              maxHeight: position.height,
            }}
            role="listbox"
            tabIndex={-1}
            aria-activedescendant={`${id}-${active}`}
            onKeyDown={keyDown}
            aria-label={label}
            id={id}
          >
            {options.map((item, index) => (
              <Fragment key={item.value}>
                {item.group && item.group !== options[index - 1]?.group && (
                  <div className="choice-group" role="presentation">
                    {item.group}
                  </div>
                )}
                <div
                  id={`${id}-${index}`}
                  role="option"
                  aria-selected={item.value === String(value)}
                  aria-disabled={item.disabled || undefined}
                  data-active={active === index || undefined}
                  className={`choice-option ${item.indent ? "indent" : ""}`}
                  onPointerMove={() => setActive(index)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(index)}
                >
                  <span>
                    <b>{item.label}</b>
                    {item.hint && <small>{item.hint}</small>}
                  </span>
                  {item.value === String(value) ? (
                    <Check size={15} />
                  ) : (
                    <span className="choice-check-space" />
                  )}
                </div>
              </Fragment>
            ))}
          </div>,
          document.querySelector(".app") ?? document.body,
        )}
    </div>
  );
}
