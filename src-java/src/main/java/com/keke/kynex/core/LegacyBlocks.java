package com.keke.kynex.core;

import java.util.Map;

final class LegacyBlocks {
    private static final String[] COLORS = {"white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray",
        "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black"};
    private static final String[] WOOD = {"oak", "spruce", "birch", "jungle", "acacia", "dark_oak"};
    private static final String[] FACING = {"down", "up", "north", "south", "west", "east"};
    private static final String[] FLOWERS = {"poppy", "blue_orchid", "allium", "azure_bluet", "red_tulip", "orange_tulip",
        "white_tulip", "pink_tulip", "oxeye_daisy"};
    private static final Map<Integer, String> STAIRS = Map.ofEntries(Map.entry(53, "oak"), Map.entry(67, "cobblestone"),
        Map.entry(108, "brick"), Map.entry(109, "stone_brick"), Map.entry(114, "nether_brick"), Map.entry(128, "sandstone"),
        Map.entry(134, "spruce"), Map.entry(135, "birch"), Map.entry(136, "jungle"), Map.entry(156, "quartz"),
        Map.entry(163, "acacia"), Map.entry(164, "dark_oak"), Map.entry(180, "red_sandstone"), Map.entry(203, "purpur"));

    private LegacyBlocks() {}

    static String door(int block) {
        return switch (block) {
            case 64 -> "oak_door";
            case 71 -> "iron_door";
            case 193 -> "spruce_door";
            case 194 -> "birch_door";
            case 195 -> "jungle_door";
            case 196 -> "acacia_door";
            case 197 -> "dark_oak_door";
            default -> null;
        };
    }

    static String name(int block, int variant) {
        String stairs = STAIRS.get(block);
        if (stairs != null) {
            return stairs + "_stairs[facing=" + new String[]{"east", "west", "south", "north"}[variant & 3]
                + ",half=" + ((variant & 4) == 0 ? "bottom" : "top") + ",shape=straight,waterlogged=false]";
        }
        String facing = variant % 8 >= 2 && variant % 8 < 6 ? FACING[variant % 8] : "north";
        return switch (block) {
            case 1 -> switch (variant) {
                case 1, 2 -> "granite";
                case 3, 4 -> "diorite";
                case 5, 6 -> "andesite";
                default -> "stone";
            };
            case 2 -> "grass_block";
            case 3 -> "dirt";
            case 4 -> "cobblestone";
            case 5 -> (variant < WOOD.length ? WOOD[variant] : "oak") + "_planks";
            case 7 -> "bedrock";
            case 8, 9 -> "water[level=" + variant + "]";
            case 10, 11 -> "lava[level=" + variant + "]";
            case 12 -> "sand";
            case 13 -> "gravel";
            case 14 -> "gold_ore";
            case 15 -> "iron_ore";
            case 16 -> "coal_ore";
            case 17, 162 -> {
                int species = block == 17 ? variant & 3 : 4 + (variant & 1);
                String axis = switch (variant & 12) {
                    case 4 -> "x";
                    case 8 -> "z";
                    default -> "y";
                };
                yield WOOD[species] + ((variant & 12) == 12 ? "_wood[axis=" : "_log[axis=") + axis + "]";
            }
            case 18, 161 -> "oak_leaves";
            case 19 -> "sponge";
            case 20 -> "glass";
            case 22 -> "lapis_block";
            case 24 -> "sandstone";
            case 23, 158, 218 -> {
                String dir = (variant & 7) < FACING.length ? FACING[variant & 7] : "north";
                boolean powered = (variant & 8) != 0;
                yield switch (block) {
                    case 218 -> "observer[facing=" + dir + ",powered=" + powered + "]";
                    case 158 -> "dropper[facing=" + dir + ",triggered=" + powered + "]";
                    default -> "dispenser[facing=" + dir + ",triggered=" + powered + "]";
                };
            }
            case 31 -> variant == 2 ? "fern" : "short_grass";
            case 35, 171 -> COLORS[variant] + "_wool";
            case 95, 160 -> COLORS[variant] + "_stained_glass";
            case 159 -> COLORS[variant] + "_terracotta";
            case 251, 252 -> COLORS[variant] + "_concrete";
            case 37 -> "dandelion";
            case 38 -> variant < FLOWERS.length ? FLOWERS[variant] : FLOWERS[0];
            case 39 -> "brown_mushroom";
            case 40 -> "red_mushroom";
            case 41 -> "gold_block";
            case 42 -> "iron_block";
            case 43, 44, 98 -> "stone_bricks";
            case 45 -> "bricks";
            case 47 -> "bookshelf";
            case 48 -> "mossy_cobblestone";
            case 49 -> "obsidian";
            case 50, 75, 76 -> {
                if (variant >= 1 && variant <= 4) {
                    String dir = new String[]{"east", "west", "south", "north"}[variant - 1];
                    yield block == 50 ? "wall_torch[facing=" + dir + "]"
                        : "redstone_wall_torch[facing=" + dir + ",lit=" + (block == 76) + "]";
                }
                yield block == 50 ? "torch" : "redstone_torch[lit=" + (block == 76) + "]";
            }
            case 54, 130, 146 -> (block == 130 ? "ender_chest" : block == 146 ? "trapped_chest" : "chest")
                + "[facing=" + facing + ",type=single,waterlogged=false]";
            case 57 -> "diamond_block";
            case 59 -> "wheat[age=" + Math.min(variant, 7) + "]";
            case 60 -> "farmland[moisture=" + Math.min(variant, 7) + "]";
            case 61, 62 -> "furnace[facing=" + facing + ",lit=" + (block == 62) + "]";
            case 78, 80 -> "snow_block";
            case 79, 174 -> "ice";
            case 82 -> "clay";
            case 83 -> "sugar_cane";
            case 85 -> "oak_fence";
            case 87 -> "netherrack";
            case 88 -> "soul_sand";
            case 89 -> "glowstone";
            case 101 -> "iron_bars";
            case 102 -> "glass_pane";
            case 112 -> "nether_bricks";
            case 113 -> "nether_brick_fence";
            case 115 -> "nether_wart[age=" + Math.min(variant, 3) + "]";
            case 121 -> "end_stone";
            case 133 -> "emerald_block";
            case 139 -> variant == 1 ? "mossy_cobblestone_wall" : "cobblestone_wall";
            case 141 -> "carrots[age=" + Math.min(variant, 7) + "]";
            case 142 -> "potatoes[age=" + Math.min(variant, 7) + "]";
            case 152 -> "redstone_block";
            case 154 -> "hopper[facing=" + ((variant & 7) == 0 ? "down" : facing) + ",enabled=" + ((variant & 8) == 0) + "]";
            case 155 -> "quartz_block";
            case 168 -> "prismarine";
            case 170 -> "hay_block";
            case 172 -> "terracotta";
            case 179 -> "red_sandstone";
            case 201 -> "purpur_block";
            case 206 -> "end_stone_bricks";
            case 207 -> "beetroots[age=" + Math.min(variant, 3) + "]";
            default -> "legacy_" + block;
        };
    }
}
