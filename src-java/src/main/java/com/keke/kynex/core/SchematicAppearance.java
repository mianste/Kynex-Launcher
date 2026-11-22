package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.zip.ZipFile;

import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.array;
import static com.keke.kynex.core.LaunchManifest.is;
import static com.keke.kynex.core.LaunchManifest.object;

final class SchematicAppearance {
    private static final String DEFAULT = "1.21.11";
    private static final String SHA = "ba2df812c2d12e0219c489c4cd9a5e1f0760f5bd";
    private static final String CLIENT = "https://piston-data.mojang.com/v1/objects/" + SHA + "/client.jar";
    private static final Map<String, String> ALIASES = Map.of("minecraft:chain", "minecraft:iron_chain", "minecraft:iron_chain",
        "minecraft:chain", "minecraft:short_grass", "minecraft:grass", "minecraft:grass", "minecraft:short_grass");
    private final GameDownloads downloads;
    private record Local(String version, Path client) {}
    private record Model(JsonObject textures, JsonArray elements) {}
    private record Sprite(String name, boolean translucent) {}

    SchematicAppearance(GameDownloads downloads) { this.downloads = downloads; }

    JsonObject load(Path root, Path dataRoot, JsonObject request) throws IOException {
        if (!(request.get("palette") instanceof JsonArray palette) || palette.size() > 8192
            || palette.asList().stream().anyMatch(state -> !state.isJsonPrimitive() || !state.getAsJsonPrimitive().isString()
                || state.getAsString().length() > 512)) throw new IOException("此投影的方块状态太多，无法加载原版纹理");
        JsonArray figures = array(request.get("entities"));
        Local local = findLocal(root, request);
        if (local != null) {
            try {
                JsonObject assets = assemble(local.client(), local.version(), palette, figures, dataRoot);
                if (!object(assets.get("textures")).isEmpty() || !object(assets.get("entityTextures")).isEmpty()) return assets;
            } catch (IOException unreadable) {
                // Older instances may have no neighbouring resource model archive.
            }
        }
        Path jar = GameFiles.target(dataRoot, "cache/schematic-appearance/" + DEFAULT + "/client.jar");
        downloads.file(CLIENT, false, jar, SHA, GameDownloads.FILE_LIMIT, () -> false);
        return assemble(jar, DEFAULT, palette, figures, dataRoot);
    }

    private static Local findLocal(Path root, JsonObject request) {
        if (text(request, "id", "").isEmpty()) return null;
        try {
            Path instance = LocalGameFiles.instance(root, request);
            var settings = LocalGameFiles.configuration(instance);
            String game = JsonFiles.required(settings, "version");
            LaunchManifest.safeName(game);
            var paths = new ArrayList<>(List.of(instance.resolve("client.jar"), root.resolve("versions").resolve(game).resolve(game + ".jar")));
            String custom = text(settings, "externalClient", "");
            if (!custom.isEmpty()) paths.add(1, Path.of(custom));
            Path metadata = instance.resolve("version.json");
            if (Files.isRegularFile(metadata)) {
                String sha = text(object(object(object(JsonFiles.read(metadata)).get("downloads")).get("client")), "sha1", "");
                if (sha.matches("[0-9a-fA-F]{40}")) paths.add(root.resolve("cache/game-clients").resolve(sha).resolve("client.jar"));
            }
            for (Path path : paths) {
                if (Files.isRegularFile(path) && path.toRealPath().startsWith(root)) return new Local(game, path);
            }
        } catch (IOException | IllegalArgumentException | JsonParseException ignored) { /* Use the verified default client. */ }
        return null;
    }

