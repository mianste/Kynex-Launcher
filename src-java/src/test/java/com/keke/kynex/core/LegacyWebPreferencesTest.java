package com.keke.kynex.core;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.stream.Collectors;
import org.iq80.leveldb.CompressionType;
import org.iq80.leveldb.Options;
import org.iq80.leveldb.impl.Iq80DBFactory;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

class LegacyWebPreferencesTest {
    @TempDir Path temp;

    @Test void transfersOnlyLauncherPreferencesAndKeepsTheSourceDatabase() throws Exception {
        System.setProperty("leveldb.mmap", "false");
        Path profile = temp.resolve("old");
        Path source = Files.createDirectories(profile.resolve("EBWebView-v2/Default/Local Storage/leveldb"));
        try (var db = Iq80DBFactory.factory.open(source.toFile(), new Options().compressionType(CompressionType.SNAPPY).writeBufferSize(4096))) {
            byte[] skin = "旧皮肤库".getBytes(StandardCharsets.UTF_16LE);
            var encoded = new byte[skin.length + 1];
            System.arraycopy(skin, 0, encoded, 1, skin.length);
            db.put(key("http://tauri.localhost", "kynex-skins"), encoded);
            db.put(key("http://tauri.localhost", "kynex-play-mode"), "\1repeat".getBytes(StandardCharsets.ISO_8859_1));
            db.put(key("https://other.example", "kynex-outside"), encoded);
            db.put(key("http://tauri.localhost", "other-setting"), encoded);
            byte[] padding = new byte[8192];
            for (int i = 0; i < 5; i++) db.put(key("https://other.example", "padding-" + i), padding);
        }
        Map<Path, String> before = hashes(source);
        Path destination = Files.createDirectory(temp.resolve("game"));
        var result = new DesktopStorage(destination, profile);
        var entries = JsonFiles.JSON.fromJson(result.read(), com.google.gson.JsonObject.class);
        assertEquals("旧皮肤库", entries.get("kynex-skins").getAsString());
        assertEquals("repeat", entries.get("kynex-play-mode").getAsString());
        assertFalse(entries.has("kynex-outside"));
        assertFalse(entries.has("other-setting"));
        assertEquals(before, hashes(source));
        result.change("set", "kynex-play-mode", "random");
        assertEquals("random", JsonFiles.JSON.fromJson(new DesktopStorage(destination, profile).read(),
            com.google.gson.JsonObject.class).get("kynex-play-mode").getAsString());
    }

    private static byte[] key(String origin, String value) {
        return ("_" + origin + "\0\1" + value).getBytes(StandardCharsets.ISO_8859_1);
    }

    private static Map<Path, String> hashes(Path directory) throws Exception {
        try (var files = Files.list(directory)) {
            return files.collect(Collectors.toMap(path -> path.getFileName(), path -> {
                try { return java.util.HexFormat.of().formatHex(ResourceHashes.digest("SHA-256").digest(Files.readAllBytes(path))); }
                catch (java.io.IOException error) { throw new java.io.UncheckedIOException(error); }
            }));
        }
    }
}
