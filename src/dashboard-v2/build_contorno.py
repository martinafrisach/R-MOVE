"""Genera la cartografía de los mapas del Observatorio a partir de los límites oficiales del ICGC.

Entrada: data/raw/limites/municipis_icgc.geojson (ICGC, EPSG:25831, los 947 municipios de Cataluña)
Salidas (WGS84, ligeras para el navegador):
  data/processed/rmove/observatorio/municipios_mapa.geojson    municipios de la provincia de Barcelona, simplificados
  data/processed/rmove/observatorio/catalunya_contorno.geojson perímetro de Cataluña (unión de los municipios)
El resto de Cataluña se dibuja plano (solo el perímetro). Los dos salen de la misma geometría simplificada,
así que el perímetro coincide exactamente con los municipios.
Requiere: shapely y pyproj.   Uso: python src/dashboard-v2/build_contorno.py
"""
import json
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.ops import transform, unary_union

RAIZ = Path(__file__).resolve().parents[2]
ENTRADA = RAIZ / "data" / "raw" / "limites" / "municipis_icgc.geojson"
DESTINO = RAIZ / "data" / "processed" / "rmove" / "observatorio"
SALIDA_MUN = DESTINO / "municipios_mapa.geojson"
SALIDA_CONTORNO = DESTINO / "catalunya_contorno.geojson"
TOLERANCIA_M = 120     # simplificación de los municipios (la misma que tenía el mapa)
CIERRE_M = 60          # cierra las rendijas entre municipios vecinos al unirlos
AREA_MIN_M2 = 2e6      # descarta islotes minúsculos del perímetro
PROVINCIA = "08"       # solo se dibujan los municipios de la provincia de Barcelona (los 62 del análisis lo son)


def redondear(c, d=4):
    return [redondear(x, d) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], d), round(c[1], d)]


def geojson(geom, t):
    g = mapping(transform(t, geom))
    return {"type": g["type"], "coordinates": redondear(g["coordinates"])}


def reparar(geom):
    """Reconstruye la superficie a partir de todos los anillos (XOR). En el fichero del ICGC, 92 municipios
    (Barcelona incluida) guardan islas y partes como «agujeros» fuera del polígono: el navegador los dibuja
    bien, pero shapely los considera no válidos y la unión se rompe."""
    anillos = [r for p in getattr(geom, "geoms", [geom]) for r in [p.exterior, *p.interiors]]
    out = Polygon()
    for r in anillos:
        out = out.symmetric_difference(Polygon(r).buffer(0))
    return out


def escribir(ruta, feats):
    ruta.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"OK · {ruta.relative_to(RAIZ)} · {len(feats)} elementos · {ruta.stat().st_size / 1e3:.0f} KB")


def main():
    g = json.loads(ENTRADA.read_text(encoding="utf-8"))
    t = Transformer.from_crs("EPSG:25831", "EPSG:4326", always_xy=True).transform
    DESTINO.mkdir(parents=True, exist_ok=True)

    feats, geoms = [], []
    for f in g["features"]:
        geom = shape(f["geometry"]).simplify(TOLERANCIA_M, preserve_topology=True)
        geoms.append(reparar(geom))
        p = f["properties"]
        if p["CODIPROV"] != PROVINCIA:
            continue
        feats.append({"type": "Feature",
                      "properties": {"codigo": p["CODIMUNI"][:5], "nombre": p["NOMMUNI"], "comarca": p["NOMCOMAR"], "prov": p["CODIPROV"]},
                      "geometry": geojson(geom, t)})
    escribir(SALIDA_MUN, feats)

    union = unary_union([x.buffer(CIERRE_M) for x in geoms]).buffer(-CIERRE_M)
    partes = list(union.geoms) if isinstance(union, MultiPolygon) else [union]
    contorno = MultiPolygon([Polygon(p.exterior) for p in partes if p.area > AREA_MIN_M2]).simplify(TOLERANCIA_M, preserve_topology=True)
    escribir(SALIDA_CONTORNO, [{"type": "Feature", "properties": {"nombre": "Catalunya"}, "geometry": geojson(contorno, t)}])


if __name__ == "__main__":
    main()
