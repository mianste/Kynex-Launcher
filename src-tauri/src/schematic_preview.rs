use crate::{engine, err, schematics, string, Core, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use fastnbt::Value as Nbt;
use flate2::read::{GzDecoder, ZlibDecoder};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;

const MAX_NBT_BYTES: u64 = 128 * 1024 * 1024;
const MAX_BLOCKS: usize = 128_000_000;
const MAX_PREVIEW_CELLS: usize = 1_000_000;
const MAX_PREVIEW_AXIS: usize = 2048;

pub(crate) fn worker(core: &Core) -> std::sync::Arc<tokio::sync::Mutex<()>> {
    core.jobs
        .file_lock(&core.data_root.join("cache/schematic-preview-worker"))
}

pub(crate) fn preview(core: &Core, payload: &Value) -> Result<Value> {
    let name = string(payload, "name")?;
    let directory =
        engine::resource_dir(core, &json!({"id":payload["id"],"kind":schematics::KIND}))?;
    if payload["directory"]
        .as_str()
        .is_some_and(|previous| Path::new(previous) != directory)
    {
        return Err("投影目录已更改，请刷新后重新选择文件".into());
    }
    let mut selected = schematics::selected_paths(&directory, &[json!(name)])?;
    let (_, path) = selected.pop().ok_or("找不到投影文件")?;
    read(&path)
}

pub(crate) fn read(path: &Path) -> Result<Value> {
    read_stream(File::open(path).map_err(err)?)
}

pub(crate) fn read_stream(input: impl Read + 'static) -> Result<Value> {
    let mut file = BufReader::new(input);
    let header = file.fill_buf().map_err(err)?;
    let reader: Box<dyn Read> = if header.starts_with(&[0x1f, 0x8b]) {
        Box::new(GzDecoder::new(file))
    } else if header.first() == Some(&0x78) {
        Box::new(ZlibDecoder::new(file))
    } else {
        Box::new(file)
    };
    let mut bytes = Vec::new();
    reader
        .take(MAX_NBT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("无法解压投影：{e}"))?;
    if bytes.len() as u64 > MAX_NBT_BYTES {
        return Err("此投影解压后过大，无法在启动器中预览".into());
    }
    nbt_limits::check(&bytes)?;
    let root: Nbt = fastnbt::from_bytes(&bytes).map_err(|e| format!("无法读取此投影：{e}"))?;
    decode(&root)
}

fn compound(value: &Nbt) -> Result<&HashMap<String, Nbt>> {
    match value {
        Nbt::Compound(value) => Ok(value),
        _ => Err("投影文件中的结构数据无效".into()),
    }
}

fn field<'a>(value: &'a Nbt, name: &str) -> Result<&'a Nbt> {
    compound(value)?
        .get(name)
        .ok_or_else(|| format!("投影缺少 {name} 数据"))
}

fn list(value: &Nbt) -> Result<&[Nbt]> {
    match value {
        Nbt::List(value) => Ok(value),
        _ => Err("投影文件中的列表无效".into()),
    }
}

fn integer(value: &Nbt) -> Result<i64> {
    match value {
        Nbt::Int(n) => Ok(i64::from(*n)),
        Nbt::Short(n) => Ok(i64::from(*n)),
        Nbt::Byte(n) => Ok(i64::from(*n)),
        _ => Err("投影文件中的坐标或尺寸无效".into()),
    }
}

fn list_pos(value: &Nbt) -> Result<[i64; 3]> {
    match list(value)? {
        [x, y, z] => Ok([integer(x)?, integer(y)?, integer(z)?]),
        _ => Err("投影文件中的坐标或尺寸无效".into()),
    }
}

fn xyz(value: &Nbt) -> Result<[i64; 3]> {
    Ok([
        integer(field(value, "x")?)?,
        integer(field(value, "y")?)?,
        integer(field(value, "z")?)?,
    ])
}

fn byte_array(value: &Nbt) -> Result<&[i8]> {
    match value {
        Nbt::ByteArray(value) => Ok(value),
        _ => Err("投影文件中的方块数组无效".into()),
    }
}