    private JsonObject assemble(Path jar, String version, JsonArray palette, JsonArray figures, Path dataRoot) throws IOException {
        var states = new JsonArray();
        var models = new JsonObject();
        var blocks = new HashMap<String, JsonObject>();
        var missing = new HashSet<String>();
        var textures = new TreeSet<String>();
        try (var archive = new ZipFile(jar.toFile())) {
            var defaults = new Defaults(version);
            for (var raw : palette) {
                String value = raw.getAsString();
                String[] sections = value.replaceFirst("]$", "").split("\\[", 2);
                String id = resource(sections[0]);
                var parts = new JsonArray();
                states.add(parts);
                if (id == null || id.equals("minecraft:air")) continue;
                var properties = properties(sections.length == 2 ? sections[1] : "");
                defaults.fill(id, properties);
                var special = SchematicSpecialBlocks.resolve(id, properties);
                if (special != null && archive.getEntry(path(special.texture(), "textures", "png")) != null) {
                    String key = "special:" + value;
                    models.add(key, special.elements());
                    textures.add(special.texture());
                    parts.add(WorkshopPlans.json("model", key, "x", special.x(), "y", special.y()));
                    continue;
                }
                var block = blocks.computeIfAbsent(id, name -> {
                    JsonObject asset = document(archive, name, "blockstates");
                    return asset.isEmpty() && ALIASES.containsKey(name) ? document(archive, ALIASES.get(name), "blockstates") : asset;
                });
                if (object(block.get("variants")).has("axis=y")) properties.putIfAbsent("axis", "y");
                for (var part : selected(block, properties)) {
                    String key = resource(text(part, "model", ""));
                    if (key == null) continue;
                    if (!models.has(key) && !missing.contains(key)) {
                        var elements = model(archive, key, textures);
                        if (elements.isEmpty()) missing.add(key);
                        else models.add(key, elements);
                    }
                    if (models.has(key)) {
                        var placement = new JsonObject();
                        placement.addProperty("model", key);
                        placement.add("x", part.get("x"));
                        placement.add("y", part.get("y"));
                        placement.add("uvlock", part.get("uvlock"));
                        parts.add(placement);
                    }
                }
                if (parts.isEmpty()) fallback(archive, id, value, properties, parts, models, textures);
            }
            var images = new JsonObject();
            int total = 0;
            for (String texture : textures) {
                byte[] bytes = bytes(archive, path(texture, "textures", "png"));
                if (bytes == null || total + bytes.length > 8 * 1024 * 1024) continue;
                total += bytes.length;
                images.addProperty(texture, Base64.getEncoder().encodeToString(bytes));
            }
            var result = new JsonObject();
            result.addProperty("version", version);
            result.add("states", states);
            result.add("models", models);
            result.add("textures", images);
            SchematicEntities.apply(archive, version, palette, figures, result, dataRoot, downloads, defaults);
            return result;
        }
    }

    private static List<JsonObject> selected(JsonObject block, Map<String, String> properties) {
        if (block.get("variants") instanceof JsonObject variants) {
            int score = Integer.MIN_VALUE;
            JsonElement best = null;
            for (var row : variants.entrySet()) {
                int match = 0;
                int unknown = 0;
                boolean rejected = false;
                for (var rule : properties(row.getKey()).entrySet()) {
                    String found = properties.get(rule.getKey());
                    if (found == null) unknown++;
                    else if (List.of(rule.getValue().split("\\|")).contains(found)) match++;
                    else { rejected = true; break; }
                }
                int current = match * 1024 - unknown;
                if (!rejected && current >= score) { best = row.getValue(); score = current; }
            }
            return best != null ? List.of(first(best)) : List.of();
        }
        var parts = new ArrayList<JsonObject>();
        for (var group : array(block.get("multipart"))) {
            JsonObject row = object(group);
            if (!row.has("when") || condition(object(row.get("when")), properties)) parts.add(first(row.get("apply")));
            if (parts.size() == 24) break;
        }
        return parts;
    }

