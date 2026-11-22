package com.keke.kynex.core;

import java.io.IOException;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.Locale;
import java.util.Set;

final class GameFiles {
    private static final Set<String> RESERVED = Set.of("CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$");
    private GameFiles() {}

    static Path target(Path root, String name) throws IOException {
        if (name.isEmpty() || name.indexOf(':') >= 0 || name.indexOf('\\') >= 0) {
            throw new IOException("游戏资源路径无效");
        }
        Path relative = Path.of(name);
        if (relative.isAbsolute() || relative.getRoot() != null) throw new IOException("游戏资源路径无效");
        Path current = root.toRealPath();
        for (int i = 0; i < relative.getNameCount(); i++) {
            String part = relative.getName(i).toString();
            if (part.isEmpty() || part.equals(".") || part.equals("..") || part.endsWith(".") || part.endsWith(" ")) {
                throw new IOException("游戏资源路径无效");
            }
            String prefix = part.split("\\.", 2)[0].stripTrailing().toUpperCase(Locale.ROOT);
            if (RESERVED.contains(prefix) || prefix.matches("(COM|LPT)[1-9¹²³]")
                || part.codePoints().anyMatch(ch -> Character.isISOControl(ch) || "<>|\"?*".indexOf(ch) >= 0)) {
                throw new IOException("游戏资源路径含有保留名称或字符");
            }
            Path next = current.resolve(part);
            boolean parent = i + 1 < relative.getNameCount();
            if (parent && !Files.exists(next, LinkOption.NOFOLLOW_LINKS)) {
                try {
                    Files.createDirectory(next);
                } catch (FileAlreadyExistsException concurrent) {
                    // Another transfer may have created the same parent.
                }
            }
            if (Files.exists(next, LinkOption.NOFOLLOW_LINKS)
                && (Files.isSymbolicLink(next) || !next.toRealPath().equals(next))) {
                throw new IOException("游戏资源位置指向其他目录");
            }
            current = next;
        }
        return current;
    }

    static void removeStaging(Path staging) throws IOException {
        try (var paths = Files.walk(staging)) {
            for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(path);
        }
    }
}
