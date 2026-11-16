import {
  Bot,
  Boxes,
  CalendarDays,
  Check,
  Clock3,
  Compass,
  Download,
  HelpCircle,
  LayoutGrid,
  Layers3,
  ListTodo,
  Monitor,
  Moon,
  MoveDiagonal2,
  Newspaper,
  MapPin,
  Plus,
  Redo2,
  Settings2,
  Shirt,
  Sparkles,
  Sprout,
  StickyNote,
  Sun,
  Timer,
  TimerReset,
  Trash2,
  Undo2,
  UserRound,
  ListOrdered,
  MousePointer2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Button, ProgressBar } from "../../components/ui";
import { useStore } from "../../store";
import { AccountAvatar } from "../account/AccountAvatar";
import {
  WidgetCalendar,
  WidgetCoordinates,
  WidgetCounter,
  WidgetSeed,
  WidgetStacks,
  WidgetStopwatch,
} from "./HomeWidgetGameTools";
import {
  readWidgetJson,
  readWidgetStorage,
  writeWidgetStorage,
  WidgetChecklist,
  WidgetTimer,
} from "./HomeWidgetUtilities";
import {
  addWidget,
  canvasHeight,
  canvasWidth,
  customizeWidget,
  decodeLayout,
  defaultCorners,
  defaultHeight,
  defaultWidth,
  maxCornerRadius,
  maxWidgetHeight,
  minWidgetHeight,
  minWidgetWidth,
  positionWidget,
  shapes,
  tones,
  widgetIds,
  type Placement,
  type WidgetAppearance,
  type WidgetId,
  type WidgetRect,
} from "./homeWidgetLayout";
import {
  HomeWidgetPreviewChrome,
  useHomePreviewGeometry,
} from "./HomeWidgetPreview";
import { useHomeWidgetGesture } from "./useHomeWidgetGesture";

const WIDGETS = {
  clock: { title: "时钟", description: "查看本地时间与日期", icon: Clock3 },
  notes: { title: "便签", description: "记录文字并自动保存", icon: StickyNote },
  checklist: {
    title: "待办清单",
    description: "添加、勾选和删除待办",
    icon: ListTodo,
  },
  timer: {
    title: "倒计时",
    description: "设置时长，开始或暂停倒计时",
    icon: Timer,
  },
  versions: {
    title: "游戏版本",
    description: "查看和切换当前实例",
    icon: Layers3,
  },
  downloads: {
    title: "下载任务",
    description: "查看任务和下载进度",
    icon: Download,
  },
  account: {
    title: "玩家账号",
    description: "查看当前账号和皮肤",
    icon: UserRound,
  },
  theme: {
    title: "主题切换",
    description: "切换浅色、深色或跟随系统",
    icon: Sun,
  },
  news: {
    title: "游戏新闻",
    description: "查看 Minecraft 新闻",
    icon: Newspaper,
  },
  skin: { title: "皮肤管理", description: "打开皮肤管理页", icon: Shirt },
  assistant: { title: "AI 助手", description: "打开启动器助手", icon: Bot },
  workshop: {
    title: "AI 整合包工坊",
    description: "前往 AI 整合包工坊（测试）",
    icon: Sparkles,
  },
  discover: {
    title: "资源下载",
    description: "浏览模组和整合包",
    icon: Compass,
  },
  help: { title: "使用帮助", description: "打开启动器帮助", icon: HelpCircle },
  calendar: {
    title: "月历",
    description: "查看今天、上月和下月",
    icon: CalendarDays,
  },
  stopwatch: {
    title: "秒表",
    description: "开始、暂停或重置计时",
    icon: TimerReset,
  },
  coordinates: {
    title: "下界坐标",
    description: "换算主世界与下界的 X、Z 坐标",
    icon: MapPin,
  },
  stacks: {
    title: "堆叠计算",
    description: "按每组容量计算整组和余量",
    icon: Boxes,
  },
  seed: {
    title: "世界种子",
    description: "生成并复制随机的 Java 版世界种子",
    icon: Sprout,
  },
  counter: {
    title: "计数器",
    description: "记录数量或进度，自动保存",
    icon: ListOrdered,
  },
} as const;

