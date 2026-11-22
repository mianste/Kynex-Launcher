package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.array;
import static com.keke.kynex.core.LaunchManifest.is;
import static com.keke.kynex.core.LaunchManifest.object;
import static com.keke.kynex.core.ResourceCatalog.number;

final class ResourceVersions {
    static final Set<String> KINDS = Set.of("mods", "modpacks", "resourcepacks", "shaderpacks", "datapacks", "worlds");
    private static final String MODRINTH = "https://api.modrinth.com/v2";
    private static final String PIXELMAP = "https://goto.pixelmap.cc/api/open/v1/maps/query/";
    private static final Set<String> SCHEMATIC = Set.of(".schem", ".schematic", ".litematic", ".nbt");
    private static final Map<String, String> LOADERS = Map.of("forge", "1", "fabric", "4", "quilt", "5", "neoforge", "6");
    private static final Set<String> LOADER_NAMES = Set.of("Forge", "Fabric", "Quilt", "NeoForge", "LiteLoader", "Rift",
        "Iris", "OptiFine", "Canvas", "Vanilla");
    private final CatalogNetwork network;
    private final ResourceCatalog catalog;
    private record Cached(JsonElement payload, boolean stale) {}

    ResourceVersions(CatalogNetwork network, ResourceCatalog catalog) {
        this.network = network;
        this.catalog = catalog;
    }

    JsonElement list(Path root, JsonObject request) throws IOException, InterruptedException {
        String kind = text(request, "kind", "mods");
        String source = text(request, "source", "modrinth");
        if (!KINDS.contains(kind)) throw new IOException("资源类型无效");
        if (!Set.of("modrinth", "curseforge", "pixelmap").contains(source)) throw new IOException("资源来源无效");
        boolean paged = is(request.get("paged"), true);
        long position = number(request, "offset", 0);
        if (position < 0 || position > 100000) throw new IOException("版本页码无效");
        int offset = (int) position;
        JsonObject instance = configuration(root, text(request, "id", ""));
        String game = text(instance, "version", "");
        String loader = text(instance, "loader", "");
        String filterGame = text(request, "game", "");
        String filterLoader = text(request, "loader", "");
        if ("pixelmap".equals(source)) return pixelmap(root, request, project(request, false), paged);
        String project = project(request, "curseforge".equals(source));
        var rows = new ArrayList<JsonObject>();
        Long next = null;
        Long total = null;
        boolean stale = false;
        if (source.equals("curseforge")) {
            var parameters = new LinkedHashMap<String, String>();
            parameters.put("pageSize", "50");
            if (!filterGame.isEmpty()) parameters.put("gameVersion", filterGame);
            if (LOADERS.containsKey(filterLoader)) parameters.put("modLoaderType", LOADERS.get(filterLoader));
            String endpoint = "/mods/" + project + "/files";
            long cursor = paged ? offset : 0;
            do {
                parameters.put("index", Long.toString(cursor));
                var response = cached(root, endpoint + parameters + text(request, "curseforgeKey", ""), request,
                    () -> catalog.curseforge(endpoint, parameters, request));
                stale |= response.stale();
                var payload = object(response.payload());
                if (!(payload.get("data") instanceof JsonArray files)) throw new IOException("CurseForge 版本列表响应无效");
                long count = number(object(payload.get("pagination")), "totalCount", -1);
                for (var item : files) {
                    var entry = object(item);
                    String filename = text(entry, "fileName", "");
                    if (!extension(filename, kind) || !entry.has("id") || is(entry.get("isAvailable"), false)
                        || is(entry.get("isServerPack"), true)) continue;
                    rows.add(curseRow(entry, game, loader, kind, is(request.get("webOnly"), true)));
                }
                cursor += files.size();
                next = !files.isEmpty() && (count < 0 ? files.size() == 50 : cursor < count) ? cursor : null;
                total = count < 0 ? null : count;
                if (paged || cursor >= 100000) break;
            } while (next != null);
            rows.sort(newest());
        } else {
            var parameters = new LinkedHashMap<String, String>();
            parameters.put("include_changelog", "false");
            if (!filterGame.isEmpty()) parameters.put("game_versions", JsonFiles.JSON.toJson(List.of(filterGame)));
            String requestedLoader = kind.equals("datapacks") ? "datapack" : filterLoader;
            if (!requestedLoader.isEmpty()) parameters.put("loaders", JsonFiles.JSON.toJson(List.of(requestedLoader)));
            String url = CatalogNetwork.url(MODRINTH + "/project/" + project + "/version", parameters);
            var response = cached(root, url, request, () -> network.json(url, ""));
            stale = response.stale();
            if (!(response.payload() instanceof JsonArray versions)) throw new IOException("Modrinth 版本列表响应无效");
            for (var item : versions) {
                var version = object(item);
                JsonObject file = modrinthFile(version, kind);
                if (file == null) continue;
                var row = common(text(version, "id", ""), text(version, "name", ""), text(version, "version_number", ""),
                    text(version, "date_published", ""), text(version, "version_type", "release"), required(file, "filename"));
                row.addProperty("projectId", text(version, "project_id", project));
                JsonArray games = array(version.get("game_versions"));
                JsonArray loaders = array(version.get("loaders"));
                row.add("gameVersions", games);
                row.add("loaders", loaders);
                row.addProperty("compatible", compatible(kind, game, loader, games, loaders)
                    && (!kind.equals("mods") || !loader.isEmpty()));
                rows.add(row);
            }
            rows.sort(newest());
            if (paged) {
                if (!game.isEmpty() && needsGame(kind)) rows.sort(Comparator.comparing(row -> !is(row.get("compatible"), true)));
                int start = Math.min(offset, rows.size());
                int end = Math.min(start + 40, rows.size());
                total = (long) rows.size();
                next = end < rows.size() ? (long) end : null;
                rows = new ArrayList<>(rows.subList(start, end));
            }
        }
        return response(rows, paged, next, total, stale);
    }

