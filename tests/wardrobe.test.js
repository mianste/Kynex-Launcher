import { describe, it, expect } from "vitest";
import { defaultPlayerAppearance } from "../src/features/skin/textures";
import {
  putSkin,
  sameAppearance,
  nameSkin,
} from "../src/features/skin/wardrobeState";
it("chooses the default avatar and model from each offline UUID", () => {
  expect(
    defaultPlayerAppearance("4d69167e-5d5f-3487-adf0-dfded168a764"),
  ).toMatchObject({ name: "Alex", model: "Slim" });
  expect(
    defaultPlayerAppearance("b50ad385829d3141a2167e7d7539ba7f"),
  ).toMatchObject({ name: "Steve", model: "Classic" });
  expect(defaultPlayerAppearance()).toMatchObject({
    name: "Steve",
    model: "Classic",
  });
});
const a = {
  id: "a",
  name: "初见",
  texture: "data:a",
  model: "Classic",
};
describe("wardrobe identity and variants", () => {
  it("keeps Slim and Classic variants of the same texture, deduplicates identical appearances", () => {
    const slim = { ...a, id: "b", model: "Slim" };
    expect(putSkin([a], slim)).toHaveLength(2);
    const duplicate = { ...a, id: "c", name: "别名" };
    expect(putSkin([a, slim], duplicate).map((x) => x.id)).toEqual(["c", "b"]);
  });
  it("model changes count as a different appearance", () => {
    expect(sameAppearance(a, { ...a, model: "Slim" })).toBe(false);
    const renamed = { ...a, id: "b", name: "改名" };
    expect(sameAppearance(a, renamed)).toBe(true);
  });
  it("renaming does not mutate textures or the equipped object and rejects empty names", () => {
    const items = nameSkin([a], "a", "  山海  ");
    expect(items[0]).toEqual({ ...a, name: "山海" });
    expect(a.name).toBe("初见");
    expect(() => nameSkin([a], "a", "  ")).toThrow();
  });
});
