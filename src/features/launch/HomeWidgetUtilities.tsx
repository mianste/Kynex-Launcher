import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui";

export function readWidgetStorage(key: string) {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function writeWidgetStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

export function readWidgetJson(key: string): unknown {
  try {
    return JSON.parse(readWidgetStorage(key));
  } catch {
    return undefined;
  }
}

const checklistKey = "kynex-home-widget-checklist-v1";
type ChecklistItem = { text: string; done: boolean };

export function WidgetChecklist() {
  const [items, setItems] = useState<ChecklistItem[]>(() => {
    const saved = readWidgetJson(checklistKey);
    return Array.isArray(saved)
      ? saved
          .filter(
            (item) =>
              typeof item?.text === "string" && typeof item.done === "boolean",
          )
          .slice(0, 30)
      : [];
  });
  const [draft, setDraft] = useState("");

  function save(next: ChecklistItem[]) {
    setItems(next);
    writeWidgetStorage(checklistKey, JSON.stringify(next));
  }

  return (
    <div className="home-widget-checklist">
      {items.length > 0 && (
        <ul aria-label="待办事项">
          {items.map((item, index) => (
            <li key={index}>
              <label title={item.text}>
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={() =>
                    save(
                      items.map((entry, i) =>
                        i === index ? { ...entry, done: !entry.done } : entry,
                      ),
                    )
                  }
                />
                <span>{item.text}</span>
              </label>
              <button
                type="button"
                aria-label={`删除待办 ${item.text}`}
                onClick={() => save(items.filter((_, i) => i !== index))}
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const text = draft.trim();
          if (!text || items.length >= 30) return;
          save([...items, { text, done: false }]);
          setDraft("");
        }}
      >
        <input
          value={draft}
          maxLength={120}
          aria-label="新增待办"
          placeholder={items.length >= 30 ? "已达到 30 项" : "新增待办…"}
          disabled={items.length >= 30}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          type="submit"
          aria-label="添加待办"
          disabled={!draft.trim() || items.length >= 30}
        >
          <Plus size={15} />
        </button>
      </form>
    </div>
  );
}

const timerKey = "kynex-home-widget-timer-v1";
type Timer = { minutes: number; remaining: number; endsAt: number | null };
const minutesToMs = (minutes: number) => minutes * 60_000;

export function WidgetTimer() {
  const [now, setNow] = useState(Date.now);
  const [timer, setTimer] = useState<Timer>(() => {
    const saved = readWidgetJson(timerKey) as Partial<Timer> | undefined;
    if (
      typeof saved?.minutes === "number" &&
      Number.isInteger(saved.minutes) &&
      saved.minutes >= 1 &&
      saved.minutes <= 180 &&
      typeof saved.remaining === "number" &&
      saved.remaining >= 0 &&
      saved.remaining <= minutesToMs(saved.minutes) &&
      (saved.endsAt === null ||
        (typeof saved.endsAt === "number" && Number.isFinite(saved.endsAt)))
    ) {
      return {
        minutes: saved.minutes,
        remaining: saved.remaining,
        endsAt: saved.endsAt,
      };
    }
    return { minutes: 5, remaining: minutesToMs(5), endsAt: null };
  });
  const [duration, setDuration] = useState(String(timer.minutes));
  const remaining =
    timer.endsAt === null ? timer.remaining : Math.max(0, timer.endsAt - now);
  const running = timer.endsAt !== null && remaining > 0;
  useEffect(() => {
    if (!running) return;
    const interval = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(interval);
  }, [running]);

  function save(next: Timer) {
    setNow(Date.now());
    setTimer(next);
    writeWidgetStorage(timerKey, JSON.stringify(next));
  }

  const seconds = Math.ceil(remaining / 1000);
  const minutes = Number(duration);
  const validDuration =
    Number.isInteger(minutes) && minutes >= 1 && minutes <= 180;
  return (
    <div className="home-widget-timer">
      <div className="home-widget-clock">
        <time aria-label="剩余时间">
          {String(Math.floor(seconds / 60)).padStart(2, "0")}:
          {String(seconds % 60).padStart(2, "0")}
        </time>
        {remaining === 0 && <small role="status">时间到</small>}
      </div>
      <div className="home-widget-timer-controls">
        <input
          type="number"
          min="1"
          max="180"
          step="1"
          aria-label="倒计时分钟数"
          title="倒计时分钟数，1 到 180"
          value={duration}
          disabled={running}
          onChange={(event) => setDuration(event.target.value)}
        />
        <Button
          disabled={!running && !validDuration}
          onClick={() => {
            if (running && timer.endsAt !== null) {
              save({
                ...timer,
                remaining: Math.max(0, timer.endsAt - Date.now()),
                endsAt: null,
              });
            } else {
              const next =
                minutes === timer.minutes && remaining > 0
                  ? remaining
                  : minutesToMs(minutes);
              save({ minutes, remaining: next, endsAt: Date.now() + next });
            }
          }}
        >
          {running ? "暂停" : "开始"}
        </Button>
        <Button
          disabled={!validDuration}
          onClick={() =>
            save({ minutes, remaining: minutesToMs(minutes), endsAt: null })
          }
        >
          重置
        </Button>
      </div>
    </div>
  );
}
