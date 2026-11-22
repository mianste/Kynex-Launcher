package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.lang.management.ManagementFactory;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.array;
import static com.keke.kynex.core.LaunchManifest.is;
import static com.keke.kynex.core.LaunchManifest.object;
import static com.keke.kynex.core.WorkshopPlans.json;
import static com.keke.kynex.core.WorkshopPlans.number;

final class WorkshopPerformance {
    private WorkshopPerformance() {}

    static JsonObject hardware() {
        var os = ManagementFactory.getOperatingSystemMXBean();
        long bytes = os instanceof com.sun.management.OperatingSystemMXBean extended ? extended.getTotalMemorySize() : -1;
        String cpu = System.getenv("PROCESSOR_IDENTIFIER");
        return json("logicalCores", os.getAvailableProcessors(), "cpu", cpu, "memoryMb", bytes > 0 ? bytes / 1048576 : null,
            "gpus", List.of(), "note", "硬件信息在本机读取。");
    }

    static JsonObject analyze(Path root, Path dataRoot, Path instance, JsonObject args, ResourceVersions versions, WorkshopPlans plans,
                              MinecraftInstaller.Progress progress) throws IOException, InterruptedException {
        String preset = text(args, "preset", "balanced");
        long memory, render, fps;
        switch (preset) {
            case "low" -> { memory = 2048; render = 6; fps = 60; }
            case "balanced" -> { memory = 4096; render = 10; fps = 144; }
            case "high" -> { memory = 8192; render = 16; fps = 144; }
            default -> throw new IOException("请选择低配、均衡或高配预设");
        }
        var cfg = LocalGameFiles.configuration(instance);
        var hardware = hardware();
        memory = Math.min(memory, Math.clamp(number(hardware, "memoryMb", 16_384) / 2, 512, 65_536));
        String game = required(cfg, "version"), loader = required(cfg, "loader");
        String id = instance.getFileName().toString();
        var rows = new LocalResources().list(root, dataRoot, json("id", id, "kind", "mods"));
        var ids = new HashSet<String>();
        for (var row : rows) for (var value : array(object(row).get("modIds"))) ids.add(value.getAsString());
        var table = WorkshopTemplates.bundled("performance-mods.json");
        var warnings = new ArrayList<String>();
        if (ids.containsAll(Set.of("optifine", "sodium"))) warnings.add("检测到 OptiFine 与 Sodium，请核对兼容性。");
        for (var row : array(table.get("highCost"))) if (ids.contains(text(object(row), "modId", "")))
            warnings.add(text(object(row), "note", ""));
        var mods = new JsonArray();
        long total = 0;
        if (is(args.get("installMods"), true)) for (var raw : array(table.get("candidates"))) {
            GameDownloads.check(progress::stopped);
            var item = object(raw);
            if (!WorkshopPlans.includes(array(item.get("loaders")), loader) || ids.contains(text(item, "modId", ""))
                || array(item.get("incompatible")).asList().stream().anyMatch(value -> ids.contains(value.getAsString()))) continue;
            String slug = required(item, "query");
            try {
                var releases = object(versions.list(root, json("source", "modrinth", "project", slug, "kind", "mods", "game", game, "loader", loader, "paged", true)));
                if (array(releases.get("versions")).isEmpty()) throw new IOException("未找到兼容版本");
                var release = object(array(releases.get("versions")).get(0));
                var candidate = json("source", "modrinth", "projectId", required(release, "projectId"), "versionId", required(release, "id"), "name", slug,
                    "side", "both", "reason", "性能模组兼容候选", "required", true);
                total += plans.resource(candidate, game, loader, "mods", new JsonObject());
                mods.add(candidate);
            } catch (IOException unavailable) { warnings.add(slug + " 没有查到兼容版本，已跳过。"); }
        }
        var current = new JsonObject();
        Path options = GameFiles.target(instance, "options.txt");
        if (Files.isRegularFile(options) && Files.size(options) <= 2 * 1024 * 1024) for (String line : Files.readAllLines(options)) {
            int index = line.indexOf(':');
            if (index > 0 && Set.of("renderDistance", "simulationDistance", "maxFps").contains(line.substring(0, index)))
                current.addProperty(line.substring(0, index), line.substring(index + 1));
        }
        long shaders = 0;
        Path shaderDir = GameFiles.target(instance, "shaderpacks");
        if (Files.isDirectory(shaderDir)) try (var files = Files.list(shaderDir)) { shaders = files.count(); }
        var proposal = json("preset", preset, "memoryMb", memory, "options", json("renderDistance", render,
            "simulationDistance", Math.min(render, 8), "maxFps", fps), "mods", mods, "estimatedDownloadBytes", total);
        return json("hardware", hardware, "current", json("memoryMb", number(object(cfg.get("settings")), "memory", 4096), "options", current,
            "modCount", rows.size(), "shaderCount", shaders), "proposal", proposal, "performanceHash", ResourceHashes.hash(proposal.toString()),
            "warnings", warnings, "note", "报告实际修改和启动耗时。");
    }
}
