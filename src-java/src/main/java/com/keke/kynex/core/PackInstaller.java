package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.function.BooleanSupplier;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipException;
import java.util.zip.ZipFile;

import static com.keke.kynex.core.GameDownloads.check;
import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.array;
import static com.keke.kynex.core.LaunchManifest.is;
import static com.keke.kynex.core.LaunchManifest.object;

final class PackInstaller {
    private static final long LIMIT = 8L * 1024 * 1024 * 1024;
    private static final Pattern GAME_PROFILE = Pattern.compile("(?:.*?/)?(?:versions/[^/]+/[^/]+\\.json|version\\.json)");
    private static final Pattern PACK_FILE = Pattern.compile(".*\\.(mrpack|zip|curseforge)", Pattern.CASE_INSENSITIVE);
    private static final Set<String> URL_HOSTS = Set.of("cdn.modrinth.com", "github.com", "raw.githubusercontent.com",
        "media.forgecdn.net", "mediafilez.forgecdn.net", "edge.forgecdn.net");
    private static final Set<String> RESERVED = Set.of("kxl.json", "version.json", "accounts.json", "client.jar",
        "installed-projects.json", "kxl-pack.json");
    private static final Set<String> GAME_FILES = Set.of("config", "defaultconfigs", "mods", "resourcepacks", "saves",
        "shaderpacks", "datapacks", "schematics", "scripts", "kubejs", "patchouli_books", "options.txt", "servers.dat");
    private static final Map<String, String> COMPONENTS = Map.of("net.fabricmc.fabric-loader", "fabric",
        "org.quiltmc.quilt-loader", "quilt", "net.minecraftforge", "forge", "net.neoforged", "neoforge");
    private final GameDownloads downloads;
    private final CatalogNetwork network;
    private final ResourceCatalog catalog;
    private final MinecraftInstaller games;
    private record Manifest(String base, JsonObject body) {}
    private record Pack(String variant, String base, String content, String additional, String name, String game,
                        String loader, String release, JsonObject manifest) {}
    private record FileEntry(String path, List<String> urls, String hash, long size, String project, String version, boolean curse) {}
    private static final class UnrecognizedPack extends IOException {
        UnrecognizedPack() { super("未识别整合包版本清单"); }
    }

    private record OpenPack(ZipFile archive, Pack pack, Path extracted) implements AutoCloseable {
        @Override public void close() throws IOException {
            try { archive.close(); }
            finally { if (extracted != null) Files.deleteIfExists(extracted); }
        }
    }

    PackInstaller(GameDownloads downloads, CatalogNetwork network, ResourceCatalog catalog, MinecraftInstaller games) {
        this.downloads = downloads;
        this.network = network;
        this.catalog = catalog;
        this.games = games;
    }

    JsonObject inspect(Path file) throws IOException {
        try (var opened = resolve(file, file, null, () -> false, new long[]{LIMIT}, 0)) {
            ZipFile archive = opened.archive();
            Pack pack = opened.pack();
            var result = new JsonObject();
            result.addProperty("name", pack.name());
            result.addProperty("version", pack.game());
            result.addProperty("loader", pack.loader());
            result.addProperty("loaderVersion", pack.release());
            result.addProperty("format", pack.variant());
            result.addProperty("count", archive.size());
            result.addProperty("base", pack.base());
            result.addProperty("path", file.toString());
            return result;
        }
    }

