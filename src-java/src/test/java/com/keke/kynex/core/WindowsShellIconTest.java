package com.keke.kynex.core;

import com.sun.jna.Pointer;
import java.nio.file.Path;
import org.eclipse.swt.SWT;
import org.eclipse.swt.widgets.Display;
import org.eclipse.swt.widgets.Shell;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledOnOs;
import org.junit.jupiter.api.condition.OS;

import static org.junit.jupiter.api.Assertions.assertNotNull;

@EnabledOnOs(OS.WINDOWS)
class WindowsShellIconTest {
    @Test void suppliesBothWindowIconsForTheBorderlessLauncher() {
        var display = new Display();
        try {
            var shell = new Shell(display, SWT.NO_TRIM);
            var icon = Path.of("..", "installer", "assets", "icon.ico").toAbsolutePath().normalize();
            WindowsShell.applyIcon(shell, icon.toString());

            var window = new Pointer(shell.handle);
            var user32 = WindowsShell.UserApi.API;
            assertNotNull(user32.SendMessageW(window, 0x007f, null, null), "small caption icon");
            assertNotNull(user32.SendMessageW(window, 0x007f, Pointer.createConstant(1), null), "large window icon");
        } finally {
            display.dispose();
        }
    }
}
