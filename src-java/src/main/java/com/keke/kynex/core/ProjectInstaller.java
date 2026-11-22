package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import static com.keke.kynex.core.GameDownloads.check;
import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.array;
import static com.keke.kynex.core.LaunchManifest.is;
import static com.keke.kynex.core.LaunchManifest.object;

final class ProjectInstaller {
    private static final String MODRINTH = "https://api.modrinth.com/v2";
    private static final Set<String> INSTALLABLE = Set.of("mods", "resourcepacks", "shaderpacks", "datapacks");
    private static final Map<String, String> MR_TYPES = Map.of("mod", "mods", "resourcepack", "resourcepacks",
        "shader", "shaderpacks", "datapack", "datapacks");
    private static final Map<String, String> CF_TYPES = Map.of("6", "mods", "12", "resourcepacks", "6552", "shaderpacks", "6945", "datapacks");
    private static final Map<String, String> CF_LOADERS = Map.of("forge", "1", "fabric", "4", "quilt", "5", "neoforge", "6");
    private final GameDownloads downloads;
    private final CatalogNetwork network;
    private final ResourceCatalog catalog;
    private record Wanted(String project, String version, String kind) {}
    private record Release(String project, String version, String kind, String name, String icon, String filename, String url,
                           String hash, List<Wanted> required) {}
    private record Target(Path directory, Path lock) {}
    private record Change(Path from, Path to) {}

    ProjectInstaller(GameDownloads downloads, CatalogNetwork network, ResourceCatalog catalog) {
        this.downloads = downloads;
        this.network = network;
        this.catalog = catalog;
    }

    JsonObject curseDependencies(Path root, Path dataRoot, JsonObject request) throws IOException, InterruptedException {
        var query = request.deepCopy();
        query.addProperty("source", "curseforge");
        if (!query.has("kind")) query.addProperty("kind", "mods");
        var rows = new JsonArray();
        for (var raw : array(requirements(root, dataRoot, query).get("dependencies"))) {
            var row = object(raw);
            String id = field(row, "project_id");
            String artwork = "";
            try {
                var logo = object(object(object(catalog.curseforge("/mods/" + identifier(id, true), Map.of(), request)).get("data")).get("logo"));
                artwork = text(logo, "thumbnailUrl", text(logo, "url", ""));
            } catch (IOException ignored) { /* Metadata may be missing for an otherwise known dependency. */ }
            rows.add(WorkshopPlans.json("project_id", Long.parseLong(id), "name", text(row, "name", "未命名前置"),
                "icon_url", artwork, "installed", is(row.get("installed"), true)));
        }
        return WorkshopPlans.json("dependencies", rows);
    }

    JsonObject requirements(Path root, Path dataRoot, JsonObject request) throws IOException, InterruptedException {
        String kind = required(request, "kind");
        var notes = new JsonArray();
        var dependencies = new JsonArray();
        if (kind.equals("modpacks")) notes.add("整合包按自身清单安装游戏、加载器与资源。");
        else if (kind.equals("worlds")) notes.add("地图会作为新存档导入，已有存档会保留。");
        else {
            boolean cf = "curseforge".equals(text(request, "source", ""));
            List<Release> rows = plan(root, request, new MinecraftInstaller.Progress() {});
            for (Release dependency : rows.stream().skip(1).toList()) {
                var row = new JsonObject();
                row.addProperty("project_id", dependency.project());
                row.addProperty("versionId", dependency.version());
                row.addProperty("kind", dependency.kind());
                row.addProperty("name", dependency.name());
                boolean present = false;
                try {
                    var location = target(root, dataRoot, request, dependency.kind(), false);
                    present = installed(location, dependency, cf, () -> false);
                } catch (IOException unavailable) {
                    // A world may not have been selected yet while showing the requirement list.
                }
                row.addProperty("installed", present);
                dependencies.add(row);
            }
            if (kind.equals("shaderpacks")) notes.add("请在游戏的视频设置中启用光影。需要与实例兼容的 Iris、Oculus 或 OptiFine。");
            if (dependencies.isEmpty() && List.of("resourcepacks", "datapacks").contains(kind)) notes.add("此版本未声明必需前置。");
        }
        var result = new JsonObject();
        result.add("notes", notes);
        result.add("dependencies", dependencies);
        return result;
    }

