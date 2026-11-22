// Downloaded PNG, unchanged. Source and SHA-256: src/assets/skins/SOURCES.json.
import steve from "../../assets/skins/steve.png?inline";
import alex from "../../assets/skins/alex.png?inline";
const steveAppearance = { texture: steve, model: "Classic", name: "Steve" };
const alexAppearance = { texture: alex, model: "Slim", name: "Alex" };
export function defaultSkin() {
  return steve;
}
export function defaultPlayerAppearance(uuid = "") {
  const compact = uuid.replaceAll("-", "");
  if (!/^[a-f0-9]{32}$/i.test(compact)) return steveAppearance;
  const words = compact.match(/.{8}/g) ?? [];
  // Java UUID.hashCode() is the XOR of the four 32-bit words.
  const hash = words.reduce((value, word) => value ^ parseInt(word, 16), 0);
  return (hash & 1) === 1 ? alexAppearance : steveAppearance;
}
