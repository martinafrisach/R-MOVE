# Cómo trabajar en R-MOVE (equipo 202_E)

Guía para clonar el repo, tener los datos y trabajar en los notebooks y los dashboards sin pisarnos.

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

Si vais a descargar GTFS de Transitland, copiad `.env.example` como `.env` y poned vuestra propia clave. El fichero `.env` no se sube nunca.

## 2. Datos (no están en Git)

Los datos pesan unos 17 GB y algunos son de acceso restringido (Telefónica y la solicitud de información pública de Rodalies), así que **no se suben a GitHub**. En el repo solo están los resultados ligeros que leen los dashboards.

1. Descargad `datos_rmove_AAAAMMDD.zip` de la carpeta compartida del equipo.
2. Descomprimidlo **en la raíz del repo**. Así se rellena la carpeta `data/` (`data/processed/...` y `data/raw/...`).
3. Comprobad qué podéis ejecutar:

   ```bash
   python scripts/datos.py comprobar
   ```

El paquete no incluye los CSV brutos de Telefónica (`data/raw/telefonica`, 16 GB). Solo hacen falta para los notebooks 01 y 04.1; los demás usan `M2.parquet`, que sí va en el paquete. Si alguien los necesita, pedídselos a Martina.

Para quien tenga los datos y quiera regenerar el paquete:

```bash
python scripts/datos.py empaquetar          # sin los CSV brutos de Telefónica
```

## 3. Qué hay en el repo

| Carpeta | Contenido |
|---|---|
| `notebooks/` | Análisis: 01–02 preparación y mediana, **04 v2** M2 (clustering + regresión), 04.1 M3 barrios, 05 tráfico (M4) |
| `src/analysis/` | Motor Python del análisis general (con tests) |
| `src/dashboard/` | Dashboard clásico. Se publica en GitHub Pages |
| `src/dashboard-v2/` | Observatorio (relato, ¿Y si…?, Mi municipio, Laboratorio) |
| `data/processed/rmove/` | Exportaciones de los notebooks. En Git solo van los JSON y parquet que usan los dashboards |
| `docs/` | Documentación del motor y de la publicación |

## 4. Ver los dashboards en local

Desde la **raíz** del repo:

```bash
python -m http.server 8000
```

- Clásico: <http://localhost:8000/src/dashboard/>
- Observatorio: <http://localhost:8000/src/dashboard-v2/>

Funcionan nada más clonar, sin el paquete de datos, porque sus JSON están en Git. El mapa necesita Internet (Leaflet).

Para regenerar el Observatorio después de cambiar resultados de M2:

```bash
python src/dashboard-v2/build_observatorio.py
```

## 5. Flujo de trabajo con Git

`main` es la versión buena: cada push a `main` despliega el dashboard en GitHub Pages. **No trabajéis directamente en `main`.**

```bash
git checkout main
git pull                               # siempre antes de empezar
git checkout -b nombre/tarea           # ej.: laia/m4-graficos, pau/observatorio-simulador

# ...trabajar...
git add <ficheros>
git commit -m "M4: gráfico de tráfico en días de huelga"
git push -u origin nombre/tarea
```

Después, en GitHub, abrid un **Pull Request** hacia `main`. GitHub ejecuta automáticamente las comprobaciones del dashboard. Si salen en verde y otra persona lo revisa, se hace *merge*.

Si mientras tanto alguien ha cambiado `main`:

```bash
git checkout main && git pull
git checkout nombre/tarea && git merge main
```

### Notebooks: evitar conflictos

Git no sabe mezclar dos versiones de un mismo `.ipynb`. Si dos personas lo editan a la vez, una de las dos pierde su trabajo.

- **Un notebook, una persona.** Avisad en el grupo antes de tocar un notebook que no es "vuestro".
- Para probar cosas, usad una copia vuestra (`notebooks/05_analisi_trafic_laia.ipynb`) y pasad lo que funcione al original al final.
- Antes de hacer commit: *Kernel → Restart & Run All* (o *Clear All Outputs* si es muy pesado), para que el notebook guardado sea reproducible.
- Las copias de seguridad van en `notebooks/_backup/`, que no se sube.

### Si cambias resultados que lee el dashboard clásico

El dashboard verifica el SHA-256 de cada JSON que publica (`src/dashboard/publication.json`). Si volvéis a exportar `dashboard_resultados.json`, `dashboard_general.json` o un `incidencia_*.json`:

1. Copiad el hash que imprime la celda de exportación (o `python -c "import hashlib;print(hashlib.sha256(open('RUTA','rb').read()).hexdigest())"`).
2. Actualizadlo en `src/dashboard/publication.json`.
3. Comprobad que todo pasa antes del push:

```bash
python -B -m unittest discover -s src/dashboard -p test_pages.py
node src/dashboard/verify-results.cjs
node src/dashboard/verify-overview.cjs
node src/dashboard/verify-conclusions.cjs
```

Si no se actualiza el hash, la comprobación de GitHub falla y no se despliega el dashboard.

## 6. Nunca subir

- `data/raw/`, ni datos de Telefónica o de Rodalies (están en `.gitignore`; no uséis `git add -f`).
- `.env` ni claves de API.
- Ficheros de más de 50 MB.

Antes de cada commit, mirad qué vais a subir con `git status`.
