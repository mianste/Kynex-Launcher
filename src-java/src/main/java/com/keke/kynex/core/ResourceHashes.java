package com.keke.kynex.core;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

final class ResourceHashes {
    private static final int MIX = 0x5bd1e995;
    private static final long LIMIT = 128L * 1024 * 1024;
    record Value(String sha1, long fingerprint) {}
    private ResourceHashes() {}

    static Value read(Path file) throws IOException {
        long max = Files.size(file);
        if (max > LIMIT) throw new IOException("资源文件超过指纹计算限制");
        var digest = digest("SHA-1");
        byte[] buffer = new byte[64 * 1024];
        int length = 0;
        try (var input = Files.newInputStream(file)) {
            long size = 0;
            for (int read; (read = input.read(buffer)) >= 0;) {
                size += read;
                if (size > max) throw new IOException("资源文件在读取期间发生变化");
                digest.update(buffer, 0, read);
                for (int i = 0; i < read; i++) if (!ignored(buffer[i])) length++;
            }
            if (size != max) throw new IOException("资源文件在读取期间发生变化");
        }
        String sha = HexFormat.of().formatHex(digest.digest());
        var fingerprint = new Fingerprint(length);
        try (var input = Files.newInputStream(file)) {
            long size = 0;
            for (int read; (read = input.read(buffer)) >= 0;) {
                size += read;
                if (size > max) throw new IOException("资源文件在读取期间发生变化");
                digest.update(buffer, 0, read);
                for (int i = 0; i < read; i++) if (!ignored(buffer[i])) fingerprint.push(buffer[i]);
            }
            if (!sha.equals(HexFormat.of().formatHex(digest.digest()))) throw new IOException("资源文件在读取期间发生变化");
        }
        return new Value(sha, fingerprint.end());
    }

    private static final class Fingerprint {
        private int hash, remaining, word;
        Fingerprint(int length) { hash = 1 ^ length; }
        void push(byte value) {
            word |= (value & 255) << (remaining++ * 8);
            if (remaining != 4) return;
            int mixed = word * MIX;
            mixed ^= mixed >>> 24;
            hash = hash * MIX ^ mixed * MIX;
            remaining = word = 0;
        }
        long end() {
            if (remaining != 0) hash = (hash ^ word) * MIX;
            hash ^= hash >>> 13;
            hash *= MIX;
            return Integer.toUnsignedLong(hash ^ hash >>> 15);
        }
    }

    private static boolean ignored(byte b) { return b == 9 || b == 10 || b == 13 || b == 32; }

    static MessageDigest digest(String algorithm) {
        try { return MessageDigest.getInstance(algorithm); }
        catch (NoSuchAlgorithmException unsupported) { throw new IllegalStateException(unsupported); }
    }

    static String hash(String value) {
        return HexFormat.of().formatHex(digest("SHA-256").digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
    }
}