    JsonObject local(Path root, Path file, JsonObject request, boolean mirror, MinecraftInstaller.Progress progress)
        throws IOException, InterruptedException {
        progress.update("读取整合包清单", 0, 1);
        try (var opened = resolve(file, file, null, progress::stopped, new long[]{LIMIT}, 0)) {
            ZipFile archive = opened.archive();
            Pack pack = opened.pack();
            var install = new JsonObject();
            install.addProperty("name", text(request, "name", pack.name()));
            install.addProperty("version", pack.game());
            install.addProperty("loader", pack.loader());
            install.addProperty("loaderVersion", pack.release());
            if ("kynex".equals(pack.variant())) install.addProperty("optifineVersion", text(pack.manifest(), "optifineVersion", ""));
            var preferences = MinecraftInstaller.defaults();
            object(request.get("settings")).entrySet().forEach(entry -> preferences.add(entry.getKey(), entry.getValue()));
            preferences.addProperty("isolation", "all");
            install.add("settings", preferences);
            return games.install(root, install, mirror, progress, (staging, instance) -> {
                List<FileEntry> records = List.of();
                switch (pack.variant()) {
                    case "modrinth" -> {
                        records = modrinthFiles(pack.manifest());
                        applyFiles(root, staging, records, progress);
                        extract(archive, staging, pack.base() + "overrides/", null, progress);
                        extract(archive, staging, pack.base() + "client-overrides/", null, progress);
                    }
                    case "curseforge" -> {
                        records = curseFiles(pack.manifest(), request, progress);
                        applyFiles(root, staging, records, progress);
                        extract(archive, staging, pack.base() + prefix(text(pack.manifest(), "overrides", "overrides")), null, progress);
                        String client = text(pack.manifest(), "clientOverrides", text(pack.manifest(), "client-overrides", ""));
                        if (!client.isEmpty()) extract(archive, staging, pack.base() + prefix(client), null, progress);
                    }
                    case "kynex" -> extract(archive, staging, pack.base(), null, progress);
                    default -> {
                        extract(archive, staging, pack.content(), GAME_FILES, progress);
                        if (!pack.additional().isEmpty() && !pack.additional().equals(pack.content())) {
                            extract(archive, staging, pack.additional(), GAME_FILES, progress);
                        }
                    }
                }
                recordIdentities(staging, records, progress);
                instance.addProperty("modpack", true);
                if (request.has("temporaryPackUpdate")) instance.add("temporaryPackUpdate", request.get("temporaryPackUpdate"));
                String embedded = icon(archive, pack);
                if (!embedded.isEmpty()) instance.addProperty("icon", embedded);
                else {
                    String url = ResourceCatalog.https(text(request, "iconUrl", ""));
                    if (url != null) instance.addProperty("icon", url);
                }
                if (request.has("packSource")) {
                    JsonObject source = request.getAsJsonObject("packSource").deepCopy();
                    source.addProperty("name", text(request, "name", pack.name()));
                    source.addProperty("installedAt", Instant.now().getEpochSecond());
                    instance.add("packSource", source);
                    try { instance.add("packManagedFiles", JsonFiles.JSON.toJsonTree(WorkshopPackUpdate.inventory(staging))); }
                    catch (IOException invalid) {
                        instance.addProperty("packSourceWarning", "无法建立文件清单，在线更新前请重新导入整合包。");
                    }
                }
            });
        }
    }

    JsonObject remote(Path root, JsonObject params, boolean mirror, MinecraftInstaller.Progress progress)
        throws IOException, InterruptedException {
        boolean cf = "curseforge".equals(text(params, "source", ""));
        String project = ResourceVersions.project(params, cf);
        String version = required(params, "versionId");
        if (!version.matches(cf ? "[0-9]{1,18}" : "[A-Za-z0-9_-]{1,120}")) throw new IOException("整合包版本标识无效");
        FileEntry entry;
        String label;
        if (cf) {
            JsonObject release = cfFile(project, version, params);
            entry = cfDownload(release, "pack");
            label = text(release, "displayName", entry.path());
        } else {
            JsonObject release = object(network.json("https://api.modrinth.com/v2/version/" + version, ""));
            if (!project.equals(required(release, "project_id"))) throw new IOException("所选版本不属于此整合包");
            JsonObject file = ResourceVersions.modrinthFile(release, "modpacks");
            if (file == null) throw new IOException("此整合包没有 MRPACK 文件");
            entry = fileEntry(required(file, "filename"), List.of(required(file, "url")), required(object(file.get("hashes")), "sha1"));
            label = text(release, "version_number", entry.path());
        }
        Path parent = GameFiles.target(root, "imports/.directory").getParent();
        Path work = Files.createTempDirectory(parent, "catalog-");
        try {
            progress.update("下载整合包文件", 0, 1);
            Path file = work.resolve(cf ? "pack.zip" : "pack.mrpack");
            fetch(root, entry, file, progress);
            JsonObject settings = params.deepCopy();
            var origin = new JsonObject();
            origin.addProperty("provider", cf ? "curseforge" : "modrinth");
            origin.addProperty("projectId", project);
            origin.addProperty("versionId", version);
            origin.addProperty("versionNumber", label);
            settings.add("packSource", origin);
            return local(root, file, settings, mirror, progress);
        } finally {
            GameFiles.removeStaging(work);
        }
    }

