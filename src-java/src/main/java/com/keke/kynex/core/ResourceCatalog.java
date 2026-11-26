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
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorCompletionService;
import java.util.concurrent.Executors;

import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.array;
import static com.keke.kynex.core.LaunchManifest.object;

final class ResourceCatalog {
    private static final String MODRINTH = "https://api.modrinth.com/v2";
    private static final String PIXELMAP = "https://goto.pixelmap.cc/api/open/v1/maps";
    private static final List<String> CURSEFORGE = List.of("https://api.curseforge.com/v1",
        "https://mod.mcimirror.top/curseforge/v1");
    private static final Map<String, String> CLASSES = Map.of("mod", "6", "modpack", "4471", "resourcepack", "12",
        "shader", "6552", "datapack", "6945", "world", "17");
    private static final Map<String, String> LOADERS = Map.of("forge", "1", "fabric", "4", "quilt", "5", "neoforge", "6");
    private final CatalogNetwork network;

    ResourceCatalog(CatalogNetwork network) { this.network = network; }

    JsonObject mapSearch(Path root, JsonObject query) throws IOException, InterruptedException {
        var request = query.deepCopy();
        request.addProperty("kind", "world");
        if (!request.has("source")) request.addProperty("source", "pixelmap");
        JsonObject result = search(root, request);
        var hits = new JsonArray();
        for (JsonElement raw : array(result.get("hits"))) {
            JsonObject item = object(raw).deepCopy();
            String provider = text(item, "source", "");
            if (item.has("project_id")) item.addProperty("id", item.get("project_id").getAsString());
            item.addProperty("sourceLabel", provider.equals("pixelmap") ? "像素茶艺" : "CurseForge");
            item.addProperty("action", text(item, "download_state", "check"));
            if (item.has("page_url")) item.add("pageUrl", item.get("page_url"));
            if (item.has("icon_url")) item.add("iconUrl", item.get("icon_url"));
            if (item.has("description")) item.add("summary", item.get("description"));
            JsonArray gallery = array(item.get("gallery"));
            if (!gallery.isEmpty()) item.add("previewUrl", object(gallery.get(0)).get("url"));
            if (provider.equals("pixelmap") && item.has("downloads")) item.add("views", item.get("downloads"));
            hits.add(item);
        }
        result.add("hits", hits);
        return result;
    }

