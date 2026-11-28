package com.keke.kynex.core;

import com.google.gson.JsonObject;
import com.keke.kynex.account.AccountStore;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.jar.JarEntry;
import java.util.jar.JarOutputStream;
import javax.tools.ToolProvider;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

final class MultiLaunchTest {
    @Test void keepsThreeRealProcessesAndTheirLockedLibrariesAndLogsIndependent(@TempDir Path directory) throws Exception {
        Path root = directory.toRealPath();
        var account = new AccountStore(root).loginOffline("MultiLaunchTest");
        fixture(root);
        Path first = instance(root, "first-version");
        Path other = instance(root, "other-version");
        Files.writeString(first.resolve("natives/keep-user-file.txt"), "keep");
        Files.writeString(first.resolve("logs/kxl-launch.log"), "previous launch");
        var launches = new ArrayList<JsonObject>();
        var nativeFolders = new ArrayList<Path>();
        try {
            for (String id : List.of("first-version", "first-version", "other-version")) {
                var request = new JsonObject();
                request.addProperty("id", id);
                request.addProperty("accountId", account.get("id").getAsString());
                request.add("settings", JsonFiles.JSON.fromJson("{\"gameLanguage\":\"none\"}", JsonObject.class));
                JsonObject reply = new InstalledGameLauncher(root).launchOffline(request);
                launches.add(reply);
                Path log = Path.of(reply.get("log").getAsString());
                long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
                String text;
                while (!(text = new String(Files.readAllBytes(log), StandardCharsets.UTF_8)).contains("READY|") && System.nanoTime() < deadline) Thread.sleep(25);
                assertTrue(text.contains("READY|"), text);
                Path natives = Path.of(text.lines().filter(line -> line.startsWith("READY|")).findFirst().orElseThrow().substring(6));
                assertTrue(Files.isRegularFile(natives.resolve("fixture.dll")));
                nativeFolders.add(natives);
            }
            assertEquals(3, launches.stream().map(row -> row.get("pid").getAsLong()).distinct().count());
            assertEquals(3, launches.stream().map(row -> row.get("log").getAsString()).distinct().count());
            assertEquals(3, nativeFolders.stream().distinct().count());
            for (var reply : launches) assertTrue(ProcessHandle.of(reply.get("pid").getAsLong()).orElseThrow().isAlive());
            assertTrue(nativeFolders.get(0).startsWith(first.resolve("natives")));
            assertTrue(nativeFolders.get(1).startsWith(first.resolve("natives")));
            assertTrue(nativeFolders.get(2).startsWith(other.resolve("natives")));
            assertTrue(LaunchWorkspace.running(first));
            assertTrue(LaunchWorkspace.running(other));
            assertEquals("previous launch", Files.readString(first.resolve("logs/kxl-launch.log")));
            var firstProcess = ProcessHandle.of(launches.get(0).get("pid").getAsLong()).orElseThrow();
            firstProcess.destroyForcibly();firstProcess.onExit().get(5, TimeUnit.SECONDS);
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
            while (Files.exists(nativeFolders.get(0)) && System.nanoTime() < deadline) Thread.sleep(25);
            assertFalse(Files.exists(nativeFolders.get(0)));
            assertTrue(Files.exists(nativeFolders.get(1).resolve("fixture.dll")));
            assertTrue(ProcessHandle.of(launches.get(1).get("pid").getAsLong()).orElseThrow().isAlive());
            assertTrue(LaunchWorkspace.running(first));
            assertEquals("keep", Files.readString(first.resolve("natives/keep-user-file.txt")));
        } finally {
            for (var reply : launches) ProcessHandle.of(reply.get("pid").getAsLong()).ifPresent(process -> {
                process.destroyForcibly();
                try { process.onExit().get(5, TimeUnit.SECONDS); } catch (Exception ignored) {}
            });
        }
    }

    @Test void removesOnlyTheAbortedLaunchWorkspace(@TempDir Path directory) throws Exception {
        Path instance = directory.toRealPath();
        Files.createDirectories(instance.resolve("natives"));
        Files.writeString(instance.resolve("natives/existing.dll"), "existing");
        Path temporary;
        try (var files = LaunchWorkspace.create(instance)) {
            temporary = files.natives;
            Files.writeString(temporary.resolve("new.dll"), "new");
        }
        assertFalse(Files.exists(temporary));
        assertEquals("existing", Files.readString(instance.resolve("natives/existing.dll")));
    }

    private static Path instance(Path root, String id) throws Exception {
        Path instance = Files.createDirectories(root.resolve("instances").resolve(id));
        Files.createDirectories(instance.resolve("natives"));Files.createDirectories(instance.resolve("logs"));
        Files.copy(root.resolve("fixture-client.jar"), instance.resolve("client.jar"));
        var settings = new JsonObject();
        settings.addProperty("java", Path.of(System.getProperty("java.home"), "bin", System.getProperty("os.name").startsWith("Windows") ? "java.exe" : "java").toString());
        settings.addProperty("memory", 512);
        var config = new JsonObject();config.addProperty("version", id.equals("other-version") ? "1.21.4" : "1.21.1");config.addProperty("loader", "vanilla");config.add("settings", settings);
        JsonFiles.write(instance.resolve("kxl.json"), config);
        var version = JsonFiles.JSON.fromJson("""
            {"mainClass":"MultiLaunchFixture","libraries":[{"name":"fixture:natives-test:1","downloads":{"artifact":{"path":"fixture-natives.jar"}}}]}
            """, JsonObject.class);
        var java = new JsonObject();java.addProperty("majorVersion", Runtime.version().feature());version.add("javaVersion", java);
        JsonFiles.write(instance.resolve("version.json"), version);
        return instance;
    }

    private static void fixture(Path root) throws Exception {
        Path source = root.resolve("MultiLaunchFixture.java");
        Files.writeString(source, """
            import java.nio.file.*;
            public class MultiLaunchFixture {
                public static void main(String[] args) throws Exception {
                    System.setOut(new java.io.PrintStream(System.out, true, java.nio.charset.StandardCharsets.UTF_8));
                    Path natives = Path.of(System.getProperty("java.library.path"));
                    if (System.getProperty("os.name").startsWith("Windows")) System.load(natives.resolve("fixture.dll").toString());
                    System.out.println("READY|" + natives);
                    System.out.flush();
                    Thread.sleep(60000);
                }
            }
            """, StandardCharsets.UTF_8);
        assertEquals(0, ToolProvider.getSystemJavaCompiler().run(null, null, null, "--release", "21", "-d", root.toString(), source.toString()));
        try (var jar = new JarOutputStream(Files.newOutputStream(root.resolve("fixture-client.jar")))) {
            jar.putNextEntry(new JarEntry("MultiLaunchFixture.class"));Files.copy(root.resolve("MultiLaunchFixture.class"), jar);jar.closeEntry();
        }
        Path libraries = Files.createDirectories(root.resolve("libraries"));
        try (var jar = new JarOutputStream(Files.newOutputStream(libraries.resolve("fixture-natives.jar")))) {
            jar.putNextEntry(new JarEntry("fixture.dll"));
            if (System.getProperty("os.name").startsWith("Windows")) Files.copy(Path.of(System.getenv("SystemRoot"), "System32/version.dll"), jar);
            else jar.write(new byte[] {1, 2, 3});
            jar.closeEntry();
        }
    }
}
