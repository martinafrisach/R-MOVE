# Dashboard R-MOVE · Mediana de días comparables

Dashboard existente en HTML/CSS/JavaScript y Leaflet. Conserva el diseño, mapa, navegación por las 18 líneas aproximadas, selección de municipios, sentidos y relaciones. La referencia activa es la mediana de viajes de días del mismo día semanal.

## Ejecutar

Desde la raíz del repositorio:

```powershell
python -m http.server 8000
```

Abrir http://localhost:8000/src/dashboard/ y recargar con Ctrl+F5.

El JSON se lee desde `../../data/processed/rmove/incidencia_2025_06_05.json`: no abrir con `file://` ni servir únicamente `src/dashboard`. No requiere compilación. Leaflet se carga desde unpkg; si no está disponible, los datos siguen accesibles en tabla y gráficos.

## Datos e interpretación

El Notebook 04 genera dos JSON de esquema 3: junio, con 20 relaciones del corredor sur, y febrero, con 18 relaciones R1/Maresme. Cada exportación contiene observados, mediana, variación porcentual, P25/P75 de **viajes**, fechas de controles, ficha del Excel, suficiencia, contexto provincial, series reales, robustez y conclusiones descriptivas.

Ámbito: lunes a viernes, sin festivos oficiales de Cataluña y excluyendo julio/agosto tanto de objetivos como de controles. Mismo día semanal en ±42 días, sin el objetivo ni fechas del Excel; al menos tres controles. Es una comparación retrospectiva: puede usar observaciones posteriores. El Notebook 02 evalúa por separado referencias exclusivamente anteriores.

Julio/agosto es la exclusión de verano acordada; no equivale a todas las vacaciones escolares ni a festivos municipales. Las fechas sin registro ferroviario pueden presentar otras perturbaciones o problemas de cobertura.

El ejemplo Gavà → Viladecans utiliza 8 controles: 2.834 observados frente a mediana 3.162, variación −10,37 %. Barcelona → Castelldefels utiliza mediana 15.787 y muestra −6,54 %. Los días de referencia cumplen las exclusiones de calendario indicadas.

El rango P25–P75 es descriptivo, no una prueba de significación. Las diferencias no se atribuyen causalmente a Rodalies. El selector contiene únicamente los dos casos exportados y carga su propio catálogo municipal, documentación y resultados.

Febrero corresponde a Y25-002, fallo de infraestructura/señalización del túnel Barcelona Sants–Plaça de Catalunya, con afectación de varias líneas. Se conserva la descripción y las cautelas reales del Excel. Las cinco poblaciones del ámbito son Barcelona, Mataró, Premià de Mar, El Masnou y Arenys de Mar. El Masnou ↔ Arenys no supera el volumen medio mínimo de 2024 y se muestra explícitamente en la tabla de disponibilidad. No se presenta como ausencia de datos.

## Explorar

La vista inicial contiene solo nodos. Elegir un municipio muestra únicamente sus relaciones, filtrables por salidas/llegadas/ambos. Las barras se ordenan por magnitud de la variación porcentual; mapa, lista, tabla y panel coordinan su selección. Las conexiones recíprocas usan curvas separadas. «Volver a la vista general» elimina conexiones y selección.

El panel presenta el porcentaje y los viajes comparados. Un desplegable permite consultar distribución y fechas de control. Los gráficos comparan observado/mediana, rango de viajes y evolución de la relación seleccionada (±21 días, con ausencias como huecos). La sensibilidad muestra controles anteriores/retrospectivos y ventanas de 28/42/56 días. El contexto provincial incluye viajes, registros, OD disponibles, series del mismo día semanal y tabla de controles. Las conclusiones y exclusiones se actualizan con el caso. Si falta una referencia válida se muestra su estado, nunca un cero ficticio.

Las líneas ferroviarias son contexto aproximado heredado, no GTFS validado ni una asignación de cada relación OD a un servicio. Las conexiones OD representan movilidad municipal, no recorridos de tren.

## Fondo cartográfico

Fondo opcional, desactivado inicialmente: `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, con atribución visible. El mapa OD funciona sin teselas. Ante un error se retira la capa sin reintentos automáticos.

Un 403 requiere examinar respuesta y encabezados del navegador: no puede atribuirse a una causa sin reproducirlo. Servir por HTTP conserva un origen adecuado para el Referer. No se alteran identidades ni se usan proxies para eludir restricciones. Política: https://operations.osmfoundation.org/policies/tiles/

## Archivos y verificación

- `index.html`: estructura y textos.
- `dashboard.css`: estilos existentes y adaptaciones.
- `dashboard.js`: lectura del esquema de mediana y visualizaciones.
- `case-views.js`: documentación, cobertura, disponibilidad, gráficos SVG temporales y sensibilidad de cada episodio.
- `network.js`: estaciones y líneas de contexto conservadas.
- `verify.cjs`: ambos casos, 38 OD, treinta combinaciones municipio/sentido, valores reales, series, exclusiones, cambios rápidos de incidencia, estados y codificación.
- `verify-browser.cjs`: prueba con Chrome sin ventana; requiere servidor en el puerto 8000 y Node 22 o superior. Se puede indicar la ruta de Chrome mediante `RMOVE_BROWSER`.

```powershell
node --check src/dashboard/dashboard.js
node src/dashboard/verify.cjs
node src/dashboard/verify-browser.cjs
```

La prueba de navegador verifica mapa, filtros, selección coordinada, cambio junio/febrero/junio, documentación, cobertura, exclusiones, series y ausencia de desbordamiento a ancho de escritorio/móvil. No sustituye una revisión estética manual. Para comprobar febrero, selecciona el 7 de febrero, Mataró y Mataró → Barcelona: 11.646 observados frente a mediana 11.224, +3,76 % y nueve viernes de control. Vuelve a junio para comprobar que reaparece el corredor sur y sus veinte relaciones.

Para regenerar datos, ejecutar el Notebook 04. La evaluación y procedencia de los resultados se documentan en [el módulo de análisis](../analysis/README.md). Los archivos de `data/processed/` están excluidos de Git por la configuración existente.
