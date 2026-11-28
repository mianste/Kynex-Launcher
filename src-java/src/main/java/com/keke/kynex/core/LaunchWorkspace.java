package com.keke.kynex.core;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/** Keeps files locked by one game process separate from every other launch. */
final class LaunchWorkspace implements AutoCloseable {
    private static final ConcurrentHashMap<Path, Set<ProcessHandle>> RUNNING = new ConcurrentHashMap<>();
    private final Path instance;
    final Path natives;
    final Path log;
    private boolean retained;

    private LaunchWorkspace(Path instance, Path natives, Path log) {
        this.instance = instance;
        this.natives = natives;
        this.log = log;
    }

    static LaunchWorkspace create(Path instance) throws IOException {
        Path root = instance.toRealPath();
        Path nativeRoot = Files.createDirectories(root.resolve("natives")).toRealPath();
        if (!nativeRoot.startsWith(root)) throw new IOException("原生库目录位于实例之外");
        Path logs = Files.createDirectories(root.resolve("logs")).toRealPath();
        if (!logs.startsWith(root)) throw new IOException("日志目录位于实例之外");
        Path natives = Files.createTempDirectory(nativeRoot, "launch-");
        try {
            return new LaunchWorkspace(root, natives, Files.createTempFile(logs, "kxl-launch-", ".log"));
        } catch (IOException error) {
            try { GameFiles.removeStaging(natives); }
            catch (IOException cleanup) { error.addSuppressed(cleanup); }
            throw error;
        }
    }

    void retainUntilExit(Process process) {
        retained = true;
        var handle = process.toHandle();
        RUNNING.compute(instance, (key, active) -> {
            if (active == null) active = ConcurrentHashMap.newKeySet();
            active.add(handle);
            return active;
        });
        process.onExit().thenRunAsync(() -> {
            RUNNING.computeIfPresent(instance, (key, active) -> {
                active.remove(handle);
                return active.isEmpty() ? null : active;
            });
            try { GameFiles.removeStaging(natives); }
            catch (IOException unavailable) {
                System.err.println("无法清理本次启动的临时原生库：" + unavailable.getMessage());
            }
        });
    }

    static boolean running(Path instance) {
        var active = RUNNING.get(instance.toAbsolutePath().normalize());
        return active != null && active.stream().anyMatch(ProcessHandle::isAlive);
    }

    @Override public void close() throws IOException {
        if (!retained) GameFiles.removeStaging(natives);
    }
}
