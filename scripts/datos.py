"""Compartir y comprobar los datos locales de R-MOVE (no van a Git).

Uso (desde la raíz del repo):
    python scripts/datos.py comprobar
        -> dice qué notebooks y dashboards puedes ejecutar con los datos que tienes.
    python scripts/datos.py empaquetar
        -> crea datos_rmove_AAAAMMDD.zip con data/processed y data/raw
           (sin los CSV brutos de Telefónica, 16 GB) para subirlo a la carpeta compartida.
    python scripts/datos.py empaquetar --con-telefonica-raw
        -> incluye también data/raw/telefonica (solo si alguien necesita el notebook 01 o 04).

Para usar el paquete: descomprimirlo en la raíz del repo (crea/rellena la carpeta data/).
"""
from __future__ import annotations

import argparse
import sys
import zipfile
from datetime import date
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
DATA = RAIZ / "data"
PROC = DATA / "processed"
RM = PROC / "rmove"
RAW = DATA / "raw"

# Qué necesita cada pieza del proyecto. Patrones glob relativos a la raíz del repo.
REQUISITOS = {
    "Observatorio (src/dashboard-v2) - ver": [
        "data/processed/rmove/observatorio/observatorio.json",
        "data/processed/rmove/observatorio/municipios_mapa.geojson",
    ],
    "Observatorio - regenerar observatorio.json": [
        "data/processed/rmove/resultados/dashboard_resultados.json",
        "data/processed/rmove/resultados/m3_resultados.json",
        "data/processed/rmove/m2_conectividad_municipios.parquet",
    ],
    "Observatorio - regenerar mapa base": [
        "data/raw/limites/municipis_icgc.geojson",
    ],
    "Notebook 01 (preparación Telefónica)": [
        "data/raw/telefonica/*/movilidad_municipios_*_origen.csv",
    ],
    "Notebook 02 (mediana)": [
        "data/processed/telefonica/M2.parquet",
        "data/raw/rodalies/RMOVE_Incidencias_Barcelona_Jul2024_Ago2025_v07.xlsx",
    ],
    "Notebook 03 (impacto incidencias, M2)": [
        "data/processed/telefonica/M2.parquet",
        "data/raw/rodalies/Incidencias graves Rodalies*.xlsx",
        "data/raw/rodalies/incidencias_rodalies_2023_2025.csv",
        "data/processed/rmove/estaciones_rodalies_municipio.csv",
    ],
    "Notebook 04 (barrios, M3)": [
        "data/processed/telefonica/M2.parquet",
        "data/processed/rmove/m2_cal.parquet",
        "data/processed/rmove/m2_tipos_dia.parquet",
        "data/processed/rmove/m2_info_municipios.parquet",
        "data/processed/rmove/m3_barrio_a_mun.parquet",
        "data/processed/rmove/m3_mun_a_barrio.parquet",
        "data/raw/rodalies/bcn_station_neighborhoods.json",
    ],
}


def comprobar() -> int:
    print(f"Repositorio: {RAIZ}\n")
    faltan_total = 0
    for pieza, patrones in REQUISITOS.items():
        faltan = [p for p in patrones if not any(RAIZ.glob(p))]
        estado = "OK      " if not faltan else "FALTAN  "
        print(f"[{estado}] {pieza}")
        for p in faltan:
            print(f"            - {p}")
        faltan_total += bool(faltan)
    if faltan_total:
        print("\nPide el paquete de datos (datos_rmove_*.zip) y descomprímelo en la raíz del repo.")
    return 0


def empaquetar(con_telefonica_raw: bool) -> int:
    destino = RAIZ / f"datos_rmove_{date.today():%Y%m%d}.zip"
    ficheros = []
    for base in (PROC, RAW):
        for f in base.rglob("*"):
            if not f.is_file() or f.name == ".gitkeep":
                continue
            rel = f.relative_to(RAIZ)
            if not con_telefonica_raw and rel.parts[:3] == ("data", "raw", "telefonica"):
                continue
            ficheros.append((f, rel))
    total = sum(f.stat().st_size for f, _ in ficheros)
    print(f"Empaquetando {len(ficheros)} ficheros ({total / 1e6:,.0f} MB) en {destino.name} ...")
    with zipfile.ZipFile(destino, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as z:
        for i, (f, rel) in enumerate(sorted(ficheros, key=lambda x: str(x[1])), 1):
            # parquet/zip/png ya van comprimidos: se guardan tal cual (más rápido)
            tipo = zipfile.ZIP_STORED if f.suffix in {".parquet", ".zip", ".png"} else zipfile.ZIP_DEFLATED
            z.write(f, rel.as_posix(), compress_type=tipo)
            if i % 200 == 0:
                print(f"  {i}/{len(ficheros)}")
    print(f"Listo: {destino} ({destino.stat().st_size / 1e6:,.0f} MB)")
    print("Súbelo a la carpeta compartida del equipo (no a GitHub).")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="accion", required=True)
    sub.add_parser("comprobar", help="qué puedes ejecutar con tus datos locales")
    e = sub.add_parser("empaquetar", help="crear el zip de datos para compartir")
    e.add_argument("--con-telefonica-raw", action="store_true", help="incluir data/raw/telefonica (16 GB)")
    a = p.parse_args()
    return comprobar() if a.accion == "comprobar" else empaquetar(a.con_telefonica_raw)


if __name__ == "__main__":
    sys.exit(main())
