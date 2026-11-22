package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.Base64;
import java.util.Locale;
import java.util.Set;

import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;

final class LocalGameFiles {
    private static final Set<String> IMAGE_TYPES = Set.of("image/png", "image/jpeg", "image/webp");
    private static final Set<String> RESOURCE_FOLDERS = Set.of("mods", "resourcepacks", "saves", "shaderpacks",
        "datapacks", "map-downloads", "schematics");

    private LocalGameFiles() {}

    static Path instance(Path root, JsonObject request) throws IOException {
        String id = required(request, "id");
        LaunchManifest.safeName(id);
        Path instances = root.resolve("instances").toRealPath();
        if (!instances.equals(root.resolve("instances"))) throw new IOException("实例目录位于所选游戏目录之外");
        Path directory = instances.resolve(id).toRealPath();
        if (!directory.equals(instances.resolve(id)) || !Files.isDirectory(directory)) {
            throw new IOException("实例不在所选游戏目录中");
        }
        return directory;
    }

    private static Path config(Path directory) throws IOException {
        return GameFiles.target(directory, "kxl.json");
    }

    static JsonObject configuration(Path directory) throws IOException {
        return JsonFiles.read(config(directory)).getAsJsonObject();
    }

    static Path running(Path root, Path dataRoot, JsonObject request) throws IOException {
        if (text(request, "id", "").isEmpty()) return root;
        Path directory = instance(root, request);
        JsonObject settings = JsonFiles.read(config(directory)).getAsJsonObject();
        return InstalledGameLauncher.gameDirectory(root, dataRoot, directory, settings);
    }

    static Path resourceDirectory(Path root, Path dataRoot, JsonObject request) throws IOException {
        String folder = required(request, "kind");
        if (!RESOURCE_FOLDERS.contains(folder)) throw new IOException("资源分类无效");
        Path running = running(root, dataRoot, request);
        String world = text(request, "world", "");
        if (folder.equals("schematics")) return SchematicCatalog.directory(running);
        if (folder.equals("datapacks") && !world.isEmpty()) {
            Path saves = running.resolve("saves").toRealPath();
            Path target = GameFiles.target(saves, world);
            if (!target.getParent().equals(saves) || !savedWorld(target)) throw new IOException("请选择实例里的 Minecraft 存档");
            return GameFiles.target(target, folder);
        }
        return Files.exists(running) ? GameFiles.target(running, folder) : running.resolve(folder);
    }

    static JsonArray worlds(Path root, Path dataRoot, JsonObject request) throws IOException {
        var result = new JsonArray();
        if (text(request, "id", "").isEmpty()) return result;
        Path saves = running(root, dataRoot, request).resolve("saves");
        if (!Files.isDirectory(saves, LinkOption.NOFOLLOW_LINKS)) return result;
        try (var paths = Files.list(saves)) {
            for (var candidate : paths.sorted().toList()) {
                if (!savedWorld(candidate) || !candidate.toRealPath().getParent().equals(saves.toRealPath())) continue;
                var row = new JsonObject();
                row.addProperty("name", candidate.getFileName().toString());
                result.add(row);
            }
        }
        return result;
    }

    private static boolean savedWorld(Path name) {
        return Files.isDirectory(name, LinkOption.NOFOLLOW_LINKS) && (Files.isRegularFile(name.resolve("level.dat"), LinkOption.NOFOLLOW_LINKS)
            || Files.isRegularFile(name.resolve("level.dat_old"), LinkOption.NOFOLLOW_LINKS));
    }

    static JsonObject saveSettings(Path root, JsonObject request) throws IOException {
        Path metadata = config(instance(root, request));
        if (!(request.get("settings") instanceof JsonObject settings)) throw new IOException("实例设置无效");
        settings = settings.deepCopy();
        settings.remove("jvm");
        if ("custom".equals(text(settings, "isolation", ""))) {
            Path custom = GameDirectories.writable(GameDirectories.folder(required(settings, "gameDirectory")));
            settings.addProperty("gameDirectory", custom.toString());
        }
        JsonObject current = JsonFiles.read(metadata).getAsJsonObject();
        current.add("settings", settings);
        JsonFiles.write(metadata, current);
        return current;
    }

