package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import org.eclipse.swt.ole.win32.OleAutomation;
import org.eclipse.swt.ole.win32.Variant;

final class WindowsGames {
    private static final Map<String, String> GAMES = new LinkedHashMap<>();
    static {
        GAMES.put("bedrock", "我的世界 · 基岩版");
        GAMES.put("dungeons", "我的世界 · 地下城");
        GAMES.put("dungeons2", "我的世界 · 地下城 II");
        GAMES.put("legends", "我的世界 · 传奇");
    }

    private WindowsGames() {}

    static JsonArray scan() throws IOException {
        var detected = new LinkedHashMap<String, String>();
        OleAutomation explorer = new OleAutomation("Shell.Application");
        try {
            var apps = invokeObject(explorer, "NameSpace", new Variant("shell:AppsFolder"));
            try {
                var items = invokeObject(apps, "Items");
                try {
                    Variant size = items.getProperty(member(items, "Count"));
                    int count;
                    try { count = Math.min(size.getInt(), 5000); }
                    finally { size.dispose(); }
                    for (int i = 0; i < count; i++) {
                        var item = invokeObject(items, "Item", new Variant(i));
                        try {
                            String application = value(item, "Path");
                            String kind = type(application);
                            if (kind != null && valid(application)) detected.putIfAbsent(kind, application);
                        } finally { item.dispose(); }
                    }
                } finally { items.dispose(); }
            } finally { apps.dispose(); }
        } finally { explorer.dispose(); }
        var output = new JsonArray();
        GAMES.forEach((id, name) -> {
            var row = new JsonObject();
            row.addProperty("id", id);
            row.addProperty("name", name);
            row.addProperty("installed", detected.containsKey(id));
            row.addProperty("appId", detected.get(id));
            output.add(row);
        });
        return output;
    }

    static void launch(String game, String app) throws IOException {
        if (!GAMES.containsKey(game) || !valid(app) || !game.equals(type(app))) throw new IOException("无法识别的本机游戏入口");
        Path explorer = Path.of(System.getenv().getOrDefault("SystemRoot", "C:/Windows"), "explorer.exe");
        new ProcessBuilder(explorer.toString(), "shell:AppsFolder\\" + app).start();
    }

    static void store(String game) throws IOException {
        String uri = switch (game) {
            case "bedrock" -> "ms-windows-store://pdp/?productid=9NBLGGH2JHXJ";
            case "dungeons" -> "ms-windows-store://pdp/?productid=9N8NJ74FZTG9";
            case "legends" -> "ms-windows-store://search/?query=Minecraft%20Legends";
            case "dungeons2" -> "ms-windows-store://pdp/?productid=9P5786PJB9RP";
            default -> throw new IOException("无法识别的游戏");
        };
        Path explorer = Path.of(System.getenv().getOrDefault("SystemRoot", "C:/Windows"), "explorer.exe");
        new ProcessBuilder(explorer.toString(), uri).start();
    }

    private static boolean valid(String id) { return id.length() <= 200 && id.matches("[A-Za-z0-9_.!-]+"); }

    private static String type(String name) {
        String id = name.toLowerCase(Locale.ROOT);
        if (id.contains("minecraftdungeons2") || id.contains("minecraftdungeonsii")) return "dungeons2";
        if (id.contains("minecraftdungeons") || id.contains("lovika")) return "dungeons";
        if (id.contains("minecraftlegends") || id.contains("badgerwin10")) return "legends";
        if (id.contains("minecraftuwp") || id.contains("minecraftwindows") || id.contains("minecraftbedrock")) return "bedrock";
        return null;
    }

    private static int member(OleAutomation item, String name) throws IOException {
        int[] ids = item.getIDsOfNames(new String[]{name});
        if (ids == null || ids.length == 0) throw new IOException("无法读取 Windows 游戏列表");
        return ids[0];
    }

    private static String value(OleAutomation item, String name) throws IOException {
        Variant property = item.getProperty(member(item, name));
        if (property == null) return "";
        try { return property.getString(); }
        finally { property.dispose(); }
    }

    private static OleAutomation invokeObject(OleAutomation target, String name, Variant... arguments) throws IOException {
        try {
            int id = member(target, name);
            Variant data = target.invoke(id, arguments);
            if (data == null) throw new IOException("无法读取 Windows 游戏列表");
            try { return data.getAutomation(); }
            finally { data.dispose(); }
        } finally { for (Variant item : arguments) item.dispose(); }
    }
}
