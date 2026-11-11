"""Auditoría y contexto diario de la muestra de incidencias documentadas.

Ejecución: python -m src.analysis.rmove_general --config src/analysis/general_config.json
Los límites del catálogo son declarados: nunca se deducen de la primera/última noticia.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from numbers import Real
from pathlib import Path

import duckdb
import holidays
import pandas as pd

from .rmove_indicators import calcular_indicadores


def cargar_catalogo(ruta, hoja="Incidencias Barcelona"):
    """Lectura compartida del Excel vigente, con identidad y fechas normalizadas."""
    return normalizar_catalogo(pd.read_excel(ruta, sheet_name=hoja))


def normalizar_catalogo(datos):
    """Conserva los campos documentales y valida la identidad de cada registro."""
    requeridas = {"incident_id", "date", "line", "place", "source", "URL"}
    faltan = requeridas - set(datos.columns)
    if faltan:
        raise ValueError(f"Faltan columnas del catálogo: {sorted(faltan)}")
    tabla = datos.copy()
    if tabla.incident_id.isna().any():
        raise ValueError("Hay identificadores ausentes")
    tabla["incident_id"] = tabla.incident_id.astype(str).str.strip()
    if tabla.incident_id.eq("").any() or tabla.incident_id.duplicated().any():
        raise ValueError("Identificadores vacíos o duplicados")
    # Excel puede mezclar fechas reales con números de serie en la misma columna.
    def fecha_excel(valor):
        if isinstance(valor, Real) and pd.notna(valor):
            if not 20000 <= valor <= 80000:
                raise ValueError(f"Número de fecha Excel fuera de rango: {valor}")
            return pd.Timestamp("1899-12-30") + pd.Timedelta(days=float(valor))
        return pd.to_datetime(valor, errors="raise")
    tabla["date"] = pd.to_datetime(tabla.date.map(fecha_excel)).dt.normalize()
    if tabla.date.isna().any():
        raise ValueError("Hay fechas ausentes")
    tabla["lineas_normalizadas"] = tabla.line.map(lambda v: sorted(set(
        s.strip() for s in re.split(r"[;,]", str(v)) if s.strip())) if pd.notna(v) else [])
    tabla["exposicion_territorial"] = "pendiente_de_cartografia"
    tabla["duracion_validada"] = False
    return tabla.sort_values(["date", "incident_id"]).reset_index(drop=True)


def auditar_fechas(catalogo, cobertura, inicio, fin, ventana=42):
    inicio, fin = pd.Timestamp(inicio), pd.Timestamp(fin)
    if inicio > fin or ventana < 1:
        raise ValueError("Periodo o ventana inválidos")
    if not catalogo.date.between(inicio, fin).all():
        raise ValueError("Hay incidencias fuera del periodo declarado del catálogo")
    festivos = holidays.country_holidays("ES", subdiv="CT", years=range(inicio.year, fin.year + 1))
    serie = cobertura.copy()
    serie["day"] = pd.to_datetime(serie.day).dt.normalize()
    # Impide utilizar años o meses fuera del ámbito declarado del catálogo.
    serie = serie.loc[serie.day.between(inicio, fin)]
    fechas = set(catalogo.date)
    filas, auditoria = [], []
    for fecha, grupo in catalogo.groupby("date", sort=True):
        resultado, controles = calcular_indicadores(serie, fecha, fechas, festivos, ventana=ventana)
        resultado.update({"n_registros_documentados": len(grupo),
                          "ids_documentados": grupo.incident_id.tolist(),
                          "tipo_resultado": "contexto_agregado_no_efecto_ferroviario"})
        filas.append(resultado)
        for dia in controles.day:
            auditoria.append({"fecha_objetivo": fecha, "fecha_control": dia,
                              "etiqueta": "sin_incidencia_documentada"})
    return pd.DataFrame(filas), pd.DataFrame(auditoria, columns=[
        "fecha_objetivo", "fecha_control", "etiqueta"])


def ejecutar(config_path):
    root = Path(__file__).resolve().parents[2]
    config_path = Path(config_path).resolve()
    config = json.loads(config_path.read_text(encoding="utf-8"))
    excel, parquet = (root / config[k] for k in ["incidencias", "movilidad"])
    catalogo = normalizar_catalogo(pd.read_excel(excel, sheet_name=config["hoja"]))
    with duckdb.connect() as con:
        esquema = con.execute("DESCRIBE SELECT * FROM read_parquet(?)", [str(parquet)]).df()
        limites = con.execute("SELECT min(day), max(day), count(*) FROM read_parquet(?)",
                              [str(parquet)]).fetchone()
        cobertura = con.execute("""
            SELECT CAST(day AS DATE) AS day, COUNT(*) AS registros,
                   SUM(CASE WHEN viajes >= 0 THEN viajes ELSE NULL END) AS viajes_observados,
                   COUNT(*) FILTER (WHERE viajes IS NULL OR viajes < 0) AS registros_invalidos,
                   COUNT(DISTINCT (municipio_origen, municipio_destino)) AS n_od
            FROM read_parquet(?) WHERE day BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
              AND municipio_origen <> municipio_destino
            GROUP BY 1 ORDER BY 1
        """, [str(parquet), config["inicio_catalogo"], config["fin_catalogo"]]).df()
    # Un total incompleto se marca ausente en lugar de aparentar una caída de viajes.
    cobertura.loc[cobertura.registros_invalidos.gt(0), "viajes_observados"] = float("nan")
    resultados, controles = auditar_fechas(catalogo, cobertura, config["inicio_catalogo"],
                                          config["fin_catalogo"], config["ventana_dias"])
    resumen = {
        "version_esquema": 1, "alcance": "muestra_de_incidencias_documentadas",
        "configuracion": config,
        "sha256_catalogo": hashlib.sha256(excel.read_bytes()).hexdigest(),
        "sha256_motor": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "movilidad": {"inicio": str(limites[0]), "fin": str(limites[1]),
                      "registros": limites[2], "bytes": parquet.stat().st_size,
                      "mtime_ns": parquet.stat().st_mtime_ns,
                      "columnas": esquema.column_name.tolist()},
        "n_registros_documentados": len(catalogo), "n_fechas_documentadas": catalogo.date.nunique(),
        "inicio_observado_catalogo": str(catalogo.date.min().date()),
        "fin_observado_catalogo": str(catalogo.date.max().date()),
        "estados_fechas": resultados.estado.value_counts().to_dict(),
        "limitaciones": [
            "El catálogo no contiene todas las incidencias existentes.",
            "Los controles no tienen incidencia documentada; no garantizan normalidad.",
            "Los límites declarados indican ámbito de recopilación, no exhaustividad.",
            "Se excluyen fines de semana, julio, agosto y festivos autonómicos/nacionales.",
            "No se infieren duraciones ni se fusionan registros como episodios independientes.",
            "Solo se excluyen de controles las fechas registradas; las duraciones requieren revisión.",
            "El contexto agregado no mide exposición directa, recurrencia ni efecto dominó.",
            "La cobertura territorial de M2 debe validarse antes de denominarla provincial.",
        ],
    }
    salida = root / config["salida"]
    salida.mkdir(parents=True, exist_ok=True)
    for nombre, tabla in [("catalogo_normalizado", catalogo), ("cobertura_diaria", cobertura),
                          ("contexto_fechas_documentadas", resultados), ("controles", controles)]:
        tabla.to_parquet(salida / f"{nombre}.parquet", index=False)
    (salida / "auditoria.json").write_text(json.dumps(resumen, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"salida": str(salida), "registros_documentados": len(catalogo),
                      "fechas": len(resultados), "estados": resumen["estados_fechas"]}, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="src/analysis/general_config.json")
    ejecutar(parser.parse_args().config)