    private static ZipFile open(Path source) throws IOException {
        if (!source.isAbsolute() || !Files.isRegularFile(source)) {
            throw new IOException("整合包文件不存在");
        }
        try { return new ZipFile(source.toFile()); }
        catch (ZipException invalid) {
            var error = new ZipException("整合包压缩文件无效");
            error.initCause(invalid);
            throw error;
        }
    }

    private static OpenPack resolve(Path file, Path name, Path extracted, BooleanSupplier stopped, long[] budget, int depth)
        throws IOException {
        ZipFile archive = null;
        boolean keep = false;
        try {
            archive = open(file);
            try {
                var pack = new OpenPack(archive, identify(archive, name), extracted);
                keep = true;
                return pack;
            } catch (UnrecognizedPack absent) {
                if (depth >= 2 || !name.toString().toLowerCase(Locale.ROOT).endsWith(".zip")) throw absent;
                var candidates = archive.stream().filter(entry -> !entry.isDirectory()
                    && PACK_FILE.matcher(entry.getName()).matches()).limit(17).toList();
                if (candidates.size() > 16) throw new IOException("压缩包内的候选整合包过多，请选择要导入的文件");
                OpenPack match = scanEmbedded(archive, candidates, stopped, budget, depth, true);
                if (match == null) match = scanEmbedded(archive, candidates, stopped, budget, depth, false);
                if (match == null) throw absent;
                return match;
            }
        } finally {
            if (!keep) {
                try { if (archive != null) archive.close(); }
                finally { if (extracted != null) Files.deleteIfExists(extracted); }
            }
        }
    }

    private static OpenPack scanEmbedded(ZipFile archive, List<? extends ZipEntry> candidates, BooleanSupplier stopped,
                                         long[] budget, int depth, boolean mrpack) throws IOException {
        OpenPack match = null;
        boolean complete = false;
        try {
            for (ZipEntry entry : candidates) {
                String name = entry.getName();
                if (name.toLowerCase(Locale.ROOT).endsWith(".mrpack") != mrpack) continue;
                String leaf = name.substring(name.lastIndexOf('/') + 1);
                Path innerName;
                try {
                    LaunchManifest.safeName(leaf);
                    innerName = Path.of(leaf);
                } catch (IllegalArgumentException invalid) { continue; }
                Path inner = copyEmbedded(archive, entry, stopped, budget);
                OpenPack found;
                try {
                    found = resolve(inner, innerName, inner, stopped, budget, depth + 1);
                } catch (UnrecognizedPack | ZipException ignored) {
                    continue;
                }
                if (match != null) {
                    found.close();
                    throw new IOException("压缩包内包含多个整合包，请分别导入");
                }
                match = found;
            }
            complete = true;
            return match;
        } finally {
            if (!complete && match != null) match.close();
        }
    }

