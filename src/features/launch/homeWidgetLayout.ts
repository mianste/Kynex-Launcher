export const widgetIds = [
  "clock",
  "notes",
  "checklist",
  "timer",
  "versions",
  "downloads",
  "account",
  "theme",
  "news",
  "skin",
  "assistant",
  "workshop",
  "discover",
  "help",
  "calendar",
  "stopwatch",
  "coordinates",
  "stacks",
  "seed",
  "counter",
] as const;

export type WidgetId = (typeof widgetIds)[number];

export const shapes = [
  "square",
  "rounded",
  "soft",
  "capsule",
  "leaf",
  "arch",
  "cut",
  "petal",
  "custom",
] as const;
export const tones = ["standard", "neutral", "accent"] as const;
export const canvasWidth = 974;
export const initialCanvasHeight = 447;
export const defaultWidth = 236;
export const defaultHeight = 132;
export const minWidgetWidth = 112;
export const minWidgetHeight = 100;
export const maxWidgetHeight = 720;
export const maxCornerRadius = 120;
export const defaultCorners: Corners = [14, 14, 14, 14];
const spacing = 10;
const maximumHeight = 24_000;

export type Corners = [number, number, number, number];
export interface WidgetRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Placement extends WidgetRect {
  id: WidgetId;
  shape: (typeof shapes)[number];
  tone: (typeof tones)[number];
  corners?: Corners;
}

function isWidgetId(value: unknown): value is WidgetId {
  return widgetIds.some((id) => id === value);
}

function makePlacement(id: WidgetId, x: number, y: number): Placement {
  return {
    id,
    x,
    y,
    width: defaultWidth,
    height: defaultHeight,
    shape: "rounded",
    tone: "standard",
  };
}

function overlaps(a: WidgetRect, b: WidgetRect) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function fits(layout: Placement[], item: Placement) {
  const { x, y, width, height } = item;
  return (
    [x, y, width, height].every(Number.isFinite) &&
    x >= 0 &&
    y >= 0 &&
    width >= minWidgetWidth &&
    height >= minWidgetHeight &&
    height <= maxWidgetHeight &&
    x + width <= canvasWidth &&
    y + height <= maximumHeight &&
    !layout.some((other) => other.id !== item.id && overlaps(other, item))
  );
}

export function canvasHeight(layout: Placement[]) {
  return Math.max(
    initialCanvasHeight,
    ...layout.map((item) => Math.ceil(item.y + item.height)),
  );
}

export function positionWidget(
  layout: Placement[],
  id: WidgetId,
  x: number,
  y: number,
) {
  const current = layout.find((item) => item.id === id);
  const item = current ? { ...current, x, y } : makePlacement(id, x, y);
  if (!fits(layout, item)) return null;
  if (!current) return [...layout, item];
  if (current.x === x && current.y === y) return layout;
  return layout.map((entry) => (entry === current ? item : entry));
}

export type WidgetAppearance = Partial<
  Pick<Placement, "width" | "height" | "shape" | "tone" | "corners">
>;

export function customizeWidget(
  layout: Placement[],
  id: WidgetId,
  changes: WidgetAppearance,
) {
  const current = layout.find((item) => item.id === id);
  if (!current) return null;
  if (
    Object.entries(changes).every(
      ([key, value]) => current[key as keyof Placement] === value,
    )
  )
    return layout;
  const item = { ...current, ...changes };
  if (!fits(layout, item)) return null;
  return layout.map((entry) => (entry === current ? item : entry));
}

export function addWidget(layout: Placement[], id: WidgetId) {
  if (layout.some((item) => item.id === id)) return layout;
  const edges = (values: number[]) =>
    [...new Set([0, ...values])].sort((a, b) => a - b);
  const columns = edges(layout.map(({ x, width }) => x + width + spacing));
  const rows = edges(layout.map(({ y, height }) => y + height + spacing));
  for (const y of rows) {
    for (const x of columns) {
      const next = positionWidget(layout, id, x, y);
      if (next) return next;
    }
  }
  return null;
}

function readCorners(value: unknown): Corners | undefined {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every(
      (radius) => typeof radius === "number" && Number.isFinite(radius),
    )
  )
    return undefined;
  return value.map((radius) =>
    Math.max(0, Math.min(maxCornerRadius, Math.round(radius))),
  ) as Corners;
}

export function decodeLayout(
  saved: unknown,
  previous: unknown,
  legacy: unknown,
): Placement[] {
  const layout: Placement[] = [];
  const fromCanvas = Array.isArray(saved);
  const entries: unknown[] = fromCanvas
    ? saved
    : Array.isArray(previous)
      ? previous
      : Array.isArray(legacy)
        ? legacy.slice(0, 8).map((id, position) => ({ id, position }))
        : [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const { id, shape, tone, corners, ...geometry } =
      entry as Partial<Placement> & {
        position?: number;
        columns?: number;
        rows?: number;
      };
    if (!isWidgetId(id) || layout.some((item) => item.id === id)) continue;
    let rect: WidgetRect;
    if (fromCanvas) {
      const { x, y, width, height } = geometry;
      if (
        typeof x !== "number" ||
        typeof y !== "number" ||
        typeof width !== "number" ||
        typeof height !== "number"
      )
        continue;
      rect = { x, y, width, height };
    } else {
      const { position, columns, rows } = geometry;
      if (
        typeof position !== "number" ||
        !Number.isInteger(position) ||
        position < 0 ||
        position >= 28
      )
        continue;
      rect = {
        x: (position % 4) * (defaultWidth + spacing),
        y: Math.floor(position / 4) * (defaultHeight + spacing),
        width: columns === 2 ? defaultWidth * 2 + spacing : defaultWidth,
        height: rows === 2 ? defaultHeight * 2 + spacing : defaultHeight,
      };
      if (
        (position % 4 === 3 && columns === 2) ||
        (Math.floor(position / 4) === 6 && rows === 2)
      )
        continue;
    }
    const item: Placement = {
      id,
      ...rect,
      shape: shapes.find((option) => option === shape) ?? "rounded",
      tone: tones.find((option) => option === tone) ?? "standard",
      corners: readCorners(corners),
    };
    if (fits(layout, item)) layout.push(item);
  }
  return layout;
}
