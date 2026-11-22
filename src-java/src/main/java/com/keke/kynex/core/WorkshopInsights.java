package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;

import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.array;
import static com.keke.kynex.core.LaunchManifest.is;
import static com.keke.kynex.core.LaunchManifest.object;
import static com.keke.kynex.core.WorkshopPlans.json;
import static com.keke.kynex.core.WorkshopPlans.number;

final class WorkshopInsights {
    private final Path dataRoot;
    private final ModUpdates updates;

    WorkshopInsights(Path dataRoot, ModUpdates updates) {
        this.dataRoot = dataRoot;
        this.updates = updates;
    }

    synchronized JsonArray list(boolean markRead) throws IOException {
        var state = load();
        var rows = new JsonArray();
        for (var raw : array(state.get("items"))) {
            var item = object(raw);
            if (!visible(item)) continue;
            if (markRead) item.addProperty("seen", true);
            rows.add(item);
        }
        if (markRead) store(state);
        return rows;
    }

    synchronized JsonObject dismiss(String key, boolean forever) throws IOException {
        var state = load();
        var item = array(state.get("items")).asList().stream().map(LaunchManifest::object)
            .filter(row -> key.equals(text(row, "key", ""))).findFirst().orElseThrow(() -> new IOException("提醒已不存在"));
        item.addProperty("ignoredForever", forever);
        item.addProperty("ignoredUntil", now() + 7 * 86_400);
        item.addProperty("seen", true);
        store(state);
        return json("dismissed", true);
    }

    synchronized void record(Path root, String id, String log, boolean abnormal) throws IOException {
        var state = load();
        var crashes = object(state.get("crashes"));
        String prefix = rootKey(root) + ":" + id;
        if (!abnormal) {
            for (String key : List.of(prefix, legacyRootKey(root) + ":" + id)) {
                crashes.remove(key);
                array(state.get("items")).asList().removeIf(row -> ("crash:" + key).equals(text(object(row), "key", "")));
            }
        } else {
            String key = signature(log);
            var old = object(crashes.get(prefix));
            int count = key.equals(text(old, "signature", "")) ? (int) number(old, "count", 0) + 1 : 1;
            crashes.add(prefix, json("signature", key, "count", count, "at", now(), "instanceId", id));
        }
        store(state);
    }

