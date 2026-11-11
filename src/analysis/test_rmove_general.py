"""Validaciones de identidad y límites de los controles del análisis general."""
import unittest

import pandas as pd

from src.analysis.rmove_general import auditar_fechas, normalizar_catalogo


class GeneralTests(unittest.TestCase):
    def catalogo(self):
        return pd.DataFrame({"incident_id": [1, 2], "date": ["2024-12-13"] * 2,
                             "line": ["R1; R3; R1", None], "place": ["x"] * 2,
                             "source": ["x"] * 2, "URL": [None] * 2})

    def test_identity_and_unknown_exposure(self):
        tabla = normalizar_catalogo(self.catalogo())
        self.assertEqual(tabla.lineas_normalizadas.iloc[0], ["R1", "R3"])
        self.assertEqual(tabla.lineas_normalizadas.iloc[1], [])
        self.assertTrue(tabla.exposicion_territorial.eq("pendiente_de_cartografia").all())
        duplicado = self.catalogo()
        duplicado["incident_id"] = [1, "1"]
        with self.assertRaises(ValueError):
            normalizar_catalogo(duplicado)

    def test_mixed_excel_serial_dates(self):
        datos = self.catalogo()
        datos["date"] = [44955, pd.Timestamp("2024-12-13")]
        fechas = normalizar_catalogo(datos).date.dt.strftime("%Y-%m-%d").tolist()
        self.assertEqual(fechas, ["2023-01-29", "2024-12-13"])
        datos["date"] = [20240101, "2024-12-13"]
        with self.assertRaises(ValueError):
            normalizar_catalogo(datos)

    def test_no_controls_from_undocumented_year_or_target(self):
        dias = pd.date_range("2024-11-01", "2025-01-31")
        cobertura = pd.DataFrame({"day": dias, "viajes_observados": 100.})
        cobertura.loc[cobertura.day.ge("2025-01-01"), "viajes_observados"] = 100000.
        resultados, controles = auditar_fechas(normalizar_catalogo(self.catalogo()), cobertura,
                                               "2024-01-01", "2024-12-31")
        self.assertEqual(len(resultados), 1)
        self.assertEqual(resultados.n_registros_documentados.iloc[0], 2)
        self.assertEqual(resultados.mediana_viajes_controles.iloc[0], 100.)
        self.assertTrue(controles.fecha_control.lt("2025-01-01").all())
        self.assertFalse(controles.fecha_control.eq("2024-12-13").any())
        self.assertFalse(controles.fecha_control.eq("2024-12-06").any())

    def test_outside_declared_catalog_fails(self):
        with self.assertRaises(ValueError):
            auditar_fechas(normalizar_catalogo(self.catalogo()), pd.DataFrame(),
                           "2023-01-01", "2023-12-31")


if __name__ == "__main__":
    unittest.main()
