import { describe, expect, it, vi } from "vitest";
import { minecraftTintColor, texturedSchematic } from "../src/features/library/minecraftAppearance";

describe("Minecraft schematic tint", () => {
  it("keeps the material color when block properties include waterlogged", () => {
    expect(minecraftTintColor("minecraft:oak_leaves[distance=7,persistent=true,waterlogged=true]", 0)).toBe("#77ab2f");
    expect(minecraftTintColor("minecraft:spruce_leaves[distance=1,persistent=true,waterlogged=false]", 0)).toBe("#619961");
    expect(minecraftTintColor("minecraft:birch_leaves[distance=1,waterlogged=true]", 0)).toBe("#80a755");
    expect(minecraftTintColor("minecraft:water[level=0]", 0)).toBe("#3f76e4");
    expect(minecraftTintColor("minecraft:water_cauldron[level=1]", 0)).toBe("#3f76e4");
  });

  it("leaves precolored or unregistered textures neutral even when the model has a tint slot", () => {
    for (const block of ["cherry_leaves[waterlogged=false]", "pale_oak_leaves", "stonecutter",
      "bamboo", "lava_cauldron", "powder_snow_cauldron"]) {
      expect(minecraftTintColor(`minecraft:${block}`, 0)).toBe("#fff");
    }
    expect(minecraftTintColor("example:oak_leaves[waterlogged=true]", 0)).toBe("#fff");
  });

  it("applies biome tint only to the registered faces", () => {
    expect(minecraftTintColor("minecraft:grass_block", -1)).toBe("#fff");
    expect(minecraftTintColor("minecraft:grass_block", 0)).toBe("#91bd59");
    expect(minecraftTintColor("minecraft:leaf_litter", 0)).toBe("#a37546");
    expect(minecraftTintColor("minecraft:lily_pad", 0)).toBe("#208030");
    expect(minecraftTintColor("minecraft:pink_petals", 0)).toBe("#fff");
    expect(minecraftTintColor("minecraft:pink_petals", 1)).toBe("#91bd59");
  });

  it("takes redstone power and stem age from block state", () => {
    expect(minecraftTintColor("minecraft:redstone_wire[power=0,east=none]", 0)).toBe("#4c0000");
    expect(minecraftTintColor("minecraft:redstone_wire[east=none,power=15,west=side]", 0)).toBe("#ff3200");
    expect(minecraftTintColor("minecraft:pumpkin_stem[age=0]", 0)).toBe("rgb(0,255,0)");
    expect(minecraftTintColor("minecraft:melon_stem[age=7]", 0)).toBe("rgb(224,199,28)");
  });
});

it("keeps the shape of a block with missing textures and draws a fallback for an empty model", async () => {
  vi.stubGlobal("document", { createElement: () => ({ getContext: () => ({ fillRect() {} }) }) });
  try {
    const rendered = await texturedSchematic({
      size: [2, 1, 1], grid: [2, 1, 1], step: 1, cells: "",
      palette: ["minecraft:air", "example:slab", "example:empty"],
    }, new Uint16Array([1, 2]), {
      version: "test", textures: {}, states: [[], [{ model: "slab" }], [{ model: "empty" }]],
      models: {
        slab: [{ from: [0, 0, 0], to: [16, 8, 16], faces: { up: { texture: "example:block/missing" } } }],
        empty: [{ from: [0, 0, 0], to: [16, 16, 16], faces: {} }],
      },
    });
    expect(rendered?.incomplete).toBe(true);
    const positions = rendered?.geometry.getAttribute("position");
    expect(positions?.count).toBe(28);
    expect(positions?.getY(0)).toBe(0.5);
    expect(positions?.getX(4)).toBe(1);
    rendered?.geometry.dispose();
    rendered?.texture.dispose();
  } finally {
    vi.unstubAllGlobals();
  }
});

it("turns the front face to each horizontal and vertical facing", async () => {
  vi.stubGlobal("document", { createElement: () => ({ getContext: () => ({ fillRect() {} }) }) });
  try {
    const rotations = [
      { x: 0, y: 0, axis: 2, edge: 0 }, { x: 0, y: 90, axis: 0, edge: 1 },
      { x: 0, y: 180, axis: 2, edge: 1 }, { x: 0, y: 270, axis: 0, edge: 0 },
      { x: 90, y: 0, axis: 1, edge: 0 }, { x: 270, y: 0, axis: 1, edge: 1 },
    ];
    for (const { x, y, axis, edge } of rotations) {
      const rendered = await texturedSchematic({
        size: [1, 1, 1], grid: [1, 1, 1], step: 1, cells: "", palette: ["minecraft:air", "minecraft:furnace"],
      }, new Uint16Array([1]), {
        version: "test", textures: {}, states: [[], [{ model: "front", x, y, uvlock: true }]],
        models: { front: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { north: { texture: "", cullface: "north" } } }] },
      });
      const positions = rendered?.geometry.getAttribute("position");
      expect(positions?.count).toBe(4);
      for (let vertex = 0; vertex < 4; vertex++) {
        expect(positions?.array[vertex * 3 + axis]).toBeCloseTo(edge);
      }
      rendered?.geometry.dispose();
      rendered?.texture.dispose();
    }
  } finally {
    vi.unstubAllGlobals();
  }
});
