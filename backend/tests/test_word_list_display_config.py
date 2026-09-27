"""Pure configuration tests; no HTTP server, SQLite, or application data required."""

import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from backend import main, storage


class WordListDisplayConfigTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        data_dir = Path(directory.name)
        for module in (main, storage):
            context = patch.object(module, "DATA_DIR", data_dir)
            context.start()
            self.addCleanup(context.stop)
        context = patch.object(storage, "DB_PATH", data_dir / "test.sqlite3")
        context.start()
        self.addCleanup(context.stop)
        self.library = {
            "entries": [{"customFields": {"notes": "A note"}}],
            "fieldDefinitions": [{"key": "chapter", "label": "Chapter"}],
        }

    def test_defaults_are_independent_and_use_supported_word_fields(self):
        first = main.default_display_config(self.library)
        self.assertEqual(first["listLayout"], "list")
        self.assertEqual([field["source"] for field in first["wordListFields"]],
                         ["meaning", "ipa", "unit"])
        self.assertTrue(all(field["displayType"] == "text" and field["enabled"]
                            for field in first["wordListFields"]))
        first["wordListFields"][0]["label"] = "changed"
        self.assertEqual(main.default_display_config(self.library)["wordListFields"][0]["label"], "释义")

    def test_legacy_settings_are_validated_and_normalized_without_new_keys(self):
        legacy = main.default_display_config(self.library)
        del legacy["wordListFields"]
        del legacy["listLayout"]
        legacy.update(listMode="browse", rushMode="browse", detailPlacement="floating",
                      allowMultipleExpanded=False)
        saved = main.validate_display_config(self.library, legacy)
        self.assertEqual(saved["listMode"], "browse")
        self.assertEqual(saved["rushMode"], "browse")
        self.assertEqual(saved["detailPlacement"], "floating")
        self.assertFalse(saved["allowMultipleExpanded"])
        self.assertEqual(saved["listLayout"], "list")
        self.assertEqual(len(saved["wordListFields"]), 3)
        self.library["displayConfig"] = legacy
        normalized = main.normalized_display_config(self.library)
        self.assertEqual(normalized["listMode"], "browse")
        self.assertEqual(normalized["listLayout"], "list")
        self.assertEqual(normalized["wordListFields"], saved["wordListFields"])

    def test_missing_or_old_stored_word_list_fields_default_but_explicit_empty_survives(self):
        defaults = main.default_display_config(self.library)
        for stored in (None, {}, {"listLayout": "tiles"}, {"wordListFields": "invalid"}):
            self.library["displayConfig"] = stored
            normalized = main.normalized_display_config(self.library)
            self.assertEqual(normalized["wordListFields"], defaults["wordListFields"])

        # An empty list is intentional only for wordListFields; other groups keep
        # their existing empty-list fallback behavior.
        self.library["displayConfig"] = {"wordListFields": [], "focusFields": [],
                                         "listLayout": "tiles"}
        normalized = main.normalized_display_config(self.library)
        self.assertEqual(normalized["wordListFields"], [])
        self.assertEqual(normalized["focusFields"], defaults["focusFields"])
        self.assertEqual(normalized["listLayout"], "tiles")

    def test_explicit_empty_word_list_fields_validation_and_put_get_round_trip(self):
        self.library["id"] = "test-library"
        payload = main.default_display_config(self.library)
        payload["wordListFields"] = []
        payload["listLayout"] = "tiles"
        self.assertEqual(main.validate_display_config(self.library, payload)["wordListFields"], [])

        # Simulate the JSON serialization boundary without reading or writing SQLite.
        stored = [self.library]

        def load():
            return stored

        def save(libraries):
            nonlocal stored
            stored = json.loads(json.dumps(libraries, ensure_ascii=False))

        with patch.object(main, "load_libraries", side_effect=load), \
                patch.object(main, "save_libraries", side_effect=save):
            response = main.update_library_display_config(
                "test-library", main.DisplayConfigRequest(displayConfig=payload))
            read_back = main.get_library_display_config("test-library")["displayConfig"]
            saved_empty = copy.deepcopy(stored[0]["displayConfig"])
            legacy_payload = main.default_display_config(self.library)
            del legacy_payload["wordListFields"]
            legacy_response = main.update_library_display_config(
                "test-library", main.DisplayConfigRequest(displayConfig=legacy_payload))
            legacy_read_back = main.get_library_display_config("test-library")["displayConfig"]
        self.assertEqual(response["displayConfig"]["wordListFields"], [])
        self.assertEqual(saved_empty["wordListFields"], [])
        self.assertEqual(read_back, response["displayConfig"])
        self.assertEqual(read_back["listLayout"], "tiles")
        self.assertEqual(legacy_read_back, legacy_response["displayConfig"])
        self.assertEqual(legacy_read_back["wordListFields"],
                         main.default_display_config(self.library)["wordListFields"])

    def test_new_layout_and_custom_fields_round_trip(self):
        config = main.default_display_config(self.library)
        config["listLayout"] = "tiles"
        config["listMode"] = "browse"
        config["wordListFields"] += [
            {"key": "note", "label": "备注", "source": "customFields.notes",
             "enabled": True, "displayType": "text", "showEmpty": True},
            {"key": "chapter", "label": "章", "source": "customFields.chapter",
             "enabled": False, "displayType": "text", "showEmpty": False},
        ]
        saved = main.validate_display_config(self.library, config)
        self.assertEqual(saved["listLayout"], "tiles")
        self.assertEqual(saved["listMode"], "browse")
        self.assertEqual(saved["wordListFields"][-2:], config["wordListFields"][-2:])
        self.library["displayConfig"] = copy.deepcopy(saved)
        self.assertEqual(main.normalized_display_config(self.library), saved)

    def test_put_handler_saves_legacy_and_new_options_without_sqlite(self):
        self.library["id"] = "test-library"
        payload = main.default_display_config(self.library)
        payload.update(listMode="browse", detailPlacement="floating", listLayout="tiles",
                       rushMode="browse", allowMultipleExpanded=False)
        libraries = [self.library]
        with patch.object(main, "load_libraries", return_value=libraries), \
                patch.object(main, "save_libraries") as save_libraries:
            response = main.update_library_display_config(
                "test-library", main.DisplayConfigRequest(displayConfig=payload))
            save_libraries.assert_called_once_with(libraries)
            stored = main.get_library_display_config("test-library")["displayConfig"]
        self.assertTrue(response["ok"])
        self.assertEqual(stored["listMode"], "browse")
        self.assertEqual(stored["detailPlacement"], "floating")
        self.assertEqual(stored["listLayout"], "tiles")
        self.assertEqual(stored["wordListFields"], payload["wordListFields"])

    def test_invalid_layout_and_field_group_are_rejected(self):
        config = main.default_display_config(self.library)
        config["listLayout"] = "grid"
        with self.assertRaises(HTTPException) as error:
            main.validate_display_config(self.library, config)
        self.assertEqual(error.exception.status_code, 400)
        config["listLayout"] = "tiles"
        config["wordListFields"] = "meaning"
        with self.assertRaises(HTTPException) as error:
            main.validate_display_config(self.library, config)
        self.assertEqual(error.exception.status_code, 400)
        config["wordListFields"] = [{"key": "bad", "source": "customFields.not_defined"}]
        with self.assertRaises(HTTPException) as error:
            main.validate_display_config(self.library, config)
        self.assertEqual(error.exception.status_code, 400)
        config["wordListFields"] = [{"key": "dup", "source": "meaning"},
                                     {"key": "dup", "source": "ipa"}]
        with self.assertRaises(HTTPException) as error:
            main.validate_display_config(self.library, config)
        self.assertEqual(error.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