    private static Path copyEmbedded(ZipFile archive, ZipEntry entry, BooleanSupplier stopped, long[] budget) throws IOException {
        if (entry.getSize() > budget[0]) throw new IOException("内嵌整合包超过 8 GB");
        Path file = Files.createTempFile("kynex-embedded-pack-", ".zip");
        boolean complete = false;
        try {
            try (var input = archive.getInputStream(entry); var output = Files.newOutputStream(file)) {
                byte[] buffer = new byte[256 * 1024];
                for (int count; (count = input.read(buffer)) >= 0;) {
                    if (stopped.getAsBoolean()) throw new IOException("已取消读取整合包");
                    budget[0] -= count;
                    if (budget[0] < 0) throw new IOException("内嵌整合包超过 8 GB");
                    output.write(buffer, 0, count);
                }
            }
            complete = true;
            return file;
        } finally {
            if (!complete) Files.deleteIfExists(file);
        }
    }

    private static Pack identify(ZipFile archive, Path source) throws IOException {
        String filename = source.getFileName().toString().replaceFirst("\\.[^.]+$", "");
        Manifest note = manifest(archive, "modrinth.index.json");
        if (note != null) {
            JsonObject requirements = object(note.body().get("dependencies"));
            for (var kind : Map.of("fabric-loader", "fabric", "quilt-loader", "quilt", "neoforge", "neoforge", "forge", "forge").entrySet()) {
                String release = text(requirements, kind.getKey(), "");
                if (!release.isEmpty()) return pack("modrinth", note, filename, required(requirements, "minecraft"), kind.getValue(), release);
            }
            return pack("modrinth", note, filename, required(requirements, "minecraft"), "vanilla", "");
        }
        note = manifest(archive, "kxl-pack.json");
        if (note != null) return pack("kynex", note, filename, required(note.body(), "version"),
            text(note.body(), "loader", "vanilla"), text(note.body(), "loaderVersion", ""));
        note = manifest(archive, "manifest.json");
        if (note != null && note.body().get("minecraft") instanceof JsonObject minecraft) {
            JsonArray loaders = array(minecraft.get("modLoaders"));
            var loader = loaders.asList().stream().map(LaunchManifest::object).filter(row -> is(row.get("primary"), true))
                .findFirst().orElse(loaders.isEmpty() ? new JsonObject() : object(loaders.get(0)));
            String[] pieces = text(loader, "id", "vanilla").split("-", 2);
            return pack("curseforge", note, filename, required(minecraft, "version"), pieces[0].toLowerCase(Locale.ROOT),
                pieces.length > 1 ? pieces[1] : "");
        }
        note = manifest(archive, "mmc-pack.json");
        if (note != null) {
            String game = "";
            String loader = "vanilla";
            String release = "";
            for (var item : array(note.body().get("components"))) {
                var row = object(item);
                String uid = text(row, "uid", "");
                if (uid.equals("net.minecraft")) game = required(row, "version");
                else if (COMPONENTS.containsKey(uid)) {
                    loader = COMPONENTS.get(uid);
                    release = required(row, "version");
                }
            }
            String base = note.base();
            String path = archive.stream().anyMatch(entry -> entry.getName().startsWith(base + ".minecraft/"))
                ? base + ".minecraft/" : base + "minecraft/";
            return content("multimc", note, path, "", filename, game, loader, release);
        }
        note = manifest(archive, "modpack.json");
        if (note != null && note.body().has("gameVersion")) {
            String path = note.base() + "minecraft/";
            JsonObject config = read(archive, path + "version.json");
            String[] loader = loader(config);
            return content("hmcl", note, path, "", filename, required(note.body(), "gameVersion"), loader[0], loader[1]);
        }
        var layouts = new ArrayList<Pack>();
        for (var entry : archive.stream().filter(row -> GAME_PROFILE.matcher(row.getName()).matches()).toList()) {
            String name = entry.getName();
            JsonObject profile = read(archive, name);
            if (profile.isEmpty() || !profile.has("mainClass") && !profile.has("inheritsFrom") && !profile.has("downloads")) continue;
            String game = text(profile, "clientVersion", text(profile, "inheritsFrom", text(profile, "id", "")));
            if (game.isEmpty()) continue;
            int folders = name.indexOf("versions/");
            String dir = folders < 0 ? name.substring(0, name.lastIndexOf('/') + 1) : name.substring(0, folders);
            String[] loader = loader(profile);
            layouts.add(content("minecraft", new Manifest("", new JsonObject()), dir,
                name.substring(0, name.lastIndexOf('/') + 1), filename, game, loader[0], loader[1]));
        }
        if (layouts.size() == 1) return layouts.getFirst();
        if (layouts.isEmpty()) throw new UnrecognizedPack();
        throw new IOException("压缩包包含多个游戏版本，请分别导入");
    }

