package com.keke.kynex.core;

import com.google.gson.JsonArray;
import java.io.IOException;
import java.nio.charset.Charset;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.zip.CRC32;
import java.util.zip.ZipFile;

final class NativeLibraries {
    private static final long MAX_LIBRARY = 100 * 1024 * 1024;
    private NativeLibraries() {}

    static void unpack(Path destination, JsonArray archives) throws IOException {
        for (var archive : archives) {
            try (var zip = new ZipFile(Path.of(archive.getAsString()).toFile(), Charset.forName("CP437"))) {
                var entries = zip.entries();
                while (entries.hasMoreElements()) {
                    var entry = entries.nextElement();
                    String filename = safeBasename(entry.getName());
                    if (entry.isDirectory() || filename == null
                        || !(filename.endsWith(".dll") || filename.endsWith(".so") || filename.endsWith(".dylib"))) {
                        continue;
                    }
                    if (entry.getSize() > MAX_LIBRARY) throw new IOException("本地库异常大");
                    Path staging = Files.createTempFile(destination, ".kxl-native-", ".tmp");
                    try (var input = zip.getInputStream(entry); var output = Files.newOutputStream(staging)) {
                        long length = 0;
                        var checksum = new CRC32();
                        byte[] buffer = new byte[64 * 1024];
                        for (int count; (count = input.read(buffer)) > 0;) {
                            length += count;
                            if (length > MAX_LIBRARY) throw new IOException("本地库异常大");
                            checksum.update(buffer, 0, count);
                            output.write(buffer, 0, count);
                        }
                        if (entry.getSize() >= 0 && length != entry.getSize()) throw new IOException("本地库不完整");
                        if (entry.getCrc() >= 0 && checksum.getValue() != entry.getCrc()) throw new IOException("本地库校验失败");
                    } catch (IOException error) {
                        Files.deleteIfExists(staging);
                        throw error;
                    }
                    try {
                        Files.move(staging, destination.resolve(filename),
                            StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
                    } finally {
                        Files.deleteIfExists(staging);
                    }
                }
            }
        }
    }

    private static String safeBasename(String entry) {
        if (entry.isEmpty() || entry.startsWith("/") || entry.startsWith("\\") || entry.indexOf('\0') >= 0
            || entry.indexOf(':') >= 0) return null;
        String[] components = entry.replace('\\', '/').split("/", -1);
        int depth = 0;
        for (String component : components) {
            if (component.equals("..")) {
                if (--depth < 0) return null;
            } else if (!component.isEmpty() && !component.equals(".")) {
                depth++;
            }
        }
        String filename = components[components.length - 1];
        try {
            LaunchManifest.safeName(filename);
            return filename;
        } catch (IllegalArgumentException unsafe) {
            return null;
        }
    }
}
