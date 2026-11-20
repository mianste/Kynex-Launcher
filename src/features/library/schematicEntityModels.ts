import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, DoubleSide, Euler, Group, InstancedMesh,
  Matrix4, MeshBasicMaterial, NearestFilter, SRGBColorSpace, Vector3,
} from "three";
import type { SchematicModel } from "./schematicGeometry";

type Point = [number, number, number];
type Cube = { origin: Point; size: Point; uv: [number, number]; grow?: Point; mirror?: boolean };
type Bone = {
  pose?: { offset?: Point; rotation?: Point; scale?: Point };
  cubes?: Cube[];
  children?: Record<string, Bone>;
  texture?: [number, number];
};
type EntityModel = {
  root: Bone;
  texture: [number, number];
  transform?: { translate?: Point; rotate?: Point; scale?: Point }[];
};
type Part = { model: string; texture: string; tint: string; blend?: string };
export type EntityAppearance = {
  entityModels?: Record<string, EntityModel>;
  entityTextures?: Record<string, string>;
  entityDraws?: ({ parts: Part[]; scale: number } | null)[];
  blockEntities?: Record<number, { parts: Part[]; rotation: number; translation?: Point; replace: boolean }>;
};

const radians = Math.PI / 180;
const zero: Point = [0, 0, 0];
const ones: Point = [1, 1, 1];
const rotate = (angles: Point) => new Matrix4().makeRotationFromEuler(new Euler(...angles, "ZYX"));

function mesh(model: EntityModel, pitch: number) {
  const points: number[] = [];
  const uv: number[] = [];
  const colors: number[] = [];
  const transform = new Matrix4();
  for (const step of model.transform ?? []) {
    if (step.translate) transform.multiply(new Matrix4().makeTranslation(...step.translate));
    else if (step.rotate) transform.multiply(rotate(step.rotate));
    else if (step.scale) transform.multiply(new Matrix4().makeScale(...step.scale));
  }
  function bake(name: string, bone: Bone, parent: Matrix4, inheritedSize: [number, number]) {
    const [rx, ry, rz] = bone.pose?.rotation ?? zero;
    const look = name === "head" && pitch ? pitch * radians : 0;
    const matrix = parent.clone().multiply(new Matrix4().makeTranslation(...(bone.pose?.offset ?? zero)))
      .multiply(rotate([rx + look, ry, rz])).multiply(new Matrix4().makeScale(...(bone.pose?.scale ?? ones)));
    const [textureWidth, textureHeight] = bone.texture ?? inheritedSize;
    for (const cube of bone.cubes ?? []) {
      if (textureWidth <= 0 || textureHeight <= 0) continue;
      const [x, y, z] = cube.origin;
      const [w, h, d] = cube.size;
      const [gx, gy, gz] = cube.grow ?? zero;
      const [u, v] = cube.uv;
      const [left, right] = cube.mirror ? [x + w + gx, x - gx] : [x - gx, x + w + gx];
      const lower = y - gy, upper = y + h + gy, near = z - gz, far = z + d + gz;
      const vertices = [
        [left, lower, near], [right, lower, near], [right, upper, near], [left, upper, near],
        [left, lower, far], [right, lower, far], [right, upper, far], [left, upper, far],
      ].map(point => new Vector3(...point).applyMatrix4(matrix).divideScalar(16));
      const front = u + d, rightSide = front + w, back = rightSide + d, topEnd = rightSide + w;
      const strip = v + d;
      const faces: [number[], number[]][] = [
        [[5, 4, 0, 1], [front, v, rightSide, strip]],
        [[2, 3, 7, 6], [rightSide, strip, topEnd, v]],
        [[0, 4, 7, 3], [u, strip, front, strip + h]],
        [[1, 0, 3, 2], [front, strip, rightSide, strip + h]],
        [[5, 1, 2, 6], [rightSide, strip, back, strip + h]],
        [[4, 5, 6, 7], [back, strip, back + w, strip + h]],
      ];
      const reversed = Boolean(cube.mirror) !== (matrix.determinant() < 0);
      for (const [corners, [u0, v0, u1, v1]] of faces) {
        const [a, b, c] = corners.map(index => vertices[index]);
        const normal = b.clone().sub(a).cross(c.clone().sub(a));
        if (normal.lengthSq() < 1e-12) continue;
        normal.normalize().multiplyScalar(reversed ? -1 : 1);
        const brightness = Math.max(0.60, 0.78 + normal.y * 0.20 + normal.z * 0.07);
        const texCoords = [[u1, v0], [u0, v0], [u0, v1], [u1, v1]];
        for (const index of reversed ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]) {
          const point = vertices[corners[index]];
          const [s, t] = texCoords[index];
          points.push(point.x, point.y, point.z);
          uv.push(s / textureWidth, 1 - t / textureHeight);
          colors.push(brightness, brightness, brightness);
        }
      }
    }
    for (const [child, part] of Object.entries(bone.children ?? {})) bake(child, part, matrix, [textureWidth, textureHeight]);
  }
  bake("", model.root, transform, model.texture);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(Float32Array.from(points), 3));
  geometry.setAttribute("uv", new BufferAttribute(Float32Array.from(uv), 2));
  geometry.setAttribute("color", new BufferAttribute(Float32Array.from(colors), 3));
  return geometry;
}