    JsonObject search(Path root, JsonObject query) throws IOException, InterruptedException {
        String kind = text(query, "kind", "mod");
        String source = text(query, "source", "all");
        long pageValue = number(query, "page", 0);
        if (pageValue < 0 || pageValue > 10000 || !CLASSES.containsKey(kind)) throw new IOException("资源查询条件无效");
        int page = (int) pageValue;
        Path cache = GameFiles.target(root, "cache/resource-search/" + key(query) + ".json");
        if (!LaunchManifest.is(query.get("force"), true)) {
            try {
                if (Files.size(cache) < GameDownloads.DOCUMENT_LIMIT
                    && Files.getLastModifiedTime(cache).toInstant().plus(Duration.ofMinutes(10)).isAfter(Instant.now())) {
                    JsonObject cached = object(JsonFiles.read(cache));
                    if (cached.get("hits") instanceof JsonArray) {
                        cached.addProperty("cached", true);
                        return cached;
                    }
                }
            } catch (IOException | JsonParseException ignored) {
                // Request a new page when the cache is missing or unreadable.
            }
        }
        JsonObject reply;
        if ("all".equals(source)) {
            var pool = Executors.newVirtualThreadPerTaskExecutor();
            try {
                var completion = new ExecutorCompletionService<JsonObject>(pool);
                completion.submit(() -> searchSource(query, kind, kind.equals("world") ? "pixelmap" : "modrinth", page));
                completion.submit(() -> searchSource(query, kind, "curseforge", page));
                var warnings = new ArrayList<String>();
                var hits = new JsonArray();
                long total = 0;
                long deadline = System.nanoTime() + Duration.ofMillis(2500).toNanos();
                int received = 0;
                for (int i = 0; i < 2; i++) {
                    long remaining = deadline - System.nanoTime();
                    var completed = remaining <= 0 ? null : completion.poll(remaining, java.util.concurrent.TimeUnit.NANOSECONDS);
                    if (completed == null) {
                        warnings.add("部分来源响应较慢，已先显示可用结果");
                        break;
                    }
                    received++;
                    try {
                        var result = completed.get();
                        hits.addAll(array(result.get("hits")));
                        total += result.get("total").getAsLong();
                    } catch (ExecutionException error) {
                        warnings.add(error.getCause() instanceof IOException failure
                            ? NetworkFailure.describe(failure) : "来源连接失败");
                    }
                    // A fast empty source should not hide a slower source with results.
                    if (hits.isEmpty()) deadline = Math.max(deadline, System.nanoTime() + Duration.ofMillis(4000).toNanos());
                }
                if (received == 0 && !warnings.isEmpty()) throw new IOException("资源源暂无响应：" + String.join("；", warnings));
                var ranked = new JsonArray();
                hits.asList().stream().sorted(java.util.Comparator.comparingLong(
                    (JsonElement hit) -> number(object(hit), "downloads", 0)).reversed()).limit(30).forEach(ranked::add);
                reply = result(ranked, total, page, 30);
                if (!warnings.isEmpty() && ranked.isEmpty()) reply.addProperty("warning", warnings.getFirst());
            } finally {
                pool.shutdownNow();
            }
        } else {
            try {
                reply = searchSource(query, kind, source, page);
            } catch (IOException unavailable) {
                IOException failure = new IOException(NetworkFailure.describe(unavailable), unavailable);
                if (!LaunchManifest.is(query.get("interactive"), true) || !Files.isRegularFile(cache)
                    || Files.size(cache) >= GameDownloads.DOCUMENT_LIMIT) throw failure;
                try {
                    reply = object(JsonFiles.read(cache));
                } catch (IOException | JsonParseException invalid) { throw failure; }
                if (!(reply.get("hits") instanceof JsonArray)) throw failure;
                reply.addProperty("warning", failure.getMessage() + "。正在显示之前获取的结果。");
                reply.addProperty("cached", true);
            }
        }
        if (!reply.has("warning")) {
            try { JsonFiles.write(cache, reply); }
            catch (IOException ignored) { /* A cache failure still permits displaying the current page. */ }
        }
        return reply;
    }

    private JsonObject searchSource(JsonObject request, String kind, String source, int page)
        throws IOException, InterruptedException {
        String tag = text(request, "tag", "");
        String query = text(request, "query", "").strip();
        String game = text(request, "game", "");
        String loader = text(request, "loader", "");
        boolean interactive = LaunchManifest.is(request.get("interactive"), true);
        boolean force = LaunchManifest.is(request.get("force"), true);
        if (query.length() > 512 || game.length() > 128 || loader.length() > 64 || tag.length() > 128) {
            throw new IOException("资源查询条件过长");
        }
        return switch (source) {
            case "modrinth" -> tag.endsWith("/") || kind.equals("world") ? result(new JsonArray(), 0, page, 30)
                : modrinth(kind, query, game, loader, tag, page, interactive, force);
            case "curseforge" -> tag.startsWith("/") ? result(new JsonArray(), 0, page, 30)
                : curseforge(request, kind, query, game, loader, tag, page);
            case "pixelmap" -> pixelmap(query, game, page, interactive, force);
            default -> throw new IOException("资源来源无效");
        };
    }

