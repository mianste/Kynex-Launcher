use super::Properties;
use serde::Deserialize;
use std::{collections::BTreeMap, sync::OnceLock};

#[derive(Deserialize)]
struct Defaults {
    versions: Vec<String>,
    blocks: BTreeMap<String, Vec<(usize, Option<String>)>>,
}

static DEFAULTS: OnceLock<Defaults> = OnceLock::new();

fn version_number(version: &str) -> Option<[u16; 3]> {
    let (release, _) = version.split_once('-').unwrap_or((version, ""));
    let mut parts = release.split('.');
    let mut number = [0; 3];
    number[0] = parts.next()?.parse().ok()?;
    number[1] = parts.next()?.parse().ok()?;
    if let Some(patch) = parts.next() {
        number[2] = patch.parse().ok()?;
    }
    parts.next().is_none().then_some(number)
}

pub(super) struct BlockDefaults {
    data: &'static Defaults,
    version: usize,
}

impl BlockDefaults {
    pub(super) fn for_client(version: &str) -> Option<Self> {
        let data = DEFAULTS.get_or_init(|| {
            serde_json::from_str(include_str!(
                "../../../config/minecraft-preview-defaults.json"
            ))
            .expect("the bundled Minecraft default block registry must be valid")
        });
        let release = version_number(version)?;
        let version = data
            .versions
            .partition_point(|entry| version_number(entry).is_some_and(|entry| entry <= release));
        Some(Self {
            data,
            version: version.checked_sub(1)?,
        })
    }

    pub(super) fn fill(&self, name: &str, properties: &mut Properties<'_>) {
        let Some(name) = name.strip_prefix("minecraft:") else {
            return;
        };
        let Some(history) = self.data.blocks.get(name) else {
            return;
        };
        let Some((_, Some(defaults))) = history
            .iter()
            .rev()
            .find(|(first, _)| *first <= self.version)
        else {
            return;
        };
        for (key, value) in defaults.split(',').filter_map(|pair| pair.split_once('=')) {
            properties.entry(key).or_insert(value);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restores_vanilla_orientation_and_keeps_explicit_properties() {
        for version in ["1.20.1", "1.21.11", "26.3"] {
            let defaults = BlockDefaults::for_client(version).unwrap();
            let mut log = Properties::new();
            defaults.fill("minecraft:stripped_spruce_log", &mut log);
            assert_eq!(log["axis"], "y");
            let mut portal = Properties::new();
            defaults.fill("minecraft:nether_portal", &mut portal);
            assert_eq!(portal["axis"], "x");
            let mut stairs = BTreeMap::from([("facing", "east"), ("half", "top")]);
            defaults.fill("minecraft:oak_stairs", &mut stairs);
            assert_eq!(stairs["facing"], "east");
            assert_eq!(stairs["half"], "top");
            assert_eq!(stairs["shape"], "straight");
            let mut observer = Properties::new();
            defaults.fill("minecraft:observer", &mut observer);
            assert_eq!(observer["facing"], "south");
        }
    }
}
