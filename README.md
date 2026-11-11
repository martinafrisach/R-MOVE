# R-MOVE

Dashboard estático de movilidad e incidencias. Los fuentes permanecen en
`src/dashboard/`; los notebooks y cálculos están en `notebooks/` y `src/analysis/`.

## Estado del despliegue: faltan los datos verificables de aprobación

El dashboard necesita estos dos resultados del Notebook 04:

- `data/processed/rmove/incidencia_2025_06_05.json`
- `data/processed/rmove/incidencia_2025_02_07.json`

Ambos están **versionados en el remoto** de `deploy/dashboard-pages`, incorporados
por el commit `c7c6a4bcfbb6d9f743475b74add6bd005318b677`. El equipo confirma que
tiene autorización para publicar los resultados derivados, pero no ha facilitado
la referencia verificable al permiso, la persona que aprueba ni la fecha real de
aprobación. La revisión del PR no encontró estos datos en comentarios ni revisiones.
Consulta las [evidencias de revisión](docs/dashboard-publication-review.md).

`src/dashboard/publication.json` contiene los hashes SHA-256 de los blobs remotos;
los tres campos pendientes permanecen en `null` hasta recibir datos verificables.
La compilación sigue bloqueada antes de generar o subir un artefacto. No se usa
la fecha del commit como fecha de aprobación ni su autor como aprobador.
No hay regeneración automática ni sustitución de ausencias por datos inventados.

`.gitignore` permite únicamente esos dos resultados dentro de los datos procesados;
el resto de resultados y los datasets originales siguen ignorados. `.gitattributes`
fija LF para ambos JSON, evitando diferencias de hash entre Windows y Linux sin
cambiar su contenido analítico. Los hashes corresponden a bytes exactos, no a una
reserialización del JSON.

## Autorizar resultados antes de publicar

1. Revisar los dos JSON completos, incluidas fichas documentales, series y
   campos de procedencia, para descartar información sensible y comprobar los
   derechos de redistribución de todas sus fuentes. Obtener permiso o licencia
   aplicable; el script registra esa decisión, no verifica jurídicamente su validez.
2. Los dos JSON ya están incorporados en este PR. No ampliar las excepciones de
   `.gitignore`, ni añadir datasets originales, Excel, Parquet, CSV, credenciales
   u otros resultados. Si el permiso no cubre los JSON
   completos, mantener el bloqueo y revisar el alcance en otro PR.
3. Añadir una entrada por ruta exacta en `publication.json.results` con estos
   campos: `authorization` (referencia verificable al permiso/licencia y su
   alcance público), `approved_by`, `approved_on` (fecha ISO) y `sha256` (hash
   hexadecimal SHA-256 del archivo completo). No usar textos provisionales como
   autorización. Cada cambio de contenido requiere revisión y nuevo hash.
   En PowerShell: `Get-FileHash -Algorithm SHA256 <ruta>`; guardar el hash en minúsculas.
4. Revisar ese PR antes de fusionarlo. Si faltan los archivos autorizados, el
   workflow debe seguir fallando: no desactivar el control para desplegar.

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
data/processed/rmove/incidencia_2025_06_05.json  # solo con autorización y hash
data/processed/rmove/incidencia_2025_02_07.json  # solo con autorización y hash
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
errores de autorización o datos detienen la subida y el despliegue.

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

Los dos comandos de compilación **deben fallar** mientras persista el bloqueo.
La prueba del copiador usa los ocho archivos reales en un directorio temporal,
sin pasar por la aprobación ni publicar nada: verifica bytes y lista exacta de
archivos, pero no equivale a una compilación autorizada completa. La comprobación
Node ejecuta el JavaScript real con ambos JSON y un DOM mínimo, revisando hashes,
carga, indicadores, detalle, ranking, filtros y coordenadas. Usa el modo sin
Leaflet; no sustituye una prueba visual de mapa en navegador.
`--check` valida sin escribir. El constructor rechaza una salida existente para
no reutilizar archivos de una compilación anterior: revisar y retirar manualmente
`dist/dashboard-pages/` antes de reconstruir. `dist/` ya está ignorado por Git.

Cuando haya resultados autorizados, inspeccionar los ocho archivos del artefacto,
abrir `http://localhost:8000/` y comprobar la redirección, ambos casos, indicadores,
filtros, ranking y detalle. En las herramientas de red del navegador, confirmar
que ambos JSON, CSS, JS y favicon devuelven 200 sin salir del prefijo del sitio.
Repetir sobre la URL de Pages tras el despliegue. Leaflet se carga desde unpkg y
el mapa usa teselas de OpenStreetMap: requieren Internet y comprobar su atribución.
La validación automática de rutas y sintaxis no sustituye esta revisión visual.
