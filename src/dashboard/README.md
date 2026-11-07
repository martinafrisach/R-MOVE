# Dashboard R-MOVE · Iteración 2

Dashboard existente en HTML/CSS/JavaScript y Leaflet. Conserva el diseño naranja, la exploración de las 18 líneas y sus trazados aproximados. Las líneas son contexto heredado, no geometrías GTFS validadas ni una asignación de resultados OD a líneas.

## Ejecución local

Desde la **raíz del repositorio**:

```powershell
python -m http.server 8000
```

Abrir http://localhost:8000/src/dashboard/

No abrir con `file://` ni servir únicamente `src/dashboard`: el JSON se lee mediante `../../data/processed/rmove/incidencia_2025_06_05.json`. Se necesita internet para cargar Leaflet desde unpkg; sin Leaflet, la tabla y los gráficos siguen disponibles. No requiere compilación.

## Archivos

- `index.html`: estructura existente y secciones del análisis.
- `dashboard.css`: estilos adicionales adaptables a móviles.
- `dashboard.js`: lectura y validación del JSON, mapa, gráficos y navegación.
- `network.js`: estaciones y líneas aproximadas conservadas del prototipo.

## Datos e interpretación

Solo el 5 de junio de 2025 tiene resultados disponibles: 20 relaciones entre cinco municipios. No se han modificado los datos, notebooks ni el modelo. El 7 de marzo aparece pendiente de explicación por una anomalía metropolitana generalizada, sin resultados atribuidos a Rodalies.

`desviacion_pct` compara viajes observados con esperados por regresión; `diferencia_pp` resta la mediana de desviaciones de controles. No equivale a una comparación directa frente a otros jueves. Por ejemplo, Gavà → Viladecans presenta +14,16 % de desviación de regresión y −18,88 pp respecto a controles. Los valores narrativos frente a otros jueves no están en la exportación actual.

El intervalo P25–P75 describe los controles; no es un intervalo de confianza ni prueba causal. Las conexiones son relaciones de movilidad municipal dirigidas y separadas por sentido; los nodos usan posiciones municipales aproximadas, no estaciones. Las incidencias e indicadores simulados del prototipo se han retirado.

No hay series temporales. Para añadirlas, exportar del Notebook 04 una fila por fecha y OD con: identificador de incidencia, fecha, códigos OD, viajes observados y esperados, desviación, indicador incidencia/control y criterio de selección de controles. Para comparar con otros jueves, exportar también esa referencia de viajes y su método de cálculo. La interfaz explica esta limitación.

## Fondo cartográfico y errores 403

El prototipo usaba `https://{s}.tile.openstreetmap.org/...`; el mapa del notebook utiliza el dominio canónico. El dashboard ahora usa `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, con atribución visible y fondo opcional, desactivado inicialmente. El mapa OD funciona sin teselas.

No se ha reproducido un 403 ni puede afirmarse su causa exacta sin inspeccionar la respuesta y los encabezados en la pestaña Red del navegador. Abrir con `file://` puede omitir el Referer exigido; también son posibles bloqueos del proveedor o de la red. Servir por HTTP y conservar el Referer es la primera comprobación. Ante un error de tesela se retira la capa sin reintentos automáticos. No se alteran identidades, no se usan proxies ni descargas masivas para eludir restricciones.

Política oficial: https://operations.osmfoundation.org/policies/tiles/

Para una demo sin dependencia de este servicio, mantener el fondo desactivado. Si se requiere otro fondo, contratar un proveedor que permita el uso previsto o alojar teselas propias, respetando su licencia y atribución.

## Exploración por municipio

La vista inicial muestra solo los cinco municipios, sin conexiones. Haz clic en un nodo o utiliza el selector de municipio. El filtro de sentido muestra salidas, llegadas o ambas. La lista horizontal ordena las conexiones por magnitud absoluta de la diferencia respecto a controles. Seleccionar una barra, una conexión o una fila de la tabla coordina el mapa y el panel lateral. Las conexiones recíprocas usan curvas separadas. El botón «Volver a la vista general» elimina la selección y las conexiones.

El panel distingue viajes observados, predicción de regresión, desviación porcentual y diferencia en puntos porcentuales respecto a la mediana de los días comparables. Una diferencia negativa no implica necesariamente una disminución de viajes. La metodología, la tabla completa y los rankings del corredor se conservan en desplegables. Los archivos de interfaz están en UTF-8 y se incluye un favicon SVG local.

## Verificación

- `node --check src/dashboard/dashboard.js`: sintaxis.
- `node src/dashboard/verify.cjs`: vista inicial, cinco municipios × tres sentidos, clic de mapa, acceso a las 20 relaciones, orden por magnitud, detalle, reinicio, incidencia pendiente, navegación y codificación.
- Con el servidor en el puerto 8000, `node src/dashboard/verify-browser.cjs`: prueba real con Chrome sin ventana del mapa Leaflet, filtros, selección, valores del panel, reinicio y ausencia de desbordamiento horizontal a ancho de escritorio y móvil. Requiere Node 22 o superior y Chrome instalado; se puede indicar otra ruta con la variable `RMOVE_BROWSER`. Usa un perfil temporal y no activa teselas. No sustituye una revisión estética manual.

En el navegador, abre http://localhost:8000/src/dashboard/ y recarga con Ctrl+F5. Prueba Gavà → salidas → Gavà → Viladecans: deben aparecer 2.834 viajes, 2.482,48 esperados, +14,16 % respecto al modelo y −18,88 puntos porcentuales respecto a controles. Cambia a llegadas y ambos; vuelve a la vista general y comprueba que desaparecen todas las conexiones.
