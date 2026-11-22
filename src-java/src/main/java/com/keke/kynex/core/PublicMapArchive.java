package com.keke.kynex.core;

import java.io.IOException;
import java.net.InetAddress;
import java.net.URI;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.Locale;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorCompletionService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;
import javax.net.ssl.HttpsURLConnection;

final class PublicMapArchive {
    private static final long MAX = 2L * 1024 * 1024 * 1024;
    private static final long MIB = 1024 * 1024;
    private static final Pattern RANGE_PROBE = Pattern.compile("bytes 0-0/([0-9]{1,10})");
    private PublicMapArchive() {}

    static String name(URI address) {
        if (!allowed(address)) return null;
        String path = address.getPath();
        String filename = path.substring(path.lastIndexOf('/') + 1);
        if (!ResourceVersions.extension(filename, "worlds")) return null;
        try { LaunchManifest.safeName(filename); }
        catch (IllegalArgumentException invalid) { return null; }
        return filename;
    }

    static void fetch(String original, Path staging, MinecraftInstaller.Progress progress) throws IOException {
        URI url = URI.create(original);
        if (name(url) == null) throw new IOException("作者未提供公开的地图压缩包直链");
        if ("oss.pixelmap.cc".equals(url.getHost())) {
            try {
                if (fetchHostedRanges(url, staging, progress)) return;
            } catch (IOException failed) {
                GameDownloads.check(progress::stopped);
            }
        }
        for (int redirects = 0; redirects <= 5; redirects++) {
            GameDownloads.check(progress::stopped);
            if (!allowed(url)) throw new IOException("地图文件跳转到不受支持的地址");
            for (InetAddress address : InetAddress.getAllByName(url.getHost())) {
                byte[] raw = address.getAddress();
                boolean privateRange = raw.length == 4 && (raw[0] & 255) == 100 && (raw[1] & 192) == 64
                    || raw.length == 16 && (raw[0] & 254) == 252;
                if (address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress()
                    || address.isSiteLocalAddress() || address.isMulticastAddress() || privateRange) throw new IOException("地图下载必须使用公开地址");
            }
            var https = open(url);
            try {
                int status = https.getResponseCode();
                if (status >= 300 && status < 400 && https.getHeaderField("Location") != null) {
                    url = url.resolve(https.getHeaderField("Location"));
                    continue;
                }
                if (status != 200) throw new IOException("外部地图来源未提供下载文件（HTTP " + status + "）");
                String mime = https.getContentType();
                if (mime != null && (mime.toLowerCase(Locale.ROOT).startsWith("text/") || mime.contains("application/json"))) {
                    throw new IOException("作者链接返回的是下载网页，请在原页保存文件后导入");
                }
                long length = https.getContentLengthLong();
                if (length > MAX) throw new IOException("地图压缩包超过 2 GB");
                var transfer = new DownloadProgress(progress, length);
                boolean copied = false;
                try (var input = https.getInputStream(); var output = Files.newOutputStream(staging, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
                    long size = 0;
                    var bytes = new byte[64 * 1024];
                    for (int count; (count = input.read(bytes)) >= 0;) {
                        GameDownloads.check(progress::stopped);
                        if ((size += count) > MAX) throw new IOException("地图压缩包超过 2 GB");
                        output.write(bytes, 0, count);
                        transfer.add(count);
                    }
                    if (size == 0 || length >= 0 && size != length) throw new IOException("地图文件未完整下载");
                    copied = true;
                } finally { if (!copied) Files.deleteIfExists(staging); }
                return;
            } finally { https.disconnect(); }
        }
        throw new IOException("地图下载跳转次数过多");
    }

    private static boolean fetchHostedRanges(URI url, Path staging, MinecraftInstaller.Progress progress) throws IOException {
        GameDownloads.check(progress::stopped);
        var probe = open(url);
        long length;
        String etag;
        try {
            probe.setRequestProperty("Range", "bytes=0-0");
            if (probe.getResponseCode() != 206) return false;
            var range = RANGE_PROBE.matcher(java.util.Objects.toString(probe.getHeaderField("Content-Range"), ""));
            if (!range.matches()) return false;
            length = Long.parseLong(range.group(1));
            etag = probe.getHeaderField("ETag");
            if (length < 8 * MIB || length > MAX || etag == null || !etag.startsWith("\"")) return false;
        } finally {
            probe.disconnect();
        }

        boolean completed = false;
        boolean created = false;
        try (var output = FileChannel.open(staging, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
            created = true;
            var transfer = new DownloadProgress(progress, length);
            try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
                var segments = new ExecutorCompletionService<Void>(pool);
                int workers = 3;
                for (int index = 0; index < workers; index++) {
                    long start = length * index / workers;
                    long end = length * (index + 1) / workers - 1;
                    segments.submit(() -> {
                        fetchRange(url, output, progress, transfer, start, end, length, etag);
                        return null;
                    });
                }
                try {
                    for (int index = 0; index < workers; index++) segments.take().get();
                } catch (ExecutionException failure) {
                    throw new IOException("地图分段下载失败", failure.getCause());
                } catch (InterruptedException cancelled) {
                    Thread.currentThread().interrupt();
                    throw new IOException("下载已取消", cancelled);
                } finally {
                    pool.shutdownNow();
                }
            }
            GameDownloads.check(progress::stopped);
            if (output.size() != length) throw new IOException("地图文件未完整下载");
            completed = true;
            return true;
        } finally {
            if (created && !completed) Files.deleteIfExists(staging);
        }
    }

    private static void fetchRange(URI url, FileChannel output, MinecraftInstaller.Progress progress, DownloadProgress transfer,
                                   long start, long end, long length, String etag) throws IOException {
        GameDownloads.check(progress::stopped);
        var request = open(url);
        try {
            request.setRequestProperty("Range", "bytes=" + start + "-" + end);
            request.setRequestProperty("If-Match", etag);
            if (request.getResponseCode() != 206 || !etag.equals(request.getHeaderField("ETag"))
                || !("bytes " + start + "-" + end + "/" + length).equals(request.getHeaderField("Content-Range"))) {
                throw new IOException("地图来源没有返回指定的分段");
            }
            try (var input = request.getInputStream()) {
                byte[] bytes = new byte[64 * 1024];
                long offset = start;
                while (offset <= end) {
                    int count = input.read(bytes, 0, (int) Math.min(bytes.length, end - offset + 1));
                    GameDownloads.check(progress::stopped);
                    if (count < 0) throw new IOException("地图分段未传输完整");
                    var buffer = ByteBuffer.wrap(bytes, 0, count);
                    while (buffer.hasRemaining()) offset += output.write(buffer, offset);
                    transfer.add(count);
                }
                if (input.read() != -1) throw new IOException("地图分段长度无效");
            }
        } finally {
            request.disconnect();
        }
    }

    private static HttpsURLConnection open(URI url) throws IOException {
        var request = (HttpsURLConnection) url.toURL().openConnection();
        request.setInstanceFollowRedirects(false);
        request.setConnectTimeout(7000);
        request.setReadTimeout(15000);
        request.setRequestProperty("User-Agent", "Kynex Launcher/1.7.0");
        request.setRequestProperty("Accept-Encoding", "identity");
        return request;
    }

    private static final class DownloadProgress {
        private final MinecraftInstaller.Progress progress;
        private final long length;
        private long received;
        private int last = -1;

        DownloadProgress(MinecraftInstaller.Progress progress, long length) {
            this.progress = progress;
            this.length = length;
            add(0);
        }

        synchronized void add(int count) {
            received += count;
            int current = (int) (received == length ? Math.ceilDiv(received, MIB) : received / MIB);
            if (current == last) return;
            last = current;
            int total = length > 0 ? (int) Math.ceilDiv(length, MIB) : current + 1;
            progress.update("下载地图文件（MiB）", current, total);
        }
    }

    private static boolean allowed(URI address) {
        String host = address.getHost();
        return "https".equals(address.getScheme()) && host != null && host.matches("(?i)[a-z0-9-]+(?:\\.[a-z0-9-]+)+")
            && !host.matches("[0-9.]+") && !host.toLowerCase(Locale.ROOT).endsWith(".local")
            && address.getRawUserInfo() == null && address.getRawFragment() == null && address.getPort() == -1;
    }
}
