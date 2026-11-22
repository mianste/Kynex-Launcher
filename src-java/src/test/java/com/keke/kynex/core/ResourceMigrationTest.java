package com.keke.kynex.core;

import com.google.gson.JsonObject;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import static org.junit.jupiter.api.Assertions.*;

final class ResourceMigrationTest {
    @Test
    void reportsTheProviderFailureWhileKeepingTheLastSuccessfulPage(@TempDir Path root) throws Exception {
        var networkCalls = new AtomicInteger();
        var catalog = new ResourceCatalog(new CatalogNetwork((url, timeout, limit, image, key) -> {
            if (networkCalls.incrementAndGet() == 1) {
                assertEquals(CatalogNetwork.SEARCH_TIMEOUT, timeout);
                return bytes("""
                    {"total_hits":1,"hits":[{"project_id":"stable","title":"Cached project","downloads":20}]}
                    """);
            }
            assertEquals(CatalogNetwork.SEARCH_RETRY_TIMEOUT, timeout);
            throw new GameDownloads.HttpError(429);
        }));
        var request = json("""
            {"kind":"mod","source":"modrinth","interactive":true}
            """);
        var first = catalog.search(root, request);
        request.addProperty("force", true);
        var stale = catalog.search(root, request);
        assertEquals(first.get("hits"), stale.get("hits"));
        assertTrue(stale.get("cached").getAsBoolean());
        assertTrue(stale.get("warning").getAsString().contains("HTTP 429"));
        assertFalse(catalog.search(root, json("""
            {"kind":"mod","source":"modrinth","interactive":true}
            """)).has("warning"));
    }

    @Test
    void keepsResourcePagesAndTheirArtworkInTheExistingDiskCache(@TempDir Path root) throws Exception {
        var networkCalls = new AtomicInteger();
        var network = new CatalogNetwork((url, timeout, limit, image, key) -> {
            networkCalls.incrementAndGet();
            if (image) return new byte[]{(byte) 137, 80, 78, 71, 13, 10, 26, 10, 0};
            assertEquals("api.modrinth.com", url.getHost());
            assertTrue(url.getQuery().contains("offset=30"));
            return bytes("""
                {"total_hits":60,"hits":[{"project_id":"abc123","title":"A map tool","downloads":14,
                "icon_url":"https://cdn.modrinth.com/icon.png","featured_gallery":"https://cdn.modrinth.com/gallery.png",
                "gallery":["https://cdn.modrinth.com/gallery.png","http://untrusted.invalid/not.png"]}]}
                """);
        });
        var catalog = new ResourceCatalog(network);
        var request = json(""" 
            {"kind":"mod","page":1,"source":"modrinth","game":"1.20.1","loader":"forge"}
            """);
        var first = catalog.search(root, request);
        var hit = first.getAsJsonArray("hits").get(0).getAsJsonObject();
        assertEquals(1, hit.getAsJsonArray("gallery").size());
        assertEquals(60, first.get("total").getAsInt());
        assertTrue(catalog.search(root, request).get("cached").getAsBoolean());
        var artwork = new ArtworkCache(root);
        var icon = new JsonObject();
        icon.add("url", hit.get("icon_url"));
        String data = artwork.fetch(icon, network).get("data").getAsString();
        assertTrue(data.startsWith("data:image/png;base64,"));
        icon.addProperty("cacheOnly", true);
        assertEquals(data, artwork.fetch(icon, network).get("data").getAsString());
        assertEquals(2, networkCalls.get());
        icon.addProperty("cacheOnly", false);
        icon.addProperty("url", "https://127.0.0.1/private.png");
        assertThrows(IOException.class, () -> artwork.fetch(icon, network));
        assertEquals(2, networkCalls.get());
    }

