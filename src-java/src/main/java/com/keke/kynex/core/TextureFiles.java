package com.keke.kynex.core;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.Locale;
import javax.imageio.ImageIO;
import javax.imageio.stream.MemoryCacheImageInputStream;

public final class TextureFiles {
    private static final String PREFIX = "data:image/png;base64,";
    private TextureFiles() {}

    public static String exportSkin(String texture, Path path) throws IOException {
        byte[] bytes = png(texture, false);
        if (bytes.length > 5 * 1024 * 1024) throw new IOException("皮肤文件超过 5 MB");
        if (!path.isAbsolute()) throw new IOException("请选择有效的保存位置");
        if (path.getFileName() == null || !path.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".png")) {
            throw new IOException("请将皮肤保存为 .png 文件");
        }
        try {
            Files.write(path, bytes);
        } catch (IOException error) {
            throw new IOException("无法保存皮肤：" + error.getMessage(), error);
        }
        return path.toString();
    }

    public static byte[] png(String texture, boolean cape) throws IOException {
        if (!texture.startsWith(PREFIX)) throw new IOException("请选择 PNG 图片");
        String encoded = texture.substring(PREFIX.length());
        if (encoded.length() > 7 * 1024 * 1024) throw new IOException("图片文件过大");
        byte[] bytes;
        try {
            if (encoded.length() % 4 != 0) throw new IllegalArgumentException();
            bytes = Base64.getDecoder().decode(encoded);
        } catch (IllegalArgumentException invalid) {
            throw new IOException("图片编码无效", invalid);
        }
        int width;
        int height;
        try (var input = new MemoryCacheImageInputStream(new ByteArrayInputStream(bytes))) {
            var readers = ImageIO.getImageReaders(input);
            if (!readers.hasNext()) throw new IOException("PNG 图片无效");
            var reader = readers.next();
            try {
                if (!reader.getFormatName().equalsIgnoreCase("png")) throw new IOException("PNG 图片无效");
                reader.setInput(input, true, true);
                width = reader.getWidth(0);
                height = reader.getHeight(0);
            } finally {
                reader.dispose();
            }
        } catch (IOException | RuntimeException invalid) {
            throw new IOException("PNG 图片无效", invalid);
        }
        if (width < 64 || width > 1024 || width % 64 != 0 || Integer.bitCount(width / 64) != 1
                || (height != width / 2 && (cape || height != width))) {
            throw new IOException("图片尺寸不符合 Minecraft 皮肤或披风布局");
        }
        return bytes;
    }
}
