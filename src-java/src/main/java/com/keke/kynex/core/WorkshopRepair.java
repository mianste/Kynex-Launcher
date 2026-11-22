package com.keke.kynex.core;

import com.google.gson.JsonObject;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;

import static com.keke.kynex.core.LaunchManifest.array;
import static com.keke.kynex.core.LaunchManifest.is;
import static com.keke.kynex.core.LaunchManifest.object;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.WorkshopPlans.json;
import static com.keke.kynex.core.WorkshopPlans.number;

final class WorkshopRepair {
    private WorkshopRepair() {}

    enum Issue { MEMORY, JAVA, MISSING_DEPENDENCY, DUPLICATE, CORRUPT, GRAPHICS, OTHER }

    @FunctionalInterface
    interface Test { void run() throws IOException, InterruptedException; }

    @FunctionalInterface
    interface Repair { String apply(Issue issue) throws IOException, InterruptedException; }

    static Issue classify(String value) {
        String line = value == null ? "" : value.toLowerCase(Locale.ROOT);
        if (line.contains("outofmemoryerror") || line.contains("java heap space")) return Issue.MEMORY;
        if (line.contains("unsupportedclassversionerror") || line.contains("requires java")) return Issue.JAVA;
        if (line.contains("duplicate") && line.contains("mod")) return Issue.DUPLICATE;
        if (line.contains("requires") && line.contains("mod") || line.contains("missing depend")) return Issue.MISSING_DEPENDENCY;
        if (line.contains("zip end") || line.contains("invalid loc header") || line.contains("invalid or corrupt")) return Issue.CORRUPT;
        if (line.contains("glfw") || line.contains("opengl") && line.contains("failed")) return Issue.GRAPHICS;
        return Issue.OTHER;
    }

    static String run(Test launch, Repair repair) throws IOException, InterruptedException {
        var attempts = new ArrayList<String>();
        for (int step = 0; step < 4; step++) {
            try {
                launch.run();
                attempts.add("游戏启动验证通过");
                return String.join("\n", attempts);
            } catch (IOException error) {
                if (step == 3) throw new IOException("已达到 3 次修复上限。\n" + String.join("\n", attempts), error);
                attempts.add(repair.apply(classify(error.getMessage())));
            }
        }
        throw new IOException("修复未完成");
    }

    static String settings(Path instance, Issue issue, long initial) throws IOException {
        Path path = GameFiles.target(instance, "kxl.json");
        var config = object(JsonFiles.read(path));
        var settings = object(config.get("settings"));
        String changed;
        if (issue == Issue.JAVA) {
            if (text(settings, "java", "").isEmpty()) throw new IOException("此实例已使用自动匹配 Java，请核对游戏要求");
            settings.addProperty("java", "");
            changed = "已切换为自动匹配 Java";
        } else {
            long previous = number(settings, "memory", initial);
            long next = Math.clamp(previous + 2048, 512, 65_536);
            if (previous == next) throw new IOException("已达到内存设置上限");
            settings.addProperty("memory", next);
            changed = "内存从 " + previous + " MB 调整为 " + next + " MB";
        }
        config.add("settings", settings);
        JsonFiles.write(path, config);
        return changed;
    }

    static String duplicates(Path instance, com.google.gson.JsonArray rows) throws IOException {
        var seen = new HashSet<String>();
        var duplicates = new ArrayList<String>();
        for (var item : rows) {
            var row = object(item);
            if (!is(row.get("enabled"), true)) continue;
            boolean repeated = false;
            for (var mod : array(row.get("modIds"))) if (!seen.add(mod.getAsString())) repeated = true;
            String name = text(row, "name", "");
            if (repeated && name.endsWith(".jar")) duplicates.add(name);
        }
        if (duplicates.isEmpty() || duplicates.size() > 5) throw new IOException("请在模组列表核对重复文件");
        switchMods(instance, duplicates, List.of());
        return "已停用重复模组：" + String.join("、", duplicates);
    }

    static JsonObject diagnose(Path instance, String snapshot, Test launch, MinecraftInstaller.Progress progress, boolean bisect)
        throws IOException, InterruptedException {
        Path folder = GameFiles.target(instance, "mods");
        List<String> mods;
        if (Files.isDirectory(folder)) try (var files = Files.list(folder)) {
            mods = files.filter(path -> Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS))
                .map(path -> path.getFileName().toString()).filter(value -> value.endsWith(".jar")).sorted().limit(81).toList();
        } else mods = List.of();
        if (mods.size() > 80) throw new IOException("二分排查最多支持 80 个模组");
        for (String mod : mods) if (Files.exists(GameFiles.target(folder, mod + ".disabled"), LinkOption.NOFOLLOW_LINKS))
            throw new IOException("同名停用模组已存在，请先核对：" + mod);
        List<String> suspects = List.of();
        int tries = 1;
        try {
            switchMods(instance, mods, List.of());
            launch.run();
            if (bisect && !mods.isEmpty()) {
                suspects = mods;
                while (suspects.size() > 1 && tries < 8) {
                    GameDownloads.check(progress::stopped);
                    progress.update("启动排查", tries, 8);
                    int split = (suspects.size() + 1) / 2;
                    List<String> firstHalf = suspects.subList(0, split);
                    switchMods(instance, mods, firstHalf);
                    boolean passed;
                    try { launch.run(); passed = true; }
                    catch (IOException failure) {
                        GameDownloads.check(progress::stopped);
                        if (classify(failure.getMessage()) == Issue.MISSING_DEPENDENCY)
                            throw new IOException("该组缺少前置模组，请核对依赖后重新排查", failure);
                        if (!failure.getMessage().startsWith("游戏提前退出") && !failure.getMessage().startsWith("60 秒"))
                            throw failure;
                        passed = false;
                    }
                    tries++;
                    suspects = passed ? suspects.subList(split, suspects.size()) : firstHalf;
                }
            }
        } finally { switchMods(instance, mods, mods); }
        if (bisect && suspects.size() == 1) switchMods(instance, suspects, List.of());
        return bisect ? json("suspects", suspects, "attempts", tries, "snapshotId", snapshot,
            "evidence", "禁用所有模组后启动成功，疑似冲突范围由分组启动结果得出。")
            : json("safeModePassed", true, "restored", true, "snapshotId", snapshot);
    }

    private static void switchMods(Path instance, List<String> all, List<String> enabled) throws IOException {
        for (String filename : all) {
            Path source = GameFiles.target(instance, "mods/" + filename);
            Path disabled = GameFiles.target(instance, "mods/" + filename + ".disabled");
            boolean use = enabled.contains(filename);
            Path from = use ? disabled : source, to = use ? source : disabled;
            if (!Files.exists(from, LinkOption.NOFOLLOW_LINKS)) continue;
            if (!Files.isRegularFile(from, LinkOption.NOFOLLOW_LINKS) || Files.exists(to, LinkOption.NOFOLLOW_LINKS))
                throw new IOException("模组文件发生变动：" + filename);
            Files.move(from, to, StandardCopyOption.ATOMIC_MOVE);
        }
    }
}
