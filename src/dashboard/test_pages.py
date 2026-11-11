"""Publication safety checks; no analytical fixtures are published."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("pages", Path(__file__).with_name("build-pages.py"))
pages = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pages)


class PublicationTests(unittest.TestCase):
    def assets(self):
        files = {"src/dashboard/" + name: (pages.SOURCE / name).read_bytes() for name in pages.ASSETS}
        files["index.html"] = (pages.SOURCE / "pages-entry.html").read_bytes()
        files.update(dict.fromkeys(pages.RESULTS.values(), b""))
        return files

    def test_relative_routes_under_project_prefix(self):
        pages.validate_routes(self.assets())

    def test_absolute_and_missing_asset_routes_rejected(self):
        for link in ("/dashboard.css", "missing.css"):
            with self.subTest(link=link):
                files = self.assets()
                files["src/dashboard/index.html"] = f'<link href="{link}">'.encode()
                with self.assertRaises(ValueError):
                    pages.validate_routes(files)

    def test_missing_results_block_publication(self):
        original = pages.read_regular
        def read(relative):
            if relative in pages.RESULTS.values():
                raise ValueError(f"Falta archivo: {relative}")
            return original(relative)
        with patch.object(pages, "read_regular", side_effect=read):
            with self.assertRaisesRegex(ValueError, "Publicación bloqueada") as caught:
                pages.prepare()
        for path in pages.RESULTS.values():
            self.assertIn(path, str(caught.exception))

    def test_existing_files_without_approval_are_blocked(self):
        original = pages.read_regular
        def read(relative):
            if relative in pages.RESULTS.values():
                return b"{}"  # Deliberately empty, never written to the artifact.
            if relative == "src/dashboard/publication.json":
                return b'{"schema_version":1,"results":{}}'
            return original(relative)
        with patch.object(pages, "read_regular", side_effect=read):
            with self.assertRaisesRegex(ValueError, "Sin autorización documentada"):
                pages.prepare()

    def test_unlisted_results_rejected(self):
        manifest = {"schema_version": 1, "results": {"data/raw/private.json": {}}}
        with patch.object(pages, "read_regular", return_value=json.dumps(manifest).encode()):
            with self.assertRaisesRegex(ValueError, "fuera de la lista"):
                pages.prepare()

    def test_changed_result_hash_is_blocked(self):
        original = pages.read_regular
        manifest = {"schema_version": 1, "results": {
            path: {"authorization": "test-only reference", "approved_by": "test",
                   "approved_on": "2026-11-11", "sha256": "0" * 64}
            for path in pages.RESULTS.values()
        }}
        def read(relative):
            if relative in pages.RESULTS.values():
                return b"{}"
            if relative == "src/dashboard/publication.json":
                return json.dumps(manifest).encode()
            return original(relative)
        with patch.object(pages, "read_regular", side_effect=read):
            with self.assertRaisesRegex(ValueError, "SHA-256 no autorizado"):
                pages.prepare()

    def test_artifact_copies_only_prepared_files(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "site"
            files = self.assets()
            # Only exercise the copier; no result JSON contents are fabricated.
            files = {k: v for k, v in files.items() if k not in pages.RESULTS.values()}
            with patch.object(pages, "OUTPUT", output), patch.object(pages, "prepare", return_value=files), patch("sys.argv", ["build-pages.py"]):
                pages.main()
                actual = {p.relative_to(output).as_posix() for p in output.rglob("*") if p.is_file()}
                self.assertEqual(actual, set(files))
                with self.assertRaisesRegex(ValueError, "ya existe"):
                    pages.main()


if __name__ == "__main__":
    unittest.main()
