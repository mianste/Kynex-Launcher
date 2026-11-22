package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.zip.ZipFile;
import java.util.jar.JarFile;

import static com.keke.kynex.core.GameDownloads.check;
import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.array;
import static com.keke.kynex.core.LaunchManifest.object;

final class ForgeInstall {
    private static final String FORGE = "https://maven.minecraftforge.net/net/minecraftforge/forge/";
    private static final String NEO = "https://maven.neoforged.net/releases/net/neoforged/neoforge/";
    private static final Pattern MAVEN_VERSION = Pattern.compile("<version>([0-9A-Za-z.+_-]+)</version>");
    private static final Pattern VARIABLE = Pattern.compile("\\{([^{}]+)\\}");
    private static final String SHA1 = "[a-fA-F0-9]{40}";
    private final GameDownloads downloads;

    ForgeInstall(GameDownloads downloads) { this.downloads = downloads; }

    JsonArray versions(Path root, String game, String loader, boolean refresh) throws IOException {
        LaunchManifest.safeName(game);
        String source = loader.equals("forge") ? FORGE : NEO;
        Path cache = GameFiles.target(root, "cache/loader-catalogs/" + loader + "-maven.xml");
        String metadata = Files.isRegularFile(cache) && Files.size(cache) < GameDownloads.DOCUMENT_LIMIT
            ? Files.readString(cache) : "";
        if (refresh || metadata.isEmpty()
            || Files.getLastModifiedTime(cache).toInstant().plus(Duration.ofHours(1)).isBefore(Instant.now())) {
            try {
                String fetched = downloads.textFile(source + "maven-metadata.xml", GameDownloads.DOCUMENT_LIMIT);
                if (!MAVEN_VERSION.matcher(fetched).find()) throw new IOException("加载器安装目录无效");
                metadata = fetched;
                JsonFiles.atomicWrite(cache, metadata.getBytes(StandardCharsets.UTF_8));
            } catch (IOException error) {
                if (metadata.isEmpty()) throw error;
            }
        }
        var entries = MAVEN_VERSION.matcher(metadata).results().map(match -> match.group(1)).toList();
        var result = new JsonArray();
        for (String entry : entries.reversed()) {
            if (loader.equals("forge") && entry.startsWith(game + "-")) result.add(entry.substring(game.length() + 1));
            if (loader.equals("neoforge") && neoMatches(game, entry)) result.add(entry);
        }
        return result;
    }

    private static boolean neoMatches(String game, String version) {
        String[] split = game.split("-", 2);
        String[] numbers = split[0].split("\\.", -1);
        if (numbers.length < 2 || numbers.length > 3 || !split[0].matches("[0-9]+(?:\\.[0-9]+){1,2}")) return false;
        String patch = numbers.length == 3 ? numbers[2] : "0";
        String prefix;
        if (numbers[0].equals("1")) prefix = numbers[1] + "." + patch + ".";
        else if (numbers[0].length() == 2 && Integer.parseInt(numbers[0]) >= 26) {
            prefix = numbers[0] + "." + numbers[1] + "." + patch + ".";
        } else return false;
        return version.startsWith(prefix)
            && (split.length == 1 ? !version.contains("+") : version.endsWith("+" + split[1]));
    }

