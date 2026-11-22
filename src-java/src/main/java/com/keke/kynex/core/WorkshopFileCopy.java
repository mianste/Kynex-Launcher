package com.keke.kynex.core;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

final class WorkshopFileCopy {
    private static final long CONFIG_LIMIT = 2 * 1024 * 1024;
    private static final Pattern SECRET = Pattern.compile("(?i)(?:password|access[_-]?token|refresh[_-]?token|api[_-]?key)[\\s\"':=]+[^\\s\",;}]+");
    private static final List<String> CONFIG = List.of("config", "defaultconfigs");

    private WorkshopFileCopy() {}

    static List<String> configs(Path from, Path to, MinecraftInstaller.Progress progress) throws IOException {
        var skipped = new ArrayList<String>();
        long total = 0;
        for (String name : CONFIG) for (Path source : files(from, name)) {
            GameDownloads.check(progress::stopped);
            String relative = relative(from, source);
            String lower = relative.toLowerCase(Locale.ROOT);
            if (List.of("account", "credential", "token", "password").stream().anyMatch(lower::contains)
                || !List.of(".json", ".toml", ".properties", ".cfg").stream().anyMatch(lower::endsWith) || Files.size(source) > CONFIG_LIMIT) {
                skipped.add(relative);
                continue;
            }
            String contents;
            try { contents = Files.readString(source); }
            catch (java.nio.charset.CharacterCodingException binary) { skipped.add(relative); continue; }
            if (SECRET.matcher(contents).find() || !AssistantService.redact(contents, "").equals(contents)) {
                skipped.add(relative);
                continue;
            }
            if (lower.endsWith(".json")) try {
                JsonFiles.JSON.fromJson(contents, com.google.gson.JsonElement.class);
            } catch (com.google.gson.JsonParseException invalid) { skipped.add(relative); continue; }
            total += Files.size(source);
            if (total > WorkshopPlans.LIMIT) throw new IOException("配置文件复制超过预算");
            Files.copy(source, GameFiles.target(to, relative));
        }
        return skipped;
    }

    static void tree(Path from, Path to, String subdir, long maximum, MinecraftInstaller.Progress progress) throws IOException {
        long bytes = 0;
        for (Path source : files(from, subdir)) {
            GameDownloads.check(progress::stopped);
            bytes += Files.size(source);
            if (bytes > maximum) throw new IOException("备份超过允许的大小");
            Files.copy(source, GameFiles.target(to, relative(from, source)));
        }
    }

    static List<Path> files(Path root, String relative) throws IOException {
        Path base = GameFiles.target(root, relative);
        if (!Files.exists(base, LinkOption.NOFOLLOW_LINKS)) return List.of();
        var result = new ArrayList<Path>();
        try (var walk = Files.walk(base, 64)) {
            for (var paths = walk.iterator(); paths.hasNext();) {
                Path file = paths.next();
                if (!file.equals(file.toRealPath())) throw new IOException("文件夹指向了其他位置");
                if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) continue;
                if (result.size() >= 20_000) throw new IOException("文件数量超过 20000");
                result.add(file);
            }
        }
        return result;
    }

    static String relative(Path root, Path file) { return root.relativize(file).toString().replace('\\', '/'); }
}