    static JsonObject updateMode(Path root, JsonObject request) throws IOException {
        Path metadata = config(instance(root, request));
        JsonObject current = JsonFiles.read(metadata).getAsJsonObject();
        String mode = text(request, "mode", "");
        if (!mode.isEmpty()) {
            if (!Set.of("auto", "manual").contains(mode)) throw new IOException("更新方式无效");
            current.addProperty("modUpdateMode", mode);
            JsonFiles.write(metadata, current);
        }
        var result = new JsonObject();
        result.addProperty("mode", text(current, "modUpdateMode", "manual"));
        return result;
    }

    static JsonObject saveIcon(Path root, JsonObject request) throws IOException {
        String mime = required(request, "mime");
        String encoded = required(request, "base64");
        if (encoded.length() > 3 * 1024 * 1024 || !IMAGE_TYPES.contains(mime)) throw new IOException("实例图标格式或体积无效");
        byte[] image;
        try { image = Base64.getDecoder().decode(encoded); }
        catch (IllegalArgumentException invalid) { throw new IOException("实例图标编码无效", invalid); }
        if (image.length > 2 * 1024 * 1024 || !mime.equals(ArtworkCache.mime(image))) {
            throw new IOException("实例图标文件无效或超过 2 MB");
        }
        Path file = config(instance(root, request));
        JsonObject data = JsonFiles.read(file).getAsJsonObject();
        data.addProperty("icon", "data:" + mime + ";base64," + encoded);
        JsonFiles.write(file, data);
        return data;
    }

    static JsonObject readImage(JsonObject request, boolean screenshot) throws IOException {
        Path path = selected(request);
        long max = (screenshot ? 10 : 5) * 1024L * 1024;
        if (!screenshot) max = Math.min(max, ResourceCatalog.number(request, "maxBytes", max));
        byte[] image = read(path, max, "图片超过允许大小");
        String mime = ArtworkCache.mime(image);
        if (mime == null || !IMAGE_TYPES.contains(mime)) throw new IOException("请选择 PNG、JPEG 或 WebP 图片");
        return payload(screenshot ? "截图" : path.getFileName().toString(), mime, image);
    }

    static JsonObject readAudio(JsonObject request) throws IOException {
        Path path = selected(request);
        String name = path.getFileName().toString();
        String extension = name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        String mime = switch (extension) {
            case "mp3" -> "audio/mpeg";
            case "wav" -> "audio/wav";
            case "ogg", "oga" -> "audio/ogg";
            case "m4a", "mp4" -> "audio/mp4";
            case "aac" -> "audio/aac";
            case "flac" -> "audio/flac";
            default -> throw new IOException("请选择 MP3、WAV、OGG、M4A、AAC 或 FLAC 音乐");
        };
        return payload(name, mime, read(path, 120 * 1024L * 1024, "单个音乐文件不能大于 120 MB"));
    }

    static String readLog(JsonObject request) throws IOException {
        Path path = selected(request);
        byte[] content = read(path, 20 * 1024L * 1024, "日志不能大于 20 MB");
        return java.nio.charset.StandardCharsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(content)).toString();
    }

    private static Path selected(JsonObject request) throws IOException {
        Path path = Path.of(required(request, "path"));
        if (!path.isAbsolute() || path.getFileName() == null || !Files.isRegularFile(path)) {
            throw new IOException("所选文件不存在");
        }
        return path;
    }

    private static byte[] read(Path path, long limit, String message) throws IOException {
        if (limit < 0 || Files.size(path) > limit) throw new IOException(message);
        try (var input = Files.newInputStream(path)) {
            byte[] data = input.readNBytes((int) limit + 1);
            if (data.length > limit) throw new IOException(message);
            return data;
        }
    }

    private static JsonObject payload(String name, String mime, byte[] data) {
        var result = new JsonObject();
        result.addProperty("name", name);
        result.addProperty("mime", mime);
        result.addProperty("base64", Base64.getEncoder().encodeToString(data));
        return result;
    }
}
