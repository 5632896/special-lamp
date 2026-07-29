from __future__ import annotations

import os
import sys
from pathlib import Path

APP_NAME = "英语阅读工具"
BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def resource_path(*parts: str) -> Path:
    """Return a read-only bundled resource path or its source-tree equivalent."""
    root = Path(getattr(sys, "_MEIPASS", PROJECT_ROOT)) if is_frozen() else PROJECT_ROOT
    return root.joinpath(*parts)


def data_dir() -> Path:
    """Return the writable directory for SQLite and local learning data."""
    if not is_frozen():
        return BACKEND_DIR / "data"

    local_app_data = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    return local_app_data / APP_NAME / "data"


DATA_DIR = data_dir()
FRONTEND_DIST_DIR = resource_path("frontend_dist") if is_frozen() else PROJECT_ROOT / "frontend" / "dist"