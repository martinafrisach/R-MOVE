"""Materializa una validación explícita del usuario sin crear controles por omisión."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

import pandas as pd

from .rmove_general import normalizar_catalogo
from .rmove_territory import validar_revision


def preparar_validacion(candidatos, catalogo, revisado_por, fecha_revision, por_reglas_aceptadas=False):
    """Prioridad directa (lugar/línea), después indirecta (solo transbordo)."""
    tipos = {"localizacion_mencionada", "conexion_linea_actual", "conexion_transbordo_actual"}
    if not set(candidatos.tipo_candidato) <= tipos:
        raise ValueError("Hay tipos de candidato no contemplados en la validación")
    fechas = catalogo.set_index("incident_id").date.to_dict()
    filas = []
    for (identificador, codigo), grupo in candidatos.groupby(["incident_id", "codigo"], sort=True):
        if identificador not in fechas:
            raise ValueError("La propuesta no pertenece al catálogo actual")
        directa = grupo.tipo_candidato.isin(["localizacion_mencionada", "conexion_linea_actual"]).any()
        fecha = fechas[identificador].strftime("%Y-%m-%d")
        filas.append({"incident_id": identificador, "codigo": codigo,
                      "categoria": "directa" if directa else "indirecta",
                      "fuente": ("Regeneración solicitada por el usuario con las reglas territoriales previamente aceptadas"
                                 if por_reglas_aceptadas else "Validación explícita del usuario en la conversación de trabajo"),
                      "criterio": "; ".join(sorted(set(grupo.tipo_candidato))),
                      "evidencia_propuesta": "; ".join(sorted(set(grupo.evidencia))),
                      "revisado_por": revisado_por, "fecha_revision": fecha_revision,
                      "valido_desde": fecha, "valido_hasta": fecha,
                      "origen_validacion": ("regeneracion_por_reglas_aceptadas_no_revision_manual_nueva"
                                            if por_reglas_aceptadas else "declaracion_usuario_no_verificacion_externa_automatica")})
    return filas


def ejecutar(config_path, revisado_por, por_reglas_aceptadas=False):
    root = Path(__file__).resolve().parents[2]
    config_path = Path(config_path)
    config = json.loads(config_path.read_text(encoding="utf-8"))
    salida = root / config["salida"]
    auditoria = json.loads((salida / "auditoria_territorial.json").read_text(encoding="utf-8"))
    excel = root / config["incidencias"]
    if hashlib.sha256(excel.read_bytes()).hexdigest() != auditoria["sha256_catalogo"]:
        raise ValueError("El catálogo ha cambiado desde la generación de las propuestas")
    for fuente in auditoria["fuentes"]:
        if hashlib.sha256((root / fuente["ruta"]).read_bytes()).hexdigest() != fuente["sha256"]:
            raise ValueError("Ha cambiado una fuente territorial de las propuestas")
    candidatos_path = salida / "candidatos_territoriales.parquet"
    candidatos = pd.read_parquet(candidatos_path)
    catalogo = normalizar_catalogo(pd.read_excel(excel, sheet_name=config["hoja"]))
    municipios = pd.read_parquet(salida / "municipios_movilidad.parquet")
    ahora = datetime.now(timezone.utc).isoformat()
    filas = preparar_validacion(candidatos, catalogo, revisado_por, ahora, por_reglas_aceptadas)
    revisada = validar_revision(filas, catalogo, municipios)
    ruta = salida / "asignaciones_validadas_usuario.json"
    # Evita sustituir silenciosamente una revisión anterior.
    if ruta.exists():
        raise FileExistsError(f"Ya existe una validación: {ruta}")
    ruta.write_text(json.dumps(filas, ensure_ascii=False, indent=2), encoding="utf-8")
    manifiesto = {"fecha_validacion": ahora, "revisado_por": revisado_por,
                  "sha256_catalogo": auditoria["sha256_catalogo"],
                  "sha256_candidatos": hashlib.sha256(candidatos_path.read_bytes()).hexdigest(),
                  "sha256_asignaciones": hashlib.sha256(ruta.read_bytes()).hexdigest(),
                  "categorias": revisada.categoria.value_counts().to_dict(),
                  "n_registros_con_asignacion": revisada.incident_id.nunique(),
                  "criterio_prioridad": "directa por lugar/línea; indirecta solo transbordo; resto desconocida",
                  "alcance": ("regeneración solicitada con reglas territoriales previamente aceptadas"
                              if por_reglas_aceptadas else "asignaciones propuestas aceptadas explícitamente por el usuario")}
    (salida / "validacion_usuario.json").write_text(json.dumps(manifiesto, ensure_ascii=False, indent=2), encoding="utf-8")
    config["revision_territorial"] = ruta.relative_to(root).as_posix()
    config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    revisada.to_parquet(salida / "exposicion_revisada.parquet", index=False)
    # Actualiza solo los campos de revisión; las propuestas conservan su naturaleza.
    auditoria["n_asignaciones_revisadas"] = len(revisada)
    auditoria["sha256_revision_territorial"] = manifiesto["sha256_asignaciones"]
    auditoria["configuracion"] = config
    (salida / "auditoria_territorial.json").write_text(json.dumps(auditoria, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifiesto, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="src/analysis/general_config.json")
    parser.add_argument("--revisado-por", required=True)
    parser.add_argument("--por-reglas-aceptadas", action="store_true")
    args = parser.parse_args()
    ejecutar(args.config, args.revisado_por, args.por_reglas_aceptadas)
