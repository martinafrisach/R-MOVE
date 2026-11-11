"""Validación de casos, influencia de fechas y exportación del análisis general."""
from __future__ import annotations

import argparse
import ast
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

import duckdb
import holidays
import numpy as np
import pandas as pd

from .rmove_general import cargar_catalogo
from .rmove_cases import ficha_incidencia
from .rmove_indicators import cargar_relaciones, calcular_indicadores
from .rmove_contrast import contrastes_grupos


def casos_notebook(ruta):
    notebook = json.loads(Path(ruta).read_text(encoding="utf-8"))
    encontrados = []
    for celda in notebook["cells"]:
        if celda["cell_type"] != "code":
            continue
        for nodo in ast.walk(ast.parse("".join(celda["source"]))):
            if isinstance(nodo, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "CASOS" for t in nodo.targets):
                encontrados.append(ast.literal_eval(nodo.value))
    if len(encontrados) != 1:
        raise ValueError("Se requiere una única configuración CASOS literal en el notebook 04")
    casos = encontrados[0]
    if len({str(c["id"]) for c in casos}) != len(casos):
        raise ValueError("Hay casos duplicados en el notebook")
    return casos


def verificar_casos(root, config, casos):
    root = Path(root)
    catalogo = cargar_catalogo(root / config["incidencias"], config["hoja"])
    fichas = {str(c["id"]): ficha_incidencia(catalogo, c["id"]) for c in casos}
    fechas_documentadas = set(catalogo.date)
    festivos = holidays.country_holidays("ES", subdiv="CT", years=sorted(set(catalogo.date.dt.year)))
    pares = {}
    cargados = []
    for caso in casos:
        ficha = fichas[str(caso["id"])]
        ruta = f"data/processed/rmove/incidencia_{ficha['fecha'].replace('-', '_')}.json"
        contenido = (root / ruta).read_bytes()
        dato = json.loads(contenido)
        if dato.get("incidencia_documentada") != ficha or dato.get("fecha_incidencia") != ficha["fecha"]:
            raise ValueError(f"Ficha o fecha desactualizada: {ruta}")
        if dato.get("version_esquema") != 3 or dato.get("ambito") != caso["ambito"]:
            raise ValueError(f"Esquema o ámbito desactualizado: {ruta}")
        esperado = {m["codigo"]: m for m in caso["municipios"]}
        actual = {m["codigo"]: m for m in dato["municipios"]}
        if set(esperado) != set(actual) or len(actual) != len(dato["municipios"]):
            raise ValueError(f"Municipios incompatibles: {ruta}")
        for codigo, municipio in esperado.items():
            if any(actual[codigo][k] != municipio[k] for k in ["nombre", "lat", "lon"]):
                raise ValueError(f"Municipio o coordenadas desactualizadas: {ruta}, {codigo}")
        tabla = pd.DataFrame(dato["relaciones"])
        if tabla.empty or tabla.duplicated(["municipio_origen", "municipio_destino"]).any():
            raise ValueError(f"Relaciones vacías o duplicadas: {ruta}")
        for r in dato["relaciones"]:
            if r["municipio_origen"] not in actual or r["municipio_destino"] not in actual:
                raise ValueError("La relación contiene municipios fuera del caso")
            if r["estado"] != "ok":
                raise ValueError("La exportación contiene una relación sin comparación válida")
            clave = (r["municipio_origen"], r["municipio_destino"])
            pares["|".join(clave)] = clave
        exclusiones = set(pd.to_datetime(dato["metodologia"]["controles"]["fechas_incidencias_excluidas"]))
        if exclusiones != fechas_documentadas:
            raise ValueError(f"El catálogo de exclusiones no coincide con el Excel vigente: {ruta}")
        cargados.append((caso, ficha, ruta, contenido, dato))
    print(json.dumps({"fase": "verificar_M2", "n_od_distintas": len(pares)}), flush=True)
    with duckdb.connect() as con:
        movilidad = cargar_relaciones(con, root / config["movilidad"], pares)
    grupos = dict(tuple(movilidad.groupby("Relacion")))
    registros = []
    for caso, ficha, ruta, contenido, dato in cargados:
        controles_csv = pd.read_csv(root / "data/processed/rmove" / dato["archivos"]["controles"], parse_dates=["day"])
        for r in dato["relaciones"]:
            grupo = grupos["|".join([r["municipio_origen"], r["municipio_destino"]])]
            esperado, controles = calcular_indicadores(grupo, ficha["fecha"], fechas_documentadas, festivos)
            for campo in ["viajes_observados", "mediana_viajes_controles", "variacion_observada_pct", "diferencia_viajes"]:
                if not np.isclose(r[campo], esperado[campo], rtol=1e-10, atol=1e-8):
                    raise ValueError(f"Resultado no reproducible: {ruta}, {r['relacion']}, {campo}")
            if r["n_controles"] != esperado["n_controles"] or r["fechas_controles"] != esperado["fechas_controles"]:
                raise ValueError("Controles exportados incompatibles con los calculados")
            csv = controles_csv.loc[controles_csv.Relacion.eq(r["relacion"])].sort_values("day")
            if csv.day.dt.strftime("%Y-%m-%d").tolist() != esperado["fechas_controles"]:
                raise ValueError("Las fechas del CSV de controles no coinciden")
            if not np.allclose(csv.viajes_observados, controles.viajes_observados):
                raise ValueError("Los valores del CSV de controles no coinciden con M2")
        registros.append({"id": str(caso["id"]), "fecha": ficha["fecha"], "ambito": caso["ambito"],
                          "ruta": ruta, "sha256": hashlib.sha256(contenido).hexdigest(),
                          "n_municipios": len(caso["municipios"]), "n_relaciones": len(dato["relaciones"]),
                          "estado": "verificado_con_Excel_y_M2"})
    return registros


