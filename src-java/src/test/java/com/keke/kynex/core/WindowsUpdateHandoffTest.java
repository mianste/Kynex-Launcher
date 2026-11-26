package com.keke.kynex.core;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Base64;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class WindowsUpdateHandoffTest {
    @Test void handoffKeepsTheFailureMarkerNextToTheLauncherData() {
        Path failure = Path.of("C:/Users/me/AppData/Roaming/Kynex Launcher/launcher-updates/last-install-failure.txt");
        var process = WindowsUpdateHandoff.process(Path.of("C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"),
            Path.of("C:/Temp/verified-1/Kynex Launcher Update.exe"), Path.of("C:/Apps/Kynex Launcher.exe"),
            "v2.0.2", WindowsUpdateHandoff.INSTALL_KEY, failure);
        assertEquals(failure.toString(), process.environment().get("KYNEX_UPDATE_FAILURE"));
        assertEquals("2.0.2", process.environment().get("KYNEX_UPDATE_VERSION"));
        var command = process.command();
        int encoded = command.indexOf("-EncodedCommand");
        assertTrue(encoded >= 0 && encoded + 1 < command.size());
        String script = new String(Base64.getDecoder().decode(command.get(encoded + 1)), StandardCharsets.UTF_16LE);
        assertTrue(script.contains("$failure = $env:KYNEX_UPDATE_FAILURE"));
        assertTrue(script.contains("-ArgumentList '/S'"));
    }
}
