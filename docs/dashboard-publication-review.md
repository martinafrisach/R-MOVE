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

## Autorización pendiente de documentar

El equipo confirma en la solicitud de revisión que dispone de autorización para
publicar estos resultados derivados. No se ha facilitado una referencia verificable
al permiso y su alcance para ambos archivos, ni la identidad de quien aprueba,
ni la fecha real de aprobación. En el momento de la revisión no había comentarios,
revisiones ni comentarios de código en el PR que aportasen esos datos.

Por tanto, `authorization`, `approved_by` y `approved_on` quedan en `null` para
ambos archivos en `publication.json`. No se infieren del autor ni de la fecha del
commit. El equipo debe aportar esos tres datos; la misma referencia puede cubrir
ambos JSON si su alcance lo establece. Este documento registra el bloqueo y
las comprobaciones; **no constituye una autorización**.

## Validación y límites

- `node src/dashboard/verify-results.cjs` verifica los dos resultados contra el
  JavaScript real, incluidas fechas, esquema, referencias municipales,
  coordenadas, campos numéricos, hashes, carga, indicadores, detalle, ranking y
  filtros. No recalcula referencias analíticas. El mapa requiere revisión visual.
- Las pruebas Python comprueban las rutas del artefacto, rechazo de archivos
  ausentes, permisos ausentes, hashes incorrectos y resultados ajenos a la lista.
  El copiador se prueba con ocho archivos reales en una carpeta temporal,
  reemplazando solo su fase previa de preparación; no genera una aprobación ni
  un artefacto autorizado. Se comparan sus bytes y la lista exacta de archivos.
- La compilación completa con `build-pages.py` debe bloquearse con los tres
  campos de autorización pendientes. La prueba del copiador no elimina ese bloqueo.
- `.gitignore` incluye solo las dos excepciones exactas y mantiene ignorados
  datasets originales, otros procesados, credenciales y tablas generadas.
- No se modifica `main`, no se hace merge y no se ejecuta ningún despliegue.
