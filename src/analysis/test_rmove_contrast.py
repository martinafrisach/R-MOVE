"""Pruebas de exclusiones, calibración local e incertidumbre por fechas."""
import unittest

import duckdb
import numpy as np
import pandas as pd

from src.analysis.rmove_contrast import (
    calendario_placebos, calibrar, contrastes_grupos, intervalo_bloques,
    recurrencia, resumen_por_fecha,
)


class ContrastTests(unittest.TestCase):
    def test_placebo_calendar_excludes_holidays_incidents_self_and_outside_scope(self):
        catalogo = pd.DataFrame({"date": pd.to_datetime(["2024-12-13", "2024-12-20"])})
        objetivos, controles = calendario_placebos(catalogo, "2024-11-01", "2024-12-31", 42)
        self.assertFalse(set(objetivos.fecha) & set(catalogo.date))
        self.assertFalse(set(controles.fecha_control) & set(catalogo.date))
        self.assertFalse(controles.fecha.eq(controles.fecha_control).any())
        self.assertTrue(controles.fecha_control.between("2024-11-01", "2024-12-31").all())
        self.assertTrue((controles.fecha.dt.day_of_week == controles.fecha_control.dt.day_of_week).all())
        self.assertNotIn(pd.Timestamp("2024-12-06"), set(objetivos.fecha))

    def datos(self):
        evento = pd.DataFrame({"fecha": pd.to_datetime(["2024-03-04"]), "codigo": ["a"], "sentido": ["entradas"],
                               "estado": ["ok"], "variacion_observada_pct": [-20.],
                               "variacion_n_od_pct": [0.], "exposicion": ["directa"]})
        placebo = pd.DataFrame({"fecha": pd.to_datetime(["2024-01-29", "2024-02-05", "2024-02-12", "2024-02-19", "2024-02-26"]),
                                "codigo": "a", "sentido": "entradas", "estado": "ok",
                                "variacion_observada_pct": [-2., -1., 0., 1., 2.], "variacion_n_od_pct": 0.})
        return evento, placebo

    def test_self_calibration_does_not_mix_municipalities_and_uses_magnitude(self):
        evento, placebo = self.datos()
        otro = placebo.assign(codigo="b", variacion_observada_pct=1000.)
        with duckdb.connect() as con:
            r = calibrar(con, evento, pd.concat([placebo, otro]), minimo=5)
        self.assertEqual(r.n_placebos.iloc[0], 5)
        self.assertEqual(r.estado_contraste.iloc[0], "ok")
        self.assertEqual(r.exceso_magnitud_pp.iloc[0], 19.)
        self.assertEqual(r.cambio_centrado_pp.iloc[0], -20.)
        self.assertAlmostEqual(r.cola_empirica_descriptiva.iloc[0], 1/6)
        self.assertTrue(r.supera_umbral_descriptivo.iloc[0])

    def test_missing_placebos_and_incomparable_coverage_are_explicit(self):
        evento, placebo = self.datos()
        with duckdb.connect() as con:
            r = calibrar(con, evento, placebo.iloc[:2])
            self.assertEqual(r.estado_contraste.iloc[0], "placebos_insuficientes")
            self.assertTrue(pd.isna(r.exceso_magnitud_pp.iloc[0]))
            self.assertTrue(pd.isna(r.supera_umbral_descriptivo.iloc[0]))
            evento["variacion_n_od_pct"] = 30.
            r = calibrar(con, evento, placebo)
            self.assertEqual(r.estado_contraste.iloc[0], "cobertura_od_no_comparable")

    def test_invalid_placebo_target_wrong_weekday_and_self_never_enter(self):
        evento, placebo = self.datos()
        extra = pd.concat([placebo.iloc[:1].assign(fecha=pd.Timestamp("2024-03-04")),
                           placebo.iloc[:1].assign(fecha=pd.Timestamp("2024-02-27")),
                           placebo.iloc[:1].assign(estado="sin_observacion_valida")])
        with duckdb.connect() as con:
            r = calibrar(con, evento, pd.concat([placebo, extra]))
        self.assertEqual(r.n_placebos.iloc[0], 5)

    def test_blocks_reproducible_constant_and_insufficient_sample(self):
        fechas = pd.date_range("2023-01-02", periods=10, freq="90D")
        r = intervalo_bloques(fechas, np.full(10, 3.), replicas=100, semilla=1)
        self.assertEqual(r["ic95_inferior_pp"], 3.)
        self.assertEqual(r["ic95_superior_pp"], 3.)
        a = intervalo_bloques(fechas, np.arange(10), replicas=100, semilla=7)
        self.assertEqual(a, intervalo_bloques(fechas, np.arange(10), replicas=100, semilla=7))
        self.assertEqual(intervalo_bloques(fechas[:2], [1, 2], replicas=100)["estado_intervalo"], "bloques_insuficientes")
        with self.assertRaises(ValueError):
            intervalo_bloques([fechas[0], fechas[0]], [1, 2], replicas=100)

    def test_group_difference_uses_only_common_dates_and_unknown_is_not_control(self):
        grupos = pd.DataFrame({"fecha": pd.to_datetime(["2023-01-02", "2023-01-02", "2023-02-01"]),
                               "sentido": "entradas", "exposicion": ["directa", "indirecta", "directa"],
                               "grupo_elegible": True, "exceso_magnitud_pp": [5., 2., 100.],
                               "cambio_centrado_pp": [-5., -2., 100.]})
        r = contrastes_grupos(grupos, 84, 100, 0)
        fila = r.loc[r.comparacion.eq("directa_menos_indirecta_mismas_fechas") & r.metrica.eq("exceso_magnitud_pp")].iloc[0]
        self.assertEqual(fila.n_fechas, 1)
        self.assertEqual(fila.estimacion_pp, 3.)

    def test_recurrence_is_descriptive_and_keeps_small_samples(self):
        evento, placebo = self.datos()
        with duckdb.connect() as con:
            r = calibrar(con, evento, placebo)
        self.assertFalse(recurrencia(r).muestra_suficiente_descriptiva.iloc[0])
        r["exposicion"] = "desconocida"
        self.assertTrue(recurrencia(r).empty)
        self.assertTrue(resumen_por_fecha(r).empty)
        vacio = contrastes_grupos(resumen_por_fecha(r), 84, 100, 0)
        self.assertTrue(vacio.empty)
        self.assertIn("estimacion_pp", vacio.columns)


if __name__ == "__main__":
    unittest.main()
