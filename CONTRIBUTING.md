# Cómo trabajar en R-MOVE (equipo 202_E)

Guía para clonar el repo, tener los datos y trabajar en los notebooks y el Observatorio (dashboard) sin pisarnos.

## 1. Primera vez (una sola vez por persona)

```bash
git clone https://github.com/martinafrisach/R-MOVE.git
cd R-MOVE

python -m venv .venv
# Windows:
.venv\Scripts\activate
# Mac/Linux:
source .venv/bin/activate

pip install -r requirements.txt
python -m ipykernel install --user --name rmove --display-name "R-MOVE"
```

En Jupyter o VS Code, elegid el kernel **R-MOVE**. Recomendamos Python 3.12, la misma versión que usa GitHub.

## 2. Datos (no están en Git)

Los datos pesan unos 17 GB y algunos son de acceso restringido (Telefónica y la solicitud de información pública de Rodalies), así que **no se suben a GitHub**. En el repo solo están los resultados ligeros que lee el Observatorio.

1. Descargad `datos_rmove_AAAAMMDD.zip` de la carpeta compartida del equipo.
2. Descomprimidlo **en la raíz del repo**. Así se rellena la carpeta `data/` (`data/processed/...` y `data/raw/...`).
3. Comprobad qué podéis ejecutar:

   ```bash
   python scripts/datos.py comprobar
   ```

El paquete no incluye los CSV brutos de Telefónica (`data/raw/telefonica`, 16 GB). Solo hacen falta para los notebooks 01 y 04; los demás usan `M2.parquet`, que sí va en el paquete. Si alguien los necesita, pedídselos a Martina.

Para quien tenga los datos y quiera regenerar el paquete:

```bash
python scripts/datos.py empaquetar          # sin los CSV brutos de Telefónica
```

## 3. Qué hay en el repo

| Carpeta | Contenido |
|---|---|
| `notebooks/` | Análisis: 01–02 preparación y mediana, **03** M2 (clustering; la regresión como comprobación), 04 M3 barrios, 05 vulnerabilidad (motorización y renta) |
| `src/analysis/` | Funciones de apoyo del notebook 02 (catálogo de incidencias y mediana), con test |
| `src/dashboard-v2/` | **Observatorio**, el dashboard del proyecto (relato, ¿Y si…?, Mi municipio, Laboratorio). Se publica en GitHub Pages |
| `data/processed/rmove/` | Exportaciones de los notebooks. En Git solo van los JSON y parquet que usa el Observatorio |

## 4. Ver el Observatorio en local

Desde la **raíz** del repo:

```bash
python -m http.server 8000
```

- Observatorio: <http://localhost:8000/src/dashboard-v2/>

Funciona nada más clonar, sin el paquete de datos, porque sus JSON están en Git. El mapa necesita Internet (Leaflet).

Para regenerar el Observatorio después de cambiar resultados (notebook 03, celda B.8):

```bash
python src/dashboard-v2/build_observatorio.py
python src/dashboard-v2/build_pages.py --check   # lo mismo que comprueba GitHub
```

## 5. Flujo de trabajo con Git

`main` es la versión buena: cada push a `main` despliega el Observatorio en GitHub Pages. **No trabajéis directamente en `main`.**

```bash
git checkout main
git pull                               # siempre antes de empezar
git checkout -b nombre/tarea           # ej.: laia/m3-graficos, pau/observatorio-simulador

# ...trabajar...
git add <ficheros>
git commit -m "M3: gráfico de barrios en días de huelga"
git push -u origin nombre/tarea
```

Después, en GitHub, abrid un **Pull Request** hacia `main`. GitHub ejecuta automáticamente las comprobaciones del Observatorio. Si salen en verde y otra persona lo revisa, se hace *merge*.

Si mientras tanto alguien ha cambiado `main`:

```bash
git checkout main && git pull
git checkout nombre/tarea && git merge main
```

### Notebooks: evitar conflictos

Git no sabe mezclar dos versiones de un mismo `.ipynb`. Si dos personas lo editan a la vez, una de las dos pierde su trabajo.

- **Un notebook, una persona.** Avisad en el grupo antes de tocar un notebook que no es "vuestro".
- Para probar cosas, usad una copia vuestra (`notebooks/04_impacto_movilidad_barrios_laia.ipynb`) y pasad lo que funcione al original al final.
- Antes de hacer commit: *Kernel → Restart & Run All* (o *Clear All Outputs* si es muy pesado), para que el notebook guardado sea reproducible.
- Las copias de seguridad van en `notebooks/_backup/`, que no se sube.

### Si cambias resultados que lee el Observatorio

1. Ejecutad el notebook 03 entero (la última celda, B.8, exporta `dashboard_resultados.json`).
2. Regenerad el Observatorio: `python src/dashboard-v2/build_observatorio.py`.
3. Comprobad antes del push: `node --check src/dashboard-v2/observatorio.js` y `python src/dashboard-v2/build_pages.py --check`.
4. Subid `dashboard_resultados.json` y `observatorio/observatorio.json` en el mismo commit.

Si falta algún fichero o algún JSON no es válido, la comprobación de GitHub falla y no se despliega.

## 6. Nunca subir

- `data/raw/`, ni datos de Telefónica o de Rodalies (están en `.gitignore`; no uséis `git add -f`).
- `.env` ni claves de API.
- Ficheros de más de 50 MB.

Antes de cada commit, mirad qué vais a subir con `git status`.
