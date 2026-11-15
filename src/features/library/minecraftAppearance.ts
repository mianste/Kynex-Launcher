import {
  BufferAttribute, BufferGeometry, CanvasTexture, Color, NearestFilter, SRGBColorSpace, Vector3,
} from "three";
import { materialColor, type SchematicModel } from "./schematicGeometry";

type Point = [number, number, number];
type Direction = "up" | "down" | "north" | "south" | "east" | "west";
type Face = { texture: string; cullface?: Direction; uv?: number[]; rotation?: number; tintindex?: number };
type Element = {
  from: Point;
  to: Point;
  rotation?: { origin: Point; axis: "x" | "y" | "z"; angle: number; rescale?: boolean };
  faces: Partial<Record<Direction, Face>>;
};
type Part = { model: string; x?: number; y?: number; uvlock?: boolean };
export type MinecraftAppearance = {
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

type Tile = { x: number; y: number; opaque: boolean; translucent: boolean };
const tileSize = 18;

async function textureAtlas(textures: MinecraftAppearance["textures"]) {
  const images = Object.entries(textures);
  const columns = Math.ceil(Math.sqrt(images.length + 1));
  const size = columns * tileSize;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("无法生成方块纹理图集");
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, tileSize, tileSize);
  const tiles = new Map<string, Tile>([["", { x: 1, y: 1, opaque: true, translucent: false }]]);
  // Keep image decode bounded when several hundred textures share the atlas.
  for (let start = 0; start < images.length; start += 32) {
    await Promise.all(images.slice(start, start + 32).map(async ([id, encoded], i) => {
      const data = Uint8Array.from(atob(encoded), (ch) => ch.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([data], { type: "image/png" })).catch(() => undefined);
      if (!bitmap) return;
      const index = start + i + 1;
      const x = (index % columns) * tileSize + 1;
      const y = Math.floor(index / columns) * tileSize + 1;
      const frame = Math.min(bitmap.width, bitmap.height);
      ctx.drawImage(bitmap, 0, 0, frame, frame, x, y, 16, 16);
      bitmap.close();
      const pixels = ctx.getImageData(x, y, 16, 16).data;
      const opaque = !pixels.some((value, channel) => channel % 4 === 3 && value < 255);
      const translucent = /glass|water|ice/.test(id) && !opaque;
      tiles.set(id, { x, y, opaque, translucent });
    }));
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  return { texture, tiles, size };
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
  const { x, y } = tile ?? atlas.tiles.get("")!;
  const [u0, v0, u1, v1] = face.uv ?? defaultUV(element.from, element.to, direction);
  const corners = [[u0,v0], [u0,v1], [u1,v1], [u1,v0]];
  const uv = order.map((index) => {
    const [u, v] = corners[(index + (face.rotation ?? 0) / 90) % 4] ?? corners[index];
    return [(x + Math.max(0.02, Math.min(15.98, u))) / atlas.size,
      1 - (y + Math.max(0.02, Math.min(15.98, v))) / atlas.size];
  });
  const missing = !tile || !face.texture;
  const color = new Color(missing ? materialColor(name) : minecraftTintColor(name, face.tintindex ?? -1));
  color.multiplyScalar(shade[faceDirection] ?? 1);
  return { points, uv, color, cull, missing, translucent: tile?.translucent ?? false, opaque: tile?.opaque ?? true };
}

function bakeStates(palette: string[], appearance: MinecraftAppearance, atlas: Awaited<ReturnType<typeof textureAtlas>>) {
  return palette.map((name, id) => {
    if (!id) return { faces: [], cube: false, occludes: false };
    const parts = appearance.states[id] ?? [];
    let elements = parts.flatMap((part) =>
      (appearance.models[part.model] ?? []).map((element) => ({ element, part })),
    ).filter(({ element }) => element.from?.length === 3 && element.to?.length === 3 && element.faces);
    if (!elements.length) elements = [{ element: cube, part: { model: "" } }];
    const faces = elements.flatMap(({ element, part }) => directions.flatMap((direction) => {
      const face = element.faces[direction];
      return face ? [bakeFace(element, direction, face, part, name, atlas)] : [];
    }));
    const isCube = elements.length === 1 && faces.length === 6 && faces.every((face) => face.cull >= 0)
      && !elements[0].element.rotation
      && elements[0].element.from.every((axis) => axis === 0)
      && elements[0].element.to.every((axis) => axis === 16);
    return { faces, cube: isCube, occludes: isCube && faces.every((face) => face.opaque) };
  });
}

export async function texturedSchematic(model: SchematicModel, cells: Uint16Array, appearance: MinecraftAppearance) {
  if (!Object.keys(appearance.textures).length) return undefined;
  const atlas = await textureAtlas(appearance.textures);
  try {
    const shapes = bakeStates(model.palette, appearance, atlas);
    const [width, height, depth] = model.grid;
    const layer = width * depth;
    function walk(visit: (face: BakedFace, x: number, y: number, z: number) => boolean) {
      for (let i = 0; i < cells.length; i++) {
        const id = cells[i];
        if (!id) continue;
        const x = i % width;
        const y = Math.floor(i / layer);
        const z = Math.floor(i / width) % depth;
        const neighbors = [y > 0 ? cells[i - layer] : 0, y + 1 < height ? cells[i + layer] : 0,
          z > 0 ? cells[i - width] : 0, z + 1 < depth ? cells[i + width] : 0,
          x > 0 ? cells[i - 1] : 0, x + 1 < width ? cells[i + 1] : 0];
        const shape = shapes[id];
        for (const face of shape.faces) {
          const adjacent = neighbors[face.cull] ?? 0;
          if (shapes[adjacent].occludes || (adjacent === id && shape.cube)) continue;
          if (!visit(face, x, y, z)) return false;
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
      return opaque + translucent <= 440_000;
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
    walk((face, x, y, z) => {
      const quad = face.translucent ? last++ : first++;
      for (let corner = 0; corner < 4; corner++) {
        const point = face.points[corner];
        const offset = quad * 12 + corner * 3;
        positions[offset] = point.x + x;
        positions[offset + 1] = point.y + y;
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
    geometry.setIndex(new BufferAttribute(indices, 1));
    if (opaque) geometry.addGroup(0, opaque * 6, 0);
    if (translucent) geometry.addGroup(opaque * 6, translucent * 6, 1);
    return { geometry, texture: atlas.texture, incomplete };
  } catch (error) {
    atlas.texture.dispose();
    throw error;
  }
}
