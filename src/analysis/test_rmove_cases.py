"""Coherencia de los dos casos reales exportados por el Notebook 04."""
import json
import sys
import unittest
from pathlib import Path
import numpy as np
import pandas as pd

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/"src"))
from analysis.rmove_cases import ficha_incidencia
from analysis.rmove_general import cargar_catalogo
from analysis.rmove_review import casos_notebook


class CasesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        catalogo=cargar_catalogo(ROOT/"data/raw/rodalies/RMOVE_Incidencias_Barcelona_Jul2024_Ago2025_v07.xlsx")
        fechas=[ficha_incidencia(catalogo,c["id"])["fecha"] for c in casos_notebook(ROOT/"notebooks/04_comparacion_movilidad_incidencias.ipynb")]
        cls.cases={date:json.loads((ROOT/f"data/processed/rmove/incidencia_{date.replace('-','_')}.json").read_text(encoding="utf-8")) for date in fechas}

    def test_documented_incident_from_original_excel(self):
        incidencias=pd.read_excel(ROOT/"data/raw/rodalies/RMOVE_Incidencias_Barcelona_Jul2024_Ago2025_v07.xlsx",sheet_name="Incidencias Barcelona")
        for identificador in [172, "203", "248", "16", "67"]:
            expected=ficha_incidencia(incidencias,identificador)
            fila=incidencias.loc[incidencias.incident_id.astype(str).eq(str(identificador))].iloc[0]
            self.assertEqual(expected["id"],str(identificador))
            self.assertEqual(expected["fecha"],pd.Timestamp(fila["date"]).strftime("%Y-%m-%d"))
            for destino,origen in {"lineas_afectadas":"line", "tramo":"place", "causa":"incident_type",
                                   "afectacion":"description", "horario":"schedule / duration",
                                   "fuente":"source", "url":"URL", "cautelas":"notes"}.items():
                self.assertEqual(expected[destino],str(fila[origen]) if pd.notna(fila[origen]) else "No consta")

    def test_numeric_excel_date_and_missing_documentary_fields(self):
        tabla=pd.DataFrame({"incident_id":[1],"date":[44955],"line":["R1"],
                            "place":["Barcelona"],"source":["fixture"],"URL":[None]})
        ficha=ficha_incidencia(tabla,"1")
        self.assertEqual(ficha["fecha"],"2023-01-29")
        self.assertEqual(ficha["cautelas"],"No consta")
        self.assertEqual(ficha["url"],"No consta")
        with self.assertRaises(ValueError):
            ficha_incidencia(tabla,"inexistente")

    def test_february_sufficiency_and_observations(self):
        case=self.cases["2025-02-07"]
        self.assertEqual(len(case["municipios"]),5)
        self.assertEqual(len(case["relaciones"]),18)
        self.assertEqual(len(case["disponibilidad_od"]),20)
        excluded=[r for r in case["disponibilidad_od"] if not r["seleccionada"]]
        self.assertEqual({(r["municipio_origen"],r["municipio_destino"]) for r in excluded},
                         {("08118","08006"),("08006","08118")})
        self.assertTrue(all(r["viajes_medios_2024"]<100 for r in excluded))
        row=next(r for r in case["relaciones"] if r["municipio_origen"]=="08121" and r["municipio_destino"]=="08019")
        self.assertEqual(row["viajes_observados"],11646)
        self.assertEqual(row["mediana_viajes_controles"],11224)
        self.assertAlmostEqual(row["variacion_observada_pct"],3.759800427655024)

    def test_control_dates_and_values_both_cases(self):
        for date,case in self.cases.items():
            audit=pd.read_csv(ROOT/f"data/processed/rmove/controles_{date.replace('-','_')}.csv",parse_dates=["day"])
            excluded=set(case["metodologia"]["controles"]["fechas_incidencias_excluidas"])
            for row in case["relaciones"]:
                controls=audit.loc[audit.Relacion.eq(row["relacion"])]
                dates=controls.day.dt.strftime("%Y-%m-%d").tolist()
                self.assertEqual(dates,row["fechas_controles"])
                self.assertEqual(len(dates),row["n_controles"])
                self.assertGreaterEqual(len(dates),case["metodologia"]["controles"]["minimo_controles"])
                self.assertNotIn(date,dates);self.assertFalse(set(dates)&excluded)
                self.assertTrue(controls.day.dt.day_of_week.eq(pd.Timestamp(date).day_of_week).all())
                self.assertFalse(controls.day.dt.month.isin([7,8]).any())
                self.assertAlmostEqual(row["mediana_viajes_controles"],controls.viajes_observados.median())
                self.assertAlmostEqual(row["variacion_observada_pct"],100*(row["viajes_observados"]/row["mediana_viajes_controles"]-1))

    def test_provincial_context_recomputes(self):
        for case in self.cases.values():
            series=pd.DataFrame(case["diagnostico_provincial"]["serie"])
            target=series.loc[series.day.eq(case["fecha_incidencia"])].iloc[0]
            controls=series.loc[series.es_control]
            for metric in case["diagnostico_provincial"]["indicadores"]:
                key=metric["indicador"];median=controls[key].median()
                self.assertAlmostEqual(metric["mediana_controles"],median)
                self.assertAlmostEqual(metric["variacion_pct"],100*(target[key]/median-1))

    def test_series_and_sensitivity_are_complete(self):
        for date,case in self.cases.items():
            evolution=pd.DataFrame(case["evolucion_temporal"])
            self.assertEqual(len(evolution),43*len(case["relaciones"]))
            self.assertTrue(evolution.groupby("relacion").fecha.nunique().eq(43).all())
            self.assertEqual(len(case["sensibilidad"]),6*len(case["relaciones"]))
            self.assertEqual(len(case["robustez"]),len(case["relaciones"]))
            for r in case["relaciones"]:
                target=evolution.loc[evolution.relacion.eq(r["relacion"])&evolution.fecha.eq(date)].iloc[0]
                self.assertEqual(target.viajes_observados,r["viajes_observados"])
                self.assertEqual(target.mediana_viajes_controles,r["mediana_viajes_controles"])
            if date=="2025-06-05":
                self.assertTrue(evolution.loc[evolution.fecha.eq("2025-05-20"),"viajes_observados"].isna().all())


if __name__=="__main__":unittest.main()
