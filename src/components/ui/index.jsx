import { pressWave } from "../../lib/motionFeedback";
import { ChoiceSelect } from "./ChoiceSelect";
export { ChoiceSelect } from "./ChoiceSelect";
import { useEffect, useContext, useRef, useId, useState } from "react";
import { createPortal } from "react-dom";
import { X, Search, LoaderCircle, Check } from "lucide-react";
import { useStore } from "../../store";
import { MotionExitContext, MotionPresence } from "./Motion";
export function Button({ children, primary = false, busy = false, ...props }) {
  return (
    <button
      {...props}
      onPointerDown={(event) => {
        props.onPointerDown?.(event);
        if (!event.defaultPrevented && event.button === 0) pressWave(event);
      }}
      onClick={(event) => {
        if (event.detail === 0) pressWave(event);
        props.onClick?.(event);
      }}
      className={`btn ${primary ? "primary" : ""} ${props.className ?? ""}`}
      disabled={props.disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy && <LoaderCircle className="spin" size={16} />} {children}
    </button>
  );
}
export function Input(props) {
  return <input {...props} className={`input ${props.className ?? ""}`} />;
}
export function MemorySlider({
  value,
  onChange,
  min = 512,
  max = 65536,
  step = 512,
  label = "内存分配",
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
        style={{ "--fill": `${fill}%` }}
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
export function SearchInput({ value, onChange, placeholder = "搜索…" }) {
  // 中文输入法组合期间不触发检索，等 compositionend 再一次性提交最终文字，
  // 避免只输入一两个字符时被拼音中间态覆盖、看起来“搜索没反应”。
  const [draft, setDraft] = useState(value);
  const composing = useRef(false);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  return (
    <label className="search">
      <Search size={16} />
      <input
        aria-label={placeholder}
        value={draft}
        placeholder={placeholder}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          const next = event.currentTarget.value;
          setDraft(next);
          onChange(next);
        }}
        onBlur={(event) => {
          composing.current = false;
          onChange(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            composing.current = false;
            onChange(event.currentTarget.value);
          }
        }}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          if (!composing.current) onChange(next);
        }}
      />
    </label>
  );
}
export function Badge({ children, tone = "" }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Chip({ children, active, onClick }) {
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
export function Switch({ on, change, label, disabled = false }) {
  return (
    <button
      type="button"
      className={`switch ${on ? "on" : ""}`}
      role="switch"
      disabled={disabled}
      aria-checked={on}
      aria-label={label}
      onClick={() => change(!on)}
    >
      <i />
    </button>
  );
}
export function Card({ children, className = "" }) {
  return <div className={`card ${className}`}>{children}</div>;
}
export function Tabs({ items, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((t) => (
        <button
          key={t}
          role="tab"
          data-guide-tab={t}
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
export function Select({ value, options, change, label }) {
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
export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Row({ title, hint, children }) {
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
export function Empty({ title, detail, children }) {
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
  className = "",
  onClose,
  hideCloseButton = false,
}) {
  const hide = useStore((s) => s.hide);
  const exiting = useContext(MotionExitContext);
  const close = onClose ?? hide;
  const closeRef = useRef(close);
  const ref = useRef(null);
  const id = useId();
  useEffect(() => {
    closeRef.current = close;
  }, [close]);
  useEffect(() => {
    const before = document.activeElement;
    (
      ref.current?.querySelector(
        "input:not(:disabled),button:not(:disabled),select:not(:disabled)",
      ) ?? ref.current
    )?.focus();
    const key = (e) => {
      if (e.key === "Escape" && !e.isComposing) closeRef.current();
      if (e.key === "Tab") {
        const a = Array.from(
          ref.current?.querySelectorAll(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]',
          ) ?? [],
        );
        if (!a.length) {
          e.preventDefault();
        } else if (
          e.shiftKey &&
          (document.activeElement === a[0] ||
            document.activeElement === ref.current)
        ) {
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
  }, []);
  return createPortal(
    <div
      className={`overlay ${exiting ? "is-exiting" : ""}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className={`modal ${wide ? "wide" : ""} ${className}`}
        ref={ref}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={id}
      >
        <header>
          <h2 id={id}>{title}</h2>
          {!hideCloseButton && (
            <button aria-label="关闭弹窗" onClick={close}>
              <X size={18} />
            </button>
          )}
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>,
    document.querySelector(".app") ?? document.body,
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
          <span className="toast-message">{msg}</span>
        </div>
      ) : null}
    </MotionPresence>
  );
}
export function ProgressBar({ done, total }) {
  return (
    <progress max={Math.max(1, total)} value={done} aria-label="任务进度" />
  );
}
export function Tooltip({ children, text }) {
  return <span title={text}>{children}</span>;
}
export function Skeleton() {
  return <div className="skeleton" aria-label="正在加载" />;
}
export const Segmented = Tabs;
