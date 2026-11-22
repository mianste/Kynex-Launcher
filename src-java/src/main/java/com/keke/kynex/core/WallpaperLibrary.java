package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

import static com.keke.kynex.core.JsonFiles.text;

public final class WallpaperLibrary {
    private static final Pattern LIBRARY = Pattern.compile("\"path\"\\s+\"([^\"]+)\"");
    private WallpaperLibrary() {}

    static JsonObject scanDefault() {
        var roots = new JsonArray();
        String windows = System.getenv("SystemRoot");
        if (windows != null) {
            try {
                var command = new ProcessBuilder(Path.of(windows, "System32", "reg.exe").toString(), "query",
                    "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath").redirectErrorStream(true).start();
                if (command.waitFor(5, java.util.concurrent.TimeUnit.SECONDS)) {
                    String result = new String(command.getInputStream().readNBytes(32_768), java.nio.charset.Charset.defaultCharset());
                    var match = Pattern.compile("(?im)^\\s*SteamPath[ \\t]+REG_SZ[ \\t]+([^\\r\\n]+)").matcher(result);
                    if (match.find()) roots.add(match.group(1).strip());
                } else command.destroyForcibly();
            } catch (IOException | InvalidPathException ignored) { /* Steam may use its standard location. */ }
            catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
        }
        for (String key : new String[]{"ProgramFiles(x86)", "ProgramFiles"}) {
            String home = System.getenv(key);
            if (home != null && Files.isDirectory(Path.of(home, "Steam"))) roots.add(Path.of(home, "Steam").toString());
        }
        return scan(roots);
    }

    public static JsonObject scan(JsonArray steamRoots) {
        var wallpapers = new ArrayList<JsonObject>();
        Set<String> seen = new HashSet<>();
        boolean installed = false;
        boolean workshopFound = false;
        int hidden = 0;
        for (JsonElement item : steamRoots) {
            Path steam;
            try { steam = Path.of(item.getAsString()); }
            catch (InvalidPathException ignored) { continue; }
            for (Path root : libraries(steam)) {
                installed |= Files.isDirectory(root.resolve("steamapps/common/wallpaper_engine"));
                Path workshop = root.resolve("steamapps/workshop/content/431960");
                if (!Files.isDirectory(workshop)) continue;
                workshopFound = true;
                try (var paths = Files.newDirectoryStream(workshop)) {
                    for (Path directory : paths) {
                        if (!Files.isDirectory(directory)
                                || !seen.add(directory.toString().replace('/', '\\').toLowerCase(Locale.ROOT))) continue;
                        JsonObject entry = wallpaper(directory);
                        if (entry == null) continue;
                        if ("video".equals(text(entry, "kind", ""))) wallpapers.add(entry);
                        else hidden++;
                    }
                } catch (IOException | java.nio.file.DirectoryIteratorException ignored) {
                    // Continue scanning the other Steam libraries.
                }
            }
        }
        wallpapers.sort(Comparator.comparing(row -> text(row, "title", "").toLowerCase(Locale.ROOT)));
        var visible = new JsonArray();
        wallpapers.stream().limit(300).forEach(visible::add);
        var result = new JsonObject();
        result.addProperty("installed", installed || workshopFound);
        result.addProperty("workshopFound", workshopFound);
        result.addProperty("hidden", hidden);
        result.add("wallpapers", visible);
        return result;
    }

    private static Set<Path> libraries(Path steam) {
        Set<Path> roots = new LinkedHashSet<>();
        roots.add(steam);
        try {
            var fields = LIBRARY.matcher(Files.readString(steam.resolve("steamapps/libraryfolders.vdf")));
            while (fields.find()) {
                try {
                    Path path = Path.of(fields.group(1).replace("\\\\", "\\"));
                    if (Files.isDirectory(path)) roots.add(path);
                } catch (InvalidPathException ignored) {
                    // Ignore invalid Steam entries.
                }
            }
        } catch (IOException ignored) {
            // Steam itself remains a possible library.
        }
        return roots;
    }

    private static JsonObject wallpaper(Path directory) {
        try {
            JsonElement project = JsonFiles.read(directory.resolve("project.json"));
            if (!project.isJsonObject()) return null;
            var info = project.getAsJsonObject();
            String kind = text(info, "type", "scene").toLowerCase(Locale.ROOT);
            String id = directory.getFileName().toString();
            String title = text(info, "title", "").strip();
            Path preview = null;
            for (String candidate : new String[] {"preview.jpg", "preview.gif", "preview.png", "preview.jpeg"}) {
                if (Files.isRegularFile(directory.resolve(candidate))) {
                    preview = directory.resolve(candidate);
                    break;
                }
            }
            Path video = null;
            if (kind.equals("video")) {
                Path named = directory.resolve(text(info, "file", "")).normalize();
                if (named.startsWith(directory.normalize()) && usable(named)) video = named;
                else {
                    try (var entries = Files.list(directory)) {
                        video = entries.filter(WallpaperLibrary::usable).findFirst().orElse(null);
                    }
                }
                if (video == null) return null;
            }
            var result = new JsonObject();
            result.addProperty("id", id);
            result.addProperty("title", title.isEmpty() ? id : title);
            result.addProperty("kind", kind);
            result.addProperty("preview", preview == null ? null : preview.toString());
            result.addProperty("video", video == null ? null : video.toString());
            result.addProperty("dir", directory.toString());
            return result;
        } catch (IOException | JsonParseException | InvalidPathException ignored) {
            return null;
        }
    }

    private static boolean usable(Path path) {
        String name = path.getFileName().toString().toLowerCase(Locale.ROOT);
        if ((!name.endsWith(".mp4") && !name.endsWith(".webm")) || !Files.isRegularFile(path)) return false;
        try {
            return Files.size(path) > 0;
        } catch (IOException ignored) {
            return false;
        }
    }
}
