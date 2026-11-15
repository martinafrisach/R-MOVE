# %% [markdown]
# ## 13. Exportación para el dashboard: página «Conclusiones»
# Esta celda junta los resultados de M2 (mapa por municipio, efecto por grupo y event study)
# y de M3 (barrios con y sin estación) en un solo JSON. El dashboard solo lee este fichero:
# no recalcula nada en el navegador.
# Salida: `data/processed/rmove/conclusiones/dashboard_conclusiones.json`.

# %%
import hashlib, json, math
from pathlib import Path
import pandas as pd

DATA = Path("../data/processed/rmove")          # misma carpeta que los demás exportados
OUT = DATA / "conclusiones" / "dashboard_conclusiones.json"

# ---------------------------------------------------------------------------
# 1) ENTRADAS: adapta SOLO este bloque a los nombres de tu notebook de M2
# ---------------------------------------------------------------------------
# a) Municipios: código, nombre, grupo, coordenadas y viajes/día de referencia a BCN.
info = pd.read_parquet(DATA / "m2_info_municipios.parquet").rename(columns={
    # "nombre_en_tu_parquet": "nombre_que_espera_el_dashboard"
    "municipio": "codigo", "nombre": "nombre", "grupo": "grupo",
    "lat": "lat", "lon": "lon", "viajes_dia": "viajes_referencia",
})
# b) Efecto por municipio (clustering): una fila por fecha de caos y municipio.
efectos_mun = efectos_municipio_clustering.rename(columns={      # <- tu DataFrame
    "fecha": "fecha", "municipio": "codigo", "efecto": "efecto", "p": "p_valor",
})
# c) Efecto por grupo (clustering): una fila por fecha y grupo.
efectos_grupo = efectos_grupo_clustering.rename(columns={          # <- tu DataFrame
    "fecha": "fecha", "grupo": "grupo", "efecto": "efecto", "p": "p_valor",
})
# d) Event study (regresión): días relativos −5…+3 con su IC 95 %.
event_study = es_resultados.rename(columns={                       # <- tu DataFrame
    "dia_rel": "dia", "efecto_pct": "efecto_pct", "ic_inf": "ic_inf", "ic_sup": "ic_sup",
})
EFECTO_EN_FRACCION = True   # True si el efecto está como −0,081; False si ya está como −8,1
GRUPOS = {                  # etiqueta en tu notebook -> clave del dashboard
    "Dependientes": "dependientes",
    "Cercanos sin metro/FGC": "cercanos",
    "Con metro/FGC": "metro_fgc",
    "Sin Rodalies": "sin_rodalies",
}
# ---------------------------------------------------------------------------

CASOS = {
    "2024-05-13": ("Avería de la R1 · Montcada", "Corte de todo el día. La caída se concentra en el Maresme norte."),
    "2025-03-17": ("Huelga de Rodalies", "Afecta a todos los corredores alejados, sobre todo Osona (R3) y el Garraf (R2 Sud)."),
    "2025-03-26": ("Huelga anunciada", "El total apenas cambia: los viajes se redistribuyen hacia barrios sin estación (M3)."),
    "2025-04-01": ("Huelga anunciada", "El total apenas cambia: los viajes se redistribuyen hacia barrios sin estación (M3)."),
}

# M3: barrios con y sin estación (regresión, municipios dependientes). Copiado de m3_hallazgos.md (H2).
BARRIOS = [
    {"caso": "Todos los días de caos", "sentido": "ida",    "con_estacion": -19.0, "sin_estacion": 1.8, "p_diferencia": 0.0009},
    {"caso": "Todos los días de caos", "sentido": "vuelta", "con_estacion": -18.3, "sin_estacion": 4.9, "p_diferencia": 0.0009},
    {"caso": "Huelga 17/03/2025",      "sentido": "ida",    "con_estacion": -18.4, "sin_estacion": -10.1, "p_diferencia": 0.235},
    {"caso": "Huelga 17/03/2025",      "sentido": "vuelta", "con_estacion": -14.1, "sin_estacion": 4.1, "p_diferencia": 0.018},
    {"caso": "Avería 13/05/2024",      "sentido": "ida",    "con_estacion": -26.6, "sin_estacion": 2.8, "p_diferencia": 0.003},
    {"caso": "Avería 13/05/2024",      "sentido": "vuelta", "con_estacion": -32.0, "sin_estacion": 3.1, "p_diferencia": 0.001},
]  # «p < 0,001» se guarda como 0,0009 y el dashboard lo muestra como «< 0,001».

