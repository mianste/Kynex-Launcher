package com.keke.kynex.core;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DesktopUpdatesTest {
    @Test void unattendedUpdatesRequireTheVersionSignedWithTheInstaller() {
        assertTrue(DesktopUpdates.signedVersionMatches("timestamp:1\tfile:Setup.exe\tversion:2.1.0", "v2.1.0"));
        assertFalse(DesktopUpdates.signedVersionMatches("file:Setup.exe\tversion:2.0.0", "2.1.0"));
        assertFalse(DesktopUpdates.signedVersionMatches("file:Setup.exe", "2.1.0"));
        assertFalse(DesktopUpdates.signedVersionMatches("version:2.1.0\tversion:2.0.0", "2.1.0"));
    }
}
