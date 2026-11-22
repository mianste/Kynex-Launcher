package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;

import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.is;
import static com.keke.kynex.core.LaunchManifest.object;
import static com.keke.kynex.core.WorkshopPlans.json;

final class WorkshopExport {
    private static final Pattern SECRET = Pattern.compile("(?i)(?:password|access[_-]?token|refresh[_-]?token|api[_-]?key)[\\s\"':=]+[^\\s\",;}]+");
    private WorkshopExport() {}

    static JsonObject request(String instance, JsonObject args) {
        var groups = new ArrayList<>(List.of("options", "mods", "shaderpacks"));
        if (!is(args.get("includeConfig"), false)) groups.add("config");
        if (!is(args.get("includeLocalization"), false)) groups.add("resourcepacks");
        return json("id", instance, "format", "mrpack", "bundleResources", false, "selectionVersion", 1, "include", groups);
    }

    static JsonObject run(Path root, Path dataRoot, Path instance, String task, JsonObject args, PackExport exporter,
                          MinecraftInstaller.Progress progress) throws IOException {
        Path target = GameFiles.target(root, "exports/" + task + ".mrpack");
        Path source = Files.createTempFile(target.getParent(), ".kxl-workshop-base-", ".mrpack");
        Path finalStage = null;
        var skipped = new JsonArray();
        try {
            finalStage = Files.createTempFile(target.getParent(), ".kxl-workshop-export-", ".mrpack");
            var config = LocalGameFiles.configuration(instance);
            var request = request(instance.getFileName().toString(), args);
            request.addProperty("path", source.toString());
            exporter.export(root, dataRoot, request, progress);
            try (var zip = new ZipFile(source.toFile()); var output = new ZipOutputStream(Files.newOutputStream(finalStage))) {
                if (zip.size() > 30_000) throw new IOException("导出文件数量超过限制");
                for (var original : zip.stream().toList()) {
                    GameDownloads.check(progress::stopped);
                    String name = original.getName();
                    if (original.isDirectory()) continue;
                    if (!publicPath(name) || original.getSize() > WorkshopPlans.LIMIT) {
                        skipped.add(name);
                        continue;
                    }
                    try (var contents = zip.getInputStream(original)) {
                        if (name.startsWith("overrides/config/")) {
                            if (original.getSize() > 4 * 1024 * 1024) { skipped.add(name); continue; }
                            byte[] bytes = contents.readNBytes(4 * 1024 * 1024 + 1);
                            if (bytes.length > 4 * 1024 * 1024 || SECRET.matcher(new String(bytes, StandardCharsets.UTF_8)).find()) {
                                skipped.add(name);
                                continue;
                            }
                            output.putNextEntry(new ZipEntry(name));
                            output.write(bytes);
                        } else {
                            output.putNextEntry(new ZipEntry(name));
                            byte[] buffer = new byte[64 * 1024];
                            for (int size; (size = contents.read(buffer)) >= 0;) {
                                GameDownloads.check(progress::stopped);
                                output.write(buffer, 0, size);
                            }
                        }
                        output.closeEntry();
                    }
                }
                addNotes(output, instance, config, args);
            }
            try (var zip = new ZipFile(finalStage.toFile())) {
                if (zip.getEntry("modrinth.index.json") == null) throw new IOException("导出缺少整合包清单");
            }
            progress.save(finalStage, target);
            return json("exported", true, "file", target.getFileName().toString(), "location", "当前游戏目录 exports/",
                "skippedSensitiveFiles", skipped, "bytes", Files.size(target));
        } finally {
            Files.deleteIfExists(source);
            if (finalStage != null) Files.deleteIfExists(finalStage);
        }
    }

    private static void addNotes(ZipOutputStream output, Path instance, JsonObject config, JsonObject args) throws IOException {
        String name = AssistantService.redact(text(config, "name", "整合包"), "");
        if (!is(args.get("includeReadme"), false)) entry(output, "README.md", "# " + name + "\n\nMinecraft " + required(config, "version") + " / "
            + required(config, "loader") + "\n\n由 Kynex Launcher 整合包工坊导出。\n");
        if (!is(args.get("includeModList"), false)) {
            Path lock = GameFiles.target(instance, "installed-projects.json");
            var rows = new StringBuilder("<!doctype html><meta charset=\"utf-8\"><title>模组清单</title><h1>模组清单</h1><ul>");
            if (Files.isRegularFile(lock)) for (var row : object(JsonFiles.read(lock)).entrySet()) {
                String label = AssistantService.redact(text(object(row.getValue()), "name", text(object(row.getValue()), "file", row.getKey())), "");
                rows.append("<li>").append(escape(label)).append("</li>");
            }
            entry(output, "modlist.html", rows.append("</ul>").toString());
        }
        if (!is(args.get("includeLicense"), false)) entry(output, "THIRD-PARTY-NOTICES",
            "模组、资源包和光影的版权属于各自作者。请遵守各项目的发行许可证、署名与分发限制。\n");
    }

    private static boolean publicPath(String file) {
        String name = file.toLowerCase(Locale.ROOT);
        return !name.startsWith("/") && !name.contains("\\") && !name.contains(":") && !name.contains("credential")
            && !name.contains("accounts.json") && !name.endsWith(".kxl-agent-backup")
            && List.of(name.split("/")).stream().noneMatch(List.of(".", "..", "logs", "crash-reports", "saves")::contains);
    }

    private static void entry(ZipOutputStream output, String name, String value) throws IOException {
        output.putNextEntry(new ZipEntry(name));
        output.write(value.getBytes(StandardCharsets.UTF_8));
        output.closeEntry();
    }

    private static String escape(String value) {
        return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }
}
