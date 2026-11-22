package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import org.eclipse.swt.SWT;
import org.eclipse.swt.widgets.DirectoryDialog;
import org.eclipse.swt.widgets.FileDialog;
import org.eclipse.swt.widgets.Shell;

import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.array;
import static com.keke.kynex.core.LaunchManifest.is;
import static com.keke.kynex.core.LaunchManifest.object;

final class DesktopDialogs {
    private DesktopDialogs() {}

    static JsonElement choose(Shell shell, String command, JsonObject options) {
        String initial = text(options, "defaultPath", "");
        Path path = initial.isBlank() ? null : Path.of(initial);
        String title = text(options, "title", "");
        if ("plugin:dialog|open".equals(command) && is(options.get("directory"), true)) {
            var dialog = new DirectoryDialog(shell);
            if (!title.isEmpty()) dialog.setText(title);
            if (path != null && Files.isDirectory(path)) dialog.setFilterPath(path.toString());
            return selection(dialog.open());
        }
        boolean save = "plugin:dialog|save".equals(command);
        boolean multiple = !save && is(options.get("multiple"), true);
        var dialog = new FileDialog(shell, (save ? SWT.SAVE : SWT.OPEN) | (multiple ? SWT.MULTI : SWT.NONE));
        if (!title.isEmpty()) dialog.setText(title);
        if (save) dialog.setOverwrite(true);
        if (path != null) {
            if (Files.isDirectory(path)) {
                dialog.setFilterPath(path.toString());
            } else if (path.getFileName() != null) {
                dialog.setFileName(path.getFileName().toString());
                if (path.getParent() != null) dialog.setFilterPath(path.getParent().toString());
            }
        }
        var names = new ArrayList<String>();
        var filters = new ArrayList<String>();
        for (JsonElement element : array(options.get("filters"))) {
            JsonObject filter = object(element);
            var extensions = new ArrayList<String>();
            for (JsonElement extension : array(filter.get("extensions"))) {
                if (!extension.isJsonPrimitive() || !extension.getAsJsonPrimitive().isString()) continue;
                String name = extension.getAsString();
                if (name.matches("[A-Za-z0-9_-]+")) extensions.add("*." + name);
                else if (name.equals("*")) extensions.add("*.*");
            }
            if (extensions.isEmpty()) continue;
            names.add(text(filter, "name", ""));
            filters.add(String.join(";", extensions));
        }
        if (!filters.isEmpty()) {
            dialog.setFilterNames(names.toArray(String[]::new));
            dialog.setFilterExtensions(filters.toArray(String[]::new));
        }
        String result = dialog.open();
        if (!multiple || result == null) return selection(result);
        var paths = new JsonArray();
        for (String name : dialog.getFileNames()) paths.add(Path.of(dialog.getFilterPath()).resolve(name).toString());
        return paths;
    }

    private static JsonElement selection(String path) {
        return path == null ? JsonNull.INSTANCE : new JsonPrimitive(path);
    }
}
