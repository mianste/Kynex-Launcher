import { ChoiceSelect } from "./ChoiceSelect";
export { ChoiceSelect } from "./ChoiceSelect";
import {
  useEffect,
  useContext,
  useRef,
  useId,
  useState,
  type CSSProperties,
  type ReactNode,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { X, Search, LoaderCircle, Check, ChevronDown } from "lucide-react";
import { useStore } from "../../store";
import { MotionExitContext, MotionPresence } from "./Motion";
export function Button({
  children,
  primary = false,
  busy = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  primary?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      className={`btn ${primary ? "primary" : ""} ${props.className ?? ""}`}
      disabled={props.disabled || busy}
    >
      {busy && <LoaderCircle className="spin" size={16} />} {children}
    </button>
  );
}
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input ${props.className ?? ""}`} />;
}
export function MemorySlider({
  value,
  onChange,
  min = 512,
  max = 65536,
  step = 512,
  label = "内存分配",
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
}) {
  const safe = Math.min(max, Math.max(min, value || min));
  const fill = ((safe - min) / (max - min)) * 100;
  const gb = (safe / 1024).toFixed(safe % 1024 === 0 ? 0 : 1);
  return (
    <div className="memory-slider">
      <div className="memory-slider-head">
        <b>{safe} MB</b>
        <span>{gb} GB</span>
      </div>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={safe}
        style={{ "--fill": `${fill}%` } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <div className="memory-slider-scale">
        <span>{min / 1024} GB</span>
        <span>{max / 1024} GB</span>
      </div>
    </div>
  );
}
export function OptionSelect({
  value,
  options,
  onChange,
  label,
  className = "",
  disabled = false,
}: {
  value: string;
  options: {
    value: string;
    label: string;
    hint?: string;
    disabled?: boolean;
  }[];
  onChange: (value: string) => void;
  label: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <ChoiceSelect
      value={value}
      options={options}
      onValueChange={onChange}
      aria-label={label}
      className={className}
      disabled={disabled}
    />
  );
}
export function SearchInput({
  value,
  onChange,
  placeholder = "搜索…",
}: {
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="search">
      <Search size={16} />
      <input
        aria-label={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}
export function Badge({
  children,
  tone = "",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Chip({
  children,
  active,
  onClick,
}: {
  children: ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`chip ${active ? "on" : ""}`}
      onClick={onClick}
      aria-pressed={!!active}
    >
      {children}
    </button>
  );
}
export function Switch({
  on,
  change,
  label,
}: {
  on: boolean;
  change: (on: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className={`switch ${on ? "on" : ""}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => change(!on)}
    >
      <i />
    </button>
  );
}
export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`card ${className}`}>{children}</div>;
}
export function Tabs({
  items,
  value,
  onChange,
}: {
  items: string[];
  value: string;
  onChange: (s: string) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map((t) => (
        <button
          key={t}
          role="tab"
          aria-selected={t === value}
          className={t === value ? "on" : ""}
          onClick={() => onChange(t)}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
export function Select({
  value,
  options,
  change,
  label,
}: {
  value: string;
  options: { value: string; label: string }[];
  change: (s: string) => void;
  label: string;
}) {
  return (
    <ChoiceSelect
      className="input"
      aria-label={label}
      value={value}
      onValueChange={(selectedValue) => change(selectedValue)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </ChoiceSelect>
  );
}
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Row({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="setting-row">
      <div className="setting-label">
        <b>{title}</b>
        {hint && <small>{hint}</small>}
      </div>
      <div className="setting-row-controls">{children}</div>
    </div>
  );
}
export function Empty({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">◇</div>
      <h3>{title}</h3>
      <p>{detail}</p>
      {children}
    </div>
  );
}
export function Modal({
  title,
  children,
  footer,
  wide = false,
  onClose,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  onClose?: () => void;
}) {
  const hide = useStore((s) => s.hide);
  const exiting = useContext(MotionExitContext);
  const close = onClose ?? hide;
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input,button,select")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const a = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]',
          ) ?? [],
        );
        if (e.shiftKey && document.activeElement === a[0]) {
          e.preventDefault();
          a.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === a.at(-1)) {
          e.preventDefault();
          a[0]?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      before?.focus();
    };
  }, [close]);
  return createPortal(
    <div
        className={`overlay ${exiting ? "is-exiting" : ""}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className={`modal ${wide ? "wide" : ""}`}
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
      >
        <header>
          <h2 id={id}>{title}</h2>
          <button aria-label="关闭弹窗" onClick={close}>
            <X size={18} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
      </div>,
      document.querySelector(".app") ?? document.body
  );
}
export function Toast() {
  const msg = useStore((s) => s.message);
  useEffect(() => {
    if (msg) {
      const t = setTimeout(() => useStore.setState({ message: "" }), 5000);
      return () => clearTimeout(t);
    }
  }, [msg]);
  return (
    <MotionPresence toast>
      {msg ? (
        <div
          role="status"
          className="toast"
          onClick={() => useStore.setState({ message: "" })}
        >
          <Check size={16} />
          {msg}
        </div>
      ) : null}
    </MotionPresence>
  );
}
export function ProgressBar({ done, total }: { done: number; total: number }) {
  return (
    <progress max={Math.max(1, total)} value={done} aria-label="任务进度" />
  );
}
export function Tooltip({
  children,
  text,
}: {
  children: ReactNode;
  text: string;
}) {
  return <span title={text}>{children}</span>;
}
export function Skeleton() {
  return <div className="skeleton" aria-label="正在加载" />;
}
export const Segmented = Tabs;
