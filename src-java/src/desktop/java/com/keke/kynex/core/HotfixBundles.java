package com.keke.kynex.core;

import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.google.gson.JsonPrimitive;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.zip.ZipInputStream;

import static com.keke.kynex.core.DesktopUpdates.fields;
import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.object;

final class HotfixBundles {
    private static final String URL = "https://github.com/mianste/Kynex-Launcher/releases/download/";
    private static final int LIMIT = 30 * 1024 * 1024;
    private static final int FILE_LIMIT = 20 * 1024 * 1024;
    private final Path root;
    private final String version, channel;
    private final ReleaseSignature signature;
    private volatile Bundle active;
    private Bundle previous;
    private long highest;
    private boolean trial;
    private JsonObject candidate;
    private record Bundle(long id, String notes, Map<String, byte[]> entries) {}

    HotfixBundles(Path game, DesktopUpdates updates) throws IOException {
        version = updates.version;
        channel = updates.channel;
        root = GameFiles.target(game, "hotfix/" + version + "/active.json").getParent();
        signature = updates.signature;
        JsonObject pointer = new JsonObject();
        try { pointer = object(JsonFiles.read(root.resolve("active.json"))); }
        catch (IOException | JsonParseException ignored) { /* The application initially uses its bundled UI. */ }
        highest = positive(pointer, "highest");
        if (LaunchManifest.is(pointer.get("trial"), true)) {
            active = load(positive(pointer, "previous"));
            publish(active, null, false, highest);
        } else {
            active = load(positive(pointer, "active"));
            previous = load(positive(pointer, "previous"));
        }
    }

    byte[] asset(String file) {
        Bundle current = active;
        return current == null ? null : current.entries().get(file);
    }

    synchronized JsonObject status() {
        return fields("revision", active == null ? 0 : active.id(), "notes", active == null ? "" : active.notes(),
            "trial", trial, "available", candidate, "canRollback", active != null);
    }

    synchronized JsonPrimitive ready() throws IOException {
        if (trial) publish(active, previous, false, highest);
        return new JsonPrimitive(true);
    }

    synchronized JsonObject check() throws IOException {
        candidate = null;
        URI official = ReleaseDownload.github(URL + "hotfix-" + channel + "/manifest.json");
        IOException last = null;
        boolean unpublished = false;
        for (URI endpoint : ReleaseDownload.locations(official)) {
            try {
                JsonObject value = ReleaseDownload.manifest(endpoint);
                long next = positive(value, "revision");
                if (!channel.equals(text(value, "channel", "")) || !version.equals(text(value, "baseVersion", "")) || next <= highest)
                    return fields("status", "current");
                String url = required(value, "url");
                if (!url.startsWith(URL)) throw new IOException("补丁下载地址无效");
                required(value, "signature");
                candidate = value;
                return fields("status", "available", "patch", candidate);
            } catch (GameDownloads.HttpError missing) {
                unpublished |= missing.status == 404;
                last = missing;
            } catch (IOException invalid) { last = invalid; }
        }
        if (unpublished) return fields("status", "unpublished");
        throw new IOException("补丁源暂不可用", last);
    }

    synchronized JsonObject install() throws IOException {
        if (candidate == null) throw new IOException("请先检查补丁");
        long revision = positive(candidate, "revision");
        if (revision <= highest) throw new IOException("不能重复应用或降级补丁");
        String signed = required(candidate, "signature");
        URI original = ReleaseDownload.github(required(candidate, "url"));
        for (URI source : ReleaseDownload.locations(original)) {
            try (var buffer = new ByteArrayOutputStream()) {
                ReleaseDownload.fetch(source, buffer, LIMIT, 15000, (done, total) -> {});
                byte[] download = buffer.toByteArray();
                Bundle parsed = unpack(download, signed);
                if (parsed.id() != revision) throw new IOException("补丁修订号不匹配");
                JsonFiles.atomicWrite(root.resolve("r" + revision + ".zip"), download);
                JsonFiles.atomicWrite(root.resolve("r" + revision + ".sig"), signed.getBytes(StandardCharsets.UTF_8));
                publish(parsed, active, true, revision);
                candidate = null;
                return fields("applied", true);
            } catch (IOException rejected) { /* Try another download location using the same signature. */ }
        }
        throw new IOException("补丁下载或签名校验失败，未应用补丁");
    }

