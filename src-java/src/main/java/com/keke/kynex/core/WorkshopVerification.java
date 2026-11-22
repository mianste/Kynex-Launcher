package com.keke.kynex.core;

import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;

final class WorkshopVerification {
    private static final List<String> READY = List.of("OpenGL", "Sound engine started", "Created: ",
        "OpenAL initialized", "Reloading ResourceManager");
    private WorkshopVerification() {}

    static void ensureIdle() throws IOException {
        try (var processes = ProcessHandle.allProcesses()) {
            if (processes.filter(process -> process.pid() != ProcessHandle.current().pid())
                .flatMap(process -> process.info().command().stream())
                .map(command -> Path.of(command).getFileName().toString().toLowerCase(java.util.Locale.ROOT))
                .anyMatch(java.util.Set.of("java.exe", "javaw.exe", "java")::contains)) {
                throw new IOException("检测到其他 Java 游戏进程，请关闭后再验证");
            }
        }
    }

    static synchronized void observe(Process process, Path log, Path game, Instant started, BooleanSupplier stopped)
        throws IOException, InterruptedException {
        Path latest = GameFiles.target(game, "logs/latest.log");
        try {
            long start = System.nanoTime();
            long seen = -1;
            while (true) {
                GameDownloads.check(stopped);
                var lines = tail(log, 32_000);
                if (Files.isRegularFile(latest, LinkOption.NOFOLLOW_LINKS)
                    && !Files.getLastModifiedTime(latest).toInstant().isBefore(started)) lines += "\n" + tail(latest, 32_000);
                if (!process.isAlive()) throw failure("游戏提前退出（" + process.exitValue() + "）", lines);
                long now = System.nanoTime();
                if (READY.stream().anyMatch(lines::contains)) {
                    if (seen < 0) seen = now;
                    if (now - seen >= Duration.ofSeconds(3).toNanos()) return;
                }
                if (now - start >= Duration.ofSeconds(60).toNanos()) throw failure("60 秒内未检测到游戏初始化", lines);
                process.waitFor(250, TimeUnit.MILLISECONDS);
            }
        } finally {
            process.destroy();
            if (!process.waitFor(2, TimeUnit.SECONDS)) process.destroyForcibly();
        }
    }

    static String tail(Path file, int limit) throws IOException {
        if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) return "";
        try (var reader = new RandomAccessFile(file.toFile(), "r")) {
            long length = reader.length();
            int count = (int) Math.min(length, limit);
            reader.seek(length - count);
            byte[] bytes = new byte[count];
            int read = reader.read(bytes);
            return read <= 0 ? "" : new String(bytes, 0, read, StandardCharsets.UTF_8);
        }
    }

    private static IOException failure(String message, String lines) {
        String safe = AssistantService.redact(lines, "");
        return new IOException(message + "。\n" + safe.substring(Math.max(0, safe.length() - 4000)));
    }
}
