import { BufferAttribute, BufferGeometry, Color } from "three";

export type SchematicModel = {
  size: [number, number, number];
  grid: [number, number, number];
  step: number;
  palette: string[];
  cells: string;
  entities?: SchematicEntity[];
  movingBlocks?: Record<number, [number, number, number]>;
};

export type SchematicEntity = {
  id: string;
  position: [number, number, number];
  yaw: number;
  pitch: number;
};

const dyes: Record<string, string> = {
  white: "#dfdfd8", orange: "#c96c2d", magenta: "#a54b9a", light_blue: "#6599c6",
  yellow: "#d7b537", lime: "#81a944", pink: "#d2809a", gray: "#454851",
  light_gray: "#979891", cyan: "#348b91", purple: "#714897", blue: "#3e5d9a",
  brown: "#725341", green: "#536938", red: "#a44543", black: "#252731",
};

const wood: Record<string, string> = {
  dark_oak: "#513827", pale_oak: "#b8b0a9", spruce: "#735239", birch: "#cbbc8d",
  jungle: "#9c684d", acacia: "#ab6347", mangrove: "#82443e", cherry: "#cd9f99",
  bamboo: "#b9a168", crimson: "#833f60", warped: "#387c75", oak: "#a88955",
};

export function materialColor(state: string): string {
  const name = state.split("[")[0].split(":").at(-1) ?? state;
  if (/(wool|concrete|terracotta|glass|carpet|bed|banner)/.test(name)) {
    const dye = Object.keys(dyes).sort((a, b) => b.length - a.length).find((key) => name.startsWith(key + "_"));
    if (dye) return dyes[dye];
  }
  if (name.includes("glass") || name.includes("ice")) return "#9ec6d2";
  if (name.includes("water")) return "#477baf";
  if (name.includes("lava")) return "#e77529";
  if (name.includes("cherry_leaves")) return "#cf96af";
  if (name.includes("grass") || name.includes("moss") || name.includes("leaves") || name.includes("vine")) return "#65804b";
  if (/snow|quartz|calcite|bone|white/.test(name)) return "#e5e1d5";
  if (/gold|glowstone|hay|sponge/.test(name)) return "#d4ad49";
  if (/prismarine|emerald|diamond|oxidized_copper/.test(name)) return "#4aa49b";
  if (/deepslate|blackstone|obsidian|basalt|coal/.test(name)) return "#46434c";
  if (/gravel|stone_brick|cobblestone|andesite|tuff|stone|iron/.test(name) && !/sandstone|redstone|end_stone/.test(name)) return "#8e8e89";
  if (/sand|end_stone/.test(name)) return name.startsWith("red_") ? "#bc734a" : "#cbbb90";
  if (/brick|terracotta|granite|copper|redstone|netherrack/.test(name)) return "#a46552";
  if (/dirt|mud|farmland|soul_sand/.test(name)) return "#866348";
  for (const [species, color] of Object.entries(wood)) {
    if (name.startsWith(species + "_") || name.startsWith("stripped_" + species + "_")) return color;
  }
  if (/purpur|amethyst/.test(name)) return "#a88dbd";
  if (/lapis/.test(name)) return "#566fab";
  if (/clay/.test(name)) return "#9b9baa";
  let hash = 0;
  for (const char of state) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return ["#9e8e9e", "#9aa08b", "#a1927e", "#8d9cab"][hash % 4];
}

export function readCells(model: SchematicModel): Uint16Array {
  const data = atob(model.cells);
  const count = model.grid.reduce((product, n) => product * n, 1);
  if (data.length !== count * 2) throw new Error("投影预览数据不完整");
  return Uint16Array.from({ length: count }, (_, index) => {
    const cell = data.charCodeAt(index * 2) | (data.charCodeAt(index * 2 + 1) << 8);
    if (cell >= model.palette.length) throw new Error("投影预览方块无效");
    return cell;
  });
}

export function buildSchematicMesh(grid: SchematicModel["grid"], palette: string[], cells: Uint16Array) {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const materials = palette.map(name => new Color(materialColor(name)));
  const strides = [1, grid[0] * grid[2], grid[0]];
  const shade = [[0.68, 0.83], [0.5, 1], [0.63, 0.78]];

  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    const width = grid[u];
    const height = grid[v];
    const mask = new Int32Array(width * height);
    for (let plane = 0; plane <= grid[axis]; plane++) {
      for (let j = 0; j < height; j++) {
        for (let i = 0; i < width; i++) {
          const offset = i * strides[u] + j * strides[v] + plane * strides[axis];
          const before = plane > 0 ? cells[offset - strides[axis]] : 0;
          const after = plane < grid[axis] ? cells[offset] : 0;
          mask[j * width + i] = before && !after ? before : after && !before ? -after : 0;
        }
      }
      for (let j = 0; j < height; j++) {
        for (let i = 0; i < width;) {
          const id = mask[j * width + i];
          if (!id) { i++; continue; }
          let w = 1;
          let h = 1;
          while (i + w < width && mask[j * width + i + w] === id) w++;
          heightCheck: while (j + h < height) {
            for (let n = 0; n < w; n++) if (mask[(j + h) * width + i + n] !== id) break heightCheck;
            h++;
          }
          for (let row = j; row < j + h; row++) mask.fill(0, row * width + i, row * width + i + w);
          const start = positions.length / 3;
          const color = materials[Math.abs(id)];
          const light = shade[axis][id > 0 ? 1 : 0];
          for (const [s, t] of [[i, j], [i + w, j], [i + w, j + h], [i, j + h]]) {
            const corner = [0, 0, 0];
            corner[axis] = plane;
            corner[u] = s;
            corner[v] = t;
            positions.push(...corner);
            colors.push(Math.round(color.r * light * 255), Math.round(color.g * light * 255), Math.round(color.b * light * 255));
          }
          if (id > 0) indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
          else indices.push(start, start + 2, start + 1, start, start + 3, start + 2);
          i += w;
        }
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(Float32Array.from(positions), 3));
  geometry.setAttribute("color", new BufferAttribute(Uint8Array.from(colors), 3, true));
  geometry.setIndex(new BufferAttribute(Uint32Array.from(indices), 1));
  return geometry;
}
