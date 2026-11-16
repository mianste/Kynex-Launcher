import { describe, expect, it } from "vitest";
import {
  addWidget,
  canvasWidth,
  customizeWidget,
  decodeLayout,
  positionWidget,
  widgetIds,
  type Placement,
} from "../src/features/launch/homeWidgetLayout";

describe("homepage widget canvas", () => {
  it("preserves old slots, sizes and appearance in canvas coordinates", () => {
    const legacy = [
      null,
      "notes",
      "clock",
      "notes",
      null,
      "versions",
      9,
      "theme",
    ];
    expect(
      decodeLayout(undefined, undefined, legacy).map(({ id, x, y }) => [
        id,
        x,
        y,
      ]),
    ).toEqual([
      ["notes", 246, 0],
      ["clock", 492, 0],
      ["versions", 246, 142],
      ["theme", 738, 142],
    ]);
    expect(
      decodeLayout(
        undefined,
        [
          {
            id: "clock",
            position: 5,
            columns: 2,
            rows: 2,
            shape: "leaf",
            tone: "accent",
          },
        ],
        legacy,
      ),
    ).toEqual([
      {
        id: "clock",
        x: 246,
        y: 142,
        width: 482,
        height: 274,
        shape: "leaf",
        tone: "accent",
        corners: undefined,
      },
    ]);
    expect(decodeLayout([], undefined, legacy)).toEqual([]);
  });

  it("gives all widgets a place via automatic placement", () => {
    const layout = widgetIds.reduce(
      (items, id) => addWidget(items, id)!,
      [] as Placement[],
    );
    expect(layout).toHaveLength(widgetIds.length);
  });

  it("accepts arbitrary positions and custom corners and reloads them", () => {
    const layout = positionWidget([], "clock", 117, 53)!;
    const customized = customizeWidget(layout, "clock", {
      width: 326,
      height: 159,
      shape: "custom",
      corners: [58, 3, 66, 20],
      tone: "accent",
    })!;
    expect(customized[0]).toMatchObject({
      x: 117,
      y: 53,
      width: 326,
      height: 159,
    });
    expect(
      decodeLayout(
        JSON.parse(JSON.stringify(customized)),
        undefined,
        undefined,
      ),
    ).toEqual(customized);
  });

  it("preserves readable cards by rejecting overlap and out-of-bounds placement", () => {
    const initial = positionWidget([], "clock", 71, 63)!;
    const layout = positionWidget(initial, "notes", 320, 63)!;
    expect(positionWidget(layout, "notes", 300, 63)).toBeNull();
    expect(positionWidget(layout, "notes", canvasWidth, 0)).toBeNull();
    expect(customizeWidget(layout, "clock", { width: 290 })).toBeNull();
    expect(positionWidget(layout, "notes", 321, 63)?.[1].x).toBe(321);
  });
});
