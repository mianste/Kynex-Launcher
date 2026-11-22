package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.Base64;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.Executors;

import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.array;
import static com.keke.kynex.core.LaunchManifest.is;
import static com.keke.kynex.core.LaunchManifest.object;
import static com.keke.kynex.core.WorkshopPlans.json;

final class PackArtwork {
    private static final List<String> DIRECTORY = List.of("config/fancymenu/assets", "config/bettertitlemenu", "config/custommainmenu");
    private static final int LIMIT = 2 * 1024 * 1024;
    private final Path data;
    private final CatalogNetwork network;
    private final ResourceCatalog resources;

    PackArtwork(Path data, CatalogNetwork network, ResourceCatalog resources) {
        this.data = data;
        this.network = network;
        this.resources = resources;
    }

    JsonArray hydrate(Path root, JsonArray list) throws InterruptedException {
        try (var queue = Executors.newFixedThreadPool(3)) {
            var pending = list.asList().stream().map(LaunchManifest::object).filter(instance -> !hasIcon(instance))
                .map(instance -> queue.submit(() -> {
                    try { hydrate(root, instance); }
                    catch (Exception unavailable) {
                        if (unavailable instanceof InterruptedException) Thread.currentThread().interrupt();
                    }
                })).toList();
            for (var task : pending) try { task.get(); }
            catch (java.util.concurrent.ExecutionException unavailable) { /* Other rows can still load. */ }
        }
        return list;
    }

    private void hydrate(Path root, JsonObject info) throws Exception {
        String id = required(info, "id");
        var runtime = LocalGameFiles.running(root, data, json("id", id));
        String local = local(runtime, info);
        if (!local.isEmpty()) {
            info.addProperty("packIcon", local);
            return;
        }
        var project = object(info.get("packProject"));
        var origin = object(info.get("packSource"));
        if (project.isEmpty() && !origin.isEmpty()) project = json("source", text(origin, "provider", ""), "projectId", WorkshopPlans.id(origin.get("projectId")));
        String icon = text(info, "icon", "");
        if (icon.startsWith("data:image/")) {
            info.addProperty("packIcon", icon);
            return;
        }
        if (project.isEmpty() && is(info.get("modpack"), true)) {
            String name = text(info, "name", "").strip();
            var result = resources.search(root, json("source", "all", "kind", "modpack", "game", text(info, "version", ""), "query", name, "page", 0));
            var match = array(result.get("hits")).asList().stream().map(LaunchManifest::object)
                .filter(row -> name.equalsIgnoreCase(text(row, "title", "").strip())).findFirst().orElseGet(JsonObject::new);
            if (!match.isEmpty()) project = json("source", text(match, "source", ""), "projectId", WorkshopPlans.id(match.get("project_id")),
                "iconUrl", text(match, "icon_url", ""));
        }
        String address = text(project, "iconUrl", icon);
        String provider = text(project, "source", ""), projectId = WorkshopPlans.id(project.get("projectId"));
        if (address.isEmpty() && provider.equals("modrinth") && projectId.matches("[A-Za-z0-9_-]{1,120}"))
            address = text(object(network.json("https://api.modrinth.com/v2/project/" + projectId, "")), "icon_url", "");
        if (address.isEmpty() && provider.equals("curseforge") && projectId.matches("[0-9]{1,18}")) {
            var logo = object(object(object(resources.curseforge("/mods/" + projectId, Map.of(), new JsonObject())).get("data")).get("logo"));
            address = text(logo, "thumbnailUrl", text(logo, "url", ""));
        }
        if (ResourceCatalog.https(address) == null) return;
        String image = text(new ArtworkCache(root).fetch(json("url", address), network), "data", "");
        if (image.isEmpty()) return;
        info.addProperty("packLogo", image);
        if (!project.isEmpty()) info.add("packProject", project);
    }

    static boolean hasIcon(JsonObject row) {
        return !text(row, "packIcon", "").isBlank() || !text(row, "packLogo", "").isBlank();
    }

    static String local(Path game, JsonObject info) throws IOException {
        if (hasIcon(info) || !Files.isDirectory(game, LinkOption.NOFOLLOW_LINKS)) return "";
        String pack = text(info, "name", "").toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
        for (String name : List.of("icon.png", "pack.png", "logo.png")) {
            String image = image(GameFiles.target(game, name));
            if (!image.isEmpty()) return image;
        }
        for (String location : DIRECTORY) {
            Path folder = game.resolve(location);
            if (!Files.isDirectory(folder, LinkOption.NOFOLLOW_LINKS) || !folder.equals(folder.toRealPath())) continue;
            try (var files = Files.find(folder, 3, (path, attributes) -> attributes.isRegularFile() && attributes.size() <= LIMIT)) {
                var names = files.limit(500).sorted(Comparator.comparingInt(file -> rank(file, pack))).toList();
                for (Path file : names) {
                    if (rank(file, pack) > 2) break;
                    String image = image(file);
                    if (!image.isEmpty()) return image;
                }
            }
        }
        return "";
    }

    private static int rank(Path path, String pack) {
        String named = path.getFileName().toString().toLowerCase(Locale.ROOT).replaceFirst("\\.[^.]+$", "").replaceAll("[^a-z0-9]", "");
        if (named.contains("logo") || named.contains("packicon")) return 0;
        if (named.equals("icon") || named.equals("pack") || named.equals("minecraft")) return 1;
        if (named.length() > 3 && (named.equals(pack) || pack.contains(named))) return 2;
        return 3;
    }

    private static String image(Path file) throws IOException {
        if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS) || Files.size(file) > LIMIT || !file.equals(file.toRealPath())) return "";
        byte[] bytes;
        try (var input = Files.newInputStream(file)) { bytes = input.readNBytes(LIMIT + 1); }
        String mime = bytes.length <= LIMIT ? ArtworkCache.mime(bytes) : null;
        return mime == null ? "" : "data:" + mime + ";base64," + Base64.getEncoder().encodeToString(bytes);
    }
}
