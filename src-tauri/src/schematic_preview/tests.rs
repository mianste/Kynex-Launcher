use super::*;
use fastnbt::{nbt, ByteArray, LongArray};

fn cells(model: &Value) -> Vec<u16> {
    STANDARD
        .decode(model["cells"].as_str().unwrap())
        .unwrap()
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .collect()
}

#[test]
fn places_litematica_regions_with_negative_sizes_and_cross_word_states() {
    let root = nbt!({
        "Regions": {
            "left": {
                "Position": {"x": 22, "y": 0, "z": 0},
                "Size": {"x": -22, "y": 1, "z": 1},
                "BlockStatePalette": [{"Name":"minecraft:air"}, {"Name":"minecraft:stone"},
                    {"Name":"minecraft:gold_block"}, {"Name":"minecraft:dirt"}, {"Name":"minecraft:glass"}],
                "BlockStates": Nbt::LongArray(LongArray::new(vec![2, 2])),
            },
            "right": {
                "Position": {"x": 25, "y": 0, "z": 0},
                "Size": {"x": 1, "y": 1, "z": 1},
                "BlockStatePalette": [{"Name":"minecraft:air"}, {"Name":"minecraft:stone"}],
                "BlockStates": Nbt::LongArray(LongArray::new(vec![1])),
            },
        },
    });
    let model = decode(&root).unwrap();
    assert_eq!(model["size"], json!([25, 1, 1]));
    let ids = cells(&model);
    assert_eq!(model["palette"][ids[0] as usize], "minecraft:gold_block");
    assert_eq!(model["palette"][ids[21] as usize], "minecraft:glass");
    assert_eq!(&ids[22..], &[0, 0, 1]);
}

#[test]
fn preserves_block_positions_in_long_thin_builds_and_discards_unused_states() {
    let mut preview = Preview::new([0; 3], [512, 12, 12]);
    preview.material("minecraft:glass").unwrap();
    let chest = preview.material("minecraft:chest").unwrap();
    let hopper = preview.material("minecraft:hopper").unwrap();
    preview.place([202, 0, 0], chest);
    preview.place([203, 0, 0], hopper);
    let model = preview.finish().unwrap();
    assert_eq!(model["step"], 1);
    assert_eq!(
        model["palette"],
        json!(["minecraft:air", "minecraft:chest", "minecraft:hopper"])
    );
    assert_eq!(&cells(&model)[202..204], &[1, 2]);
}

#[test]
fn reads_sponge_varints_in_both_layouts() {
    let palette = nbt!({"minecraft:air": 0, "minecraft:glass[north=true]":130});
    let data = Nbt::ByteArray(ByteArray::new(vec![0, -126, 1]));
    let v2 = nbt!({"Width":2i16, "Height":1i16, "Length":1i16,
        "Palette": (palette.clone()), "BlockData": (data.clone())});
    let v3 = nbt!({"Schematic":{"Width":2i16, "Height":1i16, "Length":1i16,
        "Blocks":{"Palette":palette, "Data":data}}});
    for root in [v2, v3] {
        let model = decode(&root).unwrap();
        assert_eq!(
            model["palette"],
            json!(["minecraft:air", "minecraft:glass[north=true]"])
        );
        assert_eq!(cells(&model), [0, 1]);
    }
}

#[test]
fn decodes_legacy_extended_ids_and_vanilla_structure_positions() {
    let legacy = nbt!({"Width":2i16, "Height":1i16, "Length":1i16,
        "Blocks": Nbt::ByteArray(ByteArray::new(vec![49, 1])),
        "Data": Nbt::ByteArray(ByteArray::new(vec![0, 0])),
        "AddBlocks": Nbt::ByteArray(ByteArray::new(vec![16]))
    });
    let model = decode(&legacy).unwrap();
    assert_eq!(
        model["palette"],
        json!(["minecraft:air", "obsidian", "legacy_257"])
    );
    assert_eq!(cells(&model), [1, 2]);
    let vanilla = nbt!({"size":[2, 2, 2], "palettes":[[{"Name":"minecraft:oak_planks"}]],
        "blocks":[{"pos":[1, 1, 1], "state":0}]});
    assert_eq!(cells(&decode(&vanilla).unwrap()), [0, 0, 0, 0, 0, 0, 0, 1]);
}

