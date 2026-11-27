package com.keke.kynex.core;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import javax.swing.JFrame;
import javax.swing.SwingUtilities;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledOnOs;
import org.junit.jupiter.api.condition.OS;
import static org.junit.jupiter.api.Assertions.*;

@EnabledOnOs(OS.WINDOWS)
final class GameWindowTitleTest {
    @Test void changesRealWindowOfOnlyTheLaunchedProcess() {
        assertTimeoutPreemptively(Duration.ofSeconds(15), () -> {
            Process target = fixture("Minecraft 1.8.9");
            Process other = fixture("Unrelated application");
            try (var first = output(target); var second = output(other)) {
                assertEquals("Minecraft 1.8.9", first.readLine());
                assertEquals("Unrelated application", second.readLine());
                String custom = "KXL · 1.8.9 · 测试玩家";
                assertTrue(GameWindowTitle.apply(target.pid(), custom) > 0, "Native title update must succeed");
                GameWindowTitle.watch(target, custom);
                String title;
                long deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(5);
                title = "";
                while (System.nanoTime() < deadline && !title.equals(custom)) {
                    if (first.ready()) title = first.readLine();
                    else Thread.sleep(20);
                }
                assertEquals(custom, title);
                assertEquals("Unrelated application", second.readLine());
            } finally {
                target.destroyForcibly();
                other.destroyForcibly();
            }
        });
    }

    private static Process fixture(String title) throws Exception {
        return new ProcessBuilder(Path.of(System.getProperty("java.home"), "bin/java.exe").toString(),
            "-Dfile.encoding=UTF-8", "-cp", System.getProperty("java.class.path"), Fixture.class.getName(), title).start();
    }
    private static BufferedReader output(Process process) {
        return new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8));
    }

    public static final class Fixture {
        public static void main(String[] args) throws Exception {
            var frame = new JFrame(args[0]);
            SwingUtilities.invokeAndWait(() -> {
                frame.setSize(320, 180);
                frame.setLocation(-20000, -20000);
                frame.setVisible(true);
            });
            var output = new java.io.PrintWriter(new java.io.OutputStreamWriter(System.out, StandardCharsets.UTF_8), true);
            while (true) {
                // Read the native window text: WM_SETTEXT does not update JFrame's Java field.
                char[] title = new char[1024];
                GameWindowTitle.User32.API.EnumWindows((window, context) -> {
                    var pid = new com.sun.jna.ptr.IntByReference();
                    GameWindowTitle.User32.API.GetWindowThreadProcessId(window, pid);
                    if (Integer.toUnsignedLong(pid.getValue()) == ProcessHandle.current().pid()
                        && GameWindowTitle.User32.API.IsWindowVisible(window)) {
                        GameWindowTitle.User32.API.GetWindowTextW(window, title, title.length);
                        return false;
                    }
                    return true;
                }, com.sun.jna.Pointer.NULL);
                output.println(com.sun.jna.Native.toString(title));
                Thread.sleep(100);
            }
        }
    }
}
