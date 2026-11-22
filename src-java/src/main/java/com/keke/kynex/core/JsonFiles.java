package com.keke.kynex.core;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.Strictness;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

public final class JsonFiles {
    public static final Gson JSON = new GsonBuilder().setStrictness(Strictness.STRICT)
        .disableHtmlEscaping().setPrettyPrinting().create();

    private JsonFiles() {}

    public static JsonElement read(Path path) throws IOException {
        try (var reader = Files.newBufferedReader(path)) {
            JsonElement value = JSON.fromJson(reader, JsonElement.class);
            return value == null ? JsonNull.INSTANCE : value;
        }
    }

    public static void write(Path path, JsonElement value) throws IOException {
        atomicWrite(path, JSON.toJson(value).getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }

    public static void atomicWrite(Path path, byte[] bytes) throws IOException {
        Path parent = Files.createDirectories(path.getParent());
        Path temp = Files.createTempFile(parent, ".kxl-", ".tmp");
        try {
            Files.write(temp, bytes);
            Files.move(temp, path, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } finally {
            Files.deleteIfExists(temp);
        }
    }

    public static String text(JsonObject obj, String name, String fallback) {
        JsonElement value = obj.get(name);
        return value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isString()
            ? value.getAsString() : fallback;
    }

    public static String required(JsonObject obj, String name) {
        String value = text(obj, name, null);
        if (value == null) throw new IllegalArgumentException("参数缺失：" + name);
        return value;
    }
}