def analizar_influencia(grupos, opciones):
    validos = grupos.loc[grupos.grupo_elegible].copy()
    filas = []
    # Cada registro ya representa un grupo-fecha, no un municipio independiente.
    for (sentido, exposicion), g in validos.groupby(["sentido", "exposicion"]):
        for metrica in ["exceso_magnitud_pp", "cambio_centrado_pp"]:
            n, total = len(g), g[metrica].sum()
            for r in g.itertuples(index=False):
                sin_fecha = (total - getattr(r, metrica)) / (n - 1) if n > 1 else np.nan
                filas.append({"fecha": r.fecha, "sentido": sentido, "exposicion": exposicion,
                              "metrica": metrica, "estimacion_completa_pp": total / n,
                              "estimacion_sin_fecha_pp": sin_fecha,
                              "influencia_pp": total / n - sin_fecha})
    influencia = pd.DataFrame(filas)
    ranking = validos.assign(puntuacion=validos.exceso_magnitud_pp.abs()).groupby("fecha", as_index=False).puntuacion.max()
    ranking = ranking.sort_values(["puntuacion", "fecha"], ascending=[False, True]).reset_index(drop=True)
    escenarios = [("completo", set())]
    escenarios.extend((f"sin_top_{n}_fechas", set(ranking.head(n).fecha)) for n in [1, 3, 5])
    escenarios.extend((f"sin_anio_{anio}", set(validos.loc[validos.fecha.dt.year.eq(anio), "fecha"]))
                      for anio in sorted(set(validos.fecha.dt.year)))
    resultados = []
    for nombre, excluidas in escenarios:
        r = contrastes_grupos(grupos.loc[~grupos.fecha.isin(excluidas)], opciones["bloque_dias"],
                              opciones["replicas_bootstrap"], opciones["semilla"])
        r["escenario"] = nombre
        r["fechas_excluidas"] = json.dumps(sorted(f.strftime("%Y-%m-%d") for f in excluidas))
        resultados.append(r)
    return influencia, ranking, pd.concat(resultados, ignore_index=True)


def registros(tabla):
    return json.loads(tabla.to_json(orient="records", date_format="iso", force_ascii=False))


