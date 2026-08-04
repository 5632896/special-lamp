from __future__ import annotations

import json
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from .runtime_paths import DATA_DIR
except ImportError:
    from runtime_paths import DATA_DIR

DB_PATH = DATA_DIR / "reading_vocab.sqlite3"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_json_value(value: str | None, default: Any) -> Any:
    try:
        parsed = json.loads(value or "")
        return parsed
    except (TypeError, json.JSONDecodeError):
        return default


def _connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialize() -> None:
    with _connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS libraries (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                created_at TEXT NOT NULL,
                display_config_json TEXT NOT NULL DEFAULT '{}',
                field_definitions_json TEXT NOT NULL DEFAULT '[]'
            );
            CREATE TABLE IF NOT EXISTS vocab_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
                lemma TEXT NOT NULL,
                frequency TEXT NOT NULL DEFAULT 'low',
                in_syllabus INTEGER NOT NULL DEFAULT 1,
                meaning TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS entry_locations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entry_id INTEGER NOT NULL REFERENCES vocab_entries(id) ON DELETE CASCADE,
                unit TEXT,
                page INTEGER,
                location_order INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS entry_custom_fields (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entry_id INTEGER NOT NULL REFERENCES vocab_entries(id) ON DELETE CASCADE,
                field_name TEXT NOT NULL,
                field_value TEXT
            );
            CREATE TABLE IF NOT EXISTS user_vocab_status (
                lemma TEXT PRIMARY KEY,
                level INTEGER NOT NULL DEFAULT 0,
                last_mark TEXT,
                updated_at TEXT,
                seen_count INTEGER NOT NULL DEFAULT 0,
                known_streak INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ai_cache (
                cache_type TEXT NOT NULL,
                cache_key TEXT NOT NULL,
                value_json TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (cache_type, cache_key)
            );
            CREATE TABLE IF NOT EXISTS review_schedule (
                lemma TEXT PRIMARY KEY,
                due_at TEXT,
                interval_days INTEGER NOT NULL DEFAULT 0,
                repetitions INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS chat_sessions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                files_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_entries_library_lemma ON vocab_entries(library_id, lemma);
            CREATE INDEX IF NOT EXISTS idx_review_due ON review_schedule(due_at);
            """
        )
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(libraries)").fetchall()}
        if "display_config_json" not in columns:
            conn.execute("ALTER TABLE libraries ADD COLUMN display_config_json TEXT NOT NULL DEFAULT '{}'")
        if "field_definitions_json" not in columns:
            conn.execute("ALTER TABLE libraries ADD COLUMN field_definitions_json TEXT NOT NULL DEFAULT '[]'")


def _entry_from_row(conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    locations = conn.execute(
        "SELECT unit, page FROM entry_locations WHERE entry_id = ? ORDER BY location_order, id",
        (row["id"],),
    ).fetchall()
    fields = conn.execute(
        "SELECT field_name, field_value FROM entry_custom_fields WHERE entry_id = ? ORDER BY id",
        (row["id"],),
    ).fetchall()
    first = locations[0] if locations else None
    custom_fields = {field["field_name"]: field["field_value"] for field in fields}
    return {
        "entryId": row["id"],
        "lemma": row["lemma"],
        "unit": first["unit"] if first else "Imported",
        "page": first["page"] if first else None,
        "locations": [{"unit": loc["unit"], "page": loc["page"]} for loc in locations],
        "frequency": row["frequency"],
        "in_syllabus": bool(row["in_syllabus"]),
        "meaning": row["meaning"],
        "order": row["sort_order"],
        "customFields": custom_fields,
    }


def load_libraries() -> list[dict[str, Any]]:
    initialize()
    with _connect() as conn:
        libraries = conn.execute("SELECT * FROM libraries ORDER BY created_at, id").fetchall()
        result = []
        for library in libraries:
            rows = conn.execute(
                "SELECT * FROM vocab_entries WHERE library_id = ? ORDER BY sort_order, id",
                (library["id"],),
            ).fetchall()
            result.append({
                "id": library["id"], "name": library["name"], "type": library["type"],
                "createdAt": library["created_at"],
                "displayConfig": _read_json_value(library["display_config_json"], {}),
                "fieldDefinitions": _read_json_value(library["field_definitions_json"], []),
                "entries": [_entry_from_row(conn, row) for row in rows],
            })
        return result


def save_libraries(libraries: list[dict[str, Any]]) -> None:
    initialize()
    with _connect() as conn:
        conn.execute("DELETE FROM libraries")
        for library in libraries:
            library_id = str(library.get("id") or "")
            if not library_id:
                continue
            conn.execute(
                 "INSERT INTO libraries(id, name, type, created_at, display_config_json, field_definitions_json) VALUES (?, ?, ?, ?, ?, ?)",
                (library_id, str(library.get("name") or "未命名词库"), str(library.get("type") or "main"),
                  str(library.get("createdAt") or now_iso()),
                  json.dumps(library.get("displayConfig") or {}, ensure_ascii=False),
                  json.dumps(library.get("fieldDefinitions") or [], ensure_ascii=False)),
            )
            for order, source in enumerate(library.get("entries") or []):
                lemma = str(source.get("lemma") or "").strip().lower()
                if not lemma:
                    continue
                cursor = conn.execute(
                    """INSERT INTO vocab_entries(library_id, lemma, frequency, in_syllabus, meaning, sort_order)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (library_id, lemma, str(source.get("frequency") or "low"),
                     int(bool(source.get("in_syllabus", True))), source.get("meaning"),
                     int(source.get("order", order))),
                )
                entry_id = cursor.lastrowid
                locations = source.get("locations") or [{"unit": source.get("unit") or "Imported", "page": source.get("page")}]
                for location_order, location in enumerate(locations):
                    conn.execute(
                        "INSERT INTO entry_locations(entry_id, unit, page, location_order) VALUES (?, ?, ?, ?)",
                        (entry_id, location.get("unit") or "Imported", location.get("page"), location_order),
                    )
                for field_name, field_value in (source.get("customFields") or {}).items():
                    if field_name and field_value is not None:
                        conn.execute(
                            "INSERT INTO entry_custom_fields(entry_id, field_name, field_value) VALUES (?, ?, ?)",
                            (entry_id, str(field_name), str(field_value)),
                        )


def load_user_status() -> dict[str, dict[str, Any]]:
    initialize()
    with _connect() as conn:
        rows = conn.execute("SELECT * FROM user_vocab_status").fetchall()
    return {row["lemma"]: {"level": row["level"], "lastMark": row["last_mark"], "updatedAt": row["updated_at"], "seenCount": row["seen_count"], "knownStreak": row["known_streak"]} for row in rows}


def save_user_status(status: dict[str, dict[str, Any]]) -> None:
    initialize()
    with _connect() as conn:
        conn.execute("DELETE FROM user_vocab_status")
        for lemma, value in status.items():
            conn.execute(
                "INSERT INTO user_vocab_status(lemma, level, last_mark, updated_at, seen_count, known_streak) VALUES (?, ?, ?, ?, ?, ?)",
                (lemma, int(value.get("level", 0)), value.get("lastMark"), value.get("updatedAt"), int(value.get("seenCount", 0)), int(value.get("knownStreak", 0))),
            )


def load_setting(key: str, default: Any) -> Any:
    initialize()
    with _connect() as conn:
        row = conn.execute("SELECT value_json FROM app_settings WHERE key = ?", (key,)).fetchone()
    if not row:
        return default
    try:
        return json.loads(row["value_json"])
    except json.JSONDecodeError:
        return default


def save_setting(key: str, value: Any) -> None:
    initialize()
    with _connect() as conn:
        conn.execute("INSERT OR REPLACE INTO app_settings(key, value_json) VALUES (?, ?)", (key, json.dumps(value, ensure_ascii=False)))


def load_ai_cache() -> dict[str, dict]:
    initialize()
    result = {"word": {}, "article": {}, "chat": {}}
    with _connect() as conn:
        rows = conn.execute("SELECT cache_type, cache_key, value_json FROM ai_cache").fetchall()
    for row in rows:
        if row["cache_type"] not in result:
            continue
        try:
            result[row["cache_type"]][row["cache_key"]] = json.loads(row["value_json"])
        except json.JSONDecodeError:
            continue
    return result


def save_ai_cache(cache: dict) -> None:
    initialize()
    with _connect() as conn:
        conn.execute("DELETE FROM ai_cache")
        for cache_type in ("word", "article", "chat"):
            for cache_key, value in (cache.get(cache_type) or {}).items():
                conn.execute(
                    "INSERT INTO ai_cache(cache_type, cache_key, value_json, updated_at) VALUES (?, ?, ?, ?)",
                    (cache_type, cache_key, json.dumps(value, ensure_ascii=False), str(value.get("updatedAt") or now_iso())),
                )


def get_review_schedule(lemma: str) -> dict[str, Any]:
    initialize()
    with _connect() as conn:
        row = conn.execute("SELECT * FROM review_schedule WHERE lemma = ?", (lemma,)).fetchone()
    if not row:
        return {"lemma": lemma, "dueAt": None, "intervalDays": 0, "repetitions": 0}
    return {
        "lemma": row["lemma"], "dueAt": row["due_at"],
        "intervalDays": row["interval_days"], "repetitions": row["repetitions"],
    }


def save_review_schedule(lemma: str, due_at: str, interval_days: int, repetitions: int) -> None:
    initialize()
    with _connect() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO review_schedule
               (lemma, due_at, interval_days, repetitions, updated_at) VALUES (?, ?, ?, ?, ?)""",
            (lemma, due_at, interval_days, repetitions, now_iso()),
        )


def get_due_review_schedules(now: str) -> dict[str, dict[str, Any]]:
    initialize()
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM review_schedule WHERE due_at IS NULL OR due_at <= ?", (now,)
        ).fetchall()
    return {
        row["lemma"]: {"dueAt": row["due_at"], "intervalDays": row["interval_days"], "repetitions": row["repetitions"]}
        for row in rows
    }


def clear_review_schedules() -> None:
    initialize()
    with _connect() as conn:
        conn.execute("DELETE FROM review_schedule")


def list_chat_sessions() -> list[dict[str, Any]]:
    initialize()
    with _connect() as conn:
        rows = conn.execute("SELECT * FROM chat_sessions ORDER BY updated_at DESC, id DESC").fetchall()
    return [{"id": row["id"], "title": row["title"], "createdAt": row["created_at"], "updatedAt": row["updated_at"]} for row in rows]


def create_chat_session(session_id: str, title: str) -> dict[str, Any]:
    initialize()
    created_at = now_iso()
    with _connect() as conn:
        conn.execute(
            "INSERT INTO chat_sessions(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (session_id, title, created_at, created_at),
        )
    return {"id": session_id, "title": title, "createdAt": created_at, "updatedAt": created_at}


def get_chat_session(session_id: str) -> dict[str, Any] | None:
    initialize()
    with _connect() as conn:
        session = conn.execute("SELECT * FROM chat_sessions WHERE id = ?", (session_id,)).fetchone()
        if not session:
            return None
        rows = conn.execute("SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id", (session_id,)).fetchall()
    messages = []
    for row in rows:
        try:
            files = json.loads(row["files_json"])
        except json.JSONDecodeError:
            files = []
        messages.append({"id": f"message-{row['id']}", "role": row["role"], "content": row["content"], "files": files, "updatedAt": row["created_at"]})
    return {"id": session["id"], "title": session["title"], "createdAt": session["created_at"], "updatedAt": session["updated_at"], "messages": messages}


def append_chat_message(session_id: str, role: str, content: str, files: list[dict] | None = None) -> dict[str, Any]:
    initialize()
    created_at = now_iso()
    serialized_files = json.dumps(files or [], ensure_ascii=False)
    with _connect() as conn:
        cursor = conn.execute(
            "INSERT INTO chat_messages(session_id, role, content, files_json, created_at) VALUES (?, ?, ?, ?, ?)",
            (session_id, role, content, serialized_files, created_at),
        )
        conn.execute("UPDATE chat_sessions SET updated_at = ? WHERE id = ?", (created_at, session_id))
    return {"id": f"message-{cursor.lastrowid}", "role": role, "content": content, "files": files or [], "updatedAt": created_at}


def rename_chat_session(session_id: str, title: str) -> None:
    initialize()
    with _connect() as conn:
        conn.execute("UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?", (title, now_iso(), session_id))


def delete_chat_session(session_id: str) -> bool:
    initialize()
    with _connect() as conn:
        cursor = conn.execute("DELETE FROM chat_sessions WHERE id = ?", (session_id,))
    return cursor.rowcount > 0


def migrate_json_once(default_settings: dict) -> bool:
    """Copies legacy JSON into SQLite once and preserves a timestamped backup."""
    initialize()
    with _connect() as conn:
        existing = conn.execute("SELECT 1 FROM app_settings WHERE key = 'json_migration_complete'").fetchone()
    if existing:
        return False
    paths = {
        "libraries": DATA_DIR / "vocab_libraries.json",
        "status": DATA_DIR / "user_vocab_status.json",
        "settings": DATA_DIR / "ai_settings.json",
        "cache": DATA_DIR / "ai_cache.json",
    }
    stamp = datetime.now().strftime("%Y%m%d%H%M%S")
    backup_dir = DATA_DIR / "json-backups" / stamp
    backup_dir.mkdir(parents=True, exist_ok=True)
    def read(path: Path, fallback: Any) -> Any:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            shutil.copy2(path, backup_dir / path.name)
            return value
        except (FileNotFoundError, json.JSONDecodeError):
            return fallback
    libraries = read(paths["libraries"], [])
    status = read(paths["status"], {})
    settings = read(paths["settings"], default_settings)
    cache = read(paths["cache"], {"word": {}, "article": {}, "chat": {}})
    if isinstance(libraries, list) and libraries:
        save_libraries(libraries)
    if isinstance(status, dict):
        save_user_status(status)
    if isinstance(settings, dict):
        settings.pop("apiKey", None)
        save_setting("ai_settings", settings)
    if isinstance(cache, dict):
        save_ai_cache(cache)
    save_setting("json_migration_complete", {"completedAt": now_iso(), "backup": str(backup_dir)})
    return True
