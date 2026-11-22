package com.keke.kynex.core;

import com.google.gson.JsonObject;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

import static com.keke.kynex.core.GameDownloads.check;
import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.object;

final class LoaderProcess {
    private LoaderProcess() {}

    static String java(Path root, JsonObject base, JsonObject settings, GameDownloads downloads,
                       MinecraftInstaller.Progress progress) throws IOException, InterruptedException {
        JsonObject requirement = object(base.get("javaVersion"));
        int major = JavaRuntimes.recommended(requirement.has("majorVersion") ? requirement.get("majorVersion").getAsLong() : 8);
        String installed = JavaRuntimes.find(text(settings, "java", ""), major, root, root);
        if (installed != null) return installed;
        // Installing a shared runtime must not mark the enclosing instance as published.
        var shareProgress = new MinecraftInstaller.Progress() {
            @Override public boolean stopped() { return progress.stopped(); }
            @Override public void update(String stage, int done, int total) { progress.update(stage, done, total); }
        };
        return required(new GameRuntimeInstaller(downloads).install(root, major, shareProgress), "path");
    }

    static void run(String java, List<String> arguments, Path work, String name, MinecraftInstaller.Progress progress)
        throws IOException, InterruptedException {
        check(progress::stopped);
        Path log = Files.createTempFile(work, "processor-", ".log");
        var command = new ArrayList<String>();
        command.add(java);
        command.addAll(arguments);
        var process = new ProcessBuilder(command).directory(work.toFile()).redirectErrorStream(true)
            .redirectOutput(log.toFile()).start();
        try {
            process.getOutputStream().close();
            long deadline = System.nanoTime() + Duration.ofMinutes(5).toNanos();
            while (!process.waitFor(150, TimeUnit.MILLISECONDS)) {
                check(progress::stopped);
                if (System.nanoTime() - deadline >= 0) throw new IOException(name + "运行超时");
            }
            if (process.exitValue() != 0) {
                try (var stream = Files.newInputStream(log)) {
                    stream.skipNBytes(Math.max(0, Files.size(log) - 4096));
                    String reason = new String(stream.readNBytes(4096), StandardCharsets.UTF_8).strip();
                    throw new IOException(name + "失败，退出码 " + process.exitValue() + (reason.isEmpty() ? "" : "\n" + reason));
                }
            }
        } finally {
            if (process.isAlive()) {
                process.descendants().forEach(ProcessHandle::destroyForcibly);
                process.destroyForcibly();
                process.waitFor(5, TimeUnit.SECONDS);
            }
        }
    }
}
