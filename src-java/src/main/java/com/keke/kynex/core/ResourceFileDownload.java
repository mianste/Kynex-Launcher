package com.keke.kynex.core;

import com.google.gson.JsonObject;
import java.io.IOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import java.util.Map;

import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.array;
import static com.keke.kynex.core.LaunchManifest.is;
import static com.keke.kynex.core.LaunchManifest.object;

final class ResourceFileDownload {
    private static final String MODRINTH = "https://api.modrinth.com/v2/version/";
    private final GameDownloads downloads;
    private final CatalogNetwork network;
    private final ResourceCatalog catalog;
    private final ResourceVersions versions;

    private record FileInfo(String url, String name, String hash) {}

    ResourceFileDownload(GameDownloads downloads, CatalogNetwork network, ResourceCatalog catalog, ResourceVersions versions) {
        this.downloads = downloads;
        this.network = network;
        this.catalog = catalog;
        this.versions = versions;
    }

    JsonObject save(Path root, JsonObject request, MinecraftInstaller.Progress progress) throws IOException, InterruptedException {
        String kind = required(request, "kind");
        Path destination = Path.of(required(request, "path"));
        if (!destination.isAbsolute() || !destination.equals(destination.normalize()) || destination.getParent() == null) {
            throw new IOException("请选择完整的保存路径");
        }
        Path parent = destination.getParent().toRealPath();
        Path output = parent.resolve(destination.getFileName());
        if (Files.isSymbolicLink(output) || Files.exists(output) && !Files.isRegularFile(output)) {
            throw new IOException("保存位置不是普通文件");
        }
        Path work = Files.createTempDirectory(parent, ".kxl-resource-");
        String name;
        try {
            Path staged = work.resolve("resource");
            name = download(root, request, staged, progress);
            progress.save(staged, output);
        } finally {
            GameFiles.removeStaging(work);
        }
        var value = new JsonObject();
        value.addProperty("path", output.toString());
        value.addProperty("filename", name);
        if (kind.equals("worlds")) {
            value.addProperty("status", "downloaded");
            value.addProperty("note", "文件已保存。");
        }
        return value;
    }

    String download(Path root, JsonObject request, Path target, MinecraftInstaller.Progress progress)
        throws IOException, InterruptedException {
        String kind = required(request, "kind");
        if (!ResourceVersions.KINDS.contains(kind)) throw new IOException("资源类型无效");
        String release = required(request, "versionId");
        if (!release.matches("[A-Za-z0-9_-]{1,120}")) throw new IOException("文件版本 ID 无效");
        progress.update("读取资源文件", 0, 1);
        FileInfo file = switch (text(request, "source", "modrinth")) {
            case "modrinth" -> modrinth(request, kind, release);
            case "curseforge" -> curseforge(request, release);
            case "pixelmap" -> pixelmap(root, request, release);
            default -> throw new IOException("资源来源无效");
        };
        if (!ResourceVersions.extension(file.name(), kind)) throw new IOException("所选文件类型无法用于此资源");
        if (file.hash().isEmpty() && !text(request, "source", "").equals("pixelmap")
            || !file.hash().isEmpty() && !file.hash().matches("(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})")) {
            throw new IOException("下载来源没有提供有效校验值");
        }
        progress.update("下载并校验资源文件", 0, 1);
        if (file.hash().isEmpty() && kind.equals("worlds") && "pixelmap".equals(text(request, "source", "")))
            PublicMapArchive.fetch(file.url(), target, progress);
        else downloads.file(file.url(), false, target, file.hash(), kind.equals("worlds") ? 2L * 1024 * 1024 * 1024
            : GameDownloads.FILE_LIMIT, progress::stopped);
        if (kind.equals("worlds")) verifyArchive(target, file.name());
        return file.name();
    }

    private FileInfo modrinth(JsonObject request, String kind, String release) throws IOException {
        String project = ResourceVersions.project(request, false);
        var version = object(network.json(MODRINTH + release, ""));
        if (!project.equals(text(version, "project_id", ""))) throw new IOException("所选版本不属于此项目");
        JsonObject file = ResourceVersions.modrinthFile(version, kind);
        if (file == null) throw new IOException("此发行版没有对应类型的可下载文件");
        String hash = text(object(file.get("hashes")), "sha1", "");
        if (hash.isEmpty()) throw new IOException("Modrinth 未提供文件校验值");
        return new FileInfo(required(file, "url"), required(file, "filename"), hash);
    }

    private FileInfo curseforge(JsonObject request, String release) throws IOException, InterruptedException {
        String project = ResourceVersions.project(request, true);
        if (!release.matches("[0-9]{1,18}")) throw new IOException("CurseForge 文件 ID 无效");
        var payload = object(catalog.curseforge("/mods/" + project + "/files/" + release, Map.of(), request));
        var file = object(payload.get("data"));
        if (!project.equals(file.has("modId") ? file.get("modId").getAsString() : "")
            || !release.equals(file.has("id") ? file.get("id").getAsString() : "")
            || is(file.get("isAvailable"), false) || is(file.get("isServerPack"), true)) {
            throw new IOException("所选文件不属于此项目或不可下载");
        }
        String url = ResourceCatalog.https(text(file, "downloadUrl", ""));
        if (url == null) throw new IOException("CurseForge 暂未提供此文件的下载链接");
        for (var item : array(file.get("hashes"))) {
            var row = object(item);
            if (ResourceCatalog.number(row, "algo", 0) == 1) return new FileInfo(url, required(file, "fileName"), required(row, "value"));
        }
        throw new IOException("CurseForge 未提供文件校验值");
    }

    private FileInfo pixelmap(Path root, JsonObject request, String release) throws IOException, InterruptedException {
        String project = ResourceVersions.project(request, false);
        JsonObject detail = versions.pixelmapDetail(root, request, project);
        String actual = ResourceCatalog.https(text(detail, "download_url", ""));
        if (actual == null || !is(detail.get("download_allowed"), true)) {
            throw new IOException("像素茶艺暂未提供可下载的地图文件");
        }
        URI uri = URI.create(actual);
        if (uri.getPort() == -1 && !is(detail.get("download_integrated"), true)) {
            JsonObject linked = versions.linkedCurseForge(request, uri);
            if (linked != null) return curseforge(linked, release);
        }
        String filename = PublicMapArchive.name(uri);
        if (!project.equals(release) || filename == null || !"oss.pixelmap.cc".equals(uri.getHost()) && is(detail.get("download_integrated"), true)) {
            throw new IOException("作者提供的地图文件需要从原下载页保存");
        }
        return new FileInfo(actual, filename, "");
    }

    private static void verifyArchive(Path file, String name) throws IOException {
        byte[] prefix;
        try (var input = Files.newInputStream(file)) { prefix = input.readNBytes(8); }
        boolean valid = prefix.length >= 6 && switch (name.substring(name.lastIndexOf('.')).toLowerCase(Locale.ROOT)) {
            case ".zip" -> prefix[0] == 'P' && prefix[1] == 'K';
            case ".rar" -> prefix[0] == 'R' && prefix[1] == 'a' && prefix[2] == 'r' && prefix[3] == '!';
            case ".7z" -> prefix[0] == '7' && prefix[1] == 'z' && prefix[2] == (byte) 0xbc && prefix[3] == (byte) 0xaf;
            default -> false;
        };
        if (!valid) throw new IOException("下载链接未返回地图压缩包");
    }
}
