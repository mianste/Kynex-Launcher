use super::Properties;
use serde_json::{json, Value};

// These blocks use the Java client's entity textures instead of block-model geometry.
pub(super) struct SpecialModel {
    pub texture: String,
    pub elements: Vec<Value>,
    pub x: i32,
    pub y: f32,
}

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

fn north_rotation(facing: &str) -> i32 {
    match facing {
        "east" => 90,
        "south" => 180,
        "west" => 270,
        _ => 0,
    }
}

fn cuboid(
    texture: &str,
    from: [f32; 3],
    to: [f32; 3],
    [u, v]: [f32; 2],
    [w, h, d]: [f32; 3],
    sheet_height: f32,
    seam: Option<&str>,
) -> Value {
    let faces = [
        ("up", [u + d + w, v, u + d, v + d]),
        ("down", [u + d + w + w, v + d, u + d + w, v]),
        ("north", [u + d, v + d, u + d + w, v + d + h]),
        ("south", [u + d + w + d, v + d, u + d + w + d + w, v + d + h]),
        ("west", [u + d + w, v + d, u + d + w + d, v + d + h]),
        ("east", [u, v + d, u + d, v + d + h]),
    ]
    .into_iter()
    .filter(|(face, _)| Some(*face) != seam)
    .map(|(face, [u0, v0, u1, v1])| {
        (face.to_owned(), json!({"texture": texture, "uv":[u0 / 4., v0 * 16. / sheet_height, u1 / 4., v1 * 16. / sheet_height]}))
    })
    .collect::<serde_json::Map<_, _>>();
    json!({"from":from,"to":to,"faces":faces})
}

fn chest(kind: &str, half: &str, facing: &str) -> SpecialModel {
    let (min, max, latch, seam, suffix) = match half {
        "left" if kind != "ender" => (1., 16., [15., 16.], Some("east"), "_left"),
        "right" if kind != "ender" => (0., 15., [0., 1.], Some("west"), "_right"),
        _ => (1., 15., [7., 9.], None, ""),
    };
    let texture = format!("minecraft:entity/chest/{kind}{suffix}");
    let width = max - min;
    let elements = vec![
        cuboid(
            &texture,
            [min, 0., 1.],
            [max, 10., 15.],
            [0., 19.],
            [width, 10., 14.],
            64.,
            seam,
        ),
        cuboid(
            &texture,
            [min, 10., 1.],
            [max, 14., 15.],
            [0., 0.],
            [width, 5., 14.],
            64.,
            seam,
        ),
        cuboid(
            &texture,
            [latch[0], 7., 0.],
            [latch[1], 11., 1.],
            [0., 0.],
            [latch[1] - latch[0], 4., 1.],
            64.,
            None,
        ),
    ];
    SpecialModel {
        texture,
        elements,
        x: 0,
        y: north_rotation(facing) as f32,
    }
}

fn bed(color: &str, head: bool, facing: &str) -> SpecialModel {
    let texture = format!("minecraft:entity/bed/{color}");
    let v = if head { 0. } else { 22. };
    let end = if head { "north" } else { "south" };
    let face = |uv: [f32; 4], rotation| json!({"texture":texture,"uv":uv.map(|n| n / 4.),"rotation":rotation});
    let mut faces = json!({
        "up": face([6., v + 6., 22., v + 22.], 180),
        "down": face([28., v + 6., 44., v + 22.], 0),
        "east": face([0., v + 6., 6., v + 22.], 90),
        "west": face([22., v + 6., 28., v + 22.], 270),
    });
    faces[end] = face([6., v, 22., v + 6.], 0);
    let z = if head { 0. } else { 13. };
    let leg_v = if head { 0. } else { 12. };
    let elements = vec![
        json!({"from":[0,3,0],"to":[16,9,16],"faces":faces}),
        cuboid(
            &texture,
            [0., 0., z],
            [3., 3., z + 3.],
            [50., leg_v],
            [3.; 3],
            64.,
            None,
        ),
        cuboid(
            &texture,
            [13., 0., z],
            [16., 3., z + 3.],
            [50., leg_v + 6.],
            [3.; 3],
            64.,
            None,
        ),
    ];
    SpecialModel {
        texture,
        elements,
        x: 0,
        y: north_rotation(facing) as f32,
    }
}