    synchronized JsonPrimitive rollback() throws IOException {
        publish(previous, null, false, highest);
        return new JsonPrimitive(true);
    }

    private void publish(Bundle next, Bundle old, boolean pending, long newest) throws IOException {
        JsonFiles.write(root.resolve("active.json"), fields("active", next == null ? null : next.id(),
            "previous", old == null ? null : old.id(), "trial", pending, "highest", newest));
        active = next;
        previous = old;
        trial = pending;
        highest = newest;
    }

    private Bundle load(long revision) {
        if (revision <= 0) return null;
        Path zip = root.resolve("r" + revision + ".zip");
        Path sig = root.resolve("r" + revision + ".sig");
        try {
            if (Files.size(zip) > LIMIT || Files.size(sig) > 16_384) return null;
            Bundle data = unpack(Files.readAllBytes(zip), Files.readString(sig));
            return data.id() == revision ? data : null;
        } catch (IOException ignored) { return null; }
    }

    private Bundle unpack(byte[] raw, String marked) throws IOException {
        signature.verify(new ByteArrayInputStream(raw), marked);
        var files = new LinkedHashMap<String, byte[]>();
        int total = 0;
        try (var archive = new ZipInputStream(new ByteArrayInputStream(raw))) {
            for (var row = archive.getNextEntry(); row != null; row = archive.getNextEntry()) {
                if (row.isDirectory()) continue;
                String name = row.getName();
                if (!name.matches("[^\\\\:\\x00]+\\.(html|js|css|json|png|jpg|jpeg|svg|webp|woff2?|ttf|ico|wasm)") || name.startsWith("/"))
                    throw new IOException("补丁包含非法文件路径或文件类型");
                for (String part : name.split("/", -1)) LaunchManifest.safeName(part);
                if (files.size() >= 4096 || row.getSize() > FILE_LIMIT || files.containsKey(name)) throw new IOException("补丁文件过大或重复");
                byte[] bytes = archive.readNBytes(FILE_LIMIT + 1);
                if (bytes.length > FILE_LIMIT || (total += bytes.length) > 100 * 1024 * 1024) throw new IOException("补丁解压体积过大");
                files.put(name, bytes);
            }
        } catch (IllegalArgumentException invalid) { throw new IOException("补丁包含非法文件路径"); }
        byte[] manifest = files.remove("hotfix.json");
        if (manifest == null || manifest.length > 64 * 1024 || !files.containsKey("index.html")
            || files.keySet().stream().noneMatch(name -> name.endsWith(".js"))) throw new IOException("补丁缺少完整的界面资源");
        try {
            JsonObject meta = object(JsonFiles.JSON.fromJson(new String(manifest, StandardCharsets.UTF_8), JsonObject.class));
            long revision = positive(meta, "revision");
            if (positive(meta, "schema") != 1 || revision <= 0 || !version.equals(required(meta, "baseVersion"))
                || !channel.equals(required(meta, "channel"))) throw new IOException("补丁与当前版本或通道不匹配");
            String notes = text(meta, "notes", "小问题修复");
            return new Bundle(revision, notes.substring(0, Math.min(2000, notes.length())), Map.copyOf(files));
        } catch (IllegalArgumentException | JsonParseException invalid) { throw new IOException("补丁元数据无效"); }
    }

    private static long positive(JsonObject obj, String name) { return Math.max(0, ResourceCatalog.number(obj, name, 0)); }
}
