package com.keke.kynex.core;

import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.google.gson.JsonPrimitive;
import java.io.IOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.zip.ZipFile;

import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.array;
import static com.keke.kynex.core.LaunchManifest.object;

final class WorldCovers {
    private static final int LEVEL_LIMIT = 8 * 1024 * 1024;
    private WorldCovers() {}

    static JsonObject lookup(Path root, Path dataRoot, JsonObject query, ResourceCatalog catalog, ResourceVersions versions)
        throws IOException, InterruptedException {
        JsonObject settings = query.deepCopy();
        settings.addProperty("kind", "saves");
        Path saves = LocalGameFiles.resourceDirectory(root, dataRoot, settings);
        settings.addProperty("kind", "map-downloads");
        Path downloads = LocalGameFiles.resourceDirectory(root, dataRoot, settings);
        var found = new JsonObject();
        if (!Files.isDirectory(saves, LinkOption.NOFOLLOW_LINKS)) return found;
        var missing = new ArrayList<Path>();
        for (String name : InstalledArtwork.filenames(query)) {
            Path world = saves.resolve(name);
            if (!Files.isDirectory(world, LinkOption.NOFOLLOW_LINKS) || !world.equals(world.toRealPath())) continue;
            String known = read(dataRoot, world);
            if (known != null) found.addProperty(name, known);
            else if (Files.isRegularFile(world.resolve("level.dat"), LinkOption.NOFOLLOW_LINKS)) missing.add(world);
        }
        if (missing.isEmpty() || !Files.isDirectory(downloads, LinkOption.NOFOLLOW_LINKS) || !downloads.equals(downloads.toRealPath())) return found;
        List<Path> archives;
        try (var paths = Files.list(downloads)) {
            archives = paths.filter(path -> Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)
                && path.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".zip")).limit(250).toList();
        }
        if (archives.isEmpty()) return found;
        for (Path world : missing) {
            String name = world.getFileName().toString();
            var search = new JsonObject();
            search.addProperty("kind", "world");
            search.addProperty("source", "pixelmap");
            search.addProperty("query", name.replaceFirst(" \\([0-9]+\\)$", ""));
            try {
                var hits = array(catalog.search(root, search).get("hits")).asList().stream().map(LaunchManifest::object)
                    .filter(row -> title(name).equals(title(text(row, "title", "")))).toList();
                if (hits.size() != 1) continue;
                String id = text(hits.getFirst(), "project_id", "");
                if (!id.matches("[A-Za-z0-9_-]{1,120}")) continue;
                JsonObject detail = versions.pixelmapDetail(root, search, id);
                String preview = allowed(text(detail, "preview_image", ""));
                String archive = ResourceCatalog.https(text(detail, "download_url", ""));
                if (preview == null || archive == null || !LaunchManifest.is(detail.get("download_integrated"), true)
                    || !LaunchManifest.is(detail.get("download_allowed"), true)) continue;
                URI url = URI.create(archive);
                if (!"oss.pixelmap.cc".equals(url.getHost()) || !url.getPath().toLowerCase(Locale.ROOT).endsWith(".zip")) continue;
                String base = stem(url.getPath().substring(url.getPath().lastIndexOf('/') + 1));
                for (Path local : archives) {
                    if (base.equalsIgnoreCase(stem(local.getFileName().toString())) && matchingLevel(world, local)) {
                        remember(dataRoot, world, preview);
                        found.addProperty(name, preview);
                        break;
                    }
                }
            } catch (IOException | IllegalArgumentException ignored) { /* An unverified cover stays absent. */ }
        }
        return found;
    }

    static String allowed(String url) {
        if (ResourceCatalog.https(url) == null) return null;
        URI value = URI.create(url);
        if (value.getPort() != -1) return null;
        String path = value.getPath();
        return switch (value.getHost()) {
            case "oss.pixelmap.cc" -> path.startsWith("/pixelmap/covers/") ? url : null;
            case "thingy.top" -> path.startsWith("/view.php/") ? url : null;
            case "img.remit.ee" -> path.startsWith("/api/file/") ? url : null;
            case "s41.ax1x.com" -> path.endsWith(".png") ? url : null;
            default -> value.getHost().endsWith(".forgecdn.net") ? url : null;
        };
    }

    static void remember(Path dataRoot, Path world, String url) {
        if (allowed(url) == null) return;
        try { JsonFiles.write(record(dataRoot, world, world.toString()), new JsonPrimitive(url)); }
        catch (IOException ignored) { /* A cover cache may fail independently of the world install. */ }
    }

    private static String read(Path dataRoot, Path world) {
        var names = new LinkedHashSet<>(List.of(world.toString(), "\\\\?\\" + world));
        for (String path : names) {
            try {
                var value = JsonFiles.read(record(dataRoot, world, path));
                if (value.isJsonPrimitive()) {
                    String url = allowed(value.getAsString());
                    if (url != null) return url;
                }
            } catch (IOException | JsonParseException ignored) { /* The archive fallback can verify a missing cover. */ }
        }
        return null;
    }

    private static Path record(Path dataRoot, Path world, String address) throws IOException {
        Instant created = Files.readAttributes(world, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS).creationTime().toInstant();
        String nanos = String.format(Locale.ROOT, "%09d", created.getNano()).replaceFirst("0+$", "");
        String timestamp = "Some(" + created.getEpochSecond() + (nanos.isEmpty() ? "" : "." + nanos) + "s)";
        return GameFiles.target(dataRoot, "cache/map-world-covers/" + ResourceHashes.hash(address + ":" + timestamp) + ".json");
    }

    private static boolean matchingLevel(Path world, Path archive) throws IOException {
        var levels = new ArrayList<byte[]>();
        for (String name : List.of("level.dat", "level.dat_old")) {
            Path file = world.resolve(name);
            if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS) || Files.size(file) > LEVEL_LIMIT) continue;
            try (var stream = Files.newInputStream(file)) {
                byte[] bytes = stream.readNBytes(LEVEL_LIMIT + 1);
                if (bytes.length > 0 && bytes.length <= LEVEL_LIMIT) levels.add(bytes);
            }
        }
        if (levels.isEmpty()) return false;
        try (var entries = new ZipFile(archive.toFile())) {
            if (entries.size() > 20_000) return false;
            for (var entry : entries.stream().filter(member -> member.getName().replace('\\', '/').matches("(.*/)?level\\.dat"))
                .limit(32).toList()) {
                if (levels.stream().noneMatch(bytes -> bytes.length == entry.getSize())) continue;
                try (var stream = entries.getInputStream(entry)) {
                    byte[] actual = stream.readNBytes(LEVEL_LIMIT + 1);
                    if (levels.stream().anyMatch(bytes -> java.util.Arrays.equals(bytes, actual))) return true;
                }
            }
        }
        return false;
    }

    private static String stem(String name) { return name.replaceFirst("(?i)\\.zip$", "").replaceFirst(" \\([0-9]+\\)$", ""); }
    private static String title(String name) {
        var result = new StringBuilder();
        name.replaceFirst(" \\([0-9]+\\)$", "").toLowerCase(Locale.ROOT).codePoints()
            .filter(Character::isLetterOrDigit).forEach(result::appendCodePoint);
        return result.toString();
    }
}