    JsonObject install(Path root, Path dataRoot, JsonObject request, MinecraftInstaller.Progress progress)
        throws IOException, InterruptedException {
        boolean cf = "curseforge".equals(text(request, "source", ""));
        List<Release> releases = plan(root, request, progress);
        var work = new LinkedHashMap<Path, Path>();
        var records = new LinkedHashMap<Path, JsonObject>();
        var original = new HashMap<Path, byte[]>();
        var changes = new ArrayList<Change>();
        var destinations = new HashSet<Path>();
        int count = 0;
        boolean mods = false;
        try {
            for (Release item : releases.reversed()) {
                check(progress::stopped);
                var target = target(root, dataRoot, request, item.kind(), true);
                if (installed(target, item, cf, progress::stopped)) continue;
                Path staged = work.get(target.directory());
                if (staged == null) {
                    staged = Files.createTempDirectory(target.directory(), ".kxl-project-");
                    work.put(target.directory(), staged);
                }
                Path output = GameFiles.target(target.directory(), item.filename());
                if (!destinations.add(output)) throw new IOException("多个资源使用同一个文件名：" + item.filename());
                JsonObject record = records.get(target.lock());
                if (record == null) {
                    record = readLock(target.lock());
                    records.put(target.lock(), record);
                    if (Files.isRegularFile(target.lock())) original.put(target.lock(), Files.readAllBytes(target.lock()));
                }
                String key = key(item, cf);
                var previous = object(record.get(key));
                Path prior = null;
                String oldFile = text(previous, "file", "");
                if (!oldFile.isEmpty()) {
                    LaunchManifest.safeName(oldFile);
                    prior = GameFiles.target(target.directory(), oldFile);
                }
                if (!matches(output, item.hash(), progress::stopped)) {
                    if (Files.exists(output, LinkOption.NOFOLLOW_LINKS)) {
                        if (!output.equals(prior) || !matches(output, text(previous, "sha1", ""), progress::stopped)) {
                            throw new IOException("资源文件夹已有不同的同名文件：" + item.filename());
                        }
                        changes.add(new Change(output, staged.resolve("previous-" + count)));
                    }
                    Path temporary = staged.resolve("download-" + count);
                    progress.update("校验与下载资源及其前置", count, releases.size());
                    downloads.file(item.url(), false, temporary, item.hash(), GameDownloads.FILE_LIMIT, progress::stopped);
                    changes.add(new Change(temporary, output));
                }
                if (prior != null && !prior.equals(output) && matches(prior, text(previous, "sha1", ""), progress::stopped)) {
                    Path disabled = prior.resolveSibling(prior.getFileName() + ".disabled");
                    if (Files.exists(disabled, LinkOption.NOFOLLOW_LINKS)) {
                        disabled = prior.resolveSibling(prior.getFileName() + "." + java.util.UUID.randomUUID() + ".disabled");
                    }
                    changes.add(new Change(prior, disabled));
                }
                var updated = new JsonObject();
                if (cf) updated.addProperty("version", Long.parseLong(item.version()));
                else updated.addProperty("version", item.version());
                updated.addProperty("file", item.filename());
                updated.addProperty("sha1", item.hash());
                if (!item.icon().isEmpty()) updated.addProperty("icon_url", item.icon());
                record.add(key, updated);
                count++;
                mods |= item.kind().equals("mods");
            }
            progress.commit(() -> publish(changes, records, original));
            var result = new JsonObject();
            result.addProperty("files", count);
            result.addProperty("modsChanged", mods);
            return result;
        } finally {
            for (Path staged : work.values()) GameFiles.removeStaging(staged);
        }
    }

