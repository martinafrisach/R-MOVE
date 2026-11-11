"""Documentación, disponibilidad y exportación de casos R-MOVE."""
from __future__ import annotations

import json
import numpy as np
import pandas as pd

from .rmove_general import normalizar_catalogo

from .rmove_indicators import (
    calcular_indicadores, comparar_relaciones, seleccionar_controles, MESES_EXCLUIDOS,
)


def ficha_incidencia(incidencias, identificador):
    incidencias = normalizar_catalogo(incidencias)
    identificador = str(identificador).strip()
    filas = incidencias.loc[incidencias["incident_id"].eq(identificador)]
    if len(filas) != 1:
        raise ValueError(f"Se esperaba una incidencia única: {identificador}")
    fila = filas.iloc[0]
    campos = {"lineas_afectadas": "line", "tramo": "place",
        "causa": "incident_type", "afectacion": "description",
        "horario": "schedule / duration", "fuente": "source",
        "url": "URL", "cautelas": "notes"}
    return {"id": identificador, "fecha": fila["date"].strftime("%Y-%m-%d"),
        **{destino: str(fila[origen]) if pd.notna(fila.get(origen)) else "No consta"
           for destino, origen in campos.items()}}


def evaluar_disponibilidad(movilidad, relaciones, fecha, incidencias, festivos,
                           umbral_viajes=100, minimo_dias=300):
    """Criterios comunes fijados con el volumen de 2024, no con las variaciones."""
    resultados = []
    for nombre, (origen, destino) in relaciones.items():
        grupo = movilidad.loc[movilidad["Relacion"].eq(nombre)]
        hist = grupo.loc[grupo["day"].between("2024-01-01", "2024-12-31")]
        media = float(hist["viajes_observados"].mean()) if len(hist) else None
        dia = grupo.loc[grupo["day"].eq(pd.Timestamp(fecha))]
        observado = float(dia["viajes_observados"].iloc[0]) if len(dia) else None
        controles = seleccionar_controles(grupo, fecha, incidencias, festivos)
        motivos = []
        if hist["day"].nunique() < minimo_dias:
            motivos.append(f"Menos de {minimo_dias} días observados en 2024")
        if media is None or not np.isfinite(media) or media < umbral_viajes:
            motivos.append(f"Media de 2024 inferior a {umbral_viajes} viajes/día")
        if observado is None or not np.isfinite(observado) or observado < 0:
            motivos.append("Sin observación válida en la fecha estudiada")
        if len(controles) < 3:
            motivos.append("Menos de tres controles válidos")
        resultados.append({"Relacion": nombre, "municipio_origen": origen,
            "municipio_destino": destino, "dias_observados_2024": hist["day"].nunique(),
            "viajes_medios_2024": media, "viajes_observados_fecha": observado,
            "n_controles": len(controles), "seleccionada": not motivos,
            "motivo": "; ".join(motivos) if motivos else "Datos suficientes"})
    return pd.DataFrame(resultados)


def conclusiones_caso(resultados, cobertura):
    def pct(valor):
        return f"{valor:+.2f}".replace(".", ",")
    validos = resultados.loc[resultados["estado"].eq("ok")]
    if validos.empty:
        return ["No hay relaciones con referencia válida para formular conclusiones."]
    menor = validos.loc[validos["variacion_observada_pct"].idxmin()]
    mayor = validos.loc[validos["variacion_observada_pct"].idxmax()]
    textos = [
        f"{len(validos)} relaciones con comparación válida: "
        f"{int(validos['variacion_observada_pct'].lt(0).sum())} por debajo de la mediana y "
        f"{int(validos['variacion_observada_pct'].gt(0).sum())} por encima.",
        f"Menor variación: {menor['Relacion']} ({pct(menor['variacion_observada_pct'])} %).",
        f"Mayor variación: {mayor['Relacion']} ({pct(mayor['variacion_observada_pct'])} %).",
    ]
    for campo, etiqueta in [("viajes_observados", "viajes provinciales"),
                             ("registros", "registros de movilidad")]:
        fila = cobertura.loc[cobertura["Indicador"].eq(campo)]
        if len(fila) and pd.notna(fila["Variacion (%)"].iloc[0]):
            textos.append(f"Variación de {etiqueta} frente a sus días comparables: "
                           f"{pct(fila['Variacion (%)'].iloc[0])} %.")
    textos.append("Las cifras son diferencias descriptivas frente a días comparables. "
                  "No demuestran efectos causales de Rodalies ni validan un detector de incidencias.")
    return textos


def registros_json(tabla):
    return json.loads(tabla.to_json(orient="records", force_ascii=False, double_precision=15))


def analizar_robustez(movilidad, fecha, incidencias, festivos, retrospectivo):
    predictivo = comparar_relaciones(movilidad, fecha, incidencias, festivos, modo="predictivo")
    campos = ["Relacion", "variacion_observada_pct", "n_controles"]
    robustez = retrospectivo[campos].merge(predictivo[campos], on="Relacion",
        suffixes=("_retrospectivo", "_predictivo"), validate="one_to_one")
    sensibilidad = pd.concat([
        comparar_relaciones(movilidad, fecha, incidencias, festivos, modo=modo, ventana=ventana)
        for modo in ["predictivo", "retrospectivo"] for ventana in [28, 42, 56]
    ], ignore_index=True)
    for _, r in retrospectivo.iterrows():
        g = movilidad.loc[movilidad["Relacion"].eq(r["Relacion"])]
        _, controles = calcular_indicadores(g, fecha, incidencias, festivos)
        assert r["n_controles"] == len(controles)
        assert pd.Timestamp(fecha) not in set(controles["day"])
        assert not controles["day"].dt.month.isin(MESES_EXCLUIDOS).any()
        assert controles["day"].dt.day_of_week.eq(pd.Timestamp(fecha).day_of_week).all()
        assert not set(controles["day"]) & set(incidencias)
        assert not controles["day"].map(lambda d: d.date() in festivos).any()
        if r["estado"] == "ok":
            assert np.isclose(r["variacion_observada_pct"],
                              100*(r["viajes_observados"]/controles["viajes_observados"].median()-1))
    return predictivo, robustez, sensibilidad


