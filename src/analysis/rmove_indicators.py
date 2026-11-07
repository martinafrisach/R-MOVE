"""Referencia R-MOVE: mediana de días del mismo día semanal.

Julio y agosto se excluyen por decisión del proyecto, no como calendario escolar.
Los percentiles son descriptivos, nunca umbrales de significación ni causalidad.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

MODOS = {"retrospectivo", "predictivo"}
MESES_EXCLUIDOS = (7, 8)
MINIMO_CONTROLES = 3
VENTANA_DIAS = 42


def preparar_grupo(grupo):
    grupo = grupo.copy()
    if "viajes_observados" not in grupo and "viajes" in grupo:
        grupo = grupo.rename(columns={"viajes": "viajes_observados"})
    grupo["day"] = pd.to_datetime(grupo["day"]).dt.normalize()
    if grupo["day"].duplicated().any():
        raise ValueError("Más de una observación diaria para la misma relación")
    grupo["viajes_observados"] = pd.to_numeric(grupo["viajes_observados"], errors="raise")
    return grupo.sort_values("day").reset_index(drop=True)


def fechas_elegibles(grupo, festivos, meses_excluidos=MESES_EXCLUIDOS):
    dias = grupo["day"]
    return (
        dias.dt.day_of_week.lt(5)
        & ~dias.dt.month.isin(meses_excluidos)
        & ~dias.map(lambda d: d.date() in festivos)
    )


def seleccionar_controles(grupo, fecha, fechas_incidencias, festivos,
                         modo="retrospectivo", ventana=VENTANA_DIAS,
                         meses_excluidos=MESES_EXCLUIDOS):
    if modo not in MODOS or ventana < 1:
        raise ValueError("Modo o ventana no válidos")
    fecha = pd.Timestamp(fecha).normalize()
    grupo = preparar_grupo(grupo)
    fin = fecha + pd.Timedelta(days=ventana) if modo == "retrospectivo" else fecha - pd.Timedelta(days=1)
    excluidas = pd.DatetimeIndex(pd.to_datetime(list(fechas_incidencias))).normalize()
    mask = (
        grupo["day"].between(fecha - pd.Timedelta(days=ventana), fin)
        & grupo["day"].ne(fecha)
        & grupo["day"].dt.day_of_week.eq(fecha.day_of_week)
        & fechas_elegibles(grupo, festivos, meses_excluidos)
        & ~grupo["day"].isin(excluidas)
        & np.isfinite(grupo["viajes_observados"])
        & grupo["viajes_observados"].ge(0)
    )
    return grupo.loc[mask].copy()


def resumir_controles(controles):
    viajes = controles["viajes_observados"]
    return {
        "mediana_viajes_controles": float(viajes.median()) if len(viajes) else None,
        "p25_viajes_controles": float(viajes.quantile(.25)) if len(viajes) else None,
        "p75_viajes_controles": float(viajes.quantile(.75)) if len(viajes) else None,
        "n_controles": len(controles),
        "fechas_controles": controles["day"].dt.strftime("%Y-%m-%d").tolist(),
    }


def calcular_indicadores(grupo, fecha, fechas_incidencias, festivos,
                        modo="retrospectivo", ventana=VENTANA_DIAS,
                        minimo_controles=MINIMO_CONTROLES):
    grupo = preparar_grupo(grupo)
    fecha = pd.Timestamp(fecha).normalize()
    dia = grupo.loc[grupo["day"].eq(fecha)]
    controles = seleccionar_controles(grupo, fecha, fechas_incidencias, festivos, modo, ventana)
    resumen = resumir_controles(controles)
    observado = float(dia["viajes_observados"].iloc[0]) if len(dia) else None
    observado_valido = observado is not None and np.isfinite(observado) and observado >= 0
    permitido = fecha.day_of_week < 5 and fecha.month not in MESES_EXCLUIDOS and fecha.date() not in festivos
    if not permitido:
        estado = "fuera_del_ambito_calendario"
    elif not observado_valido:
        estado = "sin_observacion_valida"
    elif len(controles) < minimo_controles:
        estado = "controles_insuficientes"
    elif resumen["mediana_viajes_controles"] <= 0:
        estado = "referencia_cero"
    else:
        estado = "ok"
    base = dia.iloc[0] if len(dia) else (grupo.iloc[0] if len(grupo) else {})
    mediana = resumen["mediana_viajes_controles"]
    usable = estado == "ok"
    resultado = {
        "Relacion": base.get("Relacion", ""),
        "municipio_origen": base.get("municipio_origen", ""),
        "municipio_destino": base.get("municipio_destino", ""),
        "fecha": fecha.strftime("%Y-%m-%d"),
        "viajes_observados": observado if observado_valido else None,
        **resumen,
        "variacion_observada_pct": 100 * (observado / mediana - 1) if usable else None,
        "diferencia_viajes": observado - mediana if usable else None,
        "fuera_rango_intercuartil_viajes": bool(observado < resumen["p25_viajes_controles"] or observado > resumen["p75_viajes_controles"]) if usable else None,
        "modo_controles": modo, "ventana_dias": ventana,
        "minimo_controles": minimo_controles, "estado": estado,
    }
    return resultado, controles


def comparar_relaciones(movilidad, fecha, fechas_incidencias, festivos,
                       modo="retrospectivo", ventana=VENTANA_DIAS):
    filas = [calcular_indicadores(g, fecha, fechas_incidencias, festivos, modo, ventana)[0]
             for _, g in movilidad.groupby("Relacion", sort=True)]
    return pd.DataFrame(filas).sort_values("variacion_observada_pct", na_position="last").reset_index(drop=True)


def evaluar_mediana(movilidad, fechas_incidencias, festivos,
                    inicio="2025-01-01", fin="2025-08-31", ventana=VENTANA_DIAS,
                    minimo_controles=MINIMO_CONTROLES):
    """Validación predictiva: todos los métodos usan idénticas fechas y controles.

    La media y el último día comparable son referencias sencillas, no algoritmos
    ajustados. Ninguna observación del objetivo ni del futuro entra en ellas.
    """
    filas = []
    excluidas = pd.DatetimeIndex(pd.to_datetime(list(fechas_incidencias))).normalize()
    for relacion, grupo in movilidad.groupby("Relacion", sort=True):
        grupo = preparar_grupo(grupo)
        objetivos = grupo.loc[
            grupo["day"].between(inicio, fin) & fechas_elegibles(grupo, festivos)
            & ~grupo["day"].isin(excluidas)
            & np.isfinite(grupo["viajes_observados"]) & grupo["viajes_observados"].ge(0)
        ]
        for _, dia in objetivos.iterrows():
            controles = seleccionar_controles(grupo, dia["day"], fechas_incidencias, festivos, "predictivo", ventana)
            if len(controles) < minimo_controles:
                continue
            resumen = resumir_controles(controles)
            filas.append({
                "Relacion": relacion, "day": dia["day"],
                "viajes_observados": dia["viajes_observados"],
                "mediana": resumen["mediana_viajes_controles"],
                "media": float(controles["viajes_observados"].mean()),
                "ultimo_comparable": float(controles["viajes_observados"].iloc[-1]),
                "p25_viajes_controles": resumen["p25_viajes_controles"],
                "p75_viajes_controles": resumen["p75_viajes_controles"],
                "n_controles": len(controles), "n_candidatos": len(objetivos),
                "primera_fecha_control": controles["day"].min(),
                "ultima_fecha_control": controles["day"].max(),
            })
    return pd.DataFrame(filas)


def metricas_referencia(tabla, columna):
    observados = tabla["viajes_observados"]
    error = tabla[columna] - observados
    volumen = observados.sum()
    return {
        "n_od_dia": len(tabla), "n_fechas": tabla["day"].nunique(),
        "MAE_viajes": float(error.abs().mean()),
        "WAPE_pct": float(100 * error.abs().sum() / volumen) if volumen > 0 else None,
        "sesgo_pct": float(100 * error.sum() / volumen) if volumen > 0 else None,
    }


def cargar_relaciones(con, ruta, relaciones):
    """Una sola agregación de M2 para las OD solicitadas; no rellena ausencias."""
    pares = pd.DataFrame([
        {"Relacion": nombre, "municipio_origen": origen, "municipio_destino": destino}
        for nombre, (origen, destino) in relaciones.items()
    ])
    if pares.duplicated(["municipio_origen", "municipio_destino"]).any():
        raise ValueError("OD duplicada con distintas etiquetas")
    con.register("rmove_od_seleccionadas", pares)
    return con.execute("""
        SELECT s.Relacion, p.municipio_origen, p.municipio_destino, p.day,
               SUM(p.viajes) AS viajes_observados
        FROM read_parquet(?) p JOIN rmove_od_seleccionadas s
        USING (municipio_origen, municipio_destino)
        GROUP BY ALL ORDER BY Relacion, day
    """, [str(ruta)]).df().assign(day=lambda d: pd.to_datetime(d["day"]))
