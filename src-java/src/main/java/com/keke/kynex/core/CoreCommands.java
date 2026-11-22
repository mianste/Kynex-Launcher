package com.keke.kynex.core;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;
import com.google.gson.Strictness;
import com.keke.kynex.account.AccountStore;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;

import static com.keke.kynex.core.JsonFiles.required;

public final class CoreCommands {
    private static final Gson IPC = new GsonBuilder().setStrictness(Strictness.STRICT)
        .disableHtmlEscaping().serializeNulls().create();
    private CoreCommands() {}

    public static void main(String[] args) throws Exception {
        if (args.length == 1 && args[0].equals("--lines")) {
            var input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
            try (var writer = new OutputStreamWriter(System.out, StandardCharsets.UTF_8)) {
                for (String line; (line = input.readLine()) != null;) {
                    JsonObject envelope = IPC.fromJson(line, JsonObject.class);
                    IPC.toJson(reply(Path.of(required(envelope, "root")), envelope.getAsJsonObject("request")), writer);
                    writer.write('\n');
                    writer.flush();
                }
            }
            return;
        }
        var request = IPC.fromJson(new InputStreamReader(System.in, StandardCharsets.UTF_8), JsonObject.class);
        try (var writer = new OutputStreamWriter(System.out, StandardCharsets.UTF_8)) {
            IPC.toJson(reply(Path.of(args[0]), request), writer);
        }
    }

    private static JsonObject reply(Path root, JsonObject request) {
        var reply = new JsonObject();
        try {
            reply.add("value", dispatch(root, request));
        } catch (Exception error) {
            String reason = error.getMessage();
            reply.addProperty("error", reason == null || reason.isBlank() ? "Java 组件处理失败" : reason);
        }
        return reply;
    }