#[test]
fn bounds_malformed_nbt_before_deserializing() {
    let mut nested = vec![10, 0, 0];
    nested.extend([10, 0, 0].repeat(65));
    nested.extend([0; 66]);
    assert!(nbt_limits::check(&nested).is_err());
    assert!(nbt_limits::check(&[10, 0, 0, 7, 0, 0, 127, 255, 255, 255]).is_err());
}

#[test]
fn reads_entities_and_uses_the_region_position_for_negative_sizes() {
    let source = nbt!({"Regions":{"region":{
        "Position":{"x":14,"y":2,"z":6}, "Size":{"x":-5,"y":1,"z":2},
        "BlockStatePalette":[{"Name":"minecraft:air"}], "BlockStates":Nbt::LongArray(LongArray::new(vec![0])),
        "Entities":[{"id":"minecraft:cow","Pos":[-3.5f64,0.0,1.5],"Rotation":[-90.0f32,15.0],"Age":-1}]
    }}});
    let result = decode(&source).unwrap();
    let entity = &result["entities"][0];
    assert_eq!(entity["id"], "minecraft:cow");
    assert_eq!(entity["position"], json!([0.5, 0.0, 1.5]));
    assert_eq!(entity["yaw"], 270.0);
    assert_eq!(entity["pitch"], 15.0);
    assert_eq!(entity["baby"], true);
    let vanilla = nbt!({"size":[2,2,2],"palette":[{"Name":"minecraft:air"}],"blocks":[],
        "entities":[{"pos":[1.5f64,0.0,0.5],"nbt":{"id":"minecraft:pig","Pos":[400.0f64,100.0,900.0]}}]});
    assert_eq!(
        decode(&vanilla).unwrap()["entities"][0]["position"],
        json!([1.5, 0.0, 0.5])
    );
    let sponge = nbt!({"Schematic":{"Version":3,"Width":4i16,"Height":3i16,"Length":2i16,
        "Offset": [10, 100, -20],
        "Entities":[{"Id":"minecraft:sheep","Pos":[2.5f64,1.0,1.5],"Data":{"Color":14i8}}]}});
    let result = decode(&sponge).unwrap();
    assert_eq!(result["entities"][0]["position"], json!([2.5, 1.0, 1.5]));
    assert_eq!(result["entities"][0]["color"], 14.0);
}

#[test]
fn restores_direction_and_growing_plants_in_numeric_schematics() {
    let source = nbt!({"Width":3i16,"Height":2i16,"Length":1i16,
        "Blocks":Nbt::ByteArray(ByteArray::new(vec![64,17,115,64,0,0])),
        "Data": Nbt::ByteArray(ByteArray::new(vec![6,4,3,9,0,0]))});
    let result = decode(&source).unwrap();
    let ids = cells(&result);
    for (offset, expected) in [
        (
            0,
            "oak_door[facing=west,half=lower,hinge=right,open=true,powered=false]",
        ),
        (1, "oak_log[axis=x]"),
        (2, "nether_wart[age=3]"),
        (
            3,
            "oak_door[facing=west,half=upper,hinge=right,open=true,powered=false]",
        ),
    ] {
        assert_eq!(result["palette"][ids[offset] as usize], expected);
    }
}

#[test]
fn previews_the_saved_block_carried_by_a_piston_at_its_saved_offset() {
    let source = nbt!({"size":[3,1,1],"palette":[{"Name":"minecraft:moving_piston"}],
        "blocks":[{"pos":[1,0,0],"state":0,"nbt":{"id":"minecraft:piston","facing":5,"progress":0.5f32,"extending":1i8,
            "blockState":{"Name":"minecraft:oak_log","Properties":{"axis":"x"}}}}]});
    let result = decode(&source).unwrap();
    assert_eq!(
        result["palette"],
        json!(["minecraft:air", "minecraft:oak_log[axis=x]"])
    );
    assert_eq!(cells(&result), [0, 1, 0]);
    assert_eq!(result["movingBlocks"]["1"][0], -0.5);
}
