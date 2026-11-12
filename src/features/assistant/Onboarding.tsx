import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Compass, X } from "lucide-react";
import { GUIDE_STEPS } from "./guideSteps";
import {
  requestGuideSection,
  clearGuideSections,
  setGuideActive,
} from "../../lib/guideNavigation";
import { Button, ChoiceSelect } from "../../components/ui";
import { useStore } from "../../store";
// Show the corrected tour once to users who already saw the former text-only guide.
export const GUIDE_KEY = "kynex-onboarding-all-pages-v3";
type Rect = { x: number; y: number; width: number; height: number };
export function Onboarding({
  close,
  initialPage = "home",
  initialSection,
}: {
  close: () => void;
  initialPage?: string;
  initialSection?: string;
}) {
  const origin = useRef({
    page: useStore.getState().page,
    selected: useStore.getState().selected,
    section:
      document.querySelector<HTMLElement>(".settings-page")?.dataset.category ??
      document.querySelector<HTMLElement>('.agent-tabs [aria-pressed="true"]')
        ?.dataset.workshopView,
  });
  const [steps] = useState(() =>
    GUIDE_STEPS.filter(
      (s) => !s.requiresInstance || useStore.getState().instances.length > 0,
    ),
  );
  const currentPage = useStore((s) => s.page);
  const [step, S] = useState(() => {
    const desired = steps.findIndex(
      (s) =>
        s.page === initialPage &&
        (!initialSection || s.section === initialSection),
    );
    return desired < 0
      ? Math.max(
          0,
          steps.findIndex((s) => s.page === initialPage),
        )
      : desired;
  });
  const [hole, H] = useState<Rect | null>(null);
  const [position, P] = useState({ x: 20, y: 130 });
  const card = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  const maskId = useId().replace(/:/g, "");
  const titleId = useId();
  const item = steps[step];
  const Icon = Compass;
  function finish() {
    try {
      localStorage.setItem(GUIDE_KEY, "done");
    } catch {}
    clearGuideSections();
    setGuideActive(false);

    window.dispatchEvent(new Event("kynex-close-assistant"));
    useStore.setState({ selected: origin.current.selected });
    useStore.getState().setPage(origin.current.page);
    closeRef.current();
    if (origin.current.section)
      requestAnimationFrame(() =>
        requestGuideSection(origin.current.page, origin.current.section!),
      );
    window.dispatchEvent(new Event("kynex-guide-finished"));
  }
  useLayoutEffect(() => {
    setGuideActive(true);
    window.dispatchEvent(new Event("kynex-close-assistant"));
    const before = document.activeElement as HTMLElement | null;
    return () => {
      setGuideActive(false);
      clearGuideSections();
      before?.focus({ preventScroll: true });
    };
  }, []);
  useLayoutEffect(() => {
    window.dispatchEvent(new Event("kynex-close-assistant"));
    if (
      item.requiresInstance &&
      !useStore
        .getState()
        .instances.some((i) => i.id === useStore.getState().selected)
    )
      useStore.setState({
        selected: useStore.getState().instances[0]?.id || "",
      });
    if (item.section)
      requestGuideSection(
        item.assistant ? "assistant" : item.page,
        item.section,
      );
    useStore.getState().setPage(item.page);
  }, [item]);
  useLayoutEffect(() => {
    let target: HTMLElement | null = null;
    const observer = new ResizeObserver(() => measure());
    function measure() {
      const found = document.querySelector<HTMLElement>(
        item.selector || `[data-guide="${item.target}"]`,
      );
      if (found !== target) {
        if (target) observer.unobserve(target);
        target = found;
        if (target) {
          observer.observe(target);
          if (target.closest(".page-content"))
            target.scrollIntoView({ block: "nearest", inline: "nearest" });
        }
      }
      const r = target?.getBoundingClientRect();
      const w = window.innerWidth,
        h = window.innerHeight,
        gap = 16,
        margin = 18;
      const width = card.current?.offsetWidth || 370,
        height = card.current?.offsetHeight || 270;
      if (!r || !r.width || !r.height) {
        H(null);
        P({ x: (w - width) / 2, y: (h - height) / 2 });
        return;
      }
      const rect = {
        x: Math.max(4, r.left - 7),
        y: Math.max(4, r.top - 7),
        width: r.width + 14,
        height: r.height + 14,
      };
      H(rect);
      const clampX = (x: number) =>
        Math.max(margin, Math.min(x, w - width - margin));
      const clampY = (y: number) =>
        Math.max(margin, Math.min(y, h - height - margin));
      const centeredX = clampX(rect.x + rect.width / 2 - width / 2);
      const options = [
        { x: centeredX, y: rect.y + rect.height + gap },
        { x: centeredX, y: rect.y - height - gap },
        {
          x: rect.x - width - gap,
          y: clampY(rect.y + rect.height / 2 - height / 2),
        },
        {
          x: rect.x + rect.width + gap,
          y: clampY(rect.y + rect.height / 2 - height / 2),
        },
      ];
      P(
        options.find(
          (p) =>
            p.x >= margin &&
            p.y >= margin &&
            p.x + width <= w - margin &&
            p.y + height <= h - margin,
        ) || { x: clampX(rect.x), y: clampY(rect.y + rect.height + gap) },
      );
    }
    measure();
    card.current
      ?.querySelector<HTMLButtonElement>(".onboarding-next")
      ?.focus({ preventScroll: true });
    const frame = requestAnimationFrame(measure);
    const settled = window.setTimeout(measure, 300);
    const mutation = new MutationObserver(() => measure());
    const app = document.querySelector(".app");
    if (app)
      mutation.observe(app, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "aria-selected", "data-category"],
      });
    if (card.current) observer.observe(card.current);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settled);
      observer.disconnect();
      mutation.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [item, currentPage]);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        finish();
      }
      if (e.key === "Tab") {
        const nodes = [
          ...card.current!.querySelectorAll<HTMLElement>(
            "button:not(:disabled)",
          ),
        ];
        if (e.shiftKey && document.activeElement === nodes[0]) {
          e.preventDefault();
          nodes.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
          e.preventDefault();
          nodes[0]?.focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  return (
    <div
      className="onboarding-tour"
      role="dialog"
      aria-modal="true"
      aria-label="启动器使用引导"
      data-step={step}
      data-total={steps.length}
      data-page={item.page}
      data-section={item.section || ""}
    >
      <svg
        className="onboarding-mask"
        aria-hidden="true"
        width="100%"
        height="100%"
      >
        <defs>
          <mask id={maskId}>
            <rect width="100%" height="100%" fill="white" />
            {hole && (
              <rect
                x={hole.x}
                y={hole.y}
                width={hole.width}
                height={hole.height}
                rx="12"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,.58)"
          mask={`url(#${maskId})`}
        />
        {hole && (
          <rect
            className="onboarding-highlight"
            x={hole.x}
            y={hole.y}
            width={hole.width}
            height={hole.height}
            rx="12"
            fill="none"
            strokeWidth="2"
          />
        )}
      </svg>
      <div
        className="onboarding-card"
        ref={card}
        data-fixed-ink
        style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
        aria-labelledby={titleId}
      >
        <header>
          <span>
            <Icon size={20} />
            启动器使用引导 · {step + 1} / {steps.length}
          </span>
          <button aria-label="关闭使用引导" onClick={finish}>
            <X size={17} />
          </button>
        </header>
        <h2 id={titleId}>{item.title}</h2>
        <p>{item.text}</p>
        <div className="onboarding-jump">
          <span>跳转到页面</span>
          <ChoiceSelect
            aria-label="选择引导页面"
            value={step}
            onValueChange={(value) => S(Number(value))}
            options={steps.map((s, index) => ({
              value: String(index),
              label: `${index + 1}. ${s.title}`,
            }))}
          />
        </div>
        <div
          className="onboarding-progress"
          aria-label={`第 ${step + 1} 步，共 ${steps.length} 步`}
        >
          {steps.map((s, n) => (
            <span key={n} className={n <= step ? "active" : ""} />
          ))}
        </div>
        <footer>
          <Button onClick={finish}>跳过引导</Button>
          <div>
            {step > 0 && <Button onClick={() => S(step - 1)}>上一步</Button>}
            <Button
              primary
              className="onboarding-next"
              onClick={() =>
                step === steps.length - 1 ? finish() : S(step + 1)
              }
            >
              {step === steps.length - 1 ? "开始使用" : "下一步"}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
