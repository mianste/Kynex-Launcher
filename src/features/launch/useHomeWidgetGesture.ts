import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import {
  canvasWidth,
  customizeWidget,
  defaultHeight,
  defaultWidth,
  maxWidgetHeight,
  minWidgetHeight,
  minWidgetWidth,
  positionWidget,
  type Placement,
  type WidgetId,
  type WidgetRect,
} from "./homeWidgetLayout";

type GestureKind = "add" | "move" | "resize";
type Point = { x: number; y: number };
type Gesture = {
  id: WidgetId;
  kind: GestureKind;
  pointerId: number;
  capture: HTMLButtonElement;
  origin: Point;
  point: Point;
  boardOrigin: Point;
  grab: Point;
  item?: Placement;
  dragging: boolean;
};
type Preview = WidgetRect & { valid: boolean };

function toBoard(point: Point, board: HTMLElement) {
  const bounds = board.getBoundingClientRect();
  const scale = bounds.width / canvasWidth;
  return {
    x: (point.x - bounds.left) / scale,
    y: ((point.y - bounds.top) * board.offsetHeight) / bounds.height,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function samePreview(a: Preview | null, b: Preview | null) {
  if (!a || !b) return a === b;
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.valid === b.valid
  );
}

function targetRect(
  gesture: Gesture,
  board: HTMLElement,
  viewport: HTMLElement,
) {
  const { item, point, boardOrigin, grab, kind } = gesture;
  const mapped = toBoard(point, board);
  if (kind === "resize" && item) {
    return {
      x: item.x,
      y: item.y,
      width: clamp(
        item.width + mapped.x - boardOrigin.x,
        minWidgetWidth,
        canvasWidth - item.x,
      ),
      height: clamp(
        item.height + mapped.y - boardOrigin.y,
        minWidgetHeight,
        maxWidgetHeight,
      ),
    };
  }
  const bounds = viewport.getBoundingClientRect();
  if (
    point.x < bounds.left ||
    point.x >= bounds.right ||
    point.y < bounds.top ||
    point.y >= bounds.bottom
  )
    return null;
  const width = item?.width ?? defaultWidth;
  const height = item?.height ?? defaultHeight;
  return {
    x: clamp(mapped.x - grab.x, 0, canvasWidth - width),
    y: Math.max(0, Math.round(mapped.y - grab.y)),
    width,
    height,
  };
}

export function useHomeWidgetGesture({
  layout,
  board,
  viewport,
  onSelect,
  onCommit,
  onInvalid,
}: {
  layout: Placement[];
  board: RefObject<HTMLElement>;
  viewport: RefObject<HTMLDivElement>;
  onSelect: (id: WidgetId) => void;
  onCommit: (layout: Placement[], id: WidgetId) => void;
  onInvalid: (kind: GestureKind) => void;
}) {
  const active = useRef<Gesture | null>(null);
  const frame = useRef(0);
  const blockedButton = useRef<HTMLButtonElement | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [dragged, setDragged] = useState<{
    id: WidgetId;
    kind: GestureKind;
  } | null>(null);
  const ghost = useRef<HTMLDivElement>(null);

  const reset = useCallback(() => {
    const gesture = active.current;
    if (!gesture) return false;
    active.current = null;
    if (gesture.dragging) blockedButton.current = gesture.capture;
    cancelAnimationFrame(frame.current);
    setPreview(null);
    setDragged(null);
    if (gesture.capture.hasPointerCapture(gesture.pointerId)) {
      gesture.capture.releasePointerCapture(gesture.pointerId);
    }
    return gesture.dragging;
  }, []);

  useEffect(() => {
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("blur", reset);
      cancelAnimationFrame(frame.current);
    };
  }, [reset]);

  function destination(gesture: Gesture) {
    const surface = board.current;
    const scroll = viewport.current;
    if (!surface || !scroll) return null;
    const target = targetRect(gesture, surface, scroll);
    if (!target) return null;
    const next =
      gesture.kind === "resize"
        ? customizeWidget(layout, gesture.id, {
            width: target.width,
            height: target.height,
          })
        : positionWidget(layout, gesture.id, target.x, target.y);
    return { target, next };
  }

  function paint() {
    const gesture = active.current;
    const scroll = viewport.current;
    if (!gesture?.dragging || !scroll) return;
    const bounds = scroll.getBoundingClientRect();
    const { x, y } = gesture.point;
    if (
      x >= bounds.left &&
      x <= bounds.right &&
      y >= bounds.top - 18 &&
      y <= bounds.bottom + 18
    ) {
      const upper = Math.max(0, bounds.top + 20 - y);
      const lower = Math.max(0, y - bounds.bottom + 20);
      scroll.scrollTop += Math.max(-13, Math.min(13, (lower - upper) / 2));
    }
    if (ghost.current)
      ghost.current.style.transform =
        "translate3d(" + (x + 12) + "px," + (y + 14) + "px,0)";
    const result = destination(gesture);
    const target = result && { ...result.target, valid: Boolean(result.next) };
    setPreview((previous) =>
      samePreview(previous, target) ? previous : target,
    );
    frame.current = requestAnimationFrame(paint);
  }

  function start(
    event: PointerEvent<HTMLButtonElement>,
    id: WidgetId,
    kind: GestureKind,
  ) {
    const surface = board.current;
    if (
      active.current ||
      !event.isPrimary ||
      event.button !== 0 ||
      !surface ||
      !viewport.current
    )
      return;
    const { currentTarget: capture, clientX: x, clientY: y, pointerId } = event;
    const boardOrigin = toBoard({ x, y }, surface);
    const item = layout.find((entry) => entry.id === id);
    const grab =
      item && kind === "move"
        ? { x: boardOrigin.x - item.x, y: boardOrigin.y - item.y }
        : { x: defaultWidth / 2, y: defaultHeight / 2 };
    active.current = {
      id,
      kind,
      pointerId,
      capture,
      origin: { x, y },
      point: { x, y },
      boardOrigin,
      grab,
      item,
      dragging: false,
    };
    blockedButton.current = null;
    capture.setPointerCapture(pointerId);
  }

  function move(event: PointerEvent) {
    const gesture = active.current;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gesture.point = { x: event.clientX, y: event.clientY };
    if (
      gesture.dragging ||
      Math.hypot(
        event.clientX - gesture.origin.x,
        event.clientY - gesture.origin.y,
      ) < 5
    )
      return;
    gesture.dragging = true;
    if (gesture.kind !== "add") onSelect(gesture.id);
    setDragged({ id: gesture.id, kind: gesture.kind });
    paint();
  }

  function end(event: PointerEvent) {
    const gesture = active.current;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gesture.point = { x: event.clientX, y: event.clientY };
    const result = gesture.dragging ? destination(gesture) : null;
    reset();
    if (result?.next) onCommit(result.next, gesture.id);
    else if (result) onInvalid(gesture.kind);
  }

  function cancel(event: PointerEvent) {
    if (active.current?.pointerId === event.pointerId) reset();
  }

  function rejectDragClick(event: MouseEvent) {
    const button = blockedButton.current;
    blockedButton.current = null;
    if (
      !event.detail ||
      !(event.target instanceof Node) ||
      !button?.contains(event.target)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
  }

  return {
    start,
    move,
    end,
    cancel,
    reset,
    rejectDragClick,
    preview,
    dragged,
    ghost,
  };
}
