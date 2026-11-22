package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.Charset;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import org.apache.commons.compress.PasswordRequiredException;
import org.apache.commons.compress.archivers.sevenz.SevenZFile;

import static com.keke.kynex.core.GameDownloads.check;
import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.array;
import static com.keke.kynex.core.LaunchManifest.is;
import static com.keke.kynex.core.LaunchManifest.object;

final class WorldInstaller {
    private static final long ARCHIVE_LIMIT = 2L * 1024 * 1024 * 1024;
    private static final long ENTRY_LIMIT = 1024L * 1024 * 1024;
    private static final int COUNT_LIMIT = 20_000;
    private final ResourceFileDownload files;
    private final ResourceVersions versions;
    private record Entry(ZipEntry entry, String path) {}
    private record Directory(Path staged, Path output) {}

    WorldInstaller(ResourceFileDownload files, ResourceVersions versions) {
        this.files = files;
        this.versions = versions;
    }

    JsonObject install(Path root, Path dataRoot, JsonObject request, MinecraftInstaller.Progress progress)
        throws IOException, InterruptedException {
        var params = request.deepCopy();
        params.addProperty("kind", "saves");
        Path saves = Files.createDirectories(LocalGameFiles.resourceDirectory(root, dataRoot, params)).toRealPath();
        params.addProperty("kind", "map-downloads");
        Path archives = Files.createDirectories(LocalGameFiles.resourceDirectory(root, dataRoot, params)).toRealPath();
        String preferred = text(request, "name", "地图");
        boolean local = "file".equals(text(request, "source", ""));
        Path work = Files.createTempDirectory(archives, ".kxl-map-");
        try {
            Path archive;
            String name;
            if (local) {
                archive = Path.of(required(request, "path"));
                if (!archive.isAbsolute() || !Files.isRegularFile(archive)) throw new IOException("请选择本机上的地图压缩包");
                if (Files.size(archive) > ARCHIVE_LIMIT) throw new IOException("地图压缩包超过 2 GB");
                name = archive.getFileName().toString();
            } else {
                params.addProperty("kind", "worlds");
                if (text(params, "versionId", "").isEmpty()) {
                    params.addProperty("paged", true);
                    JsonObject options = versions.list(root, params).getAsJsonObject();
                    var item = array(options.get("versions")).asList().stream().map(LaunchManifest::object)
                        .filter(row -> !is(row.get("webOnly"), true)).findFirst()
                        .orElseThrow(() -> new IOException(text(options, "unavailable", "资源来源暂未提供地图文件")));
                    params.addProperty("versionId", required(item, "id"));
                }
                archive = work.resolve("source.archive");
                name = files.download(root, params, archive, progress);
            }
            String fileType = type(archive);
            String originalName = stripExtension(name);
            progress.update("解压地图存档", 0, 1);
            Path staging = Files.createTempDirectory(saves, ".kxl-world-");
            var staged = new ArrayList<Directory>();
            Path preserved = null;
            try {
                if ("7z".equals(fileType)) readSevenZip(archive, staging, saves, preferred, staged, progress);
                else {
                    Path zip = "zip".equals(fileType) ? archive : convertRar(archive, work, progress);
                    readZip(zip, staging, saves, preferred, staged, progress);
                }
                if (!local || staged.isEmpty()) {
                    Path archived = unique(archives, safeName(originalName, "地图"), "." + fileType, new LinkedHashSet<>());
                    Path candidate = work.resolve("original.archive");
                    copy(archive, candidate, progress);
                    if (staged.isEmpty()) progress.publish(candidate, archived);
                    else {
                        check(progress::stopped);
                        Files.move(candidate, archived);
                    }
                    preserved = archived;
                }
                var published = new ArrayList<Directory>();
                try {
                    for (Directory directory : staged) {
                        progress.publish(directory.staged(), directory.output());
                        published.add(directory);
                    }
                } catch (IOException failure) {
                    for (Directory directory : published.reversed()) {
                        try { Files.move(directory.output(), directory.staged(), StandardCopyOption.ATOMIC_MOVE); }
                        catch (IOException rollback) { failure.addSuppressed(rollback); }
                    }
                    throw failure;
                }
                if (!local && request.has("previewUrl")) {
                    String cover = text(request, "previewUrl", "");
                    for (Directory world : published) WorldCovers.remember(dataRoot, world.output(), cover);
                }
                return receipt(published, preserved);
            } catch (IOException failure) {
                if (preserved != null) {
                    try { Files.deleteIfExists(preserved); }
                    catch (IOException cleanup) { failure.addSuppressed(cleanup); }
                }
                throw failure;
            } finally {
                GameFiles.removeStaging(staging);
            }
        } finally {
            GameFiles.removeStaging(work);
        }
    }

