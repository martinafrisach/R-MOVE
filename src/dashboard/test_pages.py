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
        files[pages.GENERAL_RESULT] = b""
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

    def test_hash_only_manifest_is_sufficient(self):
        files = pages.prepare()
        self.assertEqual(set(files), set(self.assets()))

    def test_missing_hashes_are_blocked(self):
        original = pages.read_regular
        def read(relative):
            if relative in pages.RESULTS.values():
                return b"{}"  # Deliberately empty, never written to the artifact.
            if relative == "src/dashboard/publication.json":
                return b'{"schema_version":1,"results":{}}'
            return original(relative)
        with patch.object(pages, "read_regular", side_effect=read):
            with self.assertRaisesRegex(ValueError, "SHA-256 ausente"):
                pages.prepare()

    def test_unlisted_results_rejected(self):
        manifest = {"schema_version": 1, "results": {"data/raw/private.json": {}}}
        with patch.object(pages, "read_regular", return_value=json.dumps(manifest).encode()):
            with self.assertRaisesRegex(ValueError, "fuera de la lista"):
                pages.prepare()

    def test_general_summary_must_reference_exact_case_bytes(self):
        import hashlib
        original = pages.read_regular
        general = json.loads(original(pages.GENERAL_RESULT))
        general["casos"][0]["sha256"] = "0" * 64
        changed = json.dumps(general).encode()
        manifest = json.loads(original("src/dashboard/publication.json"))
        manifest["results"][pages.GENERAL_RESULT]["sha256"] = hashlib.sha256(changed).hexdigest()
        def read(relative):
            if relative == pages.GENERAL_RESULT:
                return changed
            if relative == "src/dashboard/publication.json":
                return json.dumps(manifest).encode()
            return original(relative)
        with patch.object(pages, "read_regular", side_effect=read):
            with self.assertRaisesRegex(ValueError, "misma revisión"):
                pages.prepare()

    def test_changed_result_hash_is_blocked(self):
        original = pages.read_regular
        manifest = {"schema_version": 1, "results": {
            path: {"sha256": "0" * 64}
            for path in pages.RESULTS.values()
        }}
        def read(relative):
            if relative in pages.RESULTS.values():
                return b"{}"
            if relative == "src/dashboard/publication.json":
                return json.dumps(manifest).encode()
            return original(relative)
        with patch.object(pages, "read_regular", side_effect=read):
            with self.assertRaisesRegex(ValueError, "SHA-256 ausente o desactualizado"):
                pages.prepare()

    def test_invalid_result_schema_rejected_even_with_matching_hash(self):
        import hashlib
        original = pages.read_regular
        invalid = b'{}'  # Invalid schema, never published.
        manifest = {"schema_version": 1, "results": {
            path: {"sha256": hashlib.sha256(invalid).hexdigest()}
            for path in pages.RESULTS.values()
        }}
        def read(relative):
            if relative in pages.RESULTS.values():
                return invalid
            if relative == "src/dashboard/publication.json":
                return json.dumps(manifest).encode()
            return original(relative)
        with patch.object(pages, "read_regular", side_effect=read):
            with self.assertRaisesRegex(ValueError, "Esquema incompatible"):
                pages.prepare()

    def test_artifact_copies_only_prepared_files(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "site"
            files = pages.prepare()
            # Full build with real results and all validations, without publishing.
            with patch.object(pages, "OUTPUT", output), patch("sys.argv", ["build-pages.py"]):
                pages.main()
                actual = {p.relative_to(output).as_posix() for p in output.rglob("*") if p.is_file()}
                self.assertEqual(actual, set(files))
                self.assertEqual(len(actual), 13)
                for name, content in files.items():
                    self.assertEqual((output / name).read_bytes(), content)
                with self.assertRaisesRegex(ValueError, "ya existe"):
                    pages.main()


if __name__ == "__main__":
    unittest.main()
