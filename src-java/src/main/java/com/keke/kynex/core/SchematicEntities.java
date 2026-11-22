package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.zip.ZipFile;

import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.array;
import static com.keke.kynex.core.LaunchManifest.is;
import static com.keke.kynex.core.LaunchManifest.object;

final class SchematicEntities {
    private static final String[] DYES = {"#e6e6e6", "#d87f33", "#b24cd8", "#6699d8", "#e5e533", "#7fcc19",
        "#f27fa5", "#4c4c4c", "#999999", "#4c7f99", "#7f3fb2", "#334cb2", "#664c33", "#667f33", "#993333", "#191919"};
    private static final String[] DYE_NAMES = {"white", "orange", "magenta", "light_blue", "yellow", "lime", "pink",
        "gray", "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black"};
    private record Revision(String name, String hash) {}
    private static final Revision OLDER = new Revision("a2ce75c09ea64225ce236ddb8f4cafc2715cd651", "ec74011d307b1e4a6b9160f75ef02befc2c21864");
    private static final Revision TWENTY_ONE = new Revision("a1e7de1c0d19ede9116f9683308f81a6658f4995", "fbbc308558cadfa039a53ad4ff161e1ff1008610");
    private static final Revision TWENTY_SIX = new Revision("42a9ddbc5b4b7d29c12d8654e317cc98e0683681", "054ef3cc5c147fd041a7724413dc56afc902f29c");
    private final ZipFile archive;
    private final ZipFile game;
    private final String prefix;
    private final Map<String, JsonObject> components = new HashMap<>();
    private final JsonObject models = new JsonObject();
    private final JsonObject textures = new JsonObject();
    private int size;

    private SchematicEntities(ZipFile archive, ZipFile game, String revision) {
        this.archive = archive;
        this.game = game;
        prefix = "minecraft-entity-models-" + revision + "/";
    }

    static void apply(ZipFile game, String version, JsonArray palette, JsonArray entities, JsonObject result, Path root,
                      GameDownloads downloads, SchematicAppearance.Defaults defaults) {
        if (entities.isEmpty() && palette.asList().stream().noneMatch(state -> needsModel(state.getAsString()))) return;
        Revision revision = revision(version);
        try {
            Path file = GameFiles.target(root, "cache/schematic-appearance/entity-models/" + revision.name() + ".zip");
            String url = "https://codeload.github.com/InventivetalentDev/minecraft-entity-models/zip/" + revision.name();
            downloads.file(url, false, file, revision.hash(), GameDownloads.FILE_LIMIT, () -> false);
            try (var archive = new ZipFile(file.toFile())) {
                var appearance = new SchematicEntities(archive, game, revision.name());
                var draws = new JsonArray();
                for (int i = 0; i < Math.min(2048, entities.size()); i++) draws.add(appearance.figure(object(entities.get(i))));
                result.add("entityDraws", draws);
                result.add("entityBlocks", appearance.blocks(result, palette, defaults));
                result.add("entityModels", appearance.models);
                result.add("entityTextures", appearance.textures);
            }
        } catch (IOException error) { /* Block textures remain available when entity models cannot be downloaded. */ }
    }

    private static Revision revision(String version) {
        if (version.startsWith("26.")) return TWENTY_SIX;
        if (version.matches("1\\.(?:[0-9]|1[0-9]|20)(?:[.-].*)?") || version.matches("1\\.21(?:\\.[1-4])?")) return OLDER;
        return TWENTY_ONE;
    }

    private static boolean needsModel(String name) {
        String id = name.split("\\[", 2)[0].replaceFirst("^minecraft:", "");
        return id.endsWith("_banner") || id.endsWith("_head") || id.endsWith("_skull") || id.endsWith("copper_golem_statue")
            || Set.of("bell", "conduit", "decorated_pot").contains(id);
    }

    private JsonObject json(String name) {
        byte[] bytes = SchematicAppearance.bytes(archive, prefix + name);
        if (bytes == null) return new JsonObject();
        try { return object(JsonFiles.JSON.fromJson(new String(bytes, StandardCharsets.UTF_8), JsonObject.class)); }
        catch (JsonParseException invalid) { return new JsonObject(); }
    }

