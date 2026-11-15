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
    let cells = cells(&model);
    assert_eq!(cells[0], 2);
    assert_eq!(cells[21], 4);
    assert_eq!(&cells[22..], &[0, 0, 1]);
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