    private static void readZip(Path file, Path staging, Path saves, String preferred, List<Directory> outputs,
                                MinecraftInstaller.Progress progress) throws IOException {
        try (ZipFile zip = open(file)) {
            if (zip.size() > COUNT_LIMIT) throw new IOException("地图压缩包文件过多");
            var members = new ArrayList<Entry>();
            var roots = new LinkedHashSet<String>();
            long total = 0;
            for (var entries = zip.entries(); entries.hasMoreElements();) {
                check(progress::stopped);
                ZipEntry entry = entries.nextElement();
                String name = normalizeEntry(entry.getName());
                if (entry.isDirectory() && name.isEmpty()) continue;
                validate(name);
                if (entry.isDirectory()) continue;
                long size = entry.getSize();
                if (size < 0 || size > ENTRY_LIMIT || (total += size) > ARCHIVE_LIMIT || excessiveRatio(name, size, entry.getCompressedSize())) {
                    throw new IOException("地图解压体积超过限制");
                }
                members.add(new Entry(entry, name));
                collectWorldRoot(roots, name);
            }
            for (var world : prepareWorlds(roots, staging, saves, preferred).entrySet()) {
                for (var member : members) {
                    if (!member.path().startsWith(world.getKey())) continue;
                    String relative = member.path().substring(world.getKey().length());
                    var entry = member.entry();
                    try (var input = zip.getInputStream(entry)) {
                        extract(input, entry.getSize(), entry.getCrc(),
                            GameFiles.target(world.getValue().staged(), relative), progress);
                    }
                }
                if (!Files.isRegularFile(world.getValue().staged().resolve("level.dat"))) throw new IOException("地图缺少存档数据");
                outputs.add(world.getValue());
            }
        }
    }

    private static void readSevenZip(Path file, Path staging, Path saves, String preferred, List<Directory> outputs,
                                     MinecraftInstaller.Progress progress) throws IOException {
        try (var archive = SevenZFile.builder().setPath(file).setMaxMemoryLimitKiB(128 * 1024).get()) {
            var roots = new LinkedHashSet<String>();
            int count = 0;
            long total = 0;
            for (var entry : archive.getEntries()) {
                check(progress::stopped);
                if (++count > COUNT_LIMIT) throw new IOException("地图压缩包文件过多");
                String name = normalizeEntry(entry.getName());
                if (entry.isDirectory() && name.isEmpty()) continue;
                validate(name);
                if (entry.isDirectory() || entry.isAntiItem()) continue;
                long size = entry.getSize();
                if (size < 0 || size > ENTRY_LIMIT || (total += size) > ARCHIVE_LIMIT)
                    throw new IOException("地图解压体积超过限制");
                collectWorldRoot(roots, name);
            }
            var worlds = prepareWorlds(roots, staging, saves, preferred);
            if (worlds.isEmpty()) return;
            var input = new InputStream() {
                @Override public int read() throws IOException { return archive.read(); }
                @Override public int read(byte[] buffer, int offset, int length) throws IOException {
                    return archive.read(buffer, offset, length);
                }
            };
            for (var entry = archive.getNextEntry(); entry != null; entry = archive.getNextEntry()) {
                check(progress::stopped);
                if (entry.isDirectory() || entry.isAntiItem()) continue;
                String name = normalizeEntry(entry.getName());
                for (var world : worlds.entrySet()) {
                    if (!name.startsWith(world.getKey())) continue;
                    String relative = name.substring(world.getKey().length());
                    extract(input, entry.getSize(), -1, GameFiles.target(world.getValue().staged(), relative), progress);
                    break;
                }
            }
            for (Directory directory : worlds.values()) {
                if (!Files.isRegularFile(directory.staged().resolve("level.dat"))) throw new IOException("地图缺少存档数据");
                outputs.add(directory);
            }
        } catch (PasswordRequiredException encrypted) {
            throw new IOException("此 7z 地图需要密码，请先解压再导入存档", encrypted);
        }
    }

