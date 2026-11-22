package com.keke.kynex.core;

import com.keke.kynex.account.CredentialVault;
import com.sun.jna.Memory;
import com.sun.jna.Native;
import com.sun.jna.Pointer;
import com.sun.jna.Structure;
import com.sun.jna.WString;
import com.sun.jna.ptr.PointerByReference;
import com.sun.jna.win32.StdCallLibrary;
import java.io.IOException;

/** Reads and writes only this launcher's entries in the current user's Credential Manager. */
final class WindowsCredentials implements CredentialVault.Store {
    private static final int GENERIC = 1;
    private static final int ENTERPRISE = 3;
    private static final int NOT_FOUND = 1168;
    private final String service;

    WindowsCredentials() { this("Kynex Launcher"); }

    WindowsCredentials(String service) { this.service = service; }

    public interface CredentialsApi extends StdCallLibrary {
        boolean CredReadW(WString target, int type, int flags, PointerByReference result);
        boolean CredWriteW(Credential entry, int flags);
        boolean CredDeleteW(WString target, int type, int flags);
        void CredFree(Pointer memory);
    }

    @Structure.FieldOrder({"flags", "type", "targetName", "comment", "lastWrittenLow", "lastWrittenHigh",
        "blobSize", "blob", "persist", "attributeCount", "attributes", "targetAlias", "userName"})
    public static final class Credential extends Structure {
        public int flags;
        public int type;
        public WString targetName;
        public WString comment;
        public int lastWrittenLow;
        public int lastWrittenHigh;
        public int blobSize;
        public Pointer blob;
        public int persist;
        public int attributeCount;
        public Pointer attributes;
        public WString targetAlias;
        public WString userName;

        public Credential() {}
        Credential(Pointer pointer) {
            super(pointer);
            read();
        }
    }

    private static final class Library {
        private static final CredentialsApi API = Native.load("Advapi32", CredentialsApi.class);
    }

    @Override public byte[] read(String name) throws IOException {
        var reference = new PointerByReference();
        var api = Library.API;
        if (!api.CredReadW(target(name), GENERIC, 0, reference)) {
            int error = Native.getLastError();
            if (error == NOT_FOUND) return null;
            throw error(error);
        }
        Pointer memory = reference.getValue();
        try {
            var entry = new Credential(memory);
            if (entry.blobSize < 0 || entry.blobSize > 2560 || entry.blob == null) {
                throw new IOException("账号凭据长度无效");
            }
            return entry.blob.getByteArray(0, entry.blobSize);
        } finally {
            api.CredFree(memory);
        }
    }

    @Override public void write(String name, byte[] value) throws IOException {
        if (value.length == 0 || value.length > 2560) throw new IOException("账号凭据长度无效");
        try (var buffer = new Memory(value.length)) {
            buffer.write(0, value, 0, value.length);
            try {
                var entry = new Credential();
                entry.type = GENERIC;
                entry.targetName = target(name);
                entry.userName = new WString(name);
                entry.comment = new WString("Kynex Launcher");
                entry.blobSize = value.length;
                entry.blob = buffer;
                entry.persist = ENTERPRISE;
                if (!Library.API.CredWriteW(entry, 0)) throw error(Native.getLastError());
            } finally {
                buffer.clear();
            }
        }
    }

    @Override public void remove(String name) throws IOException {
        if (!Library.API.CredDeleteW(target(name), GENERIC, 0)) {
            int error = Native.getLastError();
            if (error != NOT_FOUND) throw error(error);
        }
    }

    private WString target(String name) throws IOException {
        boolean regular = name.matches("[A-Za-z0-9:_-]{1,250}");
        boolean settings = name.matches("(?:deepseek|ai-providers|ai-voice):[A-Za-z]:[\\\\/][^\\p{Cntrl}]{1,950}");
        if (!regular && !settings) throw new IOException("账号凭据标识无效");
        return new WString(name + "." + service);
    }

    private static IOException error(int code) { return new IOException("Windows 凭据库操作失败（错误 " + code + "）"); }
}
