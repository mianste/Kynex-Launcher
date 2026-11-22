package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;
import java.util.zip.ZipFile;

import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.array;
import static com.keke.kynex.core.LaunchManifest.is;
import static com.keke.kynex.core.LaunchManifest.object;

final class LocalResources {
    private static final String DISABLED = ".disabled";
    private static final Set<String> BUILT_INS = Set.of("minecraft", "java", "fabricloader", "quilt_loader", "forge", "neoforge");
    private static final int ICON_LIMIT = 2 * 1024 * 1024;
    private static final int IMPORT_LIMIT = 120 * 1024 * 1024;
    private static final Set<String> WRITABLE = Set.of("mods", "resourcepacks", "shaderpacks", "datapacks", "schematics");
    private static final Pattern TOML_VALUE = Pattern.compile("^\\s*([A-Za-z_][A-Za-z_0-9]*)\\s*=\\s*(?:[\"']([^\"']*)[\"']|([^\\s#]+))");
    private static final Pattern TOML_SECTION = Pattern.compile("^\\s*\\[\\[([^]]+)]]");
    private final Map<Path, Cached> cache = new ConcurrentHashMap<>();
    private record Cached(long size, java.nio.file.attribute.FileTime modified, Metadata info) {}
    private record Metadata(Set<String> ids, Set<String> required, Set<String> breaks, String version, String icon) {}

    @FunctionalInterface interface Recycler { boolean recycle(Path file) throws IOException; }

