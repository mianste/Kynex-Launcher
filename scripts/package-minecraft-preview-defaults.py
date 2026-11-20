"""Compact mcmeta's versioned Java block defaults for local schematic previews."""

import argparse
import json
import re
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("registries", type=Path, help="directory of <version>.json summary registries")
    args = parser.parse_args()
    sources = sorted(
        (path for path in args.registries.glob("*.json") if re.fullmatch(r"\d+\.\d+(?:\.\d+)?", path.stem)),
        key=lambda path: tuple(map(int, path.stem.split("."))),
    )
    if not sources:
        parser.error("no Java version registries found")

    changes = {}
    previous = {}
    for index, source in enumerate(sources):
        raw = json.loads(source.read_text(encoding="utf-8"))
        current = {
            name: ",".join(f"{key}={value}" for key, value in sorted(entry[1].items()))
            for name, entry in raw.items()
            if entry[1]
        }
        if current.get("spruce_log") != "axis=y":
            raise ValueError(f"Unexpected block registry format in {source.name}")
        for name in sorted(previous.keys() | current.keys()):
            if previous.get(name) != current.get(name):
                changes.setdefault(name, []).append([index, current.get(name)])
        previous = current

    output = Path(__file__).resolve().parents[1] / "config" / "minecraft-preview-defaults.json"
    packed = {"versions": [source.stem for source in sources], "blocks": changes}
    output.write_text(json.dumps(packed, separators=(",", ":"), sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote {len(changes)} block defaults across {len(sources)} Java versions")


if __name__ == "__main__":
    main()
