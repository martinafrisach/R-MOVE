"""Correspondencias territoriales revisables. Una referencia actual no valida historia.

python -m src.analysis.rmove_territory --config src/analysis/general_config.json
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import unicodedata
import zipfile

import duckdb
import pandas as pd

from .rmove_general import normalizar_catalogo

FUENTE_ESTACIONES = "https://data.renfe.com/dataset/ed3d44e5-1d04-41d6-9aa5-396442bf3e07/resource/783e0626-6fa8-4ac7-a880-fa53144654ff/download/listado-estaciones-completo-act.csv"
FUENTE_GTFS = "https://data.renfe.com/dataset/horarios-cercanias"
MAPA_HISTORICO = "https://www.renfe.com/content/dam/renfe/es/Viajeros/Secciones/Cercanias/Mapas/2024/mapa_general_servicio_rodalies_de_catalunya_12_24.pdf"


def normalizar_nombre(valor):
    texto = str(valor).strip().lower().replace("’", "'")
    # Las fuentes colocan artículos tanto delante como detrás del topónimo.
    texto = re.sub(r"\((l'|el|la|els|les)\)$", r", \1", texto)
    if "," in texto:
        nombre, articulo = texto.rsplit(",", 1)
        if articulo.strip() in {"l'", "el", "la", "els", "les"}:
            texto = articulo.strip() + " " + nombre
    texto = "".join(c for c in unicodedata.normalize("NFKD", texto)
                    if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", texto).strip()


def coincidencias(texto, nombres):
    """Coincidencias completas; evita subcadenas y prioriza topónimos largos."""
    texto = normalizar_nombre(texto)
    halladas = []
    for nombre, valores in nombres.items():
        if len(nombre) < 3:
            continue
        for match in re.finditer(r"(?<!\w)" + re.escape(nombre) + r"(?!\w)", texto):
            halladas.append((match.start(), match.end(), nombre, valores))
    aceptadas = []
    for fila in sorted(halladas, key=lambda x: (-(x[1]-x[0]), x[0])):
        if not any(fila[0] >= a[0] and fila[1] <= a[1] for a in aceptadas):
            aceptadas.append(fila)
    return aceptadas


def leer_gtfs(ruta):
    with zipfile.ZipFile(ruta) as archivo:
        def leer(nombre):
            with archivo.open(nombre) as entrada:
                tabla = pd.read_csv(entrada, dtype=str)
            tabla.columns = tabla.columns.str.strip()
            return tabla.apply(lambda s: s.str.strip())
        rutas = leer("routes.txt")
        rutas = rutas.loc[rutas.route_id.str.startswith("51")].copy()
        rutas["linea"] = rutas.route_short_name.replace({"R2N": "R2 Nord", "R2S": "R2 Sud"})
        viajes = leer("trips.txt")
        viajes = viajes.merge(rutas[["route_id", "linea"]], on="route_id", validate="many_to_one")
        partes = []
        with archivo.open("stop_times.txt") as entrada:
            for bloque in pd.read_csv(entrada, dtype=str, usecols=["trip_id", "stop_id"], chunksize=200000):
                bloque = bloque.apply(lambda s: s.str.strip())
                bloque = bloque.merge(viajes[["trip_id", "linea"]], on="trip_id", validate="many_to_one")
                partes.append(bloque[["stop_id", "linea"]].drop_duplicates())
        pares = pd.concat(partes).drop_duplicates()
        estaciones = leer("stops.txt")
        estaciones = estaciones.merge(pares, on="stop_id", validate="one_to_many")
        calendario = leer("calendar.txt")
        calendario = calendario.loc[calendario.service_id.isin(viajes.service_id)]
    return estaciones, {"inicio_servicios": calendario.start_date.min(),
                         "fin_servicios": calendario.end_date.max()}


def correspondencias(estaciones, listado, municipios):
    """Sugiere municipio; la población de Renfe no garantiza el término físico."""
    indice = defaultdict(set)
    for fila in municipios.itertuples(index=False):
        indice[normalizar_nombre(fila.nombre)].add(fila.codigo)
    poblaciones = listado.set_index("CODIGO")["POBLACION"].to_dict()
    nombres = municipios.set_index("codigo").nombre.to_dict()
    filas = []
    for estacion in estaciones.itertuples(index=False):
        poblacion = poblaciones.get(estacion.stop_id, "")
        codigos = indice.get(normalizar_nombre(poblacion), set())
        criterio = "poblacion_listado_renfe"
        if not codigos:
            encontrados = coincidencias(estacion.stop_name, indice)
            codigos = set().union(*(f[3] for f in encontrados)) if encontrados else set()
            criterio = "toponimo_en_nombre_estacion"
        if not codigos:
            filas.append({"stop_id": estacion.stop_id, "estacion": estacion.stop_name,
                          "linea": estacion.linea, "codigo": None, "municipio": None,
                          "criterio": "sin_correspondencia_en_M2", "n_candidatos": 0})
        for codigo in sorted(codigos):
            filas.append({"stop_id": estacion.stop_id, "estacion": estacion.stop_name,
                          "linea": estacion.linea, "codigo": codigo, "municipio": nombres[codigo],
                          "criterio": criterio, "n_candidatos": len(codigos)})
    tabla = pd.DataFrame(filas)
    tabla["estado"] = "candidata_pendiente_validacion_geografica_e_historica"
    return tabla


def candidatos_incidencias(catalogo, red, municipios):
    """Distingue menciones locales y conexiones potenciales de la red actual."""
    indice = defaultdict(set)
    for fila in municipios.itertuples(index=False):
        indice[normalizar_nombre(fila.nombre)].add((fila.codigo, "municipio"))
    for fila in red.loc[red.codigo.notna()].itertuples(index=False):
        nombre = normalizar_nombre(fila.estacion)
        indice[nombre].add((fila.codigo, "estacion_referencia_actual"))
        # Renfe antepone Barcelona al nombre; las noticias suelen omitirlo.
        if nombre.startswith("barcelona "):
            indice[nombre.removeprefix("barcelona ")].add((fila.codigo, "estacion_referencia_actual"))
    filas, revision = [], []
    for incidencia in catalogo.itertuples(index=False):
        locales = coincidencias(incidencia.place, indice)
        lineas = set(incidencia.lineas_normalizadas)
        conocidas = set(red.linea)
        faltantes = sorted(lineas - conocidas)
        directa = red.loc[red.linea.isin(lineas) & red.codigo.notna()]
        ids_estaciones = set(red.loc[red.linea.isin(lineas), "stop_id"])
        otras_lineas = set(red.loc[red.stop_id.isin(ids_estaciones), "linea"]) - lineas
        indirecta = red.loc[red.linea.isin(otras_lineas) & red.codigo.notna()
                           & ~red.codigo.isin(directa.codigo)]
        for _, _, nombre, valores in locales:
            for codigo, tipo in sorted(valores):
                filas.append({"incident_id": incidencia.incident_id, "codigo": codigo,
                              "tipo_candidato": "localizacion_mencionada",
                              "evidencia": nombre, "criterio": tipo})
        for tipo, grupo in [("conexion_linea_actual", directa),
                            ("conexion_transbordo_actual", indirecta)]:
            for codigo, g in grupo.groupby("codigo"):
                filas.append({"incident_id": incidencia.incident_id, "codigo": codigo,
                              "tipo_candidato": tipo, "evidencia": "; ".join(sorted(set(g.linea))),
                              "criterio": "GTFS_actual_no_valida_exposicion_historica"})
        motivos = ["validar_ambito_del_tramo_y_duracion", "validar_red_historica"]
        if not locales:
            motivos.append("sin_toponimo_resuelto_en_M2")
        if faltantes:
            motivos.append("lineas_sin_referencia_actual")
        revision.append({"incident_id": incidencia.incident_id, "fecha": incidencia.date,
                         "lugar_documentado": incidencia.place, "lineas_documentadas": incidencia.line,
                         "fuente_documental": incidencia.URL,
                         "codigos_locales_candidatos": sorted({v[0] for f in locales for v in f[3]}),
                         "lineas_sin_referencia": faltantes, "motivos_revision": motivos,
                         "estado": "pendiente_revision", "exposicion_confirmada": False})
    columnas = ["incident_id", "codigo", "tipo_candidato", "evidencia", "criterio"]
    candidatos = pd.DataFrame(filas, columns=columnas).drop_duplicates()
    candidatos["exposicion_confirmada"] = False
    return candidatos, pd.DataFrame(revision)


def validar_revision(revisiones, catalogo, municipios):
    """Solo una revisión explícita con evidencia alimenta la exposición analítica."""
    categorias = {"directa", "indirecta", "baja", "desconocida"}
    claves = set()
    fechas = catalogo.set_index("incident_id").date.to_dict()
    codigos = set(municipios.codigo)
    for fila in revisiones:
        clave = (fila["incident_id"], fila["codigo"])
        if clave in claves or clave[0] not in fechas or clave[1] not in codigos:
            raise ValueError(f"Revisión duplicada o identidad desconocida: {clave}")
        claves.add(clave)
        if fila["categoria"] not in categorias:
            raise ValueError("Categoría territorial no válida")
        for campo in ["fuente", "criterio", "revisado_por", "fecha_revision"]:
            if not isinstance(fila.get(campo), str) or not fila[campo].strip():
                raise ValueError(f"Falta trazabilidad: {campo}")
        if pd.isna(pd.to_datetime(fila["fecha_revision"], errors="raise")):
            raise ValueError("Fecha de revisión ausente")
        inicio, fin = (pd.Timestamp(fila[c]) for c in ["valido_desde", "valido_hasta"])
        if pd.isna(inicio) or pd.isna(fin) or not inicio <= fechas[clave[0]] <= fin:
            raise ValueError("La evidencia territorial no cubre la fecha de la incidencia")
    return pd.DataFrame(revisiones)


def ejecutar(config_path):
    root = Path(__file__).resolve().parents[2]
    config = json.loads(Path(config_path).read_text(encoding="utf-8"))
    catalogo = normalizar_catalogo(pd.read_excel(root / config["incidencias"], sheet_name=config["hoja"]))
    if not catalogo.date.between(config["inicio_catalogo"], config["fin_catalogo"]).all():
        raise ValueError("El catálogo excede el periodo declarado")
    with duckdb.connect() as con:
        municipios = con.execute("""
            SELECT DISTINCT municipio_origen AS codigo, municipio_origen_name AS nombre
            FROM read_parquet(?) WHERE day BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
            UNION SELECT DISTINCT municipio_destino, municipio_destino_name
            FROM read_parquet(?) WHERE day BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
            ORDER BY codigo
        """, [str(root / config["movilidad"]), config["inicio_catalogo"], config["fin_catalogo"]] * 2).df()
    if municipios.codigo.isna().any() or municipios.codigo.duplicated().any():
        raise ValueError("Códigos municipales ausentes o con nombres incompatibles")
    gtfs = root / config["gtfs_referencia"]
    listado_path = root / config["estaciones_referencia"]
    listado = pd.read_csv(listado_path, sep=";", encoding="cp1252", dtype=str)
    estaciones, periodo = leer_gtfs(gtfs)
    red = correspondencias(estaciones, listado, municipios)
    candidatos, revision = candidatos_incidencias(catalogo, red, municipios)
    # Ausencia de una fila revisada significa exposición desconocida, nunca baja.
    revisiones = []
    if config.get("revision_territorial"):
        revisiones = json.loads((root / config["revision_territorial"]).read_text(encoding="utf-8"))
    confirmada = validar_revision(revisiones, catalogo, municipios)
    if confirmada.empty:
        confirmada = pd.DataFrame(columns=["incident_id", "codigo", "categoria", "fuente", "criterio",
                                          "revisado_por", "fecha_revision", "valido_desde", "valido_hasta"])
    resumen = {
        "generado_utc": datetime.now(timezone.utc).isoformat(),
        "n_registros_documentados": len(catalogo), "n_municipios_M2": len(municipios),
        "n_estaciones_referencia": estaciones.stop_id.nunique(),
        "lineas_referencia": sorted(set(red.linea)), "periodo_GTFS": periodo,
        "n_incidencias_con_localizacion_candidata": candidatos.loc[
            candidatos.tipo_candidato.eq("localizacion_mencionada"), "incident_id"].nunique(),
        "n_asignaciones_revisadas": len(confirmada),
        "configuracion": config,
        "sha256_motor": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "lineas_documentadas_sin_referencia": sorted({linea for lista in revision.lineas_sin_referencia for linea in lista}),
        "fuentes": [{"url": url, "ruta": str(path.relative_to(root)),
                     "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
                    for url, path in [(FUENTE_ESTACIONES, listado_path), (FUENTE_GTFS, gtfs)]],
        "sha256_catalogo": hashlib.sha256((root / config["incidencias"]).read_bytes()).hexdigest(),
        "mapa_historico_para_revision": MAPA_HISTORICO,
        "limitaciones": ["La red actual es una referencia candidata; no valida la red histórica.",
            "La población de una estación no garantiza su ubicación dentro del término municipal.",
            "Una mención local no identifica todos los municipios expuestos ni los intermedios de un tramo.",
            "No hay grupo de baja exposición ni asignaciones confirmadas por defecto.",
            "Una conexión por transbordo es una hipótesis territorial, no evidencia de efecto dominó.",
            "Las líneas ausentes del GTFS no se consideran inexistentes."]}
    if config.get("revision_territorial"):
        resumen["sha256_revision_territorial"] = hashlib.sha256(
            (root / config["revision_territorial"]).read_bytes()).hexdigest()
    salida = root / config["salida"]
    salida.mkdir(parents=True, exist_ok=True)
    for nombre, tabla in [("municipios_movilidad", municipios), ("red_referencia_actual", red),
                          ("candidatos_territoriales", candidatos), ("revision_territorial", revision),
                          ("exposicion_revisada", confirmada)]:
        tabla.to_parquet(salida / f"{nombre}.parquet", index=False)
    # CSV legible para revisar sin abrir Parquet. Listas serializadas como JSON.
    legible = revision.copy()
    for campo in ["codigos_locales_candidatos", "lineas_sin_referencia", "motivos_revision"]:
        legible[campo] = legible[campo].map(lambda v: json.dumps(v, ensure_ascii=False))
    legible.to_csv(salida / "revision_territorial.csv", index=False, encoding="utf-8-sig")
    (salida / "auditoria_territorial.json").write_text(json.dumps(resumen, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: resumen[k] for k in ["n_registros_documentados", "n_municipios_M2",
          "n_estaciones_referencia", "n_incidencias_con_localizacion_candidata", "n_asignaciones_revisadas"]}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="src/analysis/general_config.json")
    ejecutar(parser.parse_args().config)
