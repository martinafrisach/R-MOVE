"""Placebos locales y contraste exploratorio de la muestra documentada.

Las colas empíricas no son p-valores y las recurrencias no son tests municipales.
Los intervalos por bloques son exploratorios, condicionales a referencias y
asignaciones; no convierten asociaciones en efectos causales.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re

import duckdb
import holidays
import numpy as np
import pandas as pd

from .rmove_general import normalizar_catalogo
from .rmove_indicators import seleccionar_controles
from .rmove_municipal import comparar_municipios


def calendario_placebos(catalogo, inicio, fin, ventana):
    fechas_documentadas = set(catalogo.date)
    inicio, fin = pd.Timestamp(inicio), pd.Timestamp(fin)
    festivos = holidays.country_holidays("ES", subdiv="CT", years=range(inicio.year, fin.year + 1))
    calendario = pd.DataFrame({"day": pd.date_range(inicio, fin), "viajes_observados": 1.})
    elegibles = calendario.loc[calendario.day.dt.day_of_week.lt(5)
        & ~calendario.day.dt.month.isin([7, 8])
        & ~calendario.day.map(lambda d: d.date() in festivos)
        & ~calendario.day.isin(fechas_documentadas), "day"]
    controles = []
    for fecha in elegibles:
        referencias = seleccionar_controles(calendario, fecha, fechas_documentadas, festivos, ventana=ventana)
        controles.extend({"fecha": fecha, "fecha_control": dia} for dia in referencias.day)
    objetivos = pd.DataFrame({"fecha": elegibles.to_numpy(), "calendario_elegible": True,
                             "n_registros_documentados_fecha": 0})
    return objetivos, pd.DataFrame(controles, columns=["fecha", "fecha_control"])


def calibrar(con, eventos, placebos, ventana=42, minimo=5, max_cobertura=20, cuantil=.9):
    """Mismo municipio, sentido, día semanal y ventana; sin seleccionar por efecto."""
    if ventana < 1 or minimo < 3 or not 0 < cuantil < 1:
        raise ValueError("Ventana, mínimo o cuantil inválidos")
    if max_cobertura is not None and max_cobertura < 0:
        raise ValueError("La tolerancia de cobertura debe ser no negativa")
    columnas = ["fecha", "codigo", "sentido", "estado", "variacion_observada_pct", "variacion_n_od_pct"]
    con.register("eventos_contraste", eventos)
    con.register("placebos_contraste", placebos[columnas])
    tolerancia = float("inf") if max_cobertura is None else float(max_cobertura)
    referencias = con.execute("""
        SELECT e.fecha, e.codigo, e.sentido, COUNT(*) AS n_placebos,
               MEDIAN(ABS(p.variacion_observada_pct)) AS mediana_magnitud_placebo_pct,
               MEDIAN(p.variacion_observada_pct) AS mediana_variacion_placebo_pct,
               QUANTILE_DISC(ABS(p.variacion_observada_pct), ?) AS umbral_magnitud_placebo_pct,
               LIST(STRFTIME(CAST(p.fecha AS DATE), '%Y-%m-%d') ORDER BY p.fecha) AS fechas_placebo,
               (1.0 + COUNT(*) FILTER (WHERE ABS(p.variacion_observada_pct) >= ABS(e.variacion_observada_pct)))
                   / (COUNT(*) + 1.0) AS cola_empirica_descriptiva
        FROM eventos_contraste e JOIN placebos_contraste p
          ON p.codigo = e.codigo AND p.sentido = e.sentido
         AND p.fecha <> e.fecha AND ABS(DATE_DIFF('day', p.fecha, e.fecha)) <= ?
         AND DAYOFWEEK(p.fecha) = DAYOFWEEK(e.fecha)
        WHERE p.estado = 'ok' AND ABS(p.variacion_n_od_pct) <= ?
        GROUP BY e.fecha, e.codigo, e.sentido, e.variacion_observada_pct
    """, [cuantil, ventana, tolerancia]).df()
    tabla = eventos.merge(referencias, on=["fecha", "codigo", "sentido"], how="left", validate="one_to_one")
    tabla["n_placebos"] = tabla.n_placebos.fillna(0).astype(int)
    cobertura_ok = tabla.variacion_n_od_pct.abs().le(tolerancia)
    tabla["estado_contraste"] = np.select(
        [tabla.estado.ne("ok"), ~cobertura_ok, tabla.n_placebos.lt(minimo)],
        ["comparacion_original_no_valida", "cobertura_od_no_comparable", "placebos_insuficientes"], default="ok")
    valida = tabla.estado_contraste.eq("ok")
    tabla["exceso_magnitud_pp"] = (tabla.variacion_observada_pct.abs() - tabla.mediana_magnitud_placebo_pct).where(valida)
    tabla["cambio_centrado_pp"] = (tabla.variacion_observada_pct - tabla.mediana_variacion_placebo_pct).where(valida)
    tabla["supera_umbral_descriptivo"] = pd.Series(pd.NA, index=tabla.index, dtype="boolean")
    tabla.loc[valida, "supera_umbral_descriptivo"] = tabla.loc[valida, "variacion_observada_pct"].abs().gt(
        tabla.loc[valida, "umbral_magnitud_placebo_pct"])
    # Una cola sin suficientes placebos no debe interpretarse como evidencia.
    tabla["cola_empirica_descriptiva"] = tabla.cola_empirica_descriptiva.where(valida)
    return tabla


def resumen_por_fecha(tabla, minimo_municipios=3):
    validos = tabla.loc[tabla.estado_contraste.eq("ok") & tabla.exposicion.isin(["directa", "indirecta"])].copy()
    grupo = validos.groupby(["fecha", "sentido", "exposicion"], as_index=False).agg(
        n_municipios=("codigo", "nunique"), exceso_magnitud_pp=("exceso_magnitud_pp", "median"),
        cambio_centrado_pp=("cambio_centrado_pp", "median"),
        fraccion_supera_umbral=("supera_umbral_descriptivo", "mean"))
    grupo["grupo_elegible"] = grupo.n_municipios.ge(minimo_municipios)
    return grupo


def intervalo_bloques(fechas, valores, bloque_dias=84, replicas=2000, semilla=0):
    """Bootstrap de bloques calendarios no solapados, sobre una cifra por fecha.

    Mantiene juntas las fechas de un bloque. No vuelve a estimar las referencias
    de movilidad en cada réplica. Exige al menos ocho bloques con observaciones.
    """
    if bloque_dias < 1 or replicas < 100:
        raise ValueError("Longitud de bloque o número de réplicas insuficiente")
    dias = pd.to_datetime(pd.Series(fechas)).reset_index(drop=True)
    x = np.asarray(valores, dtype=float)
    if len(dias) != len(x) or dias.duplicated().any() or not np.isfinite(x).all():
        raise ValueError("Se requiere un valor finito por fecha distinta")
    if not len(x):
        return {"estimacion_pp": None, "ic95_inferior_pp": None, "ic95_superior_pp": None,
                "n_fechas": 0, "n_bloques": 0, "estado_intervalo": "sin_fechas"}
    bloques = ((dias - pd.Timestamp("2023-01-02")).dt.days // bloque_dias).to_numpy()
    ids = np.unique(bloques)
    resultado = {"estimacion_pp": float(x.mean()), "n_fechas": len(x), "n_bloques": len(ids),
                 "ic95_inferior_pp": None, "ic95_superior_pp": None,
                 "estado_intervalo": "bloques_insuficientes"}
    if len(ids) < 8:
        return resultado
    sumas = np.array([x[bloques == b].sum() for b in ids])
    tamanos = np.array([(bloques == b).sum() for b in ids])
    indices = np.random.default_rng(semilla).integers(0, len(ids), size=(replicas, len(ids)))
    muestras = sumas[indices].sum(axis=1) / tamanos[indices].sum(axis=1)
    inferior, superior = np.quantile(muestras, [.025, .975])
    resultado.update(ic95_inferior_pp=float(inferior), ic95_superior_pp=float(superior), estado_intervalo="exploratorio")
    return resultado


def contrastes_grupos(grupos, bloque_dias, replicas, semilla):
    filas = []
    validos = grupos.loc[grupos.grupo_elegible]
    for (sentido, exposicion), grupo in validos.groupby(["sentido", "exposicion"], sort=True):
        for metrica in ["exceso_magnitud_pp", "cambio_centrado_pp"]:
            resultado = intervalo_bloques(grupo.fecha, grupo[metrica], bloque_dias, replicas, semilla)
            filas.append({"sentido": sentido, "comparacion": exposicion + "_vs_placebo_propio", "metrica": metrica, **resultado})
    for sentido, grupo in validos.groupby("sentido", sort=True):
        for metrica in ["exceso_magnitud_pp", "cambio_centrado_pp"]:
            pivot = grupo.pivot(index="fecha", columns="exposicion", values=metrica)
            if not {"directa", "indirecta"} <= set(pivot):
                continue
            pivot = pivot.dropna(subset=["directa", "indirecta"])
            resultado = intervalo_bloques(pivot.index, pivot.directa - pivot.indirecta, bloque_dias, replicas, semilla)
            filas.append({"sentido": sentido, "comparacion": "directa_menos_indirecta_mismas_fechas",
                          "metrica": metrica, **resultado})
    return pd.DataFrame(filas, columns=["sentido", "comparacion", "metrica", "estimacion_pp",
        "n_fechas", "n_bloques", "ic95_inferior_pp", "ic95_superior_pp", "estado_intervalo"])


def recurrencia(tabla, minimo_fechas=10):
    columnas = ["codigo", "sentido", "exposicion", "n_fechas", "n_meses", "fraccion_supera_umbral",
                "mediana_exceso_magnitud_pp", "fraccion_descensos", "muestra_suficiente_descriptiva"]
    validos = tabla.loc[tabla.estado_contraste.eq("ok") & tabla.exposicion.isin(["directa", "indirecta"])].copy()
    if validos.empty:
        return pd.DataFrame(columns=columnas)
    validos["mes"] = validos.fecha.dt.to_period("M").astype(str)
    validos["descenso"] = validos.cambio_centrado_pp.lt(0)
    r = validos.groupby(["codigo", "sentido", "exposicion"], as_index=False).agg(
        n_fechas=("fecha", "nunique"), n_meses=("mes", "nunique"),
        fraccion_supera_umbral=("supera_umbral_descriptivo", "mean"),
        mediana_exceso_magnitud_pp=("exceso_magnitud_pp", "median"), fraccion_descensos=("descenso", "mean"))
    r["muestra_suficiente_descriptiva"] = r.n_fechas.ge(minimo_fechas) & r.n_meses.ge(3)
    return r[columnas]


def resumen_lineas(tabla, catalogo, revision):
    """Agrupa por línea documentada; una línea no equivale a un corredor validado."""
    if revision.empty:
        return pd.DataFrame(columns=["linea_documentada", "fecha", "sentido", "n_municipios",
                                     "mediana_exceso_magnitud_pp", "fraccion_supera_umbral"])
    lineas = catalogo[["incident_id", "date", "lineas_normalizadas"]].explode("lineas_normalizadas")
    lineas = lineas.loc[lineas.lineas_normalizadas.map(lambda v: isinstance(v, str) and bool(
        re.fullmatch(r"R\d+|R2 Nord|R2 Sud|RG1|RT[12]|RL[34]", v)))]
    relacion = revision.loc[revision.categoria.eq("directa"), ["incident_id", "codigo"]].merge(
        lineas, on="incident_id", validate="many_to_many")
    relacion = relacion[["date", "codigo", "lineas_normalizadas"]].drop_duplicates().rename(
        columns={"date": "fecha", "lineas_normalizadas": "linea_documentada"})
    validos = tabla.loc[tabla.estado_contraste.eq("ok")]
    unido = relacion.merge(validos, on=["fecha", "codigo"], validate="many_to_many")
    por_fecha = unido.groupby(["linea_documentada", "fecha", "sentido"], as_index=False).agg(
        n_municipios=("codigo", "nunique"), mediana_exceso_magnitud_pp=("exceso_magnitud_pp", "median"),
        fraccion_supera_umbral=("supera_umbral_descriptivo", "mean"))
    return por_fecha


def huella(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def generar_informe(salida):
    """Informe legible derivado de las salidas, sin cifras fijadas en el código."""
    salida = Path(salida)
    audit = json.loads((salida / "auditoria_contraste.json").read_text(encoding="utf-8"))
    general = pd.read_csv(salida / "contraste_general.csv")
    sensibilidad = pd.read_csv(salida / "sensibilidad_contraste.csv")
    recurrentes = pd.read_csv(salida / "recurrencia_municipal_descriptiva.csv", dtype={"codigo": str})
    municipios = pd.read_parquet(salida / "municipios_movilidad.parquet")
    recurrentes = recurrentes.merge(municipios, on="codigo", validate="many_to_one")
    def numero(v):
        return "No disponible" if pd.isna(v) else f"{v:.3f}"
    texto = ["# Contraste exploratorio de incidencias documentadas", "",
             "## Cobertura y definición", "",
             f"Fechas placebo candidatas: {audit['n_fechas_placebo']}. "
             f"Comparaciones municipio-fecha-sentido calibradas: {audit['estados_contraste'].get('ok', 0)}.", "",
             "Estados del contraste: " + json.dumps(audit["estados_contraste"], ensure_ascii=False) + ".", "",
             "Los placebos son fechas sin incidencia documentada del mismo municipio, sentido y día semanal, "
             "dentro de la ventana local. Cada fecha placebo tiene su propia mediana de referencia, excluyéndose "
             "a sí misma y todas las fechas documentadas. Las fechas sin registro no garantizan normalidad.", "",
             "El exceso de magnitud es |variación durante la incidencia| menos la mediana de |variaciones placebo|, "
             "en puntos porcentuales. El cambio centrado conserva la dirección y resta la mediana placebo. "
             "Se resume con la mediana municipal de cada grupo-fecha y la media de esas fechas; "
             "cada fecha pesa lo mismo. Las diferencias entre grupos usan solo fechas comunes.", "",
             "## Resultados principales", "",
             "| Sentido | Comparación | Métrica | Estimación (pp) | IC exploratorio 95 % (pp) | Fechas | Bloques |",
             "|---|---|---|---:|---|---:|---:|"]
    for fila in general.itertuples(index=False):
        texto.append(f"| {fila.sentido} | {fila.comparacion} | {fila.metrica} | {numero(fila.estimacion_pp)} | "
                     f"[{numero(fila.ic95_inferior_pp)}, {numero(fila.ic95_superior_pp)}] | {fila.n_fechas} | {fila.n_bloques} |")
    texto.extend(["", "## Robustez", "",
                  "Cada fila resume escenarios de sensibilidad, no réplicas independientes. "
                  "Cambiar la ventana local no cambia la ventana de las referencias diarias.", "",
                  "| Sentido | Comparación de magnitud | Rango de estimaciones (pp) | Escenarios con IC por encima de cero |",
                  "|---|---|---|---:|"])
    magnitud = sensibilidad.loc[sensibilidad.metrica.eq("exceso_magnitud_pp")]
    for (sentido, comparacion), grupo in magnitud.groupby(["sentido", "comparacion"], sort=True):
        n = int(grupo.ic95_inferior_pp.gt(0).sum())
        texto.append(f"| {sentido} | {comparacion} | [{numero(grupo.estimacion_pp.min())}, "
                     f"{numero(grupo.estimacion_pp.max())}] | {n}/{len(grupo)} |")
    texto.extend(["", "## Municipios para examinar", "",
                  "Lista exploratoria de exposición directa con al menos el mínimo de fechas configurado "
                  "y tres meses distintos. Ordenada por fracción que supera el umbral local descriptivo. "
                  "No es un ranking de efectos causales ni de significación. Las fechas no equivalen a episodios independientes.", "",
                  "| Municipio | Sentido | Fechas | Meses | Fracción sobre umbral | Mediana exceso (pp) |",
                  "|---|---|---:|---:|---:|---:|"])
    candidatos = recurrentes.loc[recurrentes.exposicion.eq("directa") & recurrentes.muestra_suficiente_descriptiva]
    for fila in candidatos.sort_values(["fraccion_supera_umbral", "n_fechas"], ascending=False).head(10).itertuples(index=False):
        texto.append(f"| {fila.nombre} | {fila.sentido} | {fila.n_fechas} | {fila.n_meses} | "
                     f"{fila.fraccion_supera_umbral:.3f} | {fila.mediana_exceso_magnitud_pp:.3f} |")
    texto.extend(["", "## Interpretación y límites", "",
                  "Una mayor magnitud puede combinar subidas y bajadas: no implica una reducción uniforme de movilidad. "
                  "Una diferencia directa-indirecta cuyo intervalo incluye cero no permite afirmar que un grupo cambie más. "
                  "Incluso un intervalo positivo sigue siendo una asociación exploratoria, condicionada a la muestra y al método.", "",
                  "Una señal en exposición indirecta no demuestra efecto dominó: puede compartir shocks de calendario, "
                  "meteorología u otras incidencias. Falta un grupo validado de baja exposición y reconstruir episodios y duraciones.", "",
                  "Los intervalos son aproximados y no simultáneos, sin corrección de comparaciones múltiples. "
                  "No se realizan tests municipales; las colas empíricas no son p-valores. "
                  "La longitud del bloque, el número de bloques y las referencias compartidas limitan la interpretación.", "",
                  "Los resultados por línea están en contraste_lineas_por_fecha.parquet. "
                  "Las líneas no se presentan como corredores territoriales validados.", "",
                  "Referencia metodológica general del remuestreo temporal: "
                  "[revisión de bootstrap para series temporales](https://users.ssc.wisc.edu/~behansen/718/HardleHorowitzKreiss.pdf). "
                  "La implementación usa bloques calendarios no solapados y NumPy, sin nuevas dependencias.", ""])
    (salida / "informe_contraste.md").write_text("\n".join(texto), encoding="utf-8")


def ejecutar(config_path):
    root = Path(__file__).resolve().parents[2]
    config = json.loads(Path(config_path).read_text(encoding="utf-8"))
    opciones = config["contraste"]
    salida = root / config["salida"]
    auditoria_previa = json.loads((salida / "auditoria_municipal.json").read_text(encoding="utf-8"))
    if huella(root / config["incidencias"]) != auditoria_previa["sha256_catalogo"]:
        raise ValueError("El catálogo ha cambiado: regenerar el cálculo municipal")
    if huella(root / config["revision_territorial"]) != auditoria_previa["sha256_revision"]:
        raise ValueError("La revisión ha cambiado: regenerar el cálculo municipal")
    for clave in ["incidencias", "movilidad", "inicio_catalogo", "fin_catalogo", "ventana_dias"]:
        if config[clave] != auditoria_previa["configuracion"][clave]:
            raise ValueError(f"Configuración municipal desactualizada: {clave}")
    catalogo = normalizar_catalogo(pd.read_excel(root / config["incidencias"], sheet_name=config["hoja"]))
    eventos = pd.read_parquet(salida / "cambios_municipales.parquet")
    if eventos.duplicated(["fecha", "codigo", "sentido"]).any():
        raise ValueError("Hay resultados municipales duplicados")
    objetivos, controles = calendario_placebos(catalogo, config["inicio_catalogo"], config["fin_catalogo"], config["ventana_dias"])
    print(json.dumps({"fase": "calculo_placebos", "n_fechas_candidatas": len(objetivos)}), flush=True)
    with duckdb.connect() as con:
        con.execute("CREATE TEMP TABLE movilidad_municipal AS SELECT * FROM read_parquet(?)",
                    [str(salida / "movilidad_municipal_diaria.parquet")])
        placebos = comparar_municipios(con, objetivos, controles)
        placebos.to_parquet(salida / "placebos_municipales.parquet", index=False)
        tabla = calibrar(con, eventos, placebos, opciones["ventana_placebos_dias"], opciones["minimo_placebos"],
                         opciones["max_variacion_cobertura_od_pct"], opciones["cuantil_descriptivo"])
        tabla.to_parquet(salida / "contraste_municipal.parquet", index=False)
        grupos = resumen_por_fecha(tabla, opciones["minimo_municipios_grupo_fecha"])
        grupos.to_parquet(salida / "contraste_grupos_por_fecha.parquet", index=False)
        contraste = contrastes_grupos(grupos, opciones["bloque_dias"], opciones["replicas_bootstrap"], opciones["semilla"])
        contraste.to_csv(salida / "contraste_general.csv", index=False, encoding="utf-8-sig")
        recurrencia(tabla, opciones["minimo_fechas_recurrencia"]).to_csv(
            salida / "recurrencia_municipal_descriptiva.csv", index=False, encoding="utf-8-sig")
        revision = pd.DataFrame(json.loads((root / config["revision_territorial"]).read_text(encoding="utf-8")))
        lineas = resumen_lineas(tabla, catalogo, revision)
        lineas.to_parquet(salida / "contraste_lineas_por_fecha.parquet", index=False)
        sensibilidades = []
        escenarios = [("principal", opciones["minimo_placebos"], opciones["max_variacion_cobertura_od_pct"], opciones["ventana_placebos_dias"], opciones["bloque_dias"]),
                      ("minimo_3_placebos", 3, 20, 42, 84), ("minimo_8_placebos", 8, 20, 42, 84),
                      ("cobertura_10_pct", 5, 10, 42, 84), ("sin_filtro_cobertura", 5, None, 42, 84),
                      ("ventana_local_28", 5, 20, 28, 84), ("ventana_local_56", 5, 20, 56, 84),
                      ("bloques_28_dias", 5, 20, 42, 28), ("bloques_56_dias", 5, 20, 42, 56)]
        for nombre, minimo, cobertura, ventana, bloque in escenarios:
            print(json.dumps({"fase": "sensibilidad", "escenario": nombre}), flush=True)
            t = tabla if nombre == "principal" else calibrar(con, eventos, placebos, ventana, minimo, cobertura, opciones["cuantil_descriptivo"])
            g = resumen_por_fecha(t, opciones["minimo_municipios_grupo_fecha"])
            s = contrastes_grupos(g, bloque, opciones["replicas_bootstrap"], opciones["semilla"])
            s["escenario"] = nombre
            s["minimo_placebos"] = minimo
            s["max_variacion_cobertura_od_pct"] = cobertura
            s["ventana_placebos_dias"] = ventana
            s["bloque_dias"] = bloque
            s["n_comparaciones_validas"] = int(t.estado_contraste.eq("ok").sum())
            sensibilidades.append(s)
    pd.concat(sensibilidades, ignore_index=True).to_csv(salida / "sensibilidad_contraste.csv", index=False, encoding="utf-8-sig")
    entradas = ["cambios_municipales.parquet", "movilidad_municipal_diaria.parquet", "auditoria_municipal.json"]
    auditoria = {"version_esquema": 1, "generado_utc": datetime.now(timezone.utc).isoformat(),
                "configuracion": config, "sha256_motor": huella(__file__),
                "huellas_entradas": {nombre: huella(salida / nombre) for nombre in entradas},
                "n_fechas_placebo": len(objetivos), "n_comparaciones_placebo": len(placebos),
                "estados_contraste": tabla.estado_contraste.value_counts().to_dict(),
                "versiones": {"numpy": np.__version__, "pandas": pd.__version__, "duckdb": duckdb.__version__},
                "limitaciones": [
                    "Muestra de incidencias documentadas; los placebos no garantizan ausencia de incidencias.",
                    "Solo se excluyen fechas registradas: duraciones y episodios no están reconstruidos.",
                    "La cola empírica y el umbral son descriptivos, no p-valores ni tests corregidos por multiplicidad.",
                    "La recurrencia cuenta fechas y meses, no episodios independientes; no es un ranking de significación.",
                    "Los IC son exploratorios por bloques calendarios no solapados; requieren estabilidad aproximada entre bloques.",
                    "Los IC condicionan a medianas, placebos y asignaciones ya calculados; no propagan toda su incertidumbre.",
                    "La comparación directa-indirecta usa las mismas fechas y calibración municipal, pero no ajusta todos los factores de confusión.",
                    "No hay grupo de baja exposición; los municipios desconocidos no actúan como controles.",
                    "El número de OD no garantiza composición idéntica; se conserva sensibilidad de cobertura.",
                    "Las ventanas locales de sensibilidad mantienen la referencia diaria de ±42 días.",
                    "Las líneas no son corredores validados; una fecha puede contribuir a varias líneas."]}
    (salida / "auditoria_contraste.json").write_text(json.dumps(auditoria, ensure_ascii=False, indent=2), encoding="utf-8")
    generar_informe(salida)
    print(json.dumps({"fase": "completado", "estados": auditoria["estados_contraste"]}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="src/analysis/general_config.json")
    ejecutar(parser.parse_args().config)
