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
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;

import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.array;
import static com.keke.kynex.core.LaunchManifest.is;
import static com.keke.kynex.core.LaunchManifest.object;

final class ModUpdates {
    private static final String MODRINTH = "https://api.modrinth.com/v2";
    private static final Set<String> LOADERS = Set.of("fabric", "forge", "neoforge", "quilt", "liteloader", "rift");
    private final CatalogNetwork network;
    private final ResourceCatalog resources;
    private final ProjectInstaller projects;
    private final Map<Path, Digest> hashes = new ConcurrentHashMap<>();

    private record Digest(long size, java.nio.file.attribute.FileTime modified, ResourceHashes.Value value) {}
    private record Local(String name, ResourceHashes.Value value) {}
    private record Release(String project, String id, String label, String sha, Instant date, Set<String> games, Set<String> loaders) {}
    private record Match(Release from, Release to, String source) {}
    private record Source(Map<String, Release> files, Map<String, List<Release>> choices, Set<String> failed) {}

    ModUpdates(CatalogNetwork network, ResourceCatalog resources, ProjectInstaller projects) {
        this.network = network;
        this.resources = resources;
        this.projects = projects;
    }

    Path folder(Path root, Path dataRoot, JsonObject payload) throws IOException {
        var scope = payload.deepCopy();
        scope.addProperty("kind", "mods");
        return LocalGameFiles.resourceDirectory(root, dataRoot, scope);
    }