    static JsonElement dispatch(Path root, JsonObject request) throws Exception {
        String command = required(request, "command");
        return switch (command) {
            case "accounts.list" -> new AccountStore(root).list();
            case "accounts.offline" -> new AccountStore(root).loginOffline(required(request, "name"));
            case "accounts.save" -> new AccountStore(root).save(request.getAsJsonObject("account"));
            case "accounts.remove" -> {
                new AccountStore(root).remove(required(request, "id"));
                yield new JsonPrimitive(true);
            }
            case "directories.list" -> new GameDirectories(root).list();
            case "directories.change" -> new GameDirectories(root).change(required(request, "action"), request.getAsJsonObject("payload"));
            case "game.applyLanguage" -> IPC.toJsonTree(GameOptions.applyLanguage(
                Path.of(required(request, "path")), required(request, "version"), required(request, "language")));
            case "game.mergeVersion" -> LaunchManifest.merge(request.get("base"), request.get("overlay"));
            case "game.restoreLibraries" -> LaunchManifest.restore(request.getAsJsonObject("version"),
                request.getAsJsonObject("base"), LaunchManifest.Platform.from(request.getAsJsonObject("platform")));
            case "game.dependencyPlan" -> LaunchManifest.dependencies(request.getAsJsonObject("version"),
                LaunchManifest.Platform.from(request.getAsJsonObject("platform")));
            case "game.launchLibraries" -> LaunchManifest.launchLibraries(request.getAsJsonObject("version"),
                LaunchManifest.Platform.from(request.getAsJsonObject("platform")));
            case "game.launchArguments" -> LaunchManifest.arguments(request,
                LaunchManifest.Platform.from(request.getAsJsonObject("platform")));
            case "game.assetPlan" -> GameAssets.plan(Path.of(required(request, "path")));
            case "game.assetsReady" -> new JsonPrimitive(GameAssets.ready(root, Path.of(required(request, "instance")),
                request.getAsJsonObject("version"), LaunchManifest.Platform.from(request.getAsJsonObject("platform"))));
            case "game.unpackNatives" -> {
                NativeLibraries.unpack(root, request.getAsJsonArray("archives"));
                yield new JsonPrimitive(true);
            }
            case "game.launchOfflineInstalled" -> new InstalledGameLauncher(root).launchOffline(request.getAsJsonObject("payload"));
            case "game.versions" -> new MinecraftCatalog(new GameDownloads()).versions(root.toRealPath(),
                LaunchManifest.is(request.get("mirror"), true), LaunchManifest.is(request.get("refresh"), true), () -> false);
            case "game.loaders" -> new LoaderCatalog(new GameDownloads()).versions(root.toRealPath(),
                required(request, "game"), required(request, "loader"), LaunchManifest.is(request.get("mirror"), true),
                LaunchManifest.is(request.get("refresh"), true));
            case "game.install" -> new MinecraftInstaller(new GameDownloads()).install(root.toRealPath(),
                request.getAsJsonObject("payload"), LaunchManifest.is(request.get("mirror"), true), new MinecraftInstaller.Progress() {});
            case "resource.search" -> new ResourceCatalog(new CatalogNetwork()).search(root.toRealPath(), request.getAsJsonObject("payload"));
            case "resource.icon" -> new ArtworkCache(root).fetch(request.getAsJsonObject("payload"), new CatalogNetwork());
            case "resource.versions" -> {
                var network = new CatalogNetwork();
                yield new ResourceVersions(network, new ResourceCatalog(network)).list(root.toRealPath(), request.getAsJsonObject("payload"));
            }
            case "resource.save" -> {
                var network = new CatalogNetwork();
                var catalog = new ResourceCatalog(network);
                yield new ResourceFileDownload(new GameDownloads(), network, catalog, new ResourceVersions(network, catalog))
                    .save(root.toRealPath(), request.getAsJsonObject("payload"), new MinecraftInstaller.Progress() {});
            }
            case "world.install" -> {
                var network = new CatalogNetwork();
                var catalog = new ResourceCatalog(network);
                var versions = new ResourceVersions(network, catalog);
                var files = new ResourceFileDownload(new GameDownloads(), network, catalog, versions);
                Path game = root.toRealPath();
                yield new WorldInstaller(files, versions).install(game, game, request.getAsJsonObject("payload"),
                    new MinecraftInstaller.Progress() {});
            }
            case "project.install", "project.requirements" -> {
                var network = new CatalogNetwork();
                var installer = new ProjectInstaller(new GameDownloads(), network, new ResourceCatalog(network));
                Path game = root.toRealPath();
                JsonObject payload = request.getAsJsonObject("payload");
                yield command.equals("project.install") ? installer.install(game, game, payload, new MinecraftInstaller.Progress() {})
                    : installer.requirements(game, game, payload);
            }
            case "local.resources" -> new LocalResources().list(root.toRealPath(), root.toRealPath(), request.getAsJsonObject("payload"));
            case "schematic.read" -> SchematicPreview.read(Path.of(required(request, "path")));
            case "schematic.catalogPreview" -> new SchematicCatalog(null, null, null)
                .preview(root.toRealPath(), request.getAsJsonObject("payload"));
            case "schematic.appearance" -> new SchematicAppearance(new GameDownloads())
                .load(root.toRealPath(), root.toRealPath(), request.getAsJsonObject("payload"));
            case "pack.inspect", "pack.import" -> {
                var downloads = new GameDownloads();
                var network = new CatalogNetwork();
                var packs = new PackInstaller(downloads, network, new ResourceCatalog(network), new MinecraftInstaller(downloads));
                JsonObject payload = request.getAsJsonObject("payload");
                Path file = Path.of(required(payload, "path"));
                yield command.equals("pack.inspect") ? packs.inspect(file)
                    : packs.local(root.toRealPath(), file, payload, LaunchManifest.is(request.get("mirror"), true),
                        new MinecraftInstaller.Progress() {});
            }
            case "wallpaper.scan" -> WallpaperLibrary.scan(request.getAsJsonArray("roots"));
            case "news.rss" -> NewsArticles.rss(required(request, "xml"));
            case "news.launcher" -> NewsArticles.launcher(request.getAsJsonObject("data"));
            case "icon.cacheRead" -> new ArtworkCache(root).read(required(request, "url"));
            case "icon.cacheWrite" -> new ArtworkCache(root).store(required(request, "url"), required(request, "bytes"));
            case "instance.context" -> InstanceContext.read(root);
            case "skin.export" -> new JsonPrimitive(TextureFiles.exportSkin(
                required(request, "texture"), Path.of(required(request, "path"))));
            default -> throw new IllegalArgumentException("不支持的 Java 组件操作");
        };
    }
}
