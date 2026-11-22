package com.keke.kynex.core;

import com.sun.jna.Native;
import com.sun.jna.Pointer;
import com.sun.jna.WString;
import com.sun.jna.ptr.IntByReference;
import com.sun.jna.ptr.PointerByReference;
import com.sun.jna.win32.StdCallLibrary;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import org.eclipse.swt.widgets.Shell;

import static com.keke.kynex.core.WindowsCom.guid;

final class WindowsShell {
    private static final String NAME = "Kynex Launcher";
    private static final String EXECUTABLE = ProcessHandle.current().info().command().orElse("");

    private WindowsShell() {}

    static void identify() { ShellApi.API.SetCurrentProcessExplicitAppUserModelID(new WString("com.keke.kynex")); }

    static String iconPath() { return EXECUTABLE; }

    static String name() { return NAME; }

    static void applyIcon(Shell shell) {
        if (EXECUTABLE.isEmpty()) return;
        var large = new PointerByReference();
        var small = new PointerByReference();
        if (ShellApi.API.ExtractIconExW(new WString(EXECUTABLE), 0, large, small, 1) != 1) return;
        var window = new Pointer(shell.handle);
        UserApi.API.SendMessageW(window, 0x0080, Pointer.createConstant(1), large.getValue()); // WM_SETICON / ICON_BIG
        UserApi.API.SendMessageW(window, 0x0080, null, small.getValue()); // WM_SETICON / ICON_SMALL
        shell.addDisposeListener(event -> {
            if (large.getValue() != null) UserApi.API.DestroyIcon(large.getValue());
            if (small.getValue() != null && !small.getValue().equals(large.getValue())) UserApi.API.DestroyIcon(small.getValue());
        });
    }

    static boolean recycle(Path path) {
        var item = new PointerByReference();
        try (var apartment = WindowsCom.initialize(2)) {
            if (apartment == null) return false;
            try (var operation = WindowsCom.create(guid("3ad05575-8857-4850-9277-11b85bdb8e09"),
                    guid("947aab5f-0a5c-4c13-b4d6-4bf7836fc9f8"))) {
                if (operation == null || ShellApi.API.SHCreateItemFromParsingName(new WString(path.toString()), null,
                        guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), item) < 0) return false;
                try (var target = new WindowsCom.Reference(item.getValue())) {
                    var cancelled = new IntByReference();
                    // Flags: recycle the item, suppress Shell UI, and allow undo.
                    return operation.call(5, 0x00080000 | 0x0400 | 0x0010 | 0x0040 | 0x0004) >= 0
                        && operation.call(18, target.address(), null) >= 0
                        && operation.call(21) >= 0 && operation.call(22, cancelled) >= 0
                        && cancelled.getValue() == 0 && Files.notExists(path, LinkOption.NOFOLLOW_LINKS);
                }
            }
        }
    }

    interface ShellApi extends StdCallLibrary {
        ShellApi API = Native.load("shell32", ShellApi.class);
        int SetCurrentProcessExplicitAppUserModelID(WString id);
        int ExtractIconExW(WString executable, int index, PointerByReference large, PointerByReference small, int count);
        int SHCreateItemFromParsingName(WString path, Pointer context, Pointer iid, PointerByReference item);
    }

    interface UserApi extends StdCallLibrary {
        UserApi API = Native.load("user32", UserApi.class);
        Pointer SendMessageW(Pointer window, int message, Pointer parameter, Pointer data);
        boolean DestroyIcon(Pointer icon);
    }
}
