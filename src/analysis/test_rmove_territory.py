"""Protege la separación entre sugerencias y exposición validada."""
import unittest

import pandas as pd

from src.analysis.rmove_territory import (
    candidatos_incidencias, coincidencias, correspondencias, normalizar_nombre, validar_revision,
)


class TerritoryTests(unittest.TestCase):
    def setUp(self):
        self.municipios = pd.DataFrame({"codigo": ["01", "02", "03"],
                                        "nombre": ["Barcelona", "Montgat", "Montgat Nord"]})
        self.catalogo = pd.DataFrame({"incident_id": ["test"], "date": [pd.Timestamp("2024-01-15")],
                                     "lineas_normalizadas": [["R1", "R99"]],
                                     "line": ["R1; R99"], "place": ["Montgat Nord"], "URL": ["fuente"]})
        self.red = pd.DataFrame({"stop_id": ["a", "a", "b", "c"],
                                 "estacion": ["Barcelona", "Barcelona", "Montgat", "Montgat Nord"],
                                 "linea": ["R1", "R2", "R1", "R2"],
                                 "codigo": ["01", "01", "02", "03"]})

    def test_names_articles_boundaries_and_longest_match(self):
        self.assertEqual(normalizar_nombre("Hospitalet de Llobregat, L'"),
                         normalizar_nombre("L’Hospitalet de Llobregat"))
        self.assertEqual(normalizar_nombre("VENDRELL (EL)"), "el vendrell")
        resultados = coincidencias("Montgat Nord–Barcelona", {"montgat": {1}, "montgat nord": {2}})
        self.assertEqual([r[2] for r in resultados], ["montgat nord"])
        self.assertEqual(coincidencias("Montgato", {"montgat": {1}}), [])

    def test_candidates_never_confirm_exposure_or_low_group(self):
        candidatos, revision = candidatos_incidencias(self.catalogo, self.red, self.municipios)
        self.assertFalse(candidatos.exposicion_confirmada.any())
        self.assertFalse(revision.exposicion_confirmada.any())
        self.assertEqual(revision.lineas_sin_referencia.iloc[0], ["R99"])
        indirectos = candidatos.loc[candidatos.tipo_candidato.eq("conexion_transbordo_actual")]
        self.assertEqual(set(indirectos.codigo), {"03"})
        self.assertNotIn("categoria", candidatos)

    def test_ambiguous_station_is_not_silently_assigned(self):
        estaciones = pd.DataFrame({"stop_id": ["x"], "stop_name": ["Barcelona–Montgat"], "linea": ["R1"]})
        listado = pd.DataFrame({"CODIGO": ["other"], "POBLACION": ["unknown"]})
        red = correspondencias(estaciones, listado, self.municipios)
        self.assertEqual(set(red.codigo), {"01", "02"})
        self.assertTrue(red.n_candidatos.eq(2).all())
        self.assertTrue(red.estado.str.startswith("candidata").all())

    def test_review_requires_historical_evidence_and_identity(self):
        fila = {"incident_id": "test", "codigo": "01", "categoria": "directa", "fuente": "doc",
                "criterio": "tramo revisado", "revisado_por": "fixture", "fecha_revision": "2026-11-11",
                "valido_desde": "2023-01-01", "valido_hasta": "2024-12-31"}
        self.assertEqual(len(validar_revision([fila], self.catalogo, self.municipios)), 1)
        for cambio in [{"valido_desde": "2026-01-01", "valido_hasta": "2026-12-31"},
                       {"fuente": ""}, {"codigo": "99"}, {"categoria": "automatica"}]:
            with self.subTest(cambio=cambio), self.assertRaises(ValueError):
                validar_revision([{**fila, **cambio}], self.catalogo, self.municipios)
        with self.assertRaises(ValueError):
            validar_revision([fila, fila], self.catalogo, self.municipios)


if __name__ == "__main__":
    unittest.main()
