package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;

import static com.keke.kynex.core.GameDownloads.check;
import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.array;
import static com.keke.kynex.core.LaunchManifest.is;
import static com.keke.kynex.core.LaunchManifest.object;

final class SchematicCatalog {
    private static final String CATALOG = "/schematic-catalog/";
    private static final Set<String> DOWNLOAD_HOSTS = Set.of("oss.pixelmap.cc", "thingy.top", "github.com", "raw.githubusercontent.com");
    private final GameDownloads downloads;
    private final ResourceCatalog resources;
    private final ResourceVersions versions;
    private record Source(String url, String format) {}

    SchematicCatalog(GameDownloads downloads, ResourceCatalog resources, ResourceVersions versions) {
        this.downloads = downloads;
        this.resources = resources;
        this.versions = versions;
    }

    static Path directory(Path game) throws IOException {
        var settings = new JsonObject();
        try { settings = object(object(JsonFiles.read(game.resolve("config/litematica.json"))).get("Generic")); }
        catch (IOException | JsonParseException ignored) { /* Use the game's default projection folder. */ }
        Path directory = game.resolve("schematics");
        if (is(settings.get("customSchematicBaseDirectoryEnabled"), true)) {
            String selected = text(settings, "customSchematicBaseDirectory", "").strip();
            if (selected.isEmpty()) throw new IOException("请在 Litematica 中设置有效的自定义投影目录");
            directory = game.resolve(selected).toAbsolutePath().normalize();
        }
        if (Files.exists(directory, LinkOption.NOFOLLOW_LINKS)
            && (!Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS) || !directory.toRealPath().equals(directory))) {
            throw new IOException("投影目录必须是实际文件夹");
        }
        return directory;
    }

    static JsonArray list(Path directory) throws IOException {
        var rows = new JsonArray();
        if (!Files.isDirectory(directory)) return rows;
        try (var entries = Files.walk(directory)) {
            for (Path file : entries.sorted().toList()) {
                if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS) || !file.toRealPath().startsWith(directory)
                    || format(file.getFileName().toString()) == null) continue;
                var row = new JsonObject();
                row.addProperty("name", directory.relativize(file).toString().replace(java.io.File.separatorChar, '/'));
                row.addProperty("size", Files.size(file));
                row.addProperty("modified", Files.getLastModifiedTime(file).toMillis());
                row.addProperty("dir", false);
                row.addProperty("enabled", true);
                row.addProperty("directory", directory.toString());
                rows.add(row);
            }
        }
        return rows;
    }

    JsonObject search(Path root, JsonObject query) throws IOException, InterruptedException {
        String selected = text(query, "project", "");
        if (!selected.isEmpty()) {
            var hits = new JsonArray();
            JsonObject entry = candidate(selected, versions.pixelmapDetail(root, query, selected));
            if (entry != null) hits.add(entry);
            return response(hits, false);
        }
        String key = hash((text(query, "query", "") + "\n" + text(query, "game", "")).getBytes(StandardCharsets.UTF_8));
        Path cache = GameFiles.target(root, "cache/schematic-search/" + key + ".json");
        JsonObject saved = new JsonObject();
        try {
            if (Files.size(cache) <= GameDownloads.DOCUMENT_LIMIT) saved = object(JsonFiles.read(cache));
            if (saved.get("hits") instanceof JsonArray savedHits && !savedHits.isEmpty() && !is(query.get("force"), true)
                && Files.getLastModifiedTime(cache).toInstant().plus(Duration.ofMinutes(10)).isAfter(Instant.now())) return saved;
        } catch (IOException | JsonParseException ignored) { /* Query live sources when the cache is unavailable. */ }
        try {
            JsonObject result = collect(root, query);
            if (!is(result.get("partial"), true) && !result.getAsJsonArray("hits").isEmpty()) {
                try { JsonFiles.write(cache, result); } catch (IOException ignored) { /* The current page can still be displayed. */ }
            } else if (saved.get("hits") instanceof JsonArray savedHits && !savedHits.isEmpty()) {
                saved.addProperty("partial", true);
                return saved;
            }
            return result;
        } catch (IOException network) {
            if (!(saved.get("hits") instanceof JsonArray savedHits) || savedHits.isEmpty()) throw network;
            saved.addProperty("partial", true);
            return saved;
        }
    }

    private JsonObject collect(Path root, JsonObject query) throws IOException, InterruptedException {
        JsonObject first = page(root, query, 0);
        int pages = (int) Math.clamp(Math.ceilDiv(ResourceCatalog.number(first, "total", 0), 20), 1, 501);
        boolean partial = false;
        var ids = new LinkedHashSet<String>();
        var hits = new JsonArray();
        try (var pool = Executors.newFixedThreadPool(6); var detailPool = Executors.newFixedThreadPool(16)) {
            var candidatePages = new ArrayList<Future<JsonObject>>();
            for (int i = 1; i < pages; i++) {
                int page = i;
                candidatePages.add(pool.submit(() -> page(root, query, page)));
            }
            var jobs = new ArrayList<Future<JsonObject>>();
            collectIds(first, ids, detailPool, jobs, root, query);
            for (var result : candidatePages) {
                try { collectIds(result.get(), ids, detailPool, jobs, root, query); }
                catch (ExecutionException error) { partial = true; }
            }
            for (var result : jobs) {
                try {
                    JsonObject row = result.get();
                    if (row != null) hits.add(row);
                } catch (ExecutionException error) { partial = true; }
            }
        }
        if (hits.isEmpty() && partial) throw new IOException("暂时无法查询像素茶艺的文件类型，请重试。");
        return response(hits, partial);
    }

    private JsonObject page(Path root, JsonObject query, int offset) throws IOException, InterruptedException {
        JsonObject request = query.deepCopy();
        request.addProperty("kind", "world");
        request.addProperty("source", "pixelmap");
        request.addProperty("page", offset);
        return resources.search(root, request);
    }

    private void collectIds(JsonObject page, Set<String> queries, ExecutorService pool, List<Future<JsonObject>> futures,
                            Path root, JsonObject request) {
        for (var entry : array(page.get("hits"))) {
            var row = object(entry);
            String id = text(row, "slug", "");
            if (id.matches("[A-Za-z0-9_-]{1,120}") && !"closed".equals(text(row, "download_state", "")) && queries.add(id)) {
                futures.add(pool.submit(() -> candidate(id, versions.pixelmapDetail(root, request, id))));
            }
        }
    }

    private static JsonObject candidate(String slug, JsonObject detail) {
        Source source = source(detail);
        String title = text(detail, "title", "");
        if (source == null || title.isBlank()) return null;
        var result = new JsonObject();
        result.addProperty("id", slug);
        result.addProperty("name", title);
        result.addProperty("description", text(detail, "summary", ""));
        result.addProperty("author", text(detail, "author", ""));
        result.addProperty("icon", ResourceCatalog.https(text(detail, "preview_image", "")));
        result.addProperty("page", "https://goto.pixelmap.cc/maps/" + slug);
        result.addProperty("format", source.format());
        return result;
    }

    private static Source source(JsonObject detail) {
        String url = ResourceCatalog.https(text(detail, "download_url", ""));
        if (url == null || !is(detail.get("download_allowed"), true)) return null;
        URI parsed = URI.create(url);
        String format = format(parsed.getPath());
        if (format == null || parsed.getPort() != -1 || !DOWNLOAD_HOSTS.contains(parsed.getHost())) return null;
        return new Source(url, format);
    }

    JsonObject preview(Path root, JsonObject request) throws IOException {
        JsonObject entry = bundled(required(request, "entry"));
        Path cache = GameFiles.target(root, "cache/schematic-catalog/" + required(entry, "fileName"));
        JsonFiles.atomicWrite(cache, builtIn(entry));
        return SchematicPreview.read(cache);
    }

    JsonObject download(Path root, Path dataRoot, JsonObject request, MinecraftInstaller.Progress progress)
        throws IOException, InterruptedException {
        Path directory = destination(root, dataRoot, request);
        String id = required(request, "entry");
        Path temporary = Files.createTempDirectory(directory, ".kxl-schematic-");
        try {
            Path staged = temporary.resolve("project");
            String name;
            if ("pixelmap".equals(text(request, "source", ""))) {
                JsonObject fresh = request.deepCopy();
                fresh.addProperty("force", true);
                var detail = versions.pixelmapDetail(root, fresh, id);
                Source source = source(detail);
                if (source == null) throw new IOException("作者当前没有提供可下载的投影文件");
                String title = text(detail, "title", id).replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").strip().replaceFirst("[. ]+$", "");
                if (title.isEmpty()) title = id;
                if (title.length() > 100) title = title.substring(0, 100).strip();
                name = title.replaceFirst("(?i)\\.(litematic|schem|schematic|nbt)$", "") + "." + source.format();
                progress.update("下载像素茶艺投影", 0, 1);
                downloads.file(source.url(), false, staged, "", GameDownloads.FILE_LIMIT, progress::stopped);
            } else {
                var entry = bundled(id);
                name = required(entry, "fileName");
                Files.write(staged, builtIn(entry));
            }
            SchematicPreview.read(staged);
            check(progress::stopped);
            LaunchManifest.safeName(name);
            Path target = GameFiles.target(directory, name);
            boolean same = Files.exists(target) && Files.mismatch(staged, target) == -1;
            if (!same && Files.exists(target, LinkOption.NOFOLLOW_LINKS)) throw new IOException("同名投影文件已存在");
            if (!same) progress.publish(staged, target);
            var result = item(directory, name);
            result.addProperty("alreadyPresent", same);
            return result;
        } finally {
            GameFiles.removeStaging(temporary);
        }
    }

    static JsonArray importPaths(Path root, Path dataRoot, JsonObject request) throws IOException {
        Path directory = destination(root, dataRoot, request);
        var result = new JsonArray();
        for (var item : array(request.get("paths"))) {
            Path source = Path.of(item.getAsString());
            if (!source.isAbsolute() || !Files.isRegularFile(source) || format(source.getFileName().toString()) == null
                || Files.size(source) > GameDownloads.FILE_LIMIT) throw new IOException("所选投影文件无效");
            String name = source.getFileName().toString();
            LaunchManifest.safeName(name);
            Path target = GameFiles.target(directory, name);
            if (Files.exists(target, LinkOption.NOFOLLOW_LINKS)) throw new IOException("同名投影文件已存在：" + name);
            Path staged = Files.createTempFile(directory, ".kxl-schematic-", ".part");
            try {
                Files.copy(source, staged, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                SchematicPreview.read(staged);
                Files.move(staged, target);
            } finally {
                Files.deleteIfExists(staged);
            }
            result.add(item(directory, name));
        }
        return result;
    }

    private static Path destination(Path root, Path dataRoot, JsonObject request) throws IOException {
        JsonObject scoped = request.deepCopy();
        scoped.addProperty("kind", "schematics");
        return Files.createDirectories(LocalGameFiles.resourceDirectory(root, dataRoot, scoped)).toRealPath();
    }

    private static JsonObject item(Path directory, String name) {
        var result = new JsonObject();
        result.addProperty("name", name);
        result.addProperty("directory", directory.toString());
        return result;
    }

    private static JsonObject response(JsonArray hits, boolean partial) {
        var result = new JsonObject();
        result.add("hits", hits);
        result.addProperty("partial", partial);
        return result;
    }

    private static String format(String name) {
        int index = name.lastIndexOf('.');
        if (index < 0) return null;
        String type = name.substring(index + 1).toLowerCase(Locale.ROOT);
        return Set.of("litematic", "schem", "schematic", "nbt").contains(type) ? type : null;
    }

    private static JsonObject bundled(String name) throws IOException {
        try (var input = SchematicCatalog.class.getResourceAsStream(CATALOG + "index.json")) {
            if (input == null) throw new IOException("内置投影目录缺失");
            var entries = JsonFiles.JSON.fromJson(new String(input.readAllBytes(), StandardCharsets.UTF_8), JsonArray.class);
            for (var item : entries) {
                var entry = object(item);
                if (name.equals(text(entry, "id", ""))) return entry;
            }
        }
        throw new IOException("找不到此内置投影作品");
    }

    private static byte[] builtIn(JsonObject entry) throws IOException {
        String name = required(entry, "fileName");
        LaunchManifest.safeName(name);
        try (var input = SchematicCatalog.class.getResourceAsStream(CATALOG + name)) {
            if (input == null) throw new IOException("内置投影文件缺失");
            byte[] bytes = input.readAllBytes();
            if (!hash(bytes).equals(required(entry, "sha256"))) throw new IOException("内置投影文件校验失败");
            return bytes;
        }
    }

    private static String hash(byte[] bytes) throws IOException {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
        catch (NoSuchAlgorithmException invalid) { throw new IOException("无法校验投影文件", invalid); }
    }
}