fn shulker(color: &str, facing: &str) -> SpecialModel {
    let texture = if color.is_empty() {
        "minecraft:entity/shulker/shulker".to_owned()
    } else {
        format!("minecraft:entity/shulker/shulker_{color}")
    };
    let elements = vec![
        cuboid(
            &texture,
            [0.01, 0., 0.01],
            [15.99, 8., 15.99],
            [0., 28.],
            [16., 8., 16.],
            64.,
            None,
        ),
        cuboid(
            &texture,
            [0., 4., 0.],
            [16., 16., 16.],
            [0., 0.],
            [16., 12., 16.],
            64.,
            None,
        ),
    ];
    let (x, y) = match facing {
        "up" => (0, 0),
        "down" => (180, 0),
        _ => (90, north_rotation(facing)),
    };
    SpecialModel {
        texture,
        elements,
        x,
        y: y as f32,
    }
}

fn sign(wood: &str, style: &str, facing: &str, rotation: i32) -> SpecialModel {
    let hanging = matches!(style, "_hanging_sign" | "_wall_hanging_sign");
    let wall = matches!(style, "_wall_sign" | "_wall_hanging_sign");
    let directory = if hanging { "signs/hanging" } else { "signs" };
    let texture = format!("minecraft:entity/{directory}/{wood}");
    let z = if style == "_wall_sign" { 14. } else { 7. };
    let bottom = if style == "_sign" { 10. } else { 4. };
    let mut elements = vec![cuboid(
        &texture,
        [0., bottom, z],
        [16., bottom + 8., z + 1.5],
        [0., if hanging { 12. } else { 0. }],
        [24., 12., 2.],
        32.,
        None,
    )];
    if style == "_sign" {
        elements.push(cuboid(
            &texture,
            [7., 0., 7.],
            [9., 10., 9.],
            [0., 14.],
            [2., 14., 2.],
            32.,
            None,
        ));
    }
    if hanging {
        for x in [3., 12.] {
            elements.push(cuboid(
                &texture,
                [x, 12., 7.5],
                [x + 1., 16., 8.5],
                [59., 0.],
                [1., 4., 1.],
                32.,
                None,
            ));
        }
    }
    let y = if wall {
        north_rotation(facing) as f32
    } else {
        (rotation as f32 * 22.5 + 180.) % 360.
    };
    SpecialModel {
        texture,
        elements,
        x: 0,
        y,
    }
}

pub(super) fn resolve(name: &str, properties: &Properties<'_>) -> Option<SpecialModel> {
    let block = name.strip_prefix("minecraft:")?;
    let facing = properties.get("facing").copied().unwrap_or("north");
    let half = properties.get("type").copied().unwrap_or("single");
    let kind = match block.strip_prefix("waxed_").unwrap_or(block) {
        "chest" => "normal",
        "trapped_chest" => "trapped",
        "ender_chest" => "ender",
        "copper_chest" => "copper",
        "exposed_copper_chest" => "copper_exposed",
        "weathered_copper_chest" => "copper_weathered",
        "oxidized_copper_chest" => "copper_oxidized",
        _ => "",
    };
    if !kind.is_empty() {
        return Some(chest(kind, half, facing));
    }
    if let Some(color) = block
        .strip_suffix("_bed")
        .filter(|color| COLORS.contains(color))
    {
        return Some(bed(color, properties.get("part") == Some(&"head"), facing));
    }
    if block == "shulker_box" {
        return Some(shulker(
            "",
            properties.get("facing").copied().unwrap_or("up"),
        ));
    }
    if let Some(color) = block
        .strip_suffix("_shulker_box")
        .filter(|color| COLORS.contains(color))
    {
        return Some(shulker(
            color,
            properties.get("facing").copied().unwrap_or("up"),
        ));
    }
    let rotation = properties
        .get("rotation")
        .and_then(|value| value.parse::<i32>().ok())
        .filter(|value| (0..16).contains(value))
        .unwrap_or(0);
    ["_wall_hanging_sign", "_hanging_sign", "_wall_sign", "_sign"]
        .into_iter()
        .find_map(|style| {
            block
                .strip_suffix(style)
                .map(|wood| sign(wood, style, facing, rotation))
        })
}