    private JsonObject model(String id) {
        return components.computeIfAbsent(id, key -> key.startsWith("minecraft:") && SchematicAppearance.resource(key) != null
            ? json("minecraft/" + key.substring("minecraft:".length()) + ".json") : new JsonObject());
    }

    private String texture(String path) {
        if (!path.startsWith("minecraft:textures/") || !path.endsWith(".png")) return null;
        String name = path.substring("minecraft:textures/".length(), path.length() - 4);
        String asset = SchematicAppearance.resource("minecraft:" + name);
        if (asset == null) return null;
        if (textures.has(asset)) return asset;
        byte[] data = SchematicAppearance.bytes(game, SchematicAppearance.path(asset, "textures", "png"));
        if (data == null && name.contains("/")) {
            String directory = name.substring(0, name.lastIndexOf('/'));
            String stem = name.substring(name.lastIndexOf('/') + 1);
            String kind = directory.substring(directory.lastIndexOf('/') + 1);
            String alias = stem.startsWith(kind + "_") ? stem.substring(kind.length() + 1) + "_" + kind
                : stem.endsWith("_" + kind) ? kind + "_" + stem.substring(0, stem.length() - kind.length() - 1) : "";
            if (!alias.isEmpty()) {
                data = SchematicAppearance.bytes(game, "assets/minecraft/textures/" + directory + "/" + alias + ".png");
                if (data == null) data = SchematicAppearance.bytes(game, "assets/minecraft/textures/" + directory + "/" + kind + ".png");
            }
        }
        if (data == null || !"image/png".equals(ArtworkCache.mime(data)) || size + data.length > 8 * 1024 * 1024) return null;
        size += data.length;
        textures.addProperty(asset, Base64.getEncoder().encodeToString(data));
        return asset;
    }

    private JsonObject draw(String id, String layer, String sprite, String blend, String tint) {
        JsonObject data = model(id);
        JsonObject part = object(object(data.get("layers")).get(layer));
        if (part.isEmpty()) return null;
        String texture = texture(sprite.isEmpty() ? text(part, "textureLocation", "") : sprite);
        if (texture == null) return null;
        String key = id + "/" + layer;
        if (!models.has(key)) {
            var shape = new JsonObject();
            shape.add("root", part.get("root"));
            shape.add("texture", part.get("texture"));
            shape.add("transform", data.get("transform"));
            models.add(key, shape);
        }
        return layer(key, texture, blend.isEmpty() ? text(part, "render", "") : blend, tint);
    }

    private static JsonObject layer(String model, String texture, String blend, String tint) {
        var result = new JsonObject();
        result.addProperty("model", model);
        result.addProperty("texture", texture);
        result.addProperty("blend", blend);
        result.addProperty("tint", tint);
        return result;
    }

