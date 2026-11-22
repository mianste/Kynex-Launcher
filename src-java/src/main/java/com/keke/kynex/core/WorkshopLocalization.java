package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;
import java.util.zip.ZipFile;

import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.array;
import static com.keke.kynex.core.LaunchManifest.object;
import static com.keke.kynex.core.WorkshopPlans.json;
import static com.keke.kynex.core.WorkshopPlans.number;

final class WorkshopLocalization {
    private static final String COMMUNITY = "https://github.com/CFPAOrg/Minecraft-Mod-Language-Package/releases/download/";
    private static final String RELEASES = "https://api.github.com/repos/CFPAOrg/Minecraft-Mod-Language-Package/releases";
    private static final Pattern RESOURCE_LINE = Pattern.compile("(?m)^resourcePacks:([^\r\n]*)");
    private final CatalogNetwork network;
    private final GameDownloads downloads;
    private final Path dataRoot;

    WorkshopLocalization(Path dataRoot, CatalogNetwork network, GameDownloads downloads) {
        this.dataRoot = dataRoot;
        this.network = network;
        this.downloads = downloads;
    }

    String applyPlan(Path instance, JsonObject plan, MinecraftInstaller.Progress progress) throws IOException, InterruptedException {
        String game = required(plan, "minecraft"), mode = text(object(plan.get("localization")), "mode", "none");
        GameOptions.applyLanguage(instance, game, "zh_cn");
        if (mode.equals("none")) return "已将游戏语言设为简体中文";
        String note = "已将游戏语言设为简体中文";
        if (!mode.equals("ai")) {
            try { note = required(community(instance, progress), "note"); }
            catch (IOException skipped) {
                GameDownloads.check(progress::stopped);
                note += "。社区汉化已跳过：" + AssistantService.redact(skipped.getMessage(), "");
            }
        }
        if (mode.equals("ai") || mode.equals("both")) note += "。机器补译请在汉化面板核对用量并确认。";
        return note;
    }

    JsonObject community(Path instance, MinecraftInstaller.Progress progress) throws IOException, InterruptedException {
        var config = LocalGameFiles.configuration(instance);
        String game = required(config, "version"), loader = required(config, "loader");
        LaunchManifest.safeName(game);
        LaunchManifest.safeName(loader);
        Path custom = GameFiles.target(dataRoot, "localization-sources.json");
        var sources = Files.isRegularFile(custom, LinkOption.NOFOLLOW_LINKS) ? object(JsonFiles.read(custom)) : WorkshopTemplates.bundled("localization-sources.json");
        var match = array(sources.get("sources")).asList().stream().map(LaunchManifest::object)
            .filter(row -> WorkshopPlans.includes(array(row.get("minecraft")), game) && WorkshopPlans.includes(array(row.get("loaders")), loader))
            .findFirst().orElseThrow(() -> new IOException("没有适用的社区汉化源"));
        String url = text(match, "downloadUrl", ""), sha = text(match, "sha256", "");
        if (url.isEmpty()) {
            String api = required(match, "releasesApi");
            if (!api.matches(Pattern.quote(RELEASES) + "(?:\\?per_page=[0-9]{1,2}|/latest)?")) throw new IOException("CFPA 发布地址无效");
            JsonElement releases = network.json(api, "");
            var rows = releases instanceof JsonArray list ? list.asList() : List.of(releases);
            var asset = rows.stream().flatMap(row -> array(object(row).get("assets")).asList().stream()).map(LaunchManifest::object)
                .filter(row -> required(match, "assetName").equals(text(row, "name", ""))).findFirst()
                .orElseThrow(() -> new IOException("CFPA 发布中没有适用资源包"));
            url = text(asset, "browser_download_url", "");
            sha = text(asset, "digest", "").replaceFirst("^sha256:", "");
        }
        if (!allowed(url) || !sha.matches("[A-Fa-f0-9]{64}")) throw new IOException("社区汉化的下载地址或 SHA-256 无法验证");
        String name = "CFPA-" + game + "-" + loader + ".zip";
        Path target = GameFiles.target(instance, "resourcepacks/" + name);
        if (Files.isRegularFile(target, LinkOption.NOFOLLOW_LINKS) && GameDownloads.matches(target, sha, progress::stopped)) {
            validate(target, packFormat(instance), loader);
        }
        else {
            Path temporary = Files.createTempFile(target.getParent(), ".kxl-cfpa-", ".zip");
            try {
                progress.update("下载并校验社区汉化", 0, 1);
                downloads.file(url, false, temporary, sha, 512 * 1024 * 1024, progress::stopped);
                validate(temporary, packFormat(instance), loader);
                progress.save(temporary, target);
            } finally { Files.deleteIfExists(temporary); }
        }
        GameDownloads.check(progress::stopped);
        setPack(instance, name, true);
        GameOptions.applyLanguage(instance, game, "zh_cn");
        return json("enabled", true, "community", true, "note", "已启用通过校验的 CFPA 社区汉化，并将游戏语言设为简体中文");
    }

