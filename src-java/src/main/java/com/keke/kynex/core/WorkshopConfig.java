package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.LaunchManifest.array;
import static com.keke.kynex.core.LaunchManifest.object;
import static com.keke.kynex.core.WorkshopPlans.json;

final class WorkshopConfig {
    private static final Set<String> FORMATS = Set.of("json", "properties", "toml", "cfg");
    private static final Set<String> SENSITIVE = Set.of("password", "token", "apikey", "command", "exec", "script", "path", "url");
    private WorkshopConfig() {}

    static void option(String key, JsonElement choice) throws IOException {
        long number = -1;
        if (choice.isJsonPrimitive() && choice.getAsJsonPrimitive().isNumber()) {
            try { number = Long.parseLong(choice.getAsString()); }
            catch (NumberFormatException ignored) { /* Non-integers do not match the supported keys. */ }
        }
        boolean valid = switch (key) {
            case "language" -> choice.isJsonPrimitive() && Set.of("zh_cn", "en_us").contains(choice.getAsString());
            case "renderDistance", "simulationDistance" -> number >= 2 && number <= 32;
            case "maxFps" -> number >= 10 && number <= 260;
            case "guiScale" -> number >= 0 && number <= 6;
            case "resourcePacks" -> choice instanceof JsonArray rows && rows.size() <= 32 && rows.asList().stream()
                .allMatch(value -> value.isJsonPrimitive() && packName(value.getAsString()));
            default -> false;
        };
        if (!valid) throw new IOException("不允许的游戏选项或值：" + key);
    }

    private static boolean packName(String value) {
        try {
            if (value.equals("vanilla")) return true;
            if (!value.startsWith("file/")) return false;
            LaunchManifest.safeName(value.substring(5));
            return true;
        } catch (IllegalArgumentException invalid) { return false; }
    }

    static JsonObject patch(JsonObject raw) throws IOException {
        WorkshopPlans.keys(raw, "file", "format", "set");
        String name = required(raw, "file"), type = required(raw, "format");
        validateName(name, type);
        JsonObject input = object(raw.get("set"));
        if (input.isEmpty() || input.size() > 100) throw new IOException("配置补丁为空或超过限制");
        var clean = new JsonObject();
        for (var field : input.entrySet().stream().sorted(Map.Entry.comparingByKey()).toList()) {
            String key = field.getKey();
            JsonElement value = field.getValue();
            if (name.equals("options.txt")) {
                JsonElement check = value;
                if (value.isJsonPrimitive() && value.getAsJsonPrimitive().isString() && !Set.of("lang", "language").contains(key)) {
                    try { check = JsonFiles.JSON.fromJson(value.getAsString(), JsonElement.class); }
                    catch (JsonParseException invalid) { throw new IOException("游戏设置值无效"); }
                }
                if (check == null) throw new IOException("游戏设置值无效");
                option("lang".equals(key) ? "language" : key, check);
            } else {
                if (key.isBlank() || key.length() > 120 || key.matches("(?s).*[\\r\\n:=].*") || !value.isJsonPrimitive()
                    || SENSITIVE.stream().anyMatch(part -> key.toLowerCase(Locale.ROOT).contains(part)) || value.toString().length() > 2000
                    || value.getAsString().matches("(?s).*[\\r\\n].*")) throw new IOException("配置键或值不在安全范围内");
                if (type.equals("toml") && !key.matches("[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+)*")) throw new IOException("TOML 配置路径无效");
            }
            clean.add(key, value);
        }
        return json("file", name, "format", type, "set", clean);
    }

    static String read(Path root, String name) throws IOException {
        String type = name.equals("options.txt") ? "properties" : name.substring(name.lastIndexOf('.') + 1);
        validateName(name, type);
        Path file = GameFiles.target(root, name);
        if (!Files.isRegularFile(file)) return "";
        if (Files.size(file) > 128 * 1024) throw new IOException("配置太大，请手动查看");
        return AssistantService.redact(Files.readString(file), "");
    }

    static void applyOptions(Path launch, JsonObject plan) throws IOException {
        var values = object(plan.get("options")).deepCopy();
        var language = values.remove("language");
        if (language != null) GameOptions.applyLanguage(launch, required(plan, "minecraft"), language.getAsString());
        if (!values.isEmpty()) apply(launch, json("file", "options.txt", "format", "properties", "set", values));
        for (var raw : array(plan.get("configPatches"))) apply(launch, object(raw));
    }

