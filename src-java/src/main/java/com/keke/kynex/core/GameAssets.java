package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.TreeSet;

import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.is;
import static com.keke.kynex.core.LaunchManifest.object;

final class GameAssets {
    private GameAssets() {}

    static JsonObject plan(Path path) throws IOException {
        JsonObject index = object(JsonFiles.read(path));
        if (!(index.get("objects") instanceof JsonObject objects)) throw new IOException("资源索引无效");
        var hashes = new TreeSet<String>();
        for (var entry : objects.entrySet()) hashes.add(hash(object(entry.getValue())));
        var list = new JsonArray();
        hashes.forEach(list::add);
        var result = new JsonObject();
        result.add("hashes", list);
        if (is(index.get("map_to_resources"), true)) {
            result.addProperty("legacyTarget", "resources");
        } else if (is(index.get("virtual"), true)) {
            result.addProperty("legacyTarget", "virtual");
        }
        if (result.has("legacyTarget")) result.add("objects", objects);
        return result;
    }

    static boolean ready(Path root, Path instance, JsonObject version, LaunchManifest.Platform platform) {
        if (!Files.isRegularFile(instance.resolve("client.jar"))
            || !(version.get("libraries") instanceof JsonArray libraries)) return false;
        try {
            for (var element : libraries) {
                JsonObject library = object(element);
                if (!platform.allows(library)) continue;
                String path;
                if (object(library.get("downloads")).get("artifact") instanceof JsonObject artifact) {
                    path = required(artifact, "path");
                } else if (!(library.get("downloads") instanceof JsonObject)) {
                    path = LaunchManifest.coordinatePath(required(library, "name"));
                } else {
                    continue;
                }
                if (!Files.isRegularFile(safeRelative(root.resolve("libraries"), path))) return false;
            }
            String indexId = text(object(version.get("assetIndex")), "id", "");
            if (indexId.isEmpty()) return true;
            LaunchManifest.safeName(indexId);
            JsonObject index = object(JsonFiles.read(root.resolve("assets/indexes").resolve(indexId + ".json")));
            if (is(index.get("virtual"), true) || is(index.get("map_to_resources"), true)
                || !(index.get("objects") instanceof JsonObject objects)) return false;
            for (var entry : objects.entrySet()) {
                String hash = hash(object(entry.getValue()));
                if (!Files.isRegularFile(root.resolve("assets/objects").resolve(hash.substring(0, 2)).resolve(hash))) {
                    return false;
                }
            }
            return true;
        } catch (IOException | IllegalArgumentException | com.google.gson.JsonParseException invalid) {
            return false;
        }
    }

    static void prepareInstalled(Path root, Path instance, JsonObject version, LaunchManifest.Platform platform) throws IOException {
        if (ready(root, instance, version, platform)) return;
        JsonObject local = version.deepCopy();
        local.remove("assetIndex");
        String id = text(object(version.get("assetIndex")), "id", "");
        if (id.isEmpty() || !ready(root, instance, local, platform)) {
            throw new IOException("当前实例还需要准备游戏文件");
        }
        LaunchManifest.safeName(id);
        JsonObject files = plan(root.resolve("assets/indexes").resolve(id + ".json"));
        Path storage = root.resolve("assets/objects");
        for (var item : files.getAsJsonArray("hashes")) {
            if (!Files.isRegularFile(asset(storage, item.getAsString()))) throw new IOException("当前实例缺少游戏资源");
        }
        String mode = text(files, "legacyTarget", "");
        if (mode.isEmpty()) return;
        Path target = mode.equals("resources") ? instance.resolve("resources") : root.resolve("assets/virtual").resolve(id);
        Path realTarget = Files.createDirectories(target).toRealPath();
        if (!realTarget.startsWith(root.toRealPath())) throw new IOException("游戏资源目录位于所选目录之外");
        for (var item : files.getAsJsonObject("objects").entrySet()) {
            Path path = safeRelative(target, item.getKey());
            if (!Files.exists(path)) {
                Path parent = Files.createDirectories(path.getParent()).toRealPath();
                if (!parent.startsWith(realTarget)) throw new IOException("资源路径不安全");
                try {
                    Files.copy(asset(storage, hash(object(item.getValue()))), path);
                } catch (java.nio.file.FileAlreadyExistsException concurrent) {
                    // A concurrent launch has already populated the asset.
                }
            }
        }
    }

    private static Path asset(Path store, String hash) {
        return store.resolve(hash.substring(0, 2)).resolve(hash);
    }

    private static String hash(JsonObject object) {
        String hash = required(object, "hash");
        if (hash.length() != 40 || !hash.chars().allMatch(ch -> ch >= '0' && ch <= '9'
            || ch >= 'a' && ch <= 'f' || ch >= 'A' && ch <= 'F')) {
            throw new IllegalArgumentException("资源 SHA1 无效");
        }
        return hash;
    }

    private static Path safeRelative(Path root, String path) {
        var relative = Path.of(path);
        if (relative.getRoot() != null || path.startsWith("." + java.io.File.separator)
            || path.startsWith("./")) throw new IllegalArgumentException("资源路径不安全");
        for (Path part : relative) {
            if (part.toString().equals("..")) throw new IllegalArgumentException("资源路径不安全");
        }
        return root.resolve(relative);
    }
}
