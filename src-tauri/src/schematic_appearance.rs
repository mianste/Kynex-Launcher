use crate::{engine, err, read_json, safe_name, Core, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::cmp::Reverse;
use std::collections::{BTreeMap, BTreeSet};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use zip::ZipArchive;

mod defaults;
mod entities;
mod special;

const DEFAULT_VERSION: &str = "1.21.11";
const DEFAULT_HASH: &str = "ba2df812c2d12e0219c489c4cd9a5e1f0760f5bd";
const DEFAULT_URL: &str =
    "https://piston-data.mojang.com/v1/objects/ba2df812c2d12e0219c489c4cd9a5e1f0760f5bd/client.jar";
const MAX_STATES: usize = 8192;
const MAX_ASSET: usize = 256 * 1024;
const MAX_TEXTURE_BYTES: usize = 8 * 1024 * 1024;

pub(crate) async fn load(core: &Core, payload: &Value) -> Result<Value> {
    let palette = payload["palette"].as_array().ok_or("缺少投影方块列表")?;
    if palette.len() > MAX_STATES
        || palette
            .iter()
            .any(|name| name.as_str().is_none_or(|name| name.len() > 512))
    {
        return Err("此投影的方块状态太多，无法加载原版纹理".into());
    }
    let id = payload["id"].as_str().unwrap_or("");
    let client = installed_client(core, id);
    let download_core = Core {
        cancel: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        progress: std::sync::Arc::new(|_| {}),
        download_source: std::sync::Arc::new(std::sync::RwLock::new("official".into())),
        ..core.clone()
    };
    let palette = palette.clone();
    let figures: Vec<_> = payload["entities"]
        .as_array()
        .into_iter()
        .flatten()
        .take(2048)
        .cloned()
        .collect();
    if let Some((version, jar)) = client {
        let names = palette.clone();
        let models = entities::load_archive(&download_core, &version, &names, &figures).await;
        let figures = figures.clone();
        if let Ok(Ok(appearance)) = tokio::task::spawn_blocking(move || {
            appearance(&jar, &version, &names, models, &figures)
        })
        .await
        {
            if appearance["textures"]
                .as_object()
                .is_some_and(|textures| !textures.is_empty())
                || appearance["entityTextures"]
                    .as_object()
                    .is_some_and(|textures| !textures.is_empty())
            {
                return Ok(appearance);
            }
        }
    }
    let jar = core.data_root.join(format!(
        "cache/schematic-appearance/{DEFAULT_VERSION}/client.jar"
    ));
    engine::download(&download_core, DEFAULT_URL, &jar, DEFAULT_HASH).await?;
    let models = entities::load_archive(&download_core, DEFAULT_VERSION, &palette, &figures).await;
    tokio::task::spawn_blocking(move || {
        appearance(&jar, DEFAULT_VERSION, &palette, models, &figures)
    })
    .await
    .map_err(err)?
}

fn installed_client(core: &Core, id: &str) -> Option<(String, PathBuf)> {
    let instance = core.instance(id).ok()?;
    let config = read_json(&instance.join("kxl.json")).ok()?;
    let version = safe_name(config["version"].as_str()?).ok()?.to_owned();
    let root = core.root.canonicalize().ok()?;
    let vanilla = core
        .root
        .join("versions")
        .join(&version)
        .join(format!("{version}.jar"));
    let external = config["externalClient"].as_str().map(PathBuf::from);
    let cached = read_json(&instance.join("version.json"))
        .ok()
        .and_then(|version| {
            let hash = version["downloads"]["client"]["sha1"].as_str()?;
            (hash.len() == 40 && hash.bytes().all(|byte| byte.is_ascii_hexdigit())).then(|| {
                core.root
                    .join("cache/game-clients")
                    .join(hash)
                    .join("client.jar")
            })
        });
    let local = [
        Some(instance.join("client.jar")),
        external,
        Some(vanilla),
        cached,
    ]
    .into_iter()
    .flatten()
    .filter_map(|path| path.canonicalize().ok())
    .find(|path| path.starts_with(&root) && path.is_file())?;
    Some((version, local))
}

fn resource(id: &str) -> Option<String> {
    let (namespace, path) = id.split_once(':').unwrap_or(("minecraft", id));
    let simple = |value: &str| {
        !value.is_empty()
            && value.bytes().all(|byte| {
                byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"_.-".contains(&byte)
            })
    };
    (simple(namespace)
        && path
            .split('/')
            .all(|segment| simple(segment) && segment != "." && segment != ".."))
    .then(|| format!("{namespace}:{path}"))
}

fn asset_path(id: &str, folder: &str, extension: &str) -> Option<String> {
    let (namespace, path) = id.split_once(':')?;
    Some(format!("assets/{namespace}/{folder}/{path}.{extension}"))
}

fn bytes(archive: &mut ZipArchive<File>, path: &str) -> Option<Vec<u8>> {
    let entry = archive.by_name(path).ok()?;
    if entry.size() > MAX_ASSET as u64 {
        return None;
    }
    let mut content = Vec::new();
    entry
        .take((MAX_ASSET + 1) as u64)
        .read_to_end(&mut content)
        .ok()?;
    (content.len() <= MAX_ASSET).then_some(content)
}

fn document(archive: &mut ZipArchive<File>, id: &str, folder: &str) -> Option<Value> {
    serde_json::from_slice(&bytes(archive, &asset_path(id, folder, "json")?)?).ok()
}

type Properties<'a> = BTreeMap<&'a str, &'a str>;

fn matches_condition(condition: &Value, properties: &Properties<'_>) -> bool {
    condition.as_object().is_some_and(|rules| {
        rules.iter().all(|(key, value)| match key.as_str() {
            "OR" => value
                .as_array()
                .is_some_and(|items| items.iter().any(|rule| matches_condition(rule, properties))),
            "AND" => value
                .as_array()
                .is_some_and(|items| items.iter().all(|rule| matches_condition(rule, properties))),
            _ => properties
                .get(key.as_str())
                .zip(value.as_str())
                .is_some_and(|(actual, choices)| {
                    let positive = choices.strip_prefix('!');
                    positive.is_none()
                        == positive
                            .unwrap_or(choices)
                            .split('|')
                            .any(|choice| *actual == choice)
                }),
        })
    })
}

fn selected_models<'a>(block: &'a Value, properties: &Properties<'_>) -> Vec<&'a Value> {
    let first = |item: &'a Value| {
        item.as_array()
            .and_then(|choices| choices.first())
            .unwrap_or(item)
    };
    if let Some(variants) = block["variants"].as_object() {
        let variant = variants
            .iter()
            .filter_map(|(key, value)| {
                let mut matching = 0;
                let mut missing = 0;
                for (key, choices) in key.split(',').filter_map(|pair| pair.split_once('=')) {
                    match properties.get(key) {
                        Some(actual) if choices.split('|').any(|choice| *actual == choice) => {
                            matching += 1
                        }
                        Some(_) => return None,
                        None => missing += 1,
                    }
                }
                Some(((matching, Reverse(missing)), value))
            })
            .max_by_key(|(count, _)| *count)
            .map(|(_, value)| value);
        return variant.map(first).into_iter().collect();
    }
    block["multipart"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|part| part["when"].is_null() || matches_condition(&part["when"], properties))
        .map(|part| first(&part["apply"]))
        .collect()
}

