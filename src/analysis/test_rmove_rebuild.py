"""Límites del reemplazo destructivo y procedencia de asignaciones regeneradas."""
from pathlib import Path
from contextlib import ExitStack
import json
import tempfile
import unittest
from unittest.mock import patch

import pandas as pd

from src.analysis.rmove_rebuild import comprobar_destino, ejecutar
from src.analysis.rmove_validate_territory import preparar_validacion


class RebuildTests(unittest.TestCase):
    def test_only_exact_general_directory_and_inputs_outside_it(self):
        with tempfile.TemporaryDirectory() as carpeta:
            root = Path(carpeta).resolve()
            config = {"salida": "data/processed/rmove/general"}
            for campo in ["incidencias", "movilidad", "estaciones_referencia", "gtfs_referencia"]:
                ruta = root / (campo + ".fixture")
                ruta.write_text("fixture", encoding="utf-8")
                config[campo] = ruta.name
            self.assertEqual(comprobar_destino(root, config), root / config["salida"])
            for salida in [".", "data", "data/processed/rmove", "../general"]:
                with self.subTest(salida=salida), self.assertRaises(ValueError):
                    comprobar_destino(root, {**config, "salida": salida})
            with self.assertRaises(ValueError):
                comprobar_destino(root, {**config, "incidencias": config["salida"] + "/catalogo.xlsx"})
            with self.assertRaises(FileNotFoundError):
                comprobar_destino(root, {**config, "incidencias": "ausente.xlsx"})

    def test_regeneration_does_not_claim_new_manual_review(self):
        candidatos = pd.DataFrame({"incident_id": ["1"], "codigo": ["a"],
                                   "tipo_candidato": ["conexion_linea_actual"], "evidencia": ["R1"]})
        catalogo = pd.DataFrame({"incident_id": ["1"], "date": pd.to_datetime(["2024-01-01"])})
        r = preparar_validacion(candidatos, catalogo, "usuario", "2026-11-11", por_reglas_aceptadas=True)
        self.assertEqual(r[0]["origen_validacion"], "regeneracion_por_reglas_aceptadas_no_revision_manual_nueva")
        self.assertEqual(r[0]["categoria"], "directa")

    def test_replacement_removes_only_general_and_runs_stages_in_order(self):
        with tempfile.TemporaryDirectory() as carpeta, ExitStack() as stack:
            root = Path(carpeta).resolve()
            destino = root / "data/processed/rmove/general"
            destino.mkdir(parents=True)
            (destino / "resultado_antiguo.fixture").write_text("antiguo", encoding="utf-8")
            ajeno = destino.parent / "caso_notebook.fixture"
            ajeno.write_text("no tocar", encoding="utf-8")
            config = {"salida": "data/processed/rmove/general", "incidencias": "catalogo.xlsx",
                      "movilidad": "movilidad.fixture", "estaciones_referencia": "estaciones.fixture",
                      "gtfs_referencia": "gtfs.fixture", "hoja": "incidencias",
                      "inicio_catalogo": "2024-01-01", "fin_catalogo": "2024-12-31"}
            pd.DataFrame({"incident_id": [1], "date": [pd.Timestamp("2024-02-01")],
                          "line": ["R1"], "place": ["Barcelona"], "source": ["fixture"],
                          "URL": ["fixture"]}).to_excel(root / "catalogo.xlsx", sheet_name="incidencias", index=False)
            for clave in ["movilidad", "estaciones_referencia", "gtfs_referencia"]:
                (root / config[clave]).write_text("fixture", encoding="utf-8")
            ruta_config = root / "config.json"
            ruta_config.write_text(json.dumps(config), encoding="utf-8")
            stack.enter_context(patch("src.analysis.rmove_rebuild.__file__", str(root / "src/analysis/rmove_rebuild.py")))
            llamadas = []
            for modulo in ["rmove_general", "rmove_territory", "rmove_validate_territory", "rmove_municipal", "rmove_contrast"]:
                stack.enter_context(patch("src.analysis.rmove_rebuild." + modulo + ".ejecutar",
                    side_effect=lambda *a, etapa=modulo, **k: llamadas.append(etapa)))
            ejecutar(ruta_config, reemplazar=True, reglas_aceptadas=True)
            self.assertFalse((destino / "resultado_antiguo.fixture").exists())
            self.assertEqual(ajeno.read_text(encoding="utf-8"), "no tocar")
            self.assertEqual(llamadas, ["rmove_general", "rmove_territory", "rmove_validate_territory", "rmove_municipal", "rmove_contrast"])
            self.assertEqual(json.loads((destino / "ejecucion_actual.json").read_text(encoding="utf-8"))["estado"], "completado")


if __name__ == "__main__":
    unittest.main()
