"""Reemplazo completo del análisis general, sin copias de resultados anteriores.

python -m src.analysis.rmove_rebuild --reemplazar --reglas-territoriales-aceptadas
Las salidas de casos del notebook 04 se regeneran separadamente.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil

import pandas as pd

from . import rmove_general, rmove_territory, rmove_validate_territory, rmove_municipal, rmove_contrast


def comprobar_destino(root, configuracion):
    root = Path(root).resolve()
    esperado = root / "data/processed/rmove/general"
    destino = root / configuracion["salida"]
    if destino.resolve() != esperado or not destino.is_relative_to(root):
        raise ValueError("Solo se permite reemplazar data/processed/rmove/general dentro del proyecto")
    for tramo in [destino, *destino.parents]:
        if tramo == root:
            break
        if tramo.is_symlink() or (hasattr(tramo, "is_junction") and tramo.is_junction()):
            raise ValueError("El destino no puede contener enlaces ni junctions")
    for clave in ["incidencias", "movilidad", "estaciones_referencia", "gtfs_referencia"]:
        entrada = (root / configuracion[clave]).resolve()
        if entrada.is_relative_to(esperado):
            raise ValueError(f"La entrada {clave} está dentro del destino que se va a eliminar")
        if not entrada.is_file():
            raise FileNotFoundError(entrada)
    return esperado


def ejecutar(config_path, reemplazar=False, reglas_aceptadas=False):
    if not reemplazar or not reglas_aceptadas:
        raise ValueError("Se requieren --reemplazar y --reglas-territoriales-aceptadas")
    root = Path(__file__).resolve().parents[2]
    config_path = Path(config_path).resolve()
    config = json.loads(config_path.read_text(encoding="utf-8"))
    destino = comprobar_destino(root, config)
    if config_path.is_relative_to(destino):
        raise ValueError("La configuración no puede estar dentro del destino")
    # La validación del Excel y del periodo precede a cualquier eliminación.
    catalogo = rmove_general.normalizar_catalogo(pd.read_excel(root / config["incidencias"], sheet_name=config["hoja"]))
    if not catalogo.date.between(config["inicio_catalogo"], config["fin_catalogo"]).all():
        raise ValueError("El Excel excede el periodo configurado; ajustar sus límites antes de reemplazar")
    fuentes = {clave: hashlib.sha256((root / config[clave]).read_bytes()).hexdigest()
               for clave in ["incidencias", "estaciones_referencia", "gtfs_referencia"]}
    print(json.dumps({"fase": "reemplazo", "destino": str(destino), "n_registros": len(catalogo),
                      "copias_anteriores": False}), flush=True)
    # Se ha verificado la ruta absoluta exacta y sus entradas antes de borrar.
    if destino.exists():
        shutil.rmtree(destino)
    destino.mkdir(parents=True)
    config.pop("revision_territorial", None)
    config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    estado_path = destino / "ejecucion_actual.json"
    estado = {"inicio_utc": datetime.now(timezone.utc).isoformat(), "estado": "en_curso",
              "sha256_fuentes": fuentes, "modo": "reemplazo_completo_sin_copia_anterior"}
    def guardar():
        estado_path.write_text(json.dumps(estado, ensure_ascii=False, indent=2), encoding="utf-8")
    guardar()
    etapas = [("auditoria_general", lambda: rmove_general.ejecutar(config_path)),
              ("territorio", lambda: rmove_territory.ejecutar(config_path)),
              ("asignaciones", lambda: rmove_validate_territory.ejecutar(
                  config_path, "usuario_regeneracion_solicitada", por_reglas_aceptadas=True)),
              ("movilidad_municipal", lambda: rmove_municipal.ejecutar(config_path)),
              ("placebos_y_contraste", lambda: rmove_contrast.ejecutar(config_path))]
    try:
        for nombre, funcion in etapas:
            for clave, hash_inicial in fuentes.items():
                if hashlib.sha256((root / config[clave]).read_bytes()).hexdigest() != hash_inicial:
                    raise ValueError(f"La fuente {clave} ha cambiado durante la ejecución")
            estado["etapa"] = nombre
            guardar()
            print(json.dumps({"fase": nombre}), flush=True)
            funcion()
        for clave, hash_inicial in fuentes.items():
            if hashlib.sha256((root / config[clave]).read_bytes()).hexdigest() != hash_inicial:
                raise ValueError(f"La fuente {clave} ha cambiado durante la ejecución")
        estado.update(estado="completado", fin_utc=datetime.now(timezone.utc).isoformat())
        guardar()
    except Exception as error:
        estado.update(estado="fallido", error=str(error))
        guardar()
        raise
    print(json.dumps({"fase": "completado", "salida": str(destino)}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="src/analysis/general_config.json")
    parser.add_argument("--reemplazar", action="store_true")
    parser.add_argument("--reglas-territoriales-aceptadas", action="store_true")
    args = parser.parse_args()
    ejecutar(args.config, args.reemplazar, args.reglas_territoriales_aceptadas)
