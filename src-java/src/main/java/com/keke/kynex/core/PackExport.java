package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.array;
import static com.keke.kynex.core.LaunchManifest.object;

final class PackExport {
    private static final long FILE_LIMIT = 2L * 1024 * 1024 * 1024;
    private static final List<String> CONFIG = List.of("config", "defaultconfigs", "journeymap/config");
    private static final List<String> ESSENTIAL = List.of("kubejs", "scripts", "openloader", "global_packs", "global_resource_packs", "global_data_packs",
        "resources", "structures", "patchouli_books");
    private static final List<String> MAP_DATA = List.of("journeymap/data", "xaero", "XaeroWaypoints", "XaeroWorldMap");
    private static final List<String> OPTIONS = List.of("options.txt", "optionsof.txt", "optionsshaders.txt", "configureddefaults");
    private static final List<String> LICENSES = List.of("license", "license.md", "license.txt", "copying", "copying.txt");
    private static final Set<String> PRIVATE = Set.of("accounts.json", "launcher_accounts.json", "launcher_profiles.json", "microsoft_accounts.json",
        "credentials.json", "tokens.json", "usercache.json", "usernamecache.json", "servers.dat", "servers.dat_old", "kxl.json", "version.json", ".env");
    private static final Set<String> SKIP = Set.of("logs", "crash-reports", ".git", ".connector");
    private static final Map<String, String> DEPENDENCIES = Map.of("forge", "forge", "neoforge", "neoforge", "fabric", "fabric-loader", "quilt", "quilt-loader");
    private static final Map<String, String> COMPONENTS = Map.of("forge", "net.minecraftforge", "neoforge", "net.neoforged",
        "fabric", "net.fabricmc.fabric-loader", "quilt", "org.quiltmc.quilt-loader");
    private static final List<Group> GROUPS = List.of(
        new Group("options", "游戏本体设置", "键位、音量、视频设置等", true, "", OPTIONS, false),
        new Group("mods", "Mod", "启用的模组", true, "", List.of("mods"), true),
        new Group("config", "Mod 设置", "模组配置与默认配置", true, "mods", CONFIG, false),
        new Group("important", "整合包重要数据", "脚本、全局资源和内置数据", true, "mods", ESSENTIAL, false),
        new Group("disabledMods", "已停用的 Mod", ".disabled / .old 文件", false, "mods", List.of("mods"), true),
        new Group("mapData", "已绘制的地图", "地图、路标点等个人记录", false, "mods", MAP_DATA, false),
        new Group("jeiData", "JEI 个人信息", "物品收藏夹与世界记录", false, "mods", List.of("config/jei/world", "config/jei"), false),
        new Group("resourcepacks", "资源包", "纹理包 / 材质包", true, "", List.of("resourcepacks", "texturepacks"), true),
        new Group("shaderpacks", "光影", "光影包", true, "", List.of("shaderpacks"), true),
        new Group("datapacks", "数据包", "实例级待安装文件", true, "", List.of("datapacks"), true),
        new Group("saves", "单人游戏存档", "世界 / 地图", false, "", List.of("saves"), true));
    private final CatalogNetwork network;

    private record Group(String id, String label, String description, boolean initial, String parent, List<String> roots, boolean expand) {}
    private record Snapshot(Path path, long size, java.nio.file.attribute.FileTime modified) {}
    private record Remote(String relative, String sha, long size) {}

    PackExport(CatalogNetwork network) { this.network = network; }

