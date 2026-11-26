package com.keke.kynex.core;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;

final class LaunchManifest {
    private static final Gson JSON = new GsonBuilder().disableHtmlEscaping().serializeNulls().create();
    private static final Comparator<String> TEXT_ORDER = (left, right) -> {
        var a = left.codePoints().iterator();
        var b = right.codePoints().iterator();
        while (a.hasNext() && b.hasNext()) {
            int comparison = Integer.compare(a.nextInt(), b.nextInt());
            if (comparison != 0) return comparison;
        }
        return Boolean.compare(a.hasNext(), b.hasNext());
    };
    private static final String MAVEN = "https://libraries.minecraft.net/";
    private LaunchManifest() {}

    record Platform(String os, String arch, String bits, Set<String> versionMatches) {
        static Platform from(JsonObject data) {
            var matches = new HashSet<String>();
            for (JsonElement item : array(data.get("versionMatches"))) matches.add(item.getAsString());
            return new Platform(required(data, "os"), required(data, "arch"), required(data, "bits"), matches);
        }

        boolean allows(JsonObject item) {
            if (!(item.get("rules") instanceof JsonArray rules)) return true;
            boolean allowed = false;
            for (JsonElement element : rules) {
                JsonObject rule = object(element);
                JsonObject system = object(rule.get("os"));
                String name = text(system, "name", null);
                String architecture = text(system, "arch", null);
                String version = text(system, "version", null);
                if ((name != null && !os.equals(name)) || (architecture != null && !arch.equals(architecture))
                    || (version != null && !versionMatches.contains(version))) continue;
                if (object(rule.get("features")).asMap().values().stream().anyMatch(value -> !is(value, false))) continue;
                allowed = "allow".equals(text(rule, "action", ""));
            }
            return allowed;
        }

        JsonObject nativeArtifact(JsonObject library) {
            String classifier = text(object(library.get("natives")), os, null);
            if (classifier == null) return new JsonObject();
            var downloads = object(library.get("downloads"));
            return object(object(downloads.get("classifiers")).get(classifier.replace("${arch}", bits)));
        }
    }

    private record Variant(String coordinate, String rules, String natives) {}

    static JsonElement merge(JsonElement base, JsonElement overlay) {
        if (!(overlay instanceof JsonObject fields)) return base;
        JsonObject merged = object(base).deepCopy();
        for (var entry : fields.entrySet()) {
            String name = entry.getKey();
            JsonElement value = entry.getValue();
            switch (name) {
                case "libraries" -> {
                    var libraries = new TreeMap<Variant, JsonElement>(Comparator.comparing(Variant::coordinate, TEXT_ORDER)
                        .thenComparing(Variant::rules, TEXT_ORDER).thenComparing(Variant::natives, TEXT_ORDER));
                    for (JsonElement library : concat(merged.get(name), value)) {
                        var data = object(library);
                        String[] parts = text(data, "name", "").split(":", -1);
                        String coordinate = parts.length > 3 ? parts[0] + ":" + parts[1] + ":" + parts[3]
                            : parts.length > 1 ? parts[0] + ":" + parts[1] : parts[0];
                        libraries.put(new Variant(coordinate, canonical(data.get("rules")), canonical(data.get("natives"))), library);
                    }
                    var values = new JsonArray();
                    libraries.values().forEach(values::add);
                    merged.add(name, values);
                }
                case "arguments" -> {
                    var arguments = object(merged.get(name));
                    var additions = object(value);
                    for (String argument : List.of("game", "jvm")) {
                        arguments.add(argument, concat(arguments.get(argument), additions.get(argument)));
                    }
                    merged.add(name, arguments);
                }
                default -> merged.add(name, value);
            }
        }
        return merged;
    }

    static JsonObject restore(JsonObject version, JsonObject original, Platform platform) {
        boolean changed = false;
        if (version.get("libraries") instanceof JsonArray libraries) {
            for (JsonElement item : array(original.get("libraries"))) {
                JsonObject library = object(item);
                if (!platform.allows(library)) continue;
                String coordinate = family(text(library, "name", ""));
                boolean present = libraries.asList().stream().map(LaunchManifest::object)
                    .filter(platform::allows)
                    .anyMatch(existing -> member(existing, "natives").equals(member(library, "natives"))
                        && text(existing, "name", null) != null
                        && family(required(existing, "name")).equals(coordinate));
                if (!present) {
                    libraries.add(item);
                    changed = true;
                }
            }
        }
        var result = new JsonObject();
        result.addProperty("changed", changed);
        result.add("version", version);
        return result;
    }

    static JsonArray dependencies(JsonObject version, Platform platform) {
        var rows = new JsonArray();
        for (JsonObject library : activeLibraries(version, platform, "版本没有依赖库清单")) {
            JsonObject downloads = object(library.get("downloads"));
            if (downloads.get("artifact") instanceof JsonObject artifact) {
                rows.add(download(artifact));
            } else if (!(library.get("downloads") instanceof JsonObject)) {
                String path = coordinatePath(required(library, "name"));
                rows.add(download(text(library, "url", MAVEN) + path, path, ""));
            }
            String classifier = text(object(library.get("natives")), platform.os(), null);
            if (classifier != null) {
                var classifiers = object(downloads.get("classifiers"));
                if (classifiers.get(classifier.replace("${arch}", platform.bits())) instanceof JsonObject artifact) {
                    rows.add(download(artifact));
                }
            }
        }
        return rows;
    }

