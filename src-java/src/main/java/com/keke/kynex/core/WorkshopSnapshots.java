package com.keke.kynex.core;

import com.google.gson.JsonObject;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;

import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.object;
import static com.keke.kynex.core.WorkshopPlans.json;

final class WorkshopSnapshots {
    private static final List<String> CLIENT = List.of("kxl.json", "version.json", "client.jar", "installed-projects.json", "options.txt",
        "config", "defaultconfigs", "kubejs", "scripts", "mods", "resourcepacks", "shaderpacks");
    private static final List<String> SERVER = List.of("server.jar", "kxl-server.json", "server.properties", "eula.txt", "user_jvm_args.txt",
        "start.bat", "start.sh", "config", "defaultconfigs", "mods", "libraries");
    private WorkshopSnapshots() {}

    static String capture(Path root, Path dataRoot, String id) throws IOException {
        return capture(root, dataRoot, id, "instances/" + id);
    }

    static String capture(Path root, Path dataRoot, String id, String relative) throws IOException {
        LaunchManifest.safeName(id);
        List<String> allowed = scope(id, relative);
        Path instance = GameFiles.target(root, relative);
        var files = files(instance, allowed);
        String sid = UUID.randomUUID().toString();
        Path target = GameFiles.target(dataRoot, "snapshots/" + id + "/" + sid + "/manifest.json");
        try {
            long count = 0;
            for (var entry : files.entrySet()) {
                Path source = GameFiles.target(instance, entry.getKey());
                count += Files.size(source);
                if (count > 8 * WorkshopPlans.LIMIT) throw new IOException("快照体积过大，请手动备份");
                Path stored = GameFiles.target(target.getParent(), entry.getKey());
                Files.copy(source, stored);
                if (!hash(stored).equals(entry.getValue())) throw new IOException("创建快照期间文件发生变化");
            }
            JsonFiles.write(target, json("version", 1, "instanceId", id, "sourceRelative", relative, "files", files));
        } catch (IOException failure) {
            try { GameFiles.removeStaging(target.getParent()); }
            catch (IOException cleanup) { failure.addSuppressed(cleanup); }
            throw failure;
        }
        return sid;
    }

    static String restore(Path root, Path dataRoot, String id, String snapshot) throws IOException {
        LaunchManifest.safeName(id);
        UUID.fromString(snapshot);
        Path stored = GameFiles.target(dataRoot, "snapshots/" + id + "/" + snapshot);
        JsonObject metadata = object(JsonFiles.read(GameFiles.target(stored, "manifest.json")));
        if (WorkshopPlans.number(metadata, "version", 0) != 1 || !id.equals(required(metadata, "instanceId"))) throw new IOException("快照不属于此实例");
        String relative = text(metadata, "sourceRelative", "instances/" + id);
        List<String> allowed = scope(id, relative);
        if (!(metadata.get("files") instanceof JsonObject expected) || expected.size() > 20_000) throw new IOException("快照文件清单无效");
        var manifest = new TreeMap<String, String>();
        for (var file : expected.entrySet()) {
            String name = file.getKey();
            if (allowed.stream().noneMatch(dir -> name.equals(dir) || name.startsWith(dir + "/"))) throw new IOException("快照包含非白名单文件");
            String wanted = file.getValue().getAsString();
            if (!wanted.matches("[a-f0-9]{64}") || !hash(GameFiles.target(stored, name)).equals(wanted)) throw new IOException("快照文件校验失败");
            manifest.put(name, wanted);
        }
        String before = capture(root, dataRoot, id, relative);
        Path instance = Files.createDirectories(GameFiles.target(root, relative));
        try { write(instance, stored, manifest, allowed); }
        catch (IOException failure) {
            Path backup = GameFiles.target(dataRoot, "snapshots/" + id + "/" + before);
            var previous = new TreeMap<String, String>();
            object(object(JsonFiles.read(backup.resolve("manifest.json"))).get("files")).entrySet()
                .forEach(entry -> previous.put(entry.getKey(), entry.getValue().getAsString()));
            try { write(instance, backup, previous, allowed); }
            catch (IOException retry) { failure.addSuppressed(retry); }
            throw failure;
        }
        return before;
    }

    private static void write(Path instance, Path snapshot, Map<String, String> desired, List<String> allowed) throws IOException {
        var current = files(instance, allowed);
        for (var entry : desired.entrySet()) {
            String filename = entry.getKey();
            if (entry.getValue().equals(current.get(filename))) continue;
            Path target = GameFiles.target(instance, filename), previous = GameFiles.target(snapshot, filename);
            Path stage = Files.createTempFile(target.getParent(), ".kxl-snapshot-", ".tmp");
            try {
                Files.copy(previous, stage, StandardCopyOption.REPLACE_EXISTING);
                if (!hash(stage).equals(entry.getValue())) throw new IOException("快照文件校验失败");
                Files.move(stage, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } finally { Files.deleteIfExists(stage); }
        }
        for (String extra : current.keySet()) if (!desired.containsKey(extra)) Files.delete(GameFiles.target(instance, extra));
    }

    private static Map<String, String> files(Path instance, List<String> allowed) throws IOException {
        var result = new TreeMap<String, String>();
        if (!Files.isDirectory(instance, LinkOption.NOFOLLOW_LINKS)) return result;
        for (String name : allowed) {
            Path item = GameFiles.target(instance, name);
            if (!Files.exists(item, LinkOption.NOFOLLOW_LINKS)) continue;
            try (var rows = Files.walk(item, 64)) {
                for (Path source : rows.toList()) {
                    if (!source.equals(source.toRealPath())) throw new IOException("快照目录指向其他位置");
                    if (!Files.isRegularFile(source, LinkOption.NOFOLLOW_LINKS)) continue;
                    if (result.size() >= 20_000) throw new IOException("快照文件超过 20000 个，请手动备份");
                    result.put(instance.relativize(source).toString().replace('\\', '/'), hash(source));
                }
            }
        }
        return result;
    }

    private static List<String> scope(String id, String path) throws IOException {
        if (path.equals("instances/" + id)) return CLIENT;
        if (path.matches("server/[0-9a-f-]{36}")) {
            UUID.fromString(path.substring(7));
            return SERVER;
        }
        throw new IOException("快照目标不属于实例或服务端目录");
    }

    static String hash(Path source) throws IOException {
        if (!Files.isRegularFile(source, LinkOption.NOFOLLOW_LINKS)) throw new IOException("快照包含无效文件");
        var digest = ResourceHashes.digest("SHA-256");
        try (var input = new java.security.DigestInputStream(Files.newInputStream(source), digest)) {
            input.transferTo(java.io.OutputStream.nullOutputStream());
        }
        return HexFormat.of().formatHex(digest.digest());
    }
}
