package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.array;
import static com.keke.kynex.core.LaunchManifest.is;
import static com.keke.kynex.core.LaunchManifest.object;
import static com.keke.kynex.core.WorkshopPlans.json;
import static com.keke.kynex.core.WorkshopPlans.number;

final class WorkshopMigration {
    private static final Set<String> LOADERS = Set.of("vanilla", "fabric", "quilt", "forge", "neoforge", "optifine");
    private final MinecraftCatalog catalog;
    private final LoaderCatalog loaders;
    private final ResourceVersions versions;
    private final WorkshopPlans plans;

    WorkshopMigration(MinecraftCatalog catalog, LoaderCatalog loaders, ResourceVersions versions, WorkshopPlans plans) {
        this.catalog = catalog;
        this.loaders = loaders;
        this.versions = versions;
        this.plans = plans;
    }

    JsonObject preview(Path root, Path instance, JsonObject old, JsonObject args, JsonObject settings, MinecraftInstaller.Progress progress)
        throws IOException, InterruptedException {
        var target = target(root, object(args.get("target")), progress);
        var mappings = new JsonArray();
        var unresolved = new ArrayList<String>();
        var known = new HashSet<String>();
        String game = required(target, "minecraft"), loader = required(target, "loader");
        long bytes = 0;
        for (var raw : array(old.get("mods"))) {
            GameDownloads.check(progress::stopped);
            var entry = object(raw);
            String project = required(entry, "projectId"), source = required(entry, "source"), version = required(entry, "versionId"), name = required(entry, "name");
            known.add(name);
            try {
                var candidates = object(versions.list(root, json("source", source, "project", project, "kind", "mods", "game", game, "paged", true,
                    "loader", loader, "curseforgeKey", text(settings, "curseforgeKey", ""))));
                var rows = array(candidates.get("versions"));
                if (rows.isEmpty()) throw new IOException("没有兼容版本");
                String next = required(object(rows.get(0)), "id");
                boolean keep = version.equals(next);
                bytes += plans.resource(json("source", source, "projectId", project, "versionId", next, "name", name), game, loader, "mods", settings);
                mappings.add(json("source", source, "name", name, "oldProjectId", project, "oldVersionId", version, "newProjectId", project,
                    "newVersionId", next, "action", keep ? "keep" : "replace", "reason", "已找到目标版本的兼容发行文件"));
            } catch (IOException unavailable) {
                GameDownloads.check(progress::stopped);
                mappings.add(json("source", source, "name", name, "oldProjectId", project, "oldVersionId", version, "newProjectId", "",
                    "newVersionId", "", "action", "unresolved", "没有找到兼容发行文件"));
                unresolved.add(name);
            }
        }
        Path mods = GameFiles.target(instance, "mods");
        if (Files.isDirectory(mods)) try (var files = Files.list(mods)) {
            for (String name : files.filter(path -> Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)).map(path -> path.getFileName().toString())
                .filter(path -> path.endsWith(".jar")).sorted().limit(200).toList()) {
                if (!known.contains(name)) unresolved.add(name + "（未识别来源的文件）");
            }
        }
        if (bytes > WorkshopPlans.LIMIT) throw new IOException("迁移需要下载超过 2 GB");
        var result = json("sourceInstanceId", instance.getFileName().toString(), "target", target, "mappings", mappings, "unresolved", unresolved,
            "configWarnings", List.of("仅复制可安全读取的文本配置，旧配置可能与新版本不兼容。", "存档默认关闭复制，启用时会先单独备份。"),
            "estimatedDownloadBytes", bytes);
        return json("migrationHash", hash(result), "plan", result, "sourceName", required(old, "name"));
    }

    JsonObject checkedPlan(Path root, Path original, JsonObject sourcePlan, JsonObject args, JsonObject prefs, MinecraftInstaller.Progress progress)
        throws IOException, InterruptedException {
        var request = object(args.get("plan"));
        String id = original.getFileName().toString();
        if (!id.equals(required(request, "sourceInstanceId")) || !hash(request).equals(required(args, "migrationHash")))
            throw new IOException("迁移计划已改变，请重新预览");
        if (!array(request.get("unresolved")).isEmpty() && !is(args.get("allowUnresolved"), true))
            throw new IOException("存在未确认的模组，请先确认未解决项目的处理方式");
        var target = target(root, object(request.get("target")), progress);
        String game = required(target, "minecraft"), loader = required(target, "loader");
        var mappings = array(request.get("mappings"));
        if (mappings.size() > 80 || number(request, "estimatedDownloadBytes", 0) > WorkshopPlans.LIMIT)
            throw new IOException("迁移超过模组数量或下载预算");
        var sources = new java.util.HashMap<String, JsonObject>();
        for (var raw : array(sourcePlan.get("mods"))) {
            var row = object(raw);
            sources.put(required(row, "source") + ":" + required(row, "projectId") + ":" + required(row, "versionId"), row);
        }
        var resources = new JsonArray();
        for (var raw : mappings) {
            var row = object(raw);
            String action = required(row, "action"), source = required(row, "source"), previous = required(row, "oldProjectId");
            if (!Set.of("keep", "replace", "drop", "unresolved").contains(action)) throw new IOException("迁移资源动作无效");
            if (!Set.of("keep", "replace").contains(action)) continue;
            var prior = sources.get(source + ":" + previous + ":" + required(row, "oldVersionId"));
            if (prior == null || !previous.equals(required(row, "newProjectId"))) throw new IOException("迁移资源已改变，请重新预览");
            resources.add(json("source", source, "projectId", previous, "versionId", required(row, "newVersionId"), "name", required(prior, "name"),
                "side", "both", "required", true, "reason", text(row, "reason", "")));
        }
        var next = sourcePlan.deepCopy();
        String oldName = required(sourcePlan, "name");
        next.addProperty("name", oldName.substring(0, Math.min(oldName.length(), Math.max(1, 76 - game.length()))) + " - " + game);
        next.addProperty("minecraft", game);
        next.add("loader", json("type", loader, "version", required(target, "loaderVersion")));
        next.add("mods", resources);
        for (String field : List.of("resourcePacks", "shaders", "configPatches", "notes")) next.add(field, new JsonArray());
        next.addProperty("estimatedDownloadBytes", 0);
        return plans.check(root, next, prefs, progress);
    }

    private JsonObject target(Path root, JsonObject args, MinecraftInstaller.Progress progress) throws IOException, InterruptedException {
        String game = required(args, "minecraft"), loader = required(args, "loader"), release = text(args, "loaderVersion", "");
        if (!LOADERS.contains(loader)) throw new IOException("目标加载器不受支持");
        var version = catalog.version(root, game, false, progress::stopped);
        if (!game.equals(required(version, "id"))) throw new IOException("目标游戏版本不存在");
        if (loader.equals("vanilla")) release = "";
        else {
            var releases = loaders.versions(root, game, loader, false, false);
            if (release.isEmpty() && !releases.isEmpty()) release = releases.get(0).getAsString();
            if (!WorkshopPlans.includes(releases, release)) throw new IOException("目标加载器版本不兼容");
        }
        return json("minecraft", game, "loader", loader, "loaderVersion", release);
    }

    private static String hash(JsonObject value) { return ResourceHashes.hash(sorted(value).toString()); }

    private static JsonElement sorted(JsonElement item) {
        if (item instanceof JsonObject object) {
            var result = new JsonObject();
            for (var value : object.entrySet().stream().sorted(Map.Entry.comparingByKey()).toList()) result.add(value.getKey(), sorted(value.getValue()));
            return result;
        }
        if (item instanceof JsonArray array) {
            var result = new JsonArray();
            for (var value : array) result.add(sorted(value));
            return result;
        }
        return item;
    }
}