def exportar_caso(*, output_dir, fecha, ficha, ambito, municipios, resultados, movilidad,
                  disponibilidad, provincia, cobertura, robustez, sensibilidad,
                  fechas_incidencias, festivos, fuente_excel, descripcion=None):
    """Exporta datos calculados, controles, contexto y series con ausencias explícitas."""
    output_dir.mkdir(parents=True, exist_ok=True)
    fecha = pd.Timestamp(fecha)
    sufijo = fecha.strftime("%Y_%m_%d")
    controles_prov = seleccionar_controles(provincia, fecha, fechas_incidencias, festivos)
    serie_prov = provincia.set_index("day").reindex(pd.date_range(
        fecha-pd.Timedelta(days=42), fecha+pd.Timedelta(days=42))).rename_axis("day").reset_index()
    serie_prov["es_control"] = serie_prov["day"].isin(controles_prov["day"])
    serie_prov["day"] = serie_prov["day"].dt.strftime("%Y-%m-%d")
    indicadores_prov = cobertura.rename(columns={"Indicador": "indicador",
        "Observado": "observado", "Mediana controles": "mediana_controles",
        "Variacion (%)": "variacion_pct", "N controles": "n_controles"})
    auditoria = []
    evolucion = []
    for nombre, grupo in movilidad.groupby("Relacion", sort=True):
        _, controles = calcular_indicadores(grupo, fecha, fechas_incidencias, festivos)
        auditoria.append(controles[["Relacion", "municipio_origen", "municipio_destino",
                                    "day", "viajes_observados"]])
        for dia in pd.date_range(fecha-pd.Timedelta(days=21), fecha+pd.Timedelta(days=21)):
            fila, _ = calcular_indicadores(grupo, dia, fechas_incidencias, festivos)
            evolucion.append({"relacion": nombre, "fecha": fila["fecha"],
                "viajes_observados": fila["viajes_observados"],
                "mediana_viajes_controles": fila["mediana_viajes_controles"] if fila["estado"] == "ok" else None,
                "estado": fila["estado"]})
    tablas = {"controles": pd.concat(auditoria, ignore_index=True),
        "robustez_mediana": robustez, "sensibilidad_mediana": sensibilidad.drop(columns="fechas_controles"),
        "disponibilidad_od": disponibilidad, "cobertura_provincial": cobertura}
    for prefijo, tabla in tablas.items():
        tabla.to_csv(output_dir/f"{prefijo}_{sufijo}.csv", index=False, encoding="utf-8")
    controles_csv = f"controles_{sufijo}.csv"
    salida = {"proyecto": "R-MOVE", "version_esquema": 3,
        "fecha_incidencia": fecha.strftime("%Y-%m-%d"),
        "descripcion": descripcion or f"{ficha['causa']} · {ficha['tramo']}",
        "ambito": ambito, "incidencia_documentada": ficha, "municipios": municipios,
        "metodologia": {"metodo": "mediana_dias_mismo_dia_semana", "controles": {
            "modo": "retrospectivo", "ventana_dias": 42, "minimo_controles": 3,
            "mismo_dia_semana": True, "dia_semana": ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"][fecha.day_of_week],
            "solo_laborables": True, "meses_excluidos": list(MESES_EXCLUIDOS),
            "excluye_fecha_objetivo": True, "excluye_festivos_CT": True,
            "excluye_fechas_excel": True,
            "fechas_incidencias_excluidas": sorted(d.strftime("%Y-%m-%d") for d in fechas_incidencias),
            "fuente": fuente_excel},
            "unidades": {"variacion_observada_pct": "%", "diferencia_viajes": "viajes",
                "mediana_viajes_controles": "viajes", "p25_viajes_controles": "viajes",
                "p75_viajes_controles": "viajes"},
            "alcance": "Asociaciones temporales sin inferencia causal; P25–P75 descriptivos"},
        "relaciones": registros_json(resultados.rename(columns={"Relacion": "relacion"})),
        "disponibilidad_od": registros_json(disponibilidad.rename(columns={"Relacion": "relacion"})),
        "diagnostico_provincial": {"indicadores": registros_json(indicadores_prov),
            "fechas_controles": controles_prov["day"].dt.strftime("%Y-%m-%d").tolist(),
            "serie": registros_json(serie_prov)},
        "robustez": registros_json(robustez.rename(columns={"Relacion": "relacion"})),
        "sensibilidad": registros_json(sensibilidad.drop(columns="fechas_controles").rename(columns={"Relacion": "relacion"})),
        "evolucion_temporal": evolucion, "conclusiones": conclusiones_caso(resultados, cobertura),
        "archivos": {"controles": controles_csv}}
    with (output_dir/f"incidencia_{sufijo}.json").open("w", encoding="utf-8", newline="\n") as f:
        json.dump(salida, f, ensure_ascii=False, indent=2, allow_nan=False)
    return salida