    static void apply(Path root, JsonObject raw) throws IOException {
        JsonObject patch = patch(raw);
        String name = required(patch, "file"), type = required(patch, "format");
        Path file = GameFiles.target(root, name);
        byte[] previous = null;
        if (Files.isRegularFile(file)) {
            if (Files.size(file) > 2 * 1024 * 1024) throw new IOException("配置文件超过 2 MB，请手动处理");
            previous = Files.readAllBytes(file);
        }
        String source = previous == null ? "" : StandardCharsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(previous)).toString();
        var changes = object(patch.get("set"));
        String output;
        if (type.equals("json")) {
            try {
                JsonObject existing = source.isBlank() ? new JsonObject() : JsonFiles.JSON.fromJson(source, JsonObject.class);
                if (existing == null) throw new IOException("原 JSON 配置不是对象");
                changes.entrySet().forEach(entry -> existing.add(entry.getKey(), entry.getValue()));
                output = JsonFiles.JSON.toJson(existing);
            } catch (JsonParseException invalid) { throw new IOException("原 JSON 配置无效"); }
        } else if (type.equals("toml")) output = toml(source, changes);
        else output = lines(source, changes, name.equals("options.txt") ? ':' : '=', type.equals("cfg"));
        if (previous != null) {
            String basename = file.getFileName().toString();
            basename = basename.substring(0, basename.lastIndexOf('.')) + ".kxl-agent-backup";
            JsonFiles.atomicWrite(GameFiles.target(file.getParent(), basename), previous);
        }
        JsonFiles.atomicWrite(file, output.getBytes(StandardCharsets.UTF_8));
    }

    static JsonArray keybinds(Path root) throws IOException {
        Path file = GameFiles.target(root, "options.txt");
        var found = new LinkedHashMap<String, List<String>>();
        if (Files.isRegularFile(file) && Files.size(file) <= 2 * 1024 * 1024) {
            for (String line : Files.readAllLines(file)) {
                String[] split = line.split(":", 2);
                if (split.length == 2 && split[0].startsWith("key_") && !Set.of("0", "key.keyboard.unknown").contains(split[1]))
                    found.computeIfAbsent(split[1], ignored -> new ArrayList<>()).add(split[0]);
            }
        }
        var result = new JsonArray();
        found.forEach((key, actions) -> { if (actions.size() > 1) result.add(json("key", key, "actions", actions, "note", "请在游戏中核对")); });
        return result;
    }

    private static String lines(String original, JsonObject changes, char delimiter, boolean unique) throws IOException {
        var pending = new LinkedHashMap<String, JsonElement>();
        changes.entrySet().forEach(entry -> pending.put(entry.getKey(), entry.getValue()));
        var output = new ArrayList<String>();
        for (String line : original.lines().toList()) {
            int separator = line.indexOf(delimiter);
            String name = separator == -1 ? "" : line.substring(0, separator).strip();
            if (changes.has(name)) {
                JsonElement value = pending.remove(name);
                if (value != null) output.add(name + delimiter + literal(value));
                else if (unique) throw new IOException("CFG 中同名键跨段重复，请先检查文件");
            } else output.add(line);
        }
        pending.forEach((key, value) -> output.add(key + delimiter + literal(value)));
        String newline = original.contains("\r\n") ? "\r\n" : "\n";
        return String.join(newline, output) + newline;
    }

    private static String toml(String original, JsonObject changes) throws IOException {
        var sections = new LinkedHashMap<String, LinkedHashMap<String, JsonElement>>();
        for (var entry : changes.entrySet()) {
            String path = entry.getKey();
            int split = path.lastIndexOf('.');
            sections.computeIfAbsent(split < 0 ? "" : path.substring(0, split), ignored -> new LinkedHashMap<>())
                .put(path.substring(split + 1), entry.getValue());
        }
        var output = new ArrayList<String>();
        LinkedHashMap<String, JsonElement> pending = sections.remove("");
        var seen = new java.util.HashSet<String>();
        for (String line : original.lines().toList()) {
            String statement = line.strip();
            if (statement.startsWith("[")) {
                appendAssignments(output, pending);
                var section = java.util.regex.Pattern.compile("^\\[([A-Za-z0-9_.-]+)\\]\\s*(?:#.*)?$").matcher(statement);
                if (section.matches()) {
                    if (!seen.add(section.group(1))) throw new IOException("TOML 包含重复配置段");
                    pending = sections.remove(section.group(1));
                } else {
                    if (sections.keySet().stream().anyMatch(statement::contains)) throw new IOException("复杂 TOML 配置段需要手动修改");
                    pending = null;
                }
                output.add(line);
                continue;
            }
            int delimiter = line.indexOf('=');
            String key = delimiter < 0 ? "" : line.substring(0, delimiter).strip();
            if (pending != null && pending.containsKey(key)) {
                String old = line.substring(delimiter + 1).strip();
                if (old.startsWith("\"\"\"") || old.startsWith("'''") || old.startsWith("[") || old.startsWith("{")) throw new IOException("复杂 TOML 值需手动修改");
                output.add(key + " = " + pending.remove(key));
            } else output.add(line);
        }
        appendAssignments(output, pending);
        sections.forEach((name, entries) -> { output.add("[" + name + "]"); appendAssignments(output, entries); });
        return String.join(original.contains("\r\n") ? "\r\n" : "\n", output) + "\n";
    }

    private static void appendAssignments(List<String> rows, Map<String, JsonElement> pending) {
        if (pending != null) pending.forEach((key, value) -> rows.add(key + " = " + value));
    }

    private static String literal(JsonElement value) {
        return value.isJsonPrimitive() && value.getAsJsonPrimitive().isString() ? value.getAsString() : value.toString();
    }

    private static void validateName(String file, String format) throws IOException {
        if (file.length() > 240) throw new IOException("配置路径超过限制");
        if (file.equals("options.txt") && format.equals("properties")) return;
        if (!(file.startsWith("config/") || file.startsWith("defaultconfigs/")) || !FORMATS.contains(format) || !file.endsWith("." + format))
            throw new IOException("仅支持游戏配置文件和 options.txt");
        for (String part : file.split("/", -1)) LaunchManifest.safeName(part);
    }
}
