package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.UUID;

import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;

public final class GameDirectories {
    private final Path root;
    private final Path config;

    public GameDirectories(Path root) {
        this.root = root;
        this.config = root.resolve("game-directories.json");
    }

    public JsonObject list() throws IOException {
        JsonObject current = config();
        for (JsonElement row : current.getAsJsonArray("items")) {
            var item = row.getAsJsonObject();
            item.addProperty("available", Files.isDirectory(Path.of(text(item, "path", ""))));
        }
        return current;
    }

    Path resolveSelected(String id) throws IOException {
        JsonObject current = config();
        String selected = id == null ? required(current, "activeId") : id;
        JsonObject entry = find(current.getAsJsonArray("items"), selected);
        if (entry == null) throw new IOException("游戏目录未添加，请重新选择");
        Path directory = Path.of(required(entry, "path"));
        if (!Files.isDirectory(directory)) throw new IOException("游戏目录不存在，请连接磁盘或选择其他目录");
        return directory;
    }

    public JsonObject change(String action, JsonObject payload) throws IOException {
        Files.createDirectories(root);
        try (var channel = FileChannel.open(root.resolve("game-directories.lock"), StandardOpenOption.CREATE, StandardOpenOption.WRITE);
             var lock = channel.lock()) {
            JsonObject current = config();
            var entries = current.getAsJsonArray("items");
            switch (action) {
                case "add_game_directory" -> {
                    Path path = folder(required(payload, "path"));
                    if (!Files.isDirectory(path.resolve("versions")) && !Files.isDirectory(path.resolve("instances"))
                            && Files.isDirectory(path.resolve(".minecraft"))) path = path.resolve(".minecraft");
                    path = writable(path);
                    JsonObject item = null;
                    for (JsonElement existing : entries) {
                        var row = existing.getAsJsonObject();
                        if (same(Path.of(text(row, "path", "")), path)) {
                            item = row;
                            break;
                        }
                    }
                    if (item == null) {
                        String name = text(payload, "name", "").strip();
                        if (name.isEmpty()) name = path.getFileName().toString();
                        if (name.codePointCount(0, name.length()) > 60) throw new IOException("目录名称不能超过 60 个字");
                        item = entry(UUID.randomUUID().toString(), name, path);
                        entries.add(item);
                    }
                    current.add("activeId", item.get("id"));
                }
                case "select_game_directory" -> {
                    String id = required(payload, "directoryId");
                    JsonObject entry = find(entries, id);
                    if (entry == null) throw new IOException("游戏目录未添加");
                    if (!Files.isDirectory(Path.of(required(entry, "path")))) {
                        throw new IOException("游戏目录不存在，请连接磁盘或重新选择目录");
                    }
                    current.addProperty("activeId", id);
                }
                case "remove_game_directory" -> {
                    String id = required(payload, "directoryId");
                    if ("default".equals(id)) throw new IOException("默认目录不能移除");
                    entries.asList().removeIf(row -> id.equals(text(row.getAsJsonObject(), "id", "")));
                    if (id.equals(text(current, "activeId", ""))) current.addProperty("activeId", "default");
                }
                default -> throw new IllegalArgumentException("目录操作无效");
            }
            JsonFiles.write(config, current);
            return list();
        }
    }

    private JsonObject config() {
        JsonObject result = new JsonObject();
        try {
            JsonElement stored = JsonFiles.read(config);
            if (stored.isJsonObject()) result = stored.getAsJsonObject();
        } catch (IOException | com.google.gson.JsonParseException ignored) {
            // The original launcher rebuilds its default entry if the file cannot be read.
        }
        var entries = new JsonArray();
        entries.add(entry("default", "默认目录", root));
        if (result.has("items") && result.get("items").isJsonArray()) {
            for (JsonElement item : result.getAsJsonArray("items")) {
                if (item.isJsonObject() && !"default".equals(text(item.getAsJsonObject(), "id", ""))) entries.add(item);
            }
        }
        result.add("items", entries);
        if (find(entries, text(result, "activeId", "")) == null) result.addProperty("activeId", "default");
        return result;
    }

    private static JsonObject find(JsonArray entries, String id) {
        for (JsonElement row : entries) {
            var item = row.getAsJsonObject();
            if (id.equals(text(item, "id", ""))) return item;
        }
        return null;
    }

    private static JsonObject entry(String id, String name, Path path) {
        var item = new JsonObject();
        item.addProperty("id", id);
        item.addProperty("name", name);
        item.addProperty("path", path.toString());
        return item;
    }

    static Path folder(String raw) {
        Path path = Path.of(raw.strip());
        if (!path.isAbsolute() || path.getParent() == null) {
            throw new IllegalArgumentException("请选择完整的文件夹路径，不能使用磁盘根目录或上级目录符号");
        }
        for (Path component : path) {
            if (component.toString().equals("..")) throw new IllegalArgumentException("不能使用上级目录符号");
        }
        if (raw.indexOf(java.io.File.pathSeparatorChar) >= 0) throw new IllegalArgumentException("路径中不能包含 Java 路径分隔符");
        return path;
    }

    static Path writable(Path path) throws IOException {
        try {
            Files.createDirectories(path);
        } catch (IOException error) {
            throw new IOException("无法创建游戏目录：" + error.getMessage(), error);
        }
        Path probe;
        try {
            probe = Files.createTempFile(path, ".kxl-write-", ".tmp");
        } catch (IOException error) {
            throw new IOException("此目录不能写入：" + error.getMessage(), error);
        }
        Files.delete(probe);
        return path;
    }

    private static boolean same(Path a, Path b) {
        try {
            return Files.isSameFile(a, b);
        } catch (IOException ignored) {
            return a.equals(b);
        }
    }
}
