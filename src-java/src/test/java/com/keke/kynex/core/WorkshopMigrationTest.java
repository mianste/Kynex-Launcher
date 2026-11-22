package com.keke.kynex.core;

import com.google.gson.JsonObject;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import static com.keke.kynex.core.LaunchManifest.object;
import static com.keke.kynex.core.WorkshopPlans.json;
import static org.junit.jupiter.api.Assertions.*;

class WorkshopMigrationTest {
    @TempDir Path root;

    @Test void legacyPlanUsesSameFieldsAndZipAndProtectsSnapshotContents() throws Exception {
        var plan = WorkshopPlans.parse(json("version", 1, "name", "示例 Minecraft 包", "minecraft", "1.20.1",
            "loader", json("type", "vanilla", "version", ""), "memoryMb", 4096));
        assertEquals(plan, WorkshopPlans.decode(WorkshopPlans.share(plan)));
        String legacy = "{\"version\":1,\"name\":\"示例 Minecraft 包\",\"minecraft\":\"1.20.1\",\"loader\":{\"type\":\"vanilla\",\"version\":\"\"},"
            + "\"memoryMb\":4096,\"java\":\"auto\",\"mods\":[],\"resourcePacks\":[],\"shaders\":[],\"localization\":{\"mode\":\"none\",\"note\":\"\"},"
            + "\"options\":{},\"configPatches\":[],\"notes\":[],\"estimatedDownloadBytes\":0,\"warnings\":[]}";
        assertEquals(ResourceHashes.hash(legacy), WorkshopPlans.hash(plan));
        var id = UUID.randomUUID().toString();
        Path game = root.resolve("game");
        Path data = Files.createDirectory(root.resolve("data"));
        Path instance = Files.createDirectories(game.resolve("instances").resolve(id));
        Path saves = Files.createDirectories(instance.resolve("saves"));
        Path config = Files.createDirectories(instance.resolve("config"));
        Path saved = Files.writeString(saves.resolve("world"), "keep");
        Path original = Files.writeString(config.resolve("game.toml"), "value = 1");
        String snapshot = WorkshopSnapshots.capture(game, data, id);
        Files.writeString(original, "value = 2");
        assertNotNull(WorkshopSnapshots.restore(game, data, id, snapshot));
        assertEquals("value = 1", Files.readString(original));
        assertEquals("keep", Files.readString(saved));
        Files.writeString(data.resolve("snapshots").resolve(id).resolve(snapshot).resolve("config/game.toml"), "tampered");
        assertThrows(IOException.class, () -> WorkshopSnapshots.restore(game, data, id, snapshot));
        assertEquals("value = 1", Files.readString(original));
    }