#[derive(Default)]
struct InheritedModel {
    elements: Vec<Value>,
    textures: BTreeMap<String, Value>,
}

fn inherited(archive: &mut ZipArchive<File>, id: &str, depth: usize) -> Option<InheritedModel> {
    if depth >= 16 {
        return None;
    }
    let document = document(archive, id, "models")?;
    let mut result = document["parent"]
        .as_str()
        .and_then(resource)
        .and_then(|parent| inherited(archive, &parent, depth + 1))
        .unwrap_or_default();
    if let Some(elements) = document["elements"].as_array() {
        result.elements = elements.iter().take(64).cloned().collect();
    }
    if let Some(textures) = document["textures"].as_object() {
        result.textures.extend(textures.clone());
    }
    Some(result)
}

fn texture_reference<'a>(
    mut value: &'a Value,
    textures: &'a BTreeMap<String, Value>,
) -> Option<(String, bool)> {
    let mut translucent = false;
    for _ in 0..16 {
        // Newer clients can describe a sprite and its render flags together.
        translucent |= value["force_translucent"].as_bool().unwrap_or(false);
        let sprite = value.as_str().or_else(|| value["sprite"].as_str())?;
        match sprite.strip_prefix('#') {
            Some(key) => value = textures.get(key)?,
            None => return Some((resource(sprite)?, translucent)),
        }
    }
    None
}

