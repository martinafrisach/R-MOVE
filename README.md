# R-MOVE

Análisis del impacto de las incidencias de Rodalies en la movilidad hacia Barcelona y su dashboard estático, el Observatorio.
Los notebooks del análisis están en `notebooks/` y el dashboard del proyecto, el **Observatorio**, en `src/dashboard-v2/`. `src/analysis/` contiene las funciones de apoyo que usa el notebook 02 (catálogo de incidencias y referencia de la mediana).

> **¿Eres del equipo y acabas de clonar el repo?** Lee [CONTRIBUTING.md](CONTRIBUTING.md): instalación, de dónde sacar los datos (no están en Git), cómo ver el Observatorio y cómo trabajar con ramas sin pisarnos.
>
> Inicio rápido: `pip install -r requirements.txt` → `python -m http.server 8000` → [Observatorio](http://localhost:8000/src/dashboard-v2/)

## Dashboard: Observatorio R-MOVE

Cuatro modos: **el relato** (scrollytelling con mapa), **¿Y si…?** (simulador de incidencias por municipio), **Mi municipio** y **Laboratorio** (casos, validaciones, qué lo explica y método). Detalle en [`src/dashboard-v2/README.md`](src/dashboard-v2/README.md).

Todas las cifras salen del **clustering** del notebook 04 (tipos de día por volumen del control y época del año, efecto corregido por el control, p e intervalos con placebos). La regresión de diferencias en diferencias se usa como comprobación. Los resultados por barrio (M3) salen del notebook 05.

## Actualizar resultados

Un solo comando ejecuta los notebooks 04 (M2), 05 (M3, barrios) y 06 (socioeco), comprueba que han regenerado sus
exportaciones, genera `observatorio.json`, valida el dashboard y muestra qué cifras han cambiado:

```bash
python scripts/actualizar_dashboard.py                  # todo
python scripts/actualizar_dashboard.py --desde 05       # si el 04 ya está al día
python scripts/actualizar_dashboard.py --solo-dashboard  # sin ejecutar notebooks
```

El dashboard no tiene cifras escritas a mano: todo sale de `resultados/dashboard_resultados.json` (notebook 04),
`resultados/m3_resultados.json` (notebook 05) y `observatorio/vulnerabilidad*.json` (notebook 06). El script no hace
commit ni push.

Para construir la publicación a mano:

   ```bash
   node --check src/dashboard-v2/observatorio.js
   python src/dashboard-v2/build_pages.py --check
   python src/dashboard-v2/build_pages.py
   python -m http.server 8000 --directory dist/dashboard-pages
   ```

El artefacto contiene solo la entrada de la raíz, los cinco ficheros web del Observatorio y sus datos (`observatorio.json`, `municipios_mapa.geojson` y, si existe, `vulnerabilidad.json`). No se copian notebooks, CSV, parquet ni datos originales. Leaflet necesita Internet.

## GitHub Pages

El workflow `.github/workflows/deploy-dashboard.yml` construye el mismo artefacto del Observatorio. Los pull requests validan; el despliegue se ejecuta desde `main` conforme al workflow. Cambiar el dashboard local no hace merge, push ni despliega por sí solo. No se ejecutan notebooks en el despliegue.
