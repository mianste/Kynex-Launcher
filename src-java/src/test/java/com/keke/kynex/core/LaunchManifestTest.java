package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import static org.junit.jupiter.api.Assertions.*;

final class LaunchManifestTest {
    private static final LaunchManifest.Platform WINDOWS = new LaunchManifest.Platform("windows", "x86_64", "64", Set.of("10\\."));

    private static JsonObject json(String source) {
        return JsonParser.parseString(source).getAsJsonObject();
    }

    @Test
    void preservesMojangPlatformVariantsAcrossLoaderInstallAndRepair() throws Exception {
        Path fixture = Path.of("src-java/src/test/fixtures/platform-versions.json");
        if (!Files.exists(fixture)) fixture = Path.of("..").resolve(fixture);
        for (var element : JsonFiles.read(fixture).getAsJsonArray()) {
            var base = element.getAsJsonObject();
            var overlay = json("""
                {"libraries":[{"name":"loader:local:1"}],
                 "arguments":{"game":["--localLoader"]},"mainClass":"test.Loader"}
                """);
            var merged = LaunchManifest.merge(base, overlay).getAsJsonObject();
            assertEquals("test.Loader", merged.get("mainClass").getAsString());
            assertTrue(merged.getAsJsonObject("arguments").getAsJsonArray("game")
                .contains(JsonParser.parseString("\"--localLoader\"")));
            var damaged = json("{\"libraries\":[{\"name\":\"loader:local:1\"}]}");
            assertTrue(LaunchManifest.restore(damaged, base, WINDOWS).get("changed").getAsBoolean());
            assertFalse(LaunchManifest.restore(damaged, base, WINDOWS).get("changed").getAsBoolean());
            for (var library : base.getAsJsonArray("libraries")) {
                if (!WINDOWS.allows(library.getAsJsonObject())) continue;
                assertTrue(merged.getAsJsonArray("libraries").contains(library), base.get("id").getAsString());
                assertTrue(damaged.getAsJsonArray("libraries").contains(library), base.get("id").getAsString());
            }
        }
    }

    @Test
    void plansLegacyCoordinatesWindowsClassifiersAndOsRules() {
        var version = json("""
            {"libraries":[
              {"name":"group.one:artifact:1"},
              {"name":"group.two:native:2","natives":{"windows":"native-\u0024{arch}"},
               "downloads":{"classifiers":{"native-64":{"url":"https://example.test/native.jar","path":"native.jar","sha1":"sha"}}},
               "rules":[{"action":"allow","os":{"name":"windows","arch":"x86_64","version":"10\\\\."},"features":{"is_demo_user":false}}]},
              {"name":"group.three:linux:1","rules":[{"action":"allow","os":{"name":"linux"}}]},
              {"name":"group.four:demo:1","rules":[{"action":"allow","features":{"is_demo_user":true}}]}
            ]}
            """);
        var dependencies = LaunchManifest.dependencies(version, WINDOWS);
        assertEquals(2, dependencies.size());
        assertEquals("group/one/artifact/1/artifact-1.jar", dependencies.get(0).getAsJsonObject().get("path").getAsString());
        assertEquals("sha", dependencies.get(1).getAsJsonObject().get("hash").getAsString());
        assertEquals("native.jar", LaunchManifest.launchLibraries(version, WINDOWS)
            .get(1).getAsJsonObject().get("classifier").getAsString());
    }