def redactar_conclusiones(principal, robustez):
    magnitud = principal.loc[principal.metrica.eq("exceso_magnitud_pp") & principal.comparacion.str.contains("vs_placebo")]
    recorte = robustez.loc[robustez.escenario.eq("sin_top_5_fechas") & robustez.metrica.eq("exceso_magnitud_pp")
                          & robustez.comparacion.str.contains("vs_placebo")]
    estable = len(recorte) == 4 and recorte.ic95_inferior_pp.gt(0).all()
    positiva = len(magnitud) == 4 and magnitud.estimacion_pp.gt(0).all()
    q1 = ("El análisis principal muestra cambios de mayor magnitud frente a las fechas placebo propias. "
          + ("La señal se mantiene al retirar las cinco fechas más extremas." if estable else
             "Al retirar las cinco fechas más extremas, la evidencia pierde consistencia entre grupos o sentidos.")) if positiva else (
          "El contraste no muestra un exceso de magnitud uniforme entre grupos y sentidos.")
    diferencias = principal.loc[principal.metrica.eq("exceso_magnitud_pp")
                               & principal.comparacion.eq("directa_menos_indirecta_mismas_fechas")]
    sin_diferencia = len(diferencias) == 2 and (diferencias.ic95_inferior_pp.le(0) & diferencias.ic95_superior_pp.ge(0)).all()
    return [
        {"id": "asociacion", "pregunta": "¿Las incidencias documentadas se asocian con cambios de movilidad?",
         "titulo": ("Asociación exploratoria" if estable else "Asociación sensible a fechas extremas") if positiva else "Sin patrón uniforme",
         "texto": q1 + " No aparece una caída uniforme de viajes ni se demuestra causalidad.",
         "estado": "exploratoria" if estable else "sensible"},
        {"id": "directa", "pregunta": "¿Cambian más los municipios directamente conectados?",
         "titulo": "Sin diferencia clara entre grupos" if sin_diferencia else "Diferencia para revisar por sentido",
         "texto": ("En el contraste principal de magnitud, los intervalos de la diferencia directa menos indirecta incluyen cero. "
                   "No permite afirmar que los cambios sean sistemáticamente mayores en exposición directa." if sin_diferencia else
                   "Consultar las estimaciones y sus intervalos por sentido y los escenarios de sensibilidad antes de generalizar una diferencia entre grupos."),
         "estado": "no_concluyente"},
        {"id": "recurrencia", "pregunta": "¿Hay municipios o corredores con patrones recurrentes?",
         "titulo": "Candidatos para profundizar",
         "texto": "Hay municipios con desviaciones repetidas frente a sus placebos. Se informa el número de fechas y meses; "
                  "no son episodios independientes ni municipios estadísticamente significativos. Las líneas todavía no equivalen a corredores validados.",
         "estado": "descriptiva"},
        {"id": "domino", "pregunta": "¿Se observa un posible efecto dominó?", "titulo": "Efecto dominó sin confirmar",
         "texto": "La exposición indirecta también muestra desviaciones en el análisis principal, pero puede compartir otros factores con la directa. "
                  "Faltan un grupo de baja exposición y una reconstrucción de episodios y duraciones para distinguir propagación de cambios generales.",
         "estado": "pendiente"}]