const LAYOUT_KEY = "kynex-home-widget-layout-v3";
const PREVIOUS_LAYOUT_KEY = "kynex-home-widget-layout-v2";
const LEGACY_LAYOUT_KEY = "kynex-home-widget-layout-v1";
const NOTES_KEY = "kynex-home-widget-notes-v1";

const clockTime = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const clockDate = new Intl.DateTimeFormat("zh-CN", {
  month: "long",
  day: "numeric",
  weekday: "long",
});

function WidgetClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(tick);
  }, []);
  return (
    <div className="home-widget-clock">
      <time dateTime={now.toISOString()}>{clockTime.format(now)}</time>
      <small>{clockDate.format(now)}</small>
    </div>
  );
}

function WidgetNotes() {
  const [text, setText] = useState(() => readWidgetStorage(NOTES_KEY));
  return (
    <textarea
      className="home-widget-notes"
      aria-label="首页便签"
      placeholder="记点什么…"
      maxLength={2000}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        writeWidgetStorage(NOTES_KEY, event.target.value);
      }}
    />
  );
}

const themes = [
  { value: "light", title: "浅色", icon: Sun },
  { value: "dark", title: "深色", icon: Moon },
  { value: "system", title: "跟随系统", icon: Monitor },
] as const;

function WidgetBody({
  id,
  onOpenDownloads,
}: {
  id: WidgetId;
  onOpenDownloads: () => void;
}) {
  const s = useStore();
  switch (id) {
    case "clock":
      return <WidgetClock />;
    case "notes":
      return <WidgetNotes />;
    case "checklist":
      return <WidgetChecklist />;
    case "timer":
      return <WidgetTimer />;
    case "calendar":
      return <WidgetCalendar />;
    case "stopwatch":
      return <WidgetStopwatch />;
    case "coordinates":
      return <WidgetCoordinates />;
    case "stacks":
      return <WidgetStacks />;
    case "seed":
      return <WidgetSeed />;
    case "counter":
      return <WidgetCounter />;
    case "assistant":
      return (
        <Button
          onClick={() =>
            window.dispatchEvent(new Event("kynex-open-assistant"))
          }
        >
          打开助手
        </Button>
      );
    case "news":
    case "skin":
    case "workshop":
    case "discover":
    case "help":
      return (
        <>
          <p className="home-widget-description">{WIDGETS[id].description}</p>
          <Button onClick={() => s.setPage(id)}>打开</Button>
        </>
      );
    case "versions": {
      const instance = s.instances.find((item) => item.id === s.selected);
      return (
        <>
          <b className="home-widget-value" title={instance?.name}>
            {instance?.name ?? "尚未选择版本"}
          </b>
          <Button onClick={() => s.show("versions")}>选择版本</Button>
        </>
      );
    }
    case "downloads": {
      const pending = Object.values(s.tasks).filter((task) => !task.finished);
      const current = pending[0];
      return (
        <>
          <b className="home-widget-value" title={current?.stage}>
            {pending.length ? `${pending.length} 项进行中` : "暂无下载任务"}
          </b>
          {current && current.total > 0 && (
            <ProgressBar done={current.done} total={current.total} />
          )}
          <Button onClick={onOpenDownloads}>查看任务</Button>
        </>
      );
    }
    case "account": {
      const account = s.accounts.find((item) => item.id === s.accountId);
      return (
        <>
          <div className="home-widget-account">
            <AccountAvatar account={account} />
            <b className="home-widget-value" title={account?.name}>
              {account?.name ?? "未添加账号"}
            </b>
          </div>
          <Button onClick={() => s.setPage("account")}>管理账号</Button>
        </>
      );
    }
    case "theme":
      return (
        <div className="home-widget-actions home-widget-themes">
          {themes.map(({ value, title, icon: Icon }) => (
            <Button
              key={value}
              aria-pressed={s.settings.theme === value}
              onClick={() => s.updateSettings({ theme: value })}
            >
              <Icon size={13} />
              {title}
            </Button>
          ))}
        </div>
      );
  }
}

