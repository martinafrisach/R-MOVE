"""Actualiza el Observatorio con los últimos resultados del análisis, de principio a fin.

Hace, en orden:
  1. Ejecuta los notebooks 03 (municipios), 04 (barrios) y 05 (vulnerabilidad) y los guarda ya ejecutados.
  2. Comprueba que cada notebook ha regenerado sus ficheros exportados en esta ejecución.
  3. Genera data/processed/rmove/observatorio/observatorio.json (src/dashboard-v2/build_observatorio.py).
  4. Valida el dashboard (sintaxis del JS si hay Node y build_pages.py --check).
  5. Muestra un resumen de las cifras principales y qué ha cambiado respecto al observatorio anterior.

No hace commit, push ni despliegue: revisa el dashboard en local y publícalo tú.

Uso (desde la raíz del repositorio, con el entorno del proyecto activado):
    python scripts/actualizar_dashboard.py                 # todo
    python scripts/actualizar_dashboard.py --desde 04      # a partir del notebook 04 (el 03 ya está al día)
    python scripts/actualizar_dashboard.py --solo-dashboard  # sin ejecutar notebooks: solo pasos 3–5
Después, para verlo:  python -m http.server 8000   →   http://localhost:8000/src/dashboard-v2/
"""
from __future__ import annotations

import argparse
import asyncio
import json
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
NB = RAIZ / "notebooks"
RM = RAIZ / "data" / "processed" / "rmove"
WEB = RAIZ / "src" / "dashboard-v2"
OBS = RM / "observatorio" / "observatorio.json"

# Notebooks en orden de dependencia y lo que debe regenerar cada uno.
PASOS = [
    ("03", NB / "03_impacto_municipios.ipynb", [
        RM / "municipios_calendario.parquet", RM / "municipios_info.parquet", RM / "municipios_dias_caos.parquet",
        RM / "municipios_averias_linea.parquet", RM / "municipios_tipos_dia.parquet", RM / "municipios_panel_viajes.parquet",
        RM / "resultados" / "dashboard_resultados.json"]),
    ("04", NB / "04_impacto_barrios.ipynb", [RM / "resultados" / "barrios_resultados.json"]),
    ("05", NB / "05_vulnerabilidad_motorizacion_renta.ipynb", [RM / "observatorio" / "vulnerabilidad.json",
                                     RM / "observatorio" / "vulnerabilidad_resumen.json"]),
]


def titulo(txt):
    print(f"\n{'─' * 78}\n{txt}\n{'─' * 78}", flush=True)


def ejecutar_notebook(clave, ruta, timeout):
    """Ejecuta el notebook en su carpeta y lo guarda ejecutado. Guarda antes una copia en notebooks/_backup/."""
    import nbformat
    from nbclient import NotebookClient
    from nbclient.exceptions import CellExecutionError

    copia = NB / "_backup" / f"{ruta.stem}_antes_de_actualizar.ipynb"
    copia.parent.mkdir(exist_ok=True)
    shutil.copy2(ruta, copia)

    nb = nbformat.read(ruta, as_version=4)
    cliente = NotebookClient(nb, timeout=timeout, kernel_name="python3",
                             resources={"metadata": {"path": str(ruta.parent)}})
    t0 = time.time()
    try:
        cliente.execute()
    except CellExecutionError as e:
        nbformat.write(nb, ruta)          # se guarda igualmente, para ver el error en el notebook
        n = next((k for k, c in enumerate(nb.cells) if c.cell_type == "code"
                  and any(o.get("output_type") == "error" for o in c.get("outputs", []))), None)
        print(f"\n✗ El notebook {clave} ha fallado en la celda {n}. El notebook se ha guardado con el error;"
              f" la versión anterior está en {copia.relative_to(RAIZ)}.\n")
        print(str(e).strip()[-2500:])
        sys.exit(1)
    nbformat.write(nb, ruta)
    print(f"✓ Notebook {clave} ejecutado en {time.time() - t0:,.0f} s y guardado", flush=True)


def comprobar_exportaciones(clave, ficheros, desde):
    """Cada fichero debe existir y haberse escrito después de empezar a ejecutar el notebook."""
    viejos = [f for f in ficheros if not f.exists() or f.stat().st_mtime < desde]
    if viejos:
        print(f"\n✗ El notebook {clave} no ha regenerado:")
        for f in viejos:
            print(f"   - {f.relative_to(RAIZ)}{'' if f.exists() else ' (no existe)'}")
        print("  ¿Se ha ejecutado hasta el final? Revisa sus celdas de exportación.")
        sys.exit(1)
    print(f"✓ Exportaciones del {clave} al día ({len(ficheros)} ficheros)")


def comando(args, que):
    r = subprocess.run(args, cwd=RAIZ, capture_output=True, text=True, encoding="utf-8", errors="replace")
    salida = (r.stdout + r.stderr).strip()
    if r.returncode != 0:
        print(f"\n✗ {que} ha fallado:\n{salida}")
        sys.exit(1)
    print(f"✓ {que}" + (f"\n  {salida.splitlines()[-1]}" if salida else ""))