    private static void publish(List<Change> changes, Map<Path, JsonObject> records, Map<Path, byte[]> original) throws IOException {
        var moved = new ArrayList<Change>();
        var written = new ArrayList<Path>();
        try {
            for (Change change : changes) {
                Files.move(change.from(), change.to());
                moved.add(change);
            }
            for (var record : records.entrySet()) {
                JsonFiles.write(record.getKey(), record.getValue());
                written.add(record.getKey());
            }
        } catch (IOException failure) {
            for (Path path : written.reversed()) {
                try {
                    if (original.containsKey(path)) JsonFiles.atomicWrite(path, original.get(path));
                    else Files.deleteIfExists(path);
                } catch (IOException undo) { failure.addSuppressed(undo); }
            }
            for (Change change : moved.reversed()) {
                try { Files.move(change.to(), change.from(), StandardCopyOption.ATOMIC_MOVE); }
                catch (IOException undo) { failure.addSuppressed(undo); }
            }
            throw failure;
        }
    }

    private List<Release> plan(Path root, JsonObject request, MinecraftInstaller.Progress progress) throws IOException, InterruptedException {
        String kind = required(request, "kind");
        if (!INSTALLABLE.contains(kind)) throw new IOException("所选资源类型不适用于此安装流程");
        String source = text(request, "source", "modrinth");
        if (!Set.of("modrinth", "curseforge").contains(source)) throw new IOException("资源来源无效");
        boolean cf = "curseforge".equals(source);
        JsonObject config = LocalGameFiles.configuration(LocalGameFiles.instance(root, request));
        String game = required(config, "version");
        String loader = text(config, "loader", "vanilla");
        if (kind.equals("mods") && loader.equals("vanilla")) throw new IOException("原版实例不能安装模组，请先安装加载器");
        var pending = new ArrayDeque<Wanted>();
        pending.add(new Wanted(ResourceVersions.project(request, cf), text(request, "versionId", ""), kind));
        var selected = new LinkedHashMap<String, Release>();
        while (!pending.isEmpty()) {
            check(progress::stopped);
            Wanted wanted = pending.removeFirst();
            if (selected.size() >= 128) throw new IOException("必需前置资源过多，请改用整合包安装");
            Release existing = selected.get(wanted.project());
            if (existing != null && wanted.version().isEmpty()) continue;
            Release resolved = cf ? curseforge(request, wanted, game, loader) : modrinth(wanted, game, loader);
            Release previous = selected.putIfAbsent(resolved.project(), resolved);
            if (previous != null) {
                if (!previous.version().equals(resolved.version())) throw new IOException("必需前置要求了互不兼容的版本");
                continue;
            }
            if (!is(request.get("skipDependencies"), true)) pending.addAll(resolved.required());
        }
        return List.copyOf(selected.values());
    }