    private static Pack pack(String format, Manifest manifest, String filename, String game, String loader, String release)
        throws IOException {
        return content(format, manifest, "", "", filename, game, loader, release);
    }

    private static String prefix(String path) throws IOException {
        String value = path.replaceFirst("/+$", "");
        if (value.isEmpty() || value.startsWith("/") || value.contains("\\") || value.contains(":")) {
            throw new IOException("整合包覆盖目录无效");
        }
        for (String part : value.split("/", -1)) LaunchManifest.safeName(part);
        return value + "/";
    }

    private static Pack content(String format, Manifest manifest, String path, String secondary, String filename,
                                String game, String loader, String release) throws IOException {
        if (game.isEmpty() || !loader.equals("vanilla") && release.isEmpty()) throw new IOException("整合包缺少游戏或加载器版本");
        return new Pack(format, manifest.base(), path, secondary, text(manifest.body(), "name", filename),
            game, loader, release, manifest.body());
    }

    static String[] loader(JsonObject profile) {
        var keys = Map.of("net.fabricmc:fabric-loader:", "fabric", "org.quiltmc:quilt-loader:", "quilt",
            "net.minecraftforge:forge:", "forge", "net.minecraftforge:fmlloader:", "forge",
            "net.neoforged:neoforge:", "neoforge", "optifine:OptiFine:", "optifine");
        for (var row : array(profile.get("libraries"))) {
            String name = text(object(row), "name", "");
            for (var key : keys.entrySet()) {
                if (!name.startsWith(key.getKey())) continue;
                String version = name.substring(key.getKey().length()).split(":", 2)[0];
                if (key.getValue().equals("forge")) version = version.replaceFirst("^[0-9.]+-", "");
                if (key.getValue().equals("optifine")) version = version.replaceFirst("^[0-9.]+_", "");
                return new String[]{key.getValue(), version};
            }
        }
        return new String[]{"vanilla", ""};
    }

    private static Manifest manifest(ZipFile archive, String name) throws IOException {
        if (archive.getEntry(name) != null) return new Manifest("", read(archive, name));
        String entry = archive.stream().map(java.util.zip.ZipEntry::getName)
            .filter(path -> path.endsWith("/" + name))
            .min(Comparator.comparingInt(String::length)).orElse(null);
        if (entry == null) return null;
        return new Manifest(entry.substring(0, entry.length() - name.length()), read(archive, entry));
    }

    private static JsonObject read(ZipFile archive, String name) throws IOException {
        var entry = archive.getEntry(name);
        if (entry == null) return new JsonObject();
        try (var input = archive.getInputStream(entry)) {
            byte[] body = input.readNBytes(10 * 1024 * 1024 + 1);
            if (body.length > 10 * 1024 * 1024) throw new IOException("整合包清单超过大小限制");
            return object(JsonFiles.JSON.fromJson(new String(body, StandardCharsets.UTF_8), JsonObject.class));
        } catch (JsonParseException invalid) {
            throw new IOException("整合包清单格式无效：" + name, invalid);
        }
    }