    private JsonObject modrinth(String kind, String query, String game, String loader, String tag, int page,
                               boolean interactive, boolean retry) throws IOException {
        var facets = new ArrayList<List<String>>();
        facets.add(List.of("project_type:" + kind));
        if (!game.isEmpty()) facets.add(List.of("versions:" + game));
        if (!loader.isEmpty() && (kind.equals("mod") || kind.equals("modpack"))) facets.add(List.of("categories:" + loader));
        if (tag.contains("/")) facets.add(List.of("categories:" + tag.substring(tag.indexOf('/') + 1)));
        String endpoint = CatalogNetwork.url(MODRINTH + "/search", Map.of("query", query, "index", "downloads",
            "facets", JsonFiles.JSON.toJson(facets), "offset", Integer.toString(page * 30), "limit", "30"));
        var response = object(readSearch(endpoint, "", interactive, retry));
        var hits = new JsonArray();
        for (var item : requireRows(response, "hits", "Modrinth")) {
            var hit = object(item);
            if (!matches(query, hit, "title", "slug", "description")) continue;
            hit.addProperty("source", "modrinth");
            var urls = new LinkedHashSet<String>();
            String featured = https(text(hit, "featured_gallery", ""));
            if (featured != null) urls.add(featured);
            for (var image : array(hit.get("gallery"))) {
                if (!image.isJsonPrimitive()) continue;
                String url = https(image.getAsString());
                if (url != null) urls.add(url);
            }
            var gallery = new JsonArray();
            urls.forEach(url -> gallery.add(gallery(url, null, "")));
            hit.add("gallery", gallery);
            hits.add(hit);
        }
        return result(hits, literal(query) ? hits.size() : number(response, "total_hits", hits.size()), page, 30);
    }

    private JsonObject curseforge(JsonObject request, String kind, String query, String game, String loader, String tag, int page)
        throws IOException, InterruptedException {
        var parameters = new LinkedHashMap<>(Map.of("gameId", "432", "classId", CLASSES.get(kind), "pageSize", "30",
            "index", Integer.toString(page * 30), "sortField", "2", "sortOrder", "desc"));
        if (!query.isEmpty()) parameters.put("searchFilter", query);
        if (!game.isEmpty()) parameters.put("gameVersion", game);
        String category = tag.split("/", 2)[0];
        if (category.matches("[0-9]+")) parameters.put("categoryId", category);
        if (kind.equals("mod") && LOADERS.containsKey(loader)) parameters.put("modLoaderType", LOADERS.get(loader));
        JsonObject reply = object(curseforge("/mods/search", parameters, request));
        var hits = new JsonArray();
        for (var item : requireRows(reply, "data", "CurseForge")) {
            var row = object(item);
            if (!matches(query, row, "name", "slug", "summary") || !row.has("id")) continue;
            var hit = new JsonObject();
            hit.add("project_id", row.get("id"));
            hit.addProperty("project_type", kind);
            hit.addProperty("source", "curseforge");
            hit.addProperty("downloads", number(row, "downloadCount", 0));
            copy(hit, "title", row, "name");
            copy(hit, "description", row, "summary");
            copy(hit, "slug", row, "slug");
            var logo = object(row.get("logo"));
            String thumbnail = https(text(logo, "thumbnailUrl", ""));
            String original = https(text(logo, "url", ""));
            hit.addProperty("icon_url", thumbnail == null ? original : thumbnail);
            if (thumbnail != null && !thumbnail.equals(original)) hit.addProperty("icon_full_url", original);
            var screenshots = new JsonArray();
            for (var image : array(row.get("screenshots"))) {
                var picture = object(image);
                String small = https(text(picture, "thumbnailUrl", ""));
                String full = https(text(picture, "url", ""));
                if (full != null || small != null) screenshots.add(gallery(full == null ? small : full, small, text(picture, "title", "")));
            }
            hit.add("gallery", screenshots);
            if (kind.equals("world")) {
                for (var author : array(row.get("authors"))) {
                    if (copy(hit, "author", object(author), "name")) break;
                }
                hit.addProperty("page_url", https(text(object(row.get("links")), "websiteUrl", "")));
                boolean closed = LaunchManifest.is(row.get("allowModDistribution"), false);
                hit.addProperty("download_state", closed ? "closed" : "check");
                if (closed) hit.addProperty("download_note", "作者暂未向启动器开放文件，请查看原页。");
            }
            hits.add(hit);
        }
        long total = literal(query) ? hits.size() : number(object(reply.get("pagination")), "totalCount", hits.size());
        return result(hits, total, page, 30);
    }

    JsonElement curseforge(String path, Map<String, String> params, JsonObject request) throws IOException, InterruptedException {
        return curseforge(path, params, request, null);
    }

