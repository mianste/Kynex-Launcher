import {
  BufferAttribute, BufferGeometry, CanvasTexture, Color, NearestFilter, SRGBColorSpace, Vector3,
} from "three";
import { materialColor, type SchematicModel } from "./schematicGeometry";
import type { EntityAppearance } from "./schematicEntityModels";

type Point = [number, number, number];
type Direction = "up" | "down" | "north" | "south" | "east" | "west";
type Face = {
  texture: string; cullface?: Direction; uv?: number[]; rotation?: number; tintindex?: number;
  force_translucent?: boolean;
};
type Element = {
  from: Point;
  to: Point;
  rotation?: { origin: Point; axis: "x" | "y" | "z"; angle: number; rescale?: boolean };
  faces: Partial<Record<Direction, Face>>;
};
type Part = { model: string; x?: number; y?: number; uvlock?: boolean };
export type MinecraftAppearance = EntityAppearance & {
  version: string;
  states: Part[][];
  models: Record<string, Element[]>;
  textures: Record<string, string>;
};

const directions: Direction[] = ["down", "up", "north", "south", "west", "east"];
const axes = directions.map((_, face) => new Vector3().setComponent(
  [1, 1, 2, 2, 0, 0][face], face % 2 ? 1 : -1,
));
const horizontal = new Vector3(1, 0, 0);
const vertical = new Vector3(0, 1, 0);
const elementAxes = { x: horizontal, y: vertical, z: new Vector3(0, 0, 1) };
const degrees = Math.PI / 180;
const shade = [0.55, 1, 0.82, 0.82, 0.69, 0.69];

function facePoints([x, y, z]: Point, [X, Y, Z]: Point, direction: Direction): Point[] {
  switch (direction) {
    case "down": return [[x,y,Z], [x,y,z], [X,y,z], [X,y,Z]];
    case "up": return [[x,Y,z], [x,Y,Z], [X,Y,Z], [X,Y,z]];
    case "north": return [[X,Y,z], [X,y,z], [x,y,z], [x,Y,z]];
    case "south": return [[x,Y,Z], [x,y,Z], [X,y,Z], [X,Y,Z]];
    case "west": return [[x,Y,z], [x,y,z], [x,y,Z], [x,Y,Z]];
    case "east": return [[X,Y,Z], [X,y,Z], [X,y,z], [X,Y,z]];
  }
}

function defaultUV([x, y, z]: Point, [X, Y, Z]: Point, direction: Direction) {
  switch (direction) {
    case "down": return [x, 16 - Z, X, 16 - z];
    case "up": return [x, z, X, Z];
    case "north": return [16 - X, 16 - Y, 16 - x, 16 - y];
    case "south": return [x, 16 - Y, X, 16 - y];
    case "west": return [z, 16 - Y, Z, 16 - y];
    case "east": return [16 - Z, 16 - Y, 16 - z, 16 - y];
  }
}

type Tile = { x: number; y: number; resolution: number; opaque: boolean; translucent: boolean };

