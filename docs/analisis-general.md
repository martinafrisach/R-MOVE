# Motor de análisis general

## Primera entrega: auditoría y contexto diario

El motor procesa la **muestra de incidencias documentadas**, no un censo de
incidencias existentes. No interpreta las fechas sin registro como normalidad
garantizada ni convierte diferencias descriptivas en efectos de Rodalies.

Desde la raíz:

```powershell
.venv/Scripts/python.exe -B -m src.analysis.rmove_general --config src/analysis/general_config.json
.venv/Scripts/python.exe -B -m unittest src.analysis.test_rmove_general -v
```

La configuración declara el ámbito temporal del catálogo. La fecha de la primera
o última noticia no se usa para deducir ese ámbito. Actualmente se declara
2023–agosto de 2025, tras encontrar el catálogo ampliado en el Excel local. Al incorporar un
catálogo ampliado deben actualizarse la entrada y sus límites declarados.
La hoja actual usa `incident_id`, `date` y `line`; los notebooks 02, 03 y 04
comparten `cargar_catalogo` y las fichas de casos usan el mismo esquema.
Se admiten columnas que mezclan fechas con números de serie Excel: estos se
convierten desde el origen de Excel, sin interpretarlos como nanosegundos Unix.

## Salidas locales

En `data/processed/rmove/general/`, ignorado por Git:

- `auditoria.json`: configuración, huella del Excel y del motor, metadatos de
  movilidad, cobertura, estados y limitaciones. El Parquet se identifica por ruta,
  tamaño y fecha de modificación, sin pretender que estos sustituyan un hash.
- `catalogo_normalizado.parquet`: todos los campos documentales, identidad validada,
  listas de líneas y exposición territorial pendiente.
- `cobertura_diaria.parquet`: viajes intermunicipales agregados, registros,
  relaciones observadas y registros inválidos. No se imputan días ausentes.
- `contexto_fechas_documentadas.parquet`: comparación agregada para cada fecha
  documentada, sin contar varias noticias del mismo día como observaciones
  temporales independientes.
- `controles.parquet`: fechas exactas utilizadas en cada comparación.

Se reutiliza la mediana retrospectiva del mismo día semanal, ventana de ±42 días,
mínimo tres controles, excluyendo festivos de Cataluña, fines de semana, julio,
agosto y todas las fechas documentadas en el catálogo. Se mantienen los estados
no elegibles. Un día con viajes negativos o nulos en sus registros queda sin
total válido, en lugar de producir una falsa caída por suma incompleta.

La ejecución sobre el catálogo vigente contiene 357 registros en 198 fechas,
entre el 18 de enero de 2023 y el 28 de agosto de 2025: 126 fechas con comparación
válida y 72 fuera del calendario acordado. Los recuentos se verifican en las
auditorías de la ejecución vigente; no representan efectos causales.

## Segunda entrega: correspondencias territoriales

```powershell
.venv/Scripts/python.exe -B -m src.analysis.rmove_territory --config src/analysis/general_config.json
.venv/Scripts/python.exe -B -m unittest src.analysis.test_rmove_general src.analysis.test_rmove_territory -v
```