def pc(x):
    """Porcentaje con signo en formato español (−3,2 %)."""
    return "—" if x is None else f"{x:+.1f} %".replace(".", ",").replace("-", "−")


def resumen(antes):
    d = json.loads(OBS.read_text(encoding="utf-8"))
    dep = next(g for g in d["grupos"] if g["grupo"] == "dependientes")
    filas = [("Días de caos · dependientes (media)", dep["efecto_pct"],
              next((g["efecto_pct"] for g in antes.get("grupos", []) if g["grupo"] == "dependientes"), None) if antes else None)]
    ant_inc = {i["fecha"]: i for i in antes.get("incidencias", [])} if antes else {}
    for i in d["incidencias"]:
        a = ant_inc.get(i["fecha"])
        filas.append((f"{i['fecha']} · {i['titulo']}", i["perdidos"]["efecto_pct"], a["perdidos"]["efecto_pct"] if a else None))
    ant_av = {a["fecha"]: a for a in antes.get("averias", [])} if antes else {}
    for a in d.get("averias", []):
        x = ant_av.get(a["fecha"])
        filas.append((f"{a['fecha']} · avería {a['linea_nombre']}", a["perdidos"]["efecto_pct"], x["perdidos"]["efecto_pct"] if x else None))
    ant_b = {(b["caso"], b["sentido"]): b for b in antes.get("barrios", [])} if antes else {}
    for b in d["barrios"]:
        if b["sentido"] == "ida":
            x = ant_b.get((b["caso"], "ida"))
            filas.append((f"Barrios · {b['caso']} · con estación", b["con_estacion"], x["con_estacion"] if x else None))

    print(f"\n{'Resultado':<62}{'ahora':>9}{'antes':>9}")
    cambios = 0
    for nombre, ahora, antes_v in filas:
        marca = ""
        if antes_v is None:
            marca = "  (nuevo)"
        elif abs(ahora - antes_v) >= 0.5:
            marca, cambios = "  ← cambia", cambios + 1
        print(f"{nombre[:61]:<62}{pc(ahora):>9}{pc(antes_v):>9}{marca}")
    print(f"\n{cambios} cifras cambian 0,5 puntos o más."
          + (" Revisa los textos de lectura de los notebooks y del Relato." if cambios else ""))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--desde", choices=[c for c, _, _ in PASOS], help="empezar por este notebook")
    p.add_argument("--solo-dashboard", action="store_true", help="no ejecutar notebooks")
    p.add_argument("--timeout", type=int, default=3600, help="segundos máximos por celda (por defecto 3600)")
    a = p.parse_args()

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if sys.platform == "win32":          # Jupyter en Windows necesita este bucle de eventos
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    antes = json.loads(OBS.read_text(encoding="utf-8")) if OBS.exists() else None
    print(f"R-MOVE · actualizar el Observatorio · {datetime.now():%d/%m/%Y %H:%M}")

    if not a.solo_dashboard:
        claves = [c for c, _, _ in PASOS]
        for clave, ruta, ficheros in PASOS[claves.index(a.desde) if a.desde else 0:]:
            titulo(f"Notebook {clave} · {ruta.name}")
            t0 = time.time()
            ejecutar_notebook(clave, ruta, a.timeout)
            comprobar_exportaciones(clave, ficheros, t0)

    titulo("Observatorio")
    # Los resultados por barrios tienen que ser al menos tan recientes como los de municipios
    # (si no, mezclarían resultados de días limpios distintos)
    res_municipios, res_barrios = RM / "resultados" / "dashboard_resultados.json", RM / "resultados" / "barrios_resultados.json"
    if res_municipios.exists() and res_barrios.exists() and res_barrios.stat().st_mtime < res_municipios.stat().st_mtime:
        print("✗ barrios_resultados.json es anterior a dashboard_resultados.json: ejecuta también el notebook 04 "
              "(python scripts/actualizar_dashboard.py --desde 04).")
        sys.exit(1)
    comando([sys.executable, "-B", str(WEB / "build_observatorio.py")], "observatorio.json generado")
    if shutil.which("node"):
        comando(["node", "--check", str(WEB / "observatorio.js")], "Sintaxis del JS correcta")
    else:
        print("· Node no está instalado: no se comprueba la sintaxis del JS (lo hace GitHub al publicar).")
    comando([sys.executable, "-B", str(WEB / "build_pages.py"), "--check"], "Validación de build_pages.py")

    titulo("Resumen")
    resumen(antes)
    print("\nPara verlo: python -m http.server 8000  →  http://localhost:8000/src/dashboard-v2/")
    print("Para publicarlo: commit y push a main de data/processed/rmove/observatorio/, resultados/ y src/dashboard-v2/.")


if __name__ == "__main__":
    main()
