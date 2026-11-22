package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.function.BooleanSupplier;

import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.object;

final class LoaderCatalog {
    private static final Duration CACHE_AGE = Duration.ofHours(1);
    private final GameDownloads downloads;
    private final ForgeInstall forge;

    LoaderCatalog(GameDownloads downloads) {
        this.downloads = downloads;
        this.forge = new ForgeInstall(downloads);
    }

    JsonObject warm(Path root, boolean mirror) throws InterruptedException {
        var work = new java.util.ArrayList<java.util.concurrent.Callable<JsonArray>>();
        for (String loader : java.util.List.of("fabric", "quilt")) {
            for (String type : java.util.List.of("game", "loader")) work.add(() -> list(root, loader, type, mirror, false));
        }
        work.add(() -> forge.versions(root, "1.20.1", "forge", false));
        work.add(() -> forge.versions(root, "1.21.1", "neoforge", false));
        var pool = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor();
        int ready = 0;
        try {
            for (var task : pool.invokeAll(work)) {
                try { task.get(); ready++; }
                catch (java.util.concurrent.ExecutionException ignored) { /* A failed source can retry when its tab opens. */ }
            }
        } finally { pool.shutdownNow(); }
        var result = new JsonObject();
        result.addProperty("ready", ready);
        return result;
    }

    JsonArray versions(Path root, String game, String loader, boolean mirror, boolean refresh) throws IOException {
        LaunchManifest.safeName(game);
        var result = new JsonArray();
        if (loader.equals("vanilla")) return result;
        if (loader.equals("forge") || loader.equals("neoforge")) return forge.versions(root, game, loader, refresh);
        if (loader.equals("optifine")) {
            for (var item : new OptiFineInstall(downloads).versions(root, game, refresh)) {
                result.add(required(item.getAsJsonObject(), "value"));
            }
            return result;
        }
        JsonArray games = list(root, loader, "game", mirror, refresh);
        if (games.asList().stream().noneMatch(row -> game.equals(text(object(row), "version", "")))) return result;
        for (JsonElement release : list(root, loader, "loader", mirror, refresh)) {
            result.add(required(release.getAsJsonObject(), "version"));
        }
        return result;
    }

    JsonObject profile(JsonObject base, String game, String loader, String version, boolean mirror,
                       BooleanSupplier stopped) throws IOException {
        LaunchManifest.safeName(game);
        LaunchManifest.safeName(version);
        String url = api(loader) + "/versions/loader/" + game + "/" + version + "/profile/json";
        var response = downloads.document(url, mirror, "", value -> {
            JsonObject profile = object(value);
            return game.equals(text(profile, "inheritsFrom", "")) && profile.get("libraries") instanceof JsonArray
                && text(profile, "mainClass", null) != null;
        }, stopped);
        var merged = LaunchManifest.merge(base, response.value()).getAsJsonObject();
        merged.add("downloads", base.get("downloads"));
        return merged;
    }

    private JsonArray list(Path root, String loader, String type, boolean mirror, boolean refresh) throws IOException {
        String url = api(loader) + "/versions/" + type;
        Path cache = GameFiles.target(root, "cache/loader-catalogs/" + loader + "-" + type + ".json");
        if (!refresh) {
            try {
                if (Files.size(cache) <= GameDownloads.DOCUMENT_LIMIT
                    && Files.getLastModifiedTime(cache).toInstant().plus(CACHE_AGE).isAfter(Instant.now())) {
                    JsonElement previous = JsonFiles.read(cache);
                    if (valid(previous)) return previous.getAsJsonArray();
                }
            } catch (IOException | JsonParseException ignored) {
                // The source can replace an unavailable cache.
            }
        }
        var response = downloads.document(url, mirror, "", LoaderCatalog::valid, () -> false);
        try {
            JsonFiles.atomicWrite(cache, response.bytes());
        } catch (IOException ignored) {
            // A cache write failure does not invalidate the downloaded catalogue.
        }
        return response.value().getAsJsonArray();
    }

    private static boolean valid(JsonElement value) {
        return value instanceof JsonArray rows && !rows.isEmpty()
            && rows.asList().stream().allMatch(row -> text(object(row), "version", null) != null);
    }

    private static String api(String loader) {
        return switch (loader) {
            case "fabric" -> "https://meta.fabricmc.net/v2";
            case "quilt" -> "https://meta.quiltmc.org/v3";
            default -> throw new IllegalArgumentException("所选加载器尚未接入 Java 安装流程");
        };
    }
}