La configuración identifica dos descargas oficiales conservadas localmente en
`data/raw/rodalies/`: el [listado de estaciones de Renfe](https://datos.gob.es/es/catalogo/ea0003337-estaciones-listado-completo1)
y el [GTFS de Cercanías y Rodalies](https://data.renfe.com/dataset/horarios-cercanias).
El programa no descarga ni actualiza fuentes durante la ejecución. Si faltan,
la ejecución falla; las rutas, URLs y hashes quedan registrados en la auditoría.
Se ha localizado además un [mapa oficial de diciembre de 2024](https://www.renfe.com/content/dam/renfe/es/Viajeros/Secciones/Cercanias/Mapas/2024/mapa_general_servicio_rodalies_de_catalunya_12_24.pdf)
para contrastar la red histórica. Ese mapa todavía no se ha incorporado como
tabla histórica validada.

El GTFS descargado describe servicios actuales de 2026. Sus conexiones no se
asignan automáticamente a episodios de 2023–2025. El cruce extrae estaciones
servidas por cada línea, no el orden de todos los tramos ni una oferta histórica.
El listado de estaciones también es actual y no incluye todas las estaciones
del GTFS.

Las nuevas salidas son:

- `municipios_movilidad.parquet`: códigos y nombres de los 310 municipios
  presentes en M2 durante el periodo configurado.
- `red_referencia_actual.parquet`: estaciones y líneas actuales con propuestas
  de correspondencia municipal. Conserva varias propuestas si el nombre es
  ambiguo y los casos sin correspondencia en M2.
- `candidatos_territoriales.parquet`: menciones locales, conexiones por línea
  actual y posibles conexiones por transbordo compartiendo estación. Ninguna
  propuesta significa exposición confirmada.
- `revision_territorial.parquet` y `revision_territorial.csv`: una fila por registro,
  texto documental, enlace original, municipios propuestos y motivos pendientes.
- `exposicion_revisada.parquet`: asignaciones respaldadas por revisión explícita.
  Inicialmente está vacío; la ausencia de asignación significa desconocida.
- `auditoria_territorial.json`: cobertura, periodo de los servicios GTFS,
  identificadores de fuentes, líneas sin referencia y limitaciones.

La normalización de topónimos admite acentos y artículos desplazados; exige
palabras completas y prioriza nombres largos frente a subcadenas. Estas reglas
sirven para proponer correspondencias, no para determinar ubicación física.
La población asociada por Renfe a una estación puede diferir del municipio en
el que está situada: la revisión geográfica sigue siendo necesaria.

Para incorporar asignaciones revisadas, añadir `revision_territorial` a la
configuración con la ruta de un JSON local que contenga una lista como esta
(esquema ilustrativo, no una asignación real):

```json
[
  {
    "incident_id": "IDENTIFICADOR_DEL_CATALOGO",
    "codigo": "CODIGO_MUNICIPAL_M2",
    "categoria": "directa",
    "fuente": "Documento que respalda la asignación",
    "criterio": "Tramo y alcance revisados",
    "revisado_por": "Persona o proceso responsable",
    "fecha_revision": "2026-11-11",
    "valido_desde": "2023-01-01",
    "valido_hasta": "2024-12-31"
  }
]
```

Se validan identidades, duplicados, categorías (`directa`, `indirecta`, `baja`,
`desconocida`), trazabilidad y que la evidencia cubra la fecha del registro.
Una conexión por transbordo sirve para plantear una hipótesis de exposición
indirecta; no demuestra un efecto dominó. Los municipios sin referencia no se
convierten en controles de baja exposición.

## Validación territorial del usuario y cálculo municipal

El usuario validó explícitamente las asignaciones territoriales en la conversación.
Se han materializado 21.752 asignaciones en
`asignaciones_validadas_usuario.json`: 7.769 directas y 13.983 indirectas, para
351 registros documentados. En el reemplazo completo se recalculan con las
reglas previamente aceptadas y se identifica esa procedencia. No se presenta
como una nueva revisión manual ni una comprobación histórica externa del motor.

La prioridad acordada al registrar la validación es directa para propuestas de
localización o conexión con la línea; indirecta para propuestas de solo
transbordo. Si faltan propuestas, la exposición permanece desconocida. No se
crean municipios de baja exposición por omisión. La validez de cada fila se
limita a la fecha del registro correspondiente.

`validacion_usuario.json` conserva hashes del catálogo, propuestas y asignaciones,
responsable, fecha y criterio. `general_config.json` apunta a esa revisión local.
Si se traslada el código a otra máquina hay que trasladar también ese JSON
local, que está ignorado por Git; no se regenera una validación por defecto.

El módulo `rmove_validate_territory` materializa una validación explícita y rechaza
sobrescribir una anterior. No debe ejecutarse como parte automática del análisis.

```powershell
.venv/Scripts/python.exe -B -m src.analysis.rmove_municipal --config src/analysis/general_config.json
.venv/Scripts/python.exe -B -m unittest src.analysis.test_rmove_general src.analysis.test_rmove_territory src.analysis.test_rmove_municipal -v
```

Este cálculo agrega por municipio y día, separando entradas y salidas e
ignorando desplazamientos intramunicipales. No se suman entradas y salidas para
contar viajes únicos. Para cada fecha documentada produce referencia mediana,
variación, diferencia, número y fechas exactas de controles, estado y cobertura
de OD. Un total municipal con registros negativos o nulos queda inválido, no se
completa con ceros. La ausencia de una OD en un día no se puede interpretar
como cero viajes; `n_od` permite revisar cambios de composición.

En fechas con varios registros se conserva un único resultado por municipio y
sentido. Si cualquier registro tiene asignación directa, prevalece directa;
en su ausencia prevalece indirecta. Solo se permite baja si está respaldada para
todos los registros de esa fecha. Las asignaciones no duplican los viajes.

Salidas adicionales:

- `movilidad_municipal_diaria.parquet`: totales y cobertura municipal diaria.
- `cambios_municipales.parquet`: una fila por fecha documentada, municipio y
  sentido, con referencia, controles y exposición.
- `resumen_municipal_descriptivo.csv`: medianas de cambio y magnitud absoluta
  por sentido y exposición, ponderando cada municipio-fecha por igual.
- `auditoria_municipal.json`: cobertura de resultados, configuración, hashes y
  límites interpretativos.

El resumen todavía no ajusta composición de los grupos, simultaneidad causal,
variabilidad habitual ni dependencia entre observaciones. No responde por sí
solo si los cambios son sistemáticos o mayores a causa de la incidencia.

La ejecución municipal vigente produjo 122.760 filas (310 municipios × 198
fechas × 2 sentidos): 74.672 comparaciones válidas, 44.640 fuera del calendario,
2.386 con referencia cero, 1.002 sin observación válida y 60 con controles
insuficientes. Se contrastó una fila de cada estado con el motor original de
indicadores, verificando estado, número de controles y fórmula cuando procede.
Las ocho pruebas anteriores y las cinco nuevas de cálculo municipal cubren
normalización, límites temporales, validación territorial, agregación, ausencias
y asignaciones simultáneas. La prueba de fichas se ha adaptado al esquema
actual del Excel y ahora pasa.

## Contraste con placebos locales y recurrencia exploratoria

```powershell
.venv/Scripts/python.exe -B -m src.analysis.rmove_contrast --config src/analysis/general_config.json
.venv/Scripts/python.exe -B -m unittest src.analysis.test_rmove_contrast -v
```

Reutiliza las dos tablas municipales, sin volver a recorrer M2. Comprueba que el
catálogo, la revisión territorial y la configuración temporal corresponden a la
auditoría municipal. Las entradas exactas y versiones de NumPy, pandas y DuckDB
se registran en `auditoria_contraste.json`. Se añaden las opciones a `contraste`
en la configuración; la semilla hace reproducible el remuestreo.

1. Calcula todas las fechas placebo elegibles sin incidencia documentada dentro
   del ámbito del catálogo. Excluye festivos, fines de semana y julio/agosto.
   Cada placebo utiliza su propia mediana de referencia del mismo día semanal,
   ±42 días, excluyéndose a sí mismo y todas las fechas documentadas.
2. Para cada municipio, sentido y fecha documentada busca placebos del mismo día
   semanal a ±42 días. Exige al menos cinco válidos. La configuración principal
   descarta comparaciones cuya cantidad de OD difiera más del 20 % de su mediana
   de referencia, tanto para la fecha documentada como para los placebos.
3. Calcula exceso de magnitud en puntos porcentuales: valor absoluto del cambio
   durante la fecha documentada menos la mediana de magnitudes placebo. También
   calcula cambio centrado, conservando el signo.
4. Resume con la mediana municipal de cada grupo-fecha (mínimo tres municipios)
   y después la media entre fechas. Compara directa menos indirecta solo en
   fechas comunes. Los municipios desconocidos no son controles territoriales.
5. Estima intervalos exploratorios del 95 % mediante 2.000 réplicas de bloques
   calendarios no solapados de 84 días, anclados al 2 de enero de 2023. Se
   remuestrean bloques enteros; cada fecha contribuye una cifra por grupo. Se
   requieren ocho bloques observados. Los IC son condicionales a las referencias
   ya calculadas, aproximados, no simultáneos y sin ajuste por multiplicidad.

El [remuestreo temporal por bloques](https://users.ssc.wisc.edu/~behansen/718/HardleHorowitzKreiss.pdf)
permite considerar dependencia temporal; no garantiza independencia entre bloques
ni resuelve selección documental, confusión o incertidumbre en la exposición.
El motor utiliza NumPy, sin instalar otra biblioteca de bootstrap.

La recurrencia usa un umbral de cuantil empírico 0,9 de la magnitud placebo,
con cuantiles discretos y superación estricta. No es un test con tasa nominal
del 10 % ni un p-valor: el número de placebos es pequeño, comparten referencias
y no son intercambiables por diseño experimental. La columna
`cola_empirica_descriptiva` tampoco se interpreta como p-valor. No se declaran
municipios significativos ni se corrigen pseudotests municipales.
Se informa la frecuencia de superaciones, el número de fechas y meses y si
hay al menos diez fechas y tres meses para describir repetición. Las fechas
distintas no se presentan como episodios independientes.

La sensibilidad incluye mínimos de 3/5/8 placebos, cobertura de OD del 10/20 % o
sin filtro, ventanas locales de 28/42/56 días y bloques de 28/56/84 días. Los
valores exactos se guardan en cada fila. Las ventanas locales cambian los
placebos vecinos; conservan las medianas de referencia calculadas con ±42 días.

Salidas adicionales:

- `placebos_municipales.parquet`: resultados y controles de cada fecha placebo.
- `contraste_municipal.parquet`: resultados originales, placebos exactos,
  magnitudes habituales, excesos y estados de suficiencia/cobertura.
- `contraste_grupos_por_fecha.parquet`: una cifra por fecha, grupo y sentido.
- `contraste_general.csv`: estimaciones, intervalos, número de fechas y bloques.
- `sensibilidad_contraste.csv`: los escenarios y su cobertura efectiva.
- `recurrencia_municipal_descriptiva.csv`: repetición por municipio y exposición.
- `contraste_lineas_por_fecha.parquet`: resultados por línea documentada y fecha
  entre municipios con asignación directa al registro. No reconstruye corredores.
- `auditoria_contraste.json` e `informe_contraste.md`: trazabilidad y lectura de
  resultados con tablas y límites interpretativos.

La ejecución vigente usa 409 fechas placebo candidatas y obtiene 62.697
comparaciones municipales calibradas válidas; 15.300 son de exposición directa
o indirecta. El resto de comparaciones válidas conserva exposición desconocida
y no entra en el contraste entre grupos.

## Sustituir el Excel y recalcular sin conservar resultados anteriores

Con el Excel cerrado y guardado en la ruta configurada:

```powershell
.venv/Scripts/python.exe -B -m src.analysis.rmove_rebuild --reemplazar --reglas-territoriales-aceptadas
```

Este comando valida las entradas, el esquema y el periodo antes de eliminar
`data/processed/rmove/general/`. Comprueba la ruta absoluta exacta y rechaza
enlaces, junctions o entradas dentro de la salida. No crea copia, historial ni
carpeta de respaldo. Elimina todas las salidas generales anteriores, incluidas
asignaciones y validaciones, y ejecuta auditoría general, correspondencias
territoriales, asignaciones por reglas aceptadas, cálculo municipal y contraste.

Se requiere haber aceptado las reglas territoriales. La nueva validación se
identifica como regeneración por reglas, no como una revisión manual nueva del
contenido del Excel. Al cambiar las reglas hay que revisarlas antes de usar esa
opción. La configuración se actualiza para apuntar solo a la revisión nueva.

`ejecucion_actual.json` contiene el estado de la única ejecución actual. Si una
etapa falla, queda marcada como fallida, sin recuperar resultados antiguos. Se
comprueba que Excel y referencias territoriales no cambien durante el cálculo.

El reemplazo no modifica movilidad original, referencias ferroviarias,
notebooks ni exportaciones de casos del notebook 04. Estas últimas se deben
regenerar desde el nuevo Excel antes de utilizarlas junto con el análisis
general. Mientras se ejecuta el reemplazo, evitar exportaciones concurrentes
del notebook; su edición sí puede continuar.

## Revisión de casos, influencia y dashboard

Después de ejecutar el notebook 04 con el mismo Excel:

```powershell
.venv/Scripts/python.exe -B -m src.analysis.rmove_review
```

La revisión lee `CASOS` con AST sin ejecutar el notebook. Contrasta identificador,
ficha, fecha, ámbito y municipios de cada JSON con su configuración y el Excel.
Recalcula todas sus OD contra M2 y compara valores, medianas, porcentajes,
diferencias, identidad y valores de controles del JSON y CSV.
La selección actual contiene cinco casos y 425 relaciones, todas verificadas.

La influencia se calcula retirando una fecha cada vez. La sensibilidad conjunta
retira las 1, 3 y 5 fechas con mayor valor absoluto del exceso de magnitud de
cualquier grupo y sentido, y también omite un año cada vez. La misma fecha se
retira de todos los grupos. La selección por resultado es solo sensibilidad;
no se interpreta como corrección causal ni como una nueva prueba confirmatoria.

Se generan `validacion_casos.json`, `influencia_fechas.csv`, `fechas_extremas.csv`,
`robustez_fechas_extremas.csv`, `conclusiones_generales.md` y
`dashboard_general.json` en la salida general. Solo el último se incluye en el
artefacto web, junto con los cinco JSON de casos expresamente permitidos.

El análisis principal tiene exceso de magnitud positivo en ambos grupos y
sentidos, pero los cuatro intervalos incluyen cero al retirar las cinco fechas
extremas. Por ello se presenta como asociación exploratoria sensible a fechas
extremas. No se afirma diferencia sistemática entre directa e indirecta ni
efecto dominó. Los municipios recurrentes son candidatos descriptivos.

El dashboard abre en la vista general y carga los casos bajo demanda. Incluye
gráficos de intervalos, tabla de recorte de fechas, recurrencia y acceso a los
cinco casos. Las pruebas Node cubren ambas vistas; la comprobación visual local
incluye escritorio, móvil de 390 px y mapa de casos. La construcción verifica
los hashes y que la exportación general apunte a los mismos casos.

## Trabajo restante

1. Revisar duraciones y registros relacionados para identificar episodios y días
   afectados completos. Actualmente solo se excluyen las fechas registradas.
2. Validar el alcance territorial de M2 y obtener correspondencias históricas
   estación–municipio–línea–tramo. El catálogo incluye varias provincias.
3. Definir un grupo de baja exposición respaldado territorialmente; no utilizar
   municipios desconocidos como controles. Incorporar episodios completos.
4. Agregar OD mediante DuckDB y calcular referencias con criterios históricos de
   suficiencia que no dependan del cambio observado durante la incidencia.
5. Ampliar los contrastes exploratorios ya disponibles con ajuste de factores
   compartidos, revisión de episodios y comparación por corredores validados.
6. Exportar resultados generales y casos con el mismo contrato de datos.

El motor permite examinar asociaciones y recurrencia descriptiva; no atribuye
causalidad ni confirma efecto dominó. El dashboard y sus resultados de casos
se actualizan por separado.