    private static List<FileEntry> modrinthFiles(JsonObject manifest) throws IOException {
        if (!(manifest.get("files") instanceof JsonArray rows)) throw new IOException("整合包文件清单无效");
        var result = new ArrayList<FileEntry>();
        for (var item : rows) {
            var row = object(item);
            if ("unsupported".equals(text(object(row.get("env")), "client", ""))) continue;
            var urls = new ArrayList<String>();
            for (var url : array(row.get("downloads"))) if (url.isJsonPrimitive()) urls.add(url.getAsString());
            String project = "", version = "";
            for (String url : urls) {
                if (!url.startsWith("https://cdn.modrinth.com/data/")) continue;
                String[] parts = URI.create(url).getPath().split("/");
                if (parts.length >= 6 && parts[2].matches("[A-Za-z0-9_-]{1,120}") && parts[3].equals("versions")
                    && parts[4].matches("[A-Za-z0-9_-]{1,120}")) {
                    project = parts[2];
                    version = parts[4];
                    break;
                }
            }
            result.add(fileEntry(required(row, "path"), urls, required(object(row.get("hashes")), "sha1"),
                ResourceCatalog.number(row, "fileSize", 0), project, version, false));
        }
        return result;
    }

    private List<FileEntry> curseFiles(JsonObject manifest, JsonObject request, MinecraftInstaller.Progress progress)
        throws IOException, InterruptedException {
        if (!(manifest.get("files") instanceof JsonArray rows)) throw new IOException("CurseForge 文件清单无效");
        var result = new ArrayList<FileEntry>();
        for (var item : rows) {
            check(progress::stopped);
            var row = object(item);
            if (!row.has("projectID") || !row.has("fileID")) throw new IOException("CurseForge 清单缺少文件编号");
            String project = row.get("projectID").getAsString();
            JsonObject release = cfFile(project, row.get("fileID").getAsString(), request);
            String filename = required(release, "fileName");
            String folder = "mods";
            if (!filename.toLowerCase(Locale.ROOT).endsWith(".jar")) {
                JsonObject info = object(object(catalog.curseforge("/mods/" + project, Map.of(), request)).get("data"));
                long type = ResourceCatalog.number(info, "classId", 0);
                if (type == 17 || type == 4546) continue;
                if (type == 12) folder = "resourcepacks";
                if (type == 6552) folder = "shaderpacks";
                if (type == 6945) folder = "datapacks";
            }
            result.add(cfDownload(release, folder + "/" + filename));
        }
        return result;
    }

    private JsonObject cfFile(String project, String version, JsonObject request) throws IOException, InterruptedException {
        if (!project.matches("[0-9]{1,18}") || !version.matches("[0-9]{1,18}")) throw new IOException("CurseForge 文件编号无效");
        var release = object(object(catalog.curseforge("/mods/" + project + "/files/" + version, Map.of(), request)).get("data"));
        if (!release.has("modId") || !project.equals(release.get("modId").getAsString()) || is(release.get("isAvailable"), false)) {
            throw new IOException("整合包文件不属于该项目或不可下载");
        }
        return release;
    }

    private static FileEntry cfDownload(JsonObject release, String target) throws IOException {
        String hash = "";
        for (var value : array(release.get("hashes"))) {
            var row = object(value);
            if (ResourceCatalog.number(row, "algo", 0) == 1) hash = required(row, "value");
        }
        return fileEntry(target, List.of(text(release, "downloadUrl", "")), hash, ResourceCatalog.number(release, "fileLength", 0),
            WorkshopPlans.id(release.get("modId")), WorkshopPlans.id(release.get("id")), true);
    }

    private static FileEntry fileEntry(String name, List<String> urls, String hash) throws IOException {
        return fileEntry(name, urls, hash, 0, "", "", false);
    }

    private static FileEntry fileEntry(String name, List<String> urls, String hash, long size, String project, String version, boolean curse)
        throws IOException {
        List<String> valid = urls.stream().filter(url -> ResourceCatalog.https(url) != null)
            .filter(url -> URL_HOSTS.contains(URI.create(url).getHost())).distinct().toList();
        if (valid.isEmpty() || !hash.matches("[a-fA-F0-9]{40}")) throw new IOException("整合包文件缺少可验证的下载地址：" + name);
        return new FileEntry(name, valid, hash, size, project, version, curse);
    }

