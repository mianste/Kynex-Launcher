package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

final class SchematicPreview {
    private static final int MAX_BLOCKS = 128_000_000;
    private static final int MAX_CELLS = 1_000_000;
    private static final long[] ZERO = new long[3];
    private final long[] origin;
    private final int[] size;
    private final int[] grid;
    private final int step;
    private final short[] cells;
    private final List<String> palette = new ArrayList<>(List.of("minecraft:air"));
    private final Map<String, Integer> materials = new HashMap<>();
    private final JsonArray entities = new JsonArray();
    private final JsonObject moving = new JsonObject();
    private record Region(Map<String, Object> tags, long[] position, long[] minimum, int[] size) {}

    private SchematicPreview(long[] origin, int[] size) {
        this.origin = origin;
        this.size = size;
        int high = Math.max(size[0], Math.max(size[1], size[2]));
        int low = Math.max(1, Math.ceilDiv(high, 2048));
        while (low < high) {
            int middle = low + (high - low) / 2;
            if ((long) Math.ceilDiv(size[0], middle) * Math.ceilDiv(size[1], middle) * Math.ceilDiv(size[2], middle) <= MAX_CELLS) {
                high = middle;
            } else low = middle + 1;
        }
        step = low;
        grid = Arrays.stream(size).map(axis -> Math.ceilDiv(axis, step)).toArray();
        cells = new short[grid[0] * grid[1] * grid[2]];
    }