    @Test void attachedExistingInstanceRequiresConfirmedPlanAndPreservesModIdentity() throws Exception {
        Path data = root.toRealPath();
        String id = UUID.randomUUID().toString();
        Path instance = Files.createDirectories(data.resolve("instances").resolve(id));
        Files.writeString(Files.createDirectory(instance.resolve("mods")).resolve("example.jar"), "fake metadata only");
        JsonFiles.write(instance.resolve("kxl.json"), json("id", id, "name", "测试实例", "version", "1.20.1",
            "loader", "fabric", "loaderVersion", "0.16.9", "settings", json("isolation", "all")));
        JsonFiles.write(instance.resolve("installed-projects.json"), json("cf-312", json("file", "example.jar", "version", 656)));
        var downloads = new GameDownloads();
        var network = new CatalogNetwork();
        var resources = new ResourceCatalog(network);
        var events = new ArrayList<JsonObject>();
        var workshops = new WorkshopTasks(data, new GameDirectories(data), downloads, new MinecraftInstaller(downloads), new MinecraftCatalog(downloads),
            new LoaderCatalog(downloads), resources, new ResourceVersions(network, resources), new ProjectInstaller(downloads, network, resources),
            new PackExport(network), null, network, new WorkshopInsights(data, null),
            new PackInstaller(downloads, network, resources, new MinecraftInstaller(downloads)));
        var verification = (WorkshopTasks.Verification) (request, progress) -> fail("Maintenance confirmation must not launch a game");
        var attached = object(workshops.dispatch("agent_attach", json("directoryId", "default", "id", id), Runnable::run, Runnable::run,
            events::add, verification, false));
        var task = object(attached.get("task"));
        assertEquals("awaiting_approval", task.get("status").getAsString());
        assertEquals("312", task.getAsJsonObject("plan").getAsJsonArray("mods").get(0).getAsJsonObject().get("projectId").getAsString());
        assertTrue(task.getAsJsonObject("plan").getAsJsonArray("mods").get(0).getAsJsonObject().get("required").getAsBoolean());
        var confirm = json("taskId", attached.get("taskId"), "planHash", "tampered");
        assertThrows(IOException.class, () -> workshops.dispatch("agent_confirm", confirm, Runnable::run, Runnable::run, events::add, verification, false));
        confirm.add("planHash", task.get("planHash"));
        var result = object(workshops.dispatch("agent_confirm", confirm, Runnable::run, Runnable::run, events::add, verification, false));
        assertEquals("done", result.getAsJsonObject("task").get("status").getAsString());
        assertThrows(IOException.class, () -> workshops.dispatch("agent_tool", json("taskId", attached.get("taskId"), "tool", "shell"),
            Runnable::run, Runnable::run, events::add, verification, false));
        JsonObject blocked = object(workshops.dispatch("agent_start", json("request", "Minecraft 读取账号密码"), Runnable::run, Runnable::run,
            events::add, verification, false));
        assertTrue(blocked.get("rejected").getAsBoolean());
    }

    @Test void downloadBudgetAppliesAcrossConcurrentFilesAndLeavesExistingCacheReadable() throws Exception {
        byte[] bytes = {1, 2, 3, 4};
        var downloads = new GameDownloads(uri -> new ByteArrayInputStream(bytes));
        Path first = root.resolve("first"), second = root.resolve("second");
        try (var budget = GameDownloads.limitTransfers(0, 4); var workers = Executors.newVirtualThreadPerTaskExecutor()) {
            workers.submit(() -> {
                downloads.file("https://cdn.modrinth.com/first", false, first, "", 20, () -> false);
                return null;
            }).get();
            var error = workers.submit(() -> assertThrows(IOException.class,
                () -> downloads.file("https://cdn.modrinth.com/second", false, second, "", 20, () -> false))).get();
            assertTrue(error.getMessage().contains("下载预算"));
            assertEquals(4, budget.consumed());
            assertArrayEquals(bytes, Files.readAllBytes(first));
            assertFalse(Files.exists(second));
        }
    }

    @Test void repairBoundsRetryAndDeclaresMissingEvidence() throws Exception {
        var issues = new ArrayList<WorkshopRepair.Issue>();
        var report = WorkshopRepair.run(() -> {
            if (issues.size() < 2) throw new IOException("java.lang.OutOfMemoryError");
        }, issue -> { issues.add(issue); return "增加内存"; });
        assertTrue(report.contains("游戏启动验证通过"));
        assertEquals(List.of(WorkshopRepair.Issue.MEMORY, WorkshopRepair.Issue.MEMORY), issues);
        assertEquals(WorkshopRepair.Issue.MISSING_DEPENDENCY, WorkshopRepair.classify("Missing dependency"));
    }

    @Test void translatedLanguagesRetainFormattingAndTheOriginalResourcePackOrder() throws Exception {
        var originals = java.util.Map.of("key", "Count %1$s\n§aReady");
        assertEquals("数量 %1$s\n§a就绪", WorkshopTranslation.valid(originals, json("key", "数量 %1$s\n§a就绪"), false).get("key"));
        assertTrue(WorkshopTranslation.valid(originals, json("key", "数量 %s"), false).isEmpty());
        Path options = Files.writeString(root.resolve("options.txt"), "lang:zh_cn\r\nresourcePacks:[\"vanilla\",\"mod_assets\",\"file/CFPA-x.zip\"]\r\n");
        JsonFiles.write(root.resolve("kxl.json"), json("version", "1.20.1"));
        WorkshopLocalization.setPack(root, "KXL-AI-Localization", true);
        assertTrue(Files.readString(options).contains("[\"vanilla\",\"mod_assets\",\"file/KXL-AI-Localization\",\"file/CFPA-x.zip\"]"));
        WorkshopLocalization.setPack(root, "KXL-AI-Localization", false);
        assertEquals("lang:zh_cn\r\nresourcePacks:[\"vanilla\",\"mod_assets\",\"file/CFPA-x.zip\"]\r\n", Files.readString(options));
    }

