package com.keke.kynex.core;

import com.google.gson.JsonObject;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Map;

public final class ArtworkCache {
    private static final int MAX_BYTES = 2 * 1024 * 1024;
    private static final byte[] PNG = {(byte) 137, 'P', 'N', 'G', 13, 10, 26, 10};
    private static final byte[] JPEG = {(byte) 255, (byte) 216, (byte) 255};
    private static final byte[] ICON = {0, 0, 1, 0};
    private final Path dir;

    public ArtworkCache(Path root) {
        dir = root.resolve("cache/icons");
    }

    public JsonObject read(String url) throws NoSuchAlgorithmException {
        Path file = path(url);
        try {
            if (Files.size(file) <= MAX_BYTES) {
                byte[] data = Files.readAllBytes(file);
                String mime = mime(data);
                if (data.length <= MAX_BYTES && mime != null) return reply(dataUri(mime, data));
            }
        } catch (IOException ignored) {
            // A corrupt or missing cache must not stop the network lookup.
        }
        return reply("");
    }

    public JsonObject store(String url, String encoded) throws IOException, NoSuchAlgorithmException {
        if (encoded.length() > 4 * ((MAX_BYTES + 2) / 3)) throw new IOException("图标文件过大");
        return store(url, Base64.getDecoder().decode(encoded));
    }

    JsonObject fetch(JsonObject request, CatalogNetwork network) throws IOException, NoSuchAlgorithmException {
        String url = JsonFiles.required(request, "url");
        if (ResourceCatalog.https(url) == null) throw new IOException("图标地址无效");
        JsonObject cached = read(url);
        if (LaunchManifest.is(request.get("cacheOnly"), true) || !cached.get("data").getAsString().isEmpty()) return cached;
        boolean quick = LaunchManifest.is(request.get("quick"), true);
        var address = CatalogNetwork.imageAddress(url);
        try {
            return store(url, network.image(url, quick));
        } catch (IOException direct) {
            if (quick || "oss.pixelmap.cc".equals(address.getHost())) throw direct;
            String proxy = CatalogNetwork.url("https://images.weserv.nl/", Map.of(
                "url", url.substring("https://".length()), "w", "96", "h", "96", "fit", "cover"));
            return store(url, network.image(proxy, false));
        }
    }

    private JsonObject store(String url, byte[] data) throws IOException, NoSuchAlgorithmException {
        if (data.length > MAX_BYTES) throw new IOException("图标文件过大");
        String mime = mime(data);
        if (mime == null) throw new IOException("不支持的图标格式");
        try {
            JsonFiles.atomicWrite(path(url), data);
        } catch (IOException ignored) {
            // The decoded image can still be displayed without persistent cache.
        }
        return reply(dataUri(mime, data));
    }

    private Path path(String url) throws NoSuchAlgorithmException {
        byte[] hash = MessageDigest.getInstance("SHA-256").digest(url.getBytes(StandardCharsets.UTF_8));
        return dir.resolve(HexFormat.of().formatHex(hash) + ".img");
    }

    static String mime(byte[] bytes) {
        if (starts(bytes, PNG)) return "image/png";
        if (starts(bytes, JPEG)) return "image/jpeg";
        if (starts(bytes, "GIF8".getBytes(StandardCharsets.US_ASCII))) return "image/gif";
        if (bytes.length > 12 && starts(bytes, "RIFF".getBytes(StandardCharsets.US_ASCII))
                && new String(bytes, 8, 4, StandardCharsets.US_ASCII).equals("WEBP")) return "image/webp";
        if (starts(bytes, ICON)) return "image/x-icon";
        return null;
    }

    private static boolean starts(byte[] bytes, byte[] prefix) {
        return bytes.length >= prefix.length && Arrays.equals(bytes, 0, prefix.length, prefix, 0, prefix.length);
    }

    private static String dataUri(String mime, byte[] bytes) {
        return "data:" + mime + ";base64," + Base64.getEncoder().encodeToString(bytes);
    }

    private static JsonObject reply(String data) {
        var result = new JsonObject();
        result.addProperty("data", data);
        return result;
    }
}
