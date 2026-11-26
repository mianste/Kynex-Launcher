package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.keke.kynex.account.AccountStore;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.array;
import static com.keke.kynex.core.LaunchManifest.object;

/** Starts an existing game using the launcher data format and Java's process API. */
final class InstalledGameLauncher {
    private final Path dataRoot;

    InstalledGameLauncher(Path dataRoot) {
        this.dataRoot = dataRoot.toAbsolutePath().normalize();
    }

    JsonObject launchOffline(JsonObject payload) throws IOException, InterruptedException {
        return launch(payload, null, null, null, new MinecraftInstaller.Progress() {});
    }

    JsonObject launch(JsonObject payload, GameRuntimeInstaller installer, MicrosoftLogin login, ExternalLogin external,
                      MinecraftInstaller.Progress progress)
        throws IOException, InterruptedException {
        return launch(payload, installer, login, external, progress, (process, log, gameDir) -> {});
    }

    @FunctionalInterface
    interface LaunchObserver {
        void started(Process process, Path log, Path gameDirectory) throws IOException, InterruptedException;
    }

    JsonObject launch(JsonObject payload, GameRuntimeInstaller installer, MicrosoftLogin login, ExternalLogin external,
                      MinecraftInstaller.Progress progress, LaunchObserver observer)
        throws IOException, InterruptedException {
        String id = required(payload, "id");
        LaunchManifest.safeName(id);
        String accountId = required(payload, "accountId");
        Path root = new GameDirectories(dataRoot).resolveSelected(text(payload, "directoryId", null)).toRealPath();
        Path instance = root.resolve("instances").resolve(id).toRealPath();
        if (!instance.startsWith(root.resolve("instances"))) throw new IOException("游戏实例位于所选目录之外");
        Path configPath = instance.resolve("kxl.json");
        JsonObject config = object(JsonFiles.read(configPath));
        JsonObject version = object(JsonFiles.read(instance.resolve("version.json")));
        String game = required(config, "version");
        Path gameDir = gameDirectory(root, dataRoot, instance, config);
        Files.createDirectories(gameDir);

        JsonObject account = new AccountStore(dataRoot).find(accountId);
        String kind = text(account, "kind", "");
        MicrosoftLogin.Session session = new MicrosoftLogin.Session("0", "legacy");
        String authAgent = null;
        if ("microsoft".equals(kind) && login != null) {
            progress.update("验证微软账号", 0, 1);
            session = login.session(account);
        } else if ("external".equals(kind) && external != null) {
            progress.update("验证外置认证账号", 0, 1);
            session = external.session(account);
            authAgent = external.agent(root, account, new GameDownloads(), progress);
        } else if (!"offline".equals(kind)) throw new IOException("所选账号需要桌面认证");
        JsonObject global = object(payload.get("settings"));
        JsonObject settings = config.get("settings") instanceof JsonObject local ? local : global;
        var platform = platform(version);
        GameAssets.prepareInstalled(root, instance, version, platform);
        JsonObject java = object(version.get("javaVersion"));
        long minimum = java.has("majorVersion") ? java.get("majorVersion").getAsLong() : 8;
        String custom = text(settings, "java", "");
        int major = JavaRuntimes.recommended(minimum);
        String runtime = JavaRuntimes.find(custom, major, root, dataRoot);
        if (runtime == null && installer != null) {
            runtime = required(installer.install(root, major, progress), "path");
        }
        if (runtime == null) throw new IOException("没有找到 Java " + major + "，请在设置中指定 Java 路径");

        Path natives = Files.createDirectories(instance.resolve("natives")).toRealPath();
        if (!natives.startsWith(instance)) throw new IOException("原生库目录位于实例之外");
        var classpath = new ArrayList<String>();
        var archives = new JsonArray();
        for (JsonElement item : LaunchManifest.launchLibraries(version, platform)) {
            JsonObject library = object(item);
            Path path = within(root.resolve("libraries"), required(library, "path"));
            if (Files.exists(path)) {
                classpath.add(path.toString());
                if (LaunchManifest.is(library.get("extract"), true)) archives.add(path.toString());
            }
            String classifier = text(library, "classifier", null);
            if (classifier != null) archives.add(within(root.resolve("libraries"), classifier).toString());
        }
        NativeLibraries.unpack(natives, archives);
        classpath.add(instance.resolve("client.jar").toString());
        try {
            GameOptions.applyLanguage(gameDir, game, text(global, "gameLanguage", "zh_cn"));
        } catch (IOException ignored) {
            // A read-only options file does not prevent the game from starting.
        }
        var effectiveSettings = settings.deepCopy();
        if (text(effectiveSettings, "jvmArgs", "").isBlank()) {
            String globalJvmArgs = text(global, "jvmArgs", "");
            if (!globalJvmArgs.isBlank()) effectiveSettings.addProperty("jvmArgs", globalJvmArgs);
        }
        if (text(effectiveSettings, "gameArgs", "").isBlank()) {
            String globalGameArgs = text(global, "gameArgs", "");
            if (!globalGameArgs.isBlank()) effectiveSettings.addProperty("gameArgs", globalGameArgs);
        }
        var request = new JsonObject();
        request.add("version", version);
        request.add("settings", effectiveSettings);
        request.addProperty("loader", text(config, "loader", "vanilla"));
        if (authAgent != null) request.addProperty("authAgent", authAgent);
        request.add("variables", variables(root, gameDir, natives, game, classpath, version, global, account, session));
        var command = new ArrayList<String>();
        command.add(runtime);
        for (JsonElement argument : LaunchManifest.arguments(request, platform)) command.add(argument.getAsString());

        Path logs = Files.createDirectories(instance.resolve("logs")).toRealPath();
        if (!logs.startsWith(instance)) throw new IOException("日志目录位于实例之外");
        Path log = logs.resolve("kxl-launch.log");
        if (Files.exists(log) && !log.toRealPath().startsWith(logs)) throw new IOException("日志路径无效");
        GameDownloads.check(progress::stopped);
        Process process = new ProcessBuilder(command).directory(gameDir.toFile())
            .redirectErrorStream(true).redirectOutput(log.toFile()).start();
        try {
            process.getOutputStream().close();
            config.addProperty("lastPlayed", Long.toString(Instant.now().getEpochSecond()));
            JsonFiles.write(configPath, config);
        } catch (IOException error) {
            process.destroyForcibly();
            throw error;
        }
        observer.started(process, log, gameDir);
        var reply = new JsonObject();
        reply.addProperty("pid", process.pid());
        reply.addProperty("log", log.toString());
        return reply;
    }

