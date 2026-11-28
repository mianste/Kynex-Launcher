package com.keke.kynex.core;

import org.eclipse.swt.graphics.Rectangle;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class DesktopViewportTest {
    @Test void desktopKeepsItsOriginalWindowSize() {
        assertEquals(new Rectangle(420, 160, 1080, 720),
            DesktopViewport.initialBounds(new Rectangle(0, 0, 1920, 1040)));
    }

    @Test void scaledLaptopWorkAreasKeepTheDesktopAspectAndStayOnScreen() {
        for (var area : new Rectangle[] {new Rectangle(0, 0, 1366, 728),
            new Rectangle(0, 0, 1093, 574), new Rectangle(0, 0, 911, 472),
            new Rectangle(-1280, 80, 1280, 680), new Rectangle(0, 0, 683, 344)}) {
            var window = DesktopViewport.initialBounds(area);
            assertTrue(window.x >= area.x && window.y >= area.y);
            assertTrue(window.x + window.width <= area.x + area.width);
            assertTrue(window.y + window.height <= area.y + area.height);
            assertEquals(1.5, window.width / (double) window.height, 0.006);
            double factor = DesktopViewport.zoom(1, window.width, window.height);
            assertTrue(window.width / factor >= 1080 - 1e-9);
            assertTrue(window.height / factor >= 720 - 1e-9);
        }
    }

    @Test void zoomUsesTheActualViewportIncludingWindowsDpiAndExistingZoom() {
        assertEquals(1, DesktopViewport.zoom(1, 1080, 720));
        assertEquals(0.75, DesktopViewport.zoom(1, 810, 540));
        assertEquals(0.75, DesktopViewport.zoom(0.6, 1350, 900));
        assertEquals(0.5, DesktopViewport.zoom(1, 540, 360));
        assertThrows(IllegalArgumentException.class, () -> DesktopViewport.zoom(1, 0, 720));
        assertThrows(IllegalArgumentException.class, () -> DesktopViewport.zoom(Double.NaN, 1080, 720));
    }

    @Test void nativeLoginSurfaceStaysAlignedWithItsScaledPageSlot() {
        var slot = new Rectangle(180, 120, 600, 400);
        assertEquals(slot, DesktopViewport.nativeBounds(slot, 1));
        assertEquals(new Rectangle(135, 90, 450, 300), DesktopViewport.nativeBounds(slot, 0.75));
        assertEquals(new Rectangle(90, 60, 300, 200), DesktopViewport.nativeBounds(slot, 0.5));
    }
}
