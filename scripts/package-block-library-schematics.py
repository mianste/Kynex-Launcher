"""Package Block Library's CC0 public layer plans as Litematica 1.21 files."""

import argparse
import gzip
import hashlib
import json
from pathlib import Path
from struct import pack


def string(text):
    data = text.encode("ascii")
    return pack(">H", len(data)) + data


def tag(kind, name, data):
    return bytes([kind]) + string(name) + data


def compound(*fields):
    return b"".join(fields) + b"\x00"


def number(name, value):
    return tag(3, name, pack(">i", value))


def timestamp(name):
    # The source release's date. A fixed value makes the repackage reproducible.
    return tag(4, name, pack(">q", 1791590400000))


def text(name, value):
    return tag(8, name, string(value))


def coordinate(name, values):
    return tag(10, name, compound(*(number(axis, value) for axis, value in zip("xyz", values))))


def palette_entry(state):
    block, bracket, settings = state.partition("[")
    fields = [text("Name", block)]
    if bracket:
        properties = sorted(setting.split("=", 1) for setting in settings.removesuffix("]").split(","))
        fields.append(tag(10, "Properties", compound(*(text(key, value) for key, value in properties))))
    return compound(*fields)


def package(plan, source_url):
    width, height, depth = plan["size"]
    total = width * height * depth
    states = ["minecraft:air", *plan["palette"]]
    bits = max(2, (len(states) - 1).bit_length())
    words = [0] * ((total * bits + 63) // 64)
    occupied = set()
    for x, y, z, palette_index in plan["blocks"]:
        if not (0 <= x < width and 0 <= y < height and 0 <= z < depth and 0 <= palette_index < len(states) - 1):
            raise ValueError(f"Invalid block position or state {x, y, z, palette_index}")
        index = x + width * (z + depth * y)
        if index in occupied:
            raise ValueError(f"Duplicate block position {x, y, z}")
        occupied.add(index)
        word, shift = divmod(index * bits, 64)
        value = palette_index + 1
        words[word] |= (value << shift) & ((1 << 64) - 1)
        if shift + bits > 64:
            words[word + 1] |= value >> (64 - shift)

    palette = tag(9, "BlockStatePalette", pack(">Bi", 10, len(states)) + b"".join(map(palette_entry, states)))
    blocks = tag(12, "BlockStates", pack(">i", len(words)) + b"".join(pack(">Q", word) for word in words))
    region = compound(
        coordinate("Position", (0, 0, 0)), coordinate("Size", plan["size"]), palette, blocks,
        *(tag(9, name, pack(">Bi", 10, 0)) for name in (
            "TileEntities", "Entities", "PendingBlockTicks", "PendingFluidTicks",
        )),
    )
    metadata = compound(
        text("Name", plan["title"]), text("Author", "Block Library"),
        text("Description", f"CC0-1.0. Repackaged from Block Library's public block plan: {source_url}"),
        number("RegionCount", 1), number("TotalVolume", total), number("TotalBlocks", len(occupied)),
        coordinate("EnclosingSize", plan["size"]), timestamp("TimeCreated"), timestamp("TimeModified"),
    )
    nbt = compound(
        number("Version", 7), number("SubVersion", 1), number("MinecraftDataVersion", 3955),
        tag(10, "Metadata", metadata), tag(10, "Regions", compound(tag(10, "Build", region))),
    )
    return gzip.compress(tag(10, "", nbt), mtime=0)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_dir", type=Path, help="directory with the public cabin.json, pavilion.json, bridge.json")
    args = parser.parse_args()
    output = Path(__file__).resolve().parents[1] / "config" / "schematic-files"
    output.mkdir(exist_ok=True)
    for kind, count, source_hash in [
        ("cabin", 1566, "74036e0387a9c185da1dc071f691576b3910e1fb99f77898792a9ac5840f96f9"),
        ("pavilion", 1853, "dc33279fa9b01ae384b0df77b640be91ac21e37a847a265285cd5a32e4f5b51e"),
        ("bridge", 1431, "7789c160af4c1fba023ddda4141332c15549f72b7cc7542bbd69a644c3fc11c7"),
    ]:
        plan = json.loads((args.source_dir / f"{kind}.json").read_text(encoding="utf-8"))
        if plan["schematicSha256"] != source_hash or len(plan["blocks"]) != count:
            raise ValueError(f"The source plan for {kind} has changed")
        data = package(plan, f"https://blocklibrary.net/guides/plans/{kind}.json")
        path = output / f"block-library-{kind}.litematic"
        path.write_bytes(data)
        print(f"{path.name} {hashlib.sha256(data).hexdigest()}")


if __name__ == "__main__":
    main()
