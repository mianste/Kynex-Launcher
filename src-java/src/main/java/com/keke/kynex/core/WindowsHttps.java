package com.keke.kynex.core;

import java.io.IOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;

/** Uses Windows' TLS settings for known public URLs when the Java connection fails. */
final class WindowsHttps {
    private WindowsHttps() {}

    static byte[] read(URI url, int timeoutMillis, int limit) throws IOException {
        String systemRoot = System.getenv("SystemRoot");
        if (systemRoot == null || !System.getProperty("os.name", "").startsWith("Windows")) {
            throw new IOException("此系统没有可用的 Windows HTTPS 客户端");
        }
        Path client = Path.of(systemRoot, "System32", "curl.exe");
        if (!Files.isRegularFile(client)) throw new IOException("此系统没有可用的 Windows HTTPS 客户端");
        String timeout = Integer.toString(Math.max(1, timeoutMillis / 1000));
        var process = new ProcessBuilder(client.toString(), "--disable", "--silent", "--fail", "--proto", "=https",
            "--user-agent", "Kynex Launcher/1.7.0",
            "--connect-timeout", timeout, "--max-time", timeout, "--max-filesize", Integer.toString(limit),
            "--", url.toASCIIString()).redirectError(ProcessBuilder.Redirect.DISCARD).start();
        try (var input = process.getInputStream()) {
            byte[] bytes = input.readNBytes(limit + 1);
            if (bytes.length > limit) throw new IOException("资源请求超过大小限制");
            if (process.waitFor() != 0) throw new IOException("Windows HTTPS 请求失败");
            return bytes;
        } catch (InterruptedException cancelled) {
            Thread.currentThread().interrupt();
            throw new IOException("资源请求已取消", cancelled);
        } finally {
            if (process.isAlive()) process.destroyForcibly();
        }
    }
}
