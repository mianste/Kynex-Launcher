package com.keke.kynex.core;

import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorCompletionService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static com.keke.kynex.core.GameDownloads.check;
import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.object;

final class MinecraftInstaller {
    private final GameDownloads downloads;
    private final MinecraftCatalog catalog;
    private final LoaderCatalog loaders;
    private final ForgeInstall forge;
    private final OptiFineInstall optiFine;
    record FileEntry(String url, String path, String hash) {}

    @FunctionalInterface
    interface Publication { void write() throws IOException; }
    @FunctionalInterface
    interface InstanceContent { void prepare(Path path, JsonObject instance) throws IOException, InterruptedException; }

    interface Progress {
        default boolean stopped() { return false; }
        default void update(String stage, int done, int total) {}
        default void publish(Path staging, Path destination) throws IOException {
            check(this::stopped);
            Files.move(staging, destination, StandardCopyOption.ATOMIC_MOVE);
        }
        default void save(Path staging, Path destination) throws IOException {
            check(this::stopped);
            Files.move(staging, destination, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        }
        default void commit(Publication publication) throws IOException {
            check(this::stopped);
            publication.write();
        }
    }

    MinecraftInstaller(GameDownloads downloads) {
        this.downloads = downloads;
        catalog = new MinecraftCatalog(downloads);
        loaders = new LoaderCatalog(downloads);
        forge = new ForgeInstall(downloads);
        optiFine = new OptiFineInstall(downloads);
    }

    JsonObject install(Path root, JsonObject request, boolean mirror, Progress progress) throws IOException, InterruptedException {
        return install(root, request, mirror, progress, (path, instance) -> {});
    }

    JsonObject install(Path root, JsonObject request, boolean mirror, Progress progress, InstanceContent content)
        throws IOException, InterruptedException {
        return installNamed(root, request, mirror, progress, content, UUID.randomUUID().toString());
    }

    JsonObject installNamed(Path root, JsonObject request, boolean mirror, Progress progress, InstanceContent content, String id)
        throws IOException, InterruptedException {
        if (!UUID.fromString(id).toString().equals(id)) throw new IOException("实例标识无效");
        String loader = text(request, "loader", "vanilla");
        if (!List.of("vanilla", "fabric", "quilt", "forge", "neoforge", "optifine").contains(loader)) {
            throw new IOException("未知的加载器");
        }
        String addOn = text(request, "optifineVersion", "");
        if (!addOn.isEmpty() && !loader.equals("forge")) throw new IOException("OptiFine 附加安装仅适用于 Forge");
        String loaderVersion = loader.equals("vanilla") ? text(request, "loaderVersion", "") : required(request, "loaderVersion");
        String name = required(request, "name");
        if (name.isBlank() || name.codePointCount(0, name.length()) > 512 || name.codePoints().anyMatch(Character::isISOControl)) {
            throw new IOException("名称不能为空、超过 512 个字或包含控制字符");
        }
        String game = required(request, "version");
        JsonObject settings = request.get("settings") instanceof JsonObject values ? values : defaults();
        int threads = threadCount(settings);

        progress.update("读取游戏版本", 0, 1);
        JsonObject version = catalog.version(root, game, mirror, progress::stopped);
        if (loader.equals("fabric") || loader.equals("quilt")) {
            progress.update("读取加载器配置", 0, 1);
            version = loaders.profile(version, game, loader, loaderVersion, mirror, progress::stopped);
        }
        Path instanceRoot = GameFiles.target(root, "instances/.staging-parent").getParent();
        Path stagingRoot = GameFiles.target(root, "cache/installing/.staging-parent").getParent();
        Path staging = Files.createTempDirectory(stagingRoot, "instance-");
        Path destination = instanceRoot.resolve(id);
        try {
            prepareClient(root, staging, version, mirror, progress);
            if (loader.equals("forge") || loader.equals("neoforge")) {
                version = forge.install(root, staging, version, settings, loader, loaderVersion, mirror, progress);
            }
            for (String folder : List.of("mods", "resourcepacks", "saves", "shaderpacks", "datapacks")) {
                Files.createDirectory(staging.resolve(folder));
            }
            if (loader.equals("optifine") || !addOn.isEmpty()) {
                optiFine.install(root, staging, version, settings, game, addOn.isEmpty() ? loaderVersion : addOn,
                    addOn.isEmpty() ? null : loaderVersion, progress);
            }
            prepare(root, staging, version, InstalledGameLauncher.platform(version), mirror, threads, progress);
            var instance = new JsonObject();
            instance.addProperty("id", id);
            instance.addProperty("version", game);
            instance.addProperty("loader", loader);
            instance.addProperty("loaderVersion", loaderVersion);
            if (!addOn.isEmpty()) instance.addProperty("optifineVersion", addOn);
            instance.addProperty("game", "java");
            instance.addProperty("path", destination.toString());
            instance.add("settings", settings);
            content.prepare(staging, instance);
            check(progress::stopped);
            JsonFiles.write(staging.resolve("version.json"), version);
            synchronized (this) {
                instance.addProperty("name", availableName(instanceRoot, name));
                JsonFiles.write(staging.resolve("kxl.json"), instance);
                progress.publish(staging, destination);
            }
            return instance;
        } catch (IOException | InterruptedException | RuntimeException error) {
            try {
                GameFiles.removeStaging(staging);
            } catch (IOException cleanup) {
                error.addSuppressed(cleanup);
            }
            throw error;
        }
    }