    JsonElement curseforgePost(String path, JsonObject body, JsonObject request) throws IOException, InterruptedException {
        return curseforge(path, Map.of(), request, body);
    }

    private JsonElement curseforge(String path, Map<String, String> params, JsonObject request, JsonObject body)
        throws IOException, InterruptedException {
        boolean interactive = body == null && path.equals("/mods/search") && LaunchManifest.is(request.get("interactive"), true);
        boolean retry = LaunchManifest.is(request.get("force"), true);
        String key = text(request, "curseforgeKey", "").strip();
        if (key.isEmpty()) key = System.getenv().getOrDefault("KYNEX_CURSEFORGE_KEY", "").strip();
        final String officialKey = key;
        var attempts = new ArrayList<Callable<JsonElement>>();
        if (!officialKey.isEmpty()) attempts.add(() -> body == null ? readSearch(CatalogNetwork.url(CURSEFORGE.get(0) + path, params), officialKey, interactive, retry)
            : network.post(CURSEFORGE.get(0) + path, officialKey, body));
        for (String source : CURSEFORGE.subList(1, CURSEFORGE.size())) {
            int delay = attempts.size() * (interactive ? 120 : 350);
            attempts.add(() -> {
                Thread.sleep(delay);
                return body == null ? readSearch(CatalogNetwork.url(source + path, params), "", interactive, retry) : network.post(source + path, "", body);
            });
        }
        var pool = Executors.newVirtualThreadPerTaskExecutor();
        var results = new ExecutorCompletionService<JsonElement>(pool);
        var reasons = new LinkedHashSet<String>();
        try {
            attempts.forEach(results::submit);
            boolean secondary = "all".equals(text(request, "source", "all"));
            long deadline = System.nanoTime() + Duration.ofMillis(retry ? 22000 : secondary ? 6500 : 15000).toNanos();
            for (int i = 0; i < attempts.size(); i++) {
                try {
                    var completed = results.poll(Math.max(0, deadline - System.nanoTime()), java.util.concurrent.TimeUnit.NANOSECONDS);
                    if (completed == null) {
                        reasons.add("等待镜像响应超时");
                        break;
                    }
                    JsonElement value = completed.get();
                    if (value instanceof JsonObject reply && reply.has("data") && !reply.get("data").isJsonNull()
                        && (!path.equals("/mods/search") || reply.get("data").isJsonArray())) return value;
                    reasons.add("来源返回的数据无效");
                } catch (ExecutionException failed) {
                    reasons.add(failed.getCause() instanceof IOException error
                        ? NetworkFailure.describe(error) : "镜像请求失败");
                }
            }
        } finally {
            pool.shutdownNow();
        }
        throw new IOException(String.join("、", reasons));
    }

    private JsonElement readSearch(String endpoint, String key, boolean interactive, boolean retry) throws IOException {
        return interactive ? network.searchJson(endpoint, key, retry) : network.json(endpoint, key);
    }

