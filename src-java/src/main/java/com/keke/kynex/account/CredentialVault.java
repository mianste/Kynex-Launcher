package com.keke.kynex.account;

import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.keke.kynex.core.JsonFiles;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.UUID;

public final class CredentialVault {
    private static final byte[] PREFIX = "KXL-VAULT-2\n".getBytes(StandardCharsets.UTF_8);
    private static final int CHUNK = 2048;
    private static final int MAX_BYTES = 128 * 1024;
    private final Store store;
    private record Manifest(String generation, int count, int size, String hash) {}

    public interface Store {
        byte[] read(String entry) throws IOException;
        void write(String entry, byte[] value) throws IOException;
        void remove(String entry) throws IOException;
    }

    public CredentialVault(Store store) { this.store = store; }

    public synchronized void save(String id, JsonObject secret) throws IOException {
        byte[] data = secret.toString().getBytes(StandardCharsets.UTF_8);
        try {
            if (data.length > MAX_BYTES) throw new IOException("登录凭据超过安全存储上限");
            byte[] original = store.read(id);
            Manifest old;
            try { old = manifest(original); }
            finally { if (original != null) Arrays.fill(original, (byte) 0); }
            var item = new Manifest(UUID.randomUUID().toString(), divide(data.length), data.length, hash(data));
            try {
                for (int i = 0; i < item.count(); i++) {
                    byte[] part = Arrays.copyOfRange(data, i * CHUNK, Math.min(data.length, (i + 1) * CHUNK));
                    try { store.write(piece(id, item, i), part); }
                    finally { Arrays.fill(part, (byte) 0); }
                }
                byte[] index = ("KXL-VAULT-2\n" + JsonFiles.JSON.toJson(item)).getBytes(StandardCharsets.UTF_8);
                store.write(id, index);
            } catch (IOException rejected) {
                clean(id, item);
                throw rejected;
            }
            if (old != null) clean(id, old);
        } finally {
            Arrays.fill(data, (byte) 0);
        }
    }

    public synchronized JsonObject load(String id) throws IOException {
        byte[] head = store.read(id);
        if (head == null) throw new IOException("无法读取登录凭据，请重新登录");
        try {
            Manifest entry = manifest(head);
            if (entry == null) {
                try { return parse(head, StandardCharsets.UTF_8); }
                catch (IOException legacy) { return parse(head, StandardCharsets.UTF_16LE); }
            }
            byte[] data = new byte[entry.size()];
            try {
                int offset = 0;
                for (int i = 0; i < entry.count(); i++) {
                    byte[] part = store.read(piece(id, entry, i));
                    if (part == null) throw new IOException("账号凭据缺失，请重新登录");
                    try {
                        if (part.length != Math.min(CHUNK, data.length - offset)) throw new IOException("账号凭据长度无效");
                        System.arraycopy(part, 0, data, offset, part.length);
                        offset += part.length;
                    } finally {
                        Arrays.fill(part, (byte) 0);
                    }
                }
                if (!hash(data).equals(entry.hash())) throw new IOException("账号凭据校验失败，请重新登录");
                return parse(data, StandardCharsets.UTF_8);
            } finally {
                Arrays.fill(data, (byte) 0);
            }
        } finally {
            Arrays.fill(head, (byte) 0);
        }
    }

    public synchronized void remove(String id) throws IOException {
        byte[] root = store.read(id);
        if (root == null) return;
        try {
            Manifest entry = manifest(root);
            store.remove(id);
            if (entry != null) clean(id, entry);
        } finally {
            Arrays.fill(root, (byte) 0);
        }
    }

    private void clean(String id, Manifest entry) {
        for (int i = 0; i < entry.count(); i++) {
            try { store.remove(piece(id, entry, i)); }
            catch (IOException ignored) { /* Credential cleanup must not replace the original result. */ }
        }
    }

    private static int divide(int size) { return (size + CHUNK - 1) / CHUNK; }

    private static String piece(String id, Manifest entry, int i) { return id + ":" + entry.generation() + ":" + i; }

    private static Manifest manifest(byte[] bytes) throws IOException {
        if (bytes == null || bytes.length < PREFIX.length || !Arrays.equals(bytes, 0, PREFIX.length, PREFIX, 0, PREFIX.length)) {
            return null;
        }
        try {
            var entry = JsonFiles.JSON.fromJson(new String(bytes, PREFIX.length, bytes.length - PREFIX.length,
                StandardCharsets.UTF_8), Manifest.class);
            if (entry == null || entry.generation() == null || !entry.generation().equals(UUID.fromString(entry.generation()).toString())
                || entry.size() < 1 || entry.size() > MAX_BYTES || entry.count() != divide(entry.size())
                || entry.hash() == null || !entry.hash().matches("[a-f0-9]{64}")) throw new IOException("账号凭据索引无效");
            return entry;
        } catch (JsonParseException | IllegalArgumentException invalid) {
            throw new IOException("账号凭据索引损坏", invalid);
        }
    }

    private static JsonObject parse(byte[] value, java.nio.charset.Charset charset) throws IOException {
        try {
            JsonObject data = JsonFiles.JSON.fromJson(new String(value, charset), JsonObject.class);
            if (data != null) return data;
        } catch (JsonParseException ignored) { /* Do not include credential contents in exceptions. */ }
        throw new IOException("无法读取登录凭据，请重新登录");
    }

    private static String hash(byte[] value) throws IOException {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value)); }
        catch (NoSuchAlgorithmException missing) { throw new IOException("无法验证登录凭据", missing); }
    }
}
