package com.keke.kynex.core;

import com.sun.jna.Pointer;
import com.sun.jna.ptr.DoubleByReference;
import java.lang.reflect.Field;
import org.eclipse.swt.SWT;
import org.eclipse.swt.browser.Browser;
import org.eclipse.swt.browser.ProgressAdapter;
import org.eclipse.swt.browser.ProgressEvent;
import org.eclipse.swt.graphics.Rectangle;
import org.eclipse.swt.internal.ole.win32.ICoreWebView2Settings;
import org.eclipse.swt.internal.ole.win32.IUnknown;
import org.eclipse.swt.widgets.Shell;

/** Keeps the desktop composition when a laptop's usable screen is smaller.
 * WebView zoom also scales viewport units, media queries, portals and hit testing.
 */
final class DesktopViewport {
    static final int WIDTH = 1080;
    static final int HEIGHT = 720;
    private static final String CSS_SCALE = "kynex.viewport.cssScale";

    private DesktopViewport() {}

    static Rectangle initialBounds(Rectangle workArea) {
        double scale = Math.min(1, Math.min(Math.max(1, workArea.width - 32) / (double) WIDTH,
            Math.max(1, workArea.height - 32) / (double) HEIGHT));
        int width = Math.max(1, (int) Math.floor(WIDTH * scale));
        int height = Math.max(1, (int) Math.floor(HEIGHT * scale));
        return new Rectangle(workArea.x + (workArea.width - width) / 2,
            workArea.y + (workArea.height - height) / 2, width, height);
    }

    static double zoom(double current, double width, double height) {
        if (!Double.isFinite(current) || current <= 0 || !Double.isFinite(width) || width <= 0
            || !Double.isFinite(height) || height <= 0) throw new IllegalArgumentException("界面尺寸无效");
        return current * Math.min(width / WIDTH, height / HEIGHT);
    }

    static double cssScale(Shell shell) {
        Object scale = shell.getData(CSS_SCALE);
        return scale instanceof Double value ? value : 1;
    }

    static Rectangle nativeBounds(Rectangle css, double scale) {
        return new Rectangle((int) Math.round(css.x * scale), (int) Math.round(css.y * scale),
            (int) Math.round(css.width * scale), (int) Math.round(css.height * scale));
    }

    static void attach(Browser browser) {
        // SWT 3.131 exposes neither ZoomFactor nor its controller publicly.
        // Borrow its controller on the UI thread; SWT retains COM ownership.
        Runnable adjust = () -> {
            if (browser.isDisposed()) return;
            try {
                Object edge = field(Browser.class, "webBrowser").get(browser);
                var controller = (IUnknown) field(edge.getClass(), "controller").get(edge);
                if (controller == null || controller.getAddress() == 0) return;
                var settings = (ICoreWebView2Settings) field(edge.getClass(), "settings").get(edge);
                if (settings != null && settings.put_IsZoomControlEnabled(false) < 0)
                    throw new IllegalStateException("无法锁定启动器显示比例");
                var reference = new WindowsCom.Reference(new Pointer(controller.getAddress()));
                var current = new DoubleByReference();
                // ICoreWebView2Controller: get_ZoomFactor = 7, put_ZoomFactor = 8.
                if (reference.call(7, current) < 0) throw new IllegalStateException("无法读取界面显示比例");
                Object[] viewport = (Object[]) browser.evaluate("return [window.innerWidth, window.innerHeight]");
                double width = ((Number) viewport[0]).doubleValue(), height = ((Number) viewport[1]).doubleValue();
                if (width <= 0 || height <= 0) return;
                double next = zoom(current.getValue(), width, height);
                boolean changed = Math.abs(next / current.getValue() - 1) > 0.002;
                if (changed && reference.call(8, next) < 0)
                    throw new IllegalStateException("无法调整界面显示比例");
                browser.getShell().setData(CSS_SCALE, browser.getClientArea().width / width
                    * (changed ? next / current.getValue() : 1));
            } catch (ReflectiveOperationException error) {
                throw new IllegalStateException("当前桌面组件不支持统一界面比例", error);
            }
        };
        // Wait for SWT to update WebView bounds and leave native event callbacks.
        Runnable schedule = () -> browser.getDisplay().timerExec(32, adjust);
        browser.addListener(SWT.Resize, event -> schedule.run());
        browser.addProgressListener(new ProgressAdapter() {
            @Override public void completed(ProgressEvent event) { schedule.run(); }
        });
    }

    private static Field field(Class<?> type, String name) throws NoSuchFieldException {
        Field value = type.getDeclaredField(name);
        value.setAccessible(true);
        return value;
    }
}