fn region_size(size: [i64; 3]) -> Result<[usize; 3]> {
    if size
        .iter()
        .any(|axis| *axis <= 0 || *axis > MAX_BLOCKS as i64)
    {
        return Err("投影尺寸无效或超出预览范围".into());
    }
    let size = size.map(|n| n as usize);
    volume(size)?;
    Ok(size)
}

fn volume([x, y, z]: [usize; 3]) -> Result<usize> {
    let count = x.saturating_mul(y).saturating_mul(z);
    if count > MAX_BLOCKS {
        return Err("此投影的方块区域过大，无法在启动器中预览".into());
    }
    Ok(count)
}

struct Preview {
    origin: [i64; 3],
    size: [usize; 3],
    grid: [usize; 3],
    step: usize,
    palette: Vec<String>,
    ids: HashMap<String, u16>,
    cells: Vec<u16>,
    entities: Vec<Value>,
    moving_blocks: BTreeMap<usize, [f32; 3]>,
}

impl Preview {
    fn new(origin: [i64; 3], size: [usize; 3]) -> Self {
        let mut high = size.into_iter().max().unwrap_or(1);
        let mut step = high.div_ceil(MAX_PREVIEW_AXIS).max(1);
        while step < high {
            let middle = step + (high - step) / 2;
            if size
                .map(|axis| axis.div_ceil(middle))
                .into_iter()
                .fold(1usize, usize::saturating_mul)
                <= MAX_PREVIEW_CELLS
            {
                high = middle;
            } else {
                step = middle + 1;
            }
        }
        let grid = size.map(|axis| axis.div_ceil(step));
        Self {
            origin,
            size,
            grid,
            step,
            palette: vec!["minecraft:air".into()],
            ids: HashMap::new(),
            cells: vec![0; grid.into_iter().product()],
            entities: Vec::new(),
            moving_blocks: BTreeMap::new(),
        }
    }

    fn material(&mut self, state: &str) -> Result<u16> {
        let name = state.split('[').next().unwrap_or(state);
        if matches!(
            name.strip_prefix("minecraft:").unwrap_or(name),
            "air" | "cave_air" | "void_air" | "structure_void"
        ) {
            return Ok(0);
        }
        if let Some(id) = self.ids.get(state) {
            return Ok(*id);
        }
        let id = u16::try_from(self.palette.len()).map_err(|_| "投影中的方块种类过多")?;
        self.ids.insert(state.into(), id);
        self.palette.push(state.into());
        Ok(id)
    }

    fn state_list(&mut self, value: &Nbt) -> Result<Vec<u16>> {
        list(value)?
            .iter()
            .map(|block| self.state_material(block))
            .collect()
    }