    private static LinkedHashMap<String, Directory> prepareWorlds(LinkedHashSet<String> roots, Path staging, Path saves,
                                                                  String preferred) throws IOException {
        var worlds = new LinkedHashMap<String, Directory>();
        var allocated = new LinkedHashSet<Path>();
        for (String world : roots) {
            if (roots.stream().anyMatch(parent -> parent.length() < world.length() && world.startsWith(parent))) continue;
            String fallback = world.isEmpty() ? "地图" : Path.of(world).getFileName().toString();
            String name = roots.size() == 1 ? safeName(preferred, fallback) : safeName(fallback, "地图");
            Path output = unique(saves, stripExtension(name), "", allocated);
            worlds.put(world, new Directory(Files.createTempDirectory(staging, "world-"), output));
        }
        return worlds;
    }

    private static String normalizeEntry(String name) throws IOException {
        if (name == null) throw new IOException("地图文件名无效");
        name = name.replace('\\', '/');
        while (name.startsWith("./")) name = name.substring(2);
        return name;
    }

    private static void collectWorldRoot(LinkedHashSet<String> roots, String name) {
        if (name.equals("level.dat") || name.endsWith("/level.dat"))
            roots.add(name.substring(0, name.length() - "level.dat".length()));
    }

    private static ZipFile open(Path file) throws IOException {
        try { return new ZipFile(file.toFile()); }
        catch (java.util.zip.ZipException encoding) {
            try { return new ZipFile(file.toFile(), Charset.forName("GB18030")); }
            catch (IOException invalid) { throw new IOException("下载的 ZIP 不完整或已损坏", invalid); }
        }
    }

    private static void extract(InputStream in, long size, long checksum, Path file, MinecraftInstaller.Progress progress) throws IOException {
        try (var out = Files.newOutputStream(file, StandardOpenOption.CREATE_NEW)) {
            long remaining = size;
            var crc = new CRC32();
            byte[] buffer = new byte[65536];
            for (int read; (read = in.read(buffer)) != -1;) {
                check(progress::stopped);
                if ((remaining -= read) < 0) throw new IOException("地图文件解压长度超过声明");
                out.write(buffer, 0, read);
                if (checksum >= 0) crc.update(buffer, 0, read);
            }
            if (remaining != 0 || checksum >= 0 && crc.getValue() != checksum) throw new IOException("地图文件不完整或校验失败");
        }
    }

    private static Path convertRar(Path source, Path work, MinecraftInstaller.Progress progress) throws IOException, InterruptedException {
        String systemRoot = System.getenv("SystemRoot");
        if (systemRoot == null) throw new IOException("此系统无法读取 RAR 地图压缩包");
        Path tar = Path.of(systemRoot, "System32", "tar.exe");
        if (!Files.isRegularFile(tar)) throw new IOException("此系统无法读取 RAR 地图压缩包");
        Path zip = work.resolve("converted.zip");
        var process = new ProcessBuilder(tar.toString(), "-cf", "-", "--format=zip", "--options", "zip:compression=store",
            "@" + source).redirectError(ProcessBuilder.Redirect.DISCARD).start();
        try (var in = process.getInputStream(); var out = Files.newOutputStream(zip, StandardOpenOption.CREATE_NEW)) {
            pipe(in, out, ARCHIVE_LIMIT + 16 * 1024 * 1024, progress);
            if (process.waitFor() != 0) throw new IOException("无法读取此地图压缩包，请确认压缩包完整且无需密码");
        } finally {
            if (process.isAlive()) process.destroyForcibly();
        }
        return zip;
    }