    synchronized JsonArray importResources(Path root, Path dataRoot, JsonObject request, boolean paths) throws IOException {
        String kind = required(request, "kind");
        if (!WRITABLE.contains(kind)) throw new IOException("当前分类不支持导入文件");
        Path dir = Files.createDirectories(LocalGameFiles.resourceDirectory(root, dataRoot, request));
        checkDirectory(dir, request, kind);
        var staged = new LinkedHashMap<Path, Path>();
        var names = new java.util.HashSet<String>();
        var published = new ArrayList<Path>();
        try {
            if (paths) {
                JsonArray selected = array(request.get("paths"));
                if (selected.isEmpty() || selected.size() > 64) throw new IOException("一次请选择 1–64 个资源文件");
                for (var value : selected) {
                    if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString()) throw new IOException("文件路径无效");
                    Path source = Path.of(value.getAsString());
                    if (!source.isAbsolute() || !Files.isRegularFile(source) || Files.size(source) > IMPORT_LIMIT) {
                        throw new IOException("资源必须是小于 120 MB 的文件");
                    }
                    String name = source.getFileName().toString();
                    Path target = importTarget(dir, kind, name, names);
                    Path temp = Files.createTempFile(dir, ".kxl-import-", ".tmp");
                    staged.put(target, temp);
                    try (var input = Files.newInputStream(source); var output = Files.newOutputStream(temp)) {
                        byte[] buffer = new byte[64 * 1024];
                        long count = 0;
                        for (int read; (read = input.read(buffer)) >= 0;) {
                            count += read;
                            if (count > IMPORT_LIMIT) throw new IOException("单个资源文件不能大于 120 MB");
                            output.write(buffer, 0, read);
                        }
                    }
                }
            } else {
                Path target = importTarget(dir, kind, required(request, "name"), names);
                String content = required(request, "base64");
                if (content.length() > 160 * 1024 * 1024) throw new IOException("单个资源文件不能大于 120 MB");
                byte[] bytes;
                try { bytes = Base64.getDecoder().decode(content); }
                catch (IllegalArgumentException invalid) { throw new IOException("资源文件编码无效"); }
                if (bytes.length > IMPORT_LIMIT) throw new IOException("单个资源文件不能大于 120 MB");
                Path temp = Files.createTempFile(dir, ".kxl-import-", ".tmp");
                staged.put(target, temp);
                Files.write(temp, bytes);
            }
            if (kind.equals("schematics")) {
                for (Path temp : staged.values()) SchematicPreview.read(temp);
            }
            for (var entry : staged.entrySet()) {
                Files.move(entry.getValue(), entry.getKey());
                published.add(entry.getKey());
            }
        } catch (IOException | RuntimeException error) {
            for (Path file : published.reversed()) {
                try { Files.deleteIfExists(file); }
                catch (IOException cleanup) { error.addSuppressed(cleanup); }
            }
            throw error;
        } finally {
            for (Path temp : staged.values()) Files.deleteIfExists(temp);
        }
        if (!kind.equals("schematics")) return list(root, dataRoot, request);
        var result = new JsonArray();
        for (Path path : published) {
            var imported = new JsonObject();
            imported.addProperty("name", path.getFileName().toString());
            imported.addProperty("directory", dir.toString());
            result.add(imported);
        }
        return result;
    }

    synchronized JsonObject remove(Path root, Path dataRoot, JsonObject request, Recycler trash) throws IOException {
        String kind = required(request, "kind");
        if (!WRITABLE.contains(kind)) throw new IOException("此分类不支持删除资源");
        Path dir = LocalGameFiles.resourceDirectory(root, dataRoot, request);
        checkDirectory(dir, request, kind);
        if (!kind.equals("schematics") && !dir.toRealPath().startsWith(root)) {
            throw new IOException("资源目录不能指向实例以外的位置");
        }
        JsonArray names = array(request.get("names"));
        if (names.isEmpty() || names.size() > 10_000) throw new IOException("请选择 1–10000 个资源");
        var selected = new LinkedHashMap<String, Path>();
        var used = new java.util.HashSet<String>();
        for (var raw : names) {
            if (!raw.isJsonPrimitive() || !raw.getAsJsonPrimitive().isString()) throw new IOException("资源文件名无效");
            String name = raw.getAsString();
            if (!used.add(name.toLowerCase(Locale.ROOT))) continue;
            if (!kind.equals("schematics") && !fileName(name) || kind.equals("schematics") && !ResourceVersions.extension(name, kind)) {
                throw new IOException("资源文件名无效");
            }
            Path candidate = dir.resolve(name).normalize();
            if (!candidate.startsWith(dir) || !Files.exists(candidate, LinkOption.NOFOLLOW_LINKS))
                throw new IOException(name + " 已不存在，请刷新列表");
            candidate = GameFiles.target(dir, name);
            if (!Files.isRegularFile(candidate, LinkOption.NOFOLLOW_LINKS)
                && (kind.equals("schematics") || !Files.isDirectory(candidate, LinkOption.NOFOLLOW_LINKS))) {
                throw new IOException(name + " 已不存在，请刷新列表");
            }
            selected.put(name, candidate);
        }
        var deleted = new JsonArray();
        var failed = new JsonArray();
        var warnings = new JsonArray();
        for (var entry : selected.entrySet()) {
            Path path = entry.getValue();
            try {
                if (!path.equals(path.toRealPath()) || !trash.recycle(path) || Files.exists(path, LinkOption.NOFOLLOW_LINKS)) {
                    throw new IOException("无法移动到回收站，文件可能正在使用");
                }
                deleted.add(entry.getKey());
            } catch (IOException error) {
                var failure = new JsonObject();
                failure.addProperty("name", entry.getKey());
                failure.addProperty("error", error.getMessage());
                failed.add(failure);
            }
        }
        if (!kind.equals("schematics") && !deleted.isEmpty()) {
            try { afterDelete(root, dir, kind, request, deleted); }
            catch (IOException | JsonParseException error) { warnings.add("文件已删除，配置同步失败：" + error.getMessage()); }
        }
        var reply = new JsonObject();
        reply.add("deleted", deleted);
        reply.add("failed", failed);
        reply.add("warnings", warnings);
        return reply;
    }

    private static void afterDelete(Path root, Path dir, String kind, JsonObject request, JsonArray deleted) throws IOException {
        Path runtime = dir.getParent();
        var missing = new LinkedHashSet<String>();
        for (var row : deleted) {
            String name = row.getAsString();
            missing.add(name);
            if (name.endsWith(DISABLED)) {
                String active = name.substring(0, name.length() - DISABLED.length());
                if (!Files.exists(dir.resolve(active))) missing.add(active);
            }
        }
        if (kind.equals("resourcepacks")) {
            Path options = GameFiles.target(runtime, "options.txt");
            if (Files.isRegularFile(options)) {
                var lines = new ArrayList<String>();
                for (String line : Files.readAllLines(options)) {
                    if (line.startsWith("resourcePacks:") || line.startsWith("incompatibleResourcePacks:")) {
                        int split = line.indexOf(':') + 1;
                        JsonArray optionsPacks = JsonFiles.JSON.fromJson(line.substring(split), JsonArray.class);
                        if (optionsPacks != null) {
                            optionsPacks.asList().removeIf(row -> row.isJsonPrimitive() && row.getAsString().startsWith("file/")
                                && missing.contains(row.getAsString().substring(5)));
                            line = line.substring(0, split) + optionsPacks;
                        }
                    }
                    lines.add(line);
                }
                JsonFiles.atomicWrite(options, (String.join("\n", lines) + "\n").getBytes(StandardCharsets.UTF_8));
            }
        }
        if (kind.equals("shaderpacks")) {
            for (String relative : List.of("config/iris.properties", "config/oculus.properties", "optionsshaders.txt")) {
                Path config = GameFiles.target(runtime, relative);
                if (!Files.isRegularFile(config)) continue;
                var lines = new ArrayList<>(Files.readAllLines(config));
                if (lines.stream().noneMatch(line -> line.startsWith("shaderPack=") && missing.contains(line.substring(11).strip().replace("\\ ", " ")))) continue;
                lines.removeIf(line -> line.startsWith("shaderPack=") || line.startsWith("enableShaders="));
                lines.add("shaderPack=");
                if (!relative.equals("optionsshaders.txt")) lines.add("enableShaders=false");
                JsonFiles.atomicWrite(config, (String.join("\n", lines) + "\n").getBytes(StandardCharsets.UTF_8));
            }
        }
        Path record = kind.equals("datapacks") ? GameFiles.target(runtime, "kxl-datapacks.json")
            : GameFiles.target(LocalGameFiles.instance(root, request), "installed-projects.json");
        if (!Files.isRegularFile(record)) return;
        JsonObject installed = object(JsonFiles.read(record));
        installed.entrySet().removeIf(entry -> {
            String name = text(object(entry.getValue()), "file", "");
            return missing.contains(name) && WRITABLE.stream().filter(key -> !key.equals("schematics"))
                .noneMatch(folder -> Files.exists(runtime.resolve(folder).resolve(name)));
        });
        JsonFiles.write(record, installed);
    }

    private static void checkDirectory(Path dir, JsonObject request, String kind) throws IOException {
        if (!dir.equals(dir.toRealPath())) throw new IOException("资源目录不能指向其他位置");
        if (kind.equals("schematics") && request.has("directory") && !dir.equals(Path.of(required(request, "directory")))) {
            throw new IOException("投影目录已变更，请刷新后重新选择文件");
        }
    }

    private static Path importTarget(Path dir, String kind, String name, Set<String> names) throws IOException {
        boolean valid = !kind.equals("mods") || name.toLowerCase(Locale.ROOT).endsWith(".jar");
        if (!fileName(name) || !valid || !ResourceVersions.extension(name, kind)) throw new IOException(name + " 不适合当前资源分类");
        Path target = GameFiles.target(dir, name);
        if (!names.add(name.toLowerCase(Locale.ROOT)) || Files.exists(target, LinkOption.NOFOLLOW_LINKS)) throw new IOException(name + " 已存在");
        return target;
    }

    private static boolean fileName(String value) {
        return !value.isEmpty() && value.length() <= 255 && !value.endsWith(".") && !value.endsWith(" ")
            && value.codePoints().noneMatch(ch -> Character.isISOControl(ch) || "/\\:*?\"<>|".indexOf(ch) >= 0);
    }

    JsonArray list(Path root, Path dataRoot, JsonObject request) throws IOException {
        String kind = required(request, "kind");
        Path dir = LocalGameFiles.resourceDirectory(root, dataRoot, request);
        if (kind.equals("schematics")) return SchematicCatalog.list(dir);
        var items = new ArrayList<JsonObject>();
        var problems = new HashMap<String, Integer>();
        if (!Files.isDirectory(dir)) return new JsonArray();
        boolean basic = is(request.get("basic"), true);
        var only = new LinkedHashSet<String>();
        boolean preview = request.get("previewNames") instanceof JsonArray;
        if (preview) array(request.get("previewNames")).asList().stream().limit(64).filter(com.google.gson.JsonElement::isJsonPrimitive)
            .forEach(item -> only.add(item.getAsString()));
        var order = kind.equals("resourcepacks") ? order(dir.getParent().resolve("options.txt")) : List.<String>of();
        boolean mods = kind.equals("mods");
        var installedIcons = basic ? Map.<String, String>of() : installedIcons(root, dir, kind, request);
        var metadata = new HashMap<String, Metadata>();
        try (var paths = Files.list(dir)) {
            for (Path file : paths.sorted().toList()) {
                String name = file.getFileName().toString();
                if (name.startsWith(".kxl-") || preview && !only.contains(name)) continue;
                var attr = Files.readAttributes(file, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
                if (attr.isSymbolicLink() || !attr.isRegularFile() && !attr.isDirectory()) continue;
                boolean enabled = !name.endsWith(DISABLED);
                int index = kind.equals("resourcepacks") ? order.indexOf("file/" + name) : -1;
                if (kind.equals("resourcepacks")) enabled = index != -1;
                if (kind.equals("schematics") && (attr.isDirectory() || !name.toLowerCase(Locale.ROOT).matches(".*\\.(schem|schematic|litematic|nbt)"))) continue;
                var row = new JsonObject();
                row.addProperty("name", name);
                row.addProperty("size", attr.size());
                row.addProperty("modified", attr.lastModifiedTime().toMillis());
                row.addProperty("dir", attr.isDirectory());
                row.addProperty("enabled", enabled);
                if (kind.equals("resourcepacks")) row.addProperty("order", index < 0 ? Integer.MAX_VALUE : index);
                items.add(row);
                if (basic) continue;
                String clean = name.replaceFirst("\\.disabled$", "");
                String icon = "";
                if (mods && attr.isRegularFile() && ResourceVersions.extension(clean, "mods")) {
                    Metadata details = metadata(file, attr);
                    metadata.put(name, details);
                    if (enabled) details.ids().forEach(id -> problems.merge(id, 1, Integer::sum));
                    row.addProperty("version", details.version());
                    row.add("modIds", JsonFiles.JSON.toJsonTree(details.ids()));
                    icon = details.icon();
                } else if (attr.isDirectory()) {
                    icon = image(file.resolve(kind.equals("saves") ? "icon.png" : "pack.png"), file);
                } else if (Set.of("resourcepacks", "shaderpacks", "datapacks").contains(kind)) {
                    try (var zip = new ZipFile(file.toFile())) { icon = image(icon(zip, "pack.png", "icon.png")); }
                    catch (IOException invalid) { /* A malformed resource can still appear in the list. */ }
                }
                if (icon.isEmpty()) icon = installedIcons.getOrDefault(clean, "");
                if (!icon.isEmpty()) row.addProperty("icon_url", icon);
            }
        }
        if (mods && !basic) {
            for (JsonObject item : items) {
                var flags = new JsonArray();
                Metadata details = metadata.get(required(item, "name"));
                if (details != null && !preview && is(item.get("enabled"), true)) {
                    for (String id : details.ids()) if (problems.getOrDefault(id, 0) > 1) flags.add("重复模组：" + id);
                    for (String id : details.required()) if (!BUILT_INS.contains(id) && !problems.containsKey(id)) flags.add("缺少依赖：" + id);
                    for (String id : details.breaks()) if (problems.containsKey(id)) flags.add("声明冲突：" + id);
                }
                item.add("problems", flags);
            }
        }
        if (kind.equals("resourcepacks")) items.sort(Comparator.comparingInt(row -> row.get("order").getAsInt()));
        var result = new JsonArray();
        items.forEach(result::add);
        return result;
    }

    void toggle(Path root, Path dataRoot, JsonObject request) throws IOException {
        String kind = required(request, "kind");
        if (kind.equals("schematics") || kind.equals("saves") || kind.equals("map-downloads")) {
            throw new IOException("此类型的资源不能在启动器中停用");
        }
        Path dir = LocalGameFiles.resourceDirectory(root, dataRoot, request).toRealPath();
        String name = required(request, "name");
        LaunchManifest.safeName(name);
        Path file = GameFiles.target(dir, name);
        if (!Files.exists(file, LinkOption.NOFOLLOW_LINKS)) throw new IOException("所选资源不存在");
        boolean enable = name.endsWith(DISABLED);
        String dest = enable ? name.substring(0, name.length() - DISABLED.length()) : name + DISABLED;
        Path output = GameFiles.target(dir, dest);
        if (kind.equals("resourcepacks")) {
            Path options = GameFiles.target(dir.getParent(), "options.txt");
            List<String> order = order(options);
            String key = "file/" + (enable ? dest : name);
            if (enable) Files.move(file, output);
            if (!order.remove(key)) order.add(key);
            try { writeOrder(options, order); }
            catch (IOException failure) {
                if (enable) Files.move(output, file);
                throw failure;
            }
            return;
        }
        if (kind.equals("shaderpacks")) {
            var changes = new ArrayList<Map.Entry<Path, Path>>();
            changes.add(Map.entry(file, output));
            if (enable) {
                try (var paths = Files.list(dir)) {
                    for (Path other : paths.sorted().toList()) {
                        String label = other.getFileName().toString();
                        if (label.endsWith(DISABLED) || !Files.isRegularFile(other, LinkOption.NOFOLLOW_LINKS)) continue;
                        Path off = GameFiles.target(dir, label + DISABLED);
                        if (!Files.exists(off, LinkOption.NOFOLLOW_LINKS)) changes.add(Map.entry(other, off));
                    }
                }
            }
            var moved = new ArrayList<Map.Entry<Path, Path>>();
            try {
                for (var change : changes) {
                    Files.move(change.getKey(), change.getValue());
                    moved.add(change);
                }
                Path iris = GameFiles.target(dir.getParent(), "config/iris.properties");
                var lines = Files.exists(iris) ? new ArrayList<>(Files.readAllLines(iris)) : new ArrayList<String>();
                lines.removeIf(line -> line.startsWith("shaderPack=") || line.startsWith("enableShaders="));
                lines.add("shaderPack=" + (enable ? dest : ""));
                lines.add("enableShaders=" + enable);
                JsonFiles.atomicWrite(iris, (String.join("\n", lines) + "\n").getBytes(StandardCharsets.UTF_8));
            } catch (IOException failed) {
                for (var movedFile : moved.reversed()) {
                    try { Files.move(movedFile.getValue(), movedFile.getKey()); }
                    catch (IOException undo) { failed.addSuppressed(undo); }
                }
                throw failed;
            }
        } else Files.move(file, output);
    }

    JsonArray movePack(Path root, Path dataRoot, JsonObject request) throws IOException {
        var scoped = request.deepCopy();
        scoped.addProperty("kind", "resourcepacks");
        Path directory = LocalGameFiles.resourceDirectory(root, dataRoot, scoped);
        Path options = GameFiles.target(directory.getParent(), "options.txt");
        List<String> order = order(options);
        String name = required(request, "name");
        LaunchManifest.safeName(name);
        int position = order.indexOf("file/" + name);
        if (position < 0) throw new IOException("请先启用资源包");
        int delta = Long.compare(ResourceCatalog.number(request, "direction", 0), 0L);
        int next = position + delta;
        if (delta != 0 && next >= 0 && next < order.size() && order.get(next).startsWith("file/")) {
            java.util.Collections.swap(order, position, next);
            writeOrder(options, order);
        }
        return list(root, dataRoot, scoped);
    }

    private static List<String> order(Path path) throws IOException {
        var values = new ArrayList<String>();
        if (!Files.isRegularFile(path)) return values;
        for (String line : Files.readAllLines(path)) {
            if (!line.startsWith("resourcePacks:")) continue;
            try {
                for (var item : array(JsonFiles.JSON.fromJson(line.substring("resourcePacks:".length()), JsonArray.class))) {
                    if (item.isJsonPrimitive()) values.add(item.getAsString());
                }
            } catch (JsonParseException ignored) { /* The game can regenerate malformed pack options. */ }
            break;
        }
        return values;
    }

    private static void writeOrder(Path path, List<String> order) throws IOException {
        String before = Files.exists(path) ? Files.readString(path) : "";
        String newline = before.contains("\r\n") ? "\r\n" : "\n";
        var lines = new ArrayList<>(before.lines().toList());
        lines.removeIf(line -> line.startsWith("resourcePacks:"));
        lines.add("resourcePacks:" + new com.google.gson.Gson().toJson(order));
        JsonFiles.atomicWrite(path, (String.join(newline, lines) + newline).getBytes(StandardCharsets.UTF_8));
    }

    private Metadata metadata(Path file, BasicFileAttributes attributes) {
        Cached current = cache.get(file);
        if (current != null && current.size() == attributes.size() && current.modified().equals(attributes.lastModifiedTime())) {
            return current.info();
        }
        Metadata result = readMetadata(file);
        if (cache.size() > 2048) cache.clear();
        cache.put(file, new Cached(attributes.size(), attributes.lastModifiedTime(), result));
        return result;
    }

    private static Metadata readMetadata(Path file) {
        var ids = new LinkedHashSet<String>();
        var requires = new LinkedHashSet<String>();
        var breaks = new LinkedHashSet<String>();
        String version = "";
        String icon = "";
        try (var zip = new ZipFile(file.toFile())) {
            JsonObject fabric = metadataJson(zip, "fabric.mod.json");
            if (!fabric.isEmpty()) {
                add(ids, text(fabric, "id", ""));
                requires.addAll(object(fabric.get("depends")).keySet());
                breaks.addAll(object(fabric.get("breaks")).keySet());
                breaks.addAll(object(fabric.get("conflicts")).keySet());
                version = text(fabric, "version", "");
                String configured = text(fabric, "icon", "");
                if (configured.isEmpty() && fabric.get("icon") instanceof JsonObject sizes) {
                    for (var item : sizes.entrySet()) {
                        if (item.getValue().isJsonPrimitive()) configured = item.getValue().getAsString();
                    }
                }
                icon = image(icon(zip, configured));
            } else {
                JsonObject quilt = object(metadataJson(zip, "quilt.mod.json").get("quilt_loader"));
                if (!quilt.isEmpty()) {
                    add(ids, text(quilt, "id", ""));
                    dependIds(array(quilt.get("depends")), requires);
                    dependIds(array(quilt.get("breaks")), breaks);
                    version = text(quilt, "version", "");
                    icon = image(icon(zip, text(object(quilt.get("metadata")), "icon", "")));
                } else {
                    String toml = utf8(zip, "META-INF/neoforge.mods.toml", 256 * 1024);
                    if (toml.isEmpty()) toml = utf8(zip, "META-INF/mods.toml", 256 * 1024);
                    for (var block : toml(toml)) {
                        String type = block.getOrDefault("section", "");
                        if (type.equals("mods")) {
                            add(ids, block.getOrDefault("modId", ""));
                            if (version.isEmpty()) version = block.getOrDefault("version", "");
                            if (icon.isEmpty()) icon = image(icon(zip, block.getOrDefault("logoFile", "")));
                        } else if (type.startsWith("dependencies.")) {
                            String dependency = block.getOrDefault("modId", "");
                            String tag = block.getOrDefault("type", "");
                            if (tag.equals("incompatible")) add(breaks, dependency);
                            else if (tag.equals("required") || block.getOrDefault("mandatory", "").equals("true")) add(requires, dependency);
                        }
                    }
                    if (ids.isEmpty()) {
                        String legacy = utf8(zip, "mcmod.info", 256 * 1024);
                        if (!legacy.isEmpty()) {
                            var parsed = JsonFiles.JSON.fromJson(legacy, com.google.gson.JsonElement.class);
                            var rows = parsed instanceof JsonArray list ? list : array(object(parsed).get("modList"));
                            for (var row : rows) add(ids, text(object(row), "modid", ""));
                        }
                    }
                }
            }
            if (icon.isEmpty()) {
                var candidate = zip.stream().filter(entry -> !entry.isDirectory()
                    && entry.getName().toLowerCase(Locale.ROOT).matches("(?:.*/)?(?:icon|logo|pack)\\.png")).findFirst();
                if (candidate.isPresent()) icon = image(icon(zip, candidate.get().getName()));
            }
        } catch (IOException | JsonParseException invalid) { /* A failed parser cannot remove the file from the list. */ }
        return new Metadata(ids, requires, breaks, version, icon);
    }

    private static void dependIds(JsonArray items, Set<String> ids) {
        for (var item : items) {
            if (item.isJsonPrimitive()) add(ids, item.getAsString());
            else if (item instanceof JsonObject node && !is(node.get("optional"), true)) add(ids, text(node, "id", ""));
        }
    }

    private static void add(Set<String> ids, String id) {
        if (!id.isBlank()) ids.add(id);
    }

    private static List<Map<String, String>> toml(String text) {
        var values = new ArrayList<Map<String, String>>();
        Map<String, String> current = new HashMap<>();
        for (String line : text.lines().toList()) {
            var section = TOML_SECTION.matcher(line);
            if (section.find()) {
                current = new HashMap<>();
                current.put("section", section.group(1));
                values.add(current);
            } else {
                var field = TOML_VALUE.matcher(line);
                if (field.find()) current.put(field.group(1), field.group(2) != null ? field.group(2) : field.group(3));
            }
        }
        return values;
    }

    private static JsonObject metadataJson(ZipFile zip, String path) throws IOException {
        String data = utf8(zip, path, 256 * 1024);
        return data.isEmpty() ? new JsonObject() : object(JsonFiles.JSON.fromJson(data, JsonObject.class));
    }

    private static String utf8(ZipFile zip, String name, int max) throws IOException {
        byte[] bytes = member(zip, name, max);
        return bytes == null ? "" : new String(bytes, StandardCharsets.UTF_8);
    }

    private static byte[] icon(ZipFile zip, String... names) throws IOException {
        for (String name : names) {
            byte[] content = member(zip, name, ICON_LIMIT);
            if (content != null && ArtworkCache.mime(content) != null) return content;
        }
        return null;
    }

    private static byte[] member(ZipFile zip, String name, int max) throws IOException {
        var entry = zip.getEntry(name);
        if (name.isEmpty() || entry == null || entry.isDirectory() || entry.getSize() > max) return null;
        try (var in = zip.getInputStream(entry)) {
            byte[] data = in.readNBytes(max + 1);
            return data.length <= max ? data : null;
        }
    }

    private static String image(Path file, Path root) {
        try {
            if (Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS) && file.toRealPath().startsWith(root.toRealPath())
                && Files.size(file) <= ICON_LIMIT) return image(Files.readAllBytes(file));
        } catch (IOException ignored) { /* The file can be listed without a custom icon. */ }
        return "";
    }

    private static String image(byte[] data) {
        if (data == null) return "";
        String mime = ArtworkCache.mime(data);
        return mime == null ? "" : "data:" + mime + ";base64," + Base64.getEncoder().encodeToString(data);
    }

    private static Map<String, String> installedIcons(Path root, Path directory, String kind, JsonObject request) {
        var result = new HashMap<String, String>();
        try {
            Path lock = kind.equals("datapacks") && !text(request, "world", "").isBlank()
                ? GameFiles.target(directory.getParent(), "kxl-datapacks.json")
                : GameFiles.target(LocalGameFiles.instance(root, request), "installed-projects.json");
            for (var record : object(JsonFiles.read(lock)).entrySet()) {
                var row = object(record.getValue());
                String url = ResourceCatalog.https(text(row, "icon_url", ""));
                if (url != null) result.put(text(row, "file", ""), url);
            }
        } catch (IOException | JsonParseException ignored) { /* Imported or older packs may have no installation record. */ }
        return result;
    }
}