# 2) Preparación y comprobaciones
escala = 100 if EFECTO_EN_FRACCION else 1
efectos_mun = efectos_mun.assign(fecha=pd.to_datetime(efectos_mun["fecha"]).dt.strftime("%Y-%m-%d"),
                                 efecto_pct=efectos_mun["efecto"] * escala)
efectos_grupo = efectos_grupo.assign(fecha=pd.to_datetime(efectos_grupo["fecha"]).dt.strftime("%Y-%m-%d"),
                                     efecto_pct=efectos_grupo["efecto"] * escala,
                                     grupo=efectos_grupo["grupo"].map(GRUPOS))
info = info.assign(grupo=info["grupo"].map(GRUPOS), codigo=info["codigo"].astype(str).str.zfill(5))
efectos_mun["codigo"] = efectos_mun["codigo"].astype(str).str.zfill(5)

assert info["grupo"].notna().all(), "Hay grupos sin traducir en GRUPOS"
assert efectos_grupo["grupo"].notna().all(), "Hay grupos sin traducir en GRUPOS (efectos_grupo)"
assert info[["lat", "lon"]].notna().all().all(), "Faltan coordenadas de municipios"
assert info["lat"].between(40.4, 42.9).all() and info["lon"].between(0.1, 3.4).all(), "Coordenadas fuera de Cataluña"
assert set(CASOS) <= set(efectos_mun["fecha"]), f"Faltan fechas: {set(CASOS) - set(efectos_mun['fecha'])}"
assert efectos_mun["efecto_pct"].between(-100, 500).all(), "Revisa EFECTO_EN_FRACCION: valores fuera de rango"

def num(x, d=2):
    x = float(x)
    assert math.isfinite(x), "Valor no finito"
    return round(x, d)

mapa = []
for fecha, (titulo, descripcion) in CASOS.items():
    m = efectos_mun[efectos_mun["fecha"] == fecha].merge(info, on="codigo", how="inner")
    g = efectos_grupo[efectos_grupo["fecha"] == fecha]
    mapa.append({
        "fecha": fecha, "titulo": titulo, "descripcion": descripcion,
        "grupos": [{"grupo": r.grupo, "efecto_pct": num(r.efecto_pct), "p_valor": num(r.p_valor, 4)}
                   for r in g.itertuples()],
        "municipios": [{"codigo": r.codigo, "nombre": r.nombre, "grupo": r.grupo,
                        "lat": num(r.lat, 5), "lon": num(r.lon, 5),
                        "viajes_referencia": num(r.viajes_referencia, 0),
                        "efecto_pct": num(r.efecto_pct), "p_valor": num(r.p_valor, 4)}
                       for r in m.sort_values("codigo").itertuples()],
    })

es = event_study.sort_values("dia")
evento = [{"dia": int(r.dia), "efecto_pct": num(r.efecto_pct), "ic_inf": num(r.ic_inf), "ic_sup": num(r.ic_sup)}
          for r in es.itertuples()]
assert [e["dia"] for e in evento] == list(range(-5, 4)), "El event study debe ir del día −5 al +3"

def dep(fecha):
    return efectos_grupo.query("fecha == @fecha and grupo == 'dependientes'")["efecto_pct"].iloc[0]