    private JsonElement pixelmap(Path root, JsonObject request, String slug, boolean paged) throws IOException, InterruptedException {
        JsonObject detail = pixelmapDetail(root, request, slug);
        String remote = ResourceCatalog.https(text(detail, "download_url", "").strip());
        if (!is(detail.get("download_allowed"), true) || remote == null) {
            return unavailable(paged, "像素茶艺暂未提供地图文件，可查看作者原帖。");
        }
        var uri = URI.create(remote);
        if (uri.getPort() != -1) return unavailable(paged, "作者提供的链接需要在原帖打开。");
        String path = uri.getPath();
        if (SCHEMATIC.stream().anyMatch(path.toLowerCase(Locale.ROOT)::endsWith)) {
            JsonElement reply = unavailable(paged, "此作品可从「投影」下载。");
            if (paged) reply.getAsJsonObject().addProperty("schematic", slug);
            return reply;
        }
        JsonObject forwarded = linkedCurseForge(request, uri);
        if (forwarded != null) {
            JsonElement reply = list(root, forwarded);
            for (var release : paged ? array(reply.getAsJsonObject().get("versions")) : reply.getAsJsonArray()) {
                release.getAsJsonObject().addProperty("fileSource", "CurseForge");
            }
            return reply;
        }
        String filename = PublicMapArchive.name(uri);
        if (filename != null && ("oss.pixelmap.cc".equals(uri.getHost()) || !is(detail.get("download_integrated"), true))) {
            var row = common(slug, text(detail, "title", ""), filename, text(detail, "publish_time", ""), "release", filename);
            row.add("gameVersions", array(detail.get("versions")));
            row.add("loaders", new JsonArray());
            row.addProperty("compatible", true);
            return response(List.of(row), paged, null, 1L, false);
        }
        JsonElement reply = unavailable(paged, "在作者提供的下载页保存地图压缩包，再回来导入。");
        if (paged && !is(detail.get("download_integrated"), true)) reply.getAsJsonObject().addProperty("manualDownload", remote);
        return reply;
    }