    private Release modrinth(Wanted wanted, String game, String loader) throws IOException {
        String project = wanted.project();
        String kind = wanted.kind();
        JsonObject release = wanted.version().isEmpty() ? null
            : object(network.json(MODRINTH + "/version/" + identifier(wanted.version(), false), ""));
        if (release != null) {
            String actual = required(release, "project_id");
            if (!project.isEmpty() && !project.equals(actual)) throw new IOException("所选版本不属于此项目");
            project = actual;
        }
        var info = object(network.json(MODRINTH + "/project/" + identifier(project, false), ""));
        if (kind.isEmpty()) kind = MR_TYPES.getOrDefault(text(info, "project_type", ""), "");
        if (release != null && includes(array(release.get("loaders")), "datapack")
            && wanted.kind().isEmpty() && ResourceVersions.modrinthFile(release, "datapacks") != null) kind = "datapacks";
        if (!INSTALLABLE.contains(kind)) throw new IOException("前置项目的资源类型不受支持");
        if (release == null) {
            var query = new LinkedHashMap<String, String>();
            query.put("include_changelog", "false");
            if (strict(kind)) query.put("game_versions", JsonFiles.JSON.toJson(List.of(game)));
            if (kind.equals("mods") || kind.equals("datapacks")) query.put("loaders", JsonFiles.JSON.toJson(List.of(kind.equals("mods") ? loader : "datapack")));
            String type = kind;
            release = latest(array(network.json(CatalogNetwork.url(MODRINTH + "/project/" + project + "/version", query), "")),
                "date_published", item -> ResourceVersions.modrinthFile(item, type) != null);
        }
        if (strict(kind) && !includes(array(release.get("game_versions")), game)
            || kind.equals("mods") && !includes(array(release.get("loaders")), loader)) throw new IOException("资源版本与当前实例不兼容");
        var file = ResourceVersions.modrinthFile(release, kind);
        if (file == null || !project.equals(required(release, "project_id"))) throw new IOException("项目没有相符的可下载文件");
        var dependencies = new ArrayList<Wanted>();
        for (var node : array(release.get("dependencies"))) {
            var dependency = object(node);
            if (!"required".equals(text(dependency, "dependency_type", ""))) continue;
            String parent = text(dependency, "project_id", "");
            String version = text(dependency, "version_id", "");
            if (parent.isEmpty() && version.isEmpty()) throw new IOException("必需前置没有可下载的项目或版本 ID");
            dependencies.add(new Wanted(parent, version, ""));
        }
        return checked(project, required(release, "id"), kind, text(info, "title", project), text(info, "icon_url", ""),
            required(file, "filename"), required(file, "url"), required(object(file.get("hashes")), "sha1"), dependencies);
    }

    private Release curseforge(JsonObject request, Wanted wanted, String game, String loader) throws IOException, InterruptedException {
        String project = identifier(wanted.project(), true);
        var info = object(object(catalog.curseforge("/mods/" + project, Map.of(), request)).get("data"));
        String kind = wanted.kind().isEmpty() ? CF_TYPES.getOrDefault(field(info, "classId"), "") : wanted.kind();
        if (!INSTALLABLE.contains(kind)) throw new IOException("前置项目的资源类型不受支持");
        String loaderCode = CF_LOADERS.getOrDefault(loader, "");
        JsonObject file;
        if (!wanted.version().isEmpty()) {
            String release = identifier(wanted.version(), true);
            file = object(object(catalog.curseforge("/mods/" + project + "/files/" + release, Map.of(), request)).get("data"));
        } else {
            var query = new LinkedHashMap<>(Map.of("pageSize", "50", "index", "0"));
            if (strict(kind)) query.put("gameVersion", game);
            if (kind.equals("mods") && !loaderCode.isEmpty()) query.put("modLoaderType", loaderCode);
            var result = object(catalog.curseforge("/mods/" + project + "/files", query, request));
            file = latest(array(result.get("data")), "fileDate", entry -> cfCompatible(entry, kind, game, loader, loaderCode));
        }
        if (!field(file, "modId").equals(project) || !cfCompatible(file, kind, game, loader, loaderCode)) {
            throw new IOException("所选 CurseForge 文件不属于此项目或与当前实例不兼容");
        }
        String hash = "";
        for (var node : array(file.get("hashes"))) {
            var candidate = object(node);
            if (ResourceCatalog.number(candidate, "algo", 0) == 1) hash = text(candidate, "value", "");
        }
        var dependencies = new ArrayList<Wanted>();
        for (var node : array(file.get("dependencies"))) {
            var dependency = object(node);
            if (ResourceCatalog.number(dependency, "relationType", 0) == 3) dependencies.add(new Wanted(field(dependency, "modId"), "", ""));
        }
        return checked(project, field(file, "id"), kind, text(info, "name", project), text(object(info.get("logo")), "url", ""),
            required(file, "fileName"), text(file, "downloadUrl", ""), hash, dependencies);
    }