dia0 = next(e for e in evento if e["dia"] == 0)
fmt = lambda v: f"{v:+.1f}".replace(".", ",").replace("-", "−")
conclusiones = [
    {"pregunta": "¿Qué pasa el primer día de un corte?",
     "titulo": "Se viaja menos desde los municipios que dependen del tren",
     "texto": (f"En los municipios dependientes de Rodalies los viajes a Barcelona caen: {fmt(dep('2025-03-17'))} % en la huelga "
               f"del 17/03/2025 y {fmt(dep('2024-05-13'))} % en la avería del 13/05/2024. Donde hay metro o FGC no cambian. "
               "El efecto crece con la distancia.")},
    {"pregunta": "¿Dónde se nota dentro de Barcelona?",
     "titulo": "En los barrios con estación",
     "texto": "La caída se concentra en los viajes hacia y desde los barrios con estación de Rodalies (−19 % a la ida y −18 % a la vuelta). "
              "En los demás barrios no hay cambio. En las huelgas anunciadas el total casi no varía, pero los viajes se desplazan a barrios sin estación."},
    {"pregunta": "¿Cuánto dura el efecto?",
     "titulo": "Un día; después los viajes se recuperan",
     "texto": (f"El día de la incidencia el efecto es de {fmt(dia0['efecto_pct'])} %; del día +1 al +3 vuelve a ≈ 0. "
               "En los cortes largos (Montcada a partir del día 5, Gavà) el efecto es débil: la gente se adapta y vuelve a viajar.")},
    {"pregunta": "¿Por qué el análisis general es más prudente?",
     "titulo": "Solo se detectan los cortes de todo el día",
     "texto": "Con datos diarios, los retrasos, los cortes de unas horas y las reducciones moderadas de servicio no cambian el volumen: "
              "la gente llega tarde, pero viaja. El análisis general mezcla todas las incidencias del Excel, por eso su asociación es débil."},
]

resultado = {
    "version_esquema": 1,
    "fuente": "R-MOVE · M2 (municipio → Barcelona) y M3 (municipio ↔ barrio), Telefónica Smart Steps",
    "periodo": {"inicio": "2023-01-01", "fin": "2025-08-31"},
    "kpis": [
        {"valor": len(CASOS), "decimales": 0, "unidad": "", "etiqueta": "Días de corte analizados"},
        {"valor": int((info["grupo"] == "dependientes").sum()), "decimales": 0, "unidad": "", "etiqueta": "Municipios dependientes de Rodalies"},
        {"valor": dia0["efecto_pct"], "decimales": 1, "unidad": " %", "etiqueta": "Viajes el día del corte (dependientes)"},
        {"valor": -19.0, "decimales": 1, "unidad": " %", "etiqueta": "Hacia barrios con estación (M3)"},
    ],
    "mapa": mapa,
    "evento": evento,
    "barrios": BARRIOS,
    "conclusiones": conclusiones,
    "metodo": {
        "mapa": "Efecto por municipio con el método de clustering: viajes del día / mediana de los días limpios del mismo tipo (A, B o C) − 1. Solo municipios con ≥ 200 viajes/día.",
        "grupos": "Dependientes: con Rodalies, sin metro ni FGC y a ≥ 20 km de Plaça Catalunya. Control: municipios sin Rodalies.",
        "evento": "Regresión DiD con efectos fijos (municipio × día de la semana y fecha); errores agrupados por municipio.",
        "barrios": "M3, regresión con efecto fijo día × tipo de barrio; municipios dependientes con ≥ 200 viajes/día hacia cada tipo.",
    },
    "limitaciones": [
        "Datos diarios de todos los modos de transporte: no identifican el tren ni la hora.",
        "Solo cuatro días de corte con un control limpio; en municipios pequeños la significancia es baja.",
        "El clustering no resta el choque común del día: importa la diferencia entre grupos, no el valor absoluto.",
        "Las magnitudes de M3 no son comparables con las de M2; se comparan direcciones y diferencias dentro de M3.",
    ],
}

OUT.parent.mkdir(parents=True, exist_ok=True)
contenido = json.dumps(resultado, ensure_ascii=False, indent=1).encode("utf-8")
OUT.write_bytes(contenido)
print(f"Guardado: {OUT}  ({sum(len(c['municipios']) for c in mapa)} filas de municipios)")
print("SHA-256 para publication.json:", hashlib.sha256(contenido).hexdigest())
