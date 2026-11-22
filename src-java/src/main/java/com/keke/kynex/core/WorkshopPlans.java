package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Base64;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.array;
import static com.keke.kynex.core.LaunchManifest.object;

final class WorkshopPlans {
    static final long LIMIT = 2L * 1024 * 1024 * 1024;
    static final Map<String, String> GROUPS = Map.of("mods", "mods", "resourcePacks", "resourcepacks", "shaders", "shaderpacks");
    private static final Set<String> LOADERS = Set.of("vanilla", "forge", "neoforge", "fabric", "quilt", "optifine");
    private static final Set<String> LOCALIZATION = Set.of("none", "cfpa", "ai", "both");
    private final GameDownloads downloads;
    private final CatalogNetwork network;
    private final ResourceCatalog resources;
    private final LoaderCatalog catalog;

    WorkshopPlans(GameDownloads downloads, CatalogNetwork network, ResourceCatalog resources, LoaderCatalog catalog) {
        this.downloads = downloads;
        this.network = network;
        this.resources = resources;
        this.catalog = catalog;
    }

    static JsonObject parse(JsonObject input) throws IOException {
        keys(input, "version", "name", "minecraft", "loader", "memoryMb", "java", "mods", "resourcePacks", "shaders", "localization",
            "options", "configPatches", "notes", "estimatedDownloadBytes", "warnings");
        String name = required(input, "name");
        String game = required(input, "minecraft");
        LaunchManifest.safeName(game);
        long schema = number(input, "version", 0), memory = number(input, "memoryMb", 0), bytes = number(input, "estimatedDownloadBytes", 0);
        if (schema != 1 || name.isBlank() || name.length() > 80 || name.codePoints().anyMatch(Character::isISOControl)) throw new IOException("计划名称或格式无效");
        if (memory < 512 || memory > 65_536 || bytes < 0 || bytes > LIMIT || !"auto".equals(text(input, "java", "auto")))
            throw new IOException("计划的内存、Java 或下载预算无效");
        JsonObject requestedLoader = object(input.get("loader"));
        keys(requestedLoader, "type", "version");
        String loader = required(requestedLoader, "type"), release = text(requestedLoader, "version", "");
        if (!LOADERS.contains(loader) || !loader.equals("vanilla") && release.isEmpty()) throw new IOException("加载器或版本无效");
        if (!release.isEmpty()) LaunchManifest.safeName(release);
        JsonObject lang = object(input.get("localization"));
        keys(lang, "mode", "note");
        String mode = text(lang, "mode", "none"), details = text(lang, "note", "");
        if (!LOCALIZATION.contains(mode) || details.length() > 2000) throw new IOException("汉化选项无效");
        var found = new HashSet<String>();
        JsonArray mods = entries(input, "mods", 80, found);
        JsonArray packs = entries(input, "resourcePacks", 20, found);
        JsonArray shaders = entries(input, "shaders", 20 - packs.size(), found);
        var options = object(input.get("options"));
        var cleanOptions = new JsonObject();
        for (var item : options.entrySet().stream().sorted(Map.Entry.comparingByKey()).toList()) {
            WorkshopConfig.option(item.getKey(), item.getValue());
            cleanOptions.add(item.getKey(), item.getValue());
        }
        var patches = new JsonArray();
        for (JsonElement raw : entries(input, "configPatches", 20)) patches.add(WorkshopConfig.patch(object(raw)));
        JsonArray notes = strings(input, "notes", 40);
        JsonArray warnings = strings(input, "warnings", 80);
        return json("version", 1, "name", name, "minecraft", game, "loader", json("type", loader, "version", release),
            "memoryMb", memory, "java", "auto", "mods", mods, "resourcePacks", packs, "shaders", shaders,
            "localization", json("mode", mode, "note", details), "options", cleanOptions, "configPatches", patches, "notes", notes,
            "estimatedDownloadBytes", bytes, "warnings", warnings);
    }

    JsonObject check(Path root, JsonObject input, JsonObject settings, MinecraftInstaller.Progress progress) throws IOException, InterruptedException {
        JsonObject plan = parse(input);
        String game = required(plan, "minecraft"), loader = required(object(plan.get("loader")), "type");
        JsonObject base = new MinecraftCatalog(downloads).version(root, game, false, progress::stopped);
        if (!game.equals(text(base, "id", ""))) throw new IOException("游戏版本不存在");
        String selected = text(object(plan.get("loader")), "version", "");
        if (!loader.equals("vanilla") && catalog.versions(root, game, loader, false, false).asList().stream()
            .noneMatch(value -> selected.equals(value.getAsString()))) throw new IOException("加载器版本与游戏不兼容或不存在");
        long size = number(object(object(base.get("downloads")).get("client")), "size", 0);
        for (JsonElement lib : array(base.get("libraries"))) size += number(object(object(object(lib).get("downloads")).get("artifact")), "size", 0);
        for (var group : GROUPS.entrySet()) {
            for (JsonElement raw : array(plan.get(group.getKey()))) {
                GameDownloads.check(progress::stopped);
                size += resource(object(raw), game, loader, group.getValue(), settings);
                if (size > LIMIT) throw new IOException("计划超过 2 GB 下载预算");
            }
        }
        plan.addProperty("estimatedDownloadBytes", size);
        return plan;
    }

