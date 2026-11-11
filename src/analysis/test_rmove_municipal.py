"""Pruebas de referencias municipales y exposición simultánea."""
from pathlib import Path
import tempfile
import unittest

import duckdb
import pandas as pd

from src.analysis.rmove_municipal import (
    agregar_exposicion_por_fecha, agregar_municipios, calendario_comparaciones, comparar_municipios,
)
from src.analysis.rmove_validate_territory import preparar_validacion


class MunicipalTests(unittest.TestCase):
    def test_aggregation_excludes_intra_and_invalid_totals(self):
        with tempfile.TemporaryDirectory() as temporal, duckdb.connect() as con:
            path = Path(temporal) / "fixture.parquet"
            pd.DataFrame({"day": pd.to_datetime(["2024-03-04"] * 4),
                          "municipio_origen": ["a", "a", "b", "a"],
                          "municipio_destino": ["b", "c", "a", "a"],
                          "viajes": [100, -1, 40, 9999]}).to_parquet(path)
            agregar_municipios(con, path, "2024-01-01", "2024-12-31")
            tabla = con.execute("SELECT * FROM movilidad_municipal").df()
            salidas_a = tabla.loc[tabla.codigo.eq("a") & tabla.sentido.eq("salidas")].iloc[0]
            entradas_a = tabla.loc[tabla.codigo.eq("a") & tabla.sentido.eq("entradas")].iloc[0]
            self.assertTrue(pd.isna(salidas_a.viajes_observados))
            self.assertEqual(salidas_a.registros_invalidos, 1)
            self.assertEqual(entradas_a.viajes_observados, 40)

    def test_references_missing_controls_and_states(self):
        dias = pd.to_datetime(["2024-02-05", "2024-02-12", "2024-02-19", "2024-02-26"])
        movilidad = pd.DataFrame({"day": list(dias) * 2, "codigo": ["a"]*4 + ["b"]*4,
                                  "sentido": "salidas", "viajes_observados": [100, 100, 100, 80, 100, None, 100, 120],
                                  "registros": 1, "registros_invalidos": 0, "n_od": 1})
        objetivos = pd.DataFrame({"fecha": [dias[-1]], "calendario_elegible": [True],
                                 "n_registros_documentados_fecha": [2]})
        controles = pd.DataFrame({"fecha": [dias[-1]]*3, "fecha_control": dias[:3]})
        with duckdb.connect() as con:
            con.register("fixture", movilidad)
            con.execute("CREATE TEMP TABLE movilidad_municipal AS SELECT * FROM fixture")
            r = comparar_municipios(con, objetivos, controles).set_index("codigo")
        self.assertAlmostEqual(r.loc["a", "variacion_observada_pct"], -20.)
        self.assertEqual(r.loc["a", "n_controles"], 3)
        self.assertEqual(r.loc["b", "n_controles"], 2)
        self.assertEqual(r.loc["b", "estado"], "controles_insuficientes")
        self.assertTrue(pd.isna(r.loc["b", "variacion_observada_pct"]))

    def test_calendar_never_includes_documented_dates_or_future_year(self):
        catalogo = pd.DataFrame({"date": pd.to_datetime(["2024-12-13", "2024-12-20"])})
        objetivos, controles = calendario_comparaciones(catalogo, "2024-01-01", "2024-12-31", 42)
        self.assertEqual(len(objetivos), 2)
        self.assertTrue(controles.fecha_control.lt("2025-01-01").all())
        self.assertFalse(set(controles.fecha_control) & set(catalogo.date))

    def test_simultaneous_incidents_and_incomplete_low_exposure(self):
        catalogo = pd.DataFrame({"incident_id": ["1", "2"], "date": pd.to_datetime(["2024-02-26"]*2)})
        exp = pd.DataFrame({"incident_id": ["1", "2", "1"], "codigo": ["a", "a", "b"],
                            "categoria": ["indirecta", "directa", "baja"]})
        r = agregar_exposicion_por_fecha(catalogo, exp).set_index("codigo")
        self.assertEqual(len(r), 2)
        self.assertEqual(r.loc["a", "exposicion"], "directa")
        self.assertEqual(r.loc["b", "exposicion"], "desconocida")

    def test_validation_priorities_preserve_unknown_municipalities(self):
        candidatos = pd.DataFrame({"incident_id": ["1"]*3, "codigo": ["a", "a", "b"],
                                   "tipo_candidato": ["conexion_transbordo_actual", "conexion_linea_actual", "conexion_transbordo_actual"],
                                   "evidencia": ["R2", "R1", "R2"]})
        catalogo = pd.DataFrame({"incident_id": ["1"], "date": pd.to_datetime(["2024-02-26"])})
        r = pd.DataFrame(preparar_validacion(candidatos, catalogo, "fixture", "2026-11-11")).set_index("codigo")
        self.assertEqual(len(r), 2)
        self.assertEqual(r.loc["a", "categoria"], "directa")
        self.assertEqual(r.loc["b", "categoria"], "indirecta")
        self.assertNotIn("c", r.index)


if __name__ == "__main__":
    unittest.main()
