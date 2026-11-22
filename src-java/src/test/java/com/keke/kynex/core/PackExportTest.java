package com.keke.kynex.core;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.zip.ZipFile;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertThrows;

class PackExportTest {
    @TempDir Path temp;

    @Test void identifiesAnEmbeddedModpackAndIgnoresLauncherFiles() throws Exception {
        Path pack = temp.resolve("modpack.mrpack");
        try (var zip = new ZipOutputStream(Files.newOutputStream(pack))) {
            entry(zip, "modrinth.index.json", """
                {"name":"幸运方块赛道","dependencies":{"minecraft":"1.20.1","fabric-loader":"0.16.14"},"files":[]}
                """.getBytes(StandardCharsets.UTF_8));
        }
        Path wrapper = temp.resolve("wrapper.zip");
        try (var zip = new ZipOutputStream(Files.newOutputStream(wrapper))) {
            entry(zip, "PCL/config.ini", new byte[]{1});
            entry(zip, "Plain Craft Launcher.exe", new byte[]{2});
            entry(zip, "docs/sample.zip", new byte[]{3});
            entry(zip, "release/整合包.mrpack", Files.readAllBytes(pack));
        }
        var info = new PackInstaller(null, null, null, null).inspect(wrapper);
        assertEquals(wrapper.toString(), info.get("path").getAsString());
        assertEquals("幸运方块赛道", info.get("name").getAsString());
        assertEquals("fabric", info.get("loader").getAsString());
        assertEquals("1.20.1", info.get("version").getAsString());

        try (var zip = new ZipOutputStream(Files.newOutputStream(wrapper))) {
            byte[] bytes = Files.readAllBytes(pack);
            entry(zip, "one.mrpack", bytes);
            entry(zip, "two.mrpack", bytes);
        }
        assertTrue(assertThrows(IOException.class, () -> new PackInstaller(null, null, null, null).inspect(wrapper))
            .getMessage().contains("多个整合包"));
    }

    private static void entry(ZipOutputStream zip, String name, byte[] bytes) throws IOException {
        zip.putNextEntry(new ZipEntry(name));
        zip.write(bytes);
        zip.closeEntry();
    }

    @Test void exportsOnlySelectedGameFilesAndSharedLicenseWithAnImportableManifest() throws Exception {
        Path game = Files.createDirectory(temp.toRealPath().resolve("game"));
        Path instance = Files.createDirectories(game.resolve("instances/pack"));
        write(instance, "kxl.json", """
            {"id":"pack","name":"Fixture","version":"1.20.1","loader":"fabric","loaderVersion":"0.16.14",
             "accessToken":"fake-test-value","settings":{"isolation":"all"}}
            """);
        for (String included : Set.of("mods/keep.jar", "mods/other.jar", "mods/disabled.jar.disabled", "LICENSE", "config/credentials.json",
            "config/ordinary.json", "config/jei/world/bookmarks.ini", "saves/private/level.dat")) write(instance, included, "fixture");
        Path result = temp.resolve("sample.mrpack");
        var payload = JsonFiles.JSON.fromJson("""
            {"id":"pack","format":"mrpack","include":["mods","config"],"bundleResources":true,
             "selectionVersion":1,"choices":{"mods":["mods/keep.jar"]}}
            """, com.google.gson.JsonObject.class);
        payload.addProperty("path", result.toString());
        var exported = new PackExport(new CatalogNetwork()).export(game, game, payload, new MinecraftInstaller.Progress() {});
        assertEquals(3, exported.get("files").getAsInt());
        try (var zip = new ZipFile(result.toFile())) {
            assertEquals(Set.of("modrinth.index.json", "overrides/LICENSE", "overrides/mods/keep.jar", "overrides/config/ordinary.json"),
                zip.stream().map(java.util.zip.ZipEntry::getName).collect(Collectors.toSet()));
            try (var manifest = zip.getInputStream(zip.getEntry("modrinth.index.json"))) {
                assertTrue(new String(manifest.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8).contains("\"fabric-loader\":\"0.16.14\""));
            }
        }
        var network = new CatalogNetwork();
        var download = new GameDownloads();
        var inspected = new PackInstaller(download, network, new ResourceCatalog(network), new MinecraftInstaller(download)).inspect(result);
        assertEquals("modrinth", inspected.get("format").getAsString());
    }

    private static void write(Path folder, String name, String content) throws Exception {
        Path file = folder.resolve(name);
        Files.createDirectories(file.getParent());
        Files.writeString(file, content);
    }
}