    private JsonElement figure(JsonObject entity) {
        String identifier = text(entity, "id", "");
        if (!identifier.startsWith("minecraft:")) return JsonNull.INSTANCE;
        String id = identifier.substring("minecraft:".length());
        boolean baby = is(entity.get("baby"), true);
        if (id.equals("sulfur_cube")) return sulfur(baby);
        String variant = text(entity, "variant", "").replaceFirst("^.*:", "");
        if (!variant.matches("[a-z_]{1,32}")) variant = "";
        int index = (int) Math.clamp(ResourceCatalog.number(entity, "variantIndex", 0), 0, 255);
        String base = switch (id) {
            case "camel_husk" -> "camel";
            case "pufferfish" -> new String[]{"pufferfish_small", "pufferfish_medium", "pufferfish_big"}[Math.min(index, 2)];
            case "tropical_fish" -> "tropical_fish_small";
            case "salmon" -> Set.of("small", "large").contains(variant) ? "salmon_" + variant : id;
            case "boat", "chest_boat" -> id + "/" + (variant.isEmpty() ? "oak" : variant);
            case "bamboo_raft" -> "boat/bamboo";
            case "bamboo_chest_raft" -> "chest_boat/bamboo";
            default -> id.endsWith("_chest_boat") ? "chest_boat/" + id.replaceFirst("_chest_boat$", "")
                : id.endsWith("_boat") ? "boat/" + id.replaceFirst("_boat$", "") : id;
        };
        if (Set.of("cow", "pig", "chicken").contains(id) && Set.of("cold", "warm").contains(variant)) base = variant + "_" + base;
        String model = "minecraft:" + base;
        boolean child = baby && !model(model + "_baby").isEmpty();
        if (child) model += "_baby";
        var sprites = sprites(id, variant, index, entity, child);
        JsonObject primary = null;
        for (String sprite : sprites) {
            primary = draw(model, "main", "minecraft:textures/entity/" + sprite + ".png", "", "#ffffff");
            if (primary != null) break;
        }
        if (primary == null) primary = draw(model, "main", "", "", "#ffffff");
        if (primary == null) return JsonNull.INSTANCE;
        var parts = new JsonArray();
        parts.add(primary);
        int color = (int) ResourceCatalog.number(entity, "color", 0);
        String dye = color >= 0 && color < DYES.length ? DYES[color] : DYES[0];
        for (var pass : array(model(model).get("passes"))) {
            var row = object(pass);
            boolean enabled = switch (text(row, "when", "")) {
                case "", "not_underwater" -> true;
                case "powered" -> is(entity.get("charged"), true);
                case "tamed" -> is(entity.get("tamed"), true);
                case "not_sheared" -> !is(entity.get("sheared"), true);
                case "dyed" -> !is(entity.get("sheared"), true) && !dye.equals(DYES[0]);
                default -> false;
            };
            if (!enabled) continue;
            String tint = Set.of("wool_color", "collar_color").contains(text(row, "tint", "")) ? dye : "#ffffff";
            var draw = draw(model, text(row, "layer", "main"), text(row, "textureLocation", ""), text(row, "render", ""), tint);
            if (draw != null) parts.add(draw);
        }
        var result = new JsonObject();
        result.add("parts", parts);
        result.addProperty("scale", Set.of("slime", "magma_cube").contains(id) ? ResourceCatalog.number(entity, "size", 0) + 1
            : baby && !child ? 0.5 : 1.0);
        return result;
    }

    private static List<String> sprites(String id, String variant, int index, JsonObject entity, boolean child) {
        String suffix = child ? "_baby" : "";
        return switch (id) {
            case "camel_husk" -> List.of("camel/camel_husk");
            case "camel" -> List.of("camel/camel" + suffix);
            case "polar_bear" -> List.of("bear/polarbear" + suffix, "bear/polar_bear" + suffix);
            case "cat" -> variant.isEmpty() ? List.of() : named("cat", variant, suffix);
            case "frog" -> variant.isEmpty() ? List.of() : List.of("frog/frog_" + variant, "frog/" + variant + "_frog");
            case "fox" -> variant.equals("snow") ? named("fox", "snow", suffix) : List.of();
            case "axolotl" -> named("axolotl", new String[]{"lucy", "wild", "gold", "cyan", "blue"}[Math.min(index, 4)], suffix);
            case "parrot" -> named("parrot", new String[]{"red_blue", "blue", "green", "yellow_blue", "grey"}[Math.min(index, 4)], suffix);
            case "rabbit" -> named("rabbit", index == 99 ? "caerbannog"
                : new String[]{"brown", "white", "black", "white_splotched", "gold", "salt"}[Math.min(index, 5)], suffix);
            case "wolf" -> List.of("wolf/wolf" + (variant.isEmpty() || "pale".equals(variant) ? "" : "_" + variant)
                + (is(entity.get("tamed"), true) ? "_tame" : suffix));
            default -> List.of();
        };
    }

    private static List<String> named(String id, String name, String suffix) {
        return List.of(id + "/" + id + "_" + name + suffix, id + "/" + name + suffix);
    }