    JsonArray check(Path root, boolean force, MinecraftInstaller.Progress progress) throws IOException, InterruptedException {
        String key = rootKey(root), legacy = legacyRootKey(root);
        JsonObject initial;
        synchronized (this) { initial = load(); }
        if (!force && Math.max(number(object(initial.get("checked")), key, 0), number(object(initial.get("checked")), legacy, 0))
            + 6 * 3600 > now()) return list(false);
        var found = new ArrayList<JsonObject>();
        if (Files.getFileStore(root).getUsableSpace() < 5L * 1024 * 1024 * 1024) found.add(json("key", "disk:" + key, "kind", "disk",
            "title", "游戏目录所在磁盘空间偏低", "message", "可用空间不足 5 GB，请检查磁盘空间。"));
        Path instances = GameFiles.target(root, "instances");
        JsonArray runtimes = null;
        if (Files.isDirectory(instances)) try (var folder = Files.list(instances)) {
            for (Path path : folder.filter(row -> Files.isDirectory(row, LinkOption.NOFOLLOW_LINKS)).sorted().limit(100).toList()) {
                GameDownloads.check(progress::stopped);
                if (!path.toRealPath().equals(path) || !Files.isRegularFile(GameFiles.target(path, "kxl.json"), LinkOption.NOFOLLOW_LINKS)) continue;
                var cfg = LocalGameFiles.configuration(path);
                String id = path.getFileName().toString(), item = key + ":" + id;
                var latest = object(object(initial.get("crashes")).get(item));
                var previous = object(object(initial.get("crashes")).get(legacy + ":" + id));
                if (Math.max(number(latest, "count", 0), number(previous, "count", 0)) >= 2) found.add(json("key", "crash:" + item, "kind", "crash",
                    "instanceId", id, "title", AssistantService.redact(text(cfg, "name", "实例"), "") + " 重复出现相同崩溃",
                    "message", "同类崩溃已出现两次以上，可添加日志分析或使用安全模式排查。"));
                String selected = text(object(cfg.get("settings")), "java", "");
                Path meta = GameFiles.target(path, "version.json");
                if (!selected.isEmpty() && Files.isRegularFile(meta) && Files.size(meta) <= GameDownloads.DOCUMENT_LIMIT) {
                    long required = number(object(object(JsonFiles.read(meta)).get("javaVersion")), "majorVersion", 0);
                    if (runtimes == null) runtimes = JavaRuntimes.scan(root, dataRoot);
                    boolean wrong = required > 0 && runtimes.asList().stream().map(LaunchManifest::object).anyMatch(java ->
                        selected.equalsIgnoreCase(text(java, "path", "")) && number(java, "major", required) != required);
                    if (wrong) found.add(json("key", "java:" + item, "kind", "java", "instanceId", id, "title", "手动 Java 与游戏要求不一致",
                        "message", "此实例需要 Java " + required + "，可切换到自动匹配。"));
                }
                if (updates != null) try {
                    long available = updates.check(root, dataRoot, json("id", id)).asList().stream()
                        .filter(row -> "update".equals(text(object(row), "status", ""))).count();
                    if (available > 0) found.add(json("key", "mods:" + item, "kind", "mod_update", "instanceId", id, "title", available + " 个模组存在更新",
                        "message", "可在模组管理中查看兼容版本。"));
                } catch (IOException unavailable) { GameDownloads.check(progress::stopped); }
            }
        }
        synchronized (this) {
            var state = load();
            var rows = array(state.get("items"));
            Set<String> active = found.stream().map(row -> text(row, "key", "")).collect(Collectors.toSet());
            rows.asList().removeIf(row -> {
                var entry = object(row);
                String itemKey = text(entry, "key", "");
                return visible(entry) && (itemKey.contains(key) || itemKey.contains(legacy)) && !active.contains(itemKey)
                    && !text(entry, "kind", "").equals("pack_update");
            });
            for (var entry : found) {
                String itemKey = text(entry, "key", "");
                var old = rows.asList().stream().map(LaunchManifest::object)
                    .filter(row -> itemKey.equals(text(row, "key", "")) || itemKey.replace(key, legacy).equals(text(row, "key", "")))
                    .findFirst().orElse(null);
                if (old != null) {
                    entry.addProperty("ignoredForever", is(old.get("ignoredForever"), true));
                    entry.addProperty("ignoredUntil", number(old, "ignoredUntil", 0));
                    long last = number(old, "notifiedAt", 0);
                    entry.addProperty("seen", last + 86_400 > now() && is(old.get("seen"), true));
                    entry.addProperty("notifiedAt", last + 86_400 > now() ? last : now());
                    rows.remove(old);
                } else {
                    entry.addProperty("seen", false);
                    entry.addProperty("notifiedAt", now());
                }
                rows.add(entry);
            }
            while (rows.size() > 200) rows.remove(0);
            object(state.get("checked")).addProperty(key, now());
            store(state);
            return list(false);
        }
    }

    private static String signature(String log) {
        String details = AssistantService.redact(log, "").lines().filter(line -> line.contains("ERROR") || line.contains("Exception")
            || line.contains("Caused by") || line.contains("OutOfMemory")).limit(6).collect(Collectors.joining("\n"));
        return ResourceHashes.hash(details.replaceAll("\\b[0-9a-fA-F]{8,}\\b|\\d{2}:\\d{2}:\\d{2}", "#"));
    }

    private JsonObject load() throws IOException {
        Path path = GameFiles.target(dataRoot, "agent-insights.json");
        var state = Files.isRegularFile(path) && Files.size(path) <= 2 * 1024 * 1024 ? object(JsonFiles.read(path)) : new JsonObject();
        if (!(state.get("crashes") instanceof JsonObject)) state.add("crashes", new JsonObject());
        if (!(state.get("checked") instanceof JsonObject)) state.add("checked", new JsonObject());
        if (!(state.get("items") instanceof JsonArray)) state.add("items", new JsonArray());
        state.addProperty("version", 1);
        return state;
    }

    private void store(JsonObject state) throws IOException { JsonFiles.write(GameFiles.target(dataRoot, "agent-insights.json"), state); }
    private static boolean visible(JsonObject entry) { return !is(entry.get("ignoredForever"), true) && number(entry, "ignoredUntil", 0) <= now(); }
    private static long now() { return Instant.now().getEpochSecond(); }
    private static String rootKey(Path root) { return ResourceHashes.hash(root.toString().toLowerCase(Locale.ROOT)); }
    private static String legacyRootKey(Path root) { return ResourceHashes.hash(("\\\\?\\" + root).toLowerCase(Locale.ROOT)); }
}
