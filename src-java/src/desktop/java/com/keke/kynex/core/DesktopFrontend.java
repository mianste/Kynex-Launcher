package com.keke.kynex.core;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;

/** Serves the bundled interface exclusively on a private loopback origin. */
final class DesktopFrontend implements AutoCloseable {
    private static final Map<String, String> MIME = Map.ofEntries(
        Map.entry("html", "text/html; charset=utf-8"), Map.entry("js", "text/javascript; charset=utf-8"),
        Map.entry("css", "text/css; charset=utf-8"), Map.entry("png", "image/png"), Map.entry("jpg", "image/jpeg"),
        Map.entry("jpeg", "image/jpeg"), Map.entry("svg", "image/svg+xml"), Map.entry("webp", "image/webp"),
        Map.entry("json", "application/json; charset=utf-8"), Map.entry("woff2", "font/woff2"), Map.entry("woff", "font/woff"),
        Map.entry("wasm", "application/wasm"));
    private final Path root;
    private final HttpServer server;
    private final ExecutorService workers = Executors.newVirtualThreadPerTaskExecutor();
    private final String authority;
    private final byte[] bootstrap;
    private final HotfixBundles hotfix;
    private final Map<String, String> mediaTypes = Map.ofEntries(
        Map.entry("mp3", "audio/mpeg"), Map.entry("flac", "audio/flac"), Map.entry("wav", "audio/wav"),
        Map.entry("ogg", "audio/ogg"), Map.entry("oga", "audio/ogg"), Map.entry("m4a", "audio/mp4"), Map.entry("aac", "audio/aac"),
        Map.entry("opus", "audio/ogg"), Map.entry("mp4", "video/mp4"), Map.entry("webm", "video/webm"),
        Map.entry("mov", "video/quicktime"), Map.entry("m4v", "video/mp4"), Map.entry("png", "image/png"),
        Map.entry("jpeg", "image/jpeg"), Map.entry("jpg", "image/jpeg"), Map.entry("gif", "image/gif"));
    private final LinkedHashMap<String, Media> media = new LinkedHashMap<>();
    private final Map<String, PackUpload> packUploads = new LinkedHashMap<>();
    private Path uploadDirectory;
    private record Media(Path path, String type) {}
    private record PackUpload(Path path, long size, long expires) {}

    DesktopFrontend(Path root) throws IOException { this(root, null); }