async function textureAtlas(textures: MinecraftAppearance["textures"]) {
  const blockImages: [string, string][] = [];
  const entityImages: [string, string][] = [];
  for (const image of Object.entries(textures)) {
    (image[0].includes(":entity/") ? entityImages : blockImages).push(image);
  }
  const blockSize = 34;
  const entitySize = 66;
  const area = (blockImages.length + 1) * blockSize ** 2 + entityImages.length * entitySize ** 2;
  const width = Math.max(entitySize, Math.ceil(Math.sqrt(area) / blockSize) * blockSize);
  const blockColumns = Math.floor(width / blockSize);
  const entityColumns = Math.floor(width / entitySize);
  const blockHeight = Math.ceil((blockImages.length + 1) / blockColumns) * blockSize;
  const height = blockHeight + Math.ceil(entityImages.length / entityColumns) * entitySize;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("无法生成方块纹理图集");
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, blockSize, blockSize);
  const tiles = new Map<string, Tile>([["", { x: 1, y: 1, resolution: blockSize - 2, opaque: true, translucent: false }]]);
  // Keep image decode bounded when several hundred textures share the atlas.
  for (const { images, columns, size, offsetY, entity } of [
    { images: blockImages, columns: blockColumns, size: blockSize, offsetY: 0, entity: false },
    { images: entityImages, columns: entityColumns, size: entitySize, offsetY: blockHeight, entity: true },
  ]) {
    for (let start = 0; start < images.length; start += 32) {
      await Promise.all(images.slice(start, start + 32).map(async ([id, encoded], i) => {
        const data = Uint8Array.from(atob(encoded), (ch) => ch.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([data], { type: "image/png" })).catch(() => undefined);
        if (!bitmap) return;
        const index = start + i + (entity ? 0 : 1);
        const x = (index % columns) * size + 1;
        const y = offsetY + Math.floor(index / columns) * size + 1;
        const resolution = size - 2;
        const frame = Math.min(bitmap.width, bitmap.height);
        ctx.drawImage(bitmap, 0, 0, entity ? bitmap.width : frame, entity ? bitmap.height : frame,
          x, y, resolution, resolution);
        bitmap.close();
        const pixels = ctx.getImageData(x, y, resolution, resolution).data;
        const alphas = pixels.filter((_, channel) => channel % 4 === 3);
        const opaque = alphas.every(alpha => alpha === 255);
        const translucent = !entity && /glass|water|(?:^|\/)ice$/.test(id)
          && alphas.some(alpha => alpha > 0 && alpha < 255);
        tiles.set(id, { x, y, resolution, opaque, translucent });
      }));
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  return { texture, tiles, width, height };
}

type BakedFace = {
  points: Vector3[];
  uv: number[][];
  color: Color;
  cull: number;
  translucent: boolean;
  opaque: boolean;
  missing: boolean;
};

const full = [0, 0, 0] as Point;
const end = [16, 16, 16] as Point;
const cube = {
  from: full, to: end, faces: Object.fromEntries(directions.map((dir) => [dir, { texture: "", cullface: dir }])),
} as Element;
const worldBases = directions.map((dir) => {
  const [a, b, , d] = facePoints(full, end, dir).map((point) => new Vector3(...point));
  return [d.sub(a), b.sub(a)];
});

function rotated(vector: Vector3, part: Part) {
  return vector.applyAxisAngle(horizontal, -(part.x ?? 0) * degrees)
    .applyAxisAngle(vertical, -(part.y ?? 0) * degrees);
}

function closestDirection(vector: Vector3) {
  return axes.findIndex((axis) => axis.dot(vector) > 0.99);
}

// Schematics have no biome data. Use the Java client's plains colors for biome-dependent tints.
const grassTint = "#91bd59";
const blockTints = new Map<string, string>([
  ...["grass_block", "short_grass", "tall_grass", "fern", "large_fern", "potted_fern", "bush", "sugar_cane"]
    .map((block) => [block, grassTint] as const),
  ...["oak_leaves", "acacia_leaves", "dark_oak_leaves", "jungle_leaves", "mangrove_leaves", "vine"]
    .map((block) => [block, "#77ab2f"] as const),
  ...["water", "bubble_column", "water_cauldron"].map((block) => [block, "#3f76e4"] as const),
  ["spruce_leaves", "#619961"],
  ["birch_leaves", "#80a755"],
  ["leaf_litter", "#a37546"],
  ["lily_pad", "#208030"],
  ["attached_melon_stem", "#e0c71c"],
  ["attached_pumpkin_stem", "#e0c71c"],
]);

const redstoneTints = [
  "#4c0000", "#700000", "#7a0000", "#840000", "#8e0000", "#990000", "#a30000", "#ad0000",
  "#b70000", "#c10000", "#cc0000", "#d60000", "#e00000", "#ea0600", "#f41b00", "#ff3200",
];

export function minecraftTintColor(state: string, tintIndex: number) {
  const block = state.split("[", 1)[0].replace(/^minecraft:/, "");
  if (block === "pink_petals" || block === "wildflowers") return tintIndex === 1 ? grassTint : "#fff";
  if (tintIndex !== 0) return "#fff";
  if (block === "redstone_wire") {
    const power = Number(state.match(/(?:\[|,)power=(\d+)/)?.[1] ?? 0);
    return redstoneTints[Math.min(power, 15)];
  }
  if (block === "melon_stem" || block === "pumpkin_stem") {
    const age = Math.min(Number(state.match(/(?:\[|,)age=(\d+)/)?.[1] ?? 0), 7);
    return `rgb(${age * 32},${255 - age * 8},${age * 4})`;
  }
  // Models can declare a tint slot without registering a block color, such as cherry leaves and lava cauldrons.
  return blockTints.get(block) ?? "#fff";
}

function bakeFace(element: Element, direction: Direction, face: Face, part: Part,
  name: string, atlas: Awaited<ReturnType<typeof textureAtlas>>): BakedFace {
  const points = facePoints(element.from, element.to, direction).map((point) => new Vector3(...point));
  const faceDirection = closestDirection(rotated(axes[directions.indexOf(direction)].clone(), part));
  const cull = face.cullface && directions.includes(face.cullface)
    ? closestDirection(rotated(axes[directions.indexOf(face.cullface)].clone(), part)) : -1;
  let order = [0, 1, 2, 3];
  if (part.uvlock && faceDirection >= 0 && worldBases[faceDirection]) {
    const center = points[0].clone().add(points[2]).multiplyScalar(0.5);
    const [u, v] = worldBases[faceDirection];
    order = points.map((point, index) => {
      const offset = rotated(point.clone().sub(center), part);
      // Flat or inset faces can have a zero-width axis.
      if (element.from.some((value, axis) => value === element.to[axis]) && offset.lengthSq() === 0) return index;
      return offset.dot(u) > 0 ? (offset.dot(v) > 0 ? 2 : 3) : (offset.dot(v) > 0 ? 1 : 0);
    });
  }
  const rotation = element.rotation;
  const rotationAxis = rotation && elementAxes[rotation.axis];
  const origin = rotation && new Vector3(...rotation.origin);
  const blockCenter = new Vector3(8, 8, 8);
  for (const point of points) {
    if (rotation && rotationAxis && origin) {
      const angle = rotation.angle * degrees;
      point.sub(origin).applyAxisAngle(rotationAxis, angle);
      if (rotation.rescale) {
        const correction = 1 / Math.max(0.01, Math.cos(angle));
        for (let axis = 0; axis < 3; axis++) {
          if (rotationAxis.getComponent(axis) === 0) point.setComponent(axis, point.getComponent(axis) * correction);
        }
      }
      point.add(origin);
    }
    rotated(point.sub(blockCenter), part).add(blockCenter).divideScalar(16);
  }
  const tile = atlas.tiles.get(face.texture);
  const { x, y, resolution } = tile ?? atlas.tiles.get("")!;
  const [u0, v0, u1, v1] = face.uv ?? defaultUV(element.from, element.to, direction);
  const corners = [[u0,v0], [u0,v1], [u1,v1], [u1,v0]];
  const uv = order.map((index) => {
    const [u, v] = corners[(index + (face.rotation ?? 0) / 90) % 4] ?? corners[index];
    return [(x + Math.max(0.02, Math.min(15.98, u)) * resolution / 16) / atlas.width,
      1 - (y + Math.max(0.02, Math.min(15.98, v)) * resolution / 16) / atlas.height];
  });
  const missing = !tile || !face.texture;
  const color = new Color(missing ? materialColor(name) : minecraftTintColor(name, face.tintindex ?? -1));
  color.multiplyScalar(shade[faceDirection] ?? 1);
  const translucent = !missing && Boolean(face.force_translucent || tile?.translucent);
  return { points, uv, color, cull, missing, translucent, opaque: !translucent && (tile?.opaque ?? true) };
}

function bakeStates(palette: string[], appearance: MinecraftAppearance, atlas: Awaited<ReturnType<typeof textureAtlas>>) {
  return palette.map((name, id) => {
    const key = name.split("[", 1)[0];
    const resource = key.includes(":") ? key : `minecraft:${key}`;
    const block = resource === "minecraft:bubble_column" ? "minecraft:water" : resource;
    const fluid = block === "minecraft:water" || block === "minecraft:lava";
    if (!id || block === "minecraft:barrier" || block === "minecraft:light" || appearance.blockEntities?.[id]?.replace) {
      return { faces: [], block, fluid: false, fluidHeight: 0, merge: false, occludes: false };
    }
    const parts = appearance.states[id] ?? [];
    let elements = parts.flatMap((part) =>
      (appearance.models[part.model] ?? []).map((element) => ({ element, part })),
    ).filter(({ element }) => element.from?.length === 3 && element.to?.length === 3
      && directions.some(direction => element.faces?.[direction]));
    if (!elements.length) elements = [{ element: cube, part: { model: "" } }];
    const faces = elements.flatMap(({ element, part }) => directions.flatMap((direction) => {
      const face = element.faces[direction];
      return face ? [bakeFace(element, direction, face, part, name, atlas)] : [];
    }));
    const isCube = elements.length === 1 && faces.length === 6 && faces.every((face) => face.cull >= 0)
      && !elements[0].element.rotation
      && elements[0].element.from.every((axis) => axis === 0)
      && elements[0].element.to.every((axis) => axis === 16);
    const clearCube = /(?:^|:)(?:[a-z_]+_)?glass$|^minecraft:ice$/.test(block);
    const leaves = block.endsWith("_leaves");
    return {
      faces, block, fluid, fluidHeight: fluid ? elements[0].element.to[1] / 16 : 0,
      merge: isCube && clearCube,
      occludes: isCube && !fluid && !clearCube && !leaves && faces.every(face => face.opaque && !face.missing),
    };
  });
}

export async function texturedSchematic(model: SchematicModel, cells: Uint16Array, appearance: MinecraftAppearance) {
  const atlas = await textureAtlas(appearance.textures);
  try {
    const shapes = bakeStates(model.palette, appearance, atlas);
    const [width, height, depth] = model.grid;
    const layer = width * depth;
    const offsets = [-layer, layer, -width, width, -1, 1];
    function walk(visit: (face: BakedFace, x: number, y: number, z: number, fullFluid: boolean) => boolean) {
      const neighbors = [0, 0, 0, 0, 0, 0];
      for (let i = 0; i < cells.length; i++) {
        const id = cells[i];
        if (!id) continue;
        const x = i % width;
        const y = Math.floor(i / layer);
        const z = Math.floor(i / width) % depth;
        neighbors[0] = y > 0 ? cells[i - layer] : 0;
        neighbors[1] = y + 1 < height ? cells[i + layer] : 0;
        neighbors[2] = z > 0 ? cells[i - width] : 0;
        neighbors[3] = z + 1 < depth ? cells[i + width] : 0;
        neighbors[4] = x > 0 ? cells[i - 1] : 0;
        neighbors[5] = x + 1 < width ? cells[i + 1] : 0;
        const offset = model.movingBlocks?.[i];
        const shape = shapes[id];
        const fullFluid = shape.fluid && shapes[neighbors[1]].block === shape.block;
        for (const face of shape.faces) {
          if (offset) {
            if (!visit(face, x + offset[0], y + offset[1], z + offset[2], false)) return false;
            continue;
          }
          if (face.cull >= 0 && neighbors[face.cull] && model.movingBlocks?.[i + offsets[face.cull]]) {
            if (!visit(face, x, y, z, fullFluid)) return false;
            continue;
          }
          const adjacent = shapes[neighbors[face.cull] ?? 0];
          if (adjacent.occludes || (shape.merge && adjacent.merge && adjacent.block === shape.block)) continue;
          if (shape.fluid && adjacent.block === shape.block) {
            if (face.cull < 2) continue;
            const aboveAdjacent = y + 1 < height ? cells[i + layer + offsets[face.cull]] : 0;
            if (shapes[aboveAdjacent].block === shape.block
              || (!fullFluid && adjacent.fluidHeight >= shape.fluidHeight)) continue;
          }
          if (!visit(face, x, y, z, fullFluid)) return false;
        }
      }
      return true;
    }
    let opaque = 0;
    let translucent = 0;
    let incomplete = false;
    const fits = walk((face) => {
      if (face.translucent) translucent++;
      else opaque++;
      if (face.missing) incomplete = true;
      return opaque + translucent <= 800_000;
    });
    if (!fits) {
      atlas.texture.dispose();
      return undefined;
    }
    const quads = opaque + translucent;
    const positions = new Float32Array(quads * 12);
    const uv = new Float32Array(quads * 8);
    const colors = new Uint8Array(quads * 12);
    const indices = new Uint32Array(quads * 6);
    let first = 0;
    let last = opaque;
    walk((face, x, y, z, fullFluid) => {
      const quad = face.translucent ? last++ : first++;
      for (let corner = 0; corner < 4; corner++) {
        const point = face.points[corner];
        const offset = quad * 12 + corner * 3;
        positions[offset] = point.x + x;
        positions[offset + 1] = (fullFluid && point.y > 0 ? 1 : point.y) + y;
        positions[offset + 2] = point.z + z;
        colors[offset] = Math.round(face.color.r * 255);
        colors[offset + 1] = Math.round(face.color.g * 255);
        colors[offset + 2] = Math.round(face.color.b * 255);
        uv.set(face.uv[corner], quad * 8 + corner * 2);
      }
      const vertex = quad * 4;
      indices.set([vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3], quad * 6);
      return true;
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new BufferAttribute(uv, 2));
    geometry.setAttribute("color", new BufferAttribute(colors, 3, true));
    const index = new BufferAttribute(indices, 1);
    geometry.setIndex(index);
    if (opaque) geometry.addGroup(0, opaque * 6, 0);
    if (translucent) geometry.addGroup(opaque * 6, translucent * 6, 1);
    // Blended faces in one mesh otherwise use file order, so orbiting can make glass obscure water.
    let sortTransparency: ((direction: Vector3) => void) | undefined;
    if (translucent > 1 && translucent <= 24_000) {
      const lastDirection = new Vector3();
      const byDepth = Float32Array.from({ length: translucent }, () => 0);
      const order = Uint32Array.from({ length: translucent }, (_, face) => face);
      const centers = new Float32Array(translucent * 3);
      for (let face = 0; face < translucent; face++) {
        const start = (opaque + face) * 12;
        for (let axis = 0; axis < 3; axis++) {
          centers[face * 3 + axis] = (positions[start + axis] + positions[start + 6 + axis]) * 0.5;
        }
      }
      sortTransparency = direction => {
        if (direction.dot(lastDirection) > 0.999) return;
        lastDirection.copy(direction);
        for (let face = 0; face < translucent; face++) {
          const start = face * 3;
          byDepth[face] = centers[start] * direction.x + centers[start + 1] * direction.y + centers[start + 2] * direction.z;
        }
        order.sort((a, b) => byDepth[b] - byDepth[a]);
        for (let face = 0; face < translucent; face++) {
          const vertex = (opaque + order[face]) * 4;
          const start = (opaque + face) * 6;
          indices[start] = vertex;
          indices[start + 1] = vertex + 1;
          indices[start + 2] = vertex + 2;
          indices[start + 3] = vertex;
          indices[start + 4] = vertex + 2;
          indices[start + 5] = vertex + 3;
        }
        index.needsUpdate = true;
      };
    }
    return { geometry, texture: atlas.texture, incomplete, sortTransparency };
  } catch (error) {
    atlas.texture.dispose();
    throw error;
  }
}
