package com.keke.kynex.core;

import com.google.gson.JsonObject;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.List;
import java.util.Set;
import org.iq80.leveldb.Options;
import org.iq80.leveldb.impl.Iq80DBFactory;

final class LegacyWebPreferences {
    private static final Set<String> ORIGINS = Set.of("https://tauri.localhost", "http://tauri.localhost", "tauri://localhost");
    private static final String DATA = "Default/Local Storage/leveldb";
    private static final long DATABASE_LIMIT = 96L * 1024 * 1024;
    private static final long VALUE_LIMIT = 16L * 1024 * 1024;
    private LegacyWebPreferences() {}

    static JsonObject read(Path desktopProfile, Path workspace) throws IOException {
        for (String profile : List.of("EBWebView-v2/" + DATA, "EBWebView-v2/EBWebView/" + DATA, "EBWebView/" + DATA, DATA)) {
            Path folder = desktopProfile.resolve(profile);
            if (!Files.isRegularFile(folder.resolve("CURRENT"), LinkOption.NOFOLLOW_LINKS)) continue;
            JsonObject result = snapshot(folder, workspace);
            if (!result.isEmpty()) return result;
        }
        return new JsonObject();
    }

    private static JsonObject snapshot(Path original, Path workspace) throws IOException {
        Path copy = Files.createTempDirectory(workspace, ".kxl-preferences-");
        try {
            long size = 0;
            try (var files = Files.list(original)) {
                for (Path file : files.toList()) {
                    String name = file.getFileName().toString();
                    if (!name.matches("CURRENT|MANIFEST-[0-9]+|[0-9]+\\.(?:log|ldb|sst)")) continue;
                    var before = Files.readAttributes(file, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
                    if (!before.isRegularFile() || (size += before.size()) > DATABASE_LIMIT) throw new IOException("旧版界面设置数据库过大或路径无效");
                    Files.copy(file, copy.resolve(name));
                    var after = Files.readAttributes(file, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
                    if (Files.size(copy.resolve(name)) != before.size() || before.size() != after.size()
                        || !before.lastModifiedTime().equals(after.lastModifiedTime())) throw new IOException("旧版界面设置仍在写入，请关闭旧版启动器");
                }
            }
            return entries(copy);
        } finally { GameFiles.removeStaging(copy); }
    }

    private static JsonObject entries(Path database) throws IOException {
        System.setProperty("leveldb.mmap", "false");
        System.setProperty("leveldb.snappy", "iq80");
        var result = new JsonObject();
        try (var db = Iq80DBFactory.factory.open(database.toFile(), new Options().createIfMissing(false).paranoidChecks(true));
             var cursor = db.iterator()) {
            cursor.seek(new byte[]{'_'});
            long size = 0;
            while (cursor.hasNext()) {
                var entry = cursor.next();
                byte[] key = entry.getKey();
                if (key.length == 0 || key[0] != '_') break;
                int end = 1;
                while (end < key.length && key[end] != 0) end++;
                if (end + 1 >= key.length || !ORIGINS.contains(new String(key, 1, end - 1, StandardCharsets.US_ASCII))) continue;
                String name = decode(key, end + 1);
                if (name == null || !name.matches("kynex[-:][^\\p{Cntrl}]{1,240}")) continue;
                byte[] value = entry.getValue();
                if ((size += value.length) > VALUE_LIMIT) throw new IOException("旧版界面设置超过 16 MB");
                String setting = decode(value, 0);
                if (setting != null) result.addProperty(name, setting);
            }
            return result;
        } catch (IllegalArgumentException | IllegalStateException unreadable) {
            throw new IOException("无法读取旧版界面设置数据库", unreadable);
        }
    }

    private static String decode(byte[] data, int offset) {
        if (offset >= data.length) return null;
        int start = offset + 1;
        int length = data.length - start;
        if (data[offset] == 1) return new String(data, start, length, StandardCharsets.ISO_8859_1);
        if (data[offset] == 0 && length % 2 == 0) return new String(data, start, length, StandardCharsets.UTF_16LE);
        return null;
    }
}
