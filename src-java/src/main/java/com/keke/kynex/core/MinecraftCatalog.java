package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.function.BooleanSupplier;

import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.object;

final class MinecraftCatalog {
    private static final String MANIFEST = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
    private final GameDownloads downloads;

    MinecraftCatalog(GameDownloads downloads) { this.downloads = downloads; }

    JsonArray versions(Path root, boolean mirror, boolean refresh, BooleanSupplier stopped) throws IOException {
        Path cached = GameFiles.target(root, "cache/version-manifest.json");
        JsonElement saved = readCached(cached);
        if (!refresh && valid(saved)) return saved.getAsJsonObject().getAsJsonArray("versions");
        try {
            var response = downloads.document(MANIFEST, mirror, "", MinecraftCatalog::valid, stopped);
            JsonFiles.atomicWrite(cached, response.bytes());
            return response.value().getAsJsonObject().getAsJsonArray("versions");
        } catch (IOException failure) {
            GameDownloads.check(stopped);
            if (valid(saved)) return saved.getAsJsonObject().getAsJsonArray("versions");
            throw failure;
        }
    }

    JsonObject version(Path root, String id, boolean mirror, BooleanSupplier stopped) throws IOException {
        LaunchManifest.safeName(id);
        JsonObject entry = find(versions(root, mirror, false, stopped), id);
        if (entry == null) entry = find(versions(root, mirror, true, stopped), id);
        if (entry == null) throw new IOException("版本清单中找不到此版本，请刷新后重试");
        String sha = text(entry, "sha1", "");
        Path cached = GameFiles.target(root, "cache/version-metadata/" + id + ".json");
        Path previous = root.resolve("versions").resolve(id).resolve(id + ".json");
        if (!sha.isEmpty()) {
            for (Path path : new Path[]{cached, previous}) {
                if (!Files.isRegularFile(path) || Files.size(path) > GameDownloads.DOCUMENT_LIMIT
                    || !GameDownloads.matches(path, sha, stopped)) continue;
                JsonElement version = readCached(path);
                if (versionValid(version, id)) return version.getAsJsonObject();
            }
        }
        var response = downloads.document(required(entry, "url"), mirror, sha,
            value -> versionValid(value, id), stopped);
        JsonFiles.atomicWrite(cached, response.bytes());
        return response.value().getAsJsonObject();
    }

    private static JsonObject find(JsonArray versions, String id) {
        for (var row : versions) {
            var entry = object(row);
            if (id.equals(text(entry, "id", ""))) return entry;
        }
        return null;
    }

    private static boolean valid(JsonElement value) {
        return object(value).get("versions") instanceof JsonArray versions && !versions.isEmpty()
            && versions.asList().stream().allMatch(row -> text(object(row), "id", null) != null
                && text(object(row), "url", null) != null);
    }

    private static boolean versionValid(JsonElement value, String id) {
        JsonObject version = object(value);
        return id.equals(text(version, "id", "")) && version.get("libraries") instanceof JsonArray
            && text(version, "mainClass", null) != null;
    }

    private static JsonElement readCached(Path path) {
        try {
            if (Files.size(path) <= GameDownloads.DOCUMENT_LIMIT) return JsonFiles.read(path);
        } catch (IOException | JsonParseException ignored) {
            // A different source can replenish an unreadable cache.
        }
        return null;
    }
}
