package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.array;
import static com.keke.kynex.core.LaunchManifest.object;

final class ExternalInstances {
    private static final String HIDDEN = ".kxl-hidden-versions.json";
    private static final Map<String, String> LOADERS = new LinkedHashMap<>();
    static {
        LOADERS.put("net.neoforged:neoforge:", "neoforge");
        LOADERS.put("net.minecraftforge:forge:", "forge");
        LOADERS.put("net.minecraftforge:fmlloader:", "forge");
        LOADERS.put("net.fabricmc:fabric-loader:", "fabric");
        LOADERS.put("org.quiltmc:quilt-loader:", "quilt");
        LOADERS.put("optifine:OptiFine:", "optifine");
    }

    private record Version(JsonObject manifest, String game, Path client) {}
    private ExternalInstances() {}

    static void discover(Path root, Path dataRoot) throws IOException {
        if (root.equals(dataRoot)) return;
        Path versions = GameFiles.target(root, "versions");
        if (!Files.isDirectory(versions, LinkOption.NOFOLLOW_LINKS)) return;
        JsonArray hidden = hidden(root);
        var existing = new LinkedHashMap<String, Path>();
        Path instances = GameFiles.target(root, "instances");
        if (Files.isDirectory(instances, LinkOption.NOFOLLOW_LINKS)) {
            try (var candidates = Files.list(instances)) {
                for (Path candidate : candidates.toList()) {
                    Path file = candidate.resolve("kxl.json");
                    try {
                        if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS) || !file.equals(file.toRealPath())) continue;
                        String name = text(LocalGameFiles.configuration(candidate), "externalVersion", "");
                        if (!name.isEmpty()) existing.putIfAbsent(name, file);
                    } catch (IOException | JsonParseException ignored) { /* Ignore damaged unrelated instance receipts. */ }
                }
            }
        }
        try (var found = Files.list(versions)) {
            for (Path item : found.sorted().toList()) {
                if (!Files.isDirectory(item, LinkOption.NOFOLLOW_LINKS) || Files.exists(item.resolve(".kxl-internal"))) continue;
                String name = item.getFileName().toString();
                if (hidden.asList().stream().anyMatch(value -> value.isJsonPrimitive() && name.equals(value.getAsString()))) continue;
                Version version;
                try { version = resolve(root, name, new LinkedHashSet<>()); }
                catch (IOException | IllegalArgumentException | JsonParseException unreadable) { continue; }
                if (text(version.manifest(), "mainClass", "").isEmpty()) continue;
                String id = "external-" + sha(root + "\0" + name);
                Path config = existing.get(name);
                if (config == null) config = GameFiles.target(root, "instances/" + id + "/kxl.json");
                if (!Files.exists(config, LinkOption.NOFOLLOW_LINKS)) {
                    var settings = MinecraftInstaller.defaults();
                    settings.addProperty("isolation", "custom");
                    settings.addProperty("gameDirectory", running(root, item).toString());
                    String[] loader = loader(version.manifest());
                    var record = new JsonObject();
                    record.addProperty("id", id);
                    record.addProperty("name", name);
                    record.addProperty("version", version.game());
                    record.addProperty("loader", loader[0]);
                    record.addProperty("loaderVersion", loader[1]);
                    record.addProperty("game", "java");
                    record.addProperty("path", config.getParent().toString());
                    record.addProperty("externalVersion", name);
                    record.addProperty("externalSource", item.toString());
                    record.addProperty("externalClient", version.client() == null ? null : version.client().toString());
                    record.add("settings", settings);
                    JsonFiles.write(config, record);
                }
                Path manifest = GameFiles.target(config.getParent(), "version.json");
                boolean update = true;
                try { update = !JsonFiles.read(manifest).equals(version.manifest()); }
                catch (IOException | JsonParseException missing) { /* Restore the launch manifest from the existing version. */ }
                if (update) JsonFiles.write(manifest, version.manifest());
            }
        }
    }

    static void hide(Path root, JsonObject item) throws IOException {
        String name = text(item, "externalVersion", "");
        if (name.isEmpty()) return;
        JsonArray hidden = hidden(root);
        if (hidden.asList().stream().noneMatch(value -> value.isJsonPrimitive() && name.equals(value.getAsString()))) {
            hidden.add(name);
            JsonFiles.write(GameFiles.target(root, HIDDEN), hidden);
        }
    }

    static JsonArray hidden(Path root) throws IOException {
        Path file = GameFiles.target(root, HIDDEN);
        try { return array(JsonFiles.read(file)); }
        catch (IOException | JsonParseException ignored) { return new JsonArray(); }
    }

    private static Version resolve(Path root, String id, Set<String> used) throws IOException {
        LaunchManifest.safeName(id);
        if (used.size() >= 16 || !used.add(id)) throw new IOException("版本继承关系无效");
        Path dir = root.resolve("versions").resolve(id);
        if (!dir.equals(dir.toRealPath())) throw new IOException("版本文件夹超出所选游戏目录");
        JsonObject overlay = object(JsonFiles.read(GameFiles.target(dir, id + ".json")));
        Path client = GameFiles.target(dir, id + ".jar");
        if (!Files.isRegularFile(client, LinkOption.NOFOLLOW_LINKS)) client = null;
        String parent = text(overlay, "inheritsFrom", "");
        if (parent.isEmpty()) return new Version(overlay, text(overlay, "clientVersion", text(overlay, "id", id)), client);
        Version base = resolve(root, parent, used);
        return new Version(LaunchManifest.merge(base.manifest(), overlay).getAsJsonObject(), base.game(), client == null ? base.client() : client);
    }

    private static String[] loader(JsonObject version) {
        for (var library : array(version.get("libraries"))) {
            String name = text(object(library), "name", "");
            for (var entry : LOADERS.entrySet()) {
                if (name.startsWith(entry.getKey())) {
                    String release = name.substring(entry.getKey().length());
                    if (entry.getValue().equals("forge") && release.contains("-")) release = release.split("-", 2)[1];
                    return new String[]{entry.getValue(), release};
                }
            }
        }
        return new String[]{"vanilla", ""};
    }

    private static Path running(Path root, Path version) throws IOException {
        try {
            Path metadata = GameFiles.target(version, "hmclversion.cfg");
            JsonObject settings = object(JsonFiles.read(metadata));
            String kind = settings.has("gameDirType") && settings.get("gameDirType").isJsonPrimitive()
                ? settings.get("gameDirType").getAsString() : "";
            String custom = text(settings, "runningDirectory", "");
            if (custom.isEmpty() && Set.of("CUSTOM", "2").contains(kind)) custom = text(settings, "gameDir", "");
            if (!custom.isEmpty()) return GameDirectories.folder(custom);
            if (Set.of("ROOT_FOLDER", "0").contains(kind)) return root;
            if (Set.of("VERSION_FOLDER", "1").contains(kind)) return version;
        } catch (IOException | IllegalArgumentException | JsonParseException ignored) { /* Infer the existing directory from its contents. */ }
        return List.of("mods", "saves", "resourcepacks", "schematics", "options.txt").stream()
            .anyMatch(path -> Files.exists(version.resolve(path))) ? version : root;
    }

    private static String sha(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-1").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (NoSuchAlgorithmException unavailable) { throw new IllegalStateException(unavailable); }
    }
}