    private static boolean condition(JsonObject rules, Map<String, String> properties) {
        for (var entry : rules.entrySet()) {
            if (entry.getKey().equals("OR")) {
                if (array(entry.getValue()).asList().stream().noneMatch(test -> condition(object(test), properties))) return false;
            } else if (entry.getKey().equals("AND")) {
                if (array(entry.getValue()).asList().stream().anyMatch(test -> !condition(object(test), properties))) return false;
            } else {
                String actual = properties.get(entry.getKey());
                if (actual == null || !entry.getValue().isJsonPrimitive()) return false;
                String expected = entry.getValue().getAsString();
                boolean negative = expected.startsWith("!");
                if (List.of((negative ? expected.substring(1) : expected).split("\\|")).contains(actual) == negative) return false;
            }
        }
        return true;
    }

    private static JsonObject first(JsonElement value) {
        return value instanceof JsonArray choices && !choices.isEmpty() ? object(choices.get(0)) : object(value);
    }

    private static JsonArray model(ZipFile archive, String id, Set<String> textures) {
        Model model = inherit(archive, id, 0);
        var result = new JsonArray();
        for (var element : model.elements()) {
            var body = object(element).deepCopy();
            JsonObject faces = object(body.get("faces"));
            if (faces.isEmpty()) continue;
            for (var side : faces.entrySet()) {
                JsonObject face = object(side.getValue());
                Sprite spec = texture(face.get("texture"), model.textures());
                face.addProperty("texture", spec.name());
                if (spec.translucent()) face.addProperty("force_translucent", true);
                if (!spec.name().isEmpty()) textures.add(spec.name());
            }
            result.add(body);
            if (result.size() >= 64) break;
        }
        return result;
    }

    private static Model inherit(ZipFile archive, String id, int depth) {
        var blank = new Model(new JsonObject(), new JsonArray());
        if (depth >= 16) return blank;
        JsonObject value = document(archive, id, "models");
        String parent = resource(text(value, "parent", ""));
        Model base = parent == null ? blank : inherit(archive, parent, depth + 1);
        object(value.get("textures")).entrySet().forEach(row -> base.textures().add(row.getKey(), row.getValue()));
        return new Model(base.textures(), value.get("elements") instanceof JsonArray own ? own : base.elements());
    }

    private static Sprite texture(JsonElement input, JsonObject textures) {
        JsonElement node = input;
        boolean translucent = false;
        for (int depth = 0; depth < 16 && node != null; depth++) {
            String sprite;
            if (node.isJsonPrimitive()) sprite = node.getAsString();
            else {
                translucent |= is(object(node).get("force_translucent"), true);
                sprite = text(object(node), "sprite", "");
            }
            if (sprite.startsWith("#")) node = textures.get(sprite.substring(1));
            else {
                String id = resource(sprite);
                if (id != null) return new Sprite(id, translucent);
                break;
            }
        }
        return new Sprite("", false);
    }

    private static void fallback(ZipFile archive, String id, String state, Map<String, String> props, JsonArray parts,
                                 JsonObject models, Set<String> textures) {
        boolean portal = Set.of("minecraft:end_portal", "minecraft:end_gateway").contains(id);
        String base = id.equals("minecraft:bubble_column") ? "minecraft:water" : id;
        boolean fluid = Set.of("minecraft:water", "minecraft:lava").contains(base);
        int colon = base.indexOf(':');
        String texture = portal ? "minecraft:entity/end_portal/end_portal"
            : base.substring(0, colon + 1) + "block/" + base.substring(colon + 1) + (fluid ? "_still" : "");
        if (!portal && archive.getEntry(path(texture, "textures", "png")) == null) return;
        String key = "cube:" + state;
        int level = 0;
        try { level = Integer.parseInt(props.getOrDefault("level", "0")); } catch (NumberFormatException ignored) {}
        double height = fluid ? 16.0 - (Math.floorMod(level, 8) + 1) * 16.0 / 9.0 : 16.0;
        boolean surface = id.equals("minecraft:end_portal");
        var element = new JsonObject();
        element.add("from", JsonFiles.JSON.toJsonTree(new int[]{0, surface ? 6 : 0, 0}));
        element.add("to", JsonFiles.JSON.toJsonTree(new double[]{16, surface ? 12 : height, 16}));
        var sides = new JsonObject();
        for (String name : List.of("up", "down", "north", "south", "east", "west")) {
            var face = new JsonObject();
            face.addProperty("texture", texture);
            face.addProperty("cullface", name);
            if (base.equals("minecraft:water")) face.addProperty("tintindex", 0);
            sides.add(name, face);
        }
        element.add("faces", sides);
        var geometry = new JsonArray();
        geometry.add(element);
        models.add(key, geometry);
        textures.add(texture);
        var placement = new JsonObject();
        placement.addProperty("model", key);
        parts.add(placement);
    }