    private JsonObject pixelmap(String query, String game, int page, boolean interactive, boolean retry) throws IOException {
        var parameters = new LinkedHashMap<>(Map.of("page", Integer.toString(page + 1), "limit", "20", "sort", "trend"));
        if (!query.isEmpty()) parameters.put("keyword", prefix(query, 80));
        if (!game.isEmpty()) parameters.put("version", prefix(game, 32));
        var reply = object(readSearch(CatalogNetwork.url(PIXELMAP + "/search", parameters), "", interactive, retry));
        var hits = new JsonArray();
        for (var item : requireRows(reply, "items", "像素茶艺")) {
            var row = object(item);
            String title = text(row, "title", "").strip();
            String slug = text(row, "slug", "").strip();
            boolean validSlug = slug.matches("[A-Za-z0-9_-]{1,120}");
            boolean allowed = validSlug && LaunchManifest.is(row.get("download_allowed"), true);
            if (title.isEmpty()) continue;
            var categories = array(row.get("categories"));
            if (categories.size() == 1 && "其他".equals(categories.get(0).getAsString())
                && ("XZhongjie_brochure-terra".equals(slug) || slug.startsWith("pixelmap_official_") && !allowed)) continue;
            String url = https(text(row, "url", ""));
            if (url == null || !URI.create(url).getHost().equals("goto.pixelmap.cc")) {
                url = validSlug ? "https://goto.pixelmap.cc/maps/" + slug : null;
            }
            if (url == null) continue;
            var hit = new JsonObject();
            hit.addProperty("project_id", validSlug ? slug : url);
            hit.addProperty("slug", validSlug ? slug : url);
            hit.addProperty("project_type", "world");
            hit.addProperty("source", "pixelmap");
            hit.addProperty("title", title);
            hit.addProperty("page_url", url);
            hit.addProperty("downloads", number(row, "views", 0));
            hit.addProperty("download_state", !allowed ? "closed"
                : LaunchManifest.is(row.get("download_integrated"), true) ? "file" : "check");
            if (!allowed) hit.addProperty("download_note", "像素茶艺暂未提供地图文件，可查看作者原帖。");
            copy(hit, "description", row, "summary");
            copy(hit, "author", row, "author");
            hit.add("versions", array(row.get("versions")));
            hit.add("categories", categories);
            var gallery = new JsonArray();
            String preview = https(text(row, "preview_image", ""));
            if (preview != null) {
                hit.addProperty("icon_url", preview);
                gallery.add(gallery(preview, null, ""));
            }
            hit.add("gallery", gallery);
            hits.add(hit);
        }
        return result(hits, number(reply, "total", hits.size()), page, 20);
    }

    static String https(String address) {
        try {
            URI parsed = URI.create(address);
            if ("https".equals(parsed.getScheme()) && parsed.getHost() != null && parsed.getRawUserInfo() == null) return address;
        } catch (IllegalArgumentException ignored) { /* Invalid URLs are absent from the result. */ }
        return null;
    }

    private static boolean copy(JsonObject target, String key, JsonObject source, String member) {
        String value = text(source, member, "").strip();
        if (value.isEmpty()) return false;
        target.addProperty(key, value);
        return true;
    }

    private static JsonObject gallery(String url, String thumbnail, String title) {
        var result = new JsonObject();
        result.addProperty("url", url);
        if (thumbnail != null && !thumbnail.equals(url)) result.addProperty("thumbnailUrl", thumbnail);
        if (!title.isEmpty()) result.addProperty("title", title);
        return result;
    }

    private static JsonArray requireRows(JsonObject value, String field, String source) throws IOException {
        if (value.get(field) instanceof JsonArray data) return data;
        throw new IOException(source + " 返回了无法识别的搜索结果");
    }

    private static boolean literal(String query) {
        return !query.isEmpty() && query.codePoints().noneMatch(Character::isLetterOrDigit);
    }

    private static boolean matches(String query, JsonObject row, String... fields) {
        if (!literal(query)) return true;
        for (String field : fields) {
            if (text(row, field, "").contains(query)) return true;
        }
        return false;
    }

    private static JsonObject result(JsonArray hits, long total, int page, int size) {
        var result = new JsonObject();
        result.add("hits", hits);
        result.addProperty("total", total);
        result.addProperty("page", page);
        result.addProperty("pageSize", size);
        return result;
    }

    static long number(JsonObject row, String name, long fallback) {
        JsonElement value = row.get(name);
        return value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isNumber() ? value.getAsLong() : fallback;
    }

    private static String prefix(String value, int max) {
        return value.substring(0, value.offsetByCodePoints(0, Math.min(value.codePointCount(0, value.length()), max)));
    }

    private static String key(JsonObject request) throws IOException {
        var value = new JsonObject();
        for (String field : List.of("game", "kind", "loader", "page", "query", "queryPolicy", "source", "tag")) {
            if (field.equals("queryPolicy")) value.addProperty(field, 5);
            else value.add(field, request.has(field) ? request.get(field) : JsonNull.INSTANCE);
        }
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(value.toString().getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException error) {
            throw new IOException("无法生成资源缓存键", error);
        }
    }
}
