package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.channels.Channels;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

public final class InstanceContext {
    private static final int LIMIT = 256 * 1024;
    private static final byte[] CUT = "\n[log truncated: head and tail]\n".getBytes(StandardCharsets.UTF_8);
    private InstanceContext() {}

    public static JsonObject read(Path root) {
        var attachments = new JsonArray();
        collect(attachments, root, root.resolve("logs/latest.log"), "latest");
        try (var files = Files.list(root.resolve("crash-reports"))) {
            var recent = files.filter(path -> hasExtension(path, "txt") && Files.isRegularFile(path))
                .max(Comparator.comparing(InstanceContext::modified).thenComparing(Path::toString));
            recent.ifPresent(path -> collect(attachments, root, path, "crash"));
        } catch (IOException | UncheckedIOException ignored) {
            // The instance may never have crashed.
        }
        List<String> names;
        try (var files = Files.list(root.resolve("mods"))) {
            names = files.filter(path -> hasExtension(path, "jar") && Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS))
                .map(path -> path.getFileName().toString()).sorted().toList();
        } catch (IOException | UncheckedIOException ignored) {
            names = List.of();
        }
        JsonArray list = new JsonArray();
        names.forEach(list::add);
        JsonObject mods = new JsonObject();
        mods.addProperty("count", names.size());
        mods.add("files", list);
        JsonObject result = new JsonObject();
        result.add("attachments", attachments);
        result.add("mods", mods);
        return result;
    }

    private static FileTime modified(Path path) {
        try {
            return Files.getLastModifiedTime(path);
        } catch (IOException ignored) {
            return FileTime.fromMillis(Long.MIN_VALUE);
        }
    }

    private static boolean hasExtension(Path path, String extension) {
        return path.getFileName().toString().toLowerCase(Locale.ROOT).endsWith("." + extension);
    }

    private static void collect(JsonArray attachments, Path root, Path path, String kind) {
        try {
            Path canonical = path.toRealPath();
            if (!canonical.startsWith(root.toRealPath()) || !Files.isRegularFile(canonical)) return;
            try (var channel = Files.newByteChannel(canonical)) {
                long length = channel.size();
                boolean truncated = length > LIMIT;
                byte[] bytes;
                var input = Channels.newInputStream(channel);
                if (truncated) {
                    int half = (LIMIT - CUT.length) / 2;
                    var result = new ByteArrayOutputStream(LIMIT);
                    result.write(input.readNBytes(half));
                    result.write(CUT);
                    channel.position(Math.max(0, channel.size() - half));
                    result.write(input.readNBytes(half));
                    bytes = result.toByteArray();
                } else {
                    bytes = input.readNBytes(LIMIT);
                }
                String body = new String(bytes, StandardCharsets.UTF_8);
                byte[] utf8 = body.getBytes(StandardCharsets.UTF_8);
                if (utf8.length > LIMIT) {
                    int boundary = LIMIT;
                    while ((utf8[boundary] & 0xc0) == 0x80) boundary--;
                    body = new String(utf8, 0, boundary, StandardCharsets.UTF_8);
                }
                var attachment = new JsonObject();
                attachment.addProperty("kind", kind);
                attachment.addProperty("name", path.getFileName().toString());
                attachment.addProperty("path", canonical.toString());
                attachment.addProperty("text", body);
                attachment.addProperty("truncated", truncated);
                attachments.add(attachment);
            }
        } catch (IOException ignored) {
            // Files can disappear while the game or launcher is running.
        }
    }
}
