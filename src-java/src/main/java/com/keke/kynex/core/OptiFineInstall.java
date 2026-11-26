package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.regex.Pattern;
import java.util.zip.ZipFile;

import static com.keke.kynex.core.GameDownloads.check;
import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.object;

final class OptiFineInstall {
    private static final String OFFICIAL = "https://optifine.net/";
    private static final String MIRROR = "https://bmclapi2.bangbang93.com/optifine/";
    private static volatile JsonObject bundledIndex;
    private static final Pattern ROW = Pattern.compile("(?is)<tr\\b[^>]*>(.*?)</tr>");
    private static final Pattern RELEASE = Pattern.compile(
        "colMirror['\"][^>]*>.*?adloadx\\?f=((?:preview_)?OptiFine_([0-9.]+)_([A-Za-z0-9_]+)\\.jar)", Pattern.DOTALL);
    private static final Pattern FORGE = Pattern.compile("colForge['\"][^>]*>\\s*Forge\\s+([0-9.]+)\\s*</td>");
    private static final Pattern PARTS = Pattern.compile("([A-Za-z0-9_]+)_([A-Za-z][0-9]+(?:_pre[0-9]+)?)");
    private final GameDownloads downloads;

    OptiFineInstall(GameDownloads downloads) { this.downloads = downloads; }

    JsonArray versions(Path root, String game, boolean refresh) throws IOException {
        LaunchManifest.safeName(game);
        Path cache = GameFiles.target(root, "cache/optifine/" + game + ".json");
        if (!refresh && Files.isRegularFile(cache) && Files.size(cache) < GameDownloads.DOCUMENT_LIMIT
            && Files.getLastModifiedTime(cache).toInstant().plus(Duration.ofHours(1)).isAfter(Instant.now())) {
            try {
                if (JsonFiles.read(cache) instanceof JsonArray list) return list;
            } catch (JsonParseException invalid) {
                // Replace the invalid cache from a current source.
            }
        }
        JsonArray result;
        JsonArray builtIn = refresh ? null : bundled(game);
        if (builtIn != null) {
            try { JsonFiles.write(cache, builtIn); } catch (IOException ignored) { /* The bundled list is enough. */ }
            return builtIn;
        }
        try {
            String page = downloads.textFile(OFFICIAL + "downloads", GameDownloads.DOCUMENT_LIMIT);
            if (!page.contains("downloadTable")) throw new IOException("OptiFine 下载列表格式无效");
            result = parse(page, game);
        } catch (IOException network) {
            try {
                var response = downloads.document(MIRROR + game, false, "", value -> value instanceof JsonArray, () -> false);
                result = new JsonArray();
                for (var item : response.value().getAsJsonArray()) {
                    JsonObject row = object(item);
                    add(result, text(row, "filename", ""), text(row, "type", ""), text(row, "patch", ""),
                        text(row, "forge", "").replaceFirst("^Forge\\s+", "").strip());
                }
            } catch (IOException error) {
                if (!(error.getCause() instanceof GameDownloads.HttpError http) || http.status != 404) {
                    network.addSuppressed(error);
                    throw network;
                }
                result = new JsonArray();
            }
        }
        JsonFiles.write(cache, result);
        return result;
    }

    private static JsonArray bundled(String game) {
        JsonObject index = bundledIndex;
        if (index == null) {
            try (var stream = OptiFineInstall.class.getResourceAsStream("/optifine-versions.json")) {
                index = stream == null ? new JsonObject()
                    : JsonFiles.JSON.fromJson(new String(stream.readAllBytes(), StandardCharsets.UTF_8), JsonObject.class);
            } catch (IOException | RuntimeException ignored) {
                index = new JsonObject();
            }
            bundledIndex = index;
        }
        if (index != null && index.get(game) instanceof JsonArray list) return list.deepCopy();
        return null;
    }

    static JsonArray parse(String page, String game) {
        var result = new JsonArray();
        var rows = ROW.matcher(page);
        while (rows.find()) {
            String row = rows.group(1);
            var release = RELEASE.matcher(row);
            if (!release.find() || !game.equals(release.group(2))) continue;
            var parts = PARTS.matcher(release.group(3));
            if (!parts.matches()) continue;
            var forge = FORGE.matcher(row);
            add(result, release.group(1), parts.group(1), parts.group(2), forge.find() ? forge.group(1) : "");
        }
        return result;
    }

    private static void add(JsonArray result, String filename, String edition, String patch, String forge) {
        if (!filename.matches("[A-Za-z0-9_.+-]+\\.jar") || !edition.matches("[A-Za-z0-9_]+")
            || !patch.matches("[A-Za-z0-9_]+")) return;
        String value = edition + "_" + patch;
        if (result.asList().stream().anyMatch(row -> value.equals(text(row.getAsJsonObject(), "value", "")))) return;
        var release = new JsonObject();
        release.addProperty("value", value);
        release.addProperty("filename", filename);
        release.addProperty("edition", edition);
        release.addProperty("patch", patch);
        if (forge.matches("[0-9.]+")) release.addProperty("forge", forge);
        result.add(release);
    }

