package com.keke.kynex.core;

import com.google.gson.JsonObject;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.array;
import static com.keke.kynex.core.LaunchManifest.is;
import static com.keke.kynex.core.LaunchManifest.object;
import static com.keke.kynex.core.WorkshopPlans.json;
import static com.keke.kynex.core.WorkshopPlans.number;

final class WorkshopPackUpdate {
    private static final List<String> ROOTS = List.of("mods", "config", "defaultconfigs", "kubejs", "scripts", "resourcepacks", "shaderpacks", "options.txt");
    private static final long ARCHIVE_LIMIT = 256L * 1024 * 1024;
    private final GameDownloads downloads;
    private final CatalogNetwork network;
    private final ResourceCatalog resources;
    private final ResourceVersions versions;
    private final PackInstaller packs;

    WorkshopPackUpdate(GameDownloads downloads, CatalogNetwork network, ResourceCatalog resources, ResourceVersions versions, PackInstaller packs) {
        this.downloads = downloads;
        this.network = network;
        this.resources = resources;
        this.versions = versions;
        this.packs = packs;
    }

    static boolean managed(String name) {
        String lower = name.toLowerCase(Locale.ROOT);
        return ROOTS.stream().anyMatch(root -> name.equals(root) || name.startsWith(root + "/"))
            && !name.contains(":") && !name.contains("\\") && !name.endsWith(".kxl-agent-backup")
            && List.of(name.split("/", -1)).stream().noneMatch(Set.of(".", "..", "", "saves", "logs", "crash-reports")::contains)
            && List.of(".exe", ".bat", ".ps1", ".cmd", ".dll", ".sh").stream().noneMatch(lower::endsWith);
    }

    static Map<String, String> inventory(Path root) throws IOException {
        var files = new TreeMap<String, String>();
        for (String prefix : ROOTS) for (Path file : WorkshopFileCopy.files(root, prefix)) {
            String name = WorkshopFileCopy.relative(root, file);
            if (!managed(name)) continue;
            if (files.size() >= 20_000) throw new IOException("整合包管理文件超过 20000 个");
            files.put(name, WorkshopSnapshots.hash(file));
        }
        return files;
    }

    private static Map<String, String> baseline(JsonObject cfg) throws IOException {
        var result = new TreeMap<String, String>();
        for (var row : object(cfg.get("packManagedFiles")).entrySet()) {
            String hash = WorkshopPlans.id(row.getValue());
            if (!managed(row.getKey()) || !hash.matches("[a-fA-F0-9]{64}")) throw new IOException("整合包管理文件清单无效");
            result.put(row.getKey(), hash.toLowerCase(Locale.ROOT));
        }
        return result;
    }

    JsonObject check(Path root, Path instance, JsonObject settings, MinecraftInstaller.Progress progress) throws IOException, InterruptedException {
        var cfg = LocalGameFiles.configuration(instance);
        if (!(cfg.get("packSource") instanceof JsonObject origin))
            return json("available", false, "reason", "此实例没有在线整合包来源。");
        var candidate = latest(root, cfg, origin, settings, progress);
        boolean available = !required(candidate, "versionId").equals(WorkshopPlans.id(origin.get("versionId")));
        var base = baseline(cfg);
        var current = inventory(instance);
        var modified = current.keySet().stream().filter(name -> !current.get(name).equals(base.get(name))).toList();
        var incoming = new JsonObject();
        var differences = new JsonObject();
        var warnings = new ArrayList<>(List.of("默认保留用户配置、存档和用户修改的文件。"));
        if (available) {
            Path archive = archive(root, candidate, progress);
            incoming = packs.updateManifest(archive, settings, progress);
            if (!required(cfg, "version").equals(required(incoming, "minecraft")) || !required(cfg, "loader").equals(required(incoming, "loader")))
                throw new IOException("新版需要变更游戏或加载器，请使用跨版本迁移");
            differences = differences(instance, base, current, object(incoming.get("files")), progress);
        }
        if (!(cfg.get("packManagedFiles") instanceof JsonObject)) warnings.add("缺少初始文件清单，应用更新前需要重新导入整合包。");
        var preview = json("available", available, "differences", differences, "downloadBytes", number(incoming, "downloadBytes", 0),
            "current", origin, "candidate", candidate, "preservedUserFiles", modified, "warnings", warnings);
        return json("updateHash", ResourceHashes.hash(preview.toString()), "preview", preview);
    }