    JsonObject install(Path root, Path staging, JsonObject base, JsonObject settings, String loader, String release,
                       boolean mirror, MinecraftInstaller.Progress progress) throws IOException, InterruptedException {
        String game = required(base, "id");
        String coordinate = loader.equals("forge") ? game + "-" + release : release;
        LaunchManifest.safeName(coordinate);
        if (!coordinate.matches("[a-zA-Z0-9._+-]+")) throw new IOException("加载器版本格式无效");
        String filename = loader + "-" + coordinate + "-installer.jar";
        String url = (loader.equals("forge") ? FORGE : NEO) + coordinate + "/" + filename;
        Path installer = GameFiles.target(root, "cache/loader-installers/" + filename);
        progress.update("下载加载器安装文件", 0, 1);
        String hash = downloads.textFile(url + ".sha1", 1024).strip().split("\\s+", 2)[0];
        if (!hash.matches(SHA1)) throw new IOException("加载器安装文件缺少有效的 SHA-1");
        downloads.file(url, mirror, installer, hash, GameDownloads.FILE_LIMIT, progress::stopped);

        try (var archive = new ZipFile(installer.toFile())) {
            JsonObject profile = json(archive, "install_profile.json");
            if (profile.get("versionInfo") instanceof JsonObject legacy) {
                JsonObject entry = object(profile.get("install"));
                compatible(game, text(entry, "minecraft", ""), legacy);
                Path jar = artifact(root, required(entry, "path"));
                extract(archive, required(entry, "filePath"), jar, "", progress);
                return merge(base, legacy);
            }
            JsonObject version = json(archive, text(profile, "json", "version.json"));
            compatible(game, text(profile, "minecraft", ""), version);
            if (!(profile.get("processors") instanceof JsonArray)) throw new IOException("加载器缺少客户端安装步骤");
            Path work = Files.createTempDirectory(staging, "loader-");
            try {
                process(root, work, staging.resolve("client.jar"), installer, archive, base, settings, profile, version,
                    mirror, progress);
            } finally {
                GameFiles.removeStaging(work);
            }
            return merge(base, version);
        }
    }

    private static void compatible(String game, String planned, JsonObject version) throws IOException {
        if ((!planned.isEmpty() && !game.equals(planned)) || !game.equals(text(version, "inheritsFrom", game))
            || text(version, "mainClass", null) == null || !(version.get("libraries") instanceof JsonArray)) {
            throw new IOException("加载器配置与所选 Minecraft 版本不匹配");
        }
    }

    private static JsonObject merge(JsonObject base, JsonObject overlay) {
        var result = LaunchManifest.merge(base, overlay).getAsJsonObject();
        result.add("downloads", base.get("downloads"));
        return result;
    }

    private void process(Path root, Path work, Path client, Path installer, ZipFile archive, JsonObject base,
                         JsonObject settings, JsonObject profile, JsonObject version, boolean mirror,
                         MinecraftInstaller.Progress progress) throws IOException, InterruptedException {
        Path localClient = Files.copy(client, work.resolve("minecraft.jar"));
        var variables = new LinkedHashMap<>(Map.of(
            "SIDE", "client", "ROOT", work.toString(), "INSTALLER", installer.toString(),
            "LIBRARY_DIR", root.resolve("libraries").toString(), "MINECRAFT_JAR", localClient.toString(),
            "MINECRAFT_VERSION", required(base, "id")));
        var libraries = new LinkedHashMap<String, JsonObject>();
        for (var list : List.of(array(profile.get("libraries")), array(version.get("libraries")))) {
            for (var row : list) {
                var entry = object(row);
                libraries.put(required(entry, "name"), entry);
            }
        }
        String maven = text(profile, "path", "");
        if (!maven.isEmpty() && !libraries.containsKey(maven)) {
            String path = LaunchManifest.coordinatePath(maven);
            if (archive.getEntry("maven/" + path) != null) {
                extract(archive, "maven/" + path, artifact(root, maven), "", progress);
            }
        }
        for (var row : libraries.entrySet()) prepareLibrary(root, archive, row.getKey(), row.getValue(), mirror, progress);
        initialize(root, work, archive, object(profile.get("data")), variables, progress);

        var steps = array(profile.get("processors")).asList().stream().map(LaunchManifest::object)
            .filter(step -> !step.has("sides") || array(step.get("sides")).asList().stream()
                .anyMatch(side -> side.getAsString().equals("client"))).toList();
        String java = null;
        for (int i = 0; i < steps.size(); i++) {
            check(progress::stopped);
            progress.update("生成加载器客户端文件", i, steps.size());
            JsonObject step = steps.get(i);
            var arguments = new ArrayList<String>();
            for (var argument : array(step.get("args"))) arguments.add(substitute(root, argument.getAsString(), variables));
            if (mapping(root, work, base, arguments, mirror, progress)) continue;
            var expected = new LinkedHashMap<Path, String>();
            for (var entry : object(step.get("outputs")).entrySet()) {
                String path = substitute(root, entry.getKey(), variables);
                String hash = substitute(root, entry.getValue().getAsString(), variables);
                if (!hash.matches(SHA1)) throw new IOException("加载器生成文件的 SHA-1 无效");
                expected.put(output(root, work, path), hash);
            }
            if (!expected.isEmpty() && verified(expected, progress)) continue;
            Path jar = artifact(root, required(step, "jar"));
            var paths = new ArrayList<String>();
            for (var item : array(step.get("classpath"))) {
                Path library = artifact(root, item.getAsString());
                if (!Files.isRegularFile(library)) throw new IOException("加载器工具缺少依赖：" + library.getFileName());
                paths.add(library.toString());
            }
            paths.add(jar.toString());
            var command = new ArrayList<>(List.of("-cp", String.join(File.pathSeparator, paths), mainClass(jar)));
            command.addAll(arguments);
            if (java == null) java = LoaderProcess.java(root, base, settings, downloads, progress);
            LoaderProcess.run(java, command, work, "加载器处理工具", progress);
            if (!verified(expected, progress)) throw new IOException("加载器生成文件的校验值不匹配");
        }
        progress.update("加载器客户端文件准备完成", steps.size(), steps.size());
    }

