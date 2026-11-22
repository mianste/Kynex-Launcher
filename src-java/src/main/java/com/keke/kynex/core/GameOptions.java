package com.keke.kynex.core;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Locale;
import java.util.Objects;

public final class GameOptions {
    private GameOptions() {}

    public static String applyLanguage(Path directory, String version, String preference) throws IOException {
        if ("none".equals(preference)) return null;
        String language = "en_us".equals(preference) ? "en_us" : "zh_cn";
        String[] parts = version.strip().split("\\.", -1);
        try {
            if (parts.length >= 2 && Integer.parseUnsignedInt(parts[0]) == 1
                && Integer.compareUnsigned(Integer.parseUnsignedInt(parts[1]), 10) <= 0) {
                language = language.substring(0, 3) + language.substring(3).toUpperCase(Locale.ROOT);
            }
        } catch (NumberFormatException ignored) {
            // Snapshots use the modern spelling.
        }
        Path path = directory.resolve("options.txt");
        Path yosbr = directory.resolve("config/yosbr/options.txt");
        if (!Files.exists(path) && Files.exists(yosbr)) path = yosbr;

        String existing;
        try {
            existing = Files.readString(path);
        } catch (IOException ignored) {
            existing = "";
        }
        String updated = withLanguage(existing, language);
        if (!Objects.equals(existing, updated)) {
            JsonFiles.atomicWrite(path, updated.getBytes(StandardCharsets.UTF_8));
        }
        return language;
    }

    static String withLanguage(String existing, String language) {
        String newline = existing.contains("\r\n") ? "\r\n" : "\n";
        var rows = new ArrayList<String>();
        boolean replaced = false;
        String[] lines = existing.split("\n", -1);
        int count = lines.length - (existing.isEmpty() || existing.endsWith("\n") ? 1 : 0);
        for (int index = 0; index < count; index++) {
            String line = lines[index];
            if (line.endsWith("\r") && index < lines.length - 1) line = line.substring(0, line.length() - 1);
            if (!replaced && line.stripLeading().startsWith("lang:")) {
                line = "lang:" + language;
                replaced = true;
            }
            rows.add(line);
        }
        if (!replaced) rows.add("lang:" + language);
        return String.join(newline, rows) + newline;
    }
}
