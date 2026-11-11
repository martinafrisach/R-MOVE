# Revisión de publicación del PR #1

## Evidencia remota

Revisados el [PR #1](https://github.com/martinafrisach/R-MOVE/pull/1) y la rama
`deploy/dashboard-pages`, tras actualizar su referencia desde `origin`.
Los dos JSON están incorporados en el
[commit c7c6a4b](https://github.com/martinafrisach/R-MOVE/commit/c7c6a4bcfbb6d9f743475b74add6bd005318b677).
Los hashes se calcularon sobre los bytes de `git show origin/deploy/dashboard-pages:<ruta>`:

| Archivo en `data/processed/rmove/` | Esquema | Municipios | Relaciones | SHA-256 |
| --- | --- | --- | --- | --- |
| `incidencia_2025_06_05.json` | 3 | 5 | 20 | `85052899df465ee9535361497f1bee06ee7890beceb317e4414625023e3a966d` |
| `incidencia_2025_02_07.json` | 3 | 5 | 18 | `4f5ba94ec2d7817e89caf40007cf028a27b19873038b14c8395cd705e139167e` |

El checkout Windows tenía CRLF, mientras los blobs remotos tienen LF. Se
normalizó el checkout a los bytes remotos tras comprobar que solo diferían los
saltos de línea. `.gitattributes` fija LF únicamente para estos dos archivos.
No se cambian los valores de los resultados.

## Confirmación del equipo y manifiesto

El equipo confirma en la solicitud que cuenta con autorización para publicar los
resultados derivados incluidos en los dos JSON. Por indicación del equipo se
retira la obligación técnica de completar `authorization`, `approved_by` y
`approved_on`: esos campos se eliminan de `publication.json`. No se inventan
referencias, identidades ni fechas de aprobación.

El manifiesto conserva `schema_version` y las dos rutas con sus hashes exactos.
El empaquetador comprueba integridad y compatibilidad; la autorización se mantiene
como confirmación del equipo documentada en el README, no como condición técnica
del build. No hay cambios en los datos ni en los notebooks.

## Validación y límites

- `node src/dashboard/verify-results.cjs` verifica los dos resultados contra el
  JavaScript real, incluidas fechas, esquema, referencias municipales,
  coordenadas, campos numéricos, hashes, carga, indicadores, detalle, ranking y
  filtros. No recalcula referencias analíticas. El mapa requiere revisión visual.
- Las pruebas Python comprueban las rutas del artefacto, rechazo de archivos
  ausentes, hashes ausentes o incorrectos, esquema incompatible y resultados ajenos
  a la lista. Un manifiesto con solo hashes permite el build. La prueba completa
  usa ocho archivos reales en una carpeta temporal, sin sustituir la preparación
  ni omitir validaciones; compara sus bytes y la lista exacta de archivos.
- La compilación completa con `build-pages.py` genera `dist/dashboard-pages/` con
  los ocho archivos previstos. `--check` valida sin escribir. No se publica el artefacto.
- `.gitignore` incluye solo las dos excepciones exactas y mantiene ignorados
  datasets originales, otros procesados, credenciales y tablas generadas.
- No se modifica `main`, no se hace merge y no se ejecuta ningún despliegue.
