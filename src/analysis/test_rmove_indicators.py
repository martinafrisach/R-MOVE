"""Pruebas de controles de mediana y exportación real. Fixtures solo para bordes."""
import json
import sys
import unittest
from pathlib import Path
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from analysis.rmove_indicators import (
    calcular_indicadores, evaluar_mediana, preparar_grupo, seleccionar_controles,
)


class MedianTests(unittest.TestCase):
    def setUp(self):
        fechas = pd.date_range("2025-05-01", "2025-08-21", freq="7D")
        self.grupo = pd.DataFrame({"day": fechas, "viajes_observados": 100.+np.arange(len(fechas)),
            "Relacion": "fixture", "municipio_origen": "test", "municipio_destino": "test2"})
        self.fecha = pd.Timestamp("2025-06-12")
        self.festivos = {pd.Timestamp("2025-05-01").date()}

    def test_calendar_and_known_incidents_excluded(self):
        excluidas = {pd.Timestamp("2025-05-15")}
        g = self.grupo.copy()
        g.loc[g.day.eq("2025-05-22"), "viajes_observados"] = np.nan
        r, controles = calcular_indicadores(g, self.fecha, excluidas, self.festivos)
        self.assertNotIn(self.fecha, set(controles.day))
        self.assertFalse(set(controles.day) & excluidas)
        self.assertFalse(controles.day.dt.month.isin([7,8]).any())
        self.assertFalse(controles.day.map(lambda d:d.date() in self.festivos).any())
        self.assertTrue(controles.day.dt.day_of_week.eq(3).all())
        self.assertEqual(r["n_controles"], len(controles))
        self.assertEqual(r["mediana_viajes_controles"], controles.viajes_observados.median())
        self.assertIn("variacion_observada_pct",r)

    def test_prediction_ignores_target_and_future(self):
        a, ca = calcular_indicadores(self.grupo, self.fecha, set(), self.festivos, "predictivo")
        changed = self.grupo.copy()
        changed.loc[changed.day.ge(self.fecha), "viajes_observados"] *= 1000
        b, cb = calcular_indicadores(changed, self.fecha, set(), self.festivos, "predictivo")
        pd.testing.assert_frame_equal(ca, cb)
        self.assertTrue(ca.day.lt(self.fecha).all())
        self.assertEqual(a["mediana_viajes_controles"], b["mediana_viajes_controles"])
        self.assertEqual(a["fechas_controles"],b["fechas_controles"])
        self.assertNotEqual(a["variacion_observada_pct"],b["variacion_observada_pct"])

    def test_summer_is_excluded_from_both_sides(self):
        r, controls = calcular_indicadores(self.grupo, pd.Timestamp("2025-07-10"), set(), self.festivos)
        self.assertEqual(r["estado"], "fuera_del_ambito_calendario")
        self.assertIsNone(r["variacion_observada_pct"])
        self.assertFalse(controls.day.dt.month.isin([7,8]).any())

    def test_insufficient_missing_zero_and_duplicates(self):
        r,_=calcular_indicadores(self.grupo.iloc[:2],self.grupo.day.iloc[1],set(),set())
        self.assertEqual(r["estado"],"controles_insuficientes")
        self.assertIsNone(r["variacion_observada_pct"])
        g=self.grupo.copy();g["viajes_observados"]=0.
        r,_=calcular_indicadores(g,self.fecha,set(),self.festivos)
        self.assertEqual(r["estado"],"referencia_cero")
        self.assertIsNone(r["variacion_observada_pct"])
        g.loc[g.day.eq(self.fecha),"viajes_observados"]=np.nan
        r,_=calcular_indicadores(g,self.fecha,set(),self.festivos)
        self.assertEqual(r["estado"],"sin_observacion_valida")
        with self.assertRaises(ValueError):
            preparar_grupo(pd.concat([g,g.iloc[:1]]))

    def test_predictive_evaluation_dates(self):
        detalle=evaluar_mediana(self.grupo,set(),self.festivos)
        self.assertFalse(detalle.empty)
        self.assertTrue((detalle.ultima_fecha_control<detalle.day).all())
        self.assertFalse(detalle.day.dt.month.isin([7,8]).any())
        self.assertTrue(detalle[["mediana","media","ultimo_comparable"]].notna().all().all())

    def test_real_export_formulas_and_controls(self):
        root=Path(__file__).resolve().parents[2]
        directory=root/"data/processed/rmove"
        data=json.loads((directory/"incidencia_2025_06_05.json").read_text(encoding="utf-8"))
        controls=pd.read_csv(directory/"controles_2025_06_05.csv",parse_dates=["day"])
        self.assertEqual(data["version_esquema"],3)
        self.assertEqual(len(data["relaciones"]),20)
        self.assertEqual(data["metodologia"]["controles"]["meses_excluidos"],[7,8])
        for r in data["relaciones"]:
            c=controls.loc[controls.Relacion.eq(r["relacion"])]
            self.assertEqual(c.day.dt.strftime("%Y-%m-%d").tolist(),r["fechas_controles"])
            self.assertEqual(r["n_controles"],len(c))
            self.assertEqual(r["n_controles"],8)
            self.assertFalse(c.day.dt.month.isin([7,8]).any())
            self.assertNotIn(data["fecha_incidencia"],r["fechas_controles"])
            self.assertAlmostEqual(r["mediana_viajes_controles"],c.viajes_observados.median())
            self.assertAlmostEqual(r["p25_viajes_controles"],c.viajes_observados.quantile(.25))
            self.assertAlmostEqual(r["p75_viajes_controles"],c.viajes_observados.quantile(.75))
            self.assertAlmostEqual(r["variacion_observada_pct"],100*(r["viajes_observados"]/r["mediana_viajes_controles"]-1))
            self.assertEqual(set(r), {
                "relacion", "municipio_origen", "municipio_destino", "fecha",
                "viajes_observados", "mediana_viajes_controles", "p25_viajes_controles",
                "p75_viajes_controles", "n_controles", "fechas_controles",
                "variacion_observada_pct", "diferencia_viajes",
                "fuera_rango_intercuartil_viajes", "modo_controles", "ventana_dias",
                "minimo_controles", "estado",
            })


if __name__=="__main__": unittest.main()