    private void prepareClient(Path root, Path staging, JsonObject version, boolean mirror, Progress progress) throws IOException {
        JsonObject client = object(object(version.get("downloads")).get("client"));
        String clientHash = text(client, "sha1", "");
        Path clientFile = staging.resolve("client.jar");
        Path cache = clientHash.matches("[a-fA-F0-9]{40}")
            ? GameFiles.target(root, "cache/game-clients/" + clientHash + "/client.jar") : clientFile;
        progress.update("准备游戏客户端", 0, 1);
        downloads.file(required(client, "url"), mirror, cache, clientHash, GameDownloads.FILE_LIMIT, progress::stopped);
        if (!cache.equals(clientFile)) Files.copy(cache, clientFile);
    }

    private void prepare(Path root, Path staging, JsonObject version, LaunchManifest.Platform platform, boolean mirror,
                         int threads, Progress progress) throws IOException, InterruptedException {
        var libraries = new ArrayList<FileEntry>();
        for (var row : LaunchManifest.dependencies(version, platform)) {
            JsonObject entry = object(row);
            libraries.add(new FileEntry(required(entry, "url"), "libraries/" + required(entry, "path"),
                text(entry, "hash", "")));
        }

        if (version.get("assetIndex") instanceof JsonObject assetIndex) {
            String index = required(assetIndex, "id");
            LaunchManifest.safeName(index);
            Path indexFile = GameFiles.target(root, "assets/indexes/" + index + ".json");
            downloads.file(required(assetIndex, "url"), mirror, indexFile, text(assetIndex, "sha1", ""),
                GameDownloads.DOCUMENT_LIMIT, progress::stopped);
            var assets = new ArrayList<FileEntry>();
            for (var entry : GameAssets.plan(indexFile).getAsJsonArray("hashes")) {
                String hash = entry.getAsString();
                String location = hash.substring(0, 2) + "/" + hash;
                assets.add(new FileEntry("https://resources.download.minecraft.net/" + location,
                    "assets/objects/" + location, hash));
            }
            libraries.addAll(assets);
        }
        check(progress::stopped);
        transfer(root, libraries, mirror, threads, progress, "校验与下载游戏文件");
        GameAssets.prepareInstalled(root, staging, version, platform);
    }

    void transfer(Path root, List<FileEntry> entries, boolean mirror, int threads, Progress progress, String stage)
        throws IOException, InterruptedException {
        var unique = new LinkedHashMap<String, FileEntry>();
        for (FileEntry entry : entries) {
            FileEntry previous = unique.putIfAbsent(entry.path(), entry);
            if (previous != null && !previous.hash().equalsIgnoreCase(entry.hash())) {
                throw new IOException("游戏资源清单包含冲突的文件：" + entry.path());
            }
        }
        int total = unique.size();
        if (total == 0) return;
        Iterator<FileEntry> unscheduled = unique.values().iterator();
        progress.update(stage, 0, total);
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var completed = new ExecutorCompletionService<Void>(executor);
            var active = new HashSet<Future<Void>>();
            int done = 0;
            try {
                while (done < total) {
                    check(progress::stopped);
                    while (active.size() < threads && unscheduled.hasNext()) {
                        FileEntry entry = unscheduled.next();
                        active.add(completed.submit(() -> {
                            Path destination = GameFiles.target(root, entry.path());
                            downloads.file(entry.url(), mirror, destination, entry.hash(), GameDownloads.FILE_LIMIT, progress::stopped);
                            return null;
                        }));
                    }
                    Future<Void> file = completed.poll(100, java.util.concurrent.TimeUnit.MILLISECONDS);
                    if (file == null) continue;
                    active.remove(file);
                    file.get();
                    done++;
                    if (done == total || done % Math.max(1, total / 100) == 0) progress.update(stage, done, total);
                }
            } catch (ExecutionException error) {
                if (error.getCause() instanceof IOException io) throw io;
                throw new IOException("无法校验游戏资源", error.getCause());
            } finally {
                for (var file : active) file.cancel(true);
            }
        }
    }

    private static String availableName(Path instances, String original) throws IOException {
        var names = new HashSet<String>();
        try (var existing = Files.list(instances)) {
            for (Path folder : existing.toList()) {
                try {
                    Path info = folder.resolve("kxl.json");
                    if (!Files.isRegularFile(info) || !info.toRealPath().startsWith(instances)) continue;
                    names.add(text(object(JsonFiles.read(info)), "name", ""));
                } catch (IOException | JsonParseException ignored) {
                    // Instances with unreadable metadata do not affect naming.
                }
            }
        }
        if (!names.contains(original)) return original;
        for (int index = 2; index < 1000; index++) {
            String candidate = original + " (" + index + ")";
            if (!names.contains(candidate)) return candidate;
        }
        throw new IOException("同名实例过多，请先清理旧实例");
    }

    static int threadCount(JsonObject settings) {
        if (!settings.has("threads")) return 16;
        try {
            return Math.clamp(Integer.parseInt(settings.get("threads").getAsString()), 1, 64);
        } catch (NumberFormatException | UnsupportedOperationException invalid) {
            return 16;
        }
    }

    static JsonObject defaults() {
        var settings = new JsonObject();
        settings.addProperty("memory", 4096);
        settings.addProperty("java", "");
        settings.addProperty("width", 1280);
        settings.addProperty("height", 720);
        settings.addProperty("isolation", "all");
        return settings;
    }
}