    static String resource(String id) {
        String identified = id.contains(":") ? id : "minecraft:" + id;
        if (!identified.matches("[a-z0-9_.-]+:[a-z0-9_.-]+(?:/[a-z0-9_.-]+)*")) return null;
        for (String part : identified.substring(identified.indexOf(':') + 1).split("/")) {
            if (part.equals(".") || part.equals("..")) return null;
        }
        return identified;
    }

    static String path(String id, String type, String ext) {
        int divider = id.indexOf(':');
        return "assets/" + id.substring(0, divider) + "/" + type + "/" + id.substring(divider + 1) + "." + ext;
    }

    static byte[] bytes(ZipFile archive, String path) {
        var entry = archive.getEntry(path);
        if (entry == null || entry.getSize() > 256 * 1024) return null;
        try (var input = archive.getInputStream(entry)) {
            byte[] content = input.readNBytes(256 * 1024 + 1);
            return content.length <= 256 * 1024 ? content : null;
        } catch (IOException error) { return null; }
    }

    private static JsonObject document(ZipFile file, String id, String type) {
        byte[] data = bytes(file, path(id, type, "json"));
        if (data != null) {
            try { return object(JsonFiles.JSON.fromJson(new String(data, StandardCharsets.UTF_8), JsonObject.class)); }
            catch (JsonParseException invalid) { /* Other block data is still usable. */ }
        }
        return new JsonObject();
    }

    static Map<String, String> properties(String text) {
        var result = new HashMap<String, String>();
        for (var part : text.split(",")) {
            String[] halves = part.split("=", 2);
            if (halves.length == 2) result.put(halves[0], halves[1]);
        }
        return result;
    }

    static final class Defaults {
        private final JsonObject blocks;
        private final int version;

        Defaults(String id) throws IOException {
            try (var resource = SchematicAppearance.class.getResourceAsStream("/minecraft-preview-defaults.json")) {
                var data = resource == null ? new JsonObject()
                    : object(JsonFiles.JSON.fromJson(new String(resource.readAllBytes(), StandardCharsets.UTF_8), JsonObject.class));
                blocks = object(data.get("blocks"));
                int[] target = release(id);
                int current = -1;
                var history = array(data.get("versions"));
                if (target != null) for (int i = 0; i < history.size(); i++) {
                    int[] fields = release(history.get(i).getAsString());
                    if (fields != null && java.util.Arrays.compare(fields, target) <= 0) current = i;
                }
                version = current;
            }
        }

        void fill(String identifier, Map<String, String> properties) {
            if (version < 0 || !identifier.startsWith("minecraft:")) return;
            var changes = array(blocks.get(identifier.substring("minecraft:".length())));
            for (var row : changes.asList().reversed()) {
                var change = array(row);
                if (change.size() != 2 || change.get(0).getAsInt() > version) continue;
                if (!change.get(1).isJsonNull()) properties(change.get(1).getAsString()).forEach(properties::putIfAbsent);
                return;
            }
        }

        private static int[] release(String version) {
            try {
                var parts = version.split("-", 2)[0].split("\\.");
                if (parts.length < 2 || parts.length > 3) return null;
                return new int[]{Integer.parseInt(parts[0]), Integer.parseInt(parts[1]),
                    parts.length == 3 ? Integer.parseInt(parts[2]) : 0};
            } catch (NumberFormatException invalid) { return null; }
        }
    }
}
