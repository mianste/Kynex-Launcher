package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static com.keke.kynex.core.WorkshopPlans.json;

final class SchematicSpecialBlocks {
    private static final Set<String> COLORS = Set.of("white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray", "light_gray",
        "cyan", "purple", "blue", "brown", "green", "red", "black");
    private static final List<String> SIGNS = List.of("_wall_hanging_sign", "_hanging_sign", "_wall_sign", "_sign");
    private static final Map<String, String> CHESTS = Map.of("chest", "normal", "trapped_chest", "trapped", "ender_chest", "ender",
        "copper_chest", "copper", "exposed_copper_chest", "copper_exposed", "weathered_copper_chest", "copper_weathered",
        "oxidized_copper_chest", "copper_oxidized");

    record Model(String texture, JsonArray elements, int x, double y) {}

    private SchematicSpecialBlocks() {}

    static Model resolve(String name, Map<String, String> properties) {
        if (!name.startsWith("minecraft:")) return null;
        String block = name.substring("minecraft:".length());
        String facing = properties.getOrDefault("facing", "north");
        String chest = CHESTS.get(block.replaceFirst("^waxed_", ""));
        if (chest != null) return chest(chest, properties.getOrDefault("type", "single"), facing);
        if (block.endsWith("_bed")) {
            String dye = suffix(block, "_bed");
            if (COLORS.contains(dye)) return bed(dye, "head".equals(properties.get("part")), facing);
        }
        if (block.equals("shulker_box")) return shulker("", properties.getOrDefault("facing", "up"));
        if (block.endsWith("_shulker_box")) {
            String dye = suffix(block, "_shulker_box");
            if (COLORS.contains(dye)) return shulker(dye, properties.getOrDefault("facing", "up"));
        }
        for (String style : SIGNS) if (block.endsWith(style)) return sign(suffix(block, style), style, facing, properties.getOrDefault("rotation", "0"));
        return null;
    }

    private static Model chest(String kind, String half, String facing) {
        double min = 1, max = 15, latchStart = 7, latchEnd = 9;
        String seam = "", suffix = "";
        if (!kind.equals("ender") && half.equals("left")) {
            max = 16;
            latchStart = 15;
            latchEnd = 16;
            seam = "east";
            suffix = "_left";
        } else if (!kind.equals("ender") && half.equals("right")) {
            min = 0;
            latchStart = 0;
            latchEnd = 1;
            seam = "west";
            suffix = "_right";
        }
        String texture = "minecraft:entity/chest/" + kind + suffix;
        var elements = new JsonArray();
        double width = max - min;
        elements.add(cuboid(texture, vec(min, 0, 1), vec(max, 10, 15), 0, 19, width, 10, 14, 64, seam));
        elements.add(cuboid(texture, vec(min, 10, 1), vec(max, 14, 15), 0, 0, width, 5, 14, 64, seam));
        elements.add(cuboid(texture, vec(latchStart, 7, 0), vec(latchEnd, 11, 1), 0, 0, latchEnd - latchStart, 4, 1, 64, ""));
        return new Model(texture, elements, 0, cardinal(facing));
    }

    private static Model bed(String color, boolean head, String facing) {
        String texture = "minecraft:entity/bed/" + color;
        double v = head ? 0 : 22;
        var faces = json("up", uv(texture, 6, v + 6, 22, v + 22, 64, 180), "down", uv(texture, 28, v + 6, 44, v + 22, 64, 0),
            "east", uv(texture, 0, v + 6, 6, v + 22, 64, 90), "west", uv(texture, 22, v + 6, 28, v + 22, 64, 270));
        faces.add(head ? "north" : "south", uv(texture, 6, v, 22, v + 6, 64, 0));
        var elements = new JsonArray();
        elements.add(json("from", vec(0, 3, 0), "to", vec(16, 9, 16), "faces", faces));
        double z = head ? 0 : 13, leg = head ? 0 : 12;
        elements.add(cuboid(texture, vec(0, 0, z), vec(3, 3, z + 3), 50, leg, 3, 3, 3, 64, ""));
        elements.add(cuboid(texture, vec(13, 0, z), vec(16, 3, z + 3), 50, leg + 6, 3, 3, 3, 64, ""));
        return new Model(texture, elements, 0, cardinal(facing));
    }

    private static Model shulker(String color, String facing) {
        String texture = "minecraft:entity/shulker/shulker" + (color.isEmpty() ? "" : "_" + color);
        var elements = new JsonArray();
        elements.add(cuboid(texture, vec(.01, 0, .01), vec(15.99, 8, 15.99), 0, 28, 16, 8, 16, 64, ""));
        elements.add(cuboid(texture, vec(0, 4, 0), vec(16, 16, 16), 0, 0, 16, 12, 16, 64, ""));
        return switch (facing) {
            case "up" -> new Model(texture, elements, 0, 0);
            case "down" -> new Model(texture, elements, 180, 0);
            default -> new Model(texture, elements, 90, cardinal(facing));
        };
    }

    private static Model sign(String wood, String style, String facing, String offeredRotation) {
        boolean hanging = style.contains("hanging");
        boolean wall = style.startsWith("_wall");
        String texture = "minecraft:entity/signs/" + (hanging ? "hanging/" : "") + wood;
        double z = style.equals("_wall_sign") ? 14 : 7;
        double bottom = style.equals("_sign") ? 10 : 4;
        var elements = new JsonArray();
        elements.add(cuboid(texture, vec(0, bottom, z), vec(16, bottom + 8, z + 1.5), 0, hanging ? 12 : 0, 24, 12, 2, 32, ""));
        if (style.equals("_sign")) elements.add(cuboid(texture, vec(7, 0, 7), vec(9, 10, 9), 0, 14, 2, 14, 2, 32, ""));
        if (hanging) for (int x : List.of(3, 12))
            elements.add(cuboid(texture, vec(x, 12, 7.5), vec(x + 1, 16, 8.5), 59, 0, 1, 4, 1, 32, ""));
        int rotation = offeredRotation.matches("[0-9]|1[0-5]") ? Integer.parseInt(offeredRotation) : 0;
        return new Model(texture, elements, 0, wall ? cardinal(facing) : (rotation * 22.5 + 180) % 360);
    }

    private static JsonObject cuboid(String texture, double[] from, double[] to, double u, double v, double width, double height, double depth,
                                     double sheetHeight, String seam) {
        double side = u + depth + width;
        double top = v + depth, bottom = top + height;
        var faces = json("up", uv(texture, side, v, u + depth, top, sheetHeight, 0), "down", uv(texture, side + width, top, side, v, sheetHeight, 0),
            "north", uv(texture, u + depth, top, side, bottom, sheetHeight, 0), "south", uv(texture, side + depth, top, side + depth + width, bottom, sheetHeight, 0),
            "west", uv(texture, side, top, side + depth, bottom, sheetHeight, 0), "east", uv(texture, u, top, u + depth, bottom, sheetHeight, 0));
        faces.remove(seam);
        return json("from", from, "to", to, "faces", faces);
    }

    private static JsonObject uv(String texture, double x1, double y1, double x2, double y2, double sheetHeight, int rotation) {
        return json("texture", texture, "uv", vec(x1 / 4, y1 * 16 / sheetHeight, x2 / 4, y2 * 16 / sheetHeight), "rotation", rotation);
    }

    private static double[] vec(double... values) { return values; }
    private static String suffix(String value, String suffix) { return value.substring(0, value.length() - suffix.length()); }
    private static int cardinal(String value) {
        return switch (value) {
            case "east" -> 90;
            case "south" -> 180;
            case "west" -> 270;
            default -> 0;
        };
    }
}