    boolean hasFiles(Path folder) throws IOException {
        if (!Files.isDirectory(folder, LinkOption.NOFOLLOW_LINKS)) return false;
        try (var list = Files.list(folder)) {
            return list.anyMatch(file -> Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS) && allowed(file.getFileName().toString()));
        }
    }

    JsonArray check(Path root, Path dataRoot, JsonObject payload) throws IOException, InterruptedException {
        Path instance = LocalGameFiles.instance(root, payload);
        Path folder = folder(root, dataRoot, payload);
        JsonObject config = LocalGameFiles.configuration(instance);
        String game = required(config, "version"), loader = text(config, "loader", "vanilla");
        var rows = new ArrayList<JsonObject>();
        var pending = new ArrayList<Local>();
        if (!Files.isDirectory(folder, LinkOption.NOFOLLOW_LINKS)) return new JsonArray();
        Path cache = GameFiles.target(root, "cache/mod-updates-v3.json");
        JsonObject saved = object(load(cache).get("entries"));
        long now = Instant.now().getEpochSecond();
        boolean cacheOnly = is(payload.get("cacheOnly"), true), force = is(payload.get("force"), true);
        try (var paths = Files.list(folder)) {
            for (Path file : paths.filter(path -> Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)).toList()) {
                String name = file.getFileName().toString();
                if (!allowed(name) || !file.equals(file.toRealPath())) continue;
                try {
                    Local local = new Local(name, digest(file));
                    JsonObject cached = object(saved.get(key(local, game, loader)));
                    long checked = ResourceCatalog.number(cached, "checkedAt", -1);
                    if (checked >= 0 && checked <= now && (cacheOnly || !force && now - checked < 1800) && confirmed(cached)) {
                        JsonObject copy = cached.deepCopy();
                        copy.addProperty("file", name);
                        copy.addProperty("cached", true);
                        rows.add(copy);
                    } else if (!cacheOnly) pending.add(local);
                } catch (IOException missing) { rows.add(json("file", name, "status", "error", "detail", "无法读取模组")); }
            }
        }
        if (!pending.isEmpty()) {
            var pool = Executors.newVirtualThreadPerTaskExecutor();
            try {
                var modrinth = pool.submit(() -> modrinth(pending, game, loader));
                var forge = pool.submit(() -> curseforge(pending, game, loader, payload));
                Source mr = result(modrinth, pending);
                Source cf = result(forge, pending);
                for (Local local : pending) {
                    JsonObject row = row(local, game, loader, mr, cf);
                    row.addProperty("checkedAt", now);
                    rows.add(row);
                }
            } finally { pool.shutdownNow(); }
        }
        duplicates(rows);
        if (!pending.isEmpty()) save(cache, rows, game, loader, now);
        var sorted = new JsonArray();
        rows.stream().sorted(Comparator.comparing(row -> text(row, "file", "").toLowerCase(Locale.ROOT))).forEach(sorted::add);
        return sorted;
    }

    JsonObject apply(Path root, Path dataRoot, JsonObject request, MinecraftInstaller.Progress progress) throws IOException, InterruptedException {
        JsonObject latest = request.deepCopy();
        latest.addProperty("force", true);
        List<JsonObject> all = check(root, dataRoot, latest).asList().stream().map(LaunchManifest::object).toList();
        Set<String> requested = labels(array(request.get("files")));
        boolean individually = request.get("files") instanceof JsonArray;
        if (individually && !all.stream().map(row -> required(row, "file")).collect(java.util.stream.Collectors.toSet()).containsAll(requested)) {
            throw new IOException("所选模组已变化，请重新检测");
        }
        var scoped = all.stream().filter(row -> !individually || requested.contains(required(row, "file"))).toList();
        if (scoped.stream().anyMatch(row -> "error".equals(text(row, "status", "")) || individually && "unknown".equals(text(row, "status", ""))))
            throw new IOException("模组更新信息未能确认，请检查网络后重试");
        var updates = scoped.stream().filter(row -> "update".equals(text(row, "status", ""))).toList();
        if (updates.isEmpty()) return json("updated", 0);
        Path instance = LocalGameFiles.instance(root, request);
        Path mods = folder(root, dataRoot, request).toRealPath();
        Path backup = GameFiles.target(instance, "mod-backups/" + UUID.randomUUID() + "/mods");
        Files.createDirectory(backup);
        copyFiles(mods, backup);
        Path receipt = GameFiles.target(instance, "installed-projects.json");
        byte[] prior = Files.isRegularFile(receipt, LinkOption.NOFOLLOW_LINKS) ? Files.readAllBytes(receipt) : null;
        if (prior != null) JsonFiles.atomicWrite(backup.getParent().resolve("installed-projects.json"), prior);
        int done = 0;
        try {
            for (JsonObject selected : updates) {
                GameDownloads.check(progress::stopped);
                String project = required(selected, "project"), version = required(selected, "versionId"), source = required(selected, "source");
                String old = required(selected, "file"), sha = required(selected, "sha1");
                String key = source.equals("curseforge") ? "cf-" + project : project;
                JsonObject records = load(receipt);
                JsonObject installed = object(records.get(key));
                if (version.equals(identifier(installed.get("version"))) && verified(mods, installed)) continue;
                Path existing = GameFiles.target(mods, old);
                if (!GameDownloads.matches(existing, sha, progress::stopped)) throw new IOException("检测后模组已变化，请重新检测");
                records.add(key, json("file", old, "sha1", sha, "version", required(selected, "currentId")));
                JsonFiles.write(receipt, records);
                JsonObject install = request.deepCopy();
                install.addProperty("project", project);
                install.addProperty("versionId", version);
                install.addProperty("source", source);
                install.addProperty("kind", "mods");
                projects.install(root, dataRoot, install, new MinecraftInstaller.Progress() {
                    @Override public boolean stopped() { return progress.stopped(); }
                    @Override public void update(String step, int stepDone, int total) { progress.update(step, stepDone, total); }
                });
                if (old.endsWith(".disabled")) keepDisabled(mods, old, sha, object(load(receipt).get(key)));
                progress.update("更新模组", ++done, updates.size());
            }
            progress.commit(() -> {});
            return json("updated", updates.size(), "backup", backup.getParent().toString());
        } catch (IOException | InterruptedException | RuntimeException failure) {
            try {
                restoreFiles(mods, backup);
                if (prior != null) JsonFiles.atomicWrite(receipt, prior);
                else Files.deleteIfExists(receipt);
            } catch (IOException recovery) {
                failure.addSuppressed(recovery);
                throw new IOException("模组更新失败，备份保存在 " + backup.getParent(), failure);
            }
            throw failure;
        }
    }

    private Source modrinth(List<Local> local, String game, String loader) {
        var found = new LinkedHashMap<String, Release>();
        var choices = new LinkedHashMap<String, List<Release>>();
        var failed = new LinkedHashSet<String>();
        for (int i = 0; i < local.size(); i += 100) {
            var batch = local.subList(i, Math.min(local.size(), i + 100));
            var ids = batch.stream().map(item -> item.value().sha1()).distinct().toList();
            try {
                JsonObject versions = modrinthPost("/version_files", json("hashes", ids, "algorithm", "sha1"));
                for (String hash : ids) {
                    Release release = release(object(versions.get(hash)), false);
                    if (release != null && release.sha().equalsIgnoreCase(hash)) found.put(hash, release);
                }
                var known = ids.stream().filter(found::containsKey).toList();
                if (known.isEmpty()) continue;
                JsonObject recent = modrinthPost("/version_files/update", json("hashes", known, "algorithm", "sha1", "loaders", List.of(loader),
                    "game_versions", List.of(game)));
                for (String hash : known) {
                    Release current = found.get(hash);
                    Release top = release(object(recent.get(hash)), false);
                    if (top != null && compatible(current, top, game, loader, false)) choices.put(hash, List.of(top));
                    else choices.put(hash, mrVersions(current.project(), game, loader));
                }
            } catch (IOException unavailable) { failed.addAll(ids); }
        }
        return new Source(found, choices, failed);
    }

    private JsonObject modrinthPost(String path, JsonObject body) throws IOException {
        try { return object(network.post(MODRINTH + path, "", body)); }
        catch (IOException failed) { return object(network.post("https://mod.mcimirror.top/modrinth/v2" + path, "", body)); }
    }

    private List<Release> mrVersions(String project, String game, String loader) throws IOException {
        String address = CatalogNetwork.url(MODRINTH + "/project/" + project + "/version",
            Map.of("game_versions", JsonFiles.JSON.toJson(List.of(game)), "loaders", JsonFiles.JSON.toJson(List.of(loader))));
        return rows(network.json(address, ""), false);
    }

    private Source curseforge(List<Local> local, String game, String loader, JsonObject query) throws InterruptedException {
        var found = new LinkedHashMap<String, Release>();
        var failed = new LinkedHashSet<String>();
        var choices = new LinkedHashMap<String, List<Release>>();
        var byProject = new LinkedHashMap<String, List<Release>>();
        for (int i = 0; i < local.size(); i += 100) {
            var batch = local.subList(i, Math.min(local.size(), i + 100));
            try {
                var probe = json("fingerprints", batch.stream().map(item -> item.value().fingerprint()).distinct().toList());
                JsonObject data = object(object(resources.curseforgePost("/fingerprints/432", probe, query)).get("data"));
                if (!(data.get("exactMatches") instanceof JsonArray hits)) throw new IOException("CurseForge 指纹响应无效");
                for (Local item : batch) {
                    String sha = item.value().sha1();
                    var observed = new LinkedHashMap<String, Release>();
                    for (JsonElement hit : hits) {
                        JsonObject file = object(object(hit).get("file"));
                        if (item.value().fingerprint() != ResourceCatalog.number(file, "fileFingerprint", -1)) continue;
                        Release result = release(file, true);
                        if (result != null && sha.equalsIgnoreCase(result.sha())) observed.putIfAbsent(result.project(), result);
                    }
                    if (observed.size() == 1) found.put(sha, observed.values().iterator().next());
                    else if (observed.size() > 1) failed.add(sha);
                }
            } catch (IOException unavailable) { for (Local item : batch) failed.add(item.value().sha1()); }
        }
        var projects = found.values().stream().map(Release::project).distinct().toList();
        for (int i = 0; i < projects.size(); i += 100) {
            var batch = projects.subList(i, Math.min(projects.size(), i + 100));
            try {
                List<Long> ids = batch.stream().map(Long::parseLong).toList();
                JsonElement response = object(resources.curseforgePost("/mods", json("modIds", ids), query)).get("data");
                var needed = new LinkedHashSet<Long>();
                for (var raw : array(response)) {
                    JsonObject item = object(raw);
                    String project = identifier(item.get("id"));
                    if (is(item.get("allowModDistribution"), false)) continue;
                    var list = rows(item.get("latestFiles"), true);
                    byProject.put(project, new ArrayList<>(list));
                    for (var version : array(item.get("latestFilesIndexes"))) {
                        JsonObject row = object(version);
                        if (!game.equals(text(row, "gameVersion", ""))) continue;
                        long id = ResourceCatalog.number(row, "fileId", 0);
                        if (id > 0 && list.stream().noneMatch(file -> file.id().equals(Long.toString(id)))) needed.add(id);
                    }
                }
                var list = new ArrayList<>(needed);
                for (int start = 0; start < list.size(); start += 100) {
                    JsonElement files = object(resources.curseforgePost("/mods/files", json("fileIds", list.subList(start, Math.min(start + 100, list.size()))), query)).get("data");
                    for (Release release : rows(files, true)) byProject.computeIfAbsent(release.project(), ignored -> new ArrayList<>()).add(release);
                }
            } catch (IOException unavailable) { found.forEach((hash, old) -> { if (batch.contains(old.project())) failed.add(hash); }); }
        }
        found.forEach((sha, old) -> choices.put(sha, byProject.getOrDefault(old.project(), List.of())));
        return new Source(found, choices, failed);
    }

    private static JsonObject row(Local local, String game, String loader, Source mr, Source cf) {
        String sha = local.value().sha1();
        var identities = new JsonObject();
        var matches = new ArrayList<Match>();
        for (var provider : Map.of("modrinth", mr, "curseforge", cf).entrySet()) {
            String name = provider.getKey();
            Release current = provider.getValue().files().get(sha);
            if (current == null) continue;
            identities.addProperty(name, current.project());
            for (Release candidate : provider.getValue().choices().getOrDefault(sha, List.of())) {
                if (compatible(current, candidate, game, loader, name.equals("curseforge")) && candidate.date().isAfter(current.date())
                    && !candidate.id().equals(current.id()) && !sha.equalsIgnoreCase(candidate.sha())) matches.add(new Match(current, candidate, name));
            }
        }
        var reply = json("file", local.name(), "sha1", sha, "status", "unknown", "detail", "文件未被可用平台收录，不能确认版本",
            "cached", false, "identities", identities, "identifiedSources", identities.keySet());
        boolean uncertain = mr.failed().contains(sha) || cf.failed().contains(sha);
        var best = matches.stream().max(Comparator.comparing(hit -> hit.to().date()));
        if (best.isPresent()) {
            Match row = best.get();
            reply.addProperty("status", "update");
            reply.addProperty("detail", "有同加载器的兼容更新");
            reply.addProperty("source", row.source());
            reply.addProperty("project", row.from().project());
            reply.addProperty("current", row.from().label());
            reply.addProperty("latest", row.to().label());
            reply.addProperty("currentId", row.from().id());
            reply.addProperty("versionId", row.to().id());
        } else if (!identities.isEmpty()) {
            Release current = mr.files().getOrDefault(sha, cf.files().get(sha));
            if (!current.loaders().isEmpty() && !current.loaders().contains(loader)) reply.addProperty("detail", "未找到相同加载器的兼容文件");
            else {
                reply.addProperty("status", "current");
                reply.addProperty("current", current.label());
                reply.addProperty("detail", uncertain ? "当前可用来源未发现兼容更新" : "未发现更新的兼容文件");
            }
        } else if (uncertain) {
            reply.addProperty("status", "error");
            reply.addProperty("detail", "资源来源暂未确认此模组版本");
        }
        if (uncertain) reply.addProperty("partial", true);
        return reply;
    }

    private static boolean compatible(Release old, Release next, String game, String loader, boolean curse) {
        return old.project().equals(next.project()) && old.loaders().equals(next.loaders()) && next.games().contains(game)
            && (old.loaders().contains(loader) || curse && old.loaders().isEmpty() && LOADERS.contains(loader));
    }

    private static List<Release> rows(JsonElement data, boolean curse) {
        return array(data).asList().stream().map(LaunchManifest::object).map(item -> release(item, curse)).filter(java.util.Objects::nonNull).toList();
    }

    private static Release release(JsonObject row, boolean curse) {
        if (row.isEmpty()) return null;
        String project = identifier(row.get(curse ? "modId" : "project_id"));
        String id = identifier(row.get("id"));
        if (!project.matches(curse ? "[0-9]{1,18}" : "[A-Za-z0-9_-]{1,120}") || !id.matches(curse ? "[0-9]{1,18}" : "[A-Za-z0-9_-]{1,120}")) return null;
        String sha;
        if (curse) {
            if (!allowed(text(row, "fileName", "")) || is(row.get("isServerPack"), true) || is(row.get("isAvailable"), false)) return null;
            sha = array(row.get("hashes")).asList().stream().map(LaunchManifest::object)
                .filter(item -> ResourceCatalog.number(item, "algo", 0) == 1).map(item -> text(item, "value", "")).findFirst().orElse("");
        } else {
            JsonObject file = ResourceVersions.modrinthFile(row, "mods");
            if (file == null) return null;
            sha = text(object(file.get("hashes")), "sha1", "");
        }
        if (!sha.matches("[A-Fa-f0-9]{40}")) return null;
        try {
            var games = labels(array(row.get(curse ? "gameVersions" : "game_versions")));
            Set<String> loaders = (curse ? games : labels(array(row.get("loaders")))).stream().map(value -> value.toLowerCase(Locale.ROOT))
                .filter(LOADERS::contains).collect(java.util.stream.Collectors.toSet());
            Instant date = Instant.parse(required(row, curse ? "fileDate" : "date_published"));
            return new Release(project, id, text(row, curse ? "displayName" : "version_number", id), sha, date, games, loaders);
        } catch (DateTimeParseException | IllegalArgumentException notDated) { return null; }
    }

    private ResourceHashes.Value digest(Path file) throws IOException {
        long size = Files.size(file);
        var timestamp = Files.getLastModifiedTime(file, LinkOption.NOFOLLOW_LINKS);
        Digest previous = hashes.get(file);
        if (previous != null && previous.size() == size && previous.modified().equals(timestamp)) return previous.value();
        var value = ResourceHashes.read(file);
        if (hashes.size() >= 4096) hashes.clear();
        hashes.put(file, new Digest(size, timestamp, value));
        return value;
    }

    private synchronized void save(Path file, List<JsonObject> rows, String game, String loader, long now) {
        JsonObject current = object(load(file).get("entries"));
        current.entrySet().removeIf(entry -> now - ResourceCatalog.number(object(entry.getValue()), "checkedAt", 0) > 1800);
        for (JsonObject row : rows) if (confirmed(row)) current.add(required(row, "sha1") + "|" + game + "|" + loader, row);
        try { JsonFiles.write(file, json("entries", current)); }
        catch (IOException ignored) { /* Files and version data remain authoritative when this cache cannot be saved. */ }
    }

    private static void duplicates(List<JsonObject> rows) {
        var seen = new java.util.HashMap<String, Integer>();
        for (var row : rows) object(row.get("identities")).entrySet().forEach(entry -> seen.merge(entry.getKey() + ":" + identifier(entry.getValue()), 1, Integer::sum));
        for (var row : rows) if (object(row.get("identities")).entrySet().stream()
            .anyMatch(entry -> seen.getOrDefault(entry.getKey() + ":" + identifier(entry.getValue()), 0) > 1)) {
            row.addProperty("status", "unknown");
            row.addProperty("detail", "同一模组存在多个文件，请先保留一份再更新");
        }
    }

    private static Source result(java.util.concurrent.Future<Source> source, List<Local> input) throws InterruptedException {
        try { return source.get(); }
        catch (java.util.concurrent.ExecutionException unavailable) {
            return new Source(Map.of(), Map.of(), input.stream().map(item -> item.value().sha1()).collect(java.util.stream.Collectors.toSet()));
        }
    }

    private static boolean confirmed(JsonObject row) {
        return Set.of("current", "update").contains(text(row, "status", "")) && !is(row.get("partial"), true) && row.has("sha1");
    }

    private static boolean verified(Path mods, JsonObject installed) throws IOException {
        String name = text(installed, "file", ""), hash = text(installed, "sha1", "");
        return !name.isEmpty() && !hash.isEmpty() && GameDownloads.matches(GameFiles.target(mods, name), hash, () -> false);
    }

    private static void keepDisabled(Path mods, String old, String priorHash, JsonObject row) throws IOException {
        Path fresh = GameFiles.target(mods, required(row, "file"));
        String name = fresh.getFileName().toString();
        Path destination = GameFiles.target(mods, name + ".disabled");
        if (Files.isRegularFile(fresh)) {
            if (Files.exists(destination) && !GameDownloads.matches(destination, priorHash, () -> false)) throw new IOException("新版已存在同名禁用模组");
            Files.move(fresh, destination, StandardCopyOption.REPLACE_EXISTING);
        }
        Path previous = GameFiles.target(mods, old);
        if (!previous.equals(destination) && GameDownloads.matches(previous, priorHash, () -> false)) Files.delete(previous);
        Path doubled = GameFiles.target(mods, old + ".disabled");
        if (!doubled.equals(destination) && GameDownloads.matches(doubled, priorHash, () -> false)) Files.delete(doubled);
    }

    private static void restoreFiles(Path mods, Path backup) throws IOException {
        try (var paths = Files.list(mods)) {
            for (Path file : paths.filter(path -> Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)).toList()) Files.delete(file);
        }
        copyFiles(backup, mods);
    }

    private static void copyFiles(Path from, Path to) throws IOException {
        try (var list = Files.list(from)) {
            for (Path file : list.filter(path -> Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)).toList()) {
                if (file.equals(file.toRealPath())) Files.copy(file, GameFiles.target(to, file.getFileName().toString()), StandardCopyOption.COPY_ATTRIBUTES);
            }
        }
    }

    private static Set<String> labels(JsonArray list) {
        var values = new LinkedHashSet<String>();
        for (var raw : list) if (raw.isJsonPrimitive() && raw.getAsJsonPrimitive().isString()) values.add(raw.getAsString());
        return values;
    }

    private static boolean allowed(String name) { return ResourceVersions.extension(name.replaceFirst("(?i)\\.disabled$", ""), "mods"); }
    private static String key(Local item, String game, String loader) { return item.value().sha1() + "|" + game + "|" + loader; }
    private static String identifier(JsonElement value) { return value != null && value.isJsonPrimitive() ? value.getAsString() : ""; }
    private static JsonObject load(Path file) {
        try { return object(JsonFiles.read(file)); }
        catch (IOException | JsonParseException unavailable) { return new JsonObject(); }
    }

    private static JsonObject json(Object... pairs) {
        var result = new JsonObject();
        for (int i = 0; i < pairs.length; i += 2) result.add((String) pairs[i], JsonFiles.JSON.toJsonTree(pairs[i + 1]));
        return result;
    }
}