    long resource(JsonObject item, String game, String loader, String kind, JsonObject settings) throws IOException, InterruptedException {
        String project = required(item, "projectId"), version = required(item, "versionId"), source = required(item, "source");
        JsonObject row;
        if ("modrinth".equals(source)) {
            row = object(network.json("https://api.modrinth.com/v2/version/" + version, ""));
            if (!project.equals(text(row, "project_id", "")) || !version.equals(text(row, "id", "")) || !includes(array(row.get("game_versions")), game)
                || kind.equals("mods") && !includes(array(row.get("loaders")), loader)) throw invalidResource(item);
            JsonObject file = ResourceVersions.modrinthFile(row, kind);
            if (file == null || !text(object(file.get("hashes")), "sha1", "").matches("[A-Fa-f0-9]{40}")) throw invalidResource(item);
            String address = ResourceCatalog.https(text(file, "url", ""));
            if (address == null || !"cdn.modrinth.com".equals(java.net.URI.create(address).getHost())) throw invalidResource(item);
            return size(file, "size");
        }
        row = object(object(resources.curseforge("/mods/" + project + "/files/" + version, Map.of(), settings)).get("data"));
        if (!project.equals(id(row.get("modId"))) || !version.equals(id(row.get("id"))) || LaunchManifest.is(row.get("isAvailable"), false)
            || !includes(array(row.get("gameVersions")), game) || !ResourceVersions.extension(text(row, "fileName", ""), kind)) throw invalidResource(item);
        var loaderLabels = array(row.get("gameVersions")).asList().stream().map(JsonElement::getAsString).map(value -> value.toLowerCase(java.util.Locale.ROOT))
            .filter(LOADERS::contains).toList();
        if (kind.equals("mods") && !loaderLabels.isEmpty() && !loaderLabels.contains(loader)) throw invalidResource(item);
        String url = ResourceCatalog.https(text(row, "downloadUrl", ""));
        if (url == null || !java.net.URI.create(url).getHost().endsWith(".forgecdn.net") || array(row.get("hashes")).asList().stream()
            .map(LaunchManifest::object).noneMatch(value -> number(value, "algo", 0) == 1 && text(value, "value", "").matches("[A-Fa-f0-9]{40}")))
            throw invalidResource(item);
        return size(row, "fileLength");
    }

    static JsonObject installation(String instance, JsonObject item, String kind, JsonObject preferences) {
        return json("id", instance, "kind", kind, "source", required(item, "source"), "project", required(item, "projectId"),
            "versionId", required(item, "versionId"), "name", required(item, "name"), "curseforgeKey", text(preferences, "curseforgeKey", ""));
    }

    static String hash(JsonObject plan) throws IOException { return ResourceHashes.hash(parse(plan).toString()); }

    static String share(JsonObject original) throws IOException {
        JsonObject plan = parse(original);
        plan.addProperty("name", AssistantService.redact(required(plan, "name"), ""));
        plan.add("notes", new JsonArray());
        plan.add("warnings", new JsonArray());
        plan.addProperty("estimatedDownloadBytes", 0);
        object(plan.get("localization")).addProperty("note", "");
        object(plan.get("options")).entrySet().removeIf(value -> !Set.of("language", "renderDistance", "simulationDistance", "maxFps", "guiScale").contains(value.getKey()));
        for (String kind : GROUPS.keySet()) for (JsonElement raw : array(plan.get(kind))) {
            var item = object(raw);
            item.addProperty("name", AssistantService.redact(required(item, "name"), ""));
            item.addProperty("reason", "");
        }
        array(plan.get("configPatches")).asList().removeIf(raw -> {
            JsonObject values = object(object(raw).get("set"));
            return !AssistantService.redact(values.toString(), "").equals(values.toString());
        });
        var buffer = new ByteArrayOutputStream();
        try (var zip = new ZipOutputStream(buffer)) {
            zip.putNextEntry(new ZipEntry("plan.json"));
            zip.write(parse(plan).toString().getBytes(StandardCharsets.UTF_8));
            zip.closeEntry();
        }
        byte[] packed = buffer.toByteArray();
        String code = "KXL1." + Base64.getUrlEncoder().withoutPadding().encodeToString(packed) + "." + checksum(packed);
        if (code.length() > 8192) throw new IOException("计划压缩后超过 8 KB，请缩小分享范围");
        return code;
    }