const sizeOptions = [
  { width: defaultWidth, height: defaultHeight, label: "默认" },
  { width: 420, height: defaultHeight, label: "横向" },
  { width: defaultWidth, height: 250, label: "纵向" },
  { width: 370, height: 250, label: "宽大" },
] as const;

const shapeLabels = {
  square: "直角",
  rounded: "圆角",
  soft: "大圆角",
  capsule: "胶囊",
  leaf: "叶形",
  arch: "拱形",
  cut: "斜切",
  petal: "花瓣",
  custom: "自定义",
} as const;
const toneLabels = {
  standard: "默认",
  neutral: "中性",
  accent: "主题色",
} as const;

const arrows: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

function rectStyle({ x, y, width, height }: WidgetRect): CSSProperties {
  return {
    left: (x * 100) / canvasWidth + "%",
    top: y,
    width: (width * 100) / canvasWidth + "%",
    height,
  };
}

function appearanceStyle(item: Placement): CSSProperties {
  const style = rectStyle(item);
  if (item.shape !== "custom") return style;
  const [tl, tr, br, bl] = item.corners ?? defaultCorners;
  const fit = Math.min(
    1,
    item.width / (tl + tr),
    item.width / (bl + br),
    item.height / (tl + bl),
    item.height / (tr + br),
  );
  const inset = (a: number, b: number, minimum: number) =>
    Math.max(minimum, Math.ceil(Math.max(a, b) * fit * 0.31));
  return {
    ...style,
    borderRadius: [tl, tr, br, bl].map((radius) => radius + "px").join(" "),
    padding: [
      inset(tl, tr, 12),
      inset(tr, br, 16),
      inset(br, bl, 12),
      inset(bl, tl, 16),
    ]
      .map((value) => value + "px")
      .join(" "),
    "--home-widget-handle-inset":
      Math.max(6, Math.ceil(br * fit * 0.31)) + "px",
  } as CSSProperties;
}

type History = {
  past: Placement[][];
  layout: Placement[];
  future: Placement[][];
};
const cornerNames = ["左上", "右上", "右下", "左下"] as const;

