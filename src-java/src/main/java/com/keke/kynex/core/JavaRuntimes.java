package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

final class JavaRuntimes {
    private static final boolean WINDOWS = System.getProperty("os.name", "").startsWith("Windows");
    private static final String BINARY = WINDOWS ? "bin/java.exe" : "bin/java";
    private static final Pattern VERSION = Pattern.compile("version \"(\\d+)(?:\\.(\\d+))?");
    static final List<Integer> SUPPORTED = List.of(8, 17, 21, 25);
    private JavaRuntimes() {}

    static int recommended(long required) throws IOException {
        return SUPPORTED.stream().filter(major -> major >= required).findFirst()
            .orElseThrow(() -> new IOException("此版本需要 Java " + required + "，请在设置中指定兼容的 Java 路径"));
    }

    static String find(String custom, int supported, Path root, Path dataRoot) throws InterruptedException {
        for (String candidate : candidates(custom, root, dataRoot)) {
            if (version(candidate) == supported) return candidate;
        }
        return null;
    }

    static JsonArray scan(Path root, Path dataRoot) throws InterruptedException {
        var runtimes = new JsonArray();
        for (String candidate : candidates("", root, dataRoot)) {
            Detected known = detect(candidate);
            if (known == null) continue;
            var entry = new JsonObject();
            entry.addProperty("major", known.major());
            entry.addProperty("version", known.label());
            entry.addProperty("path", candidate);
            runtimes.add(entry);
        }
        return runtimes;
    }

    private static Set<String> candidates(String custom, Path root, Path dataRoot) {
        var candidates = new LinkedHashSet<String>();
        if (!custom.isEmpty()) candidates.add(custom);
        String home = System.getenv("JAVA_HOME");
        if (home != null && !home.isBlank()) candidates.add(Path.of(home).resolve(BINARY).toString());
        for (String part : System.getenv().getOrDefault("PATH", "").split(Pattern.quote(java.io.File.pathSeparator))) {
            if (part.isBlank()) continue;
            try {
                Path java = Path.of(part).resolve(WINDOWS ? "java.exe" : "java");
                if (java.isAbsolute() && Files.isRegularFile(java)) candidates.add(java.toString());
            } catch (java.nio.file.InvalidPathException ignored) { /* Ignore malformed path entries. */ }
        }
        for (String directory : WINDOWS
            ? List.of("C:/Program Files/Java", "C:/Program Files/Eclipse Adoptium", "C:/Program Files/Microsoft")
            : List.of("/usr/lib/jvm", "/Library/Java/JavaVirtualMachines")) {
            list(Path.of(directory), candidates, false);
        }
        list(root.resolve("runtimes"), candidates, true);
        if (!root.equals(dataRoot)) list(dataRoot.resolve("runtimes"), candidates, true);
        return candidates;
    }

    private static void list(Path directory, Set<String> candidates, boolean nested) {
        if (!Files.isDirectory(directory)) return;
        try (var entries = Files.list(directory)) {
            for (Path entry : entries.filter(Files::isDirectory).sorted().toList()) {
                for (String relative : List.of(BINARY, "Contents/Home/bin/java")) {
                    if (Files.isRegularFile(entry.resolve(relative))) candidates.add(entry.resolve(relative).toString());
                }
                if (nested) list(entry, candidates, false);
            }
        } catch (IOException ignored) {
            // An unavailable installation directory does not hide other runtimes.
        }
    }

    static long version(String executable) throws InterruptedException {
        Detected known = detect(executable);
        return known == null ? -1 : known.major();
    }

    private record Detected(long major, String label) {}

    private static Detected detect(String executable) throws InterruptedException {
        Process child = null;
        try {
            child = new ProcessBuilder(executable, "-version").redirectErrorStream(true).start();
            child.getOutputStream().close();
            if (!child.waitFor(5, TimeUnit.SECONDS)) return null;
            try (var output = child.getInputStream()) {
                String response = new String(output.readNBytes(8192), StandardCharsets.UTF_8);
                var matcher = VERSION.matcher(response);
                if (!matcher.find()) return null;
                String major = matcher.group(1);
                return new Detected(Long.parseLong(major.equals("1") ? matcher.group(2) : major), response.lines().findFirst().orElse(""));
            }
        } catch (IOException | NumberFormatException invalid) {
            return null;
        } finally {
            if (child != null && child.isAlive()) child.destroyForcibly();
        }
    }
}
