package com.keke.kynex.core;

import com.google.gson.JsonObject;
import java.io.IOException;
import java.nio.file.Path;
import java.util.UUID;
import java.util.function.Consumer;

final class DesktopInstallTask implements MinecraftInstaller.Progress {
    private final String id = UUID.randomUUID().toString();
    private final String action;
    private final JsonObject request;
    private final Consumer<JsonObject> publishEvent;
    private volatile boolean cancelled;
    private boolean committed;

    DesktopInstallTask(String action, JsonObject request, Consumer<JsonObject> publishEvent) {
        this.action = action;
        this.request = request;
        this.publishEvent = publishEvent;
    }

    String id() { return id; }

    synchronized boolean cancel() {
        if (committed) return false;
        cancelled = true;
        return true;
    }

    @Override public boolean stopped() { return cancelled; }

    @Override public synchronized void publish(Path staging, Path destination) throws IOException {
        MinecraftInstaller.Progress.super.publish(staging, destination);
        committed = true;
    }

    @Override public synchronized void save(Path staging, Path destination) throws IOException {
        MinecraftInstaller.Progress.super.save(staging, destination);
        committed = true;
    }

    @Override public synchronized void commit(MinecraftInstaller.Publication publication) throws IOException {
        MinecraftInstaller.Progress.super.commit(publication);
        committed = true;
    }

    @Override public void update(String stage, int done, int total) {
        publishEvent.accept(event(stage, done, total));
    }

    void finish(String displayName, String error) {
        boolean launch = action.equals("launch");
        boolean download = action.equals("download_resource_file");
        boolean exporting = action.equals("export_pack");
        String stage = error == null ? (launch ? "游戏进程已启动" : download ? "下载完成" : exporting ? "导出完成" : "安装完成")
            : cancelled ? "已取消" : (launch ? "启动失败" : download ? "下载失败" : exporting ? "导出失败" : "安装失败");
        JsonObject event = event(stage, 1, 1);
        event.addProperty("finished", true);
        if (error != null) {
            if (!cancelled) event.addProperty("error", error);
        } else if (!launch) {
            var completion = new JsonObject();
            completion.addProperty("title", stage);
            completion.addProperty("detail", displayName);
            event.add("completion", completion);
        }
        publishEvent.accept(event);
    }

    private JsonObject event(String stage, int done, int total) {
        var event = new JsonObject();
        event.addProperty("taskId", id);
        String defaultName = switch (action) {
            case "install_java" -> "Java " + request.get("major");
            case "launch" -> "启动游戏";
            case "download_resource_file" -> "资源文件";
            case "install_map" -> "地图";
            case "export_pack" -> "导出整合包";
            case "update_mods" -> "更新模组";
            default -> "安装 Minecraft";
        };
        event.addProperty("name", JsonFiles.text(request, "name", defaultName));
        event.addProperty("action", action);
        event.addProperty("stage", stage);
        event.addProperty("done", done);
        event.addProperty("total", total);
        if (request.has("directoryId")) event.add("directoryId", request.get("directoryId"));
        event.add("payload", request);
        return event;
    }
}
