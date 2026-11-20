use super::{asset_path, bytes, defaults::BlockDefaults, resource};
use crate::{engine, Core};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{collections::BTreeMap, fs::File, path::PathBuf};
use zip::ZipArchive;

pub(super) struct ModelArchive {
    path: PathBuf,
    revision: &'static str,
}

fn block_needs_entity_model(state: &str) -> bool {
    let name = state.split('[').next().unwrap_or(state);
    let name = if name.contains(':') {
        name.strip_prefix("minecraft:").unwrap_or("")
    } else {
        name
    };
    name.ends_with("_banner")
        || name.ends_with("_head")
        || name.ends_with("_skull")
        || name.ends_with("copper_golem_statue")
        || matches!(name, "bell" | "conduit" | "decorated_pot")
}

pub(super) async fn load_archive(
    core: &Core,
    version: &str,
    palette: &[Value],
    figures: &[Value],
) -> Option<ModelArchive> {
    if !figures.iter().any(|figure| {
        figure["id"]
            .as_str()
            .is_some_and(|name| name.starts_with("minecraft:"))
    }) && !palette
        .iter()
        .any(|state| state.as_str().is_some_and(block_needs_entity_model))
    {
        return None;
    }
    // Immutable public exports of Java's model geometry. The actual texture PNGs come from the client JAR.
    let (revision, hash) = if version.starts_with("26.") {
        (
            "42a9ddbc5b4b7d29c12d8654e317cc98e0683681",
            "054ef3cc5c147fd041a7724413dc56afc902f29c",
        )
    } else if version
        .split('.')
        .nth(1)
        .and_then(|minor| minor.parse::<u8>().ok())
        .is_some_and(|minor| minor <= 20)
        || matches!(version, "1.21" | "1.21.1" | "1.21.2" | "1.21.3" | "1.21.4")
    {
        (
            "a2ce75c09ea64225ce236ddb8f4cafc2715cd651",
            "ec74011d307b1e4a6b9160f75ef02befc2c21864",
        )
    } else {
        (
            "a1e7de1c0d19ede9116f9683308f81a6658f4995",
            "fbbc308558cadfa039a53ad4ff161e1ff1008610",
        )
    };
    let path = core.data_root.join(format!(
        "cache/schematic-appearance/entity-models/{revision}.zip"
    ));
    let url = format!(
        "https://codeload.github.com/InventivetalentDev/minecraft-entity-models/zip/{revision}"
    );
    if tokio::time::timeout(
        std::time::Duration::from_secs(15),
        engine::download(core, &url, &path, hash),
    )
    .await
    .ok()?
    .is_err()
    {
        return None;
    }
    Some(ModelArchive { path, revision })
}