    private void prepareLibrary(Path root, ZipFile archive, String coordinate, JsonObject row, boolean mirror,
                                MinecraftInstaller.Progress progress) throws IOException {
        var artifact = object(object(row.get("downloads")).get("artifact"));
        String path = text(artifact, "path", LaunchManifest.coordinatePath(coordinate));
        String hash = text(artifact, "sha1", "");
        Path target = GameFiles.target(root, "libraries/" + path);
        if (archive.getEntry("maven/" + path) != null) {
            extract(archive, "maven/" + path, target, hash, progress);
            return;
        }
        String url = text(artifact, "url", "");
        if (!url.isEmpty()) downloads.file(url, mirror, target, hash, GameDownloads.FILE_LIMIT, progress::stopped);
    }

    private static void initialize(Path root, Path work, ZipFile archive, JsonObject data, Map<String, String> variables,
                                   MinecraftInstaller.Progress progress) throws IOException {
        var pending = new LinkedHashMap<String, String>();
        for (var entry : data.entrySet()) {
            String value = text(object(entry.getValue()), "client", null);
            if (value == null) continue;
            if (value.startsWith("/")) {
                Path target = GameFiles.target(work, value.substring(1));
                extract(archive, value, target, "", progress);
                variables.put(entry.getKey(), target.toString());
            } else pending.put(entry.getKey(), value);
        }
        while (!pending.isEmpty()) {
            boolean changed = false;
            for (var iterator = pending.entrySet().iterator(); iterator.hasNext();) {
                var entry = iterator.next();
                if (VARIABLE.matcher(entry.getValue()).results().anyMatch(token -> !variables.containsKey(token.group(1)))) continue;
                variables.put(entry.getKey(), substitute(root, entry.getValue(), variables));
                iterator.remove();
                changed = true;
            }
            if (!changed) throw new IOException("加载器配置包含未定义的变量");
        }
    }

    private boolean mapping(Path root, Path work, JsonObject base, List<String> args, boolean mirror,
                            MinecraftInstaller.Progress progress) throws IOException {
        if (!"DOWNLOAD_MOJMAPS".equals(argument(args, "--task")) || !"client".equals(argument(args, "--side"))
            || !required(base, "id").equals(argument(args, "--version"))) return false;
        Path target = output(root, work, argument(args, "--output"));
        JsonObject mapping = object(object(base.get("downloads")).get("client_mappings"));
        String hash = required(mapping, "sha1");
        if (!hash.matches(SHA1)) throw new IOException("游戏映射缺少有效的 SHA-1");
        downloads.file(required(mapping, "url"), mirror, target, hash, GameDownloads.FILE_LIMIT, progress::stopped);
        return true;
    }

    private static String argument(List<String> args, String key) {
        int position = args.indexOf(key);
        return position >= 0 && position + 1 < args.size() ? args.get(position + 1) : "";
    }