export function HomeWidgets({
  onOpenDownloads,
}: {
  onOpenDownloads: () => void;
}) {
  const [savedLayout, setSavedLayout] = useState(() =>
    decodeLayout(
      readWidgetJson(LAYOUT_KEY),
      readWidgetJson(PREVIOUS_LAYOUT_KEY),
      readWidgetJson(LEGACY_LAYOUT_KEY),
    ),
  );
  const [history, setHistory] = useState<History>({
    past: [],
    future: [],
    layout: [],
  });
  const [editing, setEditing] = useState(false);
  const layout = editing ? history.layout : savedLayout;
  const [selectedId, setSelectedId] = useState<WidgetId | null>(null);
  const [message, setMessage] = useState("");
  const toggle = useRef<HTMLButtonElement>(null);
  const done = useRef<HTMLButtonElement>(null);
  const board = useRef<HTMLElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const previewSpace = useRef<HTMLDivElement>(null);
  const openingScroll = useRef(0);
  const geometry = useHomePreviewGeometry(editing, previewSpace);
  const frame = editing ? geometry : null;
  const selected = layout.find((item) => item.id === selectedId);
  const addedItems = new Set(layout.map((item) => item.id));

  useEffect(() => {
    writeWidgetStorage(LAYOUT_KEY, JSON.stringify(savedLayout));
  }, [savedLayout]);

  useLayoutEffect(() => {
    board.current
      ?.querySelectorAll<HTMLElement>(".home-widget-body")
      .forEach((body) => {
        body.inert = editing;
      });
  }, [editing, layout]);

  function select(id: WidgetId) {
    setSelectedId(id);
    setMessage("");
  }

  function reveal(id: WidgetId) {
    requestAnimationFrame(() => {
      const scroll = viewport.current;
      const tile = board.current?.querySelector<HTMLElement>(
        "[data-widget=" + id + "]",
      );
      if (!scroll || !tile) return;
      const top = tile.offsetTop;
      if (top < scroll.scrollTop) scroll.scrollTop = top;
      else if (
        top + tile.offsetHeight >
        scroll.scrollTop + scroll.clientHeight
      ) {
        scroll.scrollTop = Math.max(
          top + tile.offsetHeight - scroll.clientHeight,
          0,
        );
      }
    });
  }

  function commit(next: Placement[]) {
    setHistory((current) =>
      next === current.layout
        ? current
        : {
            past: [...current.past.slice(-23), current.layout],
            layout: next,
            future: [],
          },
    );
    setMessage("");
  }

  function undo() {
    setHistory((current) => {
      const previous = current.past.at(-1);
      return previous
        ? {
            past: current.past.slice(0, -1),
            layout: previous,
            future: [current.layout, ...current.future],
          }
        : current;
    });
    setMessage("");
  }

  function redo() {
    setHistory((current) => {
      const [next, ...future] = current.future;
      return next
        ? { past: [...current.past, current.layout], layout: next, future }
        : current;
    });
    setMessage("");
  }

  function add(id: WidgetId) {
    const next = addWidget(layout, id);
    if (!next) {
      setMessage("首页位置已满，可缩小或移除组件。");
      return;
    }
    commit(next);
    select(id);
    reveal(id);
  }

  function customize(
    item: Placement,
    changes: WidgetAppearance,
    scroll = true,
  ) {
    const next = customizeWidget(layout, item.id, changes);
    if (!next) {
      setMessage("这个尺寸放不下，请先移动组件。");
      return;
    }
    commit(next);
    if (scroll) reveal(item.id);
  }

  const gesture = useHomeWidgetGesture({
    layout,
    board,
    viewport,
    onSelect: select,
    onCommit: (next, id) => {
      commit(next);
      select(id);
    },
    onInvalid: (kind) =>
      setMessage(
        kind === "resize"
          ? "这个尺寸放不下，请先移动组件。"
          : "这个位置放不下，请换个位置。",
      ),
  });
  const resetGesture = gesture.reset;

  const closeEditor = useCallback(
    (applied = false) => {
      resetGesture();
      setEditing(false);
      setMessage("");
      toggle.current?.focus({ preventScroll: true });
      if (!applied)
        requestAnimationFrame(() => {
          if (viewport.current)
            viewport.current.scrollTop = openingScroll.current;
        });
    },
    [resetGesture],
  );

  function openEditor() {
    openingScroll.current = viewport.current?.scrollTop ?? 0;
    setHistory({ layout: savedLayout, past: [], future: [] });
    setEditing(true);
  }

  useEffect(() => {
    if (!editing) return;
    done.current?.focus({ preventScroll: true });
    function onEscape(event: KeyboardEvent) {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        document.querySelector(
          ".app > .overlay, .onboarding-tour",
        )
      )
        return;
      if (!resetGesture()) closeEditor();
    }
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [editing, closeEditor, resetGesture]);

  function moveWithKeys(event: ReactKeyboardEvent, item: Placement) {
    const delta = arrows[event.key];
    if (!delta) return;
    event.preventDefault();
    const step = event.shiftKey ? 1 : 8;
    const next = positionWidget(
      layout,
      item.id,
      item.x + delta[0] * step,
      item.y + delta[1] * step,
    );
    if (!next) {
      setMessage("这个位置放不下，请换个位置。");
      return;
    }
    commit(next);
    select(item.id);
    reveal(item.id);
  }

  function resizeWithKeys(event: ReactKeyboardEvent, item: Placement) {
    const delta = arrows[event.key];
    if (!delta) return;
    event.preventDefault();
    const step = event.shiftKey ? 1 : 8;
    customize(item, {
      width: Math.max(
        minWidgetWidth,
        Math.min(canvasWidth - item.x, item.width + delta[0] * step),
      ),
      height: Math.max(
        minWidgetHeight,
        Math.min(maxWidgetHeight, item.height + delta[1] * step),
      ),
    });
  }

  const ghostWidget =
    gesture.dragged && gesture.dragged.kind !== "resize"
      ? WIDGETS[gesture.dragged.id]
      : null;
  const GhostIcon = ghostWidget?.icon;

  return (
    <div
      className="home-widgets"
      data-editing={editing}
      data-fixed-ink
      onPointerMove={gesture.move}
      onPointerUp={gesture.end}
      onPointerCancel={gesture.cancel}
      onLostPointerCapture={gesture.cancel}
      onClickCapture={gesture.rejectDragClick}
      onKeyDown={(event) => {
        if (
          !editing ||
          gesture.dragged ||
          !(event.ctrlKey || event.metaKey) ||
          (event.target instanceof HTMLElement &&
            event.target.closest("input, textarea"))
        )
          return;
        const key = event.key.toLowerCase();
        if (key !== "z" && key !== "y") return;
        event.preventDefault();
        if (key === "y" || event.shiftKey) redo();
        else undo();
      }}
    >
      <div className="home-widget-edge">
        <button
          ref={toggle}
          className="home-widget-toggle"
          aria-label="自定义组件"
          title="自定义组件"
          aria-expanded={editing}
          aria-controls={editing ? "home-widget-panel" : undefined}
          onClick={() => (editing ? closeEditor() : openEditor())}
        >
          <LayoutGrid size={18} />
        </button>
      </div>

      {(editing || layout.length > 0) && (
        <div className="home-widget-workspace">
          {editing && (
            <aside
              className="home-widget-panel"
              id="home-widget-panel"
              aria-labelledby="home-widget-heading"
            >
              <header className="home-widget-panel-header">
                <span className="home-widget-editor-icon">
                  <LayoutGrid size={16} />
                </span>
                <h2 id="home-widget-heading">组件库</h2>
              </header>
              <div className="home-widget-catalog">
                {widgetIds.map((id) => {
                  const { title, description, icon: Icon } = WIDGETS[id];
                  const added = addedItems.has(id);
                  return (
                    <button
                      key={id}
                      className="home-widget-option"
                      aria-label={(added ? "编辑" : "添加") + title}
                      title={description}
                      data-added={added}
                      data-selected={id === selectedId}
                      data-dragging={
                        gesture.dragged?.id === id &&
                        gesture.dragged.kind === "add"
                      }
                      onPointerDown={(event) => {
                        if (!added) gesture.start(event, id, "add");
                      }}
                      onClick={() => {
                        if (added) {
                          select(id);
                          reveal(id);
                        } else add(id);
                      }}
                    >
                      <span className="home-widget-option-art">
                        <Icon size={17} strokeWidth={1.8} />
                      </span>
                      <span className="home-widget-option-name">{title}</span>
                      {added && (
                        <Check className="home-widget-option-check" size={11} />
                      )}
                    </button>
                  );
                })}
              </div>
            </aside>
          )}

          <div className="home-widget-stage">
            {editing && (
              <header className="home-widget-stage-header">
                <h2>首页预览</h2>
                <div className="home-widget-toolbar">
                  <div
                    className="home-widget-history"
                    aria-label="编辑历史"
                    role="group"
                  >
                    <button
                      aria-label="撤销"
                      title="撤销 Ctrl+Z"
                      disabled={!history.past.length}
                      onClick={undo}
                    >
                      <Undo2 size={17} />
                    </button>
                    <button
                      aria-label="重做"
                      title="重做 Ctrl+Shift+Z"
                      disabled={!history.future.length}
                      onClick={redo}
                    >
                      <Redo2 size={17} />
                    </button>
                  </div>
                  <button
                    className="home-widget-cancel"
                    onClick={() => closeEditor()}
                  >
                    取消
                  </button>
                  <button
                    ref={done}
                    className="home-widget-done"
                    onClick={() => {
                      setSavedLayout(layout);
                      closeEditor(true);
                    }}
                  >
                    <Check size={14} /> 确定
                  </button>
                </div>
              </header>
            )}

            <div className="home-widget-preview-space" ref={previewSpace}>
              <div
                className="home-widget-preview-shell"
                style={
                  frame
                    ? {
                        width: frame.width * frame.scale,
                        height: frame.height * frame.scale,
                      }
                    : undefined
                }
              >
                <div
                  className="home-widget-preview-scene"
                  style={
                    frame
                      ? {
                          width: frame.width,
                          height: frame.height,
                          transform: "scale(" + frame.scale + ")",
                        }
                      : undefined
                  }
                >
                  {frame && (
                    <HomeWidgetPreviewChrome
                      width={frame.width}
                      height={frame.height}
                    />
                  )}
                  <div
                    className="home-widget-scroll"
                    ref={viewport}
                    tabIndex={editing ? 0 : undefined}
                    aria-label={editing ? "可滚动的首页组件画布" : undefined}
                    style={frame?.canvas}
                  >
                    <section
                      className="home-widget-board"
                      aria-label="首页组件排版"
                      ref={board}
                      data-gesture={gesture.dragged?.kind}
                      style={{
                        height:
                          canvasHeight(layout) + (gesture.dragged ? 84 : 0),
                      }}
                    >
                      {editing && !layout.length && !gesture.dragged && (
                        <div className="home-widget-canvas-empty">
                          <span>
                            <MousePointer2 size={19} />
                          </span>
                          <b>把组件拖到这里</b>
                          <p>也可以点击左侧的组件来添加</p>
                        </div>
                      )}
                      {gesture.preview && (
                        <div
                          className="home-widget-placement-preview"
                          data-valid={gesture.preview.valid}
                          style={rectStyle(gesture.preview)}
                          aria-hidden="true"
                        />
                      )}
                      {layout.map((item) => {
                        const { id, shape, tone } = item;
                        const { title, icon: Icon } = WIDGETS[id];
                        const focused = editing && id === selectedId;
                        return (
                          <article
                            key={id}
                            className="home-widget-tile"
                            aria-label={title}
                            data-widget={id}
                            data-x={item.x}
                            data-y={item.y}
                            data-selected={focused}
                            data-dragging={gesture.dragged?.id === id}
                            data-shape={shape}
                            data-tone={tone}
                            style={appearanceStyle(item)}
                          >
                            <header>
                              <Icon size={15} />
                              <h3 title={title}>{title}</h3>
                            </header>
                            <div
                              className="home-widget-body"
                              aria-hidden={editing || undefined}
                            >
                              <WidgetBody
                                id={id}
                                onOpenDownloads={onOpenDownloads}
                              />
                            </div>
                            {editing && (
                              <button
                                className="home-widget-pick"
                                aria-label={"选中并拖动" + title}
                                aria-pressed={focused}
                                title="按住拖动 · 方向键移动"
                                onPointerDown={(event) =>
                                  gesture.start(event, id, "move")
                                }
                                onKeyDown={(event) => moveWithKeys(event, item)}
                                onClick={() => select(id)}
                              />
                            )}
                            {focused && (
                              <button
                                className="home-widget-resize"
                                aria-label={"拉伸" + title}
                                title="拖动右下角调整尺寸 · 方向键可微调"
                                onPointerDown={(event) =>
                                  gesture.start(event, id, "resize")
                                }
                                onKeyDown={(event) =>
                                  resizeWithKeys(event, item)
                                }
                              >
                                <MoveDiagonal2 size={14} />
                              </button>
                            )}
                          </article>
                        );
                      })}
                    </section>
                  </div>
                </div>
              </div>
            </div>
            {editing && (
              <div className="home-widget-status" role="status">
                {message}
              </div>
            )}
          </div>

          {editing && (
            <aside className="home-widget-inspector" aria-label="组件属性">
              <header className="home-widget-panel-header">
                <span className="home-widget-editor-icon">
                  <Settings2 size={16} />
                </span>
                <h2>属性</h2>
              </header>
              {selected ? (
                <div className="home-widget-inspector-content">
                  <div className="home-widget-inspector-heading">
                    <h3>{WIDGETS[selected.id].title}</h3>
                    <button
                      aria-label={"移除" + WIDGETS[selected.id].title}
                      title="移除组件"
                      onClick={() => {
                        commit(
                          layout.filter((item) => item.id !== selected.id),
                        );
                        setSelectedId(null);
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <fieldset className="home-widget-sizes">
                    <legend>尺寸</legend>
                    <div>
                      {sizeOptions.map(({ width, height, label }) => (
                        <button
                          key={label}
                          title={label}
                          aria-label={label + " " + width + "×" + height}
                          aria-pressed={
                            width === selected.width &&
                            height === selected.height
                          }
                          onClick={() => customize(selected, { width, height })}
                        >
                          <span />
                          <b>{label}</b>
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset className="home-widget-shapes">
                    <legend>形状</legend>
                    <div>
                      {shapes.map((shape) => (
                        <button
                          key={shape}
                          title={shapeLabels[shape]}
                          aria-label={shapeLabels[shape]}
                          aria-pressed={selected.shape === shape}
                          onClick={() => customize(selected, { shape })}
                        >
                          <span data-shape={shape} />
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  {selected.shape === "custom" && (
                    <fieldset className="home-widget-custom-corners">
                      <legend>四角圆度</legend>
                      <div>
                        {cornerNames.map((name, index) => {
                          const corners = selected.corners ?? defaultCorners;
                          return (
                            <label key={name}>
                              {name}
                              <input
                                type="range"
                                min={0}
                                max={maxCornerRadius}
                                step={1}
                                value={corners[index]}
                                aria-label={name + "圆度"}
                                onChange={(event) => {
                                  const next = [...corners] as typeof corners;
                                  next[index] =
                                    event.currentTarget.valueAsNumber;
                                  customize(selected, { corners: next }, false);
                                }}
                              />
                              <output>{corners[index]}</output>
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                  )}
                  <fieldset className="home-widget-tones">
                    <legend>配色</legend>
                    <div>
                      {tones.map((tone) => (
                        <button
                          key={tone}
                          title={toneLabels[tone]}
                          aria-label={toneLabels[tone]}
                          data-tone={tone}
                          aria-pressed={selected.tone === tone}
                          onClick={() => customize(selected, { tone })}
                        >
                          {selected.tone === tone && <Check size={12} />}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                </div>
              ) : (
                <div className="home-widget-inspector-empty">
                  <MousePointer2 size={21} />
                  <p>选中画布中的组件</p>
                </div>
              )}
            </aside>
          )}
        </div>
      )}
      {ghostWidget &&
        GhostIcon &&
        createPortal(
          <div
            className="home-widget-ghost"
            ref={gesture.ghost}
            data-fixed-ink
            aria-hidden="true"
          >
            <GhostIcon size={16} /> {ghostWidget.title}
          </div>,
          document.body,
        )}
    </div>
  );
}
