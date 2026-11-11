# Dashboard R-MOVE

Dos vistas sobre resultados del motor Python y el notebook 04:

- **Análisis general:** preguntas y conclusiones, cobertura documental, magnitud entre grupos, intervalos exploratorios, recorte de fechas extremas y recurrencia descriptiva. Filtros de entradas/salidas y exposición.
- **Estudio de casos:** cinco casos seleccionados, mapa y relaciones OD, detalle de viajes y mediana, filtros municipales y ranking.

`overview.js` lee `data/processed/rmove/general/dashboard_general.json`. `dashboard.js` carga cada caso bajo demanda. `case-views.js` presenta el detalle. Las rutas relativas funcionan bajo `/R-MOVE/`.

Desde la raíz, servir con `python -m http.server 8000` y abrir `http://localhost:8000/src/dashboard/`. Enlace directo a casos: `?view=cases&date=2025-03-17`.

Los resultados generales y de casos deben corresponder al mismo Excel. `python -m src.analysis.rmove_review` verifica las 425 relaciones contra M2, analiza influencia de fechas y genera la exportación general. Al regenerar resultados, actualizar sus hashes en `publication.json` tras revisarlos.

Las conclusiones se limitan a incidencias documentadas. Los municipios desconocidos no son controles de baja exposición. La recurrencia no es un ranking de significación y los intervalos no establecen causalidad.

Consulta el [README principal](../../README.md) para pruebas y empaquetado.