    JsonObject linkedCurseForge(JsonObject request, URI uri) throws IOException, InterruptedException {
        if (!Set.of("curseforge.com", "www.curseforge.com").contains(uri.getHost())
            || !uri.getPath().matches("/minecraft/worlds/[A-Za-z0-9_-]+/?")) return null;
        String name = uri.getPath().replaceFirst("^/minecraft/worlds/", "").replaceFirst("/$", "");
        var found = object(catalog.curseforge("/mods/search", Map.of("gameId", "432", "classId", "17", "slug", name), request));
        for (var candidate : array(found.get("data"))) {
            var row = object(candidate);
            if (!name.equals(text(row, "slug", "")) || !row.has("id")) continue;
            JsonObject forwarded = request.deepCopy();
            forwarded.addProperty("source", "curseforge");
            forwarded.add("project", row.get("id"));
            forwarded.remove("game");
            forwarded.remove("loader");
            return forwarded;
        }
        return null;
    }

    JsonObject pixelmapDetail(Path root, JsonObject request, String slug) throws IOException, InterruptedException {
        if (!slug.matches("[A-Za-z0-9_-]{1,120}")) throw new IOException("像素茶艺地图标识无效");
        String url = PIXELMAP + slug;
        return object(cached(root, url, request, () -> network.json(url, "")).payload());
    }

    private static JsonElement unavailable(boolean paged, String message) {
        JsonElement output = response(List.of(), paged, null, 0L, false);
        if (paged) output.getAsJsonObject().addProperty("unavailable", message);
        return output;
    }

    static String project(JsonObject request, boolean number) throws IOException {
        JsonElement value = request.get("project");
        String id = value != null && value.isJsonPrimitive() ? value.getAsString() : "";
        if (!(number ? id.matches("[0-9]{1,18}") : id.matches("[A-Za-z0-9_-]{1,120}"))) throw new IOException("项目 ID 无效");
        return id;
    }

    static JsonObject modrinthFile(JsonObject version, String kind) {
        if (kind.equals("datapacks") && !contains(array(version.get("loaders")), "datapack")) return null;
        JsonObject first = null;
        for (var entry : array(version.get("files"))) {
            var file = object(entry);
            String name = text(file, "filename", "");
            if (!extension(name, kind) || kind.equals("modpacks") && !name.toLowerCase(Locale.ROOT).endsWith(".mrpack")) continue;
            if (is(file.get("primary"), true)) return file;
            if (first == null) first = file;
        }
        return first;
    }

    static boolean extension(String filename, String kind) {
        String name = filename.toLowerCase(Locale.ROOT);
        return switch (kind) {
            case "mods" -> name.endsWith(".jar") || name.endsWith(".litemod");
            case "modpacks" -> name.endsWith(".zip") || name.endsWith(".mrpack");
            case "resourcepacks", "shaderpacks", "datapacks" -> name.endsWith(".zip");
            case "worlds" -> name.endsWith(".zip") || name.endsWith(".rar") || name.endsWith(".7z");
            case "schematics" -> name.matches(".*\\.(litematic|schem|schematic|nbt)");
            default -> false;
        };
    }

    static JsonObject configuration(Path root, String id) throws IOException {
        if (id.isEmpty()) return new JsonObject();
        LaunchManifest.safeName(id);
        Path candidate = root.resolve("instances").resolve(id).resolve("kxl.json");
        try {
            Path actual = candidate.toRealPath();
            if (actual.startsWith(root.resolve("instances"))) return object(JsonFiles.read(actual));
        } catch (java.nio.file.NoSuchFileException | JsonParseException ignored) {
            // Compatibility information is unavailable without a usable instance.
        }
        return new JsonObject();
    }

