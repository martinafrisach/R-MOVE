# R-MOVE

Dashboard estático de movilidad e incidencias. Los fuentes permanecen en
`src/dashboard/`; los notebooks y cálculos están en `notebooks/` y `src/analysis/`.

## Estado del despliegue

El dashboard necesita estos dos resultados del Notebook 04:

- `data/processed/rmove/incidencia_2025_06_05.json`
- `data/processed/rmove/incidencia_2025_02_07.json`

Ambos están **versionados en el remoto** de `deploy/dashboard-pages`, incorporados
por el commit `c7c6a4bcfbb6d9f743475b74add6bd005318b677`. El equipo confirma que
tiene autorización para publicar los resultados derivados incluidos en ambos JSON.
Consulta las [evidencias de revisión](docs/dashboard-publication-review.md).

`src/dashboard/publication.json` contiene exclusivamente la versión del manifiesto
y las rutas con sus hashes SHA-256. El build no exige los campos `authorization`,
`approved_by` ni `approved_on`. La confirmación del equipo se documenta aquí;
la autorización no es una comprobación técnica del empaquetador.
No hay regeneración automática ni sustitución de ausencias por datos inventados.

`.gitignore` permite únicamente esos dos resultados dentro de los datos procesados;
el resto de resultados y los datasets originales siguen ignorados. `.gitattributes`
fija LF para ambos JSON, evitando diferencias de hash entre Windows y Linux sin
cambiar su contenido analítico. Los hashes corresponden a bytes exactos, no a una
reserialización del JSON.

## Mantener los resultados de publicación

1. El equipo confirma la autorización para los dos JSON incluidos. Revisar cualquier
   cambio futuro de contenido y su alcance de redistribución antes de incorporarlo.
2. No ampliar las excepciones de
   `.gitignore`, ni añadir datasets originales, Excel, Parquet, CSV, credenciales
   u otros resultados.
3. Añadir una entrada por ruta exacta en `publication.json.results` con estos
   campo `sha256` (hash hexadecimal SHA-256 del archivo completo).
   Cada cambio de contenido requiere revisión y nuevo hash.
   En PowerShell: `Get-FileHash -Algorithm SHA256 <ruta>`; guardar el hash en minúsculas.
4. Revisar el PR antes de fusionarlo. Un JSON ausente, un hash incorrecto o un
   esquema incompatible detienen el build; no se regeneran datos durante el despliegue.

## Artefacto y rutas

`python -B src/dashboard/build-pages.py` construye `dist/dashboard-pages/`
desde una lista cerrada, sin copiar el repositorio ni directorios completos:

```text
index.html                         # entrada relativa a src/dashboard/
src/dashboard/index.html
src/dashboard/dashboard.css
src/dashboard/dashboard.js
src/dashboard/case-views.js
src/dashboard/favicon.svg
data/processed/rmove/incidencia_2025_06_05.json  # hash y esquema verificados
data/processed/rmove/incidencia_2025_02_07.json  # hash y esquema verificados
```

La entrada se conserva como fuente en `src/dashboard/pages-entry.html` y se
copia como `index.html` en la raíz del artefacto. Así `/R-MOVE/` abre
`/R-MOVE/src/dashboard/`. Las rutas `../../data/processed/rmove/...` de
`dashboard.js` resuelven dentro de `/R-MOVE/data/processed/rmove/`. CSS, scripts
y favicon son relativos al dashboard; no requieren dominio raíz ni un `base`
específico. El constructor comprueba estas referencias y rechaza enlaces locales
absolutos o destinos ausentes. No incluye README, scripts de empaquetado,
manifiesto, notebooks, análisis, `.git`, datasets ni otros resultados.

## Desplegar con GitHub Actions

En **Settings → Pages → Build and deployment → Source**, seleccionar **GitHub
Actions**. Configurar el entorno `github-pages` para permitir despliegues de
`main` y las protecciones/revisiones que requiera el repositorio. Véase la
[documentación oficial de GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

`.github/workflows/deploy-dashboard.yml` valida los pull requests sin publicar
artefactos. Tras fusionar en `main`, construye y sube únicamente
`dist/dashboard-pages/`; el job de despliegue recibe `pages: write` e
`id-token: write`. También permite ejecución manual desde `main`; desde otras
ramas solo valida y construye. No utiliza secretos ni ejecuta notebooks. Los
errores de integridad, esquema, rutas o lista de archivos detienen la subida y el despliegue.

La URL esperada es `https://martinafrisach.github.io/R-MOVE/` salvo configuración
de dominio distinta; usar como referencia la URL del entorno que devuelve Actions.
Este PR prepara la configuración y los resultados versionados; no activa Pages,
no hace merge ni ejecuta ningún despliegue. Subir cambios a la rama del PR solo
ejecuta las validaciones de `pull_request`, nunca el job de publicación.

## Validación

Desde la raíz, con Python 3.12+ y Node 22+:

```powershell
node --check src/dashboard/dashboard.js
node --check src/dashboard/case-views.js
python -B -m unittest discover -s src/dashboard -p test_pages.py -v
node src/dashboard/verify-results.cjs
python -B src/dashboard/build-pages.py --check
python -B src/dashboard/build-pages.py
python -m http.server 8000 --directory dist/dashboard-pages
```

Los dos comandos de compilación deben completarse con los resultados versionados.
La prueba del build usa los ocho archivos reales en un directorio temporal,
ejecutando todas las validaciones y verificando bytes y lista exacta de archivos,
sin publicar nada. La comprobación
Node ejecuta el JavaScript real con ambos JSON y un DOM mínimo, revisando hashes,
carga, indicadores, detalle, ranking, filtros y coordenadas. Usa el modo sin
Leaflet; no sustituye una prueba visual de mapa en navegador.
`--check` valida sin escribir. El constructor rechaza una salida existente para
no reutilizar archivos de una compilación anterior: revisar y retirar manualmente
`dist/dashboard-pages/` antes de reconstruir. `dist/` ya está ignorado por Git.

Tras construir, inspeccionar los ocho archivos del artefacto,
abrir `http://localhost:8000/` y comprobar la redirección, ambos casos, indicadores,
filtros, ranking y detalle. En las herramientas de red del navegador, confirmar
que ambos JSON, CSS, JS y favicon devuelven 200 sin salir del prefijo del sitio.
Repetir sobre la URL de Pages tras el despliegue. Leaflet se carga desde unpkg y
el mapa usa teselas de OpenStreetMap: requieren Internet y comprobar su atribución.
La validación automática de rutas y sintaxis no sustituye esta revisión visual.
