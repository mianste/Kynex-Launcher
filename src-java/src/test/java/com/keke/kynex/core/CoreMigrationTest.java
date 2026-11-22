package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.HexFormat;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import static org.junit.jupiter.api.Assertions.*;

final class CoreMigrationTest {
    @Test
    void updatesLegacyLanguageInExistingYosbrFile(@TempDir Path root) throws Exception {
        Path options = Files.createDirectories(root.resolve("config/yosbr")).resolve("options.txt");
        Files.writeString(options, "lang:en_US\r\nfullscreen:true\r\n");
        assertEquals("zh_CN", GameOptions.applyLanguage(root, "1.10.2", "zh_cn"));
        assertEquals("lang:zh_CN\r\nfullscreen:true\r\n", Files.readString(options));
        assertFalse(Files.exists(root.resolve("options.txt")));
    }

    @Test
    void usesExistingMinecraftDirectoryAndKeepsSavesOnRemove(@TempDir Path root) throws Exception {
        Path folder = Files.createDirectories(root.resolve("整合包/.minecraft"));
        var directories = new GameDirectories(root.resolve("默认目录"));
        var request = new JsonObject();
        request.addProperty("path", folder.getParent().toString());
        request.addProperty("name", "整合包");
        var result = directories.change("add_game_directory", request);
        String id = result.get("activeId").getAsString();
        assertEquals(folder, Path.of(result.getAsJsonArray("items").get(1).getAsJsonObject().get("path").getAsString()));
        assertEquals(id, directories.change("add_game_directory", request).get("activeId").getAsString());

        Path save = Files.createDirectories(folder.resolve("saves/demo")).resolve("level.dat");
        Files.writeString(save, "existing save");
        request.addProperty("directoryId", id);
        assertEquals("default", directories.change("remove_game_directory", request).get("activeId").getAsString());
        assertEquals("existing save", Files.readString(save));
    }

    @Test
    void keepsExistingArtworkCacheKeysAndSkinBytes(@TempDir Path root) throws Exception {
        var image = new BufferedImage(64, 32, BufferedImage.TYPE_INT_ARGB);
        var buffer = new ByteArrayOutputStream();
        assertTrue(ImageIO.write(image, "png", buffer));
        byte[] bytes = buffer.toByteArray();
        String encoded = Base64.getEncoder().encodeToString(bytes);
        String url = "https://cdn.modrinth.com/data/icon.png";
        String key = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(url.getBytes(StandardCharsets.UTF_8)));
        Path cached = Files.createDirectories(root.resolve("cache/icons")).resolve(key + ".img");
        Files.write(cached, bytes);
        var artwork = new ArtworkCache(root);
        String texture = "data:image/png;base64," + encoded;
        assertEquals(texture, artwork.read(url).get("data").getAsString());
        assertEquals(texture, artwork.store(url, encoded).get("data").getAsString());
        assertArrayEquals(bytes, Files.readAllBytes(Path.of(TextureFiles.exportSkin(texture, root.resolve("玩家.png")))));
    }

    @Test
    void readsRssFromTheExistingNewsFeed() throws Exception {
        var reply = NewsArticles.rss("""
            <rss><channel><item><title>News &amp; Updates</title>
            <link>https://www.minecraft.net/en-us/article/test</link>
            <description><![CDATA[<p>新版本</p>]]></description>
            <enclosure url="https://www.minecraft.net/content/test.png" />
            </item></channel></rss>
            """);
        var article = reply.getAsJsonArray("articles").get(0).getAsJsonObject();
        assertEquals("News & Updates", article.get("title").getAsString());
        assertEquals("新版本", article.get("summary").getAsString());
        assertEquals("https://www.minecraft.net/content/test.png", article.get("image").getAsString());
    }

    @Test
    void readsWallpaperWorkshopAndInstanceLogs(@TempDir Path root) throws Exception {
        Path workshop = Files.createDirectories(root.resolve("steamapps/workshop/content/431960"));
        Path video = Files.createDirectory(workshop.resolve("100"));
        Files.writeString(video.resolve("project.json"), "{\"title\":\"视频壁纸\",\"type\":\"video\",\"file\":\"wall.mp4\"}");
        Files.write(video.resolve("wall.mp4"), new byte[] {1});
        Path scene = Files.createDirectory(workshop.resolve("101"));
        Files.writeString(scene.resolve("project.json"), "{\"type\":\"scene\"}");
        var roots = new JsonArray();
        roots.add(root.toString());
        var wallpapers = WallpaperLibrary.scan(roots);
        assertEquals(1, wallpapers.get("hidden").getAsInt());
        assertEquals(1, wallpapers.getAsJsonArray("wallpapers").size());

        Files.writeString(Files.createDirectory(root.resolve("logs")).resolve("latest.log"), "日志内容");
        Files.write(Files.createDirectory(root.resolve("mods")).resolve("sample.jar"), new byte[] {1});
        var instance = InstanceContext.read(root);
        assertEquals("日志内容", instance.getAsJsonArray("attachments").get(0).getAsJsonObject().get("text").getAsString());
        assertEquals(1, instance.getAsJsonObject("mods").get("count").getAsInt());
    }
}
