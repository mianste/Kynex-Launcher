package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeMap;

import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.array;
import static com.keke.kynex.core.LaunchManifest.object;
import static com.keke.kynex.core.WorkshopPlans.json;
import static com.keke.kynex.core.WorkshopPlans.number;

final class WorkshopTemplates {
    private static final List<String> PACKS = List.of("vanilla-plus", "adventure", "technology", "magic", "skyblock", "building", "horror", "server");
    private static final List<String> CONFIG = List.of("balanced", "low-memory", "sodium-balanced");
    private WorkshopTemplates() {}

    static JsonObject bundled(String name) throws IOException {
        try (var stream = WorkshopTemplates.class.getResourceAsStream("/" + name)) {
            if (stream == null) throw new IOException("缺少工坊配置：" + name);
            return object(JsonFiles.JSON.fromJson(new InputStreamReader(stream, StandardCharsets.UTF_8), JsonElement.class));
        }
    }

    static JsonArray list() throws IOException { return list("pack-templates", PACKS); }

    private static JsonArray list(String folder, List<String> names) throws IOException {
        var rows = new JsonArray();
        for (String name : names) rows.add(bundled(folder + "/" + name + ".json"));
        return rows;
    }

    static JsonObject apply(String name) throws IOException {
        if (!PACKS.contains(name)) throw new IOException("找不到这份模板");
        var row = bundled("pack-templates/" + name + ".json");
        var options = object(row.get("options"));
        for (var entry : options.entrySet()) WorkshopConfig.option(entry.getKey(), entry.getValue());
        var request = new StringBuilder("我想做一个").append(required(row, "name")).append("整合包，用 Minecraft ")
            .append(required(row, "minecraft")).append(" 和 ").append(required(row, "loader"))
            .append("，给游戏分配 ").append(number(row, "memoryMb", 4096)).append(" MB 内存。\n").append(text(row, "description", ""));
        var queries = array(row.get("modQueries")).asList().stream().map(JsonElement::getAsString).toList();
        if (!queries.isEmpty()) request.append("\n想试试这些模组：").append(String.join("、", queries)).append("。");
        if ("zh_cn".equals(text(options, "language", ""))) request.append("\n游戏语言用简体中文。");
        if (options.has("renderDistance")) request.append("\n视野距离设为 ").append(options.get("renderDistance")).append(" 个区块。");
        return json("template", row, "request", request.toString(), "note", "可以先修改需求，再生成方案。");
    }

    static JsonObject inspect(Path root, JsonObject args) throws IOException {
        String file = text(args, "file", "");
        var rows = list("mod-templates", CONFIG);
        return file.isEmpty() ? json("templates", rows) : json("templates", rows, "file", file, "text", WorkshopConfig.read(root, file));
    }

    static JsonObject applyConfig(Path root, String id) throws IOException {
        for (var patch : patches(id)) WorkshopConfig.apply(root, patch);
        return json("applied", true);
    }

    static JsonObject previewConfig(Path root, String id) throws IOException {
        var changes = new JsonArray();
        for (var patch : patches(id)) {
            String file = required(patch, "file");
            changes.add(json("file", file, "before", WorkshopConfig.read(root, file), "set", patch.get("set")));
        }
        return json("preview", changes, "requiresConfirmation", true);
    }

    private static List<JsonObject> patches(String id) throws IOException {
        if (!CONFIG.contains(id)) throw new IOException("配置模板不存在");
        var template = bundled("mod-templates/" + id + ".json");
        var patches = new ArrayList<JsonObject>();
        for (var raw : array(template.get("patches"))) patches.add(WorkshopConfig.patch(object(raw)));
        return patches;
    }

    static JsonArray keybinds(Path root) throws IOException {
        Path file = GameFiles.target(root, "options.txt");
        var found = new TreeMap<String, List<String>>();
        if (Files.isRegularFile(file)) {
            if (Files.size(file) > 2 * 1024 * 1024) throw new IOException("游戏选项文件太大");
            for (String line : Files.readAllLines(file)) {
                int split = line.indexOf(':');
                if (!line.startsWith("key_") || split < 4) continue;
                String key = line.substring(split + 1);
                if (!List.of("0", "key.keyboard.unknown", "").contains(key))
                    found.computeIfAbsent(key, ignored -> new ArrayList<>()).add(line.substring(0, split));
            }
        }
        var rows = new JsonArray();
        for (var entry : found.entrySet()) if (entry.getValue().size() > 1)
            rows.add(json("key", entry.getKey(), "actions", entry.getValue(), "note", "请在游戏中核对冲突的按键。"));
        return rows;
    }
}
