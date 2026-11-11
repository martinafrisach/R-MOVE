"""Influencia calculada por fechas, recortes conjuntos y conclusiones prudentes."""
import unittest

import numpy as np
import pandas as pd

from src.analysis.rmove_review import analizar_influencia, redactar_conclusiones


class ReviewTests(unittest.TestCase):
    def test_leave_one_date_out_and_joint_extreme_selection(self):
        fechas=pd.date_range("2023-01-02",periods=10,freq="90D")
        filas=[]
        for i,fecha in enumerate(fechas):
            for exposicion in ["directa","indirecta"]:
                filas.append({"fecha":fecha,"sentido":"entradas","exposicion":exposicion,
                              "grupo_elegible":True,"exceso_magnitud_pp":50. if i==0 else 1.,
                              "cambio_centrado_pp":-1.})
        influencia,ranking,robustez=analizar_influencia(pd.DataFrame(filas),
            {"bloque_dias":84,"replicas_bootstrap":100,"semilla":1})
        self.assertEqual(ranking.fecha.iloc[0],fechas[0])
        r=influencia.loc[influencia.fecha.eq(fechas[0])&influencia.metrica.eq("exceso_magnitud_pp")]
        self.assertTrue(np.allclose(r.estimacion_sin_fecha_pp,1.))
        recorte=robustez.loc[robustez.escenario.eq("sin_top_1_fechas")&robustez.comparacion.str.contains("vs_placebo")
                            &robustez.metrica.eq("exceso_magnitud_pp")]
        self.assertTrue(recorte.n_fechas.eq(9).all())
        self.assertTrue(np.allclose(recorte.estimacion_pp,1.))

    def test_conclusions_report_loss_of_consistency_after_trimming(self):
        filas=[]
        for sentido in ["entradas","salidas"]:
            for comparacion in ["directa_vs_placebo_propio","indirecta_vs_placebo_propio","directa_menos_indirecta_mismas_fechas"]:
                filas.append({"sentido":sentido,"comparacion":comparacion,"metrica":"exceso_magnitud_pp",
                              "estimacion_pp":1.,"ic95_inferior_pp":-.1 if "menos" in comparacion else .1,
                              "ic95_superior_pp":2.})
        principal=pd.DataFrame(filas)
        robustez=principal.assign(escenario="sin_top_5_fechas",ic95_inferior_pp=-.5)
        conclusiones=redactar_conclusiones(principal,robustez)
        self.assertEqual(len(conclusiones),4)
        self.assertEqual(conclusiones[0]["estado"],"sensible")
        self.assertIn("Sin diferencia clara",conclusiones[1]["titulo"])
        self.assertIn("sin confirmar",conclusiones[3]["titulo"])


if __name__=="__main__":unittest.main()
