# R-MOVE

Motor Python de movilidad e incidencias documentadas y dashboard estático.
El análisis vive en `src/analysis/`, los notebooks en `notebooks/` y la web en `src/dashboard/`.

## Dashboard

- **Análisis general:** cuatro preguntas de investigación, cobertura, magnitud frente a placebos, intervalos exploratorios, sensibilidad a fechas extremas, recurrencia municipal y acceso a casos.
- **Estudio de casos:** cinco exportaciones del notebook 04, mapa municipal, filtros de dirección, detalle OD y ranking de variaciones.

Casos vigentes: 7 de febrero, 17 de marzo y 5 de junio de 2025, 2 de mayo de 2023 y 29 de abril de 2024. Junio incluye 23 municipios. Los cinco casos suman 425 relaciones verificadas contra el Excel actual y M2.

La mayor magnitud del análisis principal es sensible a retirar las cinco fechas extremas; no se atribuye causalidad ni se confirma efecto dominó. Informe local: `data/processed/rmove/general/conclusiones_generales.md`.

## Actualizar resultados

1. Guardar el Excel vigente en la ruta de `src/analysis/general_config.json`.
2. Para reemplazar el análisis general sin copias anteriores:

   ```powershell
   .venv/Scripts/python.exe -B -m src.analysis.rmove_rebuild --reemplazar --reglas-territoriales-aceptadas
   ```

3. Ejecutar el notebook 04 para regenerar sus casos con ese Excel.
4. Verificar casos, recalcular influencia y exportar el resumen web:

   ```powershell
   .venv/Scripts/python.exe -B -m src.analysis.rmove_review
   ```

5. Revisar resultados y actualizar los SHA-256 exactos de los seis JSON incluidos en `src/dashboard/publication.json`. Si cambia la selección de casos, actualizar `RESULTS` en el empaquetador, `CASES` en JavaScript, selector HTML y excepciones exactas de `.gitignore`.

El cálculo completo requiere el entorno Python y los datos locales originales. La web consume resultados calculados; no ejecuta análisis en el navegador. La [documentación del motor](docs/analisis-general.md) describe reglas y límites.

## Validar y construir

```powershell
.venv/Scripts/python.exe -B -m unittest discover -s src/analysis -v
.venv/Scripts/python.exe -B -m unittest discover -s src/dashboard -p test_pages.py -v
node --check src/dashboard/dashboard.js
node --check src/dashboard/overview.js
node --check src/dashboard/case-views.js
node src/dashboard/verify-results.cjs
node src/dashboard/verify-overview.cjs
.venv/Scripts/python.exe -B src/dashboard/build-pages.py --check
.venv/Scripts/python.exe -B src/dashboard/build-pages.py
.venv/Scripts/python.exe -m http.server 8000 --directory dist/dashboard-pages
```

El build rechaza una salida existente: comprobar su ubicación y retirar el artefacto generado antes de reconstruir. `--check` solo valida. La entrada de raíz redirige a `src/dashboard/`; las referencias son relativas y se validan bajo `/R-MOVE/`.

El artefacto contiene exactamente **13 archivos**: la entrada de raíz, seis assets del dashboard y seis JSON derivados (cinco casos y resumen general). Se verifican esquema, hashes, coherencia entre resumen y casos y rutas. No se copian notebooks, CSV, Parquet, Excel, credenciales, código de análisis ni directorios completos. Las únicas excepciones de datos en Git son esos seis JSON. Leaflet y OpenStreetMap requieren Internet.

## GitHub Pages

El workflow `.github/workflows/deploy-dashboard.yml` construye el mismo artefacto. Los pull requests validan; el despliegue se ejecuta desde `main` conforme al workflow. Cambiar el dashboard local no hace merge, push ni despliega por sí solo. No se ejecutan notebooks en el despliegue.

Revisión visual local con Edge sin interfaz en escritorio, viewport móvil real de 390 px y vista de casos con mapa. Las pruebas Node verifican carga, filtros, navegación, intervalos y errores sin llamadas de red para el mapa.
