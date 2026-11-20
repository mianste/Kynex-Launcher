use super::{compound, list, Preview};
use fastnbt::Value as Nbt;
use serde_json::json;

fn number(value: &Nbt) -> Option<f64> {
    let value = match value {
        Nbt::Double(value) => *value,
        Nbt::Float(value) => f64::from(*value),
        Nbt::Int(value) => f64::from(*value),
        Nbt::Short(value) => f64::from(*value),
        Nbt::Byte(value) => f64::from(*value),
        _ => return None,
    };
    value.is_finite().then_some(value)
}

fn entity_id(value: &Nbt) -> Option<String> {
    let Nbt::String(value) = value else {
        return None;
    };
    let id = match value.as_str() {
        "PigZombie" | "minecraft:zombie_pigman" => "minecraft:zombified_piglin".into(),
        "LavaSlime" => "minecraft:magma_cube".into(),
        "MushroomCow" => "minecraft:mooshroom".into(),
        "SnowMan" | "minecraft:snowman" => "minecraft:snow_golem".into(),
        "VillagerGolem" | "minecraft:villager_golem" => "minecraft:iron_golem".into(),
        "EntityHorse" => "minecraft:horse".into(),
        "Ozelot" => "minecraft:ocelot".into(),
        _ if value.contains(':') => value.clone(),
        _ => {
            let mut id = String::from("minecraft:");
            for (index, ch) in value.chars().enumerate() {
                if index > 0 && ch.is_ascii_uppercase() {
                    id.push('_');
                }
                id.push(ch.to_ascii_lowercase());
            }
            id
        }
    };
    let (namespace, path) = id.split_once(':')?;
    (id.len() <= 128
        && !namespace.is_empty()
        && !path.is_empty()
        && id
            .bytes()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || b"_:-.".contains(&ch)))
    .then_some(id)
}

impl Preview {
    pub(super) fn add_entities(
        &mut self,
        entries: Option<&Nbt>,
        offset: [i64; 3],
        structure: bool,
    ) {
        let Some(entries) = entries.and_then(|value| list(value).ok()) else {
            return;
        };
        for entry in entries
            .iter()
            .take(2048usize.saturating_sub(self.entities.len()))
        {
            let Ok(record) = compound(entry) else {
                continue;
            };
            let details = record
                .get(if structure { "nbt" } else { "Data" })
                .and_then(|value| compound(value).ok())
                .unwrap_or(record);
            let Some(id) = record
                .get("Id")
                .or_else(|| details.get("id"))
                .and_then(entity_id)
            else {
                continue;
            };
            let Some([x, y, z]) = record
                .get(if structure { "pos" } else { "Pos" })
                .and_then(|value| list(value).ok())
            else {
                continue;
            };
            let (Some(x), Some(y), Some(z)) = (number(x), number(y), number(z)) else {
                continue;
            };
            let coordinates = [x, y, z];
            let position: [f64; 3] = std::array::from_fn(|axis| {
                coordinates[axis] + (offset[axis] - self.origin[axis]) as f64
            });
            if position
                .iter()
                .zip(self.size)
                .any(|(&value, extent)| value < -16. || value > extent as f64 + 16.)
            {
                continue;
            }
            let rotation = details
                .get("Rotation")
                .and_then(|value| list(value).ok())
                .unwrap_or_default();
            let yaw = rotation
                .first()
                .and_then(number)
                .unwrap_or_default()
                .rem_euclid(360.);
            let pitch = rotation
                .get(1)
                .and_then(number)
                .unwrap_or_default()
                .clamp(-90., 90.);
            let text = |key| match details.get(key) {
                Some(Nbt::String(value)) if value.len() <= 64 => Some(value.as_str()),
                _ => None,
            };
            let value = |key| details.get(key).and_then(number).unwrap_or_default();
            let flag = |key| value(key) != 0.;
            let variant = text("variant")
                .or_else(|| text("Variant"))
                .or_else(|| text("Type"));
            let variant_index = details
                .get("Variant")
                .or_else(|| details.get("variant"))
                .or_else(|| details.get("RabbitType"))
                .or_else(|| details.get("PuffState"))
                .and_then(number);
            let color = details
                .get("Color")
                .or_else(|| details.get("color"))
                .or_else(|| details.get("CollarColor"))
                .and_then(number);
            self.entities.push(json!({
                "id":id,"position":position,"yaw":yaw,"pitch":pitch,
                "variant":variant,"variantIndex":variant_index,"color":color,
                "baby":value("Age") < 0. || flag("IsBaby") || flag("Baby"),
                "sheared":flag("Sheared"),"charged":flag("powered"),
                "size":value("Size").clamp(0., 32.),
                "tamed":details.contains_key("Owner") || details.contains_key("owner") || flag("Tame"),
            }));
        }
    }
}