    private JsonObject latest(Path root, JsonObject cfg, JsonObject origin, JsonObject settings, MinecraftInstaller.Progress progress)
        throws IOException, InterruptedException {
        String source = required(origin, "provider"), id = WorkshopPlans.id(origin.get("projectId"));
        String game = required(cfg, "version"), loader = required(cfg, "loader");
        if (!Set.of("modrinth", "curseforge").contains(source)) throw new IOException("整合包来源无效");
        GameDownloads.check(progress::stopped);
        var files = object(versions.list(root, json("source", source, "project", id, "kind", "modpacks", "game", game, "paged", true, "loader",
            loader.equals("vanilla") ? "" : loader, "curseforgeKey", text(settings, "curseforgeKey", ""))));
        var release = array(files.get("versions")).asList().stream().map(LaunchManifest::object)
            .filter(row -> "release".equals(text(row, "type", ""))).findFirst().orElseThrow(() -> new IOException("没有找到兼容的正式版整合包"));
        String version = required(release, "id");
        if (!version.matches(source.equals("curseforge") ? "[0-9]{1,18}" : "[A-Za-z0-9_-]{1,120}"))
            throw new IOException("所得整合包版本号无效");
        String url, sha, description, label;
        long size;
        if (source.equals("modrinth")) {
            var meta = object(network.json("https://api.modrinth.com/v2/version/" + version, ""));
            if (!id.equals(required(meta, "project_id"))) throw new IOException("整合包文件不属于项目");
            var resource = ResourceVersions.modrinthFile(meta, "modpacks");
            if (resource == null) throw new IOException("新版缺少 MRPACK 文件");
            url = required(resource, "url");
            sha = required(object(resource.get("hashes")), "sha1");
            size = number(resource, "size", -1);
            description = AssistantService.redact(text(meta, "changelog", ""), "");
            label = text(meta, "version_number", version);
        } else {
            var meta = object(object(resources.curseforge("/mods/" + id + "/files/" + version, Map.of(), settings)).get("data"));
            if (!id.equals(WorkshopPlans.id(meta.get("modId"))) || !version.equals(WorkshopPlans.id(meta.get("id"))) || is(meta.get("isAvailable"), false))
                throw new IOException("整合包文件不属于项目或不可下载");
            url = required(meta, "downloadUrl");
            sha = array(meta.get("hashes")).asList().stream().map(LaunchManifest::object)
                .filter(item -> number(item, "algo", 0) == 1).map(item -> text(item, "value", "")).findFirst().orElse("");
            size = number(meta, "fileLength", -1);
            description = "";
            label = text(meta, "displayName", version);
        }
        if (ResourceCatalog.https(url) == null || !sha.matches("[A-Fa-f0-9]{40}") || size <= 0) throw new IOException("新版整合包文件无法验证");
        return json("provider", source, "projectId", id, "versionId", version, "name", text(origin, "name", text(cfg, "name", "整合包")),
            "versionNumber", label, "notes", description.substring(0, Math.min(10_000, description.length())), "estimatedDownloadBytes", size,
            "archive", json("url", url, "sha1", sha, "size", size));
    }

    private Path archive(Path root, JsonObject candidate, MinecraftInstaller.Progress progress) throws IOException {
        var record = object(candidate.get("archive"));
        long size = number(record, "size", 0);
        if (size <= 0 || size > ARCHIVE_LIMIT) throw new IOException("整合包归档超过 256 MB 预览上限");
        String hash = required(record, "sha1");
        if (!hash.matches("[a-fA-F0-9]{40}")) throw new IOException("整合包归档缺少有效的 SHA-1");
        String suffix = "modrinth".equals(text(candidate, "provider", "")) ? ".mrpack" : ".zip";
        Path archive = GameFiles.target(root, "cache/agent-pack-archives/" + hash + suffix);
        downloads.file(required(record, "url"), false, archive, hash, ARCHIVE_LIMIT, progress::stopped);
        return archive;
    }