    static JsonArray launchLibraries(JsonObject version, Platform platform) {
        var rows = new JsonArray();
        for (JsonObject library : activeLibraries(version, platform, "缺少依赖库")) {
            String name = required(library, "name");
            String path = coordinatePath(name);
            var artifact = object(object(library.get("downloads")).get("artifact"));
            var row = new JsonObject();
            row.addProperty("path", text(artifact, "path", path));
            row.addProperty("extract", name.contains("natives-"));
            row.addProperty("classifier", text(platform.nativeArtifact(library), "path", null));
            rows.add(row);
        }
        return rows;
    }

    static JsonArray arguments(JsonObject request, Platform platform) {
        var version = object(request.get("version"));
        var settings = object(request.get("settings"));
        var values = new TreeMap<String, String>(TEXT_ORDER);
        var variables = object(request.get("variables"));
        for (String key : variables.keySet()) {
            values.put(key, required(variables, key));
        }
        var args = new ArrayList<String>();
        args.add("-Xmx" + bounded(settings, "memory", 4096, 512, 65536) + "M");
        String agent = text(request, "authAgent", null);
        if (agent != null) args.add(agent);
        var arguments = object(version.get("arguments"));
        addArguments(args, arguments.get("jvm"), values, platform);
        if (!args.contains("-cp") && !args.contains("-classpath")) {
            args.add("-Djava.library.path=" + values.get("natives_directory"));
            args.add("-cp");
            args.add(values.get("classpath"));
        }
        for (String token : parseCustomArguments(text(settings, "jvmArgs", ""))) {
            args.add(substitute(token, values));
        }
        args.add(required(version, "mainClass"));
        if (Set.of("forge", "neoforge").contains(text(request, "loader", ""))) {
            args.replaceAll(arg -> arg.startsWith("-DignoreList=") && !List.of(arg.split(",", -1)).contains("client.jar")
                ? arg + ",client.jar" : arg);
        }
        String legacy = text(version, "minecraftArguments", null);
        if (legacy != null) {
            for (String token : legacyWords(legacy)) args.add(substitute(token, values));
        } else {
            addArguments(args, arguments.get("game"), values, platform);
        }
        args.addAll(List.of("--width", Long.toString(bounded(settings, "width", 1280, 640, 7680)),
            "--height", Long.toString(bounded(settings, "height", 720, 360, 4320))));
        for (String token : parseCustomArguments(text(settings, "gameArgs", ""))) {
            args.add(substitute(token, values));
        }
        var rows = new JsonArray();
        args.forEach(rows::add);
        return rows;
    }

    /**
     * Splits user-entered JVM or game arguments on whitespace while keeping Windows
     * backslashes intact and honoring single or double quotes.
     */
    static List<String> parseCustomArguments(String raw) {
        if (raw == null || raw.isBlank()) return List.of();
        var tokens = new ArrayList<String>();
        var word = new StringBuilder();
        boolean started = false;
        char quote = 0;
        for (int index = 0; index < raw.length(); index++) {
            char character = raw.charAt(index);
            if (character == '\0') throw new IllegalArgumentException("自定义启动参数包含无效字符");
            if (quote != 0) {
                if (quote == '"' && character == '\\' && index + 1 < raw.length() && raw.charAt(index + 1) == '"') {
                    word.append('"');
                    index++;
                } else if (character == quote) {
                    quote = 0;
                } else {
                    word.append(character);
                }
            } else if (character == '"' || character == '\'') {
                started = true;
                quote = character;
            } else if (Character.isWhitespace(character)) {
                if (started) {
                    tokens.add(word.toString());
                    word.setLength(0);
                    started = false;
                }
            } else {
                word.append(character);
                started = true;
            }
        }
        if (quote != 0) throw new IllegalArgumentException("自定义启动参数中存在未闭合的引号");
        if (started) tokens.add(word.toString());
        return tokens;
    }

    static List<String> legacyWords(String template) {
        var tokens = new ArrayList<String>();
        var word = new StringBuilder();
        boolean started = false;
        char quote = 0;
        for (int index = 0; index < template.length(); index++) {
            char character = template.charAt(index);
            if (character == quote && quote != 0) {
                quote = 0;
            } else if (quote == '\'') {
                word.append(character);
            } else if (character == '\\') {
                if (index + 1 == template.length()) {
                    word.append(character);
                    started = true;
                } else {
                    char next = template.charAt(++index);
                    if (next == '\n') continue;
                    if (quote == '"' && "$`\\".indexOf(next) < 0 && next != '"') word.append(character);
                    word.append(next);
                    started = true;
                }
            } else if (quote != 0) {
                word.append(character);
            } else if (character == '\'' || character == '"') {
                started = true;
                quote = character;
            } else if (character == '#' && !started) {
                int newline = template.indexOf('\n', index);
                if (newline < 0) break;
                index = newline;
            } else if (character == ' ' || character == '\t' || character == '\n') {
                if (started) tokens.add(word.toString());
                word.setLength(0);
                started = false;
            } else {
                word.append(character);
                started = true;
            }
        }
        if (quote != 0) throw new IllegalArgumentException("missing closing quote");
        if (started) tokens.add(word.toString());
        return tokens;
    }

