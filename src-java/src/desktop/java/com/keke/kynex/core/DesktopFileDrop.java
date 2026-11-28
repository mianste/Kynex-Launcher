package com.keke.kynex.core;

import com.google.gson.JsonObject;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.util.List;
import java.util.function.BiConsumer;
import org.eclipse.swt.browser.Browser;
import org.eclipse.swt.dnd.DND;
import org.eclipse.swt.dnd.DropTarget;
import org.eclipse.swt.dnd.DropTargetAdapter;
import org.eclipse.swt.dnd.DropTargetEvent;
import org.eclipse.swt.dnd.FileTransfer;

import static com.keke.kynex.core.WorkshopPlans.json;

final class DesktopFileDrop {
    private DesktopFileDrop() {}

    static void attach(Browser browser, BiConsumer<String, JsonObject> send) {
        var target = new DropTarget(browser, DND.DROP_COPY);
        var file = FileTransfer.getInstance();
        target.setTransfer(file);
        target.addDropListener(new DropTargetAdapter() {
            private boolean active;

            @Override public void dragEnter(DropTargetEvent event) {
                active = accept(event);
                if (active) send.accept("tauri://drag-enter", json("paths", List.of(), "position", position(event)));
            }

            @Override public void dragOperationChanged(DropTargetEvent event) { accept(event); }

            @Override public void dragOver(DropTargetEvent event) {
                if (active && accept(event)) send.accept("tauri://drag-over", json("position", position(event)));
            }

            @Override public void dragLeave(DropTargetEvent event) {
                if (active) send.accept("tauri://drag-leave", new JsonObject());
                active = false;
            }

            @Override public void dropAccept(DropTargetEvent event) { accept(event); }

            @Override public void drop(DropTargetEvent event) {
                active = false;
                if (event.detail == DND.DROP_NONE || !(event.data instanceof String[] paths) || paths.length > 200) {
                    event.detail = DND.DROP_NONE;
                    return;
                }
                try {
                    var validated = java.util.Arrays.stream(paths).map(Path::of).filter(Path::isAbsolute).map(Path::toString).toList();
                    if (!validated.isEmpty()) send.accept("tauri://drag-drop", json("paths", validated, "position", position(event)));
                } catch (InvalidPathException invalid) { event.detail = DND.DROP_NONE; }
            }

            private boolean accept(DropTargetEvent event) {
                var data = event.currentDataType;
                boolean valid = data != null && file.isSupportedType(data) && (event.operations & DND.DROP_COPY) != 0;
                event.detail = valid ? DND.DROP_COPY : DND.DROP_NONE;
                return valid;
            }

            private JsonObject position(DropTargetEvent event) {
                var point = browser.toControl(event.x, event.y);
                // Tauri drag positions use physical pixels; React divides by
                // devicePixelRatio, which includes both Windows DPI and WebView zoom.
                double dpi = browser.getMonitor().getZoom() / 100.0;
                return json("x", point.x * dpi, "y", point.y * dpi);
            }
        });
    }
}
