package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import static org.junit.jupiter.api.Assertions.*;

final class MinecraftInstallerTest {
    @Test
    void mirrorsReportWhatFailedWithoutMislabelingTheOfficialSource() throws Exception {
        var downloads = new GameDownloads(address -> {
            if (address.getHost().equals("bmclapi2.bangbang93.com")) {
                throw new javax.net.ssl.SSLHandshakeException("fixture connection failed");
            }
            return new java.io.ByteArrayInputStream("""
                {"latest":{"release":"1.21.1"},"versions":[{"id":"1.21.1"}]}
                """.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        });
        var rows = downloads.benchmark();
        var mirror = rows.get(0).getAsJsonObject();
        assertFalse(mirror.get("ok").getAsBoolean());
        assertEquals("HTTPS 握手失败", mirror.get("reason").getAsString());
        assertTrue(rows.get(1).getAsJsonObject().get("ok").getAsBoolean());
    }

    private static final String ID = "1.7.10";

    @Test
    void verifiesAndReusesGameFilesWithoutOverwritingAnExistingInstance(@TempDir Path root) throws Exception {
        var remote = new Fixture();
        var catalog = new MinecraftCatalog(remote.downloads);
        assertEquals(ID, catalog.versions(root, true, true, () -> false).get(0).getAsJsonObject().get("id").getAsString());
        assertEquals(1, remote.requests.get("bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json"));
        var installer = new MinecraftInstaller(remote.downloads);
        var first = installer.install(root, request(), true, new MinecraftInstaller.Progress() {});
        Path initial = Path.of(first.get("path").getAsString());
        Path save = Files.createDirectories(initial.resolve("saves/生存")).resolve("level.dat");
        Files.writeString(save, "original save");
        var second = installer.install(root, request(), true, new MinecraftInstaller.Progress() {});

        assertEquals("测试游戏 (2)", second.get("name").getAsString());
        assertNotEquals(first.get("id"), second.get("id"));
        assertEquals("original save", Files.readString(save));
        assertEquals("client payload", Files.readString(initial.resolve("client.jar")));
        assertEquals("dependency payload", Files.readString(root.resolve("libraries/test/lib/1/lib-1.jar")));
        assertEquals("translated asset", Files.readString(root.resolve("assets/virtual/legacy/sample/旧版.txt")));
        assertEquals(1, remote.requests.get("piston-data.mojang.com/client.jar"));
        assertEquals(1, remote.requests.get("piston-meta.mojang.com/version.json"));
        try (var objects = Files.list(root.resolve("assets/objects"))) {
            assertEquals(1, objects.count());
        }
        assertEquals(ID, catalog.versions(root, false, true, () -> false).get(0).getAsJsonObject().get("id").getAsString());
    }

    @Test
    void installsLoaderProfilesOverTheOriginalClientAndReusesTheCatalogue(@TempDir Path root) throws Exception {
        var remote = new Fixture();
        var catalog = new LoaderCatalog(remote.downloads);
        var installer = new MinecraftInstaller(remote.downloads);
        for (String loader : new String[]{"fabric", "quilt"}) {
            assertEquals("0.16.10", catalog.versions(root, ID, loader, false, false).get(0).getAsString());
            assertTrue(catalog.versions(root, "1.2.5", loader, false, false).isEmpty());
            var request = request();
            request.addProperty("loader", loader);
            request.addProperty("loaderVersion", "0.16.10");
            var installed = installer.install(root, request, false, new MinecraftInstaller.Progress() {});
            var instance = Path.of(installed.get("path").getAsString());
            assertEquals(loader, installed.get("loader").getAsString());
            assertEquals("loader.Main", JsonFiles.read(instance.resolve("version.json")).getAsJsonObject().get("mainClass").getAsString());
            assertEquals("client payload", Files.readString(instance.resolve("client.jar")));
            assertEquals("loader dependency", Files.readString(root.resolve("libraries/test/loader/1/loader-1.jar")));
        }
        assertEquals(1, remote.requests.get("meta.fabricmc.net/v2/versions/game"));
        assertEquals(1, remote.requests.get("meta.quiltmc.org/v3/versions/game"));
    }

    @Test
    void retriesInterruptedDownloadsAndAcceptsAnEmptyFileWithAValidChecksum(@TempDir Path root) throws Exception {
        var attempts = new java.util.concurrent.atomic.AtomicInteger();
        var downloads = new GameDownloads(ignored -> {
            if (attempts.incrementAndGet() == 1) throw new java.net.SocketException("connection reset");
            return new ByteArrayInputStream(new byte[0]);
        });
        Path file = root.resolve("test.jar");
        downloads.file("https://libraries.minecraft.net/test.jar", false, file, sha(new byte[0]), 1, () -> false);
        assertEquals(0, Files.size(file));
        assertEquals(2, attempts.get());

        attempts.set(0);
        var metadata = new GameDownloads(ignored -> {
            if (attempts.incrementAndGet() == 1) throw new java.net.SocketTimeoutException("timed out");
            return new ByteArrayInputStream(bytes("[8]"));
        });
        assertEquals(8, metadata.document("https://api.adoptium.net/test", false, "", value -> value.isJsonArray(),
            () -> false).value().getAsJsonArray().get(0).getAsInt());
        assertEquals(2, attempts.get());
    }

    @Test
    void skipsAnUnreachableMirrorForTheNextDownload(@TempDir Path root) throws Exception {
        var mirrorRequests = new java.util.concurrent.atomic.AtomicInteger();
        var downloads = new GameDownloads(address -> {
            if (address.getHost().equals("bmclapi2.bangbang93.com")) {
                mirrorRequests.incrementAndGet();
                throw new java.net.SocketTimeoutException("timed out");
            }
            return new ByteArrayInputStream(bytes("official data"));
        });
        for (String name : new String[]{"one.jar", "two.jar"}) {
            downloads.file("https://libraries.minecraft.net/" + name, true, root.resolve(name),
                sha(bytes("official data")), 1024, () -> false);
        }
        assertEquals(1, mirrorRequests.get());
    }

    @Test
    void leavesNoInstanceAfterACorruptDownloadOrCancellation(@TempDir Path root) throws Exception {
        var remote = new Fixture();
        var installer = new MinecraftInstaller(remote.downloads);
        remote.resources.put("/client.jar", bytes("invalid contents"));
        var error = assertThrows(IOException.class, () ->
            installer.install(root, request(), false, new MinecraftInstaller.Progress() {}));
        assertTrue(error.getMessage().contains("校验失败"));
        assertEmpty(root.resolve("instances"));
        assertEmpty(root.resolve("cache/installing"));
        assertEmpty(root.resolve("cache/game-clients").resolve(sha(bytes("client payload"))));

        var progress = new MinecraftInstaller.Progress() {
            private boolean cancel;
            @Override public boolean stopped() { return cancel; }
            @Override public void update(String stage, int done, int total) { cancel = stage.equals("准备游戏客户端"); }
        };
        assertEquals("下载已取消", assertThrows(IOException.class, () ->
            installer.install(root, request(), false, progress)).getMessage());
        assertEmpty(root.resolve("instances"));
        assertEmpty(root.resolve("cache/installing"));
    }

    @Test
    void extractsRuntimeDirectoriesAndRejectsPathsOutsideOfStaging(@TempDir Path root) throws Exception {
        Path archive = root.resolve("runtime.zip");
        Path staging = Files.createDirectory(root.resolve("staging"));
        try (var zip = new ZipOutputStream(Files.newOutputStream(archive))) {
            zip.putNextEntry(new ZipEntry("jre/bin/"));
            zip.closeEntry();
            zip.putNextEntry(new ZipEntry("jre/bin/java.exe"));
            zip.write(bytes("runtime"));
            zip.closeEntry();
        }
        GameRuntimeInstaller.extract(archive, staging, new MinecraftInstaller.Progress() {});
        assertEquals("runtime", Files.readString(staging.resolve("jre/bin/java.exe")));
        try (var zip = new ZipOutputStream(Files.newOutputStream(archive))) {
            zip.putNextEntry(new ZipEntry("../outside.txt"));
            zip.write(bytes("outside"));
            zip.closeEntry();
        }
        assertThrows(IOException.class, () -> GameRuntimeInstaller.extract(archive, staging, new MinecraftInstaller.Progress() {}));
        assertFalse(Files.exists(root.resolve("outside.txt")));
    }

    private static void assertEmpty(Path path) throws IOException {
        try (var files = Files.list(path)) { assertEquals(0, files.count()); }
    }

    private static JsonObject request() {
        var request = new JsonObject();
        request.addProperty("name", "测试游戏");
        request.addProperty("version", ID);
        request.addProperty("loader", "vanilla");
        return request;
    }

    private static byte[] bytes(String value) { return value.getBytes(StandardCharsets.UTF_8); }

    private static String sha(byte[] value) throws NoSuchAlgorithmException {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-1").digest(value));
    }

    private static final class Fixture {
        final Map<String, byte[]> resources = new ConcurrentHashMap<>();
        final Map<String, Integer> requests = new ConcurrentHashMap<>();
        final GameDownloads downloads = new GameDownloads(this::open);

        Fixture() throws Exception {
            byte[] assets = bytes("translated asset");
            String hash = sha(assets);
            resources.put("/" + hash.substring(0, 2) + "/" + hash, assets);
            byte[] index = bytes(("""
                {"virtual":true,"objects":{"sample/旧版.txt":{"hash":"%s"},"sample/复制.txt":{"hash":"%s"}}}
                """).formatted(hash, hash));
            byte[] client = bytes("client payload");
            byte[] library = bytes("dependency payload");
            byte[] version = bytes(("""
                {"id":"%s","mainClass":"game.Main","downloads":{"client":{
                    "url":"https://piston-data.mojang.com/client.jar","sha1":"%s"
                 }},
                 "libraries":[{"name":"test:lib:1","downloads":{"artifact":{
                    "url":"https://libraries.minecraft.net/test/lib/1/lib-1.jar","path":"test/lib/1/lib-1.jar","sha1":"%s"
                 }}}],
                 "assetIndex":{"id":"legacy","url":"https://piston-meta.mojang.com/index.json","sha1":"%s"}}
                """).formatted(ID, sha(client), sha(library), sha(index)));
            resources.put("/client.jar", client);
            resources.put("/version.json", version);
            resources.put("/index.json", index);
            resources.put("/test/lib/1/lib-1.jar", library);
            resources.put("/test/loader/1/loader-1.jar", bytes("loader dependency"));
            for (String api : new String[]{"/v2", "/v3"}) {
                resources.put(api + "/versions/game", bytes("[{\"version\":\"" + ID + "\"}]"));
                resources.put(api + "/versions/loader", bytes("[{\"version\":\"0.16.10\"}]"));
                resources.put(api + "/versions/loader/" + ID + "/0.16.10/profile/json", bytes("""
                    {"id":"sample-loader","inheritsFrom":"1.7.10","mainClass":"loader.Main",
                     "downloads":{},"libraries":[{"name":"test:loader:1","url":"https://maven.fabricmc.net/"}]}
                    """));
            }
            resources.put("/mc/game/version_manifest_v2.json", bytes(("""
                {"versions":[{"id":"%s","url":"https://piston-meta.mojang.com/version.json","sha1":"%s"}]}
                """).formatted(ID, sha(version))));
        }

        private InputStream open(URI uri) throws IOException {
            String path = uri.getPath();
            requests.merge(uri.getHost() + path, 1, Integer::sum);
            if (uri.getHost().equals("bmclapi2.bangbang93.com") && path.equals("/client.jar")) {
                return new ByteArrayInputStream(bytes("corrupt mirror"));
            }
            if (uri.getHost().equals("bmclapi2.bangbang93.com") && !path.contains("manifest")) throw new IOException("镜像暂时不可用");
            if (uri.getHost().equals("piston-meta.mojang.com") && path.contains("manifest")
                && requests.containsKey("bmclapi2.bangbang93.com" + path)) throw new IOException("离线测试");
            byte[] body = resources.get(path);
            if (body == null) throw new IOException("未登记测试文件：" + path);
            return new ByteArrayInputStream(body);
        }
    }
}