    private static void recordIdentities(Path root, List<FileEntry> files, MinecraftInstaller.Progress progress) throws IOException {
        var result = new JsonObject();
        for (var row : files) {
            if (row.project().isEmpty() || row.version().isEmpty() || row.path().indexOf('/') < 0) continue;
            Path file = GameFiles.target(root, row.path());
            if (!Files.isRegularFile(file) || !GameDownloads.matches(file, row.hash(), progress::stopped)) continue;
            var info = WorkshopPlans.json("file", file.getFileName().toString(), "sha1", row.hash());
            if (row.curse()) info.addProperty("version", Long.parseLong(row.version()));
            else info.addProperty("version", row.version());
            result.add((row.curse() ? "cf-" : "") + row.project(), info);
        }
        if (!result.isEmpty()) JsonFiles.write(GameFiles.target(root, "installed-projects.json"), result);
    }

    JsonObject updateManifest(Path file, JsonObject request, MinecraftInstaller.Progress progress)
        throws IOException, InterruptedException {
        try (var archive = open(file)) {
            Pack pack = identify(archive, file);
            if (!Set.of("modrinth", "curseforge").contains(pack.variant())) throw new IOException("在线整合包清单格式无效");
            var remote = pack.variant().equals("modrinth") ? modrinthFiles(pack.manifest()) : curseFiles(pack.manifest(), request, progress);
            var files = new java.util.TreeMap<String, JsonObject>();
            long bytes = 0;
            for (var row : remote) {
                if (!WorkshopPackUpdate.managed(row.path())) throw new IOException("更新清单包含非受管文件：" + row.path());
                bytes = Math.addExact(bytes, Math.max(0, row.size()));
                files.put(row.path(), WorkshopPlans.json("sha1", row.hash(), "size", row.size()));
            }
            String overrides = pack.variant().equals("modrinth") ? "overrides/" : prefix(text(pack.manifest(), "overrides", "overrides"));
            String client = text(pack.manifest(), "clientOverrides", text(pack.manifest(), "client-overrides", "client-overrides"));
            var prefixes = List.of(pack.base() + overrides, pack.base() + prefix(client));
            for (String from : prefixes) for (var row : archive.stream().filter(value -> !value.isDirectory() && value.getName().startsWith(from)).toList()) {
                check(progress::stopped);
                String name = row.getName().substring(from.length());
                if (!WorkshopPackUpdate.managed(name)) continue;
                if (row.getSize() < 0 || row.getSize() > 64L * 1024 * 1024 || files.size() >= 20_000) throw new IOException("更新清单超过体积或数量预算");
                var sha = ResourceHashes.digest("SHA-256");
                try (var input = new java.security.DigestInputStream(archive.getInputStream(row), sha)) {
                    input.transferTo(java.io.OutputStream.nullOutputStream());
                }
                bytes = Math.addExact(bytes, row.getSize());
                files.put(name, WorkshopPlans.json("sha256", java.util.HexFormat.of().formatHex(sha.digest()), "size", row.getSize()));
            }
            if (bytes > WorkshopPlans.LIMIT || files.keySet().stream().filter(name -> name.startsWith("mods/") && name.endsWith(".jar")).count() > 80)
                throw new IOException("新整合包超过 2 GB 或 80 个模组");
            return WorkshopPlans.json("files", files, "minecraft", pack.game(), "loader", pack.loader(), "downloadBytes", bytes);
        }
    }

