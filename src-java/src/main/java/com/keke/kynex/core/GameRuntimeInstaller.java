package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.zip.ZipInputStream;

import static com.keke.kynex.core.GameDownloads.check;
import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.object;

final class GameRuntimeInstaller {
    private static final long EXTRACT_LIMIT = 1024L * 1024 * 1024;
    private static final String TUNA = "https://mirrors.tuna.tsinghua.edu.cn/Adoptium/";
    private final GameDownloads downloads;

    GameRuntimeInstaller(GameDownloads downloads) { this.downloads = downloads; }

    synchronized JsonObject install(Path root, int major, MinecraftInstaller.Progress progress)
        throws IOException, InterruptedException {
        if (!System.getProperty("os.name", "").startsWith("Windows")
            || !List.of("amd64", "x86_64").contains(System.getProperty("os.arch", ""))) {
            throw new IOException("内置 Java 下载面向 Windows 64 位，请通过设置指定 Java 路径");
        }
        if (!JavaRuntimes.SUPPORTED.contains(major)) throw new IOException("请选择受支持的 Java 版本");
        check(progress::stopped);
        Path destination = GameFiles.target(root, "runtimes/temurin-" + major);
        Path existing = find(destination, major);
        if (existing != null) return result(existing, true);

        progress.update("读取 Java 运行时清单", 0, 1);
        String query = "https://api.adoptium.net/v3/assets/latest/" + major
            + "/hotspot?architecture=x64&image_type=jre&os=windows&vendor=eclipse";
        var response = downloads.document(query, false, "", value -> value instanceof JsonArray items && !items.isEmpty(),
            progress::stopped);
        var detail = object(object(response.value().getAsJsonArray().get(0).getAsJsonObject().get("binary")).get("package"));
        String hash = required(detail, "checksum");
        if (!hash.matches("[a-fA-F0-9]{64}")) throw new IOException("Java 清单缺少有效的 SHA-256");
        String url = required(detail, "link");
        if (!url.startsWith("https://github.com/adoptium/")) throw new IOException("Java 下载地址不在 Adoptium 发布渠道");
        if (Files.exists(destination)) {
            destination = GameFiles.target(root, "runtimes/temurin-" + major + "-" + hash.substring(0, 12));
            existing = find(destination, major);
            if (existing != null) return result(existing, true);
            if (Files.exists(destination)) throw new IOException("安装位置已有无法使用的 Java 目录，请选择其他游戏目录");
        }

        Path archive = GameFiles.target(root, "cache/temurin-" + major + ".zip");
        download(url, text(detail, "name", ""), major, archive, hash, progress);
        Path stagingParent = GameFiles.target(root, "cache/installing/.staging-parent").getParent();
        Path staging = Files.createTempDirectory(stagingParent, "java-");
        try {
            progress.update("解压 Java 运行时", 0, 1);
            extract(archive, staging, progress);
            Path java = find(staging, major);
            if (java == null) throw new IOException("运行时包不包含可用的 Java " + major);
            Path executable = destination.resolve(staging.relativize(java));
            progress.publish(staging, destination);
            return result(executable, false);
        } catch (IOException | InterruptedException | RuntimeException error) {
            try {
                GameFiles.removeStaging(staging);
            } catch (IOException cleanup) {
                error.addSuppressed(cleanup);
            }
            throw error;
        }
    }

    private void download(String url, String name, int major, Path archive, String hash,
                          MinecraftInstaller.Progress progress) throws IOException {
        if (name.matches("OpenJDK[0-9]+U?-jre_x64_windows_hotspot_[a-zA-Z0-9._+-]+\\.zip")) {
            progress.update("从清华镜像下载 Java", 0, 1);
            try {
                downloads.file(TUNA + major + "/jre/x64/windows/" + name, false, archive, hash,
                    GameDownloads.FILE_LIMIT, progress::stopped);
                return;
            } catch (IOException failure) {
                check(progress::stopped);
            }
        }
        progress.update("从 Adoptium 下载 Java", 0, 1);
        downloads.file(url, false, archive, hash, GameDownloads.FILE_LIMIT, progress::stopped);
    }

    static void extract(Path archive, Path directory, MinecraftInstaller.Progress progress) throws IOException {
        int entries = 0;
        long extracted = 0;
        byte[] buffer = new byte[64 * 1024];
        try (var zip = new ZipInputStream(Files.newInputStream(archive))) {
            for (var entry = zip.getNextEntry(); entry != null; entry = zip.getNextEntry()) {
                check(progress::stopped);
                if (++entries > 20000) throw new IOException("运行时压缩包含过多文件");
                Path file = GameFiles.target(directory, entry.getName());
                if (entry.isDirectory()) {
                    if (zip.read() != -1) throw new IOException("运行时目录条目包含文件数据");
                    Files.createDirectories(file);
                } else {
                    try (var output = Files.newOutputStream(file, java.nio.file.StandardOpenOption.CREATE_NEW)) {
                        for (int count; (count = zip.read(buffer)) >= 0;) {
                            check(progress::stopped);
                            extracted += count;
                            if (extracted > EXTRACT_LIMIT) throw new IOException("Java 运行时解压体积超出限制");
                            output.write(buffer, 0, count);
                        }
                    }
                }
                zip.closeEntry();
            }
        }
    }

    private static Path find(Path destination, int major) throws IOException, InterruptedException {
        if (!Files.isDirectory(destination)) return null;
        var direct = destination.resolve("bin/java.exe");
        if (Files.isRegularFile(direct) && JavaRuntimes.version(direct.toString()) == major) return direct;
        try (var entries = Files.list(destination)) {
            for (Path folder : entries.toList()) {
                Path java = folder.resolve("bin/java.exe");
                if (Files.isRegularFile(java) && JavaRuntimes.version(java.toString()) == major) return java;
            }
        }
        return null;
    }

    private static JsonObject result(Path java, boolean existing) {
        var result = new JsonObject();
        result.addProperty("path", java.toString());
        result.addProperty("alreadyPresent", existing);
        return result;
    }
}
