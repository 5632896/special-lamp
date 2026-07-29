from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "src-tauri" / "resources" / "vocab-api.exe"


def main() -> None:
    pyinstaller = [sys.executable, "-m", "PyInstaller"]
    work_dir = ROOT / "build" / "tauri-sidecar"
    dist_dir = work_dir / "dist"
    subprocess.run(
        [
            *pyinstaller,
            "--noconfirm",
            "--clean",
            "--onefile",
            "--name",
            "vocab-api",
            "--distpath",
            str(dist_dir),
            "--workpath",
            str(work_dir / "work"),
            "--specpath",
            str(work_dir / "spec"),
            "--collect-all",
            "simplemma",
            str(ROOT / "backend" / "sidecar.py"),
        ],
        cwd=ROOT,
        check=True,
    )
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(dist_dir / "vocab-api.exe", OUTPUT)
    print(f"FastAPI sidecar 已生成：{OUTPUT}")


if __name__ == "__main__":
    main()