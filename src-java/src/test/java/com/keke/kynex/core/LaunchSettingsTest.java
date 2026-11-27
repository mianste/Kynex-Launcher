package com.keke.kynex.core;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

final class LaunchSettingsTest {
    private static JsonObject json(String text) { return JsonParser.parseString(text).getAsJsonObject(); }

    @Test void expandsArgumentMarkersWithoutApplyingRemovedMemorySetting() {
        var request = json("""
            {"version":{"mainClass":"sample.Main","arguments":{"game":["--versionType","${version_type}"]}},
             "settings":{"memory":2048,"initialMemory":4096,"fullscreen":true,"customInfo":"KXL {version}",
              "jvmArgs":"-Dname={user} -Ddir={verindie}","gameArgs":"--fullscreen"},
             "variables":{"version_name":"1.21.1","auth_player_name":"Player {version}",
              "isolated_directory":"C:\\\\游戏 目录\\\\","classpath":"client.jar","natives_directory":"natives"}}
            """);
        List<String> args = LaunchManifest.arguments(request,
            new LaunchManifest.Platform("windows", "x86_64", "64", Set.of())).asList().stream().map(x -> x.getAsString()).toList();
        assertTrue(args.stream().noneMatch(arg -> arg.startsWith("-Xms")));
        assertFalse(args.contains("KXL 1.21.1"));
        assertEquals("KXL 1.21.1", LaunchManifest.windowTitle(request.getAsJsonObject("settings"), request.getAsJsonObject("variables")));
        assertTrue(args.contains("-Dname=Player {version}"));
        assertTrue(args.contains("-Ddir=C:\\游戏 目录\\"));
        assertEquals(1, args.stream().filter("--fullscreen"::equals).count());
        assertTrue(args.indexOf("-Dname=Player {version}") < args.indexOf("sample.Main"));
    }

}