async function decodeTexture(encoded: string) {
  const data = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([data], { type: "image/png" }));
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    context.drawImage(bitmap, 0, 0);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.generateMipmaps = false;
    return texture;
  } finally {
    bitmap.close();
  }
}

export async function renderSchematicEntities(schematic: SchematicModel, cells: Uint16Array, appearance: EntityAppearance) {
  const models = appearance.entityModels;
  if (!models) return undefined;
  const textures = new Map<string, CanvasTexture>();
  const materials = new Map<string, MeshBasicMaterial>();
  const geometries = new Map<string, BufferGeometry>();
  const group = new Group();
  const dispose = () => {
    group.children.forEach(object => { if (object instanceof InstancedMesh) object.dispose(); });
    textures.forEach(texture => texture.dispose());
    materials.forEach(material => material.dispose());
    geometries.forEach(geometry => geometry.dispose());
    group.clear();
  };
  try {
    const entries = Object.entries(appearance.entityTextures ?? {});
    for (let i = 0; i < entries.length; i += 16) {
      await Promise.all(entries.slice(i, i + 16).map(async ([id, png]) => {
        const map = await decodeTexture(png).catch(() => undefined);
        if (map) textures.set(id, map);
      }));
    }
    const instances = new Map<string, { geometry: BufferGeometry; material: MeshBasicMaterial; poses: Matrix4[] }>();
    function add(part: Part, pose: Matrix4, pitch = 0) {
      const model = models?.[part.model];
      const texture = textures.get(part.texture);
      if (!model?.root || !texture) return false;
      const shapeKey = `${part.model}:${pitch}`;
      let geometry = geometries.get(shapeKey);
      if (!geometry) {
        geometry = mesh(model, pitch);
        geometries.set(shapeKey, geometry);
      }
      if (!geometry.attributes.position.count) return false;
      const materialKey = `${part.texture}:${part.tint}:${part.blend ?? ""}`;
      let material = materials.get(materialKey);
      if (!material) {
        const additive = part.blend === "eyes" || part.blend === "energy_swirl";
        const transparent = additive || part.blend?.startsWith("translucent") || part.blend === "breeze_wind";
        material = new MeshBasicMaterial({
          map: texture, color: part.tint, vertexColors: !additive, alphaTest: transparent ? 0.02 : 0.5,
          transparent: Boolean(transparent), depthWrite: !transparent, side: DoubleSide,
          ...(additive ? { blending: AdditiveBlending } : {}),
          polygonOffset: additive, polygonOffsetFactor: -1,
        });
        materials.set(materialKey, material);
      }
      const key = `${shapeKey}:${materialKey}`;
      let batch = instances.get(key);
      if (!batch) {
        batch = { geometry, material, poses: [] };
        instances.set(key, batch);
      }
      batch.poses.push(pose);
      return true;
    }
    const [width, , depth] = schematic.grid;
    const step = schematic.step;
    let visible = 0;
    for (const [i, entity] of (schematic.entities ?? []).entries()) {
      const draw = appearance.entityDraws?.[i];
      if (!draw) continue;
      const [x, y, z] = entity.position;
      const size = draw.scale / step;
      const pose = new Matrix4().makeTranslation(x / step, y / step, z / step)
        .multiply(new Matrix4().makeRotationY(-entity.yaw * radians)).scale(new Vector3(size, size, size));
      const parts = draw.parts.map(part => add(part, pose, entity.pitch));
      if (parts.some(Boolean)) visible++;
    }
    const extras = appearance.blockEntities;
    if (extras && Object.keys(extras).length) {
      for (let i = 0; i < cells.length; i++) {
        const draw = extras[cells[i]];
        if (!draw) continue;
        const x = i % width, z = Math.floor(i / width) % depth, y = Math.floor(i / (width * depth));
        const [dx, dy, dz] = draw.translation ?? zero;
        const pose = new Matrix4().makeTranslation(x + 0.5, y, z + 0.5)
          .multiply(new Matrix4().makeRotationY(draw.rotation * radians))
          .multiply(new Matrix4().makeTranslation(-0.5 + dx / 16, dy / 16, -0.5 + dz / 16));
        draw.parts.forEach(part => add(part, pose));
      }
    }
    for (const { geometry, material, poses } of instances.values()) {
      const object = new InstancedMesh(geometry, material, poses.length);
      poses.forEach((pose, id) => object.setMatrixAt(id, pose));
      object.computeBoundingSphere();
      group.add(object);
    }
    group.position.set(-width / 2, 0, -depth / 2);
    return { group, dispose, visible };
  } catch (error) {
    dispose();
    throw error;
  }
}