const DYES: [&str; 16] = [
    "#e6e6e6", "#d87f33", "#b24cd8", "#6699d8", "#e5e533", "#7fcc19", "#f27fa5", "#4c4c4c",
    "#999999", "#4c7f99", "#7f3fb2", "#334cb2", "#664c33", "#667f33", "#993333", "#191919",
];
const DYE_NAMES: [&str; 16] = [
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

pub(super) struct Models {
    archive: ZipArchive<File>,
    prefix: String,
    catalog: BTreeMap<String, Value>,
    used_models: BTreeMap<String, Value>,
    textures: BTreeMap<String, String>,
    texture_bytes: usize,
}

impl Models {
    pub(super) fn open(source: ModelArchive) -> Option<Self> {
        Some(Self {
            archive: ZipArchive::new(File::open(source.path).ok()?).ok()?,
            prefix: format!("minecraft-entity-models-{}/", source.revision),
            catalog: BTreeMap::new(),
            used_models: BTreeMap::new(),
            textures: BTreeMap::new(),
            texture_bytes: 0,
        })
    }

    fn data(&mut self, path: &str) -> Option<Value> {
        serde_json::from_slice(&bytes(
            &mut self.archive,
            &format!("{}{path}", self.prefix),
        )?)
        .ok()
    }

    fn model(&mut self, name: &str) -> Value {
        if let Some(model) = self.catalog.get(name) {
            return model.clone();
        }
        let model = name
            .strip_prefix("minecraft:")
            .and_then(|id| resource(name).map(|_| id))
            .and_then(|id| self.data(&format!("minecraft/{id}.json")))
            .unwrap_or_default();
        self.catalog.insert(name.into(), model.clone());
        model
    }

    fn texture(&mut self, game: &mut ZipArchive<File>, sprite: &str) -> Option<String> {
        let (namespace, path) = sprite.strip_suffix(".png")?.split_once(":textures/")?;
        if namespace != "minecraft" {
            return None;
        }
        let source = resource(&format!("{namespace}:{path}"))?;
        if self.textures.contains_key(&source) {
            return Some(source);
        }
        let content = bytes(game, &asset_path(&source, "textures", "png")?).or_else(|| {
            let (directory, stem) = path.rsplit_once('/')?;
            let species = directory.rsplit('/').next()?;
            let alternate = if let Some(variant) = stem.strip_prefix(&format!("{species}_")) {
                format!("{variant}_{species}")
            } else if let Some(variant) = stem.strip_suffix(&format!("_{species}")) {
                format!("{species}_{variant}")
            } else {
                return None;
            };
            bytes(
                game,
                &format!("assets/minecraft/textures/{directory}/{alternate}.png"),
            )
            .or_else(|| {
                bytes(
                    game,
                    &format!("assets/minecraft/textures/{directory}/{species}.png"),
                )
            })
        })?;
        if !content.starts_with(b"\x89PNG\r\n\x1a\n")
            || self.texture_bytes + content.len() > 8 * 1024 * 1024
        {
            return None;
        }
        self.texture_bytes += content.len();
        self.textures
            .insert(source.clone(), STANDARD.encode(content));
        Some(source)
    }

    fn draw(
        &mut self,
        game: &mut ZipArchive<File>,
        model: &str,
        layer: &str,
        sprite: Option<&str>,
        blend: Option<&str>,
        tint: &str,
    ) -> Option<Value> {
        let data = self.model(model);
        let part = data["layers"].get(layer)?;
        let sprite = sprite.or_else(|| part["textureLocation"].as_str())?;
        let texture = self.texture(game, sprite)?;
        let key = format!("{model}/{layer}");
        self.used_models.entry(key.clone()).or_insert_with(|| {
            json!({
                "root":part["root"],"texture":part["texture"],"transform":data["transform"],
            })
        });
        Some(
            json!({"model":key,"texture":texture,"blend":blend.or_else(|| part["render"].as_str()),"tint":tint}),
        )
    }

    fn figure(&mut self, game: &mut ZipArchive<File>, entity: &Value) -> Value {
        let Some(id) = entity["id"]
            .as_str()
            .and_then(|name| name.strip_prefix("minecraft:"))
        else {
            return Value::Null;
        };
        let variant = entity["variant"]
            .as_str()
            .and_then(|v| v.rsplit(':').next())
            .filter(|v| v.len() <= 32 && v.bytes().all(|ch| ch.is_ascii_lowercase() || ch == b'_'));
        let baby = entity["baby"] == true;
        if id == "sulfur_cube" {
            return self.sulfur_cube(game, baby);
        }
        let index = entity["variantIndex"]
            .as_f64()
            .filter(|n| (0. ..=255.).contains(n))
            .unwrap_or(0.) as usize;
        let base = match id {
            "camel_husk" => "camel".into(),
            "pufferfish" => {
                ["pufferfish_small", "pufferfish_medium", "pufferfish_big"][index.min(2)].into()
            }
            "tropical_fish" => "tropical_fish_small".into(),
            "salmon" if variant == Some("small") => "salmon_small".into(),
            "salmon" if variant == Some("large") => "salmon_large".into(),
            "boat" | "chest_boat" => format!("{id}/{}", variant.unwrap_or("oak")),
            "bamboo_raft" => "boat/bamboo".into(),
            "bamboo_chest_raft" => "chest_boat/bamboo".into(),
            other if other.ends_with("_chest_boat") => {
                format!("chest_boat/{}", other.trim_end_matches("_chest_boat"))
            }
            other if other.ends_with("_boat") => {
                format!("boat/{}", other.trim_end_matches("_boat"))
            }
            _ => id.to_owned(),
        };
        let alternate = if matches!(id, "cow" | "pig" | "chicken") {
            variant
                .filter(|v| matches!(*v, "cold" | "warm"))
                .map(|v| format!("{v}_{base}"))
        } else {
            None
        };
        let adult = format!("minecraft:{}", alternate.as_deref().unwrap_or(&base));
        let child = format!("{adult}_baby");
        let (model, is_child) = if baby && !self.model(&child).is_null() {
            (child, true)
        } else {
            (adult, false)
        };
        let data = self.model(&model);
        let baby_texture = if is_child { "_baby" } else { "" };
        let named_sprites = |folder: &str, species: &str, name: &str| {
            vec![
                format!("minecraft:textures/entity/{folder}/{species}_{name}{baby_texture}.png"),
                format!("minecraft:textures/entity/{folder}/{name}{baby_texture}.png"),
            ]
        };
        let sprites: &[String] = &match (id, variant) {
            ("camel_husk", _) => vec!["minecraft:textures/entity/camel/camel_husk.png".into()],
            ("camel", _) => vec![format!(
                "minecraft:textures/entity/camel/camel{baby_texture}.png"
            )],
            ("polar_bear", _) => vec![
                format!("minecraft:textures/entity/bear/polarbear{baby_texture}.png"),
                format!("minecraft:textures/entity/bear/polar_bear{baby_texture}.png"),
            ],
            ("cat", Some(variant)) => named_sprites("cat", "cat", variant),
            ("frog", Some(variant)) => vec![
                format!("minecraft:textures/entity/frog/frog_{variant}.png"),
                format!("minecraft:textures/entity/frog/{variant}_frog.png"),
            ],
            ("fox", Some("snow")) => named_sprites("fox", "fox", "snow"),
            ("axolotl", _) => named_sprites(
                "axolotl",
                "axolotl",
                ["lucy", "wild", "gold", "cyan", "blue"][index.min(4)],
            ),
            ("parrot", _) => named_sprites(
                "parrot",
                "parrot",
                ["red_blue", "blue", "green", "yellow_blue", "grey"][index.min(4)],
            ),
            ("rabbit", _) => named_sprites(
                "rabbit",
                "rabbit",
                if index == 99 {
                    "caerbannog"
                } else {
                    ["brown", "white", "black", "white_splotched", "gold", "salt"][index.min(5)]
                },
            ),
            ("wolf", _) => {
                let suffix = if entity["tamed"] == true {
                    "_tame"
                } else if is_child {
                    "_baby"
                } else {
                    ""
                };
                let name = variant
                    .filter(|v| *v != "pale")
                    .map_or(String::new(), |v| format!("_{v}"));
                vec![format!(
                    "minecraft:textures/entity/wolf/wolf{name}{suffix}.png"
                )]
            }
            _ => vec![],
        };
        let main = sprites
            .iter()
            .find_map(|sprite| self.draw(game, &model, "main", Some(sprite), None, "#ffffff"))
            .or_else(|| self.draw(game, &model, "main", None, None, "#ffffff"));
        let Some(main) = main else { return Value::Null };
        let mut parts = vec![main];
        let color = entity["color"]
            .as_f64()
            .filter(|n| (0. ..16.).contains(n))
            .and_then(|n| DYES.get(n as usize))
            .copied()
            .unwrap_or(DYES[0]);
        if let Some(passes) = data["passes"].as_array() {
            for pass in passes {
                let enabled = match pass["when"].as_str() {
                    None | Some("not_underwater") => true,
                    Some("powered") => entity["charged"] == true,
                    Some("tamed") => entity["tamed"] == true,
                    Some("not_sheared") => entity["sheared"] != true,
                    Some("dyed") => entity["sheared"] != true && color != DYES[0],
                    _ => false,
                };
                if enabled {
                    let layer = pass["layer"].as_str().unwrap_or("main");
                    let tint =
                        if matches!(pass["tint"].as_str(), Some("wool_color" | "collar_color")) {
                            color
                        } else {
                            "#ffffff"
                        };
                    if let Some(draw) = self.draw(
                        game,
                        &model,
                        layer,
                        pass["textureLocation"].as_str(),
                        pass["render"].as_str(),
                        tint,
                    ) {
                        parts.push(draw);
                    }
                }
            }
        }
        let scale = if matches!(id, "slime" | "magma_cube") {
            entity["size"].as_f64().unwrap_or(0.) + 1.
        } else if baby && !is_child {
            0.5
        } else {
            1.
        };
        json!({"parts":parts,"scale":scale})
    }

    fn sulfur_cube(&mut self, game: &mut ZipArchive<File>, baby: bool) -> Value {
        // 26.3 uses concentric cuboids with separate UVs and a translucent outer skin.
        let (outer, inner, inner_v, sheet, suffix) = if baby {
            (10., 8., 20, 64, "_small")
        } else {
            (18., 16., 36, 128, "")
        };
        let mut parts = Vec::new();
        for (layer, size, v, blend) in [
            ("inner", inner, inner_v, "cutout"),
            ("outer", outer, 0, "translucent"),
        ] {
            let texture_path =
                format!("minecraft:textures/entity/sulfur_cube/sulfur_cube_{layer}{suffix}.png");
            let Some(texture) = self.texture(game, &texture_path) else {
                return Value::Null;
            };
            let key = format!("minecraft:sulfur_cube/{layer}{suffix}");
            self.used_models.entry(key.clone()).or_insert_with(|| json!({
                "root":{"cubes":[{"origin":[-size / 2.,-size / 2.,-size / 2.],"size":[size,size,size],"uv":[0,v]}]},
                "texture":[sheet,sheet],"transform":[{"translate":[0,outer / 2.,0]},{"scale":[1,-1,-1]}],
            }));
            parts.push(json!({"model":key,"texture":texture,"blend":blend,"tint":"#ffffff"}));
        }
        json!({"parts":parts,"scale":1.})
    }

    fn blocks(
        &mut self,
        game: &mut ZipArchive<File>,
        result: &Value,
        palette: &[Value],
        defaults: Option<&BlockDefaults>,
    ) -> BTreeMap<usize, Value> {
        let mut rendered = BTreeMap::new();
        let index = self.data("blocks.json").unwrap_or_default();
        for (i, value) in palette.iter().enumerate() {
            let Some(state) = value
                .as_str()
                .filter(|state| block_needs_entity_model(state))
            else {
                continue;
            };
            let (name, props) = state
                .trim_end_matches(']')
                .split_once('[')
                .unwrap_or((state, ""));
            let Some(id) = resource(name) else { continue };
            let mut props: BTreeMap<_, _> =
                props.split(',').filter_map(|v| v.split_once('=')).collect();
            if let Some(defaults) = defaults {
                defaults.fill(&id, &mut props);
            }
            let bare_name = id.strip_prefix("minecraft:").unwrap_or(&id);
            if let Some(stage) = bare_name
                .trim_start_matches("waxed_")
                .strip_suffix("copper_golem_statue")
            {
                let model = match props.get("pose").copied() {
                    Some("sitting") => "minecraft:copper_golem_sitting",
                    Some("running") => "minecraft:copper_golem_running",
                    Some("star") => "minecraft:copper_golem_star",
                    _ => "minecraft:copper_golem",
                };
                let suffix = if stage.is_empty() {
                    String::new()
                } else {
                    format!("_{}", stage.trim_end_matches('_'))
                };
                let sprite =
                    format!("minecraft:textures/entity/copper_golem/copper_golem{suffix}.png");
                if let Some(part) = self.draw(game, model, "main", Some(&sprite), None, "#ffffff") {
                    let facing = match props.get("facing").copied() {
                        Some("west") => 90,
                        Some("north") => 180,
                        Some("east") => 270,
                        _ => 0,
                    };
                    let translation = if model == "minecraft:copper_golem" {
                        [8, 0, 8]
                    } else {
                        [0, 0, 0]
                    };
                    rendered.insert(i, json!({"parts":[part],"rotation":facing,"translation":translation,"replace":true}));
                }
                continue;
            }
            let block = &index[&id];
            let Some(parts) = block["parts"].as_array() else {
                continue;
            };
            let color = DYE_NAMES.iter().position(|dye| {
                bare_name
                    .strip_prefix(dye)
                    .is_some_and(|v| matches!(v, "_banner" | "_wall_banner"))
            });
            let parts: Vec<_> = parts
                .iter()
                .filter_map(|part| {
                    let model = part["model"].as_str()?;
                    let layer = part["layer"].as_str().unwrap_or("main");
                    let tint = if layer == "flag" {
                        color.map(|id| DYES[id]).unwrap_or("#ffffff")
                    } else {
                        "#ffffff"
                    };
                    self.draw(
                        game,
                        model,
                        layer,
                        part["textureLocation"].as_str(),
                        None,
                        tint,
                    )
                })
                .collect();
            if parts.is_empty() {
                continue;
            }
            let rotation = &block["rotation"];
            let facing = rotation["property"]
                .as_str()
                .and_then(|key| props.get(key))
                .copied()
                .unwrap_or("");
            let angle = rotation["degrees"][facing]
                .as_f64()
                .or_else(|| Some(rotation["step"].as_f64()? * facing.parse::<f64>().ok()?))
                .unwrap_or(0.);
            let has_model = result["states"][i]
                .as_array()
                .is_some_and(|parts| !parts.is_empty());
            if !has_model || bare_name == "bell" {
                rendered.insert(i, json!({"parts":parts,"rotation":angle,"translation":block["translation"],"replace":!has_model}));
            }
        }
        rendered
    }

    pub(super) fn add_appearances(
        &mut self,
        game: &mut ZipArchive<File>,
        result: &mut Value,
        palette: &[Value],
        figures: &[Value],
        defaults: Option<&BlockDefaults>,
    ) {
        result["entityDraws"] = json!(figures
            .iter()
            .map(|entity| self.figure(game, entity))
            .collect::<Vec<_>>());
        result["blockEntities"] = json!(self.blocks(game, result, palette, defaults));
        result["entityModels"] = json!(std::mem::take(&mut self.used_models));
        result["entityTextures"] = json!(std::mem::take(&mut self.textures));
    }
}