    static Path gameDirectory(Path root, Path dataRoot, Path instance, JsonObject config) {
        var settings = object(config.get("settings"));
        String isolation = text(settings, "isolation", "");
        if ("custom".equals(isolation)) {
            Path custom = Path.of(required(settings, "gameDirectory"));
            if (!custom.isAbsolute() || custom.getParent() == null) throw new IllegalArgumentException("游戏目录路径无效");
            return custom;
        }
        if ("shared".equals(isolation) || ("modded".equals(isolation) && "vanilla".equals(text(config, "loader", "")))) {
            return root.equals(dataRoot) ? root.resolve("shared") : root;
        }
        return instance;
    }

    private static Path within(Path root, String relative) throws IOException {
        Path child = Path.of(relative);
        Path resolved = root.resolve(child).normalize();
        if (child.getRoot() != null || !resolved.startsWith(root)) throw new IOException("资源路径不安全");
        if (Files.exists(resolved) && !resolved.toRealPath().startsWith(root.toRealPath())) {
            throw new IOException("资源路径不安全");
        }
        return resolved;
    }

    private static JsonObject variables(Path root, Path gameDir, Path natives, String game, List<String> classpath,
                                        JsonObject version, JsonObject settings, JsonObject account, MicrosoftLogin.Session session) {
        String uuid = required(account, "uuid");
        String index = text(object(version.get("assetIndex")), "id", "");
        var values = new JsonObject();
        values.addProperty("auth_player_name", required(account, "name"));
        values.addProperty("auth_uuid", uuid);
        values.addProperty("auth_access_token", session.token());
        values.addProperty("user_type", session.kind());
        values.addProperty("version_name", game);
        values.addProperty("version_type", "release");
        values.addProperty("game_directory", gameDir.toString());
        values.addProperty("assets_root", root.resolve("assets").toString());
        values.addProperty("assets_index_name", index);
        values.addProperty("natives_directory", natives.toString());
        values.addProperty("launcher_name", "Kynex Launcher");
        values.addProperty("launcher_version", System.getProperty("kynex.version", "1.7.0"));
        values.addProperty("classpath", String.join(File.pathSeparator, classpath));
        values.addProperty("classpath_separator", File.pathSeparator);
        values.addProperty("library_directory", root.resolve("libraries").toString());
        values.addProperty("user_properties", "{}");
        values.addProperty("clientid", text(settings, "clientId", ""));
        values.addProperty("auth_xuid", "");
        values.addProperty("auth_session", "token:" + session.token() + ":" + uuid);
        values.addProperty("game_assets", root.resolve("assets/virtual").resolve(index.isEmpty() ? "legacy" : index).toString());
        return values;
    }

    static LaunchManifest.Platform platform(JsonObject version) {
        String name = System.getProperty("os.name").toLowerCase(Locale.ROOT);
        String os = name.startsWith("windows") ? "windows" : name.startsWith("mac") ? "osx" : "linux";
        String arch = switch (System.getProperty("os.arch")) {
            case "amd64" -> "x86_64";
            case "i386" -> "x86";
            default -> System.getProperty("os.arch");
        };
        var matches = new HashSet<String>();
        JsonObject arguments = object(version.get("arguments"));
        for (JsonArray rows : List.of(array(version.get("libraries")), array(arguments.get("jvm")), array(arguments.get("game")))) {
            for (JsonElement item : rows) {
                for (JsonElement entry : array(object(item).get("rules"))) {
                    String pattern = text(object(object(entry).get("os")), "version", null);
                    if (pattern == null || pattern.length() > 128) continue;
                    try {
                        if (Pattern.compile(pattern).matcher(System.getProperty("os.version", "")).find()) matches.add(pattern);
                    } catch (PatternSyntaxException ignored) {
                        // Invalid system conditions are ignored.
                    }
                }
            }
        }
        return new LaunchManifest.Platform(os, arch, System.getProperty("sun.arch.data.model", "64"), matches);
    }

}
