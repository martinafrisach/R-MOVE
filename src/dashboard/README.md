# Dashboard R-MOVE

Dos vistas sobre resultados del motor Python y el notebook 04:

- **Análisis general:** preguntas y conclusiones, cobertura documental, magnitud entre grupos, intervalos exploratorios, recorte de fechas extremas y recurrencia descriptiva. Filtros de entradas/salidas y exposición.
- **Estudio de casos:** cinco casos seleccionados, mapa y relaciones OD, detalle de viajes y mediana, filtros municipales y ranking.

`overview.js` lee `data/processed/rmove/general/dashboard_general.json`. `dashboard.js` carga cada caso bajo demanda. `case-views.js` presenta el detalle. Las rutas relativas funcionan bajo `/R-MOVE/`.

Desde la raíz, servir con `python -m http.server 8000` y abrir `http://localhost:8000/src/dashboard/`. Enlace directo a casos: `?view=cases&date=2025-03-17`.

Los resultados generales y de casos deben corresponder al mismo Excel. `python -m src.analysis.rmove_review` verifica las 425 relaciones contra M2, analiza influencia de fechas y genera la exportación general. Al regenerar resultados, actualizar sus hashes en `publication.json` tras revisarlos.

Las conclusiones se limitan a incidencias documentadas. Los municipios desconocidos no son controles de baja exposición. La recurrencia no es un ranking de significación y los intervalos no establecen causalidad.

Consulta el [README principal](../../README.md) para pruebas y empaquetado.

El mapa incluye una capa independiente de Rodalies: R1, R2, R2 Nord, R2 Sud,
R3, R4, R7 y R8, con 124 estaciones, selector de línea, visibilidad, encuadre
y etiquetas desde zoom 12. Las relaciones OD conservan su significado municipal.
`railway.js` carga `railway-network.geojson` localmente, sin API ferroviaria en vivo.

Cabeceras, secuencias y colores de referencia: mapa oficial Renfe 12/2024.
Los colores se convirtieron desde el perfil del PDF a sRGB; no se utiliza el
color verde erróneo de R7 del GTFS. Coordenadas y shapes: GTFS Renfe descargado
el 11/11/2026 (CC BY 4.0). La Florida (77003) corrige una confusión de coordenadas
con Riera de Caldes mediante la ficha de estación de Renfe. Fuentes, hash del
GTFS y limitaciones figuran en los metadatos y en el desplegable bajo el mapa.
Esta referencia no reconstruye infraestructura ni servicio histórico exacto,
y tampoco valida la red del caso de 2023.

Para regenerar con un ZIP GTFS revisado: `python scripts/build-railway.py /ruta/al/gtfs.zip`.
Revisar las coordenadas y las secuencias antes de sustituir la cartografía.
Comprobar interacciones: `node src/dashboard/verify-railway.cjs`.

Las variaciones OD se representan sobre las aristas de la red ferroviaria,
sustituyendo las curvas entre centroides municipales. El selector «Relación OD»
permite consultar todas las relaciones filtradas. Al seleccionar una, se resalta
el recorrido completo y todas las estaciones intermedias; la línea gruesa es roja y las rayas interiores son azules para menos viajes
y naranjas para más viajes. El resto de la red conserva los colores oficiales. Sin una
relación activa, cada arista muestra la mayor variación absoluta de las relaciones
filtradas que pasan por ella; los porcentajes nunca se suman. El recorrido favorece
las líneas documentadas y penaliza los transbordos. Es una referencia visual, no
una estimación de pasajeros o del servicio disponible el día de la incidencia.

El motor es independiente de fechas y funciona con los casos que se incorporen
al flujo habitual de exportación y publicación. El tramo documentado se resuelve
mediante sus nombres de estaciones y líneas, sin una lista de incidencias por
fecha. Las localizaciones puntuales se dibujan como puntos; los ámbitos generales
o los nombres no resueltos no generan tramos inventados.

Para municipios nuevos, se buscan nombres completos coincidentes con estaciones
de la red. En nombres ambiguos o distintos, el JSON del municipio puede aportar
`"estaciones_renfe": ["71701"]` (por ejemplo, Sitges). Los casos existentes
conservan asociaciones explícitas revisadas por código municipal. La incidencia
puede aportar también `incidencia_documentada.estaciones_renfe` con uno o dos IDs
para situar con precisión su punto o extremos. No hace falta modificar el motor.
Las estaciones fuera de la red cargada requieren ampliar primero la cartografía;
si falta una correspondencia, el mapa lo indica en lugar de usar una recta.

El fondo del mapa se muestra atenuado. Las vías tienen contorno blanco, mayor
grosor, paradas más visibles y distintivos de línea sobre el trayecto seleccionado.

Cuando varias líneas comparten dos estaciones consecutivas, se dibujan en
carriles paralelos separados por 12 píxeles. El desplazamiento es solo visual,
se recalcula con el zoom y converge en la posición real de las estaciones.
Entre paradas, los tramos compartidos son casi rectos y paralelos, con enlaces
cortos en los extremos. Esta simplificación visual no cambia el grafo de rutas.
El tramo resaltado sigue el carril de su línea. Al filtrar una única línea,
se muestra su geometría original sin desplazamiento.

La entrada sin parámetros abre un panel de incidencias inspirado en un tablero
ferroviario: fecha, causa/título, tramo y líneas afectadas. Lee las mismas rutas
CASES que el dashboard, ordena de más reciente a más antigua y permite buscar
por título, fecha, línea o estación. Cada fila abre su caso; «Volver al listado»
regresa manteniendo la búsqueda. Los enlaces `?view=cases&date=...` siguen
abriendo el caso directamente y `?view=general` abre el análisis general.
La navegación se guarda en el historial del navegador. El panel tiene carga y
reintento propios, independientes de los resultados del análisis general.