    private static boolean cfCompatible(JsonObject item, String kind, String game, String loader, String loaderCode) {
        if (is(item.get("isAvailable"), false) || is(item.get("isServerPack"), true)
            || !ResourceVersions.extension(text(item, "fileName", ""), kind)) return false;
        var tags = array(item.get("gameVersions"));
        if (strict(kind) && !includes(tags, game)) return false;
        return !kind.equals("mods") || loaderCode.isEmpty() || tags.asList().stream()
            .anyMatch(tag -> tag.isJsonPrimitive() && loader.equals(tag.getAsString().toLowerCase(Locale.ROOT)));
    }

    private static Release checked(String project, String version, String kind, String name, String icon, String filename,
                                   String url, String hash, List<Wanted> required) throws IOException {
        LaunchManifest.safeName(filename);
        if (!hash.matches("[a-fA-F0-9]{40}") || ResourceCatalog.https(url) == null || version.isEmpty()) {
            throw new IOException("资源来源未提供可验证的下载文件：" + name);
        }
        return new Release(project, version, kind, name, icon, filename, url, hash, required);
    }

    private static JsonObject latest(JsonArray rows, String date, java.util.function.Predicate<JsonObject> filter) throws IOException {
        return rows.asList().stream().map(LaunchManifest::object).filter(filter)
            .max(Comparator.comparing(item -> text(item, date, ""))).orElseThrow(() -> new IOException("没有兼容的可下载资源版本"));
    }

    private static boolean includes(JsonArray array, String value) {
        return array.asList().stream().anyMatch(item -> item.isJsonPrimitive() && value.equals(item.getAsString()));
    }

    private static String field(JsonObject row, String name) {
        JsonElement value = row.get(name);
        return value != null && value.isJsonPrimitive() ? value.getAsString() : "";
    }

    private static String identifier(String id, boolean numeric) throws IOException {
        if (!(numeric ? id.matches("[0-9]{1,18}") : id.matches("[A-Za-z0-9_-]{1,120}"))) throw new IOException("资源标识无效");
        return id;
    }

    private static boolean strict(String kind) { return kind.equals("mods") || kind.equals("datapacks"); }
    private static String key(Release release, boolean cf) { return cf ? "cf-" + release.project() : release.project(); }

    private static Target target(Path root, Path dataRoot, JsonObject request, String kind, boolean create) throws IOException {
        var scoped = request.deepCopy();
        scoped.addProperty("kind", kind);
        if (kind.equals("datapacks") && text(scoped, "world", "").isBlank()) throw new IOException("请先选择要安装数据包的存档");
        Path directory = LocalGameFiles.resourceDirectory(root, dataRoot, scoped);
        if (create) directory = Files.createDirectories(directory).toRealPath();
        Path lock = kind.equals("datapacks") ? GameFiles.target(directory.getParent(), "kxl-datapacks.json")
            : GameFiles.target(LocalGameFiles.instance(root, scoped), "installed-projects.json");
        return new Target(directory, lock);
    }

    private static JsonObject readLock(Path lock) throws IOException {
        if (!Files.isRegularFile(lock)) return new JsonObject();
        try { return JsonFiles.read(lock).getAsJsonObject(); }
        catch (JsonParseException | IllegalStateException invalid) { throw new IOException("资源安装记录格式无效", invalid); }
    }

    private static boolean installed(Target target, Release release, boolean cf, java.util.function.BooleanSupplier stopped)
        throws IOException {
        JsonObject previous = object(readLock(target.lock()).get(key(release, cf)));
        String name = text(previous, "file", "");
        if (!release.version().equals(field(previous, "version")) || name.isEmpty() || !Files.isDirectory(target.directory())) return false;
        LaunchManifest.safeName(name);
        return matches(GameFiles.target(target.directory(), name), text(previous, "sha1", ""), stopped);
    }

    private static boolean matches(Path file, String hash, java.util.function.BooleanSupplier stopped) throws IOException {
        return hash.matches("[a-fA-F0-9]{40}") && Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)
            && GameDownloads.matches(file, hash, stopped);
    }
}
