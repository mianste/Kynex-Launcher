package com.keke.kynex.core;

import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Set;
import java.util.function.BiConsumer;
import javax.net.ssl.HttpsURLConnection;

final class ReleaseDownload {
    private static final List<String> ACCELERATORS = List.of("https://ghfast.top/", "https://gh-proxy.com/");
    private static final Set<String> GITHUB = Set.of("github.com", "raw.githubusercontent.com");
    private static final Set<String> HOSTS = Set.of("github.com", "raw.githubusercontent.com", "ghfast.top", "gh-proxy.com",
        "release-assets.githubusercontent.com", "objects.githubusercontent.com", "github-releases.githubusercontent.com");
    private ReleaseDownload() {}

    static URI github(String value) throws IOException {
        URI url = allowed(value);
        if (!GITHUB.contains(url.getHost())) throw new IOException("更新源必须使用有效的 GitHub HTTPS 地址");
        return url;
    }

    static List<URI> locations(URI original) {
        if (!GITHUB.contains(original.getHost())) return List.of(original);
        var urls = new java.util.ArrayList<URI>();
        for (String accelerator : ACCELERATORS) urls.add(URI.create(accelerator + original));
        urls.add(original);
        return List.copyOf(urls);
    }

    static JsonObject manifest(URI url) throws IOException {
        return manifest(url, Long.MAX_VALUE);
    }

    static JsonObject manifest(URI url, long deadline) throws IOException {
        try (var contents = new ByteArrayOutputStream()) {
            fetch(url, contents, 512 * 1024, 8000, (read, total) -> {}, deadline);
            JsonObject result = JsonFiles.JSON.fromJson(contents.toString(StandardCharsets.UTF_8), JsonObject.class);
            if (result == null) throw new IOException("更新清单为空");
            return result;
        } catch (JsonParseException invalid) { throw new IOException("更新清单格式无效"); }
    }

    static void fetch(URI source, OutputStream destination, long limit, int timeout, BiConsumer<Long, Long> progress) throws IOException {
        fetch(source, destination, limit, timeout, progress, Long.MAX_VALUE);
    }

    private static void fetch(URI source, OutputStream destination, long limit, int timeout,
                              BiConsumer<Long, Long> progress, long deadline) throws IOException {
        URI url = source;
        for (int redirects = 0; redirects <= 5; redirects++) {
            var request = (HttpsURLConnection) url.toURL().openConnection();
            request.setInstanceFollowRedirects(false);
            request.setConnectTimeout(remainingTimeout(deadline, 4500));
            request.setReadTimeout(remainingTimeout(deadline, timeout));
            request.setRequestProperty("User-Agent", "Kynex Launcher/1.7.0");
            try {
                remainingTimeout(deadline, timeout);
                int code = request.getResponseCode();
                if (code >= 300 && code < 400 && request.getHeaderField("Location") != null) {
                    url = allowed(url.resolve(request.getHeaderField("Location")).toString());
                    continue;
                }
                if (code != 200) throw new GameDownloads.HttpError(code);
                long length = request.getContentLengthLong();
                if (length > limit) throw new IOException("更新文件超过允许体积");
                try (var stream = request.getInputStream()) {
                    byte[] buffer = new byte[64 * 1024];
                    long received = 0, last = 0;
                    for (;;) {
                        request.setReadTimeout(remainingTimeout(deadline, timeout));
                        int count = stream.read(buffer);
                        if (count < 0) break;
                        received += count;
                        if (received > limit) throw new IOException("更新文件超过允许体积");
                        destination.write(buffer, 0, count);
                        if (received - last >= 1024 * 1024) {
                            progress.accept(received, Math.max(0, length));
                            last = received;
                        }
                    }
                    if (length >= 0 && received != length) throw new IOException("更新文件未完整下载");
                    progress.accept(received, Math.max(0, length));
                }
                return;
            } finally { request.disconnect(); }
        }
        throw new IOException("更新下载跳转次数过多");
    }

    private static int remainingTimeout(long deadline, int maximum) throws IOException {
        if (Thread.currentThread().isInterrupted()) throw new java.io.InterruptedIOException("已取消更新请求");
        if (deadline == Long.MAX_VALUE) return maximum;
        long remaining = deadline - System.nanoTime();
        if (remaining <= 0) throw new java.net.SocketTimeoutException("更新检测超时");
        return (int) Math.max(1, Math.min(maximum, java.util.concurrent.TimeUnit.NANOSECONDS.toMillis(remaining)));
    }

    private static URI allowed(String value) throws IOException {
        try {
            URI url = URI.create(value);
            if ("https".equals(url.getScheme()) && HOSTS.contains(url.getHost()) && url.getRawUserInfo() == null
                && url.getRawFragment() == null && (url.getPort() == -1 || url.getPort() == 443)) return url;
        } catch (IllegalArgumentException | NullPointerException invalid) { /* Keep the request error independent of the remote URL. */ }
        throw new IOException("更新下载地址无效");
    }
}