    fn state_material(&mut self, block: &Nbt) -> Result<u16> {
        let Nbt::String(name) = field(block, "Name")? else {
            return Err("投影文件中的方块名称无效".into());
        };
        let properties = compound(block)?
            .get("Properties")
            .map(compound)
            .transpose()?;
        let Some(properties) = properties.filter(|fields| !fields.is_empty()) else {
            return self.material(name);
        };
        let sorted: BTreeMap<_, _> = properties.iter().collect();
        let properties = sorted
            .into_iter()
            .filter_map(|(key, value)| match value {
                Nbt::String(value) => Some(format!("{key}={value}")),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join(",");
        self.material(&format!("{name}[{properties}]"))
    }

    fn moving_piston(&mut self, position: [i64; 3], record: &Nbt) {
        if self.step != 1 {
            return;
        }
        let local: [i64; 3] = std::array::from_fn(|axis| position[axis] - self.origin[axis]);
        if local
            .iter()
            .zip(self.size)
            .any(|(&coord, extent)| coord < 0 || coord >= extent as i64)
        {
            return;
        }
        let [x, y, z] = local.map(|coord| coord as usize);
        let index = x + self.grid[0] * (z + self.grid[2] * y);
        let name = self.palette[self.cells[index] as usize]
            .split('[')
            .next()
            .unwrap_or_default();
        if !matches!(name, "moving_piston" | "minecraft:moving_piston") {
            return;
        }
        let Ok(data) = compound(record) else { return };
        let Some(block) = data.get("blockState") else {
            return;
        };
        let Ok(material) = self.state_material(block) else {
            return;
        };
        self.cells[index] = material;
        let number = |key| data.get(key).and_then(|v| integer(v).ok()).unwrap_or(0);
        let extending = number("extending") != 0;
        if !extending && number("source") != 0 {
            return;
        }
        let directions = [
            [0., -1., 0.],
            [0., 1., 0.],
            [0., 0., -1.],
            [0., 0., 1.],
            [-1., 0., 0.],
            [1., 0., 0.],
        ];
        let Some(direction) = directions.get(number("facing") as usize) else {
            return;
        };
        let progress = match data.get("progress") {
            Some(Nbt::Float(value)) if value.is_finite() => value.clamp(0., 1.),
            _ => 0.,
        };
        let distance = if extending {
            progress - 1.
        } else {
            1. - progress
        };
        self.moving_blocks
            .insert(index, direction.map(|component| component * distance));
    }

    fn block_entities(&mut self, records: Option<&Nbt>, offset: [i64; 3]) {
        let Some(records) = records.and_then(|value| list(value).ok()) else {
            return;
        };
        for record in records {
            let Ok(fields) = compound(record) else {
                continue;
            };
            let position = if let Some(Nbt::IntArray(pos)) = fields.get("Pos") {
                if let [x, y, z] = &pos[..] {
                    [i64::from(*x), i64::from(*y), i64::from(*z)]
                } else {
                    continue;
                }
            } else {
                let Ok(value) = xyz(record) else { continue };
                value
            };
            self.moving_piston(
                std::array::from_fn(|axis| offset[axis] + position[axis]),
                fields.get("Data").unwrap_or(record),
            );
        }
    }

    fn place(&mut self, position: [i64; 3], material: u16) {
        if material == 0 {
            return;
        }
        let [x, y, z] =
            std::array::from_fn(|axis| ((position[axis] - self.origin[axis]) as usize) / self.step);
        let index = x + self.grid[0] * (z + self.grid[2] * y);
        self.cells[index] = material;
    }

    fn place_index(
        &mut self,
        index: usize,
        [width, _, depth]: [usize; 3],
        origin: [i64; 3],
        id: u16,
    ) {
        if id != 0 {
            let coord = [
                index % width,
                index / (width * depth),
                index / width % depth,
            ];
            self.place(
                std::array::from_fn(|axis| origin[axis] + coord[axis] as i64),
                id,
            );
        }
    }

    fn finish(mut self) -> Result<Value> {
        if self.entities.is_empty() && !self.cells.iter().any(|cell| *cell != 0) {
            return Err("此投影中没有可预览的方块或实体".into());
        }
        // A file can declare unused states. Only request textures for blocks that survived placement.
        let mut used = vec![false; self.palette.len()];
        used[0] = true;
        for &cell in &self.cells {
            used[cell as usize] = true;
        }
        let mut remap = vec![0u16; self.palette.len()];
        let mut palette = Vec::new();
        for (old, state) in self.palette.into_iter().enumerate() {
            if used[old] {
                remap[old] = palette.len() as u16;
                palette.push(state);
            }
        }
        for cell in &mut self.cells {
            *cell = remap[*cell as usize];
        }
        let bytes: Vec<_> = self.cells.into_iter().flat_map(u16::to_le_bytes).collect();
        Ok(
            json!({"size":self.size,"grid":self.grid,"step":self.step,"palette":palette,"cells":STANDARD.encode(bytes),"entities":self.entities,"movingBlocks":self.moving_blocks}),
        )
    }
}

fn litematic(regions: &Nbt) -> Result<Preview> {
    let mut min = [i64::MAX; 3];
    let mut max = [i64::MIN; 3];
    let mut layouts = Vec::new();
    let mut blocks = 0;
    let ordered: BTreeMap<_, _> = compound(regions)?.iter().collect();
    for region in ordered.values().copied() {
        let position = xyz(field(region, "Position")?)?;
        let signed = xyz(field(region, "Size")?)?;
        let size = region_size(signed.map(i64::abs))?;
        let origin: [i64; 3] =
            std::array::from_fn(|axis| position[axis] + (signed[axis] + 1).min(0));
        for axis in 0..3 {
            min[axis] = min[axis].min(origin[axis]);
            max[axis] = max[axis].max(origin[axis] + size[axis] as i64);
        }
        blocks += volume(size)?;
        if blocks > MAX_BLOCKS {
            return Err("此投影的方块区域过大，无法在启动器中预览".into());
        }
        layouts.push((region, position, origin, size));
    }
    if layouts.is_empty() {
        return Err("此投影没有建筑区域".into());
    }
    let mut preview = Preview::new(
        min,
        std::array::from_fn(|axis| (max[axis] - min[axis]) as usize),
    );
    for (region, position, origin, size) in layouts {
        preview.add_entities(compound(region)?.get("Entities"), position, false);
        let palette = preview.state_list(field(region, "BlockStatePalette")?)?;
        if palette.is_empty() {
            return Err("投影的方块调色板为空".into());
        }
        let Nbt::LongArray(words) = field(region, "BlockStates")? else {
            return Err("无法读取 Litematica 方块数组".into());
        };
        let width = (usize::BITS - (palette.len() - 1).leading_zeros()).max(2) as usize;
        let count = volume(size)?;
        if words.len() < (count * width).div_ceil(64) {
            return Err("Litematica 方块数组不完整".into());
        }
        if palette.iter().all(|id| *id == 0) {
            continue;
        }
        for index in 0..count {
            let bit = index * width;
            let word = bit / 64;
            let shift = bit % 64;
            let mut value = (words[word] as u64) >> shift;
            if shift + width > 64 {
                value |= (words[word + 1] as u64) << (64 - shift);
            }
            let id = (value & ((1u64 << width) - 1)) as usize;
            let material = *palette.get(id).ok_or("Litematica 方块编号无效")?;
            preview.place_index(index, size, origin, material);
        }
        preview.block_entities(compound(region)?.get("TileEntities"), origin);
    }
    Ok(preview)
}

fn dimensions(root: &Nbt) -> Result<[usize; 3]> {
    let axis = |name| match field(root, name)? {
        Nbt::Short(n) => Ok(i64::from(*n as u16)),
        other => integer(other),
    };
    region_size([axis("Width")?, axis("Height")?, axis("Length")?])
}

fn sponge(root: &Nbt, palette: &Nbt, data: &Nbt) -> Result<Preview> {
    let size = dimensions(root)?;
    let mut preview = Preview::new([0; 3], size);
    preview.add_entities(compound(root)?.get("Entities"), [0; 3], false);
    let mut ids = HashMap::new();
    for (name, value) in compound(palette)? {
        let id = u32::try_from(integer(value)?).map_err(|_| "Sponge 方块编号无效")?;
        ids.insert(id, preview.material(name)?);
    }
    let mut data = byte_array(data)?.iter().map(|byte| *byte as u8);
    for index in 0..volume(size)? {
        let mut value = 0u32;
        let mut complete = false;
        for shift in [0, 7, 14, 21, 28] {
            let byte = data.next().ok_or("Sponge 方块数组不完整")?;
            if shift == 28 && byte > 15 {
                return Err("Sponge 方块编号无效".into());
            }
            value |= u32::from(byte & 0x7f) << shift;
            if byte < 0x80 {
                complete = true;
                break;
            }
        }
        let material = complete
            .then(|| ids.get(&value))
            .flatten()
            .ok_or("Sponge 方块编号无效")?;
        preview.place_index(index, size, [0; 3], *material);
    }
    if data.next().is_some() {
        return Err("Sponge 方块数组与声明尺寸不符".into());
    }
    let root = compound(root)?;
    let block_container = root.get("Blocks").and_then(|value| compound(value).ok());
    preview.block_entities(
        block_container
            .and_then(|value| value.get("BlockEntities"))
            .or_else(|| root.get("BlockEntities")),
        [0; 3],
    );
    Ok(preview)
}

fn vanilla(root: &Nbt) -> Result<Preview> {
    let size = region_size(list_pos(field(root, "size")?)?)?;
    let mut preview = Preview::new([0; 3], size);
    preview.add_entities(compound(root)?.get("entities"), [0; 3], true);
    let palette = match field(root, "palette") {
        Ok(palette) => palette,
        Err(_) => list(field(root, "palettes")?)?
            .first()
            .ok_or("结构方块调色板为空")?,
    };
    let palette = preview.state_list(palette)?;
    for block in list(field(root, "blocks")?)? {
        let position = list_pos(field(block, "pos")?)?;
        if position
            .iter()
            .zip(size)
            .any(|(&axis, extent)| axis < 0 || axis >= extent as i64)
        {
            return Err("结构方块的位置超出声明尺寸".into());
        }
        let id = integer(field(block, "state")?)? as usize;
        preview.place(position, *palette.get(id).ok_or("结构方块编号无效")?);
        if let Some(data) = compound(block)?.get("nbt") {
            preview.moving_piston(position, data);
        }
    }
    Ok(preview)
}

fn legacy(root: &Nbt) -> Result<Preview> {
    let size = dimensions(root)?;
    let count = volume(size)?;
    let blocks = byte_array(field(root, "Blocks")?)?;
    let metadata = byte_array(field(root, "Data")?)?;
    let extra = compound(root)?
        .get("AddBlocks")
        .map(byte_array)
        .transpose()?;
    if blocks.len() != count
        || metadata.len() != count
        || extra.is_some_and(|data| data.len() != count.div_ceil(2))
    {
        return Err("旧版投影的方块数组与尺寸不符".into());
    }
    let mut preview = Preview::new([0; 3], size);
    preview.add_entities(compound(root)?.get("Entities"), [0; 3], false);
    let mut palette = vec![None; 1 << 16];
    let layer = size[0] * size[2];
    let block_at = |index: usize| {
        let upper = extra.map_or(0, |data| (data[index / 2] as u8 >> ((index % 2) * 4)) & 0xf);
        u16::from(blocks[index] as u8) | (u16::from(upper) << 8)
    };
    for index in 0..blocks.len() {
        let block = block_at(index);
        if block == 0 {
            continue;
        }
        let variant = metadata[index] as u8 & 0xf;
        if let Some(door) = legacy_door(block) {
            let upper = variant & 8 != 0;
            let mate = if upper {
                index.checked_sub(layer)
            } else {
                index.checked_add(layer)
            };
            let paired = mate
                .filter(|&i| i < blocks.len() && block_at(i) == block)
                .map(|i| metadata[i] as u8 & 0xf)
                .filter(|other| (other & 8 != 0) != upper);
            let (bottom, top) = if upper {
                (paired.unwrap_or(0), variant)
            } else {
                (variant, paired.unwrap_or(8))
            };
            let direction = ["east", "south", "west", "north"][(bottom & 3) as usize];
            let half = if upper { "upper" } else { "lower" };
            let hinge = if top & 1 != 0 { "right" } else { "left" };
            let state = format!(
                "{door}[facing={direction},half={half},hinge={hinge},open={},powered={}]",
                bottom & 4 != 0,
                top & 2 != 0
            );
            let id = preview.material(&state)?;
            preview.place_index(index, size, [0; 3], id);
            continue;
        }
        let key = usize::from(block | (u16::from(variant) << 12));
        let material = match palette[key] {
            Some(material) => material,
            None => {
                let id = preview.material(&legacy_name(block, variant))?;
                palette[key] = Some(id);
                id
            }
        };
        preview.place_index(index, size, [0; 3], material);
    }
    preview.block_entities(compound(root)?.get("TileEntities"), [0; 3]);
    Ok(preview)
}

fn legacy_door(block: u16) -> Option<&'static str> {
    Some(match block {
        64 => "oak_door",
        71 => "iron_door",
        193 => "spruce_door",
        194 => "birch_door",
        195 => "jungle_door",
        196 => "acacia_door",
        197 => "dark_oak_door",
        _ => return None,
    })
}

fn legacy_name(block: u16, variant: u8) -> String {
    const COLORS: [&str; 16] = [
        "white",
        "orange",
        "magenta",
        "light_blue",
        "yellow",
        "lime",
        "pink",
        "gray",
        "light_gray",
        "cyan",
        "purple",
        "blue",
        "brown",
        "green",
        "red",
        "black",
    ];
    const WOOD: [&str; 6] = ["oak", "spruce", "birch", "jungle", "acacia", "dark_oak"];
    let horizontal = match variant & 7 {
        2 => "north",
        3 => "south",
        4 => "west",
        5 => "east",
        _ => "north",
    };
    let stairs = match block {
        53 => "oak",
        67 => "cobblestone",
        108 => "brick",
        109 => "stone_brick",
        114 => "nether_brick",
        128 => "sandstone",
        134 => "spruce",
        135 => "birch",
        136 => "jungle",
        156 => "quartz",
        163 => "acacia",
        164 => "dark_oak",
        180 => "red_sandstone",
        203 => "purpur",
        _ => "",
    };
    if !stairs.is_empty() {
        let facing = ["east", "west", "south", "north"][(variant & 3) as usize];
        let half = if variant & 4 == 0 { "bottom" } else { "top" };
        return format!(
            "{stairs}_stairs[facing={facing},half={half},shape=straight,waterlogged=false]"
        );
    }
    let name = match block {
        1 => match variant {
            1 | 2 => "granite",
            3 | 4 => "diorite",
            5 | 6 => "andesite",
            _ => "stone",
        },
        2 => "grass_block",
        3 => "dirt",
        4 => "cobblestone",
        5 => return format!("{}_planks", WOOD.get(variant as usize).unwrap_or(&"oak")),
        7 => "bedrock",
        8 | 9 => return format!("water[level={variant}]"),
        10 | 11 => return format!("lava[level={variant}]"),
        12 => "sand",
        13 => "gravel",
        14 => "gold_ore",
        15 => "iron_ore",
        16 => "coal_ore",
        17 | 162 => {
            let species = if block == 17 {
                (variant & 3) as usize
            } else {
                4 + (variant & 1) as usize
            };
            let (kind, axis) = match variant & 12 {
                4 => ("log", "x"),
                8 => ("log", "z"),
                12 => ("wood", "y"),
                _ => ("log", "y"),
            };
            return format!("{}_{kind}[axis={axis}]", WOOD[species]);
        }
        18 | 161 => "oak_leaves",
        19 => "sponge",
        20 => "glass",
        22 => "lapis_block",
        24 => "sandstone",
        23 | 158 | 218 => {
            let facing = ["down", "up", "north", "south", "west", "east"]
                .get((variant & 7) as usize)
                .unwrap_or(&"north");
            let powered = variant & 8 != 0;
            return match block {
                218 => format!("observer[facing={facing},powered={powered}]"),
                158 => format!("dropper[facing={facing},triggered={powered}]"),
                _ => format!("dispenser[facing={facing},triggered={powered}]"),
            };
        }
        31 if variant == 2 => "fern",
        31 => "short_grass",
        35 | 95 | 159 | 160 | 171 | 251 | 252 => {
            let suffix = match block {
                35 | 171 => "wool",
                95 | 160 => "stained_glass",
                159 => "terracotta",
                _ => "concrete",
            };
            return format!("{}_{suffix}", COLORS[variant as usize]);
        }
        41 => "gold_block",
        37 => "dandelion",
        38 => [
            "poppy",
            "blue_orchid",
            "allium",
            "azure_bluet",
            "red_tulip",
            "orange_tulip",
            "white_tulip",
            "pink_tulip",
            "oxeye_daisy",
        ]
        .get(variant as usize)
        .copied()
        .unwrap_or("poppy"),
        39 => "brown_mushroom",
        40 => "red_mushroom",
        42 => "iron_block",
        43 | 44 | 98 => "stone_bricks",
        45 => "bricks",
        47 => "bookshelf",
        48 => "mossy_cobblestone",
        49 => "obsidian",
        50 | 75 | 76 => {
            let stem = if block == 50 { "" } else { "redstone_" };
            let lit = if block == 50 {
                ""
            } else if block == 75 {
                ",lit=false"
            } else {
                ",lit=true"
            };
            if let Some(facing) =
                ["east", "west", "south", "north"].get(variant.wrapping_sub(1) as usize)
            {
                return format!("{stem}wall_torch[facing={facing}{lit}]");
            }
            return if block == 50 {
                "torch".into()
            } else {
                format!("redstone_torch[lit={}]", block == 76)
            };
        }
        54 | 130 | 146 => {
            let chest = match block {
                130 => "ender_chest",
                146 => "trapped_chest",
                _ => "chest",
            };
            return format!("{chest}[facing={horizontal},type=single,waterlogged=false]");
        }
        57 => "diamond_block",
        59 => return format!("wheat[age={}]", variant.min(7)),
        60 => return format!("farmland[moisture={}]", variant.min(7)),
        61 | 62 => return format!("furnace[facing={horizontal},lit={}]", block == 62),
        78 | 80 => "snow_block",
        79 | 174 => "ice",
        82 => "clay",
        83 => "sugar_cane",
        85 => "oak_fence",
        87 => "netherrack",
        88 => "soul_sand",
        89 => "glowstone",
        101 => "iron_bars",
        102 => "glass_pane",
        112 => "nether_bricks",
        113 => "nether_brick_fence",
        115 => return format!("nether_wart[age={}]", variant.min(3)),
        121 => "end_stone",
        133 => "emerald_block",
        139 if variant == 1 => "mossy_cobblestone_wall",
        139 => "cobblestone_wall",
        141 => return format!("carrots[age={}]", variant.min(7)),
        142 => return format!("potatoes[age={}]", variant.min(7)),
        152 => "redstone_block",
        154 => {
            let facing = if variant & 7 == 0 { "down" } else { horizontal };
            let enabled = variant & 8 == 0;
            return format!("hopper[facing={facing},enabled={enabled}]");
        }
        155 => "quartz_block",
        168 => "prismarine",
        170 => "hay_block",
        172 => "terracotta",
        179 => "red_sandstone",
        201 => "purpur_block",
        206 => "end_stone_bricks",
        207 => return format!("beetroots[age={}]", variant.min(3)),
        _ => return format!("legacy_{block}"),
    };
    name.into()
}

fn decode(root: &Nbt) -> Result<Value> {
    let root = compound(root)?.get("Schematic").unwrap_or(root);
    let data = compound(root)?;
    let preview = if let Some(regions) = data.get("Regions") {
        litematic(regions)
    } else if let Some(Nbt::Compound(blocks)) = data.get("Blocks") {
        sponge(
            root,
            blocks.get("Palette").ok_or("Sponge 投影缺少调色板")?,
            blocks.get("Data").ok_or("Sponge 投影缺少方块数组")?,
        )
    } else if let (Some(palette), Some(blocks)) = (data.get("Palette"), data.get("BlockData")) {
        sponge(root, palette, blocks)
    } else if matches!(data.get("Blocks"), Some(Nbt::ByteArray(_))) {
        legacy(root)
    } else if data.contains_key("size") && data.contains_key("blocks") {
        vanilla(root)
    } else if data.contains_key("Entities") && data.contains_key("Width") {
        let mut preview = Preview::new([0; 3], dimensions(root)?);
        preview.add_entities(data.get("Entities"), [0; 3], false);
        Ok(preview)
    } else {
        return Err("无法识别投影格式，请选择 Litematica、Sponge、MCEdit 或原版结构文件".into());
    }?;
    preview.finish()
}

mod entities;
mod nbt_limits;

#[cfg(test)]
mod tests;