    static JsonObject setPack(Path instance, String name, boolean enabled) throws IOException {
        LaunchManifest.safeName(name);
        Path options = GameFiles.target(instance, "options.txt");
        Path bundled = GameFiles.target(instance, "config/yosbr/options.txt");
        if (!Files.isRegularFile(options) && Files.isRegularFile(bundled)) options = bundled;
        var version = required(LocalGameFiles.configuration(instance), "version");
        boolean legacy = version.matches("1\\.(?:[0-9]|1[0-2])(?:\\..*)?");
        String previous = Files.isRegularFile(options) ? Files.readString(options) : "";
        var match = RESOURCE_LINE.matcher(previous);
        boolean present = match.find();
        var entries = new ArrayList<String>();
        if (present) {
            try {
                var raw = JsonFiles.JSON.fromJson(match.group(1), JsonArray.class);
                for (var row : raw) {
                    if (!row.isJsonPrimitive() || !row.getAsJsonPrimitive().isString()) throw new IOException("游戏资源包列表格式无效");
                    entries.add(row.getAsString());
                }
            } catch (RuntimeException invalid) { throw new IOException("游戏资源包列表格式无效，请在游戏内重新保存", invalid); }
        } else if (enabled && !legacy) entries.add("vanilla");
        var before = List.copyOf(entries);
        entries.removeIf(value -> value.equals(name) || value.equals("file/" + name));
        if (enabled) {
            int position = entries.size();
            if (name.equals("KXL-AI-Localization")) {
                for (int i = 0; i < entries.size(); i++) if (entries.get(i).replaceFirst("^file/", "").startsWith("CFPA-")) { position = i; break; }
            }
            entries.add(position, legacy ? name : "file/" + name);
        }
        if (entries.equals(before)) return json("enabled", enabled, "changed", false);
        String newline = previous.contains("\r\n") ? "\r\n" : "\n";
        String line = "resourcePacks:" + JsonFiles.JSON.toJsonTree(entries);
        String output = present ? match.replaceFirst(java.util.regex.Matcher.quoteReplacement(line)) :
            previous + (previous.isEmpty() || previous.endsWith("\n") ? "" : newline) + line + newline;
        JsonFiles.atomicWrite(options, output.getBytes(StandardCharsets.UTF_8));
        return json("enabled", enabled, "changed", true);
    }

    static long packFormat(Path instance) throws IOException {
        try (var jar = new ZipFile(GameFiles.target(instance, "client.jar").toFile())) {
            var entry = jar.getEntry("version.json");
            long format = entry == null ? 0 : number(object(zipEntry(jar, "version.json").get("pack_version")), "resource", 0);
            if (format != 0) return format;
            if (required(LocalGameFiles.configuration(instance), "version").matches("1\\.12(?:\\..*)?")
                && jar.getEntry("assets/minecraft/lang/en_us.lang") != null) return 3;
            throw new IOException("客户端缺少资源包格式信息");
        }
    }

    private static void validate(Path file, long format, String loader) throws IOException {
        try (var zip = new ZipFile(file.toFile())) {
            var pack = object(zipEntry(zip, "pack.mcmeta").get("pack"));
            JsonElement supported = pack.get("supported_formats");
            long min = number(pack, "pack_format", -1), max = min;
            if (supported instanceof JsonObject range) {
                min = number(range, "min_inclusive", min);
                max = number(range, "max_inclusive", max);
            } else if (supported instanceof JsonArray limits && limits.size() == 2) {
                min = limits.get(0).getAsLong();
                max = limits.get(1).getAsLong();
            } else if (supported != null && supported.isJsonPrimitive()) {
                min = supported.getAsLong();
                max = min;
            }
            if (format < min || format > max) throw new IOException("社区汉化包与客户端资源包格式不兼容");
            String label = String.valueOf(pack.get("description")).toLowerCase(Locale.ROOT);
            if ((label.contains("仅限") || label.contains("only")) &&
                (label.contains("forge") && !List.of("forge", "neoforge").contains(loader) || label.contains("fabric") && !loader.equals("fabric")))
                throw new IOException("社区汉化包与加载器不兼容");
        } catch (RuntimeException invalid) { throw new IOException("社区汉化包元数据无效", invalid); }
    }

    private static JsonObject zipEntry(ZipFile zip, String name) throws IOException {
        var entry = zip.getEntry(name);
        if (entry == null || entry.getSize() > 65536) throw new IOException("资源包元数据无效");
        try (var input = zip.getInputStream(entry)) {
            byte[] bytes = input.readNBytes(65537);
            if (bytes.length > 65536) throw new IOException("资源包元数据过大");
            return object(JsonFiles.JSON.fromJson(new String(bytes, StandardCharsets.UTF_8), JsonElement.class));
        }
    }

    private static boolean allowed(String text) {
        try {
            var uri = URI.create(text);
            return ResourceCatalog.https(text) != null && "github.com".equals(uri.getHost()) && text.startsWith(COMMUNITY)
                && uri.getPort() == -1 && uri.getFragment() == null;
        } catch (IllegalArgumentException invalid) { return false; }
    }
}
