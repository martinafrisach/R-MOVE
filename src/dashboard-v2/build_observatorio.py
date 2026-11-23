"""Genera el JSON del observatorio R-MOVE (dashboard v2).

Lee los ficheros que ya exporta el análisis (no recalcula ningún modelo):
  - data/processed/rmove/resultados/dashboard_resultados.json  (notebook 04: resultados del clustering + M3)
  - data/processed/rmove/m2_conectividad_municipios.parquet     (alternativa en transporte público por municipio)
Opcional (si existen, el observatorio los muestra; los genera el notebook 06):
  - data/processed/rmove/observatorio/vulnerabilidad.json          (motorización y renta por municipio)
  - data/processed/rmove/observatorio/vulnerabilidad_resumen.json  (modelo, robustez y terciles)

Salida: data/processed/rmove/observatorio/observatorio.json

Uso, desde la raíz del repositorio:  python src/dashboard-v2/build_observatorio.py
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import pandas as pd

RAIZ = Path(__file__).resolve().parents[2]
DATA = RAIZ / "data" / "processed" / "rmove"
SALIDA = DATA / "observatorio" / "observatorio.json"

FECHA_AVERIA = "2024-05-13"
FECHA_HUELGA = "2025-03-17"
FECHAS_ANUNCIADA = ["2025-03-26", "2025-04-01"]

# M3 de las huelgas anunciadas (no están en dashboard_resultados.json).
# Copiado de claude/m3_hallazgos.md, «Replicación con otras incidencias: huelgas».
M3_ANUNCIADAS = [
    {"caso": "Huelga 26/03/2025", "sentido": "ida", "con_estacion": -10.1, "sin_estacion": 5.6, "p_diferencia": 0.004},
    {"caso": "Huelga 26/03/2025", "sentido": "vuelta", "con_estacion": -7.4, "sin_estacion": 4.9, "p_diferencia": 0.095},
    {"caso": "Huelga 01/04/2025", "sentido": "ida", "con_estacion": -20.4, "sin_estacion": 10.1, "p_diferencia": 0.0009},
    {"caso": "Huelga 01/04/2025", "sentido": "vuelta", "con_estacion": -17.9, "sin_estacion": 7.5, "p_diferencia": 0.002},
]

# Evidencia sobre la duración (vida media): M2 event study + M3 (Montcada día 5).
DURACION = {
    "dia_siguiente": "En los cuatro días de caos, al día siguiente los viajes vuelven a la normalidad (días +1 a +3 sin caída).",
    "incidencia_larga": "Montcada 2024, 5.º día del corte (17/05/2024): −9,9 % en M3, no significativo. La gente se adapta: el efecto se diluye en pocos días.",
    "pendiente": "La curva de vida media día a día (Montcada 2024, Gavà 2023) está pendiente de calcular.",
}


def num(x, d=2):
    if x is None:
        return None
    x = float(x)
    if not math.isfinite(x):
        return None
    return round(x, d)


def media(a, b, d=2):
    return round((a + b) / 2, d)


def coef(efecto, ic_inf, ic_sup, p, observado=True, fuente=""):
    return {"efecto": num(efecto), "ic_inf": num(ic_inf), "ic_sup": num(ic_sup),
            "p": num(p, 4), "observado": observado, "fuente": fuente}


def main():
    res = json.loads((DATA / "resultados" / "dashboard_resultados.json").read_text(encoding="utf-8"))
    inc = {i["fecha"]: i for i in res["incidencias"]}
    for f in [FECHA_AVERIA, FECHA_HUELGA, *FECHAS_ANUNCIADA]:
        assert f in inc, f"Falta la incidencia {f} en dashboard_resultados.json"

    conect = pd.read_parquet(DATA / "m2_conectividad_municipios.parquet")
    assert "alternativa" in res, "dashboard_resultados.json no trae 'alternativa': vuelve a ejecutar el notebook 04 (B.8)"

    # ------------------------------------------------------------------ coeficientes del simulador
    def grupos_de(fecha):
        return {g["grupo"]: g for g in inc[fecha]["grupos"]}

    def lineas_de(fecha):
        return {l["linea"]: l for l in inc[fecha]["lineas_dependientes"]}

    # Avería sin aviso: corte de una línea. Observado solo en la R1 (13/05/2024).
    r1 = lineas_de(FECHA_AVERIA)["R1"]
    g_av = grupos_de(FECHA_AVERIA)
    averia = {
        "dependiente_linea_cortada": coef(r1["efecto_pct"], r1["ic_inf"], r1["ic_sup"], r1["p_valor"],
                                          True, "Dependientes de la R1, avería 13/05/2024"),
        "dependiente_otra_linea": coef(g_av["dependientes"]["efecto_pct"], g_av["dependientes"]["ic_inf"],
                                       g_av["dependientes"]["ic_sup"], g_av["dependientes"]["p_valor"],
                                       True, "Todos los dependientes, 13/05/2024 (incluye líneas que funcionaban)"),
        "cercanos": coef(*(g_av["cercanos"][k] for k in ("efecto_pct", "ic_inf", "ic_sup", "p_valor")),
                         True, "Cercanos sin metro/FGC, 13/05/2024"),
        "metro_fgc": coef(*(g_av["metro_fgc"][k] for k in ("efecto_pct", "ic_inf", "ic_sup", "p_valor")),
                          True, "Con metro/FGC, 13/05/2024"),
        "lineas_observadas": ["R1"],
    }

    # Huelga general (como el 17/03/2025): coeficiente por línea de los dependientes.
    def tabla_huelga(fechas, etiqueta):
        lin = [lineas_de(f) for f in fechas]
        grp = [grupos_de(f) for f in fechas]
        out = {"lineas": {}, "grupos": {}}
        for clave in lin[0]:
            vals = [l[clave] for l in lin]
            out["lineas"][clave] = coef(
                sum(v["efecto_pct"] for v in vals) / len(vals),
                sum(v["ic_inf"] for v in vals) / len(vals),
                sum(v["ic_sup"] for v in vals) / len(vals),
                max(v["p_valor"] for v in vals) if len(vals) > 1 else vals[0]["p_valor"],
                True, f"Dependientes de {clave}, {etiqueta}")
        for g in ("dependientes", "cercanos", "metro_fgc"):
            vals = [x[g] for x in grp]
            out["grupos"][g] = coef(
                sum(v["efecto_pct"] for v in vals) / len(vals),
                sum(v["ic_inf"] for v in vals) / len(vals),
                sum(v["ic_sup"] for v in vals) / len(vals),
                max(v["p_valor"] for v in vals) if len(vals) > 1 else vals[0]["p_valor"],
                True, f"Grupo {g}, {etiqueta}")
        return out

    huelga = tabla_huelga([FECHA_HUELGA], "huelga 17/03/2025")
    anunciada = tabla_huelga(FECHAS_ANUNCIADA, "media de las huelgas 26/03 y 01/04/2025")

    barrios_m3 = res["barrios"] + M3_ANUNCIADAS

    tipos = [
        {"id": "averia", "nombre": "Avería sin aviso", "detalle": "Corte de una línea todo el día, sin tiempo para organizarse (como la R1 el 13/05/2024).",
         "requiere_linea": True, "coeficientes": averia, "referencia": [FECHA_AVERIA],
         "barrios": [b for b in barrios_m3 if b["caso"].startswith("Avería")]},
        {"id": "huelga", "nombre": "Huelga general", "detalle": "Toda la red con servicios mínimos y gran afectación (como el 17/03/2025).",
         "requiere_linea": False, "coeficientes": huelga, "referencia": [FECHA_HUELGA],
         "barrios": [b for b in barrios_m3 if b["caso"] == "Huelga 17/03/2025"]},
        {"id": "anunciada", "nombre": "Huelga anunciada", "detalle": "Huelga conocida con antelación: la gente se adapta (media del 26/03 y el 01/04/2025).",
         "requiere_linea": False, "coeficientes": anunciada, "referencia": FECHAS_ANUNCIADA,
         "barrios": [b for b in barrios_m3 if b["caso"] in ("Huelga 26/03/2025", "Huelga 01/04/2025")]},
    ]

    # ------------------------------------------------------------------ municipios
    vuln_path = DATA / "observatorio" / "vulnerabilidad.json"
    vulnerabilidad = json.loads(vuln_path.read_text(encoding="utf-8")) if vuln_path.exists() else {}
    resumen_path = DATA / "observatorio" / "vulnerabilidad_resumen.json"
    vuln_resumen = json.loads(resumen_path.read_text(encoding="utf-8")) if resumen_path.exists() else None

    base = {m["codigo"]: m for m in inc[FECHA_AVERIA]["municipios"]}
    municipios = []
    for codigo, m in base.items():
        efectos = {}
        for f, i in inc.items():
            x = next((y for y in i["municipios"] if y["codigo"] == codigo), None)
            if x is not None:
                efectos[f] = {"efecto": num(x["efecto_pct"]), "p": num(x["p_valor"], 4)}
        c = conect.loc[codigo] if codigo in conect.index else None
        alt = None
        if c is not None:
            alt = {
                "clase": c["alternativa"],
                "mejor": None if pd.isna(c["mejor_alt"]) else c["mejor_alt"],
                "t_alt": num(c["t_alt"], 0),
                "t_rodalies": num(c["t_rodalies"], 0),
                "penalizacion": num(c["penalizacion"], 0),
                "salidas_h_alt": num(c["salidas_h_alt"], 1),
                "salidas_h_rodalies": num(c["salidas_h_rodalies"], 1),
            }
        vals = [e["efecto"] for e in efectos.values() if e["efecto"] is not None]
        municipios.append({
            "codigo": codigo, "nombre": m["nombre"], "grupo": m["grupo"],
            "lineas": m["lineas"].split("+"), "lineas_clave": m["lineas"],
            "dist_km": num(m["dist_km"], 1), "lat": m["lat"], "lon": m["lon"],
            "viajes_referencia": num(m["viajes_referencia"], 0),
            "efectos": efectos,
            "efecto_medio": num(sum(vals) / len(vals)) if vals else None,
            "alternativa": alt,
            "vulnerabilidad": vulnerabilidad.get(codigo),
        })

    # Índice de vulnerabilidad (provisional): efecto medio en los 4 días de caos. Rango 1 = más vulnerable.
    orden = sorted([m for m in municipios if m["efecto_medio"] is not None], key=lambda m: m["efecto_medio"])
    for i, m in enumerate(orden, 1):
        m["rango_vulnerabilidad"] = i

    # ------------------------------------------------------------------ resto (relato y laboratorio)
    incidencias = []
    for f, i in inc.items():
        incidencias.append({k: i[k] for k in ("fecha", "titulo", "tipo", "descripcion", "tramo", "lineas", "lectura",
                                              "grupos", "perdidos", "serie", "banda_normal", "tramos",
                                              "lineas_dependientes", "evento")})

    # Efecto según la alternativa en transporte público (clustering, notebook 04)
    alternativa = [{"grupo": a["grupo"], "dia": a["dia"], "municipios": a["municipios"], "efecto": num(a["efecto_pct"]),
                    "ic_inf": num(a["ic_inf"]), "ic_sup": num(a["ic_sup"]), "p": num(a["p_valor"], 4)}
                   for a in res["alternativa"]]

    salida = {
        "version_esquema": 2,
        "fuente": res["fuente"],
        "periodo": res["periodo"],
        "respuesta": res["respuesta"],
        "kpis": res["kpis"],
        "conclusiones": res["conclusiones"],
        "tipos": tipos,
        "municipios": municipios,
        "incidencias": incidencias,
        "grupos": res["grupos"],
        "distancia": res["distancia"],
        "evento": res["evento"],
        "placebo": res["placebo"],
        "barrios": barrios_m3,
        "perdidos_media": res["perdidos_media"],
        "alternativa": alternativa,
        "duracion": DURACION,
        "metodo": res["metodo"],
        "limitaciones": res["limitaciones"] + ([
            "Motorización y renta: asociación entre 62 municipios, no causalidad. Los turismos se registran en el domicilio "
            "del titular (algunas flotas de empresa) y no sabemos qué parte de cada municipio viaja en tren."
        ] if vuln_resumen else []),
        "hay_vulnerabilidad": bool(vulnerabilidad),
        "vulnerabilidad_resumen": vuln_resumen,
    }
    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    SALIDA.write_text(json.dumps(salida, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"OK · {SALIDA.relative_to(RAIZ)} · {len(municipios)} municipios · {len(tipos)} escenarios")


if __name__ == "__main__":
    main()