    JsonObject apply(Path root, Path dataRoot, Path instance, JsonObject args, JsonObject prefs, String snapshot, String taskId,
                     MinecraftInstaller.Progress progress, WorkshopRepair.Test verify, boolean mirror)
        throws IOException, InterruptedException {
        var review = check(root, instance, prefs, progress);
        if (!required(review, "updateHash").equals(required(args, "updateHash"))) throw new IOException("整合包更新内容已变化，请重新确认");
        var preview = object(review.get("preview"));
        if (!is(preview.get("available"), true)) throw new IOException("没有待更新的整合包版本");
        var candidate = object(preview.get("candidate"));
        var original = LocalGameFiles.configuration(instance);
        if (!(original.get("packManagedFiles") instanceof JsonObject)) throw new IOException("请先重新导入整合包以建立初始文件清单");
        var baseline = baseline(original);
        var install = json("name", "工坊更新暂存 " + taskId, "settings", original.get("settings"), "packSource",
            json("provider", required(candidate, "provider"), "projectId", required(candidate, "projectId"), "versionId", required(candidate, "versionId"),
                "versionNumber", required(candidate, "versionNumber")), "curseforgeKey", text(prefs, "curseforgeKey", ""), "temporaryPackUpdate", taskId);
        var prepared = packs.local(root, archive(root, candidate, progress), install, mirror, progress);
        String stagedId = required(prepared, "id");
        if (stagedId.equals(instance.getFileName().toString())) throw new IOException("暂存实例与源实例重合");
        Path staging = GameFiles.target(root, "instances/" + stagedId);
        try {
            if (!required(original, "version").equals(required(prepared, "version")) || !required(original, "loader").equals(required(prepared, "loader")))
                throw new IOException("新版需要变更游戏或加载器，请使用版本迁移");
            preserveDisabled(instance, staging, baseline);
            var merged = merge(instance, staging, baseline, inventory(staging), progress);
            for (String file : List.of("version.json", "client.jar"))
                replace(GameFiles.target(staging, file), GameFiles.target(instance, file));
            mergeRecords(instance, staging);
            var packSource = object(prepared.get("packSource"));
            packSource.addProperty("name", text(object(original.get("packSource")), "name", required(candidate, "name")));
            original.add("packSource", packSource);
            original.add("loaderVersion", prepared.get("loaderVersion"));
            original.add("packManagedFiles", JsonFiles.JSON.toJsonTree(merged.managed));
            JsonFiles.write(GameFiles.target(instance, "kxl.json"), original);
            verify.run();
            return json("updated", true, "packSource", packSource, "preservedUserFiles", merged.preserved, "warnings", List.of(),
                "rollbackSnapshotId", snapshot, "report", "更新后游戏启动验证通过");
        } catch (IOException | InterruptedException | RuntimeException failure) {
            try { WorkshopSnapshots.restore(root, dataRoot, instance.getFileName().toString(), snapshot); }
            catch (IOException rollback) { failure.addSuppressed(rollback); }
            throw failure;
        } finally {
            if (Files.isDirectory(staging, LinkOption.NOFOLLOW_LINKS)
                && taskId.equals(text(LocalGameFiles.configuration(staging), "temporaryPackUpdate", ""))) GameFiles.removeStaging(staging);
        }
    }

    private static JsonObject differences(Path root, Map<String, String> baseline, Map<String, String> current, JsonObject next,
                                          MinecraftInstaller.Progress progress) throws IOException {
        var files = new TreeMap<String, JsonObject>();
        next.entrySet().forEach(entry -> files.put(entry.getKey(), object(entry.getValue())));
        var added = new ArrayList<String>();
        var changed = new ArrayList<String>();
        var removed = new ArrayList<String>();
        var preserved = new ArrayList<String>();
        for (var row : files.entrySet()) {
            GameDownloads.check(progress::stopped);
            String name = row.getKey(), oldHash = current.get(name);
            if (oldHash == null) { added.add(name); continue; }
            String nextSha = text(row.getValue(), "sha256", "");
            boolean same = !nextSha.isEmpty() ? nextSha.equalsIgnoreCase(oldHash) : GameDownloads.matches(GameFiles.target(root, name),
                required(row.getValue(), "sha1"), progress::stopped);
            if (!same) changed.add(name);
            if (userConfig(name) || !oldHash.equals(baseline.get(name))) preserved.add(name);
        }
        for (var row : current.entrySet()) {
            String name = row.getKey();
            if (!files.containsKey(name)) {
                if (!userConfig(name) && row.getValue().equals(baseline.get(name))) removed.add(name);
                else preserved.add(name);
            }
        }
        return json("added", added, "changed", changed, "removed", removed, "preserved", preserved);
    }

    record Merge(Map<String, String> managed, List<String> preserved) {}

