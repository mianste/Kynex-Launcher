package com.keke.kynex.core;

import com.sun.jna.Function;
import com.sun.jna.Memory;
import com.sun.jna.Native;
import com.sun.jna.Pointer;
import com.sun.jna.ptr.PointerByReference;
import com.sun.jna.win32.StdCallLibrary;
import java.util.UUID;

final class WindowsCom implements AutoCloseable {
    private WindowsCom() {}

    static WindowsCom initialize(int apartment) {
        return Ole.API.CoInitializeEx(null, apartment) >= 0 ? new WindowsCom() : null;
    }

    static Memory guid(String text) {
        var uuid = UUID.fromString(text);
        var value = new Memory(16);
        long high = uuid.getMostSignificantBits(), low = uuid.getLeastSignificantBits();
        value.setInt(0, (int) (high >>> 32));
        value.setShort(4, (short) (high >>> 16));
        value.setShort(6, (short) high);
        for (int i = 0; i < 8; i++) value.setByte(8L + i, (byte) (low >>> (56 - i * 8)));
        return value;
    }

    static Reference create(Memory cls, Memory iid) {
        var object = new PointerByReference();
        return Ole.API.CoCreateInstance(cls, null, 1, iid, object) >= 0 ? new Reference(object.getValue()) : null;
    }

    @Override public void close() { Ole.API.CoUninitialize(); }

    record Reference(Pointer address) implements AutoCloseable {
        int call(int slot, Object... arguments) {
            var args = new Object[arguments.length + 1];
            args[0] = address;
            System.arraycopy(arguments, 0, args, 1, arguments.length);
            Pointer vtable = address.getPointer(0);
            return Function.getFunction(vtable.getPointer((long) slot * Native.POINTER_SIZE), Function.ALT_CONVENTION)
                .invokeInt(args);
        }

        Reference get(int slot, Object... arguments) {
            var output = new PointerByReference();
            var args = java.util.Arrays.copyOf(arguments, arguments.length + 1);
            args[arguments.length] = output;
            return call(slot, args) >= 0 && output.getValue() != null ? new Reference(output.getValue()) : null;
        }

        @Override public void close() { call(2); }
    }

    interface Ole extends StdCallLibrary {
        Ole API = Native.load("ole32", Ole.class);
        int CoInitializeEx(Pointer reserved, int apartment);
        int CoCreateInstance(Pointer cls, Pointer outer, int context, Pointer iid, PointerByReference result);
        void CoUninitialize();
        void CoTaskMemFree(Pointer address);
    }
}
