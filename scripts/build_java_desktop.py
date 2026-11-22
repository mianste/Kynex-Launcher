"""Create the Windows application image using the launcher’s private Java runtime."""

import argparse
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

from build_java_core import ARCHIVE_JARS, build

ROOT = Path(__file__).resolve().parent.parent


def application_image(jdk: Path, gson: Path, swt: Path, jna: Path, leveldb: Path, bouncy: Path,
                      frontend: Path, destination: Path) -> Path:
    channel = json.loads((ROOT / "config/build-channel.json").read_text(encoding="utf-8"))
    name = channel["mainBinaryName"]
    if channel["channel"] != "stable" or name != "Kynex Launcher Source" or channel["identifier"] != "com.keke.kynex.source":
        raise ValueError("The build requires the public source app identity")
    if not (frontend / "index.html").is_file():
        raise ValueError("Build the frontend before packaging the Java desktop application")
    image = destination.resolve() / name
    if image.exists():
        raise FileExistsError(image)
    destination.mkdir(parents=True, exist_ok=True)
    jpackage = jdk.resolve(strict=True) / "bin/jpackage.exe"
    with tempfile.TemporaryDirectory(prefix="kynex-desktop-", dir=destination) as temporary:
        stage = Path(temporary)
        work = stage / "core"
        build(jdk, gson, work, swt, jna, leveldb, bouncy)
        inputs = stage / "input"
        inputs.mkdir()
        for name_in_image in ("core.jar", "gson.jar", "swt.jar", "jna.jar", "leveldb.jar", "bcprov.jar", *ARCHIVE_JARS):
            shutil.copyfile(work / name_in_image, inputs / name_in_image)
        shutil.copyfile(ROOT / "docs/THIRD-PARTY-NOTICES.txt", inputs / "THIRD-PARTY-NOTICES.txt")
        shutil.copytree(ROOT / "docs/licenses", inputs / "licenses")
        shutil.copytree(frontend.resolve(strict=True), inputs / "dist")
        subprocess.run([str(jpackage), "--type", "app-image", "--name", name,
                        "--app-version", channel["version"], "--vendor", "keke",
                        "--icon", str(ROOT / "installer/assets/icon.ico"),
                        "--dest", str(destination.resolve()), "--input", str(inputs),
                        "--runtime-image", str(work / "runtime"), "--main-jar", "core.jar",
                        "--main-class", "com.keke.kynex.core.JavaDesktop", "--java-options", "-Dfile.encoding=UTF-8"], check=True)
    expected = [image / f"{name}.exe", image / "app/dist/index.html", image / "runtime/bin/java.exe"]
    if not all(file.is_file() for file in expected):
        raise RuntimeError("The Java desktop application image is incomplete")
    (image / "app/kynex-update-owned").write_text(channel["identifier"] + "\n", encoding="ascii")
    (image / "runtime/kynex-update-owned").write_text(channel["identifier"] + "\n", encoding="ascii")
    return image


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jdk", type=Path, required=True)
    parser.add_argument("--gson-jar", type=Path, required=True)
    parser.add_argument("--swt-jar", type=Path, required=True)
    parser.add_argument("--jna-jar", type=Path, required=True)
    parser.add_argument("--leveldb-jar", type=Path, required=True)
    parser.add_argument("--bouncy-jar", type=Path, required=True)
    parser.add_argument("--frontend", type=Path, default=ROOT / "dist")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(application_image(args.jdk, args.gson_jar, args.swt_jar, args.jna_jar, args.leveldb_jar, args.bouncy_jar, args.frontend, args.output))
