package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.google.gson.JsonPrimitive;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;

import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.array;
import static com.keke.kynex.core.LaunchManifest.object;

final class InstalledArtwork {
    private static final String MODRINTH = "https://api.modrinth.com/v2";
    private final CatalogNetwork network;
    private final ResourceCatalog resources;
    private record Probe(String name, ResourceHashes.Value file, Path receipt) {}

    InstalledArtwork(CatalogNetwork network, ResourceCatalog resources) {
        this.network = network;
        this.resources = resources;
    }

    JsonObject lookup(Path root, Path dataRoot, JsonObject request) throws IOException, InterruptedException {
        String kind = required(request, "kind");
        if (!Set.of("mods", "resourcepacks", "shaderpacks", "datapacks").contains(kind)) return new JsonObject();
        Path directory = LocalGameFiles.resourceDirectory(root, dataRoot, request);
        var result = new JsonObject();
        var probes = new ArrayList<Probe>();
        for (String name : filenames(request)) {
            try {
                Path path = GameFiles.target(directory, name);
                var stat = Files.readAttributes(path, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
                if (!stat.isRegularFile() || !path.equals(path.toRealPath())) continue;
                Path receipt = GameFiles.target(root, "cache/resource-artwork/" + ResourceHashes.hash(path + ":"
                    + stat.lastModifiedTime().to(TimeUnit.NANOSECONDS) + ":" + stat.size()) + ".json");
                if (Files.isRegularFile(receipt) && Files.size(receipt) < 12_000) {
                    JsonElement cached = JsonFiles.read(receipt);
                    if (cached.isJsonPrimitive() && logo(cached.getAsString()) != null) {
                        result.add(name, cached);
                        continue;
                    }
                    if (cached.isJsonNull() && Files.getLastModifiedTime(receipt).toInstant().plus(Duration.ofMinutes(20)).isAfter(Instant.now())) continue;
                }
                ResourceHashes.Value hash = ResourceHashes.read(path);
                probes.add(new Probe(name, hash, receipt));
            } catch (IOException | JsonParseException ignored) { /* Files can disappear while the list is open. */ }
        }
        if (probes.isEmpty()) return result;
        Map<String, String> logos = new LinkedHashMap<>();
        boolean complete = true;
        try { logos.putAll(modrinth(probes)); }
        catch (IOException unavailable) { complete = false; }
        var remaining = probes.stream().filter(item -> !logos.containsKey(item.file().sha1())).toList();
        try { if (!remaining.isEmpty()) logos.putAll(curseforge(remaining, request)); }
        catch (IOException unavailable) { complete = false; }
        for (Probe probe : probes) {
            String url = logos.get(probe.file().sha1());
            if (url != null) result.addProperty(probe.name(), url);
            if (url != null || complete) {
                try { JsonFiles.write(probe.receipt(), url == null ? JsonNull.INSTANCE : new JsonPrimitive(url)); }
                catch (IOException ignored) { /* A write failure does not hide downloaded artwork. */ }
            }
        }
        return result;
    }

    private Map<String, String> modrinth(List<Probe> probes) throws IOException {
        var body = new JsonObject();
        body.add("hashes", JsonFiles.JSON.toJsonTree(probes.stream().map(probe -> probe.file().sha1()).distinct().toList()));
        body.addProperty("algorithm", "sha1");
        JsonObject data;
        try { data = object(network.post(MODRINTH + "/version_files", "", body)); }
        catch (IOException primary) { data = object(network.post("https://mod.mcimirror.top/modrinth/v2/version_files", "", body)); }
        var hashes = new LinkedHashMap<String, String>();
        for (Probe probe : probes) {
            String sha = probe.file().sha1();
            JsonObject version = object(data.get(sha));
            String project = text(version, "project_id", "");
            if (project.matches("[A-Za-z0-9]{1,32}") && array(version.get("files")).asList().stream().map(LaunchManifest::object)
                .anyMatch(file -> sha.equalsIgnoreCase(text(object(file.get("hashes")), "sha1", "")))) hashes.put(sha, project);
        }
        if (hashes.isEmpty()) return Map.of();
        var projects = new LinkedHashMap<String, String>();
        String idList = JsonFiles.JSON.toJson(new LinkedHashSet<>(hashes.values()));
        for (var raw : array(network.json(CatalogNetwork.url(MODRINTH + "/projects", Map.of("ids", idList)), ""))) {
            JsonObject project = object(raw);
            String url = logo(text(project, "icon_url", ""));
            if (url != null) projects.put(text(project, "id", ""), url);
        }
        var result = new LinkedHashMap<String, String>();
        hashes.forEach((sha, id) -> { if (projects.containsKey(id)) result.put(sha, projects.get(id)); });
        return result;
    }

    private Map<String, String> curseforge(List<Probe> probes, JsonObject request) throws IOException, InterruptedException {
        var body = new JsonObject();
        body.add("fingerprints", JsonFiles.JSON.toJsonTree(probes.stream().map(probe -> probe.file().fingerprint()).distinct().toList()));
        var response = object(resources.curseforgePost("/fingerprints/432", body, request));
        JsonArray matches = array(object(response.get("data")).get("exactMatches"));
        var hashes = new LinkedHashMap<String, Long>();
        for (Probe probe : probes) {
            String sha = probe.file().sha1();
            var ids = new LinkedHashSet<Long>();
            for (JsonElement item : matches) {
                JsonObject file = object(object(item).get("file"));
                if (probe.file().fingerprint() != ResourceCatalog.number(file, "fileFingerprint", -1)) continue;
                long id = ResourceCatalog.number(file, "modId", 0);
                if (id > 0 && array(file.get("hashes")).asList().stream().map(LaunchManifest::object).anyMatch(hash ->
                    ResourceCatalog.number(hash, "algo", 0) == 1 && sha.equalsIgnoreCase(text(hash, "value", "")))) ids.add(id);
            }
            if (ids.size() == 1) hashes.put(sha, ids.getFirst());
        }
        if (hashes.isEmpty()) return Map.of();
        var ids = new JsonObject();
        ids.add("modIds", JsonFiles.JSON.toJsonTree(new LinkedHashSet<>(hashes.values())));
        var projects = new LinkedHashMap<Long, String>();
        for (JsonElement entry : array(object(resources.curseforgePost("/mods", ids, request)).get("data"))) {
            JsonObject row = object(entry);
            JsonObject image = object(row.get("logo"));
            String url = logo(text(image, "thumbnailUrl", ""));
            if (url == null) url = logo(text(image, "url", ""));
            if (url != null) projects.put(ResourceCatalog.number(row, "id", 0), url);
        }
        var result = new LinkedHashMap<String, String>();
        hashes.forEach((sha, id) -> { if (projects.containsKey(id)) result.put(sha, projects.get(id)); });
        return result;
    }

    static Set<String> filenames(JsonObject request) {
        var names = new LinkedHashSet<String>();
        for (JsonElement entry : array(request.get("names")).asList().stream().limit(24).toList()) {
            if (!entry.isJsonPrimitive() || !entry.getAsJsonPrimitive().isString()) continue;
            String name = entry.getAsString();
            if (!name.isEmpty() && name.length() <= 255 && !name.endsWith(".") && !name.endsWith(" ")
                && name.codePoints().noneMatch(ch -> Character.isISOControl(ch) || "/\\:*?\"<>|".indexOf(ch) >= 0)) names.add(name);
        }
        return names;
    }

    private static String logo(String url) {
        try { CatalogNetwork.imageAddress(url); return url; }
        catch (IOException invalid) { return null; }
    }
}