    DesktopFrontend(Path root, HotfixBundles hotfix) throws IOException {
        this.root = root.toRealPath();
        this.hotfix = hotfix;
        try (var source = DesktopFrontend.class.getResourceAsStream("/desktop-bootstrap.js")) {
            if (source == null) throw new IOException("缺少桌面界面入口");
            bootstrap = source.readAllBytes();
        }
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 32);
        authority = "127.0.0.1:" + server.getAddress().getPort();
        server.createContext("/", this::handle);
        server.setExecutor(workers);
        server.start();
    }

    String url() { return "http://" + authority + "/"; }

    synchronized com.google.gson.JsonObject preparePackUpload(Path dataRoot, String name, long size) throws IOException {
        LaunchManifest.safeName(name);
        if (!name.toLowerCase(Locale.ROOT).matches(".*\\.(zip|mrpack|curseforge)") || size <= 0)
            throw new IOException("整合包文件无效");
        long now = System.nanoTime();
        packUploads.values().removeIf(upload -> now - upload.expires() >= 0);
        if (packUploads.size() >= 16) throw new IOException("请稍后重新拖入整合包");
        if (uploadDirectory == null) {
            Path parent = GameFiles.target(dataRoot, "imports/.directory").getParent();
            uploadDirectory = Files.createTempDirectory(Files.createDirectories(parent), "drop-");
        }
        String key = UUID.randomUUID().toString();
        Path path = uploadDirectory.resolve(key).resolve(name);
        packUploads.put(key, new PackUpload(path, size, now + java.util.concurrent.TimeUnit.MINUTES.toNanos(1)));
        return WorkshopPlans.json("url", url() + "__kxl_pack/" + key, "path", path.toString());
    }

    synchronized String asset(String raw) throws IOException {
        Path path = Path.of(raw);
        if (!path.isAbsolute() || path.getFileName() == null || !raw.matches("(?s)^[A-Za-z]:[\\\\/].*"))
            throw new IOException("本地媒体路径无效");
        String name = path.getFileName().toString();
        String type = mediaTypes.get(name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT));
        if (type == null || !Files.isRegularFile(path) || path.toRealPath().toString().startsWith("\\\\"))
            throw new IOException("无法读取该媒体文件");
        var item = new Media(path.toRealPath(), type);
        for (var entry : media.entrySet()) {
            if (item.equals(entry.getValue())) return url() + "__kxl_media/" + entry.getKey();
        }
        String key = UUID.randomUUID().toString();
        media.put(key, item);
        if (media.size() > 128) media.pollFirstEntry();
        return url() + "__kxl_media/" + key;
    }

    boolean owns(String location) {
        try {
            URI uri = URI.create(location);
            return "http".equals(uri.getScheme()) && authority.equals(uri.getRawAuthority());
        } catch (IllegalArgumentException invalid) {
            return false;
        }
    }

    private void handle(HttpExchange request) throws IOException {
        try (request) {
            if (!authority.equals(request.getRequestHeaders().getFirst("Host"))) {
                request.sendResponseHeaders(403, -1);
                return;
            }
            String raw = request.getRequestURI().getPath();
            if ("POST".equals(request.getRequestMethod()) && raw.startsWith("/__kxl_pack/")) {
                receivePack(request, raw.substring("/__kxl_pack/".length()));
                return;
            }
            if (!("GET".equals(request.getRequestMethod()) || "HEAD".equals(request.getRequestMethod()))) {
                request.sendResponseHeaders(403, -1);
                return;
            }
            request.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
            request.getResponseHeaders().set("Cache-Control", "no-store");
            request.getResponseHeaders().set("Content-Security-Policy",
                "default-src 'self'; img-src 'self' https: data: blob:; media-src 'self' https: blob:; "
                    + "style-src 'self' 'unsafe-inline'; object-src 'none'; frame-src 'none'; base-uri 'none'");
            if (raw.startsWith("/__kxl_media/")) {
                serveMedia(request, raw.substring(13));
                return;
            }
            if ("/__kxl_java.js".equals(raw)) {
                send(request, MIME.get("js"), bootstrap);
                return;
            }
            String name = "/".equals(raw) ? "/index.html" : raw;
            int extension = name.lastIndexOf('.');
            String mime = MIME.getOrDefault(extension < 0 ? "" : name.substring(extension + 1), "application/octet-stream");
            byte[] patched = hotfix == null ? null : hotfix.asset(name.substring(1));
            if (patched != null) {
                send(request, mime, "/index.html".equals(name) ? boot(new String(patched, StandardCharsets.UTF_8)) : patched);
                return;
            }
            Path requested = root.resolve("." + name).normalize();
            if (!requested.startsWith(root) || !Files.isRegularFile(requested)
                || !requested.toRealPath().startsWith(root)) {
                request.sendResponseHeaders(404, -1);
                return;
            }
            if ("/index.html".equals(name)) {
                send(request, mime, boot(Files.readString(requested)));
            } else {
                request.getResponseHeaders().set("Content-Type", mime);
                request.sendResponseHeaders(200, Files.size(requested));
                Files.copy(requested, request.getResponseBody());
            }
        }
    }

    private static byte[] boot(String html) {
        return html.replace("<head>", "<head><script src=\"./__kxl_java.js\"></script>").getBytes(StandardCharsets.UTF_8);
    }

    private void receivePack(HttpExchange request, String key) throws IOException {
        var headers = request.getRequestHeaders();
        if (!("http://" + authority).equals(headers.getFirst("Origin"))
            || !"application/octet-stream".equals(headers.getFirst("Content-Type"))) {
            request.sendResponseHeaders(403, -1);
            return;
        }
        PackUpload upload;
        synchronized (this) { upload = packUploads.remove(key); }
        if (upload == null || System.nanoTime() - upload.expires() >= 0
            || !Long.toString(upload.size()).equals(headers.getFirst("Content-Length"))) {
            request.sendResponseHeaders(400, -1);
            return;
        }
        try {
            Files.createDirectory(upload.path().getParent());
            if (Files.copy(request.getRequestBody(), upload.path()) != upload.size())
                throw new IOException("整合包文件未传输完整");
        } catch (IOException failed) {
            if (Files.isDirectory(upload.path().getParent())) GameFiles.removeStaging(upload.path().getParent());
            request.sendResponseHeaders(500, -1);
            return;
        }
        request.sendResponseHeaders(204, -1);
    }

    private void serveMedia(HttpExchange request, String token) throws IOException {
        Media file;
        synchronized (this) { file = media.get(token); }
        String source = request.getRequestHeaders().getFirst("Sec-Fetch-Site");
        if (file == null || (source != null && !"same-origin".equals(source)) || !Files.isRegularFile(file.path())
            || !file.path().equals(file.path().toRealPath())) {
            request.sendResponseHeaders(404, -1);
            return;
        }
        try (var input = java.nio.channels.FileChannel.open(file.path(), java.nio.file.StandardOpenOption.READ)) {
            long length = input.size();
            long start = 0, end = length - 1;
            String range = request.getRequestHeaders().getFirst("Range");
            var headers = request.getResponseHeaders();
            if (range != null) {
                try {
                    if (!range.matches("bytes=(?:[0-9]+-[0-9]*|-[0-9]+)")) throw new NumberFormatException();
                    String[] limits = range.substring(6).split("-", -1);
                    if (limits[0].isEmpty()) start = Math.max(0, length - Long.parseLong(limits[1]));
                    else {
                        start = Long.parseLong(limits[0]);
                        if (!limits[1].isEmpty()) end = Math.min(end, Long.parseLong(limits[1]));
                    }
                    if (start > end) throw new NumberFormatException();
                    headers.set("Content-Range", "bytes " + start + "-" + end + "/" + length);
                } catch (NumberFormatException invalid) {
                    headers.set("Content-Range", "bytes */" + length);
                    request.sendResponseHeaders(416, -1);
                    return;
                }
            }
            headers.set("Content-Type", file.type());
            headers.set("Accept-Ranges", "bytes");
            headers.set("Cross-Origin-Resource-Policy", "same-origin");
            long count = end - start + 1;
            boolean head = "HEAD".equals(request.getRequestMethod());
            if (head || count == 0) headers.set("Content-Length", Long.toString(count));
            request.sendResponseHeaders(range == null ? 200 : 206, head || count == 0 ? -1 : count);
            if (!head && count > 0) {
                var output = java.nio.channels.Channels.newChannel(request.getResponseBody());
                while (start <= end) {
                    long sent = input.transferTo(start, Math.min(end - start + 1, 8 * 1024 * 1024), output);
                    if (sent <= 0) break;
                    start += sent;
                }
            }
        }
    }

    private static void send(HttpExchange request, String mime, byte[] content) throws IOException {
        request.getResponseHeaders().set("Content-Type", mime);
        request.sendResponseHeaders(200, content.length);
        request.getResponseBody().write(content);
    }

    @Override public void close() throws IOException {
        server.stop(0);
        workers.close();
        if (uploadDirectory != null) GameFiles.removeStaging(uploadDirectory);
    }
}