    private JsonElement sulfur(boolean baby) {
        int outer = baby ? 10 : 18;
        int sheet = baby ? 64 : 128;
        String suffix = baby ? "_small" : "";
        var parts = new JsonArray();
        for (String side : List.of("inner", "outer")) {
            String texture = texture("minecraft:textures/entity/sulfur_cube/sulfur_cube_" + side + suffix + ".png");
            if (texture == null) return JsonNull.INSTANCE;
            int dim = side.equals("inner") ? outer - 2 : outer;
            String key = "minecraft:sulfur_cube/" + side + suffix;
            var shape = JsonFiles.JSON.toJsonTree(Map.of("root", Map.of("cubes", List.of(Map.of(
                "origin", List.of(-dim / 2.0, -dim / 2.0, -dim / 2.0), "size", List.of(dim, dim, dim),
                "uv", List.of(0, side.equals("inner") ? baby ? 20 : 36 : 0)))), "texture", List.of(sheet, sheet),
                "transform", List.of(Map.of("translate", List.of(0, outer / 2.0, 0)), Map.of("scale", List.of(1, -1, -1)))));
            models.add(key, shape);
            parts.add(layer(key, texture, side.equals("inner") ? "cutout" : "translucent", "#ffffff"));
        }
        return JsonFiles.JSON.toJsonTree(Map.of("parts", parts, "scale", 1));
    }

    private JsonObject blocks(JsonObject result, JsonArray palette, SchematicAppearance.Defaults defaults) {
        var draws = new JsonObject();
        var index = json("blocks.json");
        for (int i = 0; i < palette.size(); i++) {
            String state = palette.get(i).getAsString();
            if (!needsModel(state)) continue;
            String[] pieces = state.replaceFirst("]$", "").split("\\[", 2);
            String id = SchematicAppearance.resource(pieces[0]);
            if (id == null || !id.startsWith("minecraft:")) continue;
            String name = id.substring("minecraft:".length());
            var properties = SchematicAppearance.properties(pieces.length > 1 ? pieces[1] : "");
            defaults.fill(id, properties);
            var info = object(index.get(id));
            var parts = new JsonArray();
            double angle = 0;
            JsonElement translation = info.get("translation");
            if (name.endsWith("copper_golem_statue")) {
                String suffix = name.replaceFirst("^waxed_", "").replaceFirst("copper_golem_statue$", "").replaceFirst("_$", "");
                String pose = properties.getOrDefault("pose", "");
                String model = Set.of("sitting", "running", "star").contains(pose) ? "minecraft:copper_golem_" + pose : "minecraft:copper_golem";
                String sprite = "minecraft:textures/entity/copper_golem/copper_golem" + (suffix.isEmpty() ? "" : "_" + suffix) + ".png";
                var part = draw(model, "main", sprite, "", "#ffffff");
                if (part != null) parts.add(part);
                angle = switch (properties.getOrDefault("facing", "")) {
                    case "west" -> 90;
                    case "north" -> 180;
                    case "east" -> 270;
                    default -> 0;
                };
                translation = JsonFiles.JSON.toJsonTree(model.equals("minecraft:copper_golem") ? List.of(8, 0, 8) : List.of(0, 0, 0));
            } else {
                for (var entry : array(info.get("parts"))) {
                    var row = object(entry);
                    String layer = text(row, "layer", "main");
                    String tint = "#ffffff";
                    if (layer.equals("flag")) for (int j = 0; j < DYE_NAMES.length; j++) {
                        if (Set.of(DYE_NAMES[j] + "_banner", DYE_NAMES[j] + "_wall_banner").contains(name)) tint = DYES[j];
                    }
                    var part = draw(text(row, "model", ""), layer, text(row, "textureLocation", ""), "", tint);
                    if (part != null) parts.add(part);
                }
                JsonObject rotation = object(info.get("rotation"));
                String facing = properties.getOrDefault(text(rotation, "property", ""), "");
                JsonElement degrees = object(rotation.get("degrees")).get(facing);
                if (degrees != null && degrees.isJsonPrimitive()) angle = degrees.getAsDouble();
                else if (!facing.isEmpty()) {
                    try { angle = Double.parseDouble(facing) * ResourceCatalog.number(rotation, "step", 0); }
                    catch (NumberFormatException ignored) { /* A named direction may not have an angle. */ }
                }
            }
            if (parts.isEmpty()) continue;
            boolean ordinary = !array(result.getAsJsonArray("states").get(i)).isEmpty();
            if (!ordinary || name.equals("bell")) {
                var draw = new JsonObject();
                draw.add("parts", parts);
                draw.addProperty("rotation", angle);
                draw.add("translation", translation);
                draw.addProperty("replace", !ordinary);
                draws.add(Integer.toString(i), draw);
            }
        }
        return draws;
    }
}