    static String substitute(Path root, String value, Map<String, String> variables) throws IOException {
        if (value.length() > 1 && value.startsWith("'") && value.endsWith("'")) return value.substring(1, value.length() - 1);
        if (value.startsWith("[") && value.endsWith("]")) return artifact(root, value.substring(1, value.length() - 1)).toString();
        var matches = VARIABLE.matcher(value);
        var result = new StringBuilder();
        while (matches.find()) {
            String replacement = variables.get(matches.group(1));
            if (replacement == null) throw new IOException("加载器配置变量无效：" + matches.group(1));
            matches.appendReplacement(result, java.util.regex.Matcher.quoteReplacement(replacement));
        }
        return matches.appendTail(result).toString();
    }

    private static Path artifact(Path root, String coordinate) throws IOException {
        return GameFiles.target(root, "libraries/" + LaunchManifest.coordinatePath(coordinate));
    }

    static Path output(Path root, Path work, String value) throws IOException {
        Path path = Path.of(value);
        Path library = root.resolve("libraries");
        if (!path.isAbsolute() || !path.equals(path.normalize())) throw new IOException("加载器输出路径无效");
        if (!path.startsWith(library) && !path.startsWith(work)) throw new IOException("加载器输出路径超出安装目录");
        if (path.equals(library) || path.equals(work)) throw new IOException("加载器输出位置必须是文件");
        return GameFiles.target(root, root.relativize(path).toString().replace(File.separatorChar, '/'));
    }

    private static boolean verified(Map<Path, String> outputs, MinecraftInstaller.Progress progress) throws IOException {
        for (var output : outputs.entrySet()) {
            if (!Files.isRegularFile(output.getKey()) || !GameDownloads.matches(output.getKey(), output.getValue(), progress::stopped)) {
                return false;
            }
        }
        return true;
    }

    private static String mainClass(Path jar) throws IOException {
        try (var file = new JarFile(jar.toFile())) {
            String type = file.getManifest() == null ? null : file.getManifest().getMainAttributes().getValue("Main-Class");
            if (type == null || !type.matches("[A-Za-z0-9._$]+")) throw new IOException("加载器工具入口无效");
            return type;
        }
    }

    private static JsonObject json(ZipFile zip, String name) throws IOException {
        var entry = zip.getEntry(name.replaceFirst("^/", ""));
        if (entry == null) throw new IOException("安装文件缺少配置：" + name);
        try (var stream = zip.getInputStream(entry)) {
            byte[] body = stream.readNBytes((int) GameDownloads.DOCUMENT_LIMIT + 1);
            if (body.length > GameDownloads.DOCUMENT_LIMIT) throw new IOException("加载器配置体积过大");
            JsonObject result = JsonFiles.JSON.fromJson(new String(body, StandardCharsets.UTF_8), JsonObject.class);
            if (result == null) throw new IOException("加载器配置为空");
            return result;
        } catch (JsonParseException invalid) {
            throw new IOException("加载器配置格式无效", invalid);
        }
    }

    static void extract(ZipFile zip, String name, Path destination, String hash, MinecraftInstaller.Progress progress)
        throws IOException {
        var entry = zip.getEntry(name.replaceFirst("^/", ""));
        if (entry == null || entry.isDirectory()) throw new IOException("安装器内缺少文件：" + name);
        if (!hash.isEmpty() && Files.isRegularFile(destination) && GameDownloads.matches(destination, hash, progress::stopped)) return;
        Path temp = Files.createTempFile(destination.getParent(), ".kxl-loader-", ".part");
        try {
            try (var input = zip.getInputStream(entry); var output = Files.newOutputStream(temp)) {
                long length = 0;
                byte[] buffer = new byte[64 * 1024];
                for (int count; (count = input.read(buffer)) != -1;) {
                    check(progress::stopped);
                    length += count;
                    if (length > GameDownloads.FILE_LIMIT) throw new IOException("安装文件体积过大");
                    output.write(buffer, 0, count);
                }
            }
            if (!hash.isEmpty() && !GameDownloads.matches(temp, hash, progress::stopped)) {
                throw new IOException("安装器内置依赖的校验值不匹配：" + name);
            }
            if (!Files.exists(destination) || Files.mismatch(temp, destination) != -1) {
                check(progress::stopped);
                Files.move(temp, destination, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            }
        } finally {
            Files.deleteIfExists(temp);
        }
    }
}
