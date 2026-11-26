"""Compile the launcher Java component and assemble its private Windows runtime."""

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ARCHIVE_JARS = (
    "commons-compress-1.28.0.jar",
    "commons-io-2.20.0.jar",
    "commons-lang3-3.18.0.jar",
    "commons-codec-1.19.0.jar",
    "xz-1.12.jar",
)


def build(jdk: Path, gson: Path, output: Path, swt: Path | None = None, jna: Path | None = None,
          leveldb: Path | None = None, bouncy: Path | None = None) -> None:
    project = Path(__file__).resolve().parent.parent / "src-java/src"
    sources = sorted((project / "main/java").rglob("*.java"))
    jdk_bin = jdk.resolve(strict=True) / "bin"
    gson = gson.resolve(strict=True)
    output = output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    suffix = ".exe" if os.name == "nt" else ""
    archive_jars = [(gson.parent / name).resolve(strict=True) for name in ARCHIVE_JARS]
    jars = [gson, *archive_jars]
    modules = ["java.base", "java.desktop", "java.net.http", "jdk.charsets", "jdk.crypto.ec", "jdk.naming.dns", "jdk.management"]
    if swt:
        if not jna or not leveldb or not bouncy:
            raise ValueError("Desktop builds require the JNA, LevelDB, and Bouncy Castle JARs")
        jars.append(swt.resolve(strict=True))
        jars.append(jna.resolve(strict=True))
        jars.append(leveldb.resolve(strict=True))
        jars.append(bouncy.resolve(strict=True))
        sources.extend(sorted((project / "desktop/java").rglob("*.java")))
        modules.extend(["jdk.httpserver", "java.logging", "java.xml", "jdk.unsupported"])

    def tool(name: str, *arguments: str) -> None:
        subprocess.run([str(jdk_bin / (name + suffix)), *arguments], check=True)

    with tempfile.TemporaryDirectory(prefix="kynex-core-") as classes:
        tool("javac", "--release", "21", "-encoding", "UTF-8", "-d", classes,
             "-cp", os.pathsep.join(map(str, jars)), *(str(path) for path in sources))
        config = Path(__file__).resolve().parent.parent / "config"
        catalog = Path(classes) / "schematic-catalog"
        catalog.mkdir()
        shutil.copyfile(config / "schematic-catalog.json", catalog / "index.json")
        shutil.copyfile(config / "minecraft-preview-defaults.json", Path(classes) / "minecraft-preview-defaults.json")
        for schematic in sorted((config / "schematic-files").glob("*.litematic")):
            shutil.copyfile(schematic, catalog / schematic.name)
        for directory in ("pack-templates", "mod-templates"):
            shutil.copytree(config / directory, Path(classes) / directory)
        for name in ("localization-sources.json", "localization-glossary.json", "performance-mods.json"):
            shutil.copyfile(config / name, Path(classes) / name)
        if swt:
            for asset in (project / "desktop/resources").glob("*.js"):
                shutil.copyfile(asset, Path(classes) / asset.name)
            for name in ("optifine-versions.json", "forge-maven.xml", "neoforge-maven.xml",
                         "fabric-game.json", "fabric-loader.json", "quilt-game.json", "quilt-loader.json",
                         "version-manifest.json"):
                shutil.copyfile(project / "desktop/resources" / name, Path(classes) / name)
            for name in ("build-channel.json", "update-sources.json", "updater-public-key.txt"):
                shutil.copyfile(config / name, Path(classes) / name)
        tool("jar", "--create", "--file", str(output / "core.jar"), "-C", classes, ".")
    shutil.copyfile(gson, output / "gson.jar")
    for jar in archive_jars:
        shutil.copyfile(jar, output / jar.name)
    if swt:
        shutil.copyfile(swt, output / "swt.jar")
        shutil.copyfile(jna, output / "jna.jar")
        shutil.copyfile(leveldb, output / "leveldb.jar")
        shutil.copyfile(bouncy, output / "bcprov.jar")
    tool("jlink", "--add-modules", ",".join(modules), "--strip-debug",
         "--no-header-files", "--no-man-pages", "--compress", "zip-6",
         "--output", str(output / "runtime"))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jdk", type=Path, required=True)
    parser.add_argument("--gson-jar", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--swt-jar", type=Path)
    parser.add_argument("--jna-jar", type=Path)
    parser.add_argument("--leveldb-jar", type=Path)
    parser.add_argument("--bouncy-jar", type=Path)
    args = parser.parse_args()
    build(args.jdk, args.gson_jar, args.output, args.swt_jar, args.jna_jar, args.leveldb_jar, args.bouncy_jar)
