package com.keke.kynex.core;

import com.google.gson.JsonObject;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

final class DownloadConcurrencyTest {
    @Test void downloadsMoreThanSixteenFilesWhileRespectingSelectedLimit(@TempDir Path root) throws Exception {
        var gate = new CountDownLatch(24);
        var active = new AtomicInteger();
        var peak = new AtomicInteger();
        var downloads = new GameDownloads(url -> {
            peak.accumulateAndGet(active.incrementAndGet(), Math::max);
            gate.countDown();
            try {
                if (!gate.await(3, TimeUnit.SECONDS)) throw new IOException("Downloads did not fill the 24 slots");
            } catch (InterruptedException cancelled) {
                Thread.currentThread().interrupt();
                throw new IOException(cancelled);
            }
            return new ByteArrayInputStream(new byte[]{1, 2, 3}) {
                @Override public void close() { active.decrementAndGet(); }
            };
        });
        var files = new ArrayList<MinecraftInstaller.FileEntry>();
        for (int i = 0; i < 36; i++) files.add(new MinecraftInstaller.FileEntry(
            "https://libraries.minecraft.net/test/" + i, "libraries/test/" + i, ""));
        new MinecraftInstaller(downloads).transfer(root, files, false, 24, new MinecraftInstaller.Progress() {}, "test");
        assertEquals(24, peak.get());
        assertEquals(0, active.get());
        for (int i = 0; i < 36; i++) assertArrayEquals(new byte[]{1, 2, 3}, Files.readAllBytes(root.resolve("libraries/test/" + i)));
    }

    @Test void supportsOneToSixtyFourAndPreservesExistingChoice() {
        var settings = new JsonObject();
        assertEquals(16, MinecraftInstaller.threadCount(settings));
        for (int value : new int[]{1, 8, 32, 64}) {
            settings.addProperty("threads", value);
            assertEquals(value, MinecraftInstaller.threadCount(settings));
        }
        settings.addProperty("threads", 1000);
        assertEquals(64, MinecraftInstaller.threadCount(settings));
        settings.addProperty("threads", 0);
        assertEquals(1, MinecraftInstaller.threadCount(settings));
    }
}
