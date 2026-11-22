package com.keke.kynex.core;

import com.google.gson.JsonElement;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import java.io.IOException;
import java.io.InputStream;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.function.BooleanSupplier;
import java.util.function.Predicate;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLHandshakeException;

final class GameDownloads {
    static final long DOCUMENT_LIMIT = 16 * 1024 * 1024;
    static final long FILE_LIMIT = 512 * 1024 * 1024;
    private static final String MIRROR = "bmclapi2.bangbang93.com";
    private static final String VERSION_MANIFEST = "/mc/game/version_manifest_v2.json";
    private static final Set<String> GAME_HOSTS = Set.of(
        "launchermeta.mojang.com", "launcher.mojang.com", "piston-meta.mojang.com", "piston-data.mojang.com",
        "resources.download.minecraft.net", "libraries.minecraft.net", "meta.fabricmc.net", "meta.quiltmc.org",
        "maven.fabricmc.net", "maven.quiltmc.org", "maven.minecraftforge.net", "files.minecraftforge.net",
        "maven.neoforged.net", "repo.maven.apache.org", "repo1.maven.org", "optifine.net",
        "cdn.modrinth.com", "media.forgecdn.net", "edge.forgecdn.net", "mediafilez.forgecdn.net", "oss.pixelmap.cc",
        "authlib-injector.yushi.moe", "www.minecraft.net", "launchercontent.mojang.com", MIRROR);
    private static final Set<String> RUNTIME_HOSTS = Set.of(
        "api.adoptium.net", "github.com", "raw.githubusercontent.com", "codeload.github.com",
        "release-assets.githubusercontent.com", "objects.githubusercontent.com",
        "mirrors.tuna.tsinghua.edu.cn");
    private static final int MAX_REDIRECTS = 5;
    private static final long MIRROR_COOLDOWN = Duration.ofMinutes(2).toNanos();
    private static final InheritableThreadLocal<TransferBudget> BUDGET = new InheritableThreadLocal<>();
    private final Connection connection;
    private final ManifestProbe probe;
    private volatile long mirrorUnavailableUntil;

    @FunctionalInterface
    interface Connection { InputStream open(URI address) throws IOException; }

    @FunctionalInterface
    private interface ManifestProbe { byte[] read(URI address) throws IOException; }

    record Document(JsonElement value, byte[] bytes) {}

    static final class TransferBudget implements AutoCloseable {
        private final TransferBudget previous = BUDGET.get();
        private final java.util.concurrent.atomic.AtomicLong consumed;
        private final long maximum;

        private TransferBudget(long alreadyUsed, long maximum) {
            this.maximum = maximum;
            consumed = new java.util.concurrent.atomic.AtomicLong(alreadyUsed);
            BUDGET.set(this);
        }

        long consumed() { return consumed.get(); }

        private void claim(int size) throws IOException {
            long used;
            do {
                used = consumed.get();
                if (size > maximum - used) throw new IOException("已达到任务的下载预算");
            } while (!consumed.compareAndSet(used, used + size));
        }

        @Override public void close() {
            if (previous == null) BUDGET.remove();
            else BUDGET.set(previous);
        }
    }

    static TransferBudget limitTransfers(long alreadyUsed, long maximum) {
        return new TransferBudget(alreadyUsed, maximum);
    }

    static final class HttpError extends IOException {
        final int status;
        HttpError(int status) {
            super("下载源返回 HTTP " + status);
            this.status = status;
        }
    }

    GameDownloads() { this(GameDownloads::open, GameDownloads::probeManifest); }

    GameDownloads(Connection connection) { this(connection, address -> readManifest(connection, address)); }

    private GameDownloads(Connection connection, ManifestProbe probe) {
        this.connection = connection;
        this.probe = probe;
    }

    JsonArray benchmark() throws InterruptedException {
        var pool = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor();
        try {
            var mirror = pool.submit(() -> measure("bmclapi", "https://" + MIRROR + VERSION_MANIFEST));
            var official = pool.submit(() -> measure("official", "https://piston-meta.mojang.com" + VERSION_MANIFEST));
            var result = new JsonArray();
            result.add(mirror.get());
            result.add(official.get());
            return result;
        } catch (java.util.concurrent.ExecutionException unexpected) { throw new IllegalStateException("无法测速", unexpected); }
        finally { pool.shutdownNow(); }
    }