    @Test
    void downloadsOnlyTheSelectedProjectAndPreservesThePreviousFileAfterAChecksumFailure(@TempDir Path root) throws Exception {
        var network = new CatalogNetwork((url, timeout, limit, image, key) -> bytes("""
            {"project_id":"expected","files":[{"filename":"required.jar","primary":true,"url":"https://cdn.modrinth.com/file.jar",
              "hashes":{"sha1":"356a192b7913b04c54574d18c28d46e6395428ab"}}]}
            """));
        var catalog = new ResourceCatalog(network);
        var versions = new ResourceVersions(network, catalog);
        var networkCalls = new AtomicInteger();
        var download = new ResourceFileDownload(new GameDownloads(url -> {
            networkCalls.incrementAndGet();
            return new ByteArrayInputStream(bytes(networkCalls.get() == 1 ? "corrupt" : "1"));
        }), network, catalog, versions);
        Path destination = Files.writeString(root.resolve("existing.jar"), "old file");
        var request = json("""
            {"kind":"mods","project":"other","source":"modrinth","versionId":"release"}
            """);
        request.addProperty("path", destination.toString());
        assertThrows(IOException.class, () -> download.save(root, request, new MinecraftInstaller.Progress() {}));
        assertEquals(0, networkCalls.get());
        request.addProperty("project", "expected");
        assertThrows(IOException.class, () -> download.save(root, request, new MinecraftInstaller.Progress() {}));
        assertEquals("old file", Files.readString(destination));
        assertEquals("required.jar", download.save(root, request, new MinecraftInstaller.Progress() {}).get("filename").getAsString());
        assertEquals("1", Files.readString(destination));
    }

    @Test
    void stagesBothTheModAndItsRequiredDependencyBeforeChangingTheInstance(@TempDir Path root) throws Exception {
        Path instance = Files.createDirectories(root.resolve("instances/test"));
        Files.writeString(instance.resolve("kxl.json"), """
            {"id":"test","version":"1.20.1","loader":"fabric","settings":{"isolation":"all"}}
            """);
        var network = new CatalogNetwork((url, timeout, limit, image, key) -> {
            String path = url.getPath();
            if (path.equals("/v2/project/projectA")) return bytes("{\"title\":\"Main\",\"project_type\":\"mod\"}");
            if (path.equals("/v2/project/projectB")) return bytes("{\"title\":\"Required\",\"project_type\":\"mod\"}");
            if (path.equals("/v2/version/releaseA")) return bytes(release("projectA", "releaseA", "a", """
                [{"project_id":"projectB","version_id":"releaseB","dependency_type":"required"}]
                """));
            if (path.equals("/v2/version/releaseB")) return bytes(release("projectB", "releaseB", "b", "[]"));
            throw new IOException("Unexpected fixture request");
        });
        var corrupted = new java.util.concurrent.atomic.AtomicBoolean(true);
        var installer = new ProjectInstaller(new GameDownloads(url -> new ByteArrayInputStream(bytes(
            corrupted.get() && url.getPath().endsWith("/a.jar") ? "corrupt" : "1"))), network, new ResourceCatalog(network));
        var request = json("{\"id\":\"test\",\"source\":\"modrinth\",\"kind\":\"mods\",\"project\":\"projectA\",\"versionId\":\"releaseA\"}");
        assertEquals(1, installer.requirements(root, root, request).getAsJsonArray("dependencies").size());
        assertThrows(IOException.class, () -> installer.install(root, root, request, new MinecraftInstaller.Progress() {}));
        assertFalse(Files.exists(instance.resolve("mods/b.jar")));
        assertFalse(Files.exists(instance.resolve("installed-projects.json")));
        corrupted.set(false);
        assertEquals(2, installer.install(root, root, request, new MinecraftInstaller.Progress() {}).get("files").getAsInt());
        assertEquals(0, installer.install(root, root, request, new MinecraftInstaller.Progress() {}).get("files").getAsInt());
        assertEquals("1", Files.readString(instance.resolve("mods/b.jar")));
    }

    private static String release(String project, String release, String file, String dependencies) {
        return """
            {"id":"%s","project_id":"%s","loaders":["fabric"],"game_versions":["1.20.1"],"dependencies":%s,
             "files":[{"filename":"%s.jar","url":"https://cdn.modrinth.com/%s.jar","hashes":{"sha1":"356a192b7913b04c54574d18c28d46e6395428ab"}}]}
            """.formatted(release, project, dependencies, file, file);
    }

