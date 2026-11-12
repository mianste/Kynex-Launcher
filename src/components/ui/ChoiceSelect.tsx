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
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    bottom: 0,
    down: true,
    width: 200,
    height: 260,
  });
  const trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  const search = useRef({ text: "", time: 0 });
  const id = useId();
  const enabled = (index: number) =>
    !!options[index] && !options[index].disabled;
  function measure() {
    const bounds = trigger.current!.getBoundingClientRect();
    const edge = 10;
    const gap = 6;
    const requested = Math.min(292, options.length * 44 + 12);
    const below = innerHeight - bounds.bottom - edge - gap;
    const above = bounds.top - edge - gap;
    const down = below >= Math.min(requested, 190) || below >= above;
    const width = Math.min(Math.max(bounds.width, 220), innerWidth - edge * 2);
    return {
      left: Math.max(edge, Math.min(bounds.left, innerWidth - width - edge)),
      top: Math.max(edge, bounds.bottom + gap),
      bottom: Math.max(edge, innerHeight - bounds.top + gap),
      down,
      width,
      height: Math.max(0, Math.min(requested, down ? below : above)),
    };
  }
  function choose(index: number) {
    if (!enabled(index)) return;
    setOpen(false);
    onValueChange(options[index].value);
  }
  function show(
    index = enabled(selected)
      ? selected
      : options.findIndex((item) => !item.disabled),
  ) {
    if (disabled || index < 0 || !trigger.current) return;
    setPosition(measure());
    setActive(index);
    setOpen(true);
  }
  useLayoutEffect(() => {
    if (!open || !menu.current) return;
    const root = document.querySelector(".app");
    // Opaque menus already cover the page. Cutting a hole beneath them is
    // unnecessary and can expose wallpaper during compositor updates.

    const restored = new Map<
      HTMLElement,
      { value: string; priority: string }
    >();
    const shield = () => {
      // Only mask sibling surfaces. Mutating every descendant creates nested
      // clipping contexts and can leave blank holes when menus switch quickly.
      for (const [node, old] of restored)
        node.style.setProperty("mask-image", old.value, old.priority);
      restored.clear();
      if (
        !menu.current ||
        !root ||
        parseFloat(getComputedStyle(root).getPropertyValue("--ui-alpha")) >= 100
      )
        return;
      const bounds = menu.current.getBoundingClientRect();
      for (const node of root?.querySelectorAll<HTMLElement>(
        ":scope > .page-content,:scope > .nav,:scope > .taskbar,:scope > .assistant-panel,:scope > .music-shell,:scope > .overlay,:scope > .onboarding-tour",
      ) ?? []) {
        if (node.contains(menu.current)) continue;
        const r = node.getBoundingClientRect();
        if (
          !r.width ||
          !r.height ||
          r.left >= bounds.right ||
          r.right <= bounds.left ||
          r.top >= bounds.bottom ||
          r.bottom <= bounds.top
        )
          continue;
        const sx = node.offsetWidth / r.width,
          sy = node.offsetHeight / r.height;
        const l = (bounds.left - r.left) * sx,
          t = (bounds.top - r.top) * sy;
        const right = (bounds.right - r.left) * sx,
          bottom = (bounds.bottom - r.top) * sy;
        const rx = 16 * sx,
          ry = 16 * sy;
        const extent = Math.max(innerWidth, innerHeight, r.width, r.height) * 4;
        restored.set(node, {
          value: node.style.getPropertyValue("mask-image"),
          priority: node.style.getPropertyPriority("mask-image"),
        });
        // Use a separate alpha mask so the menu intersects with the assistant's
        // clip-path instead of replacing it. Both cutouts must stay effective.
        const path = `M ${-extent} ${-extent} H ${extent} V ${extent} H ${-extent} Z M ${l + rx} ${t} H ${right - rx} Q ${right} ${t} ${right} ${t + ry} V ${bottom - ry} Q ${right} ${bottom} ${right - rx} ${bottom} H ${l + rx} Q ${l} ${bottom} ${l} ${bottom - ry} V ${t + ry} Q ${l} ${t} ${l + rx} ${t} Z`;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${node.offsetWidth}" height="${node.offsetHeight}" viewBox="0 0 ${node.offsetWidth} ${node.offsetHeight}"><path fill="white" fill-rule="evenodd" d="${path}"/></svg>`;
        node.style.setProperty(
          "mask-image",
          `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
          "important",
        );
      }
    };
    shield();
    const resize = new ResizeObserver(shield);
    resize.observe(menu.current);
    const theme = new MutationObserver(shield);
    if (root)
      theme.observe(root, { attributes: true, attributeFilter: ["style"] });
    return () => {
      resize.disconnect();
      theme.disconnect();
      for (const [node, old] of restored)
        node.style.setProperty("mask-image", old.value, old.priority);
    };
  }, [open, position]);
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const place = () => {
      if (!trigger.current) return;
      const bounds = trigger.current.getBoundingClientRect();
      if (bounds.bottom <= 0 || bounds.top >= innerHeight) {
        setOpen(false);
        return;
      }
      setPosition(measure());
    };
    const outside = (event: PointerEvent) => {
      if (
        !menu.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const scroll = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) place();
    };
    const resize = new ResizeObserver(place);
    resize.observe(trigger.current);
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", place);
    document.addEventListener("scroll", scroll, true);
    return () => {
      resize.disconnect();
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", scroll, true);
    };
  }, [open, options.length]);
  useEffect(() => {
    if (!open || !menu.current) return;
    const option = document.getElementById(`${id}-${active}`);
    if (!option) return;
    const bounds = menu.current.getBoundingClientRect();
    const row = option.getBoundingClientRect();
    if (row.top < bounds.top) menu.current.scrollTop += row.top - bounds.top;
    else if (row.bottom > bounds.bottom)
      menu.current.scrollTop += row.bottom - bounds.bottom;
  }, [active, open, id]);
  useEffect(() => {
    if (disabled || !options.length) setOpen(false);
  }, [disabled, options.length]);
  function keyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
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
      const direction = ["ArrowUp", "End"].includes(event.key) ? -1 : 1;
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
        if (!open) show(match);
        else setActive(match);
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
        onClick={() => (open ? setOpen(false) : show())}
        onBlur={() => setOpen(false)}
        onKeyDown={keyDown}
      >
        <span>
          <b>{options[selected]?.label ?? options[0]?.label ?? "请选择"}</b>
          {options[selected]?.hint && <small>{options[selected].hint}</small>}
        </span>
        <ChevronDown size={15} />
      </button>
      {open &&
        createPortal(
          <div
            className="choice-popover"
            ref={menu}
            style={{
              position: "fixed",
              left: position.left,
              top: position.down ? position.top : undefined,
              bottom: position.down ? undefined : position.bottom,
              width: position.width,
              maxHeight: position.height,
            }}
            role="listbox"
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
                  onPointerMove={() => {
                    if (enabled(index)) setActive(index);
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(index)}
                >
                  <span>
                    <b>{item.label}</b>
                    {item.hint && <small>{item.hint}</small>}
                  </span>
                  {item.value === String(value) ? (
                    <Check
                      size={15}
                      className="choice-selected-mark"
                      aria-hidden="true"
                    />
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
