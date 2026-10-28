import {
  Children,
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
    setOpen(true);
  }
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const place = () => {
      const r = trigger.current!.getBoundingClientRect(),
        edge = 14;
      const requested = Math.min(292, options.length * 44 + 12),
        below = innerHeight - r.bottom - edge,
        above = r.top - edge;
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
      {open &&
        createPortal(
          <div
            className="choice-popover"
            ref={menu}
            style={{
              position: "fixed",
              left: position.left,
              top: position.top,
              width: position.width,
              maxHeight: position.height,
            }}
            role="listbox"
            aria-label={label}
            id={id}
          >
            {options.map((item, index) => (
              <div
                key={item.value}
                id={`${id}-${index}`}
                role="option"
                aria-selected={item.value === String(value)}
                aria-disabled={item.disabled || undefined}
                data-active={active === index || undefined}
                className="choice-option"
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
            ))}
          </div>,
          document.querySelector(".app") ?? document.body,
        )}
    </div>
  );
}