    private static void addArguments(List<String> out, JsonElement list, Map<String, String> variables, Platform platform) {
        for (JsonElement item : array(list)) {
            if (item.isJsonPrimitive() && item.getAsJsonPrimitive().isString()) {
                out.add(substitute(item.getAsString(), variables));
            } else if (platform.allows(object(item))) {
                JsonElement value = member(object(item), "value");
                if (value.isJsonPrimitive() && value.getAsJsonPrimitive().isString()) {
                    out.add(substitute(value.getAsString(), variables));
                } else {
                    for (JsonElement argument : array(value)) {
                        if (argument.isJsonPrimitive() && argument.getAsJsonPrimitive().isString()) {
                            out.add(substitute(argument.getAsString(), variables));
                        }
                    }
                }
            }
        }
    }

    private static String substitute(String value, Map<String, String> variables) {
        for (var variable : variables.entrySet()) {
            value = value.replace("${" + variable.getKey() + "}", variable.getValue());
        }
        return value;
    }

    private static long bounded(JsonObject data, String field, long fallback, long min, long max) {
        JsonElement value = member(data, field);
        if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) return fallback;
        try {
            long number = Long.parseUnsignedLong(value.getAsString());
            return number < 0 ? max : Math.clamp(number, min, max);
        } catch (NumberFormatException invalid) {
            return fallback;
        }
    }

    private static String family(String coordinate) {
        String[] parts = coordinate.split(":", -1);
        return switch (parts.length) {
            case 3 -> parts[0] + ":" + parts[1];
            case 4 -> parts[0] + ":" + parts[1] + ":" + parts[3];
            default -> coordinate;
        };
    }

    static String coordinatePath(String coordinate) {
        int suffix = coordinate.indexOf('@');
        String extension = suffix < 0 ? "jar" : coordinate.substring(suffix + 1);
        String[] parts = (suffix < 0 ? coordinate : coordinate.substring(0, suffix)).split(":", -1);
        if (parts.length < 3 || parts.length > 4) throw new IllegalArgumentException("Maven 坐标无效");
        for (String part : parts) safeName(part);
        String classifier = parts.length == 4 ? "-" + parts[3] : "";
        return parts[0].replace('.', '/') + "/" + parts[1] + "/" + parts[2] + "/"
            + parts[1] + "-" + parts[2] + classifier + "." + extension;
    }

    static void safeName(String name) {
        if (name.isEmpty() || name.getBytes(StandardCharsets.UTF_8).length > 128 || name.endsWith(".") || name.endsWith(" ")
            || name.codePoints().anyMatch(ch -> Character.isISOControl(ch) || "/\\:*?\"<>|".indexOf(ch) >= 0)) {
            throw new IllegalArgumentException("名称含不允许的字符或过长");
        }
        String prefix = name.split("\\.", 2)[0].toUpperCase(Locale.ROOT);
        if (Set.of("CON", "PRN", "AUX", "NUL").contains(prefix) || prefix.matches("(COM|LPT)[1-9]")) {
            throw new IllegalArgumentException("名称是系统保留字");
        }
    }

    private static List<JsonObject> activeLibraries(JsonObject version, Platform platform, String error) {
        if (!(version.get("libraries") instanceof JsonArray libraries)) throw new IllegalArgumentException(error);
        return libraries.asList().stream().map(LaunchManifest::object).filter(platform::allows).toList();
    }

    private static JsonObject download(JsonObject artifact) {
        return download(required(artifact, "url"), required(artifact, "path"), text(artifact, "sha1", ""));
    }

    private static JsonObject download(String url, String path, String hash) {
        var row = new JsonObject();
        row.addProperty("url", url);
        row.addProperty("path", path);
        row.addProperty("hash", hash);
        return row;
    }

    private static JsonArray concat(JsonElement first, JsonElement second) {
        var result = new JsonArray();
        result.addAll(array(first));
        result.addAll(array(second));
        return result;
    }

    static JsonObject object(JsonElement value) {
        return value instanceof JsonObject obj ? obj : new JsonObject();
    }

    static JsonArray array(JsonElement value) {
        return value instanceof JsonArray array ? array : new JsonArray();
    }

    private static JsonElement member(JsonObject obj, String name) {
        return obj.has(name) ? obj.get(name) : JsonNull.INSTANCE;
    }

    private static String canonical(JsonElement value) {
        return JSON.toJson(value == null ? JsonNull.INSTANCE : value);
    }

    static boolean is(JsonElement value, boolean expected) {
        return value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isBoolean()
            && value.getAsBoolean() == expected;
    }
}