    private void applyFiles(Path root, Path staging, List<FileEntry> entries, MinecraftInstaller.Progress progress)
        throws IOException, InterruptedException {
        if (entries.size() > 5000) throw new IOException("整合包文件数量过多");
        var work = new ArrayList<Callable<Void>>();
        var destinations = new HashSet<Path>();
        var done = new java.util.concurrent.atomic.AtomicInteger();
        for (var row : entries) {
            Path dest = target(staging, row.path());
            if (dest == null || !destinations.add(dest)) throw new IOException("整合包文件路径冲突：" + row.path());
            work.add(() -> {
                fetch(root, row, dest, progress);
                progress.update("安装整合包资源", done.incrementAndGet(), entries.size());
                return null;
            });
        }
        try (var pool = Executors.newFixedThreadPool(12)) {
            var queue = new java.util.concurrent.ExecutorCompletionService<Void>(pool);
            var active = work.stream().map(queue::submit).toList();
            try {
                for (int i = 0; i < active.size(); i++) queue.take().get();
            } catch (ExecutionException failed) {
                if (failed.getCause() instanceof IOException io) throw io;
                throw new IOException("无法下载安装整合包文件", failed.getCause());
            } finally {
                active.forEach(future -> future.cancel(true));
            }
        }
    }

    private void fetch(Path root, FileEntry row, Path output, MinecraftInstaller.Progress progress) throws IOException {
        Path cache = GameFiles.target(root, "cache/pack-files/" + row.hash().toLowerCase(Locale.ROOT));
        IOException failure = null;
        for (String url : row.urls()) {
            check(progress::stopped);
            try { downloads.file(url, false, cache, row.hash(), LIMIT, progress::stopped); }
            catch (IOException missing) { failure = missing; continue; }
            Files.copy(cache, output);
            return;
        }
        throw new IOException("无法下载整合包文件：" + row.path(), failure);
    }

    private static void extract(ZipFile archive, Path staging, String prefix, Set<String> allowed,
                                MinecraftInstaller.Progress progress) throws IOException {
        var targets = new HashSet<Path>();
        long remaining = LIMIT;
        for (var entry : archive.stream().filter(value -> !value.isDirectory() && value.getName().startsWith(prefix)).toList()) {
            check(progress::stopped);
            String relative = entry.getName().substring(prefix.length()).replace('\\', '/');
            if (relative.isEmpty() || allowed != null && !allowed.contains(relative.split("/", 2)[0])) continue;
            Path dest = target(staging, relative);
            if (dest == null) continue;
            if (!targets.add(dest) || entry.getSize() < 0 || entry.getSize() > (remaining)) throw new IOException("整合包文件体积超出限制或路径重复");
            remaining -= entry.getSize();
            try (var input = archive.getInputStream(entry); var output = Files.newOutputStream(dest)) {
                long left = entry.getSize();
                byte[] buffer = new byte[64 * 1024];
                for (int size; (size = input.read(buffer)) != -1;) {
                    check(progress::stopped);
                    if ((left -= size) < 0) throw new IOException("整合包文件长度不匹配");
                    output.write(buffer, 0, size);
                }
                if (left != 0) throw new IOException("整合包文件缺少数据");
            }
        }
    }

    private static Path target(Path staging, String relative) throws IOException {
        String first = relative.split("/", 2)[0].toLowerCase(Locale.ROOT);
        if (RESERVED.contains(first)) return null;
        return GameFiles.target(staging, relative);
    }

    private static String icon(ZipFile zip, Pack pack) throws IOException {
        for (String name : List.of(pack.base() + "icon.png", pack.base() + "pack.png", pack.content() + "icon.png")) {
            var entry = zip.getEntry(name);
            if (entry == null || entry.isDirectory() || entry.getSize() > 2 * 1024 * 1024) continue;
            try (var input = zip.getInputStream(entry)) {
                byte[] image = input.readNBytes(2 * 1024 * 1024 + 1);
                String mime = ArtworkCache.mime(image);
                if (image.length <= 2 * 1024 * 1024 && mime != null) return "data:" + mime + ";base64," + Base64.getEncoder().encodeToString(image);
            }
        }
        return "";
    }
}
