"""Empaqueta el Observatorio R-MOVE para GitHub Pages.

Copia solo los ficheros que necesita la web, manteniendo las rutas relativas del repositorio
(el Observatorio lee ../../data/processed/rmove/observatorio/...):

  dist/dashboard-pages/
    index.html                                   → redirige a src/dashboard-v2/
    src/dashboard-v2/{index.html, observatorio.css, observatorio.js, favicon.svg, railway-network.geojson}
    data/processed/rmove/observatorio/{observatorio.json, municipios_mapa.geojson[, vulnerabilidad.json]}

No copia notebooks, CSV, parquet ni datos originales. No ejecuta análisis.

Uso, desde la raíz del repositorio:
  python src/dashboard-v2/build_pages.py --check   # solo valida
  python src/dashboard-v2/build_pages.py           # valida y construye
"""
from __future__ import annotations

import json
import re
import shutil
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
WEB = RAIZ / "src" / "dashboard-v2"
DATOS = RAIZ / "data" / "processed" / "rmove" / "observatorio"
SALIDA = RAIZ / "dist" / "dashboard-pages"

ASSETS = ["index.html", "observatorio.css", "observatorio.js", "favicon.svg", "railway-network.geojson"]
DATOS_OBLIGATORIOS = ["observatorio.json", "municipios_mapa.geojson"]
DATOS_OPCIONALES = ["vulnerabilidad.json", "catalunya_contorno.geojson"]

ENTRADA = """<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=src/dashboard-v2/">
<title>Observatorio R-MOVE</title></head>
<body><p><a href="src/dashboard-v2/">Abrir el Observatorio R-MOVE</a></p></body></html>
"""


def validar() -> list[Path]:
    errores, ficheros = [], []
    for f in ASSETS:
        p = WEB / f
        (ficheros if p.exists() else errores).append(p if p.exists() else f"Falta {p.relative_to(RAIZ)}")
    for f in DATOS_OBLIGATORIOS:
        p = DATOS / f
        if not p.exists():
            errores.append(f"Falta {p.relative_to(RAIZ)} (ejecuta python src/dashboard-v2/build_observatorio.py)")
            continue
        ficheros.append(p)
    ficheros += [DATOS / f for f in DATOS_OPCIONALES if (DATOS / f).exists()]

    for p in ficheros:
        if p.suffix in (".json", ".geojson"):
            try:
                json.loads(p.read_text(encoding="utf-8"))
            except Exception as e:  # noqa: BLE001
                errores.append(f"JSON no válido: {p.relative_to(RAIZ)} ({e})")
    obs = DATOS / "observatorio.json"
    if obs.exists():
        d = json.loads(obs.read_text(encoding="utf-8"))
        for clave in ("tipos", "municipios", "incidencias", "grupos", "distancia", "alternativa", "evento", "placebo", "barrios"):
            if clave not in d:
                errores.append(f"observatorio.json no tiene '{clave}'")
    # Las referencias locales del HTML y del JS deben existir
    html = (WEB / "index.html").read_text(encoding="utf-8") if (WEB / "index.html").exists() else ""
    js = (WEB / "observatorio.js").read_text(encoding="utf-8") if (WEB / "observatorio.js").exists() else ""
    for ref in re.findall(r'(?:href|src)="([^"#:]+?)(?:\?[^"]*)?"', html):
        if not (WEB / ref).exists():
            errores.append(f"index.html enlaza a un fichero que no existe: {ref}")
    for ref in re.findall(r"const \w+_URL = '([^']+)'", js):
        if not (WEB / ref).resolve().exists():
            errores.append(f"observatorio.js lee un fichero que no existe: {ref}")
    if "../dashboard/" in html + js:
        errores.append("El Observatorio todavía enlaza al dashboard clásico (../dashboard/)")
    if errores:
        print("ERRORES:\n- " + "\n- ".join(errores))
        sys.exit(1)
    return ficheros


def construir(ficheros: list[Path]) -> None:
    if SALIDA.exists():
        shutil.rmtree(SALIDA)
    for p in ficheros:
        destino = SALIDA / p.relative_to(RAIZ)
        destino.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(p, destino)
    (SALIDA / "index.html").write_text(ENTRADA, encoding="utf-8")
    (SALIDA / ".nojekyll").write_text("", encoding="utf-8")
    n = sum(1 for x in SALIDA.rglob("*") if x.is_file())
    print(f"OK · {SALIDA.relative_to(RAIZ)} · {n} ficheros")


if __name__ == "__main__":
    fs = validar()
    print(f"Validación correcta · {len(fs)} ficheros del Observatorio")
    if "--check" not in sys.argv:
        construir(fs)
