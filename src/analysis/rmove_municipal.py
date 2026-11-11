"""Cambios municipales por fecha documentada; entradas y salidas separadas.

No interpreta la diferencia descriptiva como efecto causal ni crea controles
territoriales para municipios de exposición desconocida.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import duckdb
import holidays
import pandas as pd

from .rmove_general import normalizar_catalogo
from .rmove_indicators import seleccionar_controles
from .rmove_territory import validar_revision


def agregar_municipios(con, ruta, inicio, fin):
    for numero, (sentido, codigo, contraparte) in enumerate([
        ("salidas", "municipio_origen", "municipio_destino"),
        ("entradas", "municipio_destino", "municipio_origen"),
    ]):
        accion = "CREATE OR REPLACE TEMP TABLE movilidad_municipal AS" if numero == 0 else "INSERT INTO movilidad_municipal"
        con.execute(f"""
            {accion}
            SELECT CAST(day AS DATE) AS day, {codigo} AS codigo, '{sentido}' AS sentido,
              CASE WHEN COUNT(*) FILTER (WHERE viajes IS NULL OR viajes < 0) > 0
                   THEN NULL ELSE SUM(viajes) END AS viajes_observados,
              COUNT(*) AS registros,
              COUNT(*) FILTER (WHERE viajes IS NULL OR viajes < 0) AS registros_invalidos,
              COUNT(DISTINCT {contraparte}) AS n_od
            FROM read_parquet(?)
            WHERE day BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
              AND municipio_origen <> municipio_destino
            GROUP BY CAST(day AS DATE), {codigo}
        """, [str(ruta), inicio, fin])


def calendario_comparaciones(catalogo, inicio, fin, ventana):
    fechas = set(catalogo.date)
    inicio, fin = pd.Timestamp(inicio), pd.Timestamp(fin)
    festivos = holidays.country_holidays("ES", subdiv="CT", years=range(inicio.year, fin.year + 1))
    dias = pd.DataFrame({"day": pd.date_range(inicio, fin), "viajes_observados": 1.})
    objetivos, controles = [], []
    for fecha, grupo in catalogo.groupby("date", sort=True):
        elegible = fecha.weekday() < 5 and fecha.month not in [7, 8] and fecha.date() not in festivos
        objetivos.append({"fecha": fecha, "calendario_elegible": elegible,
                          "n_registros_documentados_fecha": len(grupo)})
        referencias = seleccionar_controles(dias, fecha, fechas, festivos, ventana=ventana)
        controles.extend({"fecha": fecha, "fecha_control": dia} for dia in referencias.day)
    return pd.DataFrame(objetivos), pd.DataFrame(controles, columns=["fecha", "fecha_control"])


def comparar_municipios(con, objetivos, controles, minimo=3):
    if minimo < 3:
        raise ValueError("Se requieren al menos tres controles")
    con.register("objetivos_municipales", objetivos)
    con.register("calendario_controles_municipales", controles)
    con.execute("""
        CREATE OR REPLACE TEMP TABLE referencias_municipales AS
        SELECT c.fecha, m.codigo, m.sentido,
               COUNT(m.viajes_observados) AS n_controles,
               MEDIAN(m.viajes_observados) AS mediana_viajes_controles,
               QUANTILE_CONT(m.viajes_observados, 0.25) AS p25_viajes_controles,
               QUANTILE_CONT(m.viajes_observados, 0.75) AS p75_viajes_controles,
               MEDIAN(m.n_od) FILTER (WHERE m.viajes_observados IS NOT NULL) AS mediana_n_od_controles,
               LIST(STRFTIME(m.day, '%Y-%m-%d') ORDER BY m.day)
                    FILTER (WHERE m.viajes_observados IS NOT NULL) AS fechas_controles
        FROM calendario_controles_municipales c
        JOIN movilidad_municipal m ON m.day = CAST(c.fecha_control AS DATE)
        GROUP BY c.fecha, m.codigo, m.sentido
    """)
    return con.execute("""
        WITH entidades AS (SELECT DISTINCT codigo, sentido FROM movilidad_municipal),
        detalle AS (
            SELECT o.*, e.codigo, e.sentido, m.viajes_observados, m.registros,
                   m.registros_invalidos, m.n_od,
                   COALESCE(r.n_controles, 0) AS n_controles,
                   r.mediana_viajes_controles, r.p25_viajes_controles, r.p75_viajes_controles,
                   r.mediana_n_od_controles, r.fechas_controles,
                   CASE WHEN NOT o.calendario_elegible THEN 'fuera_del_ambito_calendario'
                        WHEN m.viajes_observados IS NULL THEN 'sin_observacion_valida'
                        WHEN COALESCE(r.n_controles, 0) < ? THEN 'controles_insuficientes'
                        WHEN r.mediana_viajes_controles <= 0 THEN 'referencia_cero'
                        ELSE 'ok' END AS estado
            FROM objetivos_municipales o CROSS JOIN entidades e
            LEFT JOIN movilidad_municipal m ON m.day = CAST(o.fecha AS DATE)
                AND m.codigo = e.codigo AND m.sentido = e.sentido
            LEFT JOIN referencias_municipales r ON r.fecha = o.fecha
                AND r.codigo = e.codigo AND r.sentido = e.sentido
        )
        SELECT *, CASE WHEN estado = 'ok'
                   THEN 100.0 * (viajes_observados / mediana_viajes_controles - 1) END AS variacion_observada_pct,
                  CASE WHEN estado = 'ok'
                   THEN viajes_observados - mediana_viajes_controles END AS diferencia_viajes,
                  CASE WHEN mediana_n_od_controles > 0
                   THEN 100.0 * (n_od / mediana_n_od_controles - 1) END AS variacion_n_od_pct
        FROM detalle ORDER BY fecha, codigo, sentido
    """, [minimo]).df()


def agregar_exposicion_por_fecha(catalogo, exposicion):
    """No duplica un cambio municipal por varias noticias del mismo día."""
    if exposicion.empty:
        return pd.DataFrame(columns=["fecha", "codigo", "exposicion", "ids_asignacion"])
    tabla = exposicion.merge(catalogo[["incident_id", "date"]], on="incident_id", validate="many_to_one")
    filas = []
    for (fecha, codigo), grupo in tabla.groupby(["date", "codigo"], sort=True):
        categorias = set(grupo.categoria)
        if "directa" in categorias:
            categoria = "directa"
        elif "indirecta" in categorias:
            categoria = "indirecta"
        elif categorias == {"baja"} and set(grupo.incident_id) == set(catalogo.loc[catalogo.date.eq(fecha), "incident_id"]):
            categoria = "baja"
        else:
            categoria = "desconocida"
        filas.append({"fecha": fecha, "codigo": codigo, "exposicion": categoria,
                      "ids_asignacion": sorted(set(grupo.incident_id))})
    return pd.DataFrame(filas)


def ejecutar(config_path):
    root = Path(__file__).resolve().parents[2]
    config = json.loads(Path(config_path).read_text(encoding="utf-8"))
    excel = root / config["incidencias"]
    catalogo = normalizar_catalogo(pd.read_excel(excel, sheet_name=config["hoja"]))
    if not catalogo.date.between(config["inicio_catalogo"], config["fin_catalogo"]).all():
        raise ValueError("El catálogo excede el periodo declarado")
    objetivos, controles = calendario_comparaciones(catalogo, config["inicio_catalogo"],
                                                   config["fin_catalogo"], config["ventana_dias"])
    salida = root / config["salida"]
    salida.mkdir(parents=True, exist_ok=True)
    revision = []
    if config.get("revision_territorial"):
        revision = json.loads((root / config["revision_territorial"]).read_text(encoding="utf-8"))
    with duckdb.connect() as con:
        agregar_municipios(con, root / config["movilidad"], config["inicio_catalogo"], config["fin_catalogo"])
        municipios = con.execute("SELECT DISTINCT codigo FROM movilidad_municipal").df()
        exposicion = validar_revision(revision, catalogo, municipios)
        resultados = comparar_municipios(con, objetivos, controles)
        con.execute("COPY movilidad_municipal TO ? (FORMAT PARQUET)", [str(salida / "movilidad_municipal_diaria.parquet")])
    por_fecha = agregar_exposicion_por_fecha(catalogo, exposicion)
    resultados = resultados.merge(por_fecha, on=["fecha", "codigo"], how="left", validate="many_to_one")
    resultados["exposicion"] = resultados.exposicion.fillna("desconocida")
    resultados["tipo_comparacion"] = "descriptiva_por_fecha_documentada"
    resultados.to_parquet(salida / "cambios_municipales.parquet", index=False)
    # Resumen descriptivo: una observación por municipio, sentido y fecha.
    validos = resultados.loc[resultados.estado.eq("ok")].copy()
    validos["magnitud_absoluta_pct"] = validos.variacion_observada_pct.abs()
    resumen = validos.groupby(["sentido", "exposicion"], as_index=False).agg(
        n_municipio_fecha=("codigo", "size"), n_municipios=("codigo", "nunique"),
        n_fechas=("fecha", "nunique"), mediana_variacion_pct=("variacion_observada_pct", "median"),
        mediana_magnitud_pct=("magnitud_absoluta_pct", "median"))
    resumen.to_csv(salida / "resumen_municipal_descriptivo.csv", index=False, encoding="utf-8-sig")
    auditoria = {"configuracion": config, "n_resultados": len(resultados),
                "estados": resultados.estado.value_counts().to_dict(),
                "exposicion": resultados.exposicion.value_counts().to_dict(),
                "sha256_catalogo": hashlib.sha256(excel.read_bytes()).hexdigest(),
                "sha256_motor": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                "limitaciones": ["Comparación descriptiva, no estimación causal ni prueba de significación.",
                    "Los municipios de exposición desconocida no son controles territoriales.",
                    "Entradas y salidas contabilizan el mismo viaje en sus dos extremos; no deben sumarse como viajes únicos.",
                    "La composición de OD observadas puede variar; se informa n_od sin imputar las ausentes.",
                    "Las fechas con varios registros se cuentan una vez por municipio y sentido.",
                    "La exposición directa prevalece sobre la indirecta en fechas con varios registros.",
                    "El resumen pondera cada municipio-fecha por igual; todavía no ajusta composición ni dependencia.",
                    "Los controles excluyen fechas registradas, no duraciones completas aún sin revisar."]}
    if config.get("revision_territorial"):
        auditoria["sha256_revision"] = hashlib.sha256((root / config["revision_territorial"]).read_bytes()).hexdigest()
    (salida / "auditoria_municipal.json").write_text(json.dumps(auditoria, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"resultados": len(resultados), "estados": auditoria["estados"],
                      "exposicion": auditoria["exposicion"]}, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="src/analysis/general_config.json")
    ejecutar(parser.parse_args().config)
