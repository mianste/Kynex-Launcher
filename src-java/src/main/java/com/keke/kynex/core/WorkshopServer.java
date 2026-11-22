package com.keke.kynex.core;

import com.google.gson.JsonObject;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;
import java.util.zip.ZipFile;

import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.array;
import static com.keke.kynex.core.LaunchManifest.object;
import static com.keke.kynex.core.WorkshopPlans.json;
import static com.keke.kynex.core.WorkshopPlans.number;

final class WorkshopServer {
    private static final Set<String> MAIN = Set.of("net.fabricmc.loader.impl.launch.server.FabricServerLauncher", "net.fabricmc.loader.impl.launch.knot.KnotServer",
        "org.quiltmc.loader.impl.launch.server.QuiltServerLauncher", "org.quiltmc.loader.impl.launch.knot.KnotServer");
    private static final String PROPERTIES = """
        online-mode=true
        server-port=25565
        max-players=10
        view-distance=8
        simulation-distance=8
        motd=Kynex Minecraft Server
        """;
    private final GameDownloads downloads;
    private final MinecraftCatalog catalog;

    WorkshopServer(GameDownloads downloads, MinecraftCatalog catalog) {
        this.downloads = downloads;
        this.catalog = catalog;
    }

    JsonObject create(Path root, Path instance, String server, JsonObject plan, MinecraftInstaller.Progress progress)
        throws IOException, InterruptedException {
        String game = required(plan, "minecraft");
        JsonObject loader = object(plan.get("loader"));
        String kind = required(loader, "type"), release = text(loader, "version", "");
        if (!Set.of("vanilla", "fabric", "quilt", "forge", "neoforge").contains(kind)) throw new IOException("此加载器不支持生成服务端包");
        LaunchManifest.safeName(game);
        LaunchManifest.safeName(server);
        if (!kind.equals("vanilla")) LaunchManifest.safeName(release);
        Path target = GameFiles.target(root, "server/" + server);
        Path work = Files.createTempDirectory(target.getParent(), ".server-");
        try {
            JsonObject base = catalog.version(root, game, false, progress::stopped);
            JsonObject client = object(object(base.get("downloads")).get("server"));
            String hash = required(client, "sha1");
            if (!hash.matches("[a-fA-F0-9]{40}")) throw new IOException("服务端下载缺少有效哈希");
            Path cache = GameFiles.target(root, "cache/server-jars/" + hash + ".jar");
            progress.update("下载并校验服务端", 0, 1);
            downloads.file(required(client, "url"), false, cache, hash, GameDownloads.FILE_LIMIT, progress::stopped);
            Files.copy(cache, GameFiles.target(work, "server.jar"));
            var arguments = switch (kind) {
                case "fabric", "quilt" -> profile(work, game, kind, release, progress);
                case "forge", "neoforge" -> forge(root, work, base, kind, game, release, progress);
                default -> List.of("-jar", "server.jar");
            };
            var removed = new ArrayList<String>();
            var warnings = new ArrayList<String>();
            var clientMods = GameFiles.target(instance, "mods");
            Files.createDirectory(GameFiles.target(work, "mods"));
            long bytes = 0;
            if (Files.isDirectory(clientMods)) try (var files = Files.list(clientMods)) {
                var mods = files.filter(path -> Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)
                    && path.getFileName().toString().endsWith(".jar")).sorted().limit(81).toList();
                if (mods.size() > 80) throw new IOException("服务端最多支持 80 个模组");
                for (Path file : mods) {
                    GameDownloads.check(progress::stopped);
                    String name = file.getFileName().toString();
                    Boolean side = clientOnly(GameFiles.target(clientMods, name));
                    if (Boolean.TRUE.equals(side)) { removed.add(name); continue; }
                    if (side == null) warnings.add(name + " 未声明侧别，请核对作者说明。");
                    bytes += Files.size(file);
                    if (bytes > WorkshopPlans.LIMIT) throw new IOException("服务端模组超过 2 GB");
                    Files.copy(file, GameFiles.target(work, "mods/" + name));
                }
            }
            warnings.addAll(WorkshopFileCopy.configs(instance, work, progress));
            long memory = Math.clamp(number(plan, "memoryMb", 4096), 512, 65_536);
            Files.writeString(work.resolve("server.properties"), PROPERTIES);
            Files.writeString(work.resolve("eula.txt"), "eula=false\n");
            Files.writeString(work.resolve("user_jvm_args.txt"), "-Xms512M\n-Xmx" + memory + "M\n");
            String run = arguments.stream().map(s -> "\"" + s + "\"").collect(java.util.stream.Collectors.joining(" "));
            Files.writeString(work.resolve("start.bat"), "@echo off\r\ncd /d \"%~dp0\"\r\njava -Xmx" + memory + "M " + run + " nogui\r\npause\r\n");
            Files.writeString(work.resolve("start.sh"), "#!/bin/sh\ncd -- \"$(dirname -- \"$0\")\"\nexec java -Xmx" + memory + "M " + run + " nogui\n");
            Files.writeString(work.resolve("README.md"), "# KXL 服务端包\n\nMinecraft " + game + " / " + kind
                + "。请使用匹配的 Java，并按 Minecraft EULA 确认后启动。默认端口 25565，使用正版验证。\n");
            var meta = json("version", 1, "id", server, "sourceInstanceId", instance.getFileName().toString(), "args", arguments, "memoryMb", memory,
                "minecraft", game, "loader", loader);
            if (arguments.size() == 1) meta.addProperty("argumentsSha256", WorkshopSnapshots.hash(GameFiles.target(work, arguments.getFirst().substring(1))));
            JsonFiles.write(work.resolve("kxl-server.json"), meta);
            progress.publish(work, target);
            return json("serverId", server, "location", "当前游戏目录 server/" + server, "removedClientMods", removed, "warnings", warnings, "eulaAccepted", false);
        } finally { if (Files.exists(work, LinkOption.NOFOLLOW_LINKS)) GameFiles.removeStaging(work); }
    }

    private List<String> profile(Path work, String game, String loader, String release, MinecraftInstaller.Progress progress) throws IOException {
        String api = loader.equals("fabric") ? "https://meta.fabricmc.net/v2" : "https://meta.quiltmc.org/v3";
        var profile = object(downloads.document(api + "/versions/loader/" + game + "/" + release + "/server/json", false, "",
            node -> node.isJsonObject() && MAIN.contains(text(object(node), "mainClass", "")), progress::stopped).value());
        var paths = new ArrayList<String>();
        for (var raw : array(profile.get("libraries"))) {
            var lib = object(raw);
            String artifact = LaunchManifest.coordinatePath(required(lib, "name"));
            String base = text(lib, "url", loader.equals("fabric") ? "https://maven.fabricmc.net/" : "https://maven.quiltmc.org/repository/release/");
            String url = base.replaceFirst("/+$", "") + "/" + artifact;
            String hash = text(lib, "sha1", "");
            if (hash.isEmpty()) hash = downloads.textFile(url + ".sha1", 1024).strip().split("\\s+", 2)[0];
            if (!hash.matches("[a-fA-F0-9]{40}")) throw new IOException("服务端依赖缺少有效校验值");
            String path = "libraries/" + artifact;
            downloads.file(url, false, GameFiles.target(work, path), hash, GameDownloads.FILE_LIMIT, progress::stopped);
            paths.add(path);
        }
        paths.add("server.jar");
        return List.of("-cp", String.join(File.pathSeparator, paths), required(profile, "mainClass"));
    }

    private List<String> forge(Path root, Path work, JsonObject version, String kind, String game, String release, MinecraftInstaller.Progress progress)
        throws IOException, InterruptedException {
        boolean forge = kind.equals("forge");
        String coordinate = forge ? game + "-" + release : release;
        if (!coordinate.matches("[a-zA-Z0-9._+-]+")) throw new IOException("服务端加载器版本无效");
        String group = forge ? "net/minecraftforge/forge" : "net/neoforged/neoforge";
        String origin = forge ? "https://maven.minecraftforge.net/" : "https://maven.neoforged.net/releases/";
        String filename = kind + "-" + coordinate + "-installer.jar";
        String url = origin + group + "/" + coordinate + "/" + filename;
        String sha = downloads.textFile(url + ".sha1", 1024).strip().split("\\s+", 2)[0];
        if (!sha.matches("[a-fA-F0-9]{40}")) throw new IOException("服务端安装器缺少校验值");
        Path installer = GameFiles.target(root, "cache/loader-installers/" + filename);
        downloads.file(url, false, installer, sha, GameDownloads.FILE_LIMIT, progress::stopped);
        String java = LoaderProcess.java(root, version, MinecraftInstaller.defaults(), downloads, progress);
        LoaderProcess.run(java, List.of("-jar", installer.toString(), "--installServer", work.toString()), work, "安装服务端加载器", progress);
        String platform = File.separator.equals("\\") ? "win" : "unix";
        String args = "libraries/" + group + "/" + coordinate + "/" + platform + "_args.txt";
        if (!Files.isRegularFile(GameFiles.target(work, args), LinkOption.NOFOLLOW_LINKS)) throw new IOException("加载器未生成服务端启动参数");
        return List.of("@" + args);
    }

    JsonObject verify(Path root, String server, String instance, boolean accepted, MinecraftInstaller.Progress progress)
        throws IOException, InterruptedException {
        if (!accepted) throw new IOException("请阅读并确认 Minecraft EULA，再验证服务端");
        if (!UUID.fromString(server).toString().equals(server)) throw new IOException("服务端编号无效");
        Path directory = GameFiles.target(root, "server/" + server);
        var metadata = object(JsonFiles.read(GameFiles.target(directory, "kxl-server.json")));
        if (!server.equals(required(metadata, "id")) || !instance.equals(required(metadata, "sourceInstanceId")))
            throw new IOException("服务端不属于此任务");
        var arguments = array(metadata.get("args")).asList().stream().map(com.google.gson.JsonElement::getAsString).toList();
        validate(directory, arguments, text(metadata, "argumentsSha256", ""));
        var version = catalog.version(root, required(metadata, "minecraft"), false, progress::stopped);
        String java = LoaderProcess.java(root, version, MinecraftInstaller.defaults(), downloads, progress);
        Path eula = GameFiles.target(directory, "eula.txt");
        JsonFiles.atomicWrite(eula, "eula=true\n".getBytes(StandardCharsets.UTF_8));
        var command = new ArrayList<>(List.of(java, "-Xmx" + Math.clamp(number(metadata, "memoryMb", 4096), 512, 65_536) + "M"));
        command.addAll(arguments);
        command.add("nogui");
        Path output = GameFiles.target(directory, "kxl-server-verify.log");
        Path properties = GameFiles.target(directory, "server.properties");
        byte[] saved = Files.isRegularFile(properties) ? Files.readAllBytes(properties) : PROPERTIES.getBytes(StandardCharsets.UTF_8);
        if (saved.length > 128 * 1024) throw new IOException("服务端配置过大");
        String local = new String(saved, StandardCharsets.UTF_8).replaceAll("(?m)^(?:server-ip|server-port)\\s*=.*$", "")
            + "\nserver-ip=127.0.0.1\nserver-port=0\n";
        JsonFiles.atomicWrite(properties, local.getBytes(StandardCharsets.UTF_8));
        try {
            var process = new ProcessBuilder(command).directory(directory.toFile()).redirectErrorStream(true).redirectOutput(output.toFile()).start();
            try {
                long start = System.nanoTime();
                while (System.nanoTime() - start < Duration.ofMinutes(3).toNanos()) {
                    GameDownloads.check(progress::stopped);
                    String logs = WorkshopVerification.tail(output, 32_000);
                    if (process.isAlive() && logs.contains("Done (")) {
                        process.getOutputStream().write("stop\n".getBytes(StandardCharsets.UTF_8));
                        process.getOutputStream().flush();
                        if (!process.waitFor(10, TimeUnit.SECONDS)) throw new IOException("服务端已启动，但未能在十秒内正常停止");
                        return json("verified", true, "stopped", true, "elapsedMs", TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start));
                    }
                    if (!process.isAlive()) throw new IOException("服务端提前退出：" + AssistantService.redact(logs, ""));
                    process.waitFor(250, TimeUnit.MILLISECONDS);
                }
                throw new IOException("服务端启动验证超时");
            } finally {
                if (process.isAlive()) {
                    process.destroyForcibly();
                    process.waitFor(5, TimeUnit.SECONDS);
                }
            }
        } finally { JsonFiles.atomicWrite(properties, saved); }
    }

    static void validate(Path root, List<String> args, String hash) throws IOException {
        if (args.equals(List.of("-jar", "server.jar"))) {
            if (Files.isRegularFile(GameFiles.target(root, "server.jar"))) return;
        } else if (args.size() == 3 && args.getFirst().equals("-cp") && MAIN.contains(args.getLast())) {
            for (String path : args.get(1).split(Pattern.quote(File.pathSeparator))) {
                if (!(path.startsWith("libraries/") || path.equals("server.jar")) || !Files.isRegularFile(GameFiles.target(root, path)))
                    throw new IOException("服务端类路径无效");
            }
            return;
        } else if (args.size() == 1 && args.getFirst().matches("@libraries/(?:net/minecraftforge/forge|net/neoforged/neoforge)/[A-Za-z0-9._+-]+/(?:win|unix)_args\\.txt")) {
            Path params = GameFiles.target(root, args.getFirst().substring(1));
            if (!Files.isRegularFile(params) || Files.size(params) > 128 * 1024) throw new IOException("服务端参数无效");
            if (!hash.isEmpty()) {
                if (hash.equals(WorkshopSnapshots.hash(params))) return;
                throw new IOException("服务端参数已改变");
            }
            String content = Files.readString(params);
            if (!Pattern.compile("(?im)(?:^|[ \\t])(?:-javaagent:|-agentpath:|-agentlib:|--patch-module[ \\t]|@)")
                .matcher(content).find()) return;
        }
        throw new IOException("服务端参数无效");
    }

    private static Boolean clientOnly(Path path) throws IOException {
        try (var jar = new ZipFile(path.toFile())) {
            var fabric = jar.getEntry("fabric.mod.json");
            if (fabric != null && fabric.getSize() <= 1024 * 1024) try (var input = jar.getInputStream(fabric)) {
                var metadata = object(JsonFiles.JSON.fromJson(new String(input.readNBytes(1024 * 1024), StandardCharsets.UTF_8), JsonObject.class));
                return text(metadata, "environment", "").equals("client");
            }
            for (String name : List.of("META-INF/neoforge.mods.toml", "META-INF/mods.toml")) {
                var forge = jar.getEntry(name);
                if (forge != null && forge.getSize() <= 1024 * 1024) try (var input = jar.getInputStream(forge)) {
                    if (Pattern.compile("(?m)^\\s*clientSideOnly\\s*=\\s*true(?:\\s|$)")
                        .matcher(new String(input.readNBytes(1024 * 1024), StandardCharsets.UTF_8)).find()) return true;
                }
            }
            return null;
        }
    }
}