fn model(
    archive: &mut ZipArchive<File>,
    id: &str,
    textures: &mut BTreeSet<String>,
) -> Option<Vec<Value>> {
    let mut model = inherited(archive, id, 0)?;
    for element in &mut model.elements {
        if let Some(faces) = element["faces"].as_object_mut() {
            for face in faces.values_mut() {
                let (texture, translucent) =
                    texture_reference(&face["texture"], &model.textures).unwrap_or_default();
                if !texture.is_empty() {
                    textures.insert(texture.clone());
                }
                face["texture"] = Value::String(texture);
                if translucent {
                    face["force_translucent"] = json!(true);
                }
            }
        }
    }
    model.elements.retain(|element| {
        element["faces"]
            .as_object()
            .is_some_and(|faces| !faces.is_empty())
    });
    (!model.elements.is_empty()).then_some(model.elements)
}

fn cube_model(texture: &str, height: f32, tint: bool) -> Vec<Value> {
    let faces: BTreeMap<_, _> = ["up", "down", "north", "south", "east", "west"]
        .into_iter()
        .map(|face| {
            let mut data = json!({"texture":texture,"cullface":face});
            if tint {
                data["tintindex"] = json!(0);
            }
            (face, data)
        })
        .collect();
    vec![json!({"from":[0,0,0],"to":[16,height,16],"faces":faces})]
}

