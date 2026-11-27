package com.keke.kynex.core;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.nio.file.Path;
import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

final class UpdateRaceTest {
    private static Path configured(Path root) throws IOException {
        java.nio.file.Files.writeString(root.resolve("update-sources.json"),
            "{\"stable\":{\"github\":\"https://github.com/mianste/Kynex-Launcher/releases/download/updater-stable/stable-v2.json\"}}");
        return root;
    }

    private static JsonObject manifest(boolean newer) {
        return JsonParser.parseString("""
            {"version":"%s","channel":"stable","platforms":{"windows-x86_64-java":{
              "url":"https://github.com/mianste/Kynex-Launcher/releases/download/v99.0.0/update.exe","signature":"fixture"}}}
            """.formatted(newer ? "99.0.0" : "0.0.0")).getAsJsonObject();
    }

    @Test void newVersionDoesNotWaitForSlowOfficialSource(@TempDir Path root) {
        assertTimeoutPreemptively(Duration.ofSeconds(2), () -> {
            var updates = new DesktopUpdates(configured(root), (url, deadline) -> {
                if (url.getHost().equals("github.com")) new CountDownLatch(1).await();
                return manifest(true);
            }, 5000);
            assertEquals("available", updates.check().get("status").getAsString());
        });
    }

    @Test void staleMirrorGivesOfficialSourceTimeToReturnNewVersion(@TempDir Path root) throws Exception {
        var mirrorRead = new CountDownLatch(1);
        var updates = new DesktopUpdates(configured(root), (url, deadline) -> {
            if (url.getHost().equals("github.com")) {
                mirrorRead.await();
                Thread.sleep(40);
                return manifest(true);
            }
            mirrorRead.countDown();
            return manifest(false);
        }, 5000);
        assertEquals("available", updates.check().get("status").getAsString());
    }

    @Test void unreachableSourcesHaveOneOverallDeadline(@TempDir Path root) {
        assertTimeoutPreemptively(Duration.ofSeconds(2), () -> {
            var updates = new DesktopUpdates(configured(root), (url, deadline) -> {
                new CountDownLatch(1).await();
                return manifest(false);
            }, 100);
            assertThrows(IOException.class, updates::check);
        });
    }

    @Test void networkErrorsNeverReportCurrent(@TempDir Path root) throws Exception {
        var updates = new DesktopUpdates(configured(root), (url, deadline) -> { throw new IOException("offline"); }, 100);
        assertThrows(IOException.class, updates::check);
    }
}
