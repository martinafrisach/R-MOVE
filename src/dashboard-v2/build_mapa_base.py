"""(Sustituido por build_contorno.py, que genera todos los municipios de Cataluña y el perímetro.)
Genera la cartografía base del relato: municipios simplificados (WGS84) alrededor de Barcelona.

Entrada: data/raw/limites/municipis_icgc.geojson (ICGC, EPSG:25831)
Salida:  data/processed/rmove/observatorio/municipios_mapa.geojson  (~ ligero, para el navegador)
Requiere: shapely y pyproj.   Uso: python src/dashboard-v2/build_mapa_base.py
"""
import json
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import box, mapping, shape
from shapely.ops import transform

RAIZ = Path(__file__).resolve().parents[2]
ENTRADA = RAIZ / "data" / "raw" / "limites" / "municipis_icgc.geojson"
SALIDA = RAIZ / "data" / "processed" / "rmove" / "observatorio" / "municipios_mapa.geojson"
BBOX = box(1.35, 41.10, 3.05, 42.25)   # provincia de Barcelona y alrededores (lon/lat)
TOLERANCIA_M = 120                      # simplificación en metros (antes de reproyectar)


def redondear(geo, d=4):
    def r(c):
        return [r(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], d), round(c[1], d)]
    geo["coordinates"] = r(geo["coordinates"])
    return geo


def main():
    t = Transformer.from_crs("EPSG:25831", "EPSG:4326", always_xy=True).transform
    g = json.loads(ENTRADA.read_text(encoding="utf-8"))
    feats = []
    for f in g["features"]:
        geom = shape(f["geometry"]).simplify(TOLERANCIA_M, preserve_topology=True)
        geom = transform(t, geom)
        if not geom.intersects(BBOX):
            continue
        p = f["properties"]
        feats.append({"type": "Feature",
                      "properties": {"codigo": p["CODIMUNI"][:5], "nombre": p["NOMMUNI"], "comarca": p["NOMCOMAR"], "prov": p["CODIPROV"]},
                      "geometry": redondear(mapping(geom))})
    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    SALIDA.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"OK · {SALIDA.relative_to(RAIZ)} · {len(feats)} municipios · {SALIDA.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