    private static void copy(Path source, Path output, MinecraftInstaller.Progress progress) throws IOException {
        try (var in = Files.newInputStream(source); var out = Files.newOutputStream(output, StandardOpenOption.CREATE_NEW)) {
            pipe(in, out, ARCHIVE_LIMIT, progress);
        }
    }

    private static void pipe(java.io.InputStream in, java.io.OutputStream out, long limit, MinecraftInstaller.Progress progress)
        throws IOException {
        byte[] buffer = new byte[65536];
        for (int n; (n = in.read(buffer)) != -1;) {
            check(progress::stopped);
            if ((limit -= n) < 0) throw new IOException("地图压缩包超过允许体积");
            out.write(buffer, 0, n);
        }
    }

    private static String type(Path file) throws IOException {
        try (var input = Files.newInputStream(file)) {
            byte[] bytes = input.readNBytes(8);
            if (bytes.length >= 6) {
                if (bytes[0] == 'P' && bytes[1] == 'K') return "zip";
                if (bytes[0] == 'R' && bytes[1] == 'a' && bytes[2] == 'r' && bytes[3] == '!') return "rar";
                if (bytes[0] == '7' && bytes[1] == 'z' && bytes[2] == (byte) 0xbc && bytes[3] == (byte) 0xaf) return "7z";
            }
        }
        throw new IOException("请选择 ZIP、RAR 或 7z 地图压缩包");
    }

    private static void validate(String name) throws IOException {
        if (name.isEmpty() || name.startsWith("/") || name.contains(":") || name.contains("//")) throw new IOException("地图文件名无效");
        for (String part : name.split("/")) {
            if (part.equals(".") || part.equals("..")) throw new IOException("地图文件路径超出存档目录");
        }
    }

    private static boolean excessiveRatio(String name, long size, long packed) {
        if (packed <= 0 || size < 65536 || size / packed <= 80) return false;
        return size > 16 * 1024 * 1024 || size / packed > 256
            || !name.matches("(?:.*/)?(?:region|entities|poi)/r\\.-?\\d+\\.-?\\d+\\.mca");
    }

    private static Path unique(Path root, String name, String extension, LinkedHashSet<Path> allocated) throws IOException {
        for (int i = 1; i <= 999; i++) {
            Path destination = GameFiles.target(root, name + (i == 1 ? "" : " (" + i + ")") + extension);
            if (!Files.exists(destination, LinkOption.NOFOLLOW_LINKS) && allocated.add(destination)) return destination;
        }
        throw new IOException("同名地图过多，请更换名称");
    }

    private static String stripExtension(String name) { return name.replaceFirst("(?i)\\.(zip|rar|7z)$", ""); }

    private static String safeName(String name, String fallback) {
        String clean = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").strip().replaceFirst("[. ]+$", "");
        if (clean.isEmpty()) clean = fallback;
        if (clean.length() > 100) clean = clean.substring(0, 100).strip().replaceFirst("[. ]+$", "");
        String prefix = clean.split("\\.", 2)[0].toUpperCase(Locale.ROOT);
        if (prefix.matches("CON|PRN|AUX|NUL|CONIN\\$|CONOUT\\$|(COM|LPT)[1-9¹²³]")) clean = "_" + clean;
        return clean;
    }

    private static JsonObject receipt(List<Directory> worlds, Path archive) {
        var result = new JsonObject();
        var names = new JsonArray();
        for (var world : worlds) names.add(world.output().getFileName().toString());
        result.add("worlds", names);
        if (archive == null) result.add("archive", JsonNull.INSTANCE);
        else result.addProperty("archive", archive.getFileName().toString());
        result.addProperty("status", worlds.isEmpty() ? "downloaded" : "installed");
        result.addProperty("note", worlds.isEmpty() ? "压缩包已保存到地图下载文件夹，包内没有可导入的 Java 版存档。"
            : "地图已经安装到存档文件夹。");
        return result;
    }
}
