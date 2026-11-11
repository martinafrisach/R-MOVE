# R-MOVE · dashboard minimalista

Para empaquetado seguro, bloqueos de autorización y despliegue en GitHub Pages,
consulta el [README principal](../../README.md). Los fuentes permanecen aquí.

Vista compacta sobre los resultados reales del Notebook 04. Incluye solo: selector de caso, tres indicadores, mapa y detalle de una relación OD, y un ranking de cinco conexiones. Fuente y método en un desplegable.

## Instalación en el repositorio existente

Copia los archivos `src/dashboard/index.html`, `dashboard.css`, `dashboard.js` y `case-views.js` a `R-MOVE/src/dashboard/`. No necesitas copiar `data` si tu repositorio ya dispone de los dos JSON generados por Notebook 04 dentro de `data/processed/rmove/`.

Desde la raíz del repositorio ejecuta `python -m http.server 8000` y visita http://localhost:8000/src/dashboard/ . Refresca con Ctrl+F5.

## Datos

Los dos JSON de `data/processed/rmove/` ya están versionados en la rama del PR.
El equipo confirma disponer de autorización; faltan su referencia verificable,
la persona que aprueba y la fecha real de aprobación. `publication.json` contiene
los hashes correctos y mantiene los campos pendientes en `null`, bloqueando la
publicación hasta completarlos. Las referencias se calculan en
Notebook 04, no en JavaScript. La aplicación necesita Internet para cargar
Leaflet y teselas de OpenStreetMap; si el proveedor bloquea las teselas se mantiene
la geometría de las conexiones.

## Interpretación

La diferencia de viajes es frente a la mediana de días comparables, no el número de viajeros afectados por Rodalies. Los puntos geográficos son posiciones municipales aproximadas y las conexiones no son itinerarios ferroviarios.