    @Test void packUpdateMergesOnlyManagedFilesWithoutOverwritingThePlayersChanges() throws Exception {
        Path live = Files.createDirectory(root.resolve("live")).toRealPath();
        Path stage = Files.createDirectory(root.resolve("incoming")).toRealPath();
        Files.writeString(GameFiles.target(live, "mods/old.jar"), "old");
        Files.writeString(GameFiles.target(live, "config/user.json"), "original");
        var baseline = WorkshopPackUpdate.inventory(live);
        Files.writeString(GameFiles.target(live, "config/user.json"), "user changes");
        Files.writeString(GameFiles.target(live, "mods/keep.jar"), "locally added");
        Files.writeString(GameFiles.target(live, "saves/world/level.dat"), "world bytes");
        Files.writeString(GameFiles.target(stage, "mods/new.jar"), "new");
        Files.writeString(GameFiles.target(stage, "config/user.json"), "pack default");
        var next = WorkshopPackUpdate.inventory(stage);
        var merged = WorkshopPackUpdate.merge(live, stage, baseline, next, new MinecraftInstaller.Progress() {});
        assertFalse(Files.exists(GameFiles.target(live, "mods/old.jar")));
        assertEquals("new", Files.readString(GameFiles.target(live, "mods/new.jar")));
        assertEquals("locally added", Files.readString(GameFiles.target(live, "mods/keep.jar")));
        assertEquals("user changes", Files.readString(GameFiles.target(live, "config/user.json")));
        assertEquals("world bytes", Files.readString(GameFiles.target(live, "saves/world/level.dat")));
        assertEquals(List.of("config/user.json"), merged.preserved());
    }

    @Test void serverDoesNotAcceptTheEulaOrUnrestrictedJavaArguments() throws Exception {
        String id = UUID.randomUUID().toString();
        Path server = Files.createDirectories(root.resolve("server").resolve(id)).toRealPath();
        Files.writeString(server.resolve("eula.txt"), "eula=false\n");
        Files.writeString(server.resolve("server.jar"), "fixture");
        var downloads = new GameDownloads();
        var launcher = new WorkshopServer(downloads, new MinecraftCatalog(downloads));
        assertThrows(IOException.class, () -> launcher.verify(root.toRealPath(), id, "instance", false, new MinecraftInstaller.Progress() {}));
        assertEquals("eula=false\n", Files.readString(server.resolve("eula.txt")));
        WorkshopServer.validate(server, List.of("-jar", "server.jar"), "");
        assertThrows(IOException.class, () -> WorkshopServer.validate(server, List.of("-jar", "../evil.jar"), ""));
        assertThrows(IOException.class, () -> WorkshopServer.validate(server, List.of("-javaagent:evil.jar"), ""));
    }

    @Test void originalMinecraftBlockEntityModelsRetainTextureAndDirection() {
        var chest = SchematicSpecialBlocks.resolve("minecraft:chest", java.util.Map.of("type", "left", "facing", "east"));
        assertEquals("minecraft:entity/chest/normal_left", chest.texture());
        assertEquals(90, chest.y());
        assertFalse(chest.elements().get(0).getAsJsonObject().getAsJsonObject("faces").has("east"));
        var bed = SchematicSpecialBlocks.resolve("minecraft:red_bed", java.util.Map.of("facing", "south", "part", "head"));
        assertEquals(180, bed.y());
        assertEquals("minecraft:entity/bed/red", bed.texture());
        assertEquals(90, SchematicSpecialBlocks.resolve("minecraft:purple_shulker_box", java.util.Map.of("facing", "west")).x());
        assertEquals("minecraft:entity/signs/hanging/oak",
            SchematicSpecialBlocks.resolve("minecraft:oak_hanging_sign", java.util.Map.of()).texture());
    }
}