    JsonObject options(Path root, Path dataRoot, JsonObject payload) throws IOException {
        Path game = LocalGameFiles.running(root, dataRoot, payload).toRealPath();
        var groups = new JsonArray();
        for (Group group : GROUPS) {
            var items = new JsonArray();
            for (String entry : group.roots()) {
                Path path = game.resolve(entry);
                if (!safe(game, path)) continue;
                if ((group.expand() || entry.equals("config/jei")) && Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS)) {
                    try (var children = Files.list(path)) {
                        for (Path child : children.sorted().toList()) {
                            if (!safe(game, child)) continue;
                            boolean dir = Files.isDirectory(child, LinkOption.NOFOLLOW_LINKS);
                            String relative = relative(game, child);
                            if (group.id().equals(category(relative + (dir ? "/_" : ""))) && !relative.equals("config/jei/world"))
                                items.add(item(relative, child.getFileName().toString(), child, dir));
                        }
                    }
                } else items.add(item(entry, entry, path, Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS)));
            }
            if (!items.isEmpty()) groups.add(values("id", group.id(), "label", group.label(), "description", group.description(),
                "defaultChecked", group.initial(), "parent", group.parent(), "items", items));
        }
        return values("instance", metadata(LocalGameFiles.instance(root, payload)), "groups", groups);
    }

    JsonObject export(Path root, Path dataRoot, JsonObject payload, MinecraftInstaller.Progress progress) throws IOException {
        Path instance = LocalGameFiles.instance(root, payload);
        Path game = LocalGameFiles.running(root, dataRoot, payload).toRealPath();
        Path proposed = Path.of(required(payload, "path"));
        if (!proposed.isAbsolute() || proposed.getFileName() == null || proposed.getParent() == null) throw new IOException("请选择完整的导出路径");
        Path parent = proposed.getParent().toRealPath();
        Path output = parent.resolve(proposed.getFileName());
        if (parent.startsWith(game) || parent.startsWith(instance)) throw new IOException("导出位置必须在游戏目录外");
        if (Files.exists(output, LinkOption.NOFOLLOW_LINKS) && (!Files.isRegularFile(output, LinkOption.NOFOLLOW_LINKS) || !output.equals(output.toRealPath())))
            throw new IOException("导出位置不是普通文件");
        String format = text(payload, "format", "mrpack");
        String suffix = format.equals("mrpack") ? ".mrpack" : ".zip";
        if (!output.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(suffix)) throw new IOException("导出文件扩展名应为 " + suffix);
        JsonObject info = metadata(instance);
        String loader = text(info, "loader", "vanilla");
        String loaderVersion = text(info, "loaderVersion", "");
        if (!loader.equals("vanilla") && loaderVersion.isEmpty()) throw new IOException("无法确定加载器版本，请先修复此实例");
        if (!format.equals("kynex") && (loader.equals("optifine") || !text(info, "optifineVersion", "").isEmpty()))
            throw new IOException("此实例包含 OptiFine，请使用 KXL ZIP");
        info.addProperty("name", label(text(payload, "name", text(info, "name", "KXL Modpack")), "KXL Modpack"));
        info.addProperty("packVersion", label(text(payload, "packVersion", "1.0.0"), "1.0.0"));
        var files = select(game, payload, progress);
        var online = new LinkedHashMap<String, JsonObject>();
        var warnings = new JsonArray();
        if (format.equals("mrpack") && LaunchManifest.is(payload.get("bundleResources"), false)) link(files, progress, online, warnings);
        Path staging = Files.createTempFile(parent, ".kxl-export-", ".part");
        try {
            try (var zip = new ZipOutputStream(Files.newOutputStream(staging))) {
                var image = icon(LocalGameFiles.configuration(instance));
                if (image != null) {
                    info.addProperty("packIcon", "data:image/png;base64," + Base64.getEncoder().encodeToString(image));
                    entry(zip, "icon.png", image);
                }
                String prefix = manifest(zip, format, info, online);
                int done = 0;
                for (var item : files.entrySet()) {
                    GameDownloads.check(progress::stopped);
                    var remote = online.get(item.getKey());
                    if (remote == null) write(zip, prefix + item.getKey(), item.getValue(), progress);
                    else if (!GameDownloads.matches(item.getValue().path(), required(object(remote.get("hashes")), "sha1"), progress::stopped))
                        throw new IOException("资源文件已发生变化，请重新导出");
                    progress.update("打包所选文件", ++done, files.size());
                }
            }
            progress.save(staging, output);
        } finally { Files.deleteIfExists(staging); }
        return values("path", output.toString(), "files", files.size(), "onlineFiles", online.size(), "embeddedFiles", files.size() - online.size(),
            "warnings", warnings);
    }

    JsonObject estimate(Path root, Path dataRoot, JsonObject payload, MinecraftInstaller.Progress progress) throws IOException {
        Path game = LocalGameFiles.running(root, dataRoot, payload).toRealPath();
        var files = select(game, payload, progress);
        long bytes = files.values().stream().mapToLong(Snapshot::size).sum();
        return values("estimatedBytes", bytes, "files", files.size(), "requiresConfirmation", true,
            "note", "体积为压缩前估算。");
    }

    private static Map<String, Snapshot> select(Path game, JsonObject payload, MinecraftInstaller.Progress progress) throws IOException {
        if (!(payload.get("include") instanceof JsonArray groups)) throw new IOException("请选择导出内容");
        var selected = new java.util.LinkedHashSet<String>();
        for (JsonElement group : groups) {
            if (!group.isJsonPrimitive() || GROUPS.stream().noneMatch(item -> item.id().equals(group.getAsString()))) throw new IOException("不允许导出该目录");
            selected.add(group.getAsString());
        }
        if (ResourceCatalog.number(payload, "selectionVersion", 0) != 1 && selected.contains("config")) selected.add("important");
        var choices = new LinkedHashMap<String, List<String>>();
        for (var group : object(payload.get("choices")).entrySet()) {
            if (!(group.getValue() instanceof JsonArray array)) throw new IOException("文件选择无效");
            var names = new ArrayList<String>();
            for (JsonElement item : array) {
                if (!item.isJsonPrimitive() || !item.getAsJsonPrimitive().isString()) throw new IOException("导出路径无效");
                String name = item.getAsString();
                for (String part : name.split("/", -1)) LaunchManifest.safeName(part);
                if (name.isBlank() || name.contains("\\") || List.of(name.split("/")).stream().anyMatch(part -> part.equals("..") || part.equals(".")))
                    throw new IOException("导出路径无效");
                names.add(name);
            }
            choices.put(group.getKey(), names);
        }
        var result = new TreeMap<String, Snapshot>();
        var roots = new java.util.LinkedHashSet<String>();
        GROUPS.stream().filter(group -> selected.contains(group.id())).forEach(group -> roots.addAll(group.roots()));
        try (var children = Files.list(game)) {
            for (Path file : children.filter(path -> Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)).toList()) {
                if (LICENSES.contains(file.getFileName().toString().toLowerCase(Locale.ROOT))) roots.add(file.getFileName().toString());
            }
        }
        long[] size = {0};
        for (String name : roots) {
            Path start = game.resolve(name);
            if (!safe(game, start)) continue;
            Files.walkFileTree(start, Set.of(), 100, new SimpleFileVisitor<>() {
                @Override public FileVisitResult preVisitDirectory(Path folder, BasicFileAttributes attr) throws IOException {
                    GameDownloads.check(progress::stopped);
                    String path = relative(game, folder).toLowerCase(Locale.ROOT);
                    if (!safe(game, folder) || List.of(path.split("/")).stream().anyMatch(SKIP::contains)
                        || path.equals("config/jei/world") && !selected.contains("jeiData")
                        || path.equals("journeymap/data") && !selected.contains("mapData")) return FileVisitResult.SKIP_SUBTREE;
                    return FileVisitResult.CONTINUE;
                }
                @Override public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
                    GameDownloads.check(progress::stopped);
                    if (!attrs.isRegularFile() || !safe(game, file)) return FileVisitResult.CONTINUE;
                    String path = relative(game, file);
                    String group = category(path);
                    if (group == null || !group.equals("license") && (!selected.contains(group) || choices.containsKey(group)
                        && choices.get(group).stream().noneMatch(choice -> path.equals(choice) || path.startsWith(choice + "/")))) return FileVisitResult.CONTINUE;
                    if (result.containsKey(path)) return FileVisitResult.CONTINUE;
                    size[0] += attrs.size();
                    if (attrs.size() > FILE_LIMIT || size[0] > FILE_LIMIT * 8 || result.size() >= 200_000) throw new IOException("导出文件数量或体积超过限制");
                    result.put(path, new Snapshot(file, attrs.size(), attrs.lastModifiedTime()));
                    return FileVisitResult.CONTINUE;
                }
            });
        }
        return result;
    }

    private void link(Map<String, Snapshot> files, MinecraftInstaller.Progress progress, Map<String, JsonObject> output,
                      JsonArray warnings) throws IOException {
        var candidates = new ArrayList<Remote>();
        var valid = Set.of("mods", "resourcepacks", "shaderpacks");
        for (var item : files.entrySet()) {
            String kind = category(item.getKey());
            if (!valid.contains(kind) || !ResourceVersions.extension(item.getKey(), kind)) continue;
            var source = item.getValue();
            var sha = ResourceHashes.digest("SHA-1");
            long size = 0;
            try (var stream = Files.newInputStream(source.path())) {
                var buffer = new byte[64 * 1024];
                for (int read; (read = stream.read(buffer)) >= 0;) {
                    GameDownloads.check(progress::stopped);
                    size += read;
                    if (size > source.size()) throw new IOException("资源文件在打包时发生变化");
                    sha.update(buffer, 0, read);
                }
            }
            verify(source, size);
            candidates.add(new Remote(item.getKey(), java.util.HexFormat.of().formatHex(sha.digest()), size));
            progress.update("识别可在线下载的资源", candidates.size(), files.size());
        }
        for (int i = 0; i < candidates.size(); i += 100) {
            GameDownloads.check(progress::stopped);
            var batch = candidates.subList(i, Math.min(candidates.size(), i + 100));
            try {
                var response = object(network.post("https://api.modrinth.com/v2/version_files", "", values("hashes",
                    batch.stream().map(Remote::sha).distinct().toList(), "algorithm", "sha1")));
                for (Remote item : batch) {
                    for (var raw : array(object(response.get(item.sha())).get("files"))) {
                        var remote = object(raw);
                        var hashes = object(remote.get("hashes"));
                        String url = ResourceCatalog.https(text(remote, "url", ""));
                        if (url == null || !"cdn.modrinth.com".equals(URI.create(url).getHost()) || URI.create(url).getPort() != -1
                            || !item.sha().equals(text(hashes, "sha1", "")) || !text(hashes, "sha512", "").matches("[a-fA-F0-9]{128}")) continue;
                        output.put(item.relative(), values("path", item.relative(), "hashes", hashes, "downloads", List.of(url),
                            "fileSize", item.size(), "env", values("client", "required", "server", "optional")));
                        break;
                    }
                }
            } catch (IOException unavailable) {
                if (warnings.isEmpty()) warnings.add("部分资源来源未能确认，已将对应文件直接打包。");
            }
        }
    }

    private static String manifest(ZipOutputStream zip, String format, JsonObject info, Map<String, JsonObject> online) throws IOException {
        String loader = text(info, "loader", "vanilla");
        String release = text(info, "loaderVersion", "");
        String game = required(info, "version");
        String name = required(info, "name");
        String edition = required(info, "packVersion");
        if (format.equals("mrpack") || format.equals("universal")) {
            var dependencies = values("minecraft", game);
            if (DEPENDENCIES.containsKey(loader)) dependencies.addProperty(DEPENDENCIES.get(loader), release);
            entry(zip, "modrinth.index.json", values("formatVersion", 1, "game", "minecraft", "versionId", edition,
                "name", name, "dependencies", dependencies, "files", online.values()));
            if (format.equals("mrpack")) return "overrides/";
        }
        if (format.equals("curseforge") || format.equals("universal")) {
            var loaders = loader.equals("vanilla") ? List.of() : List.of(values("id", loader + "-" + release, "primary", true));
            entry(zip, "manifest.json", values("minecraft", values("version", game, "modLoaders", loaders), "manifestType", "minecraftModpack",
                "manifestVersion", 1, "name", name, "version", edition, "author", "", "files", List.of(), "overrides", "overrides"));
            return "overrides/";
        }
        if (format.equals("multimc")) {
            var components = new ArrayList<>(List.of(values("uid", "net.minecraft", "version", game, "important", true)));
            if (COMPONENTS.containsKey(loader)) components.add(values("uid", COMPONENTS.get(loader), "version", release));
            entry(zip, "mmc-pack.json", values("formatVersion", 1, "components", components));
            entry(zip, "instance.cfg", ("InstanceType=OneSix\nname=" + name + "\niconKey=default\n").getBytes(StandardCharsets.UTF_8));
            return ".minecraft/";
        }
        if (!format.equals("kynex")) throw new IOException("不支持的整合包导出格式");
        entry(zip, "kxl-pack.json", info);
        return "";
    }

    private static void write(ZipOutputStream zip, String name, Snapshot file, MinecraftInstaller.Progress progress) throws IOException {
        zip.putNextEntry(new ZipEntry(name));
        long size = 0;
        try (var stream = Files.newInputStream(file.path())) {
            var buffer = new byte[64 * 1024];
            for (int count; (count = stream.read(buffer)) >= 0;) {
                GameDownloads.check(progress::stopped);
                size += count;
                if (size > file.size()) throw new IOException("文件在打包时发生变化，请重新导出");
                zip.write(buffer, 0, count);
            }
        }
        verify(file, size);
        zip.closeEntry();
    }

    private static void verify(Snapshot file, long size) throws IOException {
        if (file.size() != size || Files.size(file.path()) != size || !file.modified().equals(Files.getLastModifiedTime(file.path(), LinkOption.NOFOLLOW_LINKS))
            || !file.path().equals(file.path().toRealPath())) throw new IOException("文件在打包时发生变化，请重新导出");
    }

    private static boolean safe(Path root, Path file) throws IOException {
        return Files.exists(file, LinkOption.NOFOLLOW_LINKS) && file.startsWith(root) && file.equals(file.toRealPath());
    }

    private static JsonObject metadata(Path instance) throws IOException {
        JsonObject source = LocalGameFiles.configuration(instance);
        var result = new JsonObject();
        for (String key : List.of("name", "version", "loader", "loaderVersion", "optifineVersion")) {
            if (source.has(key) && !source.get(key).isJsonNull()) result.add(key, source.get(key));
        }
        Path manifest = instance.resolve("version.json");
        if (text(result, "loaderVersion", "").isEmpty() && Files.isRegularFile(manifest)) {
            result.addProperty("loaderVersion", PackInstaller.loader(object(JsonFiles.read(manifest)))[1]);
        }
        return result;
    }

    private static byte[] icon(JsonObject source) {
        for (String member : List.of("icon", "packIcon", "packLogo")) {
            String image = text(source, member, "");
            int split = image.indexOf(',');
            if (!image.startsWith("data:image/") || split < 0 || image.length() > 3 * 1024 * 1024) continue;
            try {
                byte[] png = Base64.getDecoder().decode(image.substring(split + 1));
                if ("image/png".equals(ArtworkCache.mime(png))) return png;
            } catch (IllegalArgumentException ignored) { /* Ignore a malformed icon. */ }
        }
        return null;
    }

    private static String relative(Path root, Path file) { return root.relativize(file).toString().replace('\\', '/'); }

    private static String category(String raw) {
        String path = raw.toLowerCase(Locale.ROOT);
        String name = path.substring(path.lastIndexOf('/') + 1);
        if (PRIVATE.contains(name) || List.of(path.split("/")).stream().anyMatch(SKIP::contains)) return null;
        if (LICENSES.contains(path)) return "license";
        if (OPTIONS.contains(path) || path.startsWith("configureddefaults/")) return "options";
        if (path.startsWith("mods/")) return path.endsWith(".disabled") || path.endsWith(".old") ? "disabledMods" : "mods";
        if (path.startsWith("config/jei/world/") || path.startsWith("config/jei/") && name.contains("bookmark")) return "jeiData";
        if (under(path, MAP_DATA)) return "mapData";
        if (under(path, CONFIG)) return "config";
        if (under(path, ESSENTIAL)) return "important";
        if (path.startsWith("texturepacks/")) return "resourcepacks";
        for (String group : List.of("resourcepacks", "shaderpacks", "saves", "datapacks")) if (path.startsWith(group + "/")) return group;
        return null;
    }

    private static boolean under(String path, List<String> parts) {
        return parts.stream().anyMatch(root -> path.startsWith(root.toLowerCase(Locale.ROOT) + "/"));
    }

    private static JsonObject item(String path, String name, Path file, boolean directory) throws IOException {
        return values("path", path, "name", name, "dir", directory, "size", directory ? null : Files.size(file));
    }

    private static String label(String input, String fallback) throws IOException {
        String value = input.strip();
        if (value.codePointCount(0, value.length()) > 100 || value.codePoints().anyMatch(Character::isISOControl)) throw new IOException("整合包名称或版本无效");
        return value.isEmpty() ? fallback : value;
    }

    private static JsonObject values(Object... pairs) {
        var result = new JsonObject();
        for (int i = 0; i < pairs.length; i += 2) result.add((String) pairs[i], JsonFiles.JSON.toJsonTree(pairs[i + 1]));
        return result;
    }

    private static void entry(ZipOutputStream zip, String name, JsonObject body) throws IOException {
        entry(zip, name, body.toString().getBytes(StandardCharsets.UTF_8));
    }

    private static void entry(ZipOutputStream zip, String name, byte[] bytes) throws IOException {
        zip.putNextEntry(new ZipEntry(name));
        zip.write(bytes);
        zip.closeEntry();
    }
}
