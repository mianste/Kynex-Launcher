package com.keke.kynex.core;

import java.io.BufferedInputStream;
import java.io.ByteArrayInputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.zip.GZIPInputStream;
import java.util.zip.InflaterInputStream;

final class NbtReader {
    private static final int LIMIT = 128 * 1024 * 1024;
    private final DataInputStream input;
    private int tags;

    private NbtReader(byte[] data) {
        input = new DataInputStream(new ByteArrayInputStream(data));
    }

    static Map<String, Object> open(Path file) throws IOException {
        try (var source = new BufferedInputStream(Files.newInputStream(file))) {
            source.mark(2);
            int first = source.read();
            int second = source.read();
            source.reset();
            InputStream compressed = first == 0x1f && second == 0x8b ? new GZIPInputStream(source)
                : first == 0x78 ? new InflaterInputStream(source) : source;
            try (compressed) {
                byte[] data = compressed.readNBytes(LIMIT + 1);
                if (data.length > LIMIT) throw new IOException("投影解压后超过 128 MB");
                var reader = new NbtReader(data);
                if (reader.input.readUnsignedByte() != 10) throw new IOException("投影文件不是有效的 NBT 结构");
                reader.string();
                return reader.compound(1);
            }
        }
    }

    private Map<String, Object> compound(int depth) throws IOException {
        var values = new LinkedHashMap<String, Object>();
        for (int tag; (tag = input.readUnsignedByte()) != 0;) {
            String name = string();
            if (values.putIfAbsent(name, value(tag, depth + 1)) != null) throw new IOException("投影中的 NBT 字段重复");
        }
        return values;
    }

    private Object value(int tag, int depth) throws IOException {
        if (depth > 64 || ++tags > 2_000_000) throw new IOException("投影 NBT 层级或数据项过多");
        return switch (tag) {
            case 1 -> input.readByte();
            case 2 -> input.readShort();
            case 3 -> input.readInt();
            case 4 -> input.readLong();
            case 5 -> input.readFloat();
            case 6 -> input.readDouble();
            case 7 -> input.readNBytes(length(1));
            case 8 -> string();
            case 9 -> {
                int element = input.readUnsignedByte();
                int size = length(1);
                if (element < 1 && size > 0 || element > 12 || size > 2_000_000 - tags) throw new IOException("投影 NBT 列表长度无效");
                var values = new ArrayList<Object>(Math.min(size, 65536));
                for (int i = 0; i < size; i++) values.add(value(element, depth + 1));
                yield values;
            }
            case 10 -> compound(depth);
            case 11 -> {
                int[] values = new int[length(4)];
                for (int i = 0; i < values.length; i++) values[i] = input.readInt();
                yield values;
            }
            case 12 -> {
                long[] values = new long[length(8)];
                for (int i = 0; i < values.length; i++) values[i] = input.readLong();
                yield values;
            }
            default -> throw new IOException("投影含有未知 NBT 类型");
        };
    }

    private int length(int bytes) throws IOException {
        int count = input.readInt();
        if (count < 0 || (long) count * bytes > input.available()) throw new IOException("投影 NBT 数据长度无效");
        return count;
    }

    private String string() throws IOException {
        int size = input.readUnsignedShort();
        if (size > input.available()) throw new IOException("投影 NBT 字符串不完整");
        byte[] value = input.readNBytes(size);
        var encoded = java.nio.ByteBuffer.allocate(size + 2).putShort((short) size).put(value).array();
        try (var text = new DataInputStream(new ByteArrayInputStream(encoded))) { return text.readUTF(); }
        catch (java.io.UTFDataFormatException utf8) {
            return StandardCharsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(value)).toString();
        }
    }
}
