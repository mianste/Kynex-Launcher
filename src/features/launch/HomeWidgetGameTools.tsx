import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Minus,
  Plus,
  RotateCcw,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui";
import { readWidgetJson, writeWidgetStorage } from "./HomeWidgetUtilities";

export function WidgetCalendar() {
  const today = new Date();
  const [view, setView] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const year = view.getFullYear();
  const month = view.getMonth();
  const offset = (view.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const currentMonth =
    year === today.getFullYear() && month === today.getMonth();
  return (
    <div className="home-widget-calendar">
      <div className="home-widget-calendar-nav">
        <button
          aria-label="上个月"
          onClick={() => setView(new Date(year, month - 1, 1))}
        >
          <ChevronLeft size={13} />
        </button>
        <button
          aria-label="返回今天"
          onClick={() =>
            setView(new Date(today.getFullYear(), today.getMonth(), 1))
          }
        >
          {year}年{month + 1}月
        </button>
        <button
          aria-label="下个月"
          onClick={() => setView(new Date(year, month + 1, 1))}
        >
          <ChevronRight size={13} />
        </button>
      </div>
      <div
        className="home-widget-calendar-grid"
        aria-label={month + 1 + "月月历"}
      >
        {[..."一二三四五六日"].map((day) => (
          <b key={day}>{day}</b>
        ))}
        {Array.from({ length: offset }, (_, index) => (
          <span key={"gap" + index} />
        ))}
        {Array.from({ length: days }, (_, index) => (
          <span
            key={index}
            aria-current={
              currentMonth && index + 1 === today.getDate() ? "date" : undefined
            }
          >
            {index + 1}
          </span>
        ))}
      </div>
    </div>
  );
}

const stopwatchKey = "kynex-home-widget-stopwatch-v1";
type Stopwatch = { elapsed: number; startedAt: number | null };

export function WidgetStopwatch() {
  const [state, setState] = useState<Stopwatch>(() => {
    const saved = readWidgetJson(stopwatchKey) as
      Partial<Stopwatch> | undefined;
    if (
      typeof saved?.elapsed === "number" &&
      saved.elapsed >= 0 &&
      (saved.startedAt === null || typeof saved.startedAt === "number")
    ) {
      return { elapsed: saved.elapsed, startedAt: saved.startedAt };
    }
    return { elapsed: 0, startedAt: null };
  });
  const [now, setNow] = useState(Date.now);
  const running = state.startedAt !== null;
  useEffect(() => {
    if (!running) return;
    const interval = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, [running]);

  function save(next: Stopwatch) {
    setNow(Date.now());
    setState(next);
    writeWidgetStorage(stopwatchKey, JSON.stringify(next));
  }

  const startedAt = state.startedAt;
  const time =
    state.elapsed + (startedAt === null ? 0 : Math.max(0, now - startedAt));
  const seconds = Math.floor(time / 1000);
  return (
    <div className="home-widget-mini-tool">
      <div className="home-widget-clock">
        <time aria-label="秒表时间">
          {String(Math.floor(seconds / 60)).padStart(2, "0")}:
          {String(seconds % 60).padStart(2, "0")}.
          {Math.floor((time % 1000) / 100)}
        </time>
      </div>
      <div className="home-widget-actions">
        <Button
          onClick={() => {
            const now = Date.now();
            save(
              startedAt === null
                ? { ...state, startedAt: now }
                : {
                    elapsed: state.elapsed + Math.max(0, now - startedAt),
                    startedAt: null,
                  },
            );
          }}
        >
          {running ? "暂停" : "开始"}
        </Button>
        <Button onClick={() => save({ elapsed: 0, startedAt: null })}>
          归零
        </Button>
      </div>
    </div>
  );
}

export function WidgetCoordinates() {
  const [x, setX] = useState("");
  const [z, setZ] = useState("");
  const [toNether, setToNether] = useState(true);
  const factor = toNether ? 1 / 8 : 8;
  const convert = (input: string) => {
    const value = Math.floor(Number(input) * factor);
    return input && Number.isSafeInteger(value) ? value : "–";
  };
  return (
    <div className="home-widget-mini-tool">
      <select
        aria-label="坐标换算方向"
        value={toNether ? "nether" : "overworld"}
        onChange={(event) => setToNether(event.target.value === "nether")}
      >
        <option value="nether">主世界 → 下界</option>
        <option value="overworld">下界 → 主世界</option>
      </select>
      <div className="home-widget-tool-fields">
        <input
          type="number"
          step="any"
          aria-label="X 坐标"
          placeholder="X"
          value={x}
          onChange={(event) => setX(event.target.value)}
        />
        <input
          type="number"
          step="any"
          aria-label="Z 坐标"
          placeholder="Z"
          value={z}
          onChange={(event) => setZ(event.target.value)}
        />
      </div>
      <output>
        X {convert(x)} · Z {convert(z)}
      </output>
    </div>
  );
}

export function WidgetStacks() {
  const [input, setInput] = useState("");
  const [stack, setStack] = useState(64);
  const count = Number(input);
  const valid = input && Number.isSafeInteger(count) && count >= 0;
  return (
    <div className="home-widget-mini-tool">
      <div className="home-widget-tool-fields">
        <input
          type="number"
          min={0}
          step={1}
          aria-label="物品数量"
          placeholder="数量"
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <select
          aria-label="每组数量"
          value={stack}
          onChange={(event) => setStack(Number(event.target.value))}
        >
          {[64, 16, 1].map((size) => (
            <option key={size} value={size}>
              {size} / 组
            </option>
          ))}
        </select>
      </div>
      <output>
        {valid
          ? Math.floor(count / stack) + " 组 · 余 " + (count % stack) + " 个"
          : "输入物品数量"}
      </output>
    </div>
  );
}

export function WidgetSeed() {
  const [seed, setSeed] = useState("");
  const [message, setMessage] = useState("");
  return (
    <div className="home-widget-mini-tool">
      <input
        className="home-widget-seed"
        readOnly
        aria-label="随机世界种子"
        value={seed}
        placeholder="生成 Java 版种子"
        title={seed}
        onFocus={(event) => event.target.select()}
      />
      <div className="home-widget-actions">
        <Button
          onClick={() => {
            const random = crypto.getRandomValues(new BigInt64Array(1));
            setSeed(String(random[0]));
            setMessage("");
          }}
        >
          生成
        </Button>
        <Button
          disabled={!seed}
          aria-label="复制种子"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(seed);
              setMessage("已复制");
            } catch {
              setMessage("请选中种子手动复制");
            }
          }}
        >
          <Copy size={13} />
        </Button>
      </div>
      {message && <small role="status">{message}</small>}
    </div>
  );
}

const counterKey = "kynex-home-widget-counter-v1";

export function WidgetCounter() {
  const [count, setCount] = useState(() => {
    const saved = readWidgetJson(counterKey);
    return typeof saved === "number" && Number.isSafeInteger(saved) ? saved : 0;
  });
  function save(value: number) {
    if (!Number.isSafeInteger(value)) return;
    setCount(value);
    writeWidgetStorage(counterKey, JSON.stringify(value));
  }
  return (
    <div className="home-widget-mini-tool">
      <output className="home-widget-count" aria-label="当前计数">
        {count}
      </output>
      <div className="home-widget-actions">
        <Button aria-label="计数减一" onClick={() => save(count - 1)}>
          <Minus size={13} />
        </Button>
        <Button aria-label="计数加一" onClick={() => save(count + 1)}>
          <Plus size={14} />
        </Button>
        <Button aria-label="清零计数" onClick={() => save(0)}>
          <RotateCcw size={12} />
        </Button>
      </div>
    </div>
  );
}
