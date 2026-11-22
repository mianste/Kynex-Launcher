package com.keke.kynex.core;

import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/** Stores WebView preferences independently of the loopback port chosen at startup. */
final class DesktopStorage {
    private static final int LIMIT = 16 * 1024 * 1024;
    private final Path file;
    private JsonObject values = new JsonObject();

    DesktopStorage(Path dataRoot, Path oldProfile) throws IOException {
        file = GameFiles.target(dataRoot, "web-preferences.json");
        if (!Files.exists(file)) {
            if (oldProfile != null) {
                values = LegacyWebPreferences.read(oldProfile, dataRoot);
                if (!values.isEmpty()) JsonFiles.write(file, values);
            }
            return;
        }
        try {
            if (Files.size(file) > LIMIT || !(JsonFiles.read(file) instanceof JsonObject stored)) {
                throw new IOException("启动器界面设置文件格式无效");
            }
            values = stored;
        } catch (JsonParseException invalid) {
            throw new IOException("启动器界面设置文件无法读取", invalid);
        }
    }

    String read() { return values.toString(); }

    void change(String action, String key, String value) throws IOException {
        JsonObject updated = values.deepCopy();
        switch (action) {
            case "set" -> updated.addProperty(key, value);
            case "remove" -> updated.remove(key);
            case "clear" -> updated = new JsonObject();
            default -> throw new IOException("设置操作无效");
        }
        if (values.equals(updated)) return;
        byte[] encoded = updated.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
        if (encoded.length > LIMIT) throw new IOException("启动器界面设置超过 16 MB");
        JsonFiles.atomicWrite(file, encoded);
        values = updated;
    }
}