    static Merge merge(Path root, Path stage, Map<String, String> baseline, Map<String, String> next, MinecraftInstaller.Progress progress) throws IOException {
        var tracked = new TreeMap<String, String>();
        var untouched = new ArrayList<String>();
        for (var row : next.entrySet()) {
            GameDownloads.check(progress::stopped);
            String name = row.getKey();
            if (!managed(name)) throw new IOException("更新包含非受管文件");
            Path target = GameFiles.target(root, name), source = GameFiles.target(stage, name);
            if (!row.getValue().equals(WorkshopSnapshots.hash(source))) throw new IOException("更新暂存文件校验失败");
            if (Files.exists(target, LinkOption.NOFOLLOW_LINKS) && (userConfig(name) || !WorkshopSnapshots.hash(target).equals(baseline.get(name)))) {
                untouched.add(name);
                continue;
            }
            replace(source, target);
            tracked.put(name, row.getValue());
        }
        for (var row : baseline.entrySet()) {
            GameDownloads.check(progress::stopped);
            String name = row.getKey();
            if (next.containsKey(name) || userConfig(name)) continue;
            if (!managed(name)) throw new IOException("旧整合包清单包含非受管文件");
            Path target = GameFiles.target(root, name);
            if (Files.isRegularFile(target) && WorkshopSnapshots.hash(target).equals(row.getValue())) Files.delete(target);
            else if (Files.exists(target, LinkOption.NOFOLLOW_LINKS)) untouched.add(name);
        }
        return new Merge(tracked, untouched);
    }

    private static boolean userConfig(String name) { return name.equals("options.txt") || name.startsWith("config/") || name.startsWith("defaultconfigs/"); }

    private static void replace(Path from, Path to) throws IOException {
        Path part = Files.createTempFile(to.getParent(), ".kxl-workshop-update-", ".tmp");
        try {
            Files.copy(from, part, StandardCopyOption.REPLACE_EXISTING);
            Files.move(part, to, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } finally { Files.deleteIfExists(part); }
    }

    private static JsonObject records(Path root) throws IOException {
        Path path = GameFiles.target(root, "installed-projects.json");
        return Files.isRegularFile(path) ? object(JsonFiles.read(path)) : new JsonObject();
    }

    private static void preserveDisabled(Path root, Path stage, Map<String, String> baseline) throws IOException {
        var previous = records(root);
        var incoming = records(stage);
        for (String name : baseline.keySet()) {
            if (!name.startsWith("mods/") || !name.endsWith(".jar") || !Files.isRegularFile(GameFiles.target(root, name + ".disabled"))) continue;
            String filename = name.substring("mods/".length());
            String key = previous.entrySet().stream().filter(row -> Set.of(filename, filename + ".disabled")
                .contains(text(object(row.getValue()), "file", ""))).map(Map.Entry::getKey).findFirst().orElse("");
            var update = object(incoming.get(key));
            String next = text(update, "file", filename);
            Path newFile = GameFiles.target(stage, "mods/" + next);
            if (!Files.isRegularFile(newFile)) throw new IOException("无法确认新版停用模组的对应文件：" + filename);
            Files.move(newFile, GameFiles.target(stage, "mods/" + next + ".disabled"), StandardCopyOption.ATOMIC_MOVE);
            if (!update.isEmpty()) update.addProperty("file", next + ".disabled");
        }
        JsonFiles.write(GameFiles.target(stage, "installed-projects.json"), incoming);
    }

    private static void mergeRecords(Path root, Path stage) throws IOException {
        var all = records(root);
        for (var row : records(stage).entrySet()) {
            String file = text(object(row.getValue()), "file", "");
            if (present(root, file)) all.add(row.getKey(), row.getValue());
        }
        var remove = new ArrayList<String>();
        for (var row : all.entrySet()) if (!present(root, text(object(row.getValue()), "file", ""))) remove.add(row.getKey());
        remove.forEach(all::remove);
        JsonFiles.write(GameFiles.target(root, "installed-projects.json"), all);
    }

    private static boolean present(Path root, String file) throws IOException {
        if (file.isEmpty() || file.contains("/") || file.contains("\\")) return false;
        for (String dir : List.of("mods", "resourcepacks", "shaderpacks"))
            if (Files.isRegularFile(GameFiles.target(root, dir + "/" + file), LinkOption.NOFOLLOW_LINKS)) return true;
        return false;
    }
}
