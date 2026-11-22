package com.keke.kynex.core;

import com.sun.jna.Native;
import com.sun.jna.Pointer;
import com.sun.jna.Structure;
import com.sun.jna.WString;
import com.sun.jna.ptr.IntByReference;
import com.sun.jna.win32.StdCallLibrary;
import org.eclipse.swt.SWT;
import org.eclipse.swt.widgets.Shell;

/** Gives WebView2's transparent pixels a composited surface behind them. */
final class DesktopWindowSurface {
    private static final int ENABLE_BLUR = 1;
    private static final int SPECIFY_BLUR_REGION = 2;
    private static final int NON_CLIENT_RENDERING_POLICY = 2;
    private static final int DISABLE_NON_CLIENT_RENDERING = 1;

    private DesktopWindowSurface() {}

    static void prepareBrowser() {
        // WebView2 reads this before its controller paints the first frame.
        Kernel.API.SetEnvironmentVariableW(new WString("WEBVIEW2_DEFAULT_BACKGROUND_COLOR"), new WString("00000000"));
    }

    static void prepare(Shell shell) {
        shell.setBackground(shell.getDisplay().getSystemColor(SWT.COLOR_BLACK));
        var window = new Pointer(shell.handle);
        // An empty blur region opts into per-pixel composition without adding glass.
        Pointer region = Graphics.API.CreateRectRgn(0, 0, -1, -1);
        if (region == null) return;
        try {
            var options = new BlurBehind();
            options.flags = ENABLE_BLUR | SPECIFY_BLUR_REGION;
            options.enabled = 1;
            options.region = region;
            Compositor.API.DwmSetWindowAttribute(window, NON_CLIENT_RENDERING_POLICY,
                new IntByReference(DISABLE_NON_CLIENT_RENDERING), Integer.BYTES);
            Compositor.API.DwmEnableBlurBehindWindow(window, options);
        } finally {
            Graphics.API.DeleteObject(region);
        }
    }

    public interface Kernel extends StdCallLibrary {
        Kernel API = Native.load("kernel32", Kernel.class);
        boolean SetEnvironmentVariableW(WString name, WString value);
    }

    public interface Graphics extends StdCallLibrary {
        Graphics API = Native.load("gdi32", Graphics.class);
        Pointer CreateRectRgn(int left, int top, int right, int bottom);
        boolean DeleteObject(Pointer region);
    }

    public interface Compositor extends StdCallLibrary {
        Compositor API = Native.load("dwmapi", Compositor.class);
        int DwmSetWindowAttribute(Pointer window, int attribute, IntByReference value, int size);
        int DwmEnableBlurBehindWindow(Pointer window, BlurBehind options);
    }

    @Structure.FieldOrder({"flags", "enabled", "region", "transitionOnMaximized"})
    public static final class BlurBehind extends Structure {
        public int flags;
        public int enabled;
        public Pointer region;
        public int transitionOnMaximized;
    }
}
