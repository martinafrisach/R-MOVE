# Dashboard de incidencias Rodalies (mockup)

Mockup del entregable 1.3 (dashboard interactivo). Usa datos simulados.

- Vista inicial: todas las líneas de Rodalies.
- Buscador desplegable para elegir una línea.
- Al elegir una línea se abre un mapa interactivo de Cataluña (Leaflet) con su trazado y sus incidencias.

## Cómo verlo

Abre `index.html` en el navegador (necesita internet para Leaflet y el mapa de fondo), o desde la raíz del repo:

    python -m http.server 8000 --directory src/dashboard

y entra en http://localhost:8000.

## Pendiente

- Sustituir las estaciones, líneas e incidencias simuladas (`S`, `LN` y el bloque de incidencias en `index.html`) por los datos de `src/data` y los resultados de `reports/statistical_analysis`.
- Validar los recorridos con datos GTFS de Rodalies.
- Añadir filtros por fecha y territorio.