    @Test
    void buildsLaunchArgumentsWithoutBreakingQuotedWindowsPaths() {
        var request = json("""
            {"version":{"mainClass":"sample.Main","arguments":{"jvm":["-DignoreList=example.jar",
                {"rules":[{"action":"allow","os":{"name":"windows"}}],"value":["-Duser=\u0024{auth_player_name}"]}]}},
             "settings":{"memory":1,"width":9000,"height":500},"loader":"forge"}
            """);
        request.getAsJsonObject("version").addProperty("minecraftArguments",
            "--gameDir $" + "{game_directory} --empty '' --quoted \"two words\"");
        var variables = new JsonObject();
        variables.addProperty("classpath", "C:\\游戏\\client.jar");
        variables.addProperty("auth_player_name", "Player Name");
        variables.addProperty("game_directory", "C:\\游戏 版本");
        variables.addProperty("natives_directory", "C:\\游戏\\natives");
        request.add("variables", variables);
        assertEquals(List.of("-Xmx512M", "-DignoreList=example.jar,client.jar", "-Duser=Player Name",
            "-Djava.library.path=C:\\游戏\\natives", "-cp", "C:\\游戏\\client.jar", "sample.Main",
            "--gameDir", "C:\\游戏 版本", "--empty", "", "--quoted", "two words",
            "--width", "7680", "--height", "500"),
            LaunchManifest.arguments(request, WINDOWS).asList().stream().map(item -> item.getAsString()).toList());
        assertEquals(List.of("a b", "C:\\folder", "#inside", "a#b", "tail\\"),
            LaunchManifest.legacyWords("a\\ b \"C:\\\\folder\" '#inside' a#b # note\n tail\\"));
        assertThrows(IllegalArgumentException.class, () -> LaunchManifest.legacyWords("\"unclosed"));
    }

    @Test
    void validatesAssetIndexesAndReusesMatchingFiles(@TempDir Path root) throws Exception {
        Path instance = Files.createDirectory(root.resolve("instance"));
        Files.writeString(instance.resolve("client.jar"), "fixture");
        Path index = Files.createDirectories(root.resolve("assets/indexes")).resolve("legacy.json");
        String hash = "a".repeat(40);
        String indexSource = "{\"objects\":{\"one\":{\"hash\":\"" + hash + "\"},\"two\":{\"hash\":\"" + hash + "\"}}";
        Files.writeString(index, indexSource + "}");
        assertEquals(1, GameAssets.plan(index).getAsJsonArray("hashes").size());
        var version = json("{\"libraries\":[],\"assetIndex\":{\"id\":\"legacy\"}}");
        assertFalse(GameAssets.ready(root, instance, version, WINDOWS));
        Files.writeString(Files.createDirectories(root.resolve("assets/objects/aa")).resolve(hash), "asset");
        assertTrue(GameAssets.ready(root, instance, version, WINDOWS));
        Files.writeString(index, indexSource + ",\"virtual\":true,\"map_to_resources\":true}");
        assertEquals("resources", GameAssets.plan(index).get("legacyTarget").getAsString());
        assertFalse(GameAssets.ready(root, instance, version, WINDOWS));
        Files.writeString(index, indexSource.replace(hash, "../evil") + "}");
        assertThrows(IllegalArgumentException.class, () -> GameAssets.plan(index));
    }

    @Test
    void extractsOnlyNativeLibrariesWithoutEscapingOutput(@TempDir Path root) throws Exception {
        Path archive = root.resolve("natives.jar");
        try (var zip = new ZipOutputStream(Files.newOutputStream(archive))) {
            for (String name : List.of("win/tool.dll", "../bad.dll", "notes.txt")) {
                zip.putNextEntry(new ZipEntry(name));
                zip.write(new byte[] {1, 2, 3});
                zip.closeEntry();
            }
        }
        var archives = new JsonArray();
        archives.add(archive.toString());
        Path destination = Files.createDirectory(root.resolve("natives"));
        NativeLibraries.unpack(destination, archives);
        assertArrayEquals(new byte[] {1, 2, 3}, Files.readAllBytes(destination.resolve("tool.dll")));
        try (var contents = Files.list(destination)) {
            assertEquals(List.of("tool.dll"), contents.map(path -> path.getFileName().toString()).toList());
        }
        assertFalse(Files.exists(root.resolve("bad.dll")));
    }
}