fn appearance(
    jar: &Path,
    version: &str,
    palette: &[Value],
    models_path: Option<entities::ModelArchive>,
    figures: &[Value],
) -> Result<Value> {
    let mut archive = ZipArchive::new(File::open(jar).map_err(err)?).map_err(err)?;
    let mut states = Vec::with_capacity(palette.len());
    let mut blocks = BTreeMap::new();
    let mut models = BTreeMap::<String, Vec<Value>>::new();
    let mut missing = BTreeSet::new();
    let mut textures = BTreeSet::new();
    let block_defaults = defaults::BlockDefaults::for_client(version);
    for state in palette {
        let state = state.as_str().unwrap_or_default().trim_end_matches(']');
        let (name, raw) = state.split_once('[').unwrap_or((state, ""));
        let Some(id) = resource(name) else {
            states.push(vec![]);
            continue;
        };
        if id == "minecraft:air" {
            states.push(vec![]);
            continue;
        }
        let mut properties: Properties<'_> = raw
            .split(',')
            .filter_map(|pair| pair.split_once('='))
            .collect();
        if let Some(block_defaults) = &block_defaults {
            block_defaults.fill(&id, &mut properties);
        }
        let block = blocks.entry(id.clone()).or_insert_with(|| {
            document(&mut archive, &id, "blockstates")
                .or_else(|| {
                    let alias = match id.as_str() {
                        "minecraft:chain" => "minecraft:iron_chain",
                        "minecraft:iron_chain" => "minecraft:chain",
                        "minecraft:short_grass" => "minecraft:grass",
                        "minecraft:grass" => "minecraft:short_grass",
                        _ => return None,
                    };
                    document(&mut archive, alias, "blockstates")
                })
                .unwrap_or_default()
        });
        // A bare vanilla pillar uses its vertical default, independent of the order of the variants.
        if id.starts_with("minecraft:") && block["variants"].get("axis=y").is_some() {
            properties.entry("axis").or_insert("y");
        }
        let mut parts = Vec::new();
        for selected in selected_models(block, &properties).into_iter().take(24) {
            let Some(key) = selected["model"].as_str().and_then(resource) else {
                continue;
            };
            if !models.contains_key(&key) && !missing.contains(&key) {
                match model(&mut archive, &key, &mut textures) {
                    Some(elements) => {
                        models.insert(key.clone(), elements);
                    }
                    None => {
                        missing.insert(key.clone());
                    }
                }
            }
            if models.contains_key(&key) {
                parts.push(json!({"model":key,"x":selected["x"],"y":selected["y"],"uvlock":selected["uvlock"]}));
            }
        }
        if parts.is_empty() {
            if matches!(
                id.as_str(),
                "minecraft:end_portal" | "minecraft:end_gateway"
            ) {
                let texture = "minecraft:entity/end_portal/end_portal";
                let key = format!("portal:{id}");
                let mut elements = cube_model(
                    texture,
                    if id == "minecraft:end_portal" {
                        12.
                    } else {
                        16.
                    },
                    false,
                );
                if id == "minecraft:end_portal" {
                    elements[0]["from"] = json!([0, 6, 0]);
                }
                models.insert(key.clone(), elements);
                textures.insert(texture.into());
                states.push(vec![json!({"model":key})]);
                continue;
            }
            if let Some(special) = special::resolve(&id, &properties) {
                let key = format!("entity:{state}");
                textures.insert(special.texture);
                models.insert(key.clone(), special.elements);
                states.push(vec![json!({"model": key, "x": special.x, "y": special.y})]);
                continue;
            }
            let texture_id = if id == "minecraft:bubble_column" {
                "minecraft:water"
            } else {
                &id
            };
            let (namespace, block) = texture_id.split_once(':').unwrap_or_default();
            let fluid = matches!(texture_id, "minecraft:water" | "minecraft:lava");
            let texture = format!(
                "{namespace}:block/{block}{}",
                if fluid { "_still" } else { "" }
            );
            let texture_available = asset_path(&texture, "textures", "png")
                .is_some_and(|path| archive.index_for_name(&path).is_some());
            if texture_available {
                let key = format!("cube:{state}");
                let height = if fluid {
                    let level = properties
                        .get("level")
                        .and_then(|level| level.parse::<u8>().ok())
                        .unwrap_or(0);
                    16.0 - f32::from(level % 8 + 1) * (16.0 / 9.0)
                } else {
                    16.0
                };
                models.insert(
                    key.clone(),
                    cube_model(&texture, height, texture_id == "minecraft:water"),
                );
                textures.insert(texture);
                parts.push(json!({"model":key}));
            }
        }
        states.push(parts);
    }
    let mut total = 0;
    let textures: BTreeMap<_, _> = textures
        .into_iter()
        .filter_map(|id| {
            let content = bytes(&mut archive, &asset_path(&id, "textures", "png")?)?;
            if total + content.len() > MAX_TEXTURE_BYTES {
                return None;
            }
            total += content.len();
            Some((id, STANDARD.encode(content)))
        })
        .collect();
    let mut result = json!({"version":version,"states":states,"models":models,"textures":textures});
    if let Some(mut figures_reader) = models_path.and_then(entities::Models::open) {
        figures_reader.add_appearances(
            &mut archive,
            &mut result,
            palette,
            figures,
            block_defaults.as_ref(),
        );
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn resolves_old_and_new_texture_references_with_transparency() {
        let textures = BTreeMap::from([
            (
                "all".into(),
                json!({"sprite":"#glass","force_translucent":true}),
            ),
            ("glass".into(), json!({"sprite":"block/glass"})),
            ("stone".into(), json!("minecraft:block/stone")),
        ]);
        assert_eq!(
            texture_reference(&json!("#all"), &textures),
            Some(("minecraft:block/glass".into(), true))
        );
        assert_eq!(
            texture_reference(&json!("#stone"), &textures),
            Some(("minecraft:block/stone".into(), false))
        );
    }

    #[test]
    fn selects_exact_variant_and_matching_multipart_conditions() {
        let variants = json!({"variants":{
            "half=bottom,facing=east":{"model":"bottom_east"},
            "half=top,facing=east":{"model":"top_east"},
            "half=top,facing=west":{"model":"top_west"}
        }});
        let properties = BTreeMap::from([
            ("facing", "east"),
            ("half", "top"),
            ("waterlogged", "false"),
        ]);
        assert_eq!(
            selected_models(&variants, &properties)[0]["model"],
            "top_east"
        );
        let directions = json!({"variants":{
            "facing=east,half=bottom":{"model":"east"},
            "facing=west,half=bottom":{"model":"west"}
        }});
        assert_eq!(
            selected_models(&directions, &BTreeMap::from([("facing", "west")]))[0]["model"],
            "west"
        );
        assert!(selected_models(&directions, &BTreeMap::from([("facing", "south")])).is_empty());
        let multipart = json!({"multipart":[
            {"apply":{"model":"base"}},
            {"when":{"OR":[{"facing":"east|north"}, {"facing":"west"}]},"apply":{"model":"extra"}},
            {"when":{"half":"!top"},"apply":{"model":"bottom_only"}}
        ]});
        assert_eq!(
            selected_models(&multipart, &properties)
                .into_iter()
                .map(|part| part["model"].as_str().unwrap())
                .collect::<Vec<_>>(),
            ["base", "extra"]
        );
    }

    #[tokio::test]
    #[ignore = "downloads the official Mojang Java client"]
    async fn reads_original_textures_and_different_shapes_from_a_real_client() {
        let temp = tempfile::tempdir().unwrap();
        let core = Core::new(temp.path().to_path_buf(), Arc::new(|_| {})).unwrap();
        let result = core.dispatch("schematic_appearance", json!({"palette":[
            "minecraft:air", "minecraft:oak_stairs[facing=south,half=bottom,shape=straight,waterlogged=false]",
            "minecraft:oak_slab[type=top,waterlogged=false]", "minecraft:glass",
            "minecraft:oak_fence[east=false,north=true,south=false,west=false,waterlogged=false]",
            "minecraft:chest[facing=east,type=left,waterlogged=false]",
            "minecraft:chest[facing=east,type=right,waterlogged=false]",
            "minecraft:red_bed[facing=north,part=head,occupied=false]",
            "minecraft:purple_shulker_box[facing=west]",
            "minecraft:oak_sign[rotation=3,waterlogged=false]",
            "minecraft:water[level=8]",
            "minecraft:spruce_log", "minecraft:spruce_log[axis=x]",
            "minecraft:spruce_log[axis=y]", "minecraft:spruce_log[axis=z]",
            "minecraft:observer", "minecraft:observer[facing=south,powered=false]"
        ]})).await.unwrap();
        assert_eq!(result["version"], DEFAULT_VERSION);
        assert_eq!(result["states"][1][0]["y"], 90);
        let stairs = result["states"][1][0]["model"].as_str().unwrap();
        assert!(result["models"][stairs].as_array().unwrap().len() > 1);
        let slab = result["states"][2][0]["model"].as_str().unwrap();
        assert_eq!(result["models"][slab][0]["from"], json!([0, 8, 0]));
        assert_eq!(result["states"][4].as_array().unwrap().len(), 2);
        let left = result["states"][5][0]["model"].as_str().unwrap();
        let right = result["states"][6][0]["model"].as_str().unwrap();
        assert_eq!(result["states"][5][0]["y"].as_f64(), Some(90.));
        assert_eq!(result["models"][left][0]["to"][0].as_f64(), Some(16.));
        assert_eq!(result["models"][right][0]["from"][0].as_f64(), Some(0.));
        assert_eq!(result["states"][8][0]["x"], 90);
        let water = result["states"][10][0]["model"].as_str().unwrap();
        assert!(result["models"][water][0]["to"][1].as_f64().unwrap() > 14.);
        assert_eq!(result["states"][11], result["states"][13]);
        assert_eq!(
            result["states"][11][0]["model"],
            "minecraft:block/spruce_log"
        );
        assert_eq!(result["states"][12][0]["x"], 90);
        assert_eq!(result["states"][12][0]["y"], 90);
        assert_eq!(result["states"][14][0]["x"], 90);
        assert!(result["states"][14][0]["y"].is_null());
        assert_eq!(result["states"][15], result["states"][16]);
        for name in [
            "block/oak_planks",
            "block/glass",
            "entity/chest/normal_left",
            "entity/chest/normal_right",
            "entity/bed/red",
            "entity/shulker/shulker_purple",
            "entity/signs/oak",
            "block/water_still",
        ] {
            let texture = result["textures"][format!("minecraft:{name}")]
                .as_str()
                .unwrap();
            assert!(STANDARD.decode(texture).unwrap().starts_with(b"\x89PNG"));
        }
    }
}