    static JsonObject resource(Path root, Path dataRoot, JsonObject request) throws IOException {
        JsonObject options = request.deepCopy();
        options.addProperty("kind", "schematics");
        Path directory = LocalGameFiles.resourceDirectory(root, dataRoot, options);
        String expected = JsonFiles.text(request, "directory", "");
        if (!expected.isEmpty() && !directory.equals(Path.of(expected))) throw new IOException("投影目录已更改，请刷新后重新选择文件");
        String name = JsonFiles.required(request, "name");
        for (String part : name.split("/", -1)) LaunchManifest.safeName(part);
        if (!name.toLowerCase(java.util.Locale.ROOT).matches(".*\\.(litematic|schem|schematic|nbt)")) throw new IOException("投影文件格式无效");
        Path file = GameFiles.target(directory, name);
        if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) throw new IOException("找不到投影文件");
        return read(file);
    }

    static JsonObject read(Path file) throws IOException {
        Map<String, Object> content = NbtReader.open(file);
        Map<String, Object> data = map(content.getOrDefault("Schematic", content));
        SchematicPreview result;
        if (data.containsKey("Regions")) result = litematic(map(data.get("Regions")));
        else if (data.get("Blocks") instanceof Map) {
            Map<String, Object> blocks = map(data.get("Blocks"));
            result = sponge(data, map(blocks.get("Palette")), bytes(blocks.get("Data")));
        } else if (data.containsKey("Palette") && data.containsKey("BlockData")) {
            result = sponge(data, map(data.get("Palette")), bytes(data.get("BlockData")));
        } else if (data.get("Blocks") instanceof byte[]) result = legacy(data);
        else if (data.containsKey("size") && data.containsKey("blocks")) result = vanilla(data);
        else if (data.containsKey("Entities") && data.containsKey("Width")) {
            result = new SchematicPreview(ZERO, dimensions(data));
            result.addEntities(data.get("Entities"), ZERO, false);
        } else throw new IOException("无法识别投影格式，请选择 Litematica、Sponge、MCEdit 或原版结构文件");
        return result.finish();
    }

    private static SchematicPreview litematic(Map<String, Object> regions) throws IOException {
        var plans = new ArrayList<Region>();
        long[] min = {Long.MAX_VALUE, Long.MAX_VALUE, Long.MAX_VALUE};
        long[] max = {Long.MIN_VALUE, Long.MIN_VALUE, Long.MIN_VALUE};
        long sum = 0;
        for (Object value : new TreeMap<>(regions).values()) {
            Map<String, Object> next = map(value);
            long[] position = xyz(map(next.get("Position")));
            long[] signed = xyz(map(next.get("Size")));
            int[] size = dimensions(Arrays.stream(signed).map(Math::abs).toArray());
            long[] minimum = new long[3];
            for (int axis = 0; axis < 3; axis++) {
                minimum[axis] = position[axis] + Math.min(signed[axis] + 1, 0);
                min[axis] = Math.min(min[axis], minimum[axis]);
                max[axis] = Math.max(max[axis], minimum[axis] + size[axis]);
            }
            if ((sum += volume(size)) > MAX_BLOCKS) throw new IOException("此投影的方块区域过大");
            plans.add(new Region(next, position, minimum, size));
        }
        if (plans.isEmpty()) throw new IOException("此投影没有建筑区域");
        var result = new SchematicPreview(min, gridSize(new long[]{max[0] - min[0], max[1] - min[1], max[2] - min[2]}));
        for (Region plan : plans) {
            Map<String, Object> fields = plan.tags();
            result.addEntities(fields.get("Entities"), plan.position(), false);
            int[] palette = result.stateList(fields.get("BlockStatePalette"));
            if (palette.length == 0 || !(fields.get("BlockStates") instanceof long[] states)) throw new IOException("Litematica 方块数据不完整");
            int bits = Math.max(2, Integer.SIZE - Integer.numberOfLeadingZeros(palette.length - 1));
            int count = volume(plan.size());
            if (states.length < Math.ceilDiv((long) count * bits, 64)) throw new IOException("Litematica 方块数组不完整");
            for (int i = 0; i < count; i++) {
                long position = (long) i * bits;
                int word = (int) (position >>> 6);
                int shift = (int) (position & 63);
                long value = states[word] >>> shift;
                if (shift + bits > 64) value |= states[word + 1] << (64 - shift);
                int id = (int) (value & ((1L << bits) - 1));
                if (id >= palette.length) throw new IOException("Litematica 方块编号无效");
                result.place(i, plan.size(), plan.minimum(), palette[id]);
            }
            result.blockEntities(fields.get("TileEntities"), plan.minimum());
        }
        return result;
    }

    private static SchematicPreview sponge(Map<String, Object> fields, Map<String, Object> palette, byte[] blocks) throws IOException {
        var result = new SchematicPreview(ZERO, dimensions(fields));
        result.addEntities(fields.get("Entities"), ZERO, false);
        var materials = new HashMap<Integer, Integer>();
        for (var entry : palette.entrySet()) {
            int key = integer(entry.getValue());
            if (key < 0 || materials.putIfAbsent(key, result.material(entry.getKey())) != null) {
                throw new IOException("Sponge 方块编号无效");
            }
        }
        int offset = 0;
        int count = volume(result.size);
        for (int index = 0; index < count; index++) {
            int value = 0;
            boolean complete = false;
            for (int shift = 0; shift <= 28; shift += 7) {
                if (offset >= blocks.length) throw new IOException("Sponge 方块数组不完整");
                int mark = Byte.toUnsignedInt(blocks[offset++]);
                if (shift == 28 && mark > 15) throw new IOException("Sponge 方块编号无效");
                value |= (mark & 127) << shift;
                if (mark < 128) { complete = true; break; }
            }
            Integer block = materials.get(value);
            if (block == null || !complete) throw new IOException("Sponge 方块编号无效");
            result.place(index, result.size, ZERO, block);
        }
        if (offset != blocks.length) throw new IOException("Sponge 方块数组与尺寸不符");
        var nested = map(fields.get("Blocks"));
        result.blockEntities(nested.getOrDefault("BlockEntities", fields.get("BlockEntities")), ZERO);
        return result;
    }

    private static SchematicPreview vanilla(Map<String, Object> fields) throws IOException {
        var result = new SchematicPreview(ZERO, dimensions(position(fields.get("size"))));
        result.addEntities(fields.get("entities"), ZERO, true);
        Object palette = fields.get("palette");
        if (palette == null && !list(fields.get("palettes")).isEmpty()) palette = list(fields.get("palettes")).getFirst();
        int[] ids = result.stateList(palette);
        for (var item : list(fields.get("blocks"))) {
            var block = map(item);
            long[] position = position(block.get("pos"));
            int state = integer(block.get("state"));
            if (state < 0 || state >= ids.length || result.index(position) < 0) throw new IOException("结构方块的编号或位置不合法");
            result.place(position[0], position[1], position[2], ids[state]);
            result.piston(position, map(block.get("nbt")));
        }
        return result;
    }

    private static SchematicPreview legacy(Map<String, Object> fields) throws IOException {
        var result = new SchematicPreview(ZERO, dimensions(fields));
        result.addEntities(fields.get("Entities"), ZERO, false);
        int count = volume(result.size);
        byte[] blocks = bytes(fields.get("Blocks"));
        byte[] variants = bytes(fields.get("Data"));
        byte[] high = fields.containsKey("AddBlocks") ? bytes(fields.get("AddBlocks")) : null;
        if (blocks.length != count || variants.length != count || high != null && high.length != Math.ceilDiv(count, 2)) {
            throw new IOException("旧版投影的方块数组与尺寸不符");
        }
        int[] known = new int[65536];
        Arrays.fill(known, -1);
        int layer = result.size[0] * result.size[2];
        for (int i = 0; i < count; i++) {
            int block = legacyBlock(blocks, high, i);
            if (block == 0) continue;
            int variant = variants[i] & 15;
            String door = LegacyBlocks.door(block);
            if (door != null) {
                boolean upper = (variant & 8) != 0;
                int paired = i + (upper ? -layer : layer);
                int other = paired >= 0 && paired < count && legacyBlock(blocks, high, paired) == block ? variants[paired] & 15 : -1;
                if (other >= 0 && ((other & 8) != 0) == upper) other = -1;
                int bottom = upper ? Math.max(0, other) : variant;
                int top = upper ? variant : Math.max(8, other);
                String facing = new String[]{"east", "south", "west", "north"}[bottom & 3];
                int state = result.material(door + "[facing=" + facing + ",half=" + (upper ? "upper" : "lower")
                    + ",hinge=" + ((top & 1) != 0 ? "right" : "left")
                    + ",open=" + ((bottom & 4) != 0) + ",powered=" + ((top & 2) != 0) + "]");
                result.place(i, result.size, ZERO, state);
            } else {
                int key = block | (variant << 12);
                if (known[key] < 0) known[key] = result.material(LegacyBlocks.name(block, variant));
                result.place(i, result.size, ZERO, known[key]);
            }
        }
        result.blockEntities(fields.get("TileEntities"), ZERO);
        return result;
    }

    private static int legacyBlock(byte[] blocks, byte[] high, int index) {
        return Byte.toUnsignedInt(blocks[index]) | (high == null ? 0 : (high[index / 2] >>> (4 * (index % 2)) & 15) << 8);
    }

    private int material(String name) throws IOException {
        String type = name.split("\\[", 2)[0].replaceFirst("^minecraft:", "");
        if (Set.of("air", "cave_air", "void_air", "structure_void").contains(type)) return 0;
        Integer current = materials.get(name);
        if (current != null) return current;
        int id = palette.size();
        if (id > 65535) throw new IOException("投影中的方块种类过多");
        palette.add(name);
        materials.put(name, id);
        return id;
    }

    private int[] stateList(Object source) throws IOException {
        List<?> states = list(source);
        int[] ids = new int[states.size()];
        for (int i = 0; i < ids.length; i++) ids[i] = state(map(states.get(i)));
        return ids;
    }

    private int state(Map<String, Object> state) throws IOException {
        if (!(state.get("Name") instanceof String type)) throw new IOException("投影中的方块名称无效");
        var props = new ArrayList<String>();
        new TreeMap<>(map(state.get("Properties"))).forEach((key, value) -> {
            if (value instanceof String text) props.add(key + "=" + text);
        });
        return material(props.isEmpty() ? type : type + "[" + String.join(",", props) + "]");
    }

    private int index(long[] position) { return index(position[0], position[1], position[2]); }

    private int index(long x, long y, long z) {
        long dx = x - origin[0];
        long dy = y - origin[1];
        long dz = z - origin[2];
        if (dx < 0 || dy < 0 || dz < 0 || dx >= size[0] || dy >= size[1] || dz >= size[2]) return -1;
        return (int) (dx / step + grid[0] * (dz / step + grid[2] * (dy / step)));
    }

    private void place(long x, long y, long z, int id) {
        if (id == 0) return;
        int index = index(x, y, z);
        if (index >= 0) cells[index] = (short) id;
    }

    private void place(int index, int[] region, long[] origin, int id) {
        if (id != 0) place(origin[0] + index % region[0], origin[1] + index / (region[0] * region[2]),
            origin[2] + index / region[0] % region[2], id);
    }

    private void blockEntities(Object data, long[] origin) {
        for (Object item : list(data)) {
            var row = map(item);
            try {
                long[] pos = row.get("Pos") instanceof int[] bytes && bytes.length == 3
                    ? new long[]{bytes[0], bytes[1], bytes[2]} : xyz(row);
                for (int i = 0; i < 3; i++) pos[i] += origin[i];
                piston(pos, map(row.getOrDefault("Data", row)));
            } catch (IOException invalid) { /* An incomplete block entity need not hide the building. */ }
        }
    }

    private void piston(long[] position, Map<String, Object> record) {
        if (step != 1 || !record.containsKey("blockState")) return;
        int index = index(position);
        if (index < 0) return;
        String material = palette.get(Short.toUnsignedInt(cells[index])).split("\\[", 2)[0];
        if (!Set.of("moving_piston", "minecraft:moving_piston").contains(material)) return;
        try { cells[index] = (short) state(map(record.get("blockState"))); }
        catch (IOException invalid) { return; }
        boolean extend = number(record.get("extending"), 0) != 0;
        if (!extend && number(record.get("source"), 0) != 0) return;
        int dir = (int) number(record.get("facing"), 0);
        int[][] directions = {{0, -1, 0}, {0, 1, 0}, {0, 0, -1}, {0, 0, 1}, {-1, 0, 0}, {1, 0, 0}};
        if (dir < 0 || dir >= directions.length) return;
        double progress = Math.clamp(number(record.get("progress"), 0), 0, 1);
        var offset = new JsonArray();
        for (int axis : directions[dir]) offset.add(axis * (extend ? progress - 1 : 1 - progress));
        moving.add(Integer.toString(index), offset);
    }

    private void addEntities(Object data, long[] offset, boolean structure) {
        for (Object value : list(data)) {
            if (entities.size() >= 2048) return;
            var row = map(value);
            var entity = map(row.getOrDefault(structure ? "nbt" : "Data", row));
            Object rawId = row.getOrDefault("Id", entity.get("id"));
            if (!(rawId instanceof String raw)) continue;
            String id = entityId(raw);
            var position = list(row.get(structure ? "pos" : "Pos"));
            if (id == null || position.size() != 3) continue;
            var coords = new JsonArray();
            for (int i = 0; i < 3; i++) {
                double point = number(position.get(i), Double.NaN) + offset[i] - origin[i];
                if (!Double.isFinite(point) || point < -16 || point > (double) size[i] + 16) break;
                coords.add(point);
            }
            if (coords.size() != 3) continue;
            var item = new JsonObject();
            item.addProperty("id", id);
            item.add("position", coords);
            var rotation = list(entity.get("Rotation"));
            double yaw = rotation.isEmpty() ? 0 : number(rotation.getFirst(), 0);
            item.addProperty("yaw", (yaw % 360 + 360) % 360);
            item.addProperty("pitch", rotation.size() < 2 ? 0 : Math.clamp(number(rotation.get(1), 0), -90, 90));
            for (String field : List.of("variant", "Variant", "Type")) {
                if (entity.get(field) instanceof String text && text.length() <= 64) {
                    item.addProperty("variant", text);
                    break;
                }
            }
            entityNumber(item, "variantIndex", entity, "Variant", "variant", "RabbitType", "PuffState");
            entityNumber(item, "color", entity, "Color", "color", "CollarColor");
            item.addProperty("baby", number(entity.get("Age"), 0) < 0 || number(entity.get("IsBaby"), 0) != 0 || number(entity.get("Baby"), 0) != 0);
            item.addProperty("sheared", number(entity.get("Sheared"), 0) != 0);
            item.addProperty("charged", number(entity.get("powered"), 0) != 0);
            item.addProperty("size", Math.clamp(number(entity.get("Size"), 0), 0, 32));
            item.addProperty("tamed", entity.containsKey("Owner") || entity.containsKey("owner") || number(entity.get("Tame"), 0) != 0);
            entities.add(item);
        }
    }

    private static void entityNumber(JsonObject output, String key, Map<String, Object> entity, String... names) {
        for (String name : names) {
            double value = number(entity.get(name), Double.NaN);
            if (Double.isFinite(value)) { output.addProperty(key, value); return; }
        }
    }

    private static String entityId(String id) {
        String result = switch (id) {
            case "PigZombie", "minecraft:zombie_pigman" -> "minecraft:zombified_piglin";
            case "LavaSlime" -> "minecraft:magma_cube";
            case "MushroomCow" -> "minecraft:mooshroom";
            case "SnowMan", "minecraft:snowman" -> "minecraft:snow_golem";
            case "VillagerGolem", "minecraft:villager_golem" -> "minecraft:iron_golem";
            case "EntityHorse" -> "minecraft:horse";
            case "Ozelot" -> "minecraft:ocelot";
            default -> id.contains(":") ? id : "minecraft:" + id.replaceAll("(?!^)([A-Z])", "_$1").toLowerCase(java.util.Locale.ROOT);
        };
        return result.length() <= 128 && result.matches("[a-z0-9_.-]+:[a-z0-9_.-]+") ? result : null;
    }

    private JsonObject finish() throws IOException {
        var mask = new boolean[palette.size()];
        mask[0] = true;
        boolean found = false;
        for (short cell : cells) {
            if (cell != 0) found = true;
            mask[Short.toUnsignedInt(cell)] = true;
        }
        if (!found && entities.isEmpty()) throw new IOException("此投影中没有可预览的方块或实体");
        var colors = new JsonArray();
        var translation = new short[mask.length];
        for (int i = 0; i < translation.length; i++) {
            if (mask[i]) {
                translation[i] = (short) colors.size();
                colors.add(palette.get(i));
            }
        }
        ByteBuffer bytes = ByteBuffer.allocate(cells.length * 2).order(ByteOrder.LITTLE_ENDIAN);
        for (short cell : cells) bytes.putShort(translation[Short.toUnsignedInt(cell)]);
        var json = new JsonObject();
        json.add("size", JsonFiles.JSON.toJsonTree(size));
        json.add("grid", JsonFiles.JSON.toJsonTree(grid));
        json.addProperty("step", step);
        json.add("palette", colors);
        json.addProperty("cells", Base64.getEncoder().encodeToString(bytes.array()));
        json.add("entities", entities);
        json.add("movingBlocks", moving);
        return json;
    }

    private static int[] dimensions(Map<String, Object> input) throws IOException {
        return dimensions(new long[]{unsigned(input.get("Width")), unsigned(input.get("Height")), unsigned(input.get("Length"))});
    }

    private static int[] dimensions(long[] input) throws IOException {
        var result = gridSize(input);
        volume(result);
        return result;
    }

    private static int[] gridSize(long[] input) throws IOException {
        var result = new int[3];
        for (int axis = 0; axis < 3; axis++) {
            if (input[axis] < 1 || input[axis] > MAX_BLOCKS) throw new IOException("投影坐标或尺寸无效");
            result[axis] = (int) input[axis];
        }
        return result;
    }

    private static int volume(int[] length) throws IOException {
        long first = (long) length[0] * length[1];
        if (first > MAX_BLOCKS || first * length[2] > MAX_BLOCKS) throw new IOException("此投影的方块区域过大");
        return (int) (first * length[2]);
    }

    private static long unsigned(Object item) throws IOException {
        return item instanceof Short number ? Short.toUnsignedInt(number) : integer(item);
    }

    private static int integer(Object item) throws IOException {
        if (item instanceof Integer || item instanceof Short || item instanceof Byte) return ((Number) item).intValue();
        throw new IOException("投影中的坐标或尺寸无效");
    }

    private static long[] position(Object item) throws IOException {
        var values = list(item);
        if (values.size() != 3) throw new IOException("投影文件中的坐标或尺寸无效");
        return new long[]{integer(values.get(0)), integer(values.get(1)), integer(values.get(2))};
    }

    private static long[] xyz(Map<String, Object> values) throws IOException {
        return new long[]{integer(values.get("x")), integer(values.get("y")), integer(values.get("z"))};
    }

    private static byte[] bytes(Object item) throws IOException {
        if (item instanceof byte[] bytes) return bytes;
        throw new IOException("投影文件中的方块数组无效");
    }

    private static double number(Object item, double fallback) {
        if (item instanceof Number number && Double.isFinite(number.doubleValue())) return number.doubleValue();
        return fallback;
    }

    private static List<?> list(Object item) { return item instanceof List<?> values ? values : List.of(); }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> map(Object item) {
        return item instanceof Map<?, ?> values ? (Map<String, Object>) values : Map.of();
    }
}
