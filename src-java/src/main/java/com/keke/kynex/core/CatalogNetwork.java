package com.keke.kynex.core;

import com.google.gson.JsonElement;
import com.google.gson.JsonParseException;
import java.io.IOException;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLException;

final class CatalogNetwork {
    static final int SEARCH_TIMEOUT = 4500;
    static final int SEARCH_RETRY_TIMEOUT = 7500;
    private static final int REQUEST_TIMEOUT = 8000;
    private static final Set<String> API_HOSTS = Set.of(
        "api.modrinth.com", "api.curseforge.com", "mod.mcimirror.top", "goto.pixelmap.cc");
    private static final Set<String> IMAGE_HOSTS = Set.of(
        "cdn.modrinth.com", "media.forgecdn.net", "mediafilez.forgecdn.net", "edge.forgecdn.net",
        "oss.pixelmap.cc", "images.weserv.nl", "wsrv.nl", "mod.mcimirror.top");
    private final Transfer transfer;

    @FunctionalInterface
    interface Transfer {
        byte[] fetch(URI uri, int timeout, int limit, boolean image, String key) throws IOException;
    }

    CatalogNetwork() { this(CatalogNetwork::receivePublic); }
    CatalogNetwork(Transfer transfer) { this.transfer = transfer; }

    JsonElement json(String url, String key) throws IOException {
        return json(url, key, REQUEST_TIMEOUT);
    }

    JsonElement searchJson(String url, String key, boolean retry) throws IOException {
        return json(url, key, retry ? SEARCH_RETRY_TIMEOUT : SEARCH_TIMEOUT);
    }

    private JsonElement json(String url, String key, int timeout) throws IOException {
        try {
            URI address = uri(url, API_HOSTS);
            byte[] content;
            try {
                content = transfer.fetch(address, timeout, (int) GameDownloads.DOCUMENT_LIMIT, false, key);
            } catch (SocketException | SocketTimeoutException temporary) {
                if (timeout != REQUEST_TIMEOUT) throw temporary;
                content = transfer.fetch(address, timeout, (int) GameDownloads.DOCUMENT_LIMIT, false, key);
            }
            JsonElement parsed = JsonFiles.JSON.fromJson(new String(content, StandardCharsets.UTF_8), JsonElement.class);
            if (parsed == null || parsed.isJsonNull()) throw new IOException("资源平台返回空数据");
            return parsed;
        } catch (JsonParseException invalid) {
            throw new IOException("资源平台返回无效的数据", invalid);
        }
    }

    JsonElement post(String url, String key, JsonElement body) throws IOException {
        URI address = uri(url, API_HOSTS);
        var request = (HttpsURLConnection) address.toURL().openConnection();
        request.setInstanceFollowRedirects(false);
        request.setConnectTimeout(7500);
        request.setReadTimeout(7500);
        request.setRequestProperty("User-Agent", "Kynex Launcher/1.7.0");
        request.setRequestProperty("Accept", "application/json");
        request.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
        if ("api.curseforge.com".equals(address.getHost()) && !key.isBlank()) request.setRequestProperty("x-api-key", key);
        request.setRequestMethod("POST");
        request.setDoOutput(true);
        byte[] content = body.toString().getBytes(StandardCharsets.UTF_8);
        request.setFixedLengthStreamingMode(content.length);
        try {
            try (var output = request.getOutputStream()) { output.write(content); }
            int status = request.getResponseCode();
            if (status != 200) throw new GameDownloads.HttpError(status);
            try (var input = request.getInputStream()) {
                byte[] bytes = input.readNBytes((int) GameDownloads.DOCUMENT_LIMIT + 1);
                if (bytes.length > GameDownloads.DOCUMENT_LIMIT) throw new IOException("资源平台响应过大");
                JsonElement item = JsonFiles.JSON.fromJson(new String(bytes, StandardCharsets.UTF_8), JsonElement.class);
                if (item == null || item.isJsonNull()) throw new IOException("资源平台返回空数据");
                return item;
            }
        } catch (JsonParseException invalid) { throw new IOException("资源平台返回无效的数据", invalid); }
        finally { request.disconnect(); }
    }

    byte[] image(String url, boolean quick) throws IOException {
        return transfer.fetch(imageAddress(url), quick ? 2400 : 8000, 2 * 1024 * 1024, true, "");
    }

    static URI imageAddress(String url) throws IOException { return uri(url, IMAGE_HOSTS); }

    static String url(String base, Map<String, String> params) {
        return base + "?" + params.entrySet().stream().map(row -> encode(row.getKey()) + "=" + encode(row.getValue()))
            .collect(java.util.stream.Collectors.joining("&"));
    }

    private static String encode(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8); }

    private static URI uri(String url, Set<String> hosts) throws IOException {
        try {
            URI uri = URI.create(url);
            String host = uri.getHost();
            if ("https".equals(uri.getScheme()) && host != null && hosts.contains(host.toLowerCase(Locale.ROOT))
                && uri.getPort() == -1 && uri.getRawUserInfo() == null && uri.getRawFragment() == null) return uri;
        } catch (IllegalArgumentException invalid) {
            throw new IOException("资源来源链接无效", invalid);
        }
        throw new IOException("资源来源不受支持");
    }

    private static byte[] receive(URI uri, int timeout, int limit, boolean image, String key) throws IOException {
        for (int redirects = 0; redirects <= 4; redirects++) {
            var request = (HttpsURLConnection) uri.toURL().openConnection();
            request.setInstanceFollowRedirects(false);
            request.setConnectTimeout(timeout);
            request.setReadTimeout(timeout);
            request.setRequestProperty("User-Agent", "Kynex Launcher/1.7.0");
            request.setRequestProperty("Accept", image ? "image/png,image/webp,image/jpeg,image/*;q=0.8" : "application/json");
            if ("api.curseforge.com".equals(uri.getHost()) && !key.isBlank()) request.setRequestProperty("x-api-key", key);
            try {
                int status = request.getResponseCode();
                if (status >= 300 && status < 400) {
                    String location = request.getHeaderField("Location");
                    if (location == null) throw new IOException("资源来源重定向无效");
                    URI next = uri(uri.resolve(location).toString(), image ? IMAGE_HOSTS : API_HOSTS);
                    if (!image && !next.getHost().equals(uri.getHost())) throw new IOException("资源接口重定向来源无效");
                    uri = next;
                    continue;
                }
                if (status != 200) throw new GameDownloads.HttpError(status);
                if (request.getContentLengthLong() > limit) throw new IOException("资源请求超过大小限制");
                try (var input = request.getInputStream()) {
                    byte[] bytes = input.readNBytes(limit + 1);
                    if (bytes.length > limit) throw new IOException("资源请求超过大小限制");
                    return bytes;
                }
            } finally {
                request.disconnect();
            }
        }
        throw new IOException("资源来源重定向过多");
    }

    private static byte[] receivePublic(URI uri, int timeout, int limit, boolean image, String key) throws IOException {
        try {
            return receive(uri, timeout, limit, image, key);
        } catch (SocketException | SocketTimeoutException | SSLException direct) {
            if (!key.isEmpty() || timeout < REQUEST_TIMEOUT && (image || direct instanceof SocketTimeoutException)) throw direct;
            try { return WindowsHttps.read(uri, timeout, limit); }
            catch (IOException platform) {
                direct.addSuppressed(platform);
                throw direct;
            }
        }
    }
}