    private static JsonObject curseRow(JsonObject entry, String game, String loader, String kind, boolean webOnly) {
        String name = required(entry, "fileName");
        var row = common(entry.get("id").getAsString(), text(entry, "displayName", name), name,
            text(entry, "fileDate", ""), switch ((int) number(entry, "releaseType", 0)) {
                case 1 -> "release";
                case 2 -> "beta";
                default -> "alpha";
            }, name);
        var games = new JsonArray();
        var loaders = new JsonArray();
        for (var tag : array(entry.get("gameVersions"))) {
            if (!tag.isJsonPrimitive()) continue;
            String label = tag.getAsString();
            if (LOADER_NAMES.contains(label)) loaders.add(label.toLowerCase(Locale.ROOT));
            else games.add(label);
        }
        row.add("gameVersions", games);
        row.add("loaders", loaders);
        row.addProperty("compatible", compatible(kind, game, LOADERS.containsKey(loader) ? loader : "", games, loaders));
        if (kind.equals("worlds") && (webOnly || ResourceCatalog.https(text(entry, "downloadUrl", "")) == null)) {
            row.addProperty("webOnly", true);
            if (webOnly) row.addProperty("webOnlyReason", "作者未开放第三方下载");
        }
        return row;
    }

    private static boolean compatible(String kind, String game, String loader, JsonArray games, JsonArray loaders) {
        return kind.equals("modpacks") || !game.isEmpty() && (!needsGame(kind) || contains(games, game))
            && (!kind.equals("mods") || loader.isEmpty() || contains(loaders, loader));
    }

    private static boolean needsGame(String kind) { return kind.equals("mods") || kind.equals("datapacks"); }

    private static boolean contains(JsonArray items, String sought) {
        return items.asList().stream().anyMatch(item -> item.isJsonPrimitive() && sought.equals(item.getAsString()));
    }

    private static JsonObject common(String id, String title, String number, String date, String type, String filename) {
        var row = new JsonObject();
        row.addProperty("id", id);
        row.addProperty("name", title);
        row.addProperty("number", number);
        row.addProperty("date", date);
        row.addProperty("type", type);
        row.addProperty("filename", filename);
        return row;
    }

    private static Comparator<JsonObject> newest() {
        return Comparator.comparing((JsonObject version) -> text(version, "date", "")).reversed();
    }

    private static JsonElement response(List<JsonObject> versions, boolean paged, Long next, Long total, boolean stale) {
        var list = new JsonArray();
        versions.forEach(list::add);
        if (!paged) return list;
        var response = new JsonObject();
        response.add("versions", list);
        if (next == null) response.add("nextOffset", JsonNull.INSTANCE);
        else response.addProperty("nextOffset", next);
        if (total == null) response.add("total", JsonNull.INSTANCE);
        else response.addProperty("total", total);
        if (stale) response.addProperty("warning", "暂时无法连接下载源，正在显示之前获取的版本。");
        return response;
    }

    @FunctionalInterface
    private interface Fetch { JsonElement get() throws IOException, InterruptedException; }

    private static Cached cached(Path root, String key, JsonObject request, Fetch fetch) throws IOException, InterruptedException {
        String hash;
        try {
            hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(key.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException error) {
            throw new IOException("无法生成版本缓存键", error);
        }
        Path file = GameFiles.target(root, "cache/project-versions/java-" + hash + ".json");
        JsonElement previous = JsonNull.INSTANCE;
        try {
            if (Files.size(file) <= GameDownloads.DOCUMENT_LIMIT) previous = JsonFiles.read(file);
        } catch (IOException | JsonParseException ignored) { /* The source can recreate the cache. */ }
        if (!previous.isJsonNull() && !is(request.get("force"), true)
            && Files.getLastModifiedTime(file).toInstant().plus(Duration.ofMinutes(10)).isAfter(Instant.now())) {
            return new Cached(previous, false);
        }
        try {
            JsonElement fresh = fetch.get();
            try { JsonFiles.write(file, fresh); }
            catch (IOException ignored) { /* Display the current response even when cache writes fail. */ }
            return new Cached(fresh, false);
        } catch (IOException failure) {
            if (previous.isJsonNull()) throw failure;
            return new Cached(previous, true);
        }
    }
}
