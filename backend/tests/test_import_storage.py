"""Regression coverage for large vocabulary imports and existing SQLite databases."""

import asyncio
import gc
import io
import sqlite3
import tempfile
import unittest
from contextlib import ExitStack, closing
from pathlib import Path
from unittest.mock import patch

from starlette.datastructures import UploadFile

from backend import main, storage


class ImportStorageTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self._cleanup_directory)
        self.data_dir = Path(self.directory.name)
        self.patches = ExitStack()
        self.addCleanup(self.patches.close)
        for module in (main, storage):
            self.patches.enter_context(patch.object(module, "DATA_DIR", self.data_dir))
        self.patches.enter_context(patch.object(storage, "DB_PATH", self.data_dir / "reading_vocab.sqlite3"))
        for name in (
            "LIBRARIES_PATH", "USER_STATUS_PATH", "AI_SETTINGS_PATH", "AI_CACHE_PATH",
            "OLD_BOOK_VOCAB_PATH", "OLD_EXTRA_VOCAB_PATH",
        ):
            self.patches.enter_context(patch.object(main, name, self.data_dir / getattr(main, name).name))

    def _cleanup_directory(self):
        # sqlite3's connection context manager commits but does not close on Windows.
        gc.collect()
        self.directory.cleanup()

    def test_initialize_upgrades_legacy_db_with_child_indexes(self):
        storage.initialize()
        with closing(sqlite3.connect(storage.DB_PATH)) as conn:
            conn.execute("DROP INDEX idx_locations_entry")
            conn.execute("DROP INDEX idx_custom_fields_entry")
            conn.commit()

        storage.initialize()  # Existing databases also receive the new indexes.
        with closing(sqlite3.connect(storage.DB_PATH)) as conn:
            for table, index, query in (
                ("entry_locations", "idx_locations_entry",
                 "SELECT unit, page FROM entry_locations WHERE entry_id = 1 ORDER BY location_order, id"),
                ("entry_custom_fields", "idx_custom_fields_entry",
                 "SELECT field_name, field_value FROM entry_custom_fields WHERE entry_id = 1 ORDER BY id"),
            ):
                indexes = {row[1] for row in conn.execute(f"PRAGMA index_list({table})")}
                self.assertIn(index, indexes)
                plan = " ".join(str(row) for row in conn.execute("EXPLAIN QUERY PLAN " + query))
                self.assertIn(index, plan)

    def test_preview_confirm_preserves_existing_entries_and_custom_fields(self):
        main.ensure_data_files()
        existing = {
            "id": "existing", "name": "Existing", "type": "main", "createdAt": "2026-01-01",
            "entries": [
                {"lemma": f"existing{i}", "unit": "Unit A", "page": i,
                 "locations": [{"unit": "Unit A", "page": i}, {"unit": "Unit B", "page": i}],
                 "customFields": {"part": "noun", "note": f"note {i}"}}
                for i in range(1200)
            ],
        }
        storage.save_libraries([existing])
        content = ("word,meaning,unit,note\n" + "".join(
            f"newword{i},meaning {i},Unit C,detail {i}\n" for i in range(100)
        )).encode()
        preview = asyncio.run(main.vocab_import_preview(
            UploadFile(filename="words.csv", file=io.BytesIO(content))
        ))
        self.assertEqual(preview["recognizedCount"], 100)
        result = main.vocab_import_confirm(main.ImportConfirmRequest(
            libraryName="New", headers=preview["headers"], rows=preview["rows"],
            mapping=preview["mapping"],
        ))
        self.assertEqual(result["importedCount"], 100)
        libraries = {library["id"]: library for library in storage.load_libraries()}
        self.assertEqual(len(libraries["existing"]["entries"]), 1200)
        self.assertEqual(len(libraries[result["library"]["id"]]["entries"]), 100)
        self.assertEqual(libraries["existing"]["entries"][0]["locations"], [
            {"unit": "Unit A", "page": 0}, {"unit": "Unit B", "page": 0},
        ])
        self.assertEqual(libraries["existing"]["entries"][0]["customFields"],
                         {"part": "noun", "note": "note 0"})
        self.assertEqual(libraries[result["library"]["id"]]["entries"][0]["customFields"],
                         {"note": "detail 0"})


if __name__ == "__main__":
    unittest.main()