    private JsonObject measure(String source, String url) {
        long start = System.nanoTime();
        var value = new JsonObject();
        value.addProperty("source", source);
        try {
            byte[] bytes = probe.read(validate(url));
            if (bytes.length > DOCUMENT_LIMIT) throw new IOException("版本清单超过允许大小");
            try {
                var manifest = LaunchManifest.object(JsonFiles.JSON.fromJson(new String(bytes, StandardCharsets.UTF_8), JsonElement.class));
                if (LaunchManifest.array(manifest.get("versions")).isEmpty()) throw new JsonParseException("Missing versions");
            } catch (JsonParseException invalid) {
                throw new IOException("来源没有返回有效的版本清单", invalid);
            }
            if (source.equals("bmclapi")) mirrorUnavailableUntil = 0;
            value.addProperty("ok", true);
            value.addProperty("latency", java.util.concurrent.TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start));
        } catch (IOException unavailable) {
            value.addProperty("ok", false);
            value.add("latency", com.google.gson.JsonNull.INSTANCE);
            value.addProperty("reason", NetworkFailure.describe(unavailable));
        }
        return value;
    }

    private static byte[] readManifest(Connection method, URI address) throws IOException {
        try (var stream = method.open(address)) {
            return stream.readNBytes((int) DOCUMENT_LIMIT + 1);
        }
    }

    private static byte[] probeManifest(URI address) throws IOException {
        try {
            return readManifest(GameDownloads::open, address);
        } catch (SocketException | SocketTimeoutException | javax.net.ssl.SSLException direct) {
            try { return WindowsHttps.read(address, 5000, (int) DOCUMENT_LIMIT); }
            catch (IOException platform) {
                direct.addSuppressed(platform);
                throw direct;
            }
        }
    }

    String textFile(String url, long limit) throws IOException {
        URI address = validate(url);
        int max = Math.toIntExact(limit);
        try (var stream = connection.open(address)) {
            byte[] content = stream.readNBytes(max + 1);
            if (content.length > max) throw new IOException("下载文本超过允许大小");
            return new String(content, StandardCharsets.UTF_8);
        } catch (SocketException | SocketTimeoutException | javax.net.ssl.SSLException direct) {
            try { return new String(WindowsHttps.read(address, 10000, max), StandardCharsets.UTF_8); }
            catch (IOException platform) {
                direct.addSuppressed(platform);
                throw direct;
            }
        }
    }

    Document document(String url, boolean mirror, String digest, Predicate<JsonElement> valid,
                      BooleanSupplier stopped) throws IOException {
        IOException failure = null;
        for (URI address : sources(url, mirror)) {
            for (int attempt = 0; attempt < 2; attempt++) {
                check(stopped);
                try (var stream = connection.open(address)) {
                    byte[] body = stream.readNBytes((int) DOCUMENT_LIMIT + 1);
                    if (body.length > DOCUMENT_LIMIT || (!digest.isEmpty() && !matches(body, digest))) {
                        throw new IOException("版本清单校验失败");
                    }
                    check(stopped);
                    JsonElement value = JsonFiles.JSON.fromJson(new String(body, StandardCharsets.UTF_8), JsonElement.class);
                    if (value == null || !valid.test(value)) throw new IOException("下载源没有返回有效的版本清单");
                    return new Document(value, body);
                } catch (JsonParseException invalid) {
                    failure = new IOException("下载源没有返回有效的版本清单", invalid);
                } catch (IOException error) {
                    failure = error;
                }
                if (!retry(address, failure)) break;
            }
        }
        check(stopped);
        throw new IOException("获取版本信息失败：" + failure.getMessage(), failure);
    }

    void file(String url, boolean mirror, Path destination, String hash, long limit,
              BooleanSupplier stopped) throws IOException {
        check(stopped);
        if (Files.exists(destination, LinkOption.NOFOLLOW_LINKS)
            && !Files.isRegularFile(destination, LinkOption.NOFOLLOW_LINKS)) {
            throw new IOException("下载位置不是普通文件");
        }
        if (Files.isRegularFile(destination) && Files.size(destination) <= limit
            && (hash.isEmpty() ? Files.size(destination) > 0 : matches(destination, hash, stopped))) {
            return;
        }
        IOException failure = null;
        for (URI address : sources(url, mirror)) {
            for (int attempt = 0; attempt < 2; attempt++) {
                check(stopped);
                try {
                    transfer(address, destination, hash, limit, stopped);
                    return;
                } catch (IOException error) {
                    failure = error;
                }
                if (!retry(address, failure)) break;
            }
        }
        check(stopped);
        throw new IOException("无法下载 " + destination.getFileName() + "：" + failure.getMessage(), failure);
    }

    private void transfer(URI address, Path destination, String hash, long limit, BooleanSupplier stopped) throws IOException {
        Path staged = Files.createTempFile(destination.getParent(), ".kxl-download-", ".part");
        var budget = BUDGET.get();
        try {
            MessageDigest digest = hash.isEmpty() ? null : digest(hash);
            long length = 0;
            try (var input = connection.open(address); var output = Files.newOutputStream(staged)) {
                byte[] buffer = new byte[64 * 1024];
                for (int count; (count = input.read(buffer)) >= 0;) {
                    check(stopped);
                    length += count;
                    if (length > limit) throw new IOException("下载文件超过允许大小");
                    if (budget != null) budget.claim(count);
                    if (digest != null) digest.update(buffer, 0, count);
                    output.write(buffer, 0, count);
                }
            }
            if (digest == null ? length == 0 : !hex(digest.digest()).equalsIgnoreCase(hash)) {
                throw new IOException("下载文件校验失败");
            }
            check(stopped);
            Files.move(staged, destination, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } finally {
            Files.deleteIfExists(staged);
        }
    }

    private boolean retry(URI address, IOException failure) {
        boolean transientFailure = failure instanceof SocketException || failure instanceof SocketTimeoutException
            || failure instanceof SSLHandshakeException && failure.getCause() instanceof java.io.EOFException;
        if (!MIRROR.equals(address.getHost())) return transientFailure;
        if (transientFailure) mirrorUnavailableUntil = System.nanoTime() + MIRROR_COOLDOWN;
        return false;
    }

    static boolean matches(Path path, String hash, BooleanSupplier stopped) throws IOException {
        var digest = digest(hash);
        try (var input = Files.newInputStream(path)) {
            byte[] buffer = new byte[64 * 1024];
            for (int count; (count = input.read(buffer)) >= 0;) {
                check(stopped);
                digest.update(buffer, 0, count);
            }
        }
        return hex(digest.digest()).equalsIgnoreCase(hash);
    }

    private static boolean matches(byte[] data, String hash) throws IOException {
        return hex(digest(hash).digest(data)).equalsIgnoreCase(hash);
    }

    private static MessageDigest digest(String hash) throws IOException {
        if (!hash.matches("(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})")) throw new IOException("资源校验值无效");
        try {
            return MessageDigest.getInstance(hash.length() == 40 ? "SHA-1" : "SHA-256");
        } catch (NoSuchAlgorithmException unavailable) {
            throw new IOException("无法校验游戏资源", unavailable);
        }
    }

    private static String hex(byte[] bytes) { return HexFormat.of().formatHex(bytes); }

    static void check(BooleanSupplier stopped) throws IOException {
        if (stopped.getAsBoolean() || Thread.currentThread().isInterrupted()) throw new IOException("下载已取消");
    }

    private List<URI> sources(String url, boolean mirror) throws IOException {
        URI original = validate(url);
        long unavailable = mirrorUnavailableUntil;
        if (!mirror || unavailable != 0 && System.nanoTime() - unavailable < 0
            || !GAME_HOSTS.contains(original.getHost()) || MIRROR.equals(original.getHost())) return List.of(original);
        String path = original.getRawPath();
        String query = original.getRawQuery() == null ? "" : "?" + original.getRawQuery();
        String prefix = "https://" + MIRROR;
        return switch (original.getHost()) {
            case "resources.download.minecraft.net" -> List.of(URI.create(prefix + "/assets" + path + query), original);
            case "libraries.minecraft.net", "maven.fabricmc.net", "maven.minecraftforge.net" ->
                List.of(URI.create(prefix + "/maven" + path + query), original);
            case "maven.neoforged.net" ->
                List.of(URI.create(prefix + "/maven" + path.replaceFirst("^/releases", "") + query), original);
            case "maven.quiltmc.org" ->
                List.of(URI.create(prefix + "/maven" + path.replaceFirst("^/repository/release", "") + query), original);
            case "meta.fabricmc.net" -> List.of(URI.create(prefix + "/fabric-meta" + path + query), original);
            case "meta.quiltmc.org", "repo.maven.apache.org", "repo1.maven.org", "files.minecraftforge.net", "optifine.net",
                "cdn.modrinth.com", "media.forgecdn.net", "edge.forgecdn.net", "mediafilez.forgecdn.net", "oss.pixelmap.cc",
                "authlib-injector.yushi.moe" ->
                List.of(original);
            default -> List.of(URI.create(prefix + path + query), original);
        };
    }

    private static URI validate(String url) throws IOException {
        try {
            URI address = URI.create(url);
            String host = address.getHost();
            if ("https".equals(address.getScheme()) && host != null
                && (GAME_HOSTS.contains(host.toLowerCase(Locale.ROOT)) || RUNTIME_HOSTS.contains(host.toLowerCase(Locale.ROOT)))
                && address.getRawUserInfo() == null && address.getPort() == -1 && address.getRawFragment() == null) {
                return address;
            }
        } catch (IllegalArgumentException invalid) {
            throw new IOException("下载地址无效", invalid);
        }
        throw new IOException("下载地址不在受支持的来源中");
    }

    private static InputStream open(URI address) throws IOException {
        for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
            validate(address.toString());
            var connection = (HttpsURLConnection) address.toURL().openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(7000);
            connection.setReadTimeout(8000);
            connection.setRequestProperty("User-Agent", "Kynex Launcher");
            try {
                int status = connection.getResponseCode();
                if (status == 200) return connection.getInputStream();
                String target = connection.getHeaderField("Location");
                if (status >= 300 && status <= 399 && target != null) {
                    address = address.resolve(target);
                    connection.disconnect();
                    continue;
                }
                throw new HttpError(status);
            } catch (IOException | RuntimeException error) {
                connection.disconnect();
                throw error;
            }
        }
        throw new IOException("下载源重定向过多");
    }
}