    static JsonObject decode(String input) throws IOException {
        String value = input.strip();
        if (value.length() > 8192 || !value.matches("KXL1\\.[A-Za-z0-9_-]+\\.[a-f0-9]{8}")) throw new IOException("分享码格式无效");
        String[] parts = value.split("\\.");
        try {
            byte[] packed = Base64.getUrlDecoder().decode(parts[1]);
            if (!checksum(packed).equals(parts[2])) throw new IOException("分享码校验失败");
            try (var archive = new ZipInputStream(new ByteArrayInputStream(packed))) {
                ZipEntry row = archive.getNextEntry();
                if (row == null || !"plan.json".equals(row.getName())) throw new IOException("分享码缺少计划文件");
                byte[] bytes = archive.readNBytes(128 * 1024 + 1);
                if (bytes.length > 128 * 1024 || archive.getNextEntry() != null) throw new IOException("分享码文件过大或包含额外数据");
                return parse(object(JsonFiles.JSON.fromJson(new String(bytes, StandardCharsets.UTF_8), JsonElement.class)));
            }
        } catch (IllegalArgumentException | JsonParseException invalid) { throw new IOException("分享码格式无效"); }
    }

    private static String checksum(byte[] packed) { return HexFormat.of().formatHex(ResourceHashes.digest("SHA-256").digest(packed)).substring(0, 8); }

    private static JsonArray entries(JsonObject parent, String key, int limit, Set<String> seen) throws IOException {
        var result = new JsonArray();
        for (var raw : entries(parent, key, limit)) {
            JsonObject item = object(raw);
            keys(item, "source", "projectId", "versionId", "name", "side", "reason", "required");
            String source = required(item, "source"), project = required(item, "projectId"), version = required(item, "versionId");
            String name = required(item, "name"), side = text(item, "side", "both"), reason = text(item, "reason", "");
            if (!Set.of("modrinth", "curseforge").contains(source) || !Set.of("client", "server", "both").contains(side)
                || name.isBlank() || name.length() > 240 || reason.length() > 2000) throw new IOException("资源来源、用途或说明无效");
            String identity = source.equals("curseforge") ? "[0-9]{1,18}" : "[A-Za-z0-9_-]{1,120}";
            if (!project.matches(identity) || !version.matches(identity) || !seen.add(source + ":" + project)) throw new IOException("计划包含无效或重复的资源");
            result.add(json("source", source, "projectId", project, "versionId", version, "name", name, "side", side, "reason", reason,
                "required", LaunchManifest.is(item.get("required"), true)));
        }
        return result;
    }

    private static JsonArray strings(JsonObject input, String key, int max) throws IOException {
        JsonArray values = entries(input, key, max);
        for (JsonElement value : values) if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString() || value.getAsString().length() > 2000)
            throw new IOException("计划说明无效");
        return values.deepCopy();
    }

    private static JsonArray entries(JsonObject input, String key, int max) throws IOException {
        if (!input.has(key)) return new JsonArray();
        if (!(input.get(key) instanceof JsonArray values) || values.size() > max) throw new IOException("计划资源数量或格式无效：" + key);
        return values;
    }

    static boolean includes(JsonArray items, String value) { return items.asList().stream().anyMatch(raw -> raw.isJsonPrimitive() && value.equals(raw.getAsString())); }
    private static IOException invalidResource(JsonObject item) { return new IOException(required(item, "name") + " 的下载文件或兼容版本无法确认"); }
    private static long size(JsonObject file, String key) throws IOException {
        long size = number(file, key, 0);
        if (size <= 0 || size > LIMIT) throw new IOException("资源文件体积无效");
        return size;
    }
    static long number(JsonObject value, String key, long otherwise) { return ResourceCatalog.number(value, key, otherwise); }
    static String id(JsonElement value) { return value != null && value.isJsonPrimitive() ? value.getAsString() : ""; }

    static void keys(JsonObject object, String... names) throws IOException {
        if (!Set.of(names).containsAll(object.keySet())) throw new IOException("计划含不支持的字段");
    }

    static JsonObject json(Object... values) {
        var result = new JsonObject();
        for (int i = 0; i < values.length; i += 2) result.add((String) values[i], JsonFiles.JSON.toJsonTree(values[i + 1]));
        return result;
    }
}