def ejecutar(config_path):
    root = Path(__file__).resolve().parents[2]
    config = json.loads(Path(config_path).read_text(encoding="utf-8"))
    salida = root / config["salida"]
    huella_excel = hashlib.sha256((root / config["incidencias"]).read_bytes()).hexdigest()
    audit = json.loads((salida / "auditoria_municipal.json").read_text(encoding="utf-8"))
    if audit["sha256_catalogo"] != huella_excel:
        raise ValueError("El motor general debe regenerarse con el Excel vigente")
    contraste_audit = json.loads((salida / "auditoria_contraste.json").read_text(encoding="utf-8"))
    for ruta, huella in contraste_audit["huellas_entradas"].items():
        if hashlib.sha256((salida / ruta).read_bytes()).hexdigest() != huella:
            raise ValueError("El contraste general tiene entradas desactualizadas")
    casos = verificar_casos(root, config, casos_notebook(root / "notebooks/04_comparacion_movilidad_incidencias.ipynb"))
    grupos = pd.read_parquet(salida / "contraste_grupos_por_fecha.parquet")
    influencia, ranking, robustez = analizar_influencia(grupos, config["contraste"])
    influencia.to_csv(salida / "influencia_fechas.csv", index=False, encoding="utf-8-sig")
    ranking.to_csv(salida / "fechas_extremas.csv", index=False, encoding="utf-8-sig")
    robustez.to_csv(salida / "robustez_fechas_extremas.csv", index=False, encoding="utf-8-sig")
    principal = robustez.loc[robustez.escenario.eq("completo")]
    conclusiones = redactar_conclusiones(principal, robustez)
    municipios = pd.read_parquet(salida / "municipios_movilidad.parquet")
    recurrentes = pd.read_csv(salida / "recurrencia_municipal_descriptiva.csv", dtype={"codigo": str}).merge(municipios, on="codigo")
    recurrentes = recurrentes.loc[recurrentes.muestra_suficiente_descriptiva].sort_values(
        ["fraccion_supera_umbral", "n_fechas", "codigo"], ascending=[False, False, True])
    general_audit = json.loads((salida / "auditoria.json").read_text(encoding="utf-8"))
    bundle = {"version_esquema": 1, "generado_utc": datetime.now(timezone.utc).isoformat(),
              "sha256_catalogo": huella_excel,
              "cobertura": {"inicio": config["inicio_catalogo"], "fin": config["fin_catalogo"],
                  "registros_documentados": general_audit["n_registros_documentados"],
                  "fechas_documentadas": general_audit["n_fechas_documentadas"],
                  "fechas_placebo": contraste_audit["n_fechas_placebo"],
                  "comparaciones_calibradas": contraste_audit["estados_contraste"]["ok"],
                  "municipios": len(municipios)},
              "casos": casos, "conclusiones": conclusiones, "contrastes": registros(principal),
              "robustez": registros(robustez.loc[~robustez.escenario.str.startswith("sin_anio_")]),
              "fechas_extremas": registros(ranking.head(10)),
              "recurrencia": registros(recurrentes),
              "sensibilidad": registros(pd.read_csv(salida / "sensibilidad_contraste.csv")),
              "metodo": {"referencia": "Mediana del mismo día semanal ±42 días, mínimo tres controles.",
                  "placebos": "Fechas sin incidencia documentada del mismo municipio y sentido, mínimo cinco en la ventana local.",
                  "agregacion": "Mediana municipal por grupo y fecha; media entre fechas. Diferencias entre grupos en fechas comunes.",
                  "intervalos": "IC exploratorios por bloques calendarios de 84 días, 2.000 réplicas. No son simultáneos ni causales.",
                  "extremos": "Se retiran conjuntamente las 1, 3 y 5 fechas con mayor magnitud de cualquier grupo y sentido. Es sensibilidad, no un ajuste causal."},
              "limitaciones": ["Catálogo documentado, no censo completo de incidencias.",
                  "Movilidad de todos los modos, no viajeros ferroviarios identificados.",
                  "No hay grupo validado de baja exposición; desconocida no significa no afectada.",
                  "Duraciones y episodios todavía pendientes: fechas distintas no garantizan independencia.",
                  "Asignaciones territoriales regeneradas con las reglas aceptadas por el usuario.",
                  "Recurrencia y umbrales locales son descriptivos, sin tests municipales ni p-valores.",
                  "El recorte de fechas se selecciona por los resultados y solo se interpreta como sensibilidad."]}
    (salida / "dashboard_general.json").write_text(json.dumps(bundle, ensure_ascii=False, allow_nan=False, indent=2), encoding="utf-8", newline="\n")
    (salida / "validacion_casos.json").write_text(json.dumps({"sha256_catalogo": huella_excel, "casos": casos}, ensure_ascii=False, indent=2), encoding="utf-8")
    texto = ["# Conclusiones generales y revisión de casos", "", f"Excel vigente: `{huella_excel}`.", "",
             f"{len(casos)} casos verificados contra el Excel y M2; todos los cálculos se reproducen con sus controles exportados.", ""]
    for conclusion in conclusiones:
        texto.extend(["## " + conclusion["pregunta"], "", conclusion["texto"], ""])
    texto.extend(["## Influencia de fechas", "", "| Fecha | Máxima magnitud de grupo (pp) |", "|---|---:|"])
    for fila in ranking.head(10).itertuples(index=False):
        texto.append(f"| {fila.fecha:%Y-%m-%d} | {fila.puntuacion:.3f} |")
    texto.extend(["", "## Magnitud al retirar fechas extremas", "", "| Sentido | Comparación | Escenario | Estimación (pp) | IC95 exploratorio |",
                  "|---|---|---|---:|---|"])
    for fila in robustez.loc[robustez.metrica.eq("exceso_magnitud_pp") & ~robustez.escenario.str.startswith("sin_anio_")].itertuples(index=False):
        texto.append(f"| {fila.sentido} | {fila.comparacion} | {fila.escenario} | {fila.estimacion_pp:.3f} | [{fila.ic95_inferior_pp:.3f}, {fila.ic95_superior_pp:.3f}] |")
    texto.extend(["", "## Límites", "", *["- " + t for t in bundle["limitaciones"]], ""])
    (salida / "conclusiones_generales.md").write_text("\n".join(texto), encoding="utf-8")
    print(json.dumps({"casos_verificados": len(casos), "relaciones_verificadas": sum(c["n_relaciones"] for c in casos),
                      "conclusion_asociacion": conclusiones[0]["titulo"]}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="src/analysis/general_config.json")
    ejecutar(parser.parse_args().config)
