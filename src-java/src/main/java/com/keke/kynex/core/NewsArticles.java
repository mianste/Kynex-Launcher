package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.regex.Pattern;

import static com.keke.kynex.core.JsonFiles.text;

public final class NewsArticles {
    private static final Pattern ITEM = Pattern.compile("(?is)<item(?:\\s[^>]*)?>(.*?)</item\\s*>");
    private static final Pattern HTML = Pattern.compile("(?is)<[^>]+>");
    private static final Pattern WHITESPACE = Pattern.compile("\\s+", Pattern.UNICODE_CHARACTER_CLASS);
    private static final Pattern ENCLOSURE = Pattern.compile("(?i)<(?:media:content|enclosure)[^>]+url=[\"'](https://[^\"']+)[\"']");
    private static final Pattern IMAGE = Pattern.compile("(?i)<img[^>]+src=[\"'](https://[^\"']+)[\"']");
    private static final String IMAGE_BASE = "https://launchercontent.mojang.com";
    private static final String RSS = "https://www.minecraft.net/en-us/feeds/community-content/rss";
    private NewsArticles() {}

    static JsonObject list(Path root, GameDownloads source, boolean force) throws IOException {
        Path cache = GameFiles.target(root, "cache/minecraft-news.json");
        JsonObject previous = new JsonObject();
        if (Files.isRegularFile(cache)) {
            try {
                previous = LaunchManifest.object(JsonFiles.read(cache));
                if (!force && previous.get("articles") instanceof JsonArray
                    && Files.getLastModifiedTime(cache).toInstant().plus(Duration.ofMinutes(30)).isAfter(Instant.now())) {
                    previous.addProperty("cached", true);
                    return previous;
                }
            } catch (IOException | com.google.gson.JsonParseException ignored) { /* Fetch a fresh feed. */ }
        }
        JsonObject updated;
        try {
            updated = rss(source.textFile(RSS, 4 * 1024 * 1024));
        } catch (IOException official) {
            try {
                String raw = source.textFile(IMAGE_BASE + "/news.json", 4 * 1024 * 1024);
                updated = launcher(LaunchManifest.object(JsonFiles.JSON.fromJson(raw, JsonElement.class)));
                updated.addProperty("warning", "Minecraft.net 新闻暂时不可用");
            } catch (IOException | com.google.gson.JsonParseException backup) {
                if (!(previous.get("articles") instanceof JsonArray)) {
                    throw new IOException("Minecraft 官方新闻暂时无法读取，请稍后重试", backup);
                }
                previous.addProperty("cached", true);
                previous.addProperty("stale", true);
                previous.addProperty("warning", "Minecraft 官方新闻暂时无法读取");
                return previous;
            }
        }
        try { JsonFiles.write(cache, updated); }
        catch (IOException ignored) { /* An unavailable cache does not hide the retrieved feed. */ }
        return updated;
    }

    public static JsonObject rss(String xml) throws IOException {
        var articles = new JsonArray();
        var items = ITEM.matcher(xml);
        for (int index = 0; index < 30 && items.find(); index++) {
            String block = items.group(1);
            String link = clean(field(block, "link"));
            if (!link.startsWith("https://")) continue;
            String description = field(block, "description");
            String id = clean(field(block, "guid"));
            String category = clean(field(block, "category"));
            var article = new JsonObject();
            article.addProperty("id", id.isEmpty() ? "rss-" + index : id);
            article.addProperty("title", clean(field(block, "title")));
            article.addProperty("summary", clean(description));
            article.addProperty("published", clean(field(block, "pubDate")));
            article.addProperty("category", category.isEmpty() ? "Minecraft 新闻" : category);
            var enclosure = ENCLOSURE.matcher(block);
            var image = IMAGE.matcher(description);
            article.addProperty("image", enclosure.find() ? enclosure.group(1) : image.find() ? image.group(1) : "");
            article.addProperty("url", link);
            article.addProperty("source", "Minecraft.net");
            articles.add(article);
        }
        if (articles.isEmpty()) throw new IOException("官方新闻源没有返回文章");
        return response(articles, "Minecraft.net RSS");
    }

    public static JsonObject launcher(JsonObject value) throws IOException {
        var articles = new JsonArray();
        if (value.get("entries") instanceof JsonArray rows) {
            for (int index = 0; index < Math.min(24, rows.size()); index++) {
                JsonElement row = rows.get(index);
                if (!row.isJsonObject()) continue;
                JsonObject item = row.getAsJsonObject();
                String url = text(item, "readMoreLink", "");
                if (!url.startsWith("https://")) continue;
                var article = new JsonObject();
                article.add("id", item.get("id"));
                article.add("title", item.get("title"));
                article.add("summary", item.get("text"));
                article.add("published", item.get("date"));
                article.add("category", item.get("category"));
                String image = imageUrl(item, "newsPageImage");
                if (image == null) image = imageUrl(item, "playPageImage");
                article.addProperty("image", image == null ? "" : image.startsWith("https://") ? image : IMAGE_BASE + image);
                article.addProperty("url", url);
                article.addProperty("source", "Minecraft Launcher");
                articles.add(article);
            }
        }
        if (articles.isEmpty()) throw new IOException("Minecraft Launcher 新闻源没有返回文章");
        return response(articles, "Minecraft Launcher 备用源");
    }

    private static JsonObject response(JsonArray articles, String source) {
        var value = new JsonObject();
        value.add("articles", articles);
        value.addProperty("source", source);
        return value;
    }

    private static String imageUrl(JsonObject value, String key) {
        return value.get(key) instanceof JsonObject image ? text(image, "url", null) : null;
    }

    private static String field(String input, String tag) {
        String pattern = Pattern.quote(tag);
        var match = Pattern.compile("(?is)<" + pattern + "(?:\\s[^>]*)?>(.*?)</" + pattern + "\\s*>").matcher(input);
        if (!match.find()) return "";
        String value = match.group(1).strip();
        if (value.startsWith("<![CDATA[") && value.endsWith("]]>")) return value.substring(9, value.length() - 3);
        return value;
    }

    private static String clean(String value) {
        String text = HTML.matcher(value).replaceAll(" ").replace("&amp;", "&").replace("&quot;", "\"")
            .replace("&#39;", "'").replace("&lt;", "<").replace("&gt;", ">");
        return WHITESPACE.matcher(text).replaceAll(" ").strip();
    }
}
