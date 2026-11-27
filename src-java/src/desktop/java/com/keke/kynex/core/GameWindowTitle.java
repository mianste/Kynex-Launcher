package com.keke.kynex.core;

import com.sun.jna.Native;
import com.sun.jna.Pointer;
import com.sun.jna.WString;
import com.sun.jna.ptr.IntByReference;
import com.sun.jna.ptr.PointerByReference;
import com.sun.jna.win32.StdCallLibrary;

/** Maintains the title of windows owned by this launch, including recreated fullscreen windows. */
final class GameWindowTitle {
    private GameWindowTitle() {}

    static void watch(Process process, String title) {
        if (title.isBlank() || !System.getProperty("os.name").startsWith("Windows")) return;
        Thread.ofPlatform().name("kynex-game-title-" + process.pid()).daemon().start(() -> {
            try {
                while (process.isAlive()) {
                    apply(process.pid(), title);
                    Thread.sleep(750);
                }
            } catch (InterruptedException stopped) {
                Thread.currentThread().interrupt();
            } catch (RuntimeException | LinkageError unavailable) {
                // Title customization must not prevent launching or monitoring the game.
                System.err.println("无法设置游戏窗口标题：" + unavailable.getMessage());
            }
        });
    }

    static int apply(long processId, String title) {
        int[] changed = {0};
        User32.API.EnumWindows((window, ignored) -> {
            var owner = new IntByReference();
            User32.API.GetWindowThreadProcessId(window, owner);
            if (Integer.toUnsignedLong(owner.getValue()) != processId || !User32.API.IsWindowVisible(window)
                || User32.API.GetWindow(window, 4) != null) return true;
            char[] text = new char[1024];
            User32.API.GetWindowTextW(window, text, text.length);
            if (title.equals(Native.toString(text))) return true;
            // A hung game must not stall launch detection. Never broadcast to other processes.
            Pointer sent = User32.API.SendMessageTimeoutW(window, 0x000C, Pointer.NULL, new WString(title),
                0x0002 | 0x0020, 250, new PointerByReference());
            if (sent != null) changed[0]++;
            return true;
        }, Pointer.NULL);
        return changed[0];
    }

    public interface User32 extends StdCallLibrary {
        User32 API = Native.load("user32", User32.class);
        interface WindowCallback extends StdCallCallback { boolean invoke(Pointer window, Pointer context); }
        boolean EnumWindows(WindowCallback callback, Pointer context);
        int GetWindowThreadProcessId(Pointer window, IntByReference processId);
        boolean IsWindowVisible(Pointer window);
        Pointer GetWindow(Pointer window, int command);
        int GetWindowTextW(Pointer window, char[] title, int length);
        Pointer SendMessageTimeoutW(Pointer window, int message, Pointer wParam, WString text,
                                   int flags, int timeout, PointerByReference result);
    }
}