    void install(Path root, Path staging, JsonObject version, JsonObject settings, String game, String selected,
                 String forge, MinecraftInstaller.Progress progress) throws IOException, InterruptedException {
        JsonObject release = versions(root, game, false).asList().stream().map(LaunchManifest::object)
            .filter(row -> selected.equals(text(row, "value", ""))).findFirst()
            .orElseThrow(() -> new IOException("所选游戏版本没有这个 OptiFine 版本，请重新选择"));
        if (forge != null && !forge.equals(text(release, "forge", ""))) {
            throw new IOException("此 OptiFine 需要 Forge " + text(release, "forge", "兼容版本"));
        }
        String filename = required(release, "filename");
        LaunchManifest.safeName(filename);
        Path installer = GameFiles.target(root, "cache/optifine/" + filename);
        progress.update("下载 OptiFine", 0, 1);
        if (!hasTweaker(installer)) download(root, installer, game, release, progress);
        if (forge != null) {
            Path mod = GameFiles.target(staging, "mods/" + filename);
            Files.copy(installer, mod);
            return;
        }

        Path work = Files.createTempDirectory(staging, "optifine-");
        try (var archive = new ZipFile(installer.toFile())) {
            String coordinate = "optifine:OptiFine:" + game + "_" + selected;
            Path patched = work.resolve("optifine.jar");
            if (archive.getEntry("optifine/Patcher.class") != null) {
                progress.update("应用 OptiFine 补丁", 0, 1);
                String java = LoaderProcess.java(root, version, settings, downloads, progress);
                LoaderProcess.run(java, List.of("-cp", installer.toString(), "optifine.Patcher",
                    staging.resolve("client.jar").toString(), installer.toString(), patched.toString()), work,
                    "OptiFine 补丁工具", progress);
            } else Files.copy(installer, patched);
            if (!hasTweaker(patched)) throw new IOException("OptiFine 文件缺少启动类");
            var libraries = version.getAsJsonArray("libraries");
            libraries.add(library(root, coordinate, patched));
            String wrapper = "optifine:launchwrapper:2.0";
            String bundled = "launchwrapper-2.0.jar";
            var wrapperMarker = archive.getEntry("launchwrapper-of.txt");
            if (wrapperMarker != null) {
                String revision;
                try (var stream = archive.getInputStream(wrapperMarker)) {
                    revision = new String(stream.readNBytes(129), StandardCharsets.UTF_8).strip();
                }
                LaunchManifest.safeName(revision);
                wrapper = "optifine:launchwrapper-of:" + revision;
                bundled = "launchwrapper-of-" + revision + ".jar";
            }
            if (archive.getEntry(bundled) != null) {
                Path wrapperJar = work.resolve("wrapper.jar");
                ForgeInstall.extract(archive, bundled, wrapperJar, "", progress);
                libraries.add(library(root, wrapper, wrapperJar));
            } else {
                var standard = new JsonObject();
                standard.addProperty("name", "net.minecraft:launchwrapper:1.12");
                libraries.add(standard);
            }
            version.addProperty("mainClass", "net.minecraft.launchwrapper.Launch");
            if (version.get("arguments") instanceof JsonObject args && args.get("game") instanceof JsonArray gameArguments) {
                gameArguments.add("--tweakClass");
                gameArguments.add("optifine.OptiFineTweaker");
            } else {
                version.addProperty("minecraftArguments",
                    text(version, "minecraftArguments", "") + " --tweakClass optifine.OptiFineTweaker");
            }
        } finally {
            GameFiles.removeStaging(work);
        }
    }

    private void download(Path root, Path installer, String game, JsonObject release, MinecraftInstaller.Progress progress)
        throws IOException {
        String filename = required(release, "filename");
        String encoded = URLEncoder.encode(filename, StandardCharsets.UTF_8);
        Path work = Files.createTempDirectory(GameFiles.target(root, "cache/optifine/.parent").getParent(), "download-");
        Path staged = work.resolve("optifine.jar");
        try {
            try {
                String page = downloads.textFile(OFFICIAL + "adloadx?f=" + encoded, GameDownloads.DOCUMENT_LIMIT);
                var link = Pattern.compile("downloadx\\?f=" + Pattern.quote(encoded) + "(?:&amp;|&)x=([A-Za-z0-9]+)").matcher(page);
                if (!link.find()) throw new IOException("OptiFine 官网未返回下载链接");
                downloads.file(OFFICIAL + "downloadx?f=" + encoded + "&x=" + link.group(1), false, staged, "",
                    GameDownloads.FILE_LIMIT, progress::stopped);
                if (!hasTweaker(staged)) throw new IOException("OptiFine 官网返回的文件无效");
            } catch (IOException official) {
                check(progress::stopped);
                Files.deleteIfExists(staged);
                downloads.file(MIRROR + game + "/" + required(release, "edition") + "/" + required(release, "patch"),
                    false, staged, "", GameDownloads.FILE_LIMIT, progress::stopped);
                if (!hasTweaker(staged)) throw new IOException("OptiFine 下载内容不是有效的 JAR", official);
            }
            check(progress::stopped);
            Files.move(staged, installer, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } finally {
            GameFiles.removeStaging(work);
        }
    }

    private static boolean hasTweaker(Path path) {
        try (var jar = new ZipFile(path.toFile())) {
            return jar.getEntry("optifine/OptiFineTweaker.class") != null;
        } catch (IOException invalid) {
            return false;
        }
    }

    private static JsonObject library(Path root, String coordinate, Path source) throws IOException {
        String path = LaunchManifest.coordinatePath(coordinate);
        Path destination = GameFiles.target(root, "libraries/" + path);
        byte[] bytes = Files.readAllBytes(source);
        String hash;
        try {
            hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-1").digest(bytes));
        } catch (NoSuchAlgorithmException error) {
            throw new IOException("无法校验 OptiFine 文件", error);
        }
        if (!Files.isRegularFile(destination) || Files.mismatch(source, destination) != -1) JsonFiles.atomicWrite(destination, bytes);
        var artifact = new JsonObject();
        artifact.addProperty("path", path);
        artifact.addProperty("url", OFFICIAL);
        artifact.addProperty("sha1", hash);
        var downloads = new JsonObject();
        downloads.add("artifact", artifact);
        var library = new JsonObject();
        library.addProperty("name", coordinate);
        library.add("downloads", downloads);
        return library;
    }
}
