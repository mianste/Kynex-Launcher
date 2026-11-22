package com.keke.kynex.core;

import java.io.DataOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.zip.GZIPOutputStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import static org.junit.jupiter.api.Assertions.*;

final class SchematicMigrationTest {
    @Test
    void returnsLittleEndianCellsAndLegacyBlockProperties(@TempDir Path root) throws Exception {
        Path path = root.resolve("sample.schematic");
        try (var output = new DataOutputStream(new GZIPOutputStream(Files.newOutputStream(path)))) {
            output.writeByte(10);
            output.writeUTF("Schematic");
            size(output);
            output.writeByte(7);
            output.writeUTF("Blocks");
            output.writeInt(2);
            output.write(new byte[]{53, 1});
            output.writeByte(7);
            output.writeUTF("Data");
            output.writeInt(2);
            output.write(new byte[]{4, 1});
            output.writeByte(0);
        }
        var result = SchematicPreview.read(path);
        var palette = result.getAsJsonArray("palette");
        var cells = ByteBuffer.wrap(Base64.getDecoder().decode(result.get("cells").getAsString())).order(ByteOrder.LITTLE_ENDIAN);
        assertEquals(3, palette.size());
        assertEquals("oak_stairs[facing=east,half=top,shape=straight,waterlogged=false]", palette.get(cells.getShort()).getAsString());
        assertEquals("granite", palette.get(cells.getShort()).getAsString());
    }

    @Test
    void rejectsAnArrayThatDeclaresMoreBytesThanTheFileContains(@TempDir Path root) throws Exception {
        Path path = root.resolve("broken.schematic");
        try (var output = new DataOutputStream(Files.newOutputStream(path))) {
            output.writeByte(10);
            output.writeUTF("");
            size(output);
            output.writeByte(7);
            output.writeUTF("Blocks");
            output.writeInt(Integer.MAX_VALUE);
            output.writeByte(1);
        }
        assertThrows(IOException.class, () -> SchematicPreview.read(path));
    }

    private static void size(DataOutputStream output) throws IOException {
        for (String axis : new String[]{"Width", "Height", "Length"}) {
            output.writeByte(2);
            output.writeUTF(axis);
            output.writeShort(axis.equals("Width") ? 2 : 1);
        }
    }
}