    @Test
    void importsASevenZipWorldWithChinesePaths(@TempDir Path root) throws Exception {
        Path instance = Files.createDirectories(root.resolve("instances/test"));
        Files.writeString(instance.resolve("kxl.json"), "{\"id\":\"test\",\"settings\":{\"isolation\":\"all\"}}");
        Path archive = root.resolve("fixture.7z");
        try (var output = new org.apache.commons.compress.archivers.sevenz.SevenZOutputFile(archive.toFile())) {
            for (String filename : java.util.List.of("赛希镇/region/r.0.0.mca", "赛希镇/level.dat")) {
                var entry = new org.apache.commons.compress.archivers.sevenz.SevenZArchiveEntry();
                entry.setName(filename);
                output.putArchiveEntry(entry);
                output.write(bytes(filename));
                output.closeArchiveEntry();
            }
        }
        var request = json("{\"id\":\"test\",\"source\":\"file\",\"name\":\"赛希镇\"}");
        request.addProperty("path", archive.toString());
        new WorldInstaller(null, null).install(root, root, request, new MinecraftInstaller.Progress() {});
        assertEquals("赛希镇/level.dat", Files.readString(instance.resolve("saves/赛希镇/level.dat")));
        assertTrue(Files.isRegularFile(instance.resolve("saves/赛希镇/region/r.0.0.mca")));
    }

    @Test
    void importsNestedZipWorldsWithoutReplacingAnExistingWorld(@TempDir Path root) throws Exception {
        Path instance = Files.createDirectories(root.resolve("instances/test"));
        Path existing = Files.createDirectories(instance.resolve("saves/地图")).resolve("level.dat");
        Files.writeString(existing, "existing");
        Files.writeString(instance.resolve("kxl.json"), "{\"id\":\"test\",\"settings\":{\"isolation\":\"all\"}}");
        Path archive = root.resolve("fixture.zip");
        var request = json("{\"id\":\"test\",\"source\":\"file\",\"name\":\"地图\"}");
        request.addProperty("path", archive.toString());
        var installer = new WorldInstaller(null, null);
        try (var zip = new java.util.zip.ZipOutputStream(Files.newOutputStream(archive))) {
            zip.putNextEntry(new java.util.zip.ZipEntry("outer/World/level.dat"));
            zip.write(bytes("new world"));
            zip.closeEntry();
        }
        var installed = installer.install(root, root, request, new MinecraftInstaller.Progress() {});
        assertEquals("地图 (2)", installed.getAsJsonArray("worlds").get(0).getAsString());
        assertEquals("existing", Files.readString(existing));
        assertEquals("new world", Files.readString(instance.resolve("saves/地图 (2)/level.dat")));
        try (var zip = new java.util.zip.ZipOutputStream(Files.newOutputStream(archive))) {
            zip.putNextEntry(new java.util.zip.ZipEntry("../outside/level.dat"));
            zip.write(bytes("not a safe entry"));
            zip.closeEntry();
        }
        assertThrows(IOException.class, () -> installer.install(root, root, request, new MinecraftInstaller.Progress() {}));
        assertFalse(Files.exists(root.resolve("outside")));
        assertFalse(Files.exists(instance.resolve("saves/地图 (3)")));
    }

    @Test
    void keepsTheOfficialOptiFineForgeCompatibilityAndExcludesOtherGameVersions() {
        var list = OptiFineInstall.parse("""
            <tr><td class='colMirror'><a href="adloadx?f=OptiFine_1.20.1_HD_U_I6.jar">Mirror</a></td>
            <td class='colForge'>Forge 47.2.18</td></tr>
            <tr><td class='colMirror'><a href="adloadx?f=preview_OptiFine_1.20.1_HD_U_I7_pre1.jar">Mirror</a></td>
            <td class='colForge'>Forge N/A</td></tr>
            <tr><td class='colMirror'><a href="adloadx?f=OptiFine_1.20_HD_U_I1.jar">Mirror</a></td></tr>
            """, "1.20.1");
        assertEquals(2, list.size());
        assertEquals("47.2.18", list.get(0).getAsJsonObject().get("forge").getAsString());
        assertEquals("HD_U_I7_pre1", list.get(1).getAsJsonObject().get("value").getAsString());
    }

    private static JsonObject json(String text) { return JsonFiles.JSON.fromJson(text, JsonObject.class); }
    private static byte[] bytes(String text) { return text.getBytes(StandardCharsets.UTF_8); }
}
