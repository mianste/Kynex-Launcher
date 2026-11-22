package com.keke.kynex.core;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.google.gson.JsonPrimitive;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.ExecutorCompletionService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;
import java.util.regex.Pattern;

import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.object;

final class DesktopUpdates {
    private static final String OLD = "https://github.com/mianste/Kynex-Launcher/releases/download/updater-stable/stable.json";
    private static final Pattern VERSION = Pattern.compile("^(?:v)?(0|[1-9][0-9]{0,7})\\.(0|[1-9][0-9]{0,7})\\.(0|[1-9][0-9]{0,7})(?:-([A-Za-z0-9.-]+))?$");
    private final Path root;
    final String version, channel;
    final ReleaseSignature signature;
    private volatile Candidate pending;
    private final java.util.concurrent.atomic.AtomicBoolean installing = new java.util.concurrent.atomic.AtomicBoolean();
    private record Candidate(URI url, String signature, JsonObject display) {}
    private record Response(Candidate update, boolean official) {}

    DesktopUpdates(Path root) throws IOException {
        this.root = root;
        var build = resource("build-channel.json");
        version = required(build, "version");
        channel = required(build, "channel");
        try (var key = DesktopUpdates.class.getResourceAsStream("/updater-public-key.txt")) {
            if (key == null) throw new IOException("启动器缺少更新公钥");
            signature = new ReleaseSignature(new String(key.readAllBytes(), StandardCharsets.UTF_8));
        }
    }

    synchronized JsonObject check() throws IOException, InterruptedException {
        if (installing.get()) throw new IOException("正在安装更新");
        pending = null;
        var saved = new JsonObject();
        try { saved = object(JsonFiles.read(root.resolve("update-sources.json"))); }
        catch (IOException | JsonParseException ignored) { /* Default to the bundled update source. */ }
        String endpoint = text(object(saved.get(channel)), "github", "").strip();
        if (endpoint.isEmpty() || channel.equals("stable") && endpoint.equals(OLD)) {
            endpoint = text(object(resource("update-sources.json").get(channel)), "github", "");
        }
        if (endpoint.isEmpty()) return fields("status", "unconfigured");
        URI official = ReleaseDownload.github(endpoint);
        List<URI> urls = ReleaseDownload.locations(official);
        var pool = Executors.newVirtualThreadPerTaskExecutor();
        var tasks = new ExecutorCompletionService<Response>(pool);
        boolean current = false;
        try {
            for (URI url : urls) tasks.submit(() -> {
                if (url.equals(official)) Thread.sleep(350);
                return new Response(read(ReleaseDownload.manifest(url)), url.equals(official));
            });
            for (int i = 0; i < urls.size(); i++) {
                try {
                    Response result = tasks.take().get();
                    if (result.update() != null) {
                        pending = result.update();
                        break;
                    }
                    current = true;
                    if (result.official()) break;
                } catch (java.util.concurrent.ExecutionException unavailable) { /* The other endpoint may still be reachable. */ }
            }
        } finally { pool.shutdownNow(); }
        if (pending != null) return fields("status", "available", "update", pending.display());
        if (current) return fields("status", "current");
        throw new IOException("更新源暂不可用，请稍后重试");
    }

    JsonElement install(Consumer<JsonObject> notify) throws IOException {
        if (!installing.compareAndSet(false, true)) throw new IOException("正在安装更新");
        Path stage = null;
        try {
            Candidate candidate = pending;
            if (candidate == null) throw new IOException("请先检查新版本");
            var parent = GameFiles.target(root, "launcher-updates/.directory").getParent();
            stage = Files.createTempDirectory(parent, "verified-");
            Path installer = stage.resolve("Kynex Launcher Update.exe");
            for (URI url : ReleaseDownload.locations(candidate.url())) {
                try {
                    try (var stream = Files.newOutputStream(installer)) {
                        ReleaseDownload.fetch(url, stream, 512L * 1024 * 1024, 25000,
                            (done, total) -> notify.accept(fields("stage", "downloading", "downloaded", done, "total", total)));
                    }
                    notify.accept(fields("stage", "verifying", "downloaded", 0, "total", 0));
                    try (var stream = Files.newInputStream(installer)) { signature.verify(stream, candidate.signature()); }
                    try (var stream = Files.newInputStream(installer)) {
                        if (stream.read() != 'M' || stream.read() != 'Z') throw new IOException("更新包不是 Windows 可执行文件");
                    }
                    long length = Files.size(installer);
                    notify.accept(fields("stage", "installing", "downloaded", length, "total", length));
                    new ProcessBuilder(installer.toString()).directory(stage.toFile()).start();
                    stage = null;
                    pending = null;
                    return new JsonPrimitive(true);
                } catch (IOException retry) { /* Only a verified update can be installed. */ }
            }
            throw new IOException("更新下载或签名校验失败，未安装任何文件");
        } finally {
            if (stage != null) GameFiles.removeStaging(stage);
            installing.set(false);
        }
    }

    private Candidate read(JsonObject manifest) throws IOException {
        String remote = required(manifest, "version");
        if (!newer(remote, version)) return null;
        if (!channel.equals(text(manifest, "channel", channel)) || channel.equals("stable") && remote.contains("-")) return null;
        // The signed Java Windows installer has its own platform entry. Earlier full installers cannot replace the Java desktop.
        JsonObject windows = object(object(manifest.get("platforms")).get("windows-x86_64-java"));
        if (windows.isEmpty()) return null;
        URI url = ReleaseDownload.github(required(windows, "url"));
        return new Candidate(url, required(windows, "signature"), fields("version", text(manifest, "displayVersion", remote),
            "notes", text(manifest, "notes", ""), "date", manifest.get("pub_date")));
    }

    private static boolean newer(String proposed, String current) throws IOException {
        var a = VERSION.matcher(proposed);
        var b = VERSION.matcher(current);
        if (!a.matches() || !b.matches()) throw new IOException("更新版本号无效");
        for (int index = 1; index <= 3; index++) {
            int order = Integer.compare(Integer.parseInt(a.group(index)), Integer.parseInt(b.group(index)));
            if (order != 0) return order > 0;
        }
        if (b.group(4) == null) return false;
        if (a.group(4) == null) return true;
        var x = a.group(4).split("\\.");
        var y = b.group(4).split("\\.");
        for (int i = 0; i < Math.min(x.length, y.length); i++) {
            boolean xNumber = x[i].matches("[0-9]+");
            boolean yNumber = y[i].matches("[0-9]+");
            int order = xNumber && yNumber ? new java.math.BigInteger(x[i]).compareTo(new java.math.BigInteger(y[i]))
                : xNumber != yNumber ? (xNumber ? -1 : 1) : x[i].compareTo(y[i]);
            if (order != 0) return order > 0;
        }
        return x.length > y.length;
    }

    static JsonObject resource(String filename) throws IOException {
        try (var stream = DesktopUpdates.class.getResourceAsStream("/" + filename)) {
            if (stream == null) throw new IOException("缺少启动器配置：" + filename);
            return JsonFiles.JSON.fromJson(new String(stream.readAllBytes(), StandardCharsets.UTF_8), JsonObject.class);
        }
    }

    static JsonObject fields(Object... values) {
        var result = new JsonObject();
        for (int i = 0; i < values.length; i += 2) result.add((String) values[i], JsonFiles.JSON.toJsonTree(values[i + 1]));
        return result;
    }
}
