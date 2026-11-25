# Observatorio R-MOVE (dashboard v2)

**Dashboard del proyecto**, publicado en GitHub Pages.
Todas las cifras salen del **clustering** del notebook 03 (la regresión se usa como comprobación) y del notebook 04 (análisis por barrios).
Tiene tres modos:

1. **El relato** — scrollytelling: mapa coroplético de municipios (límites ICGC, sin teselas) a pantalla completa, con tarjetas que pasan por encima, anotaciones sobre el mapa, leyenda por paso y barra de progreso. Recorrido: un día normal → avería R1 (13/05/2024) → huelga general (17/03/2025) → huelgas anunciadas (redistribución por barrios) → una sola línea (averías de una línea, sección 4.6 del notebook 03) → cuánto dura → quién lo sufre (alternativa en transporte público).
2. **Planificador** — une los antiguos «¿Y si…?» y «Mi municipio» en una herramienta de gestión. Mapa a pantalla completa y panel lateral: tipo de incidencia (pestañas), línea, duración y, opcionalmente, un municipio (buscador o clic en el mapa).
   - **Sin municipio (vista de red, para quien gestiona):** viajes perdidos, municipios afectados, cuántos no tienen alternativa y orden de magnitud de autobuses para cubrirlos; lista «Dónde actuar primero» (primero los municipios sin alternativa, después por viajes perdidos) con la acción recomendada (lanzadera, reforzar la alternativa o informar); descarga del plan en CSV y enlace para compartir el escenario.
   - **Con municipio:** pestaña «Este escenario» (impacto, acción recomendada y rutas alternativas dibujadas sobre el mapa) y pestaña «Perfil del municipio» (posición en el índice, los tres escenarios, historial de los días de caos, cómo llegar a Barcelona y vulnerabilidad social).
   - Enlazable: `#planificador?tipo=huelga&linea=todas&mun=08307&vista=perfil`. Los enlaces antiguos `#simulador?…` y `#municipio/08006` redirigen aquí.
3. **Laboratorio** — gráficos con el titular de la conclusión: casos (días de caos y averías de una línea: mapa del día, grupos, líneas, serie con el rango normal, tramos frente a su rango normal), validaciones (placebo y cuánto dura), qué lo explica (distancia, grupos y mapa de calor por alternativa) y método y límites.

## Uso

```bash
# 0) Todo de una vez: ejecuta los notebooks 03, 04 y 05, genera el JSON y valida (recomendado)
python scripts/actualizar_dashboard.py
# 1) Solo generar el JSON del observatorio (lee los resultados exportados por los notebooks 03 y 04; no recalcula modelos)
python src/dashboard-v2/build_observatorio.py
# 1b) Solo una vez: cartografía de los mapas (municipios de la provincia de Barcelona y perímetro de Cataluña, ICGC; requiere shapely y pyproj)
python src/dashboard-v2/build_contorno.py
# 2) Servir el repositorio desde la raíz y abrir http://localhost:8000/src/dashboard-v2/
python -m http.server 8000
# 3) Validar y empaquetar para GitHub Pages (lo mismo que hace el workflow)
python src/dashboard-v2/build_pages.py --check
python src/dashboard-v2/build_pages.py
```

Enlaces directos: `#relato`, `#planificador`, `#planificador?mun=08006&vista=perfil`, `#laboratorio`.

## Datos

- Entrada: `data/processed/rmove/resultados/dashboard_resultados.json` (notebook 03, celda B.8: resultados del clustering, incluido el efecto según la alternativa en transporte público y las averías de una línea), `data/processed/rmove/resultados/barrios_resultados.json` (notebook 04, anexo B.4: mismos días y método que el 03; efecto hacia barrios con y sin estación, ida y vuelta, averías de una línea y contraste) y `conectividad_municipios.parquet` (alternativa de cada municipio, GTFS).
- Salida: `data/processed/rmove/observatorio/observatorio.json` (el navegador solo lee este fichero, `municipios_mapa.geojson` y la red de Rodalies `railway-network.geojson` de esta carpeta).
- No hay cifras copiadas a mano: si cambia un notebook, `python scripts/actualizar_dashboard.py` lo propaga todo.
- **Motorización y renta** (notebook 05, opcional): `observatorio/vulnerabilidad.json` (por municipio: turismos por 1.000 hab., renta neta por persona, turismos por hogar, conductores y nivel bajo/medio/alto según los terciles de los dependientes) y `observatorio/vulnerabilidad_resumen.json` (regresión, robustez, efecto por día y terciles). Fuentes: DGT 2023–2025, INE Padrón 2023–2025 e INE ADRH 2023–2024.

## Motorización y renta: dónde aparece

- **Relato**, paso «¿Quién lo sufre?»: barras de los dependientes por terciles de motorización.
- **Planificador**, vista de red, «Más datos del escenario»: viajes de los dependientes con pocos coches y viajes perdidos.
- **Planificador**, municipio → «Perfil del municipio» → «Vulnerabilidad social»: motorización y renta del municipio, su nivel y la lectura.
- **Laboratorio → Qué lo explica**: terciles de motorización y renta, regresión ponderada y comprobaciones de robustez. **Método y límites**: decisión de datos y limitación.

## Simulador: cómo calcula

Viajes perdidos = viajes de un día normal × coeficiente del escenario (totales sobre los municipios dependientes). Los coeficientes son los efectos del clustering.

| Escenario | Dependientes | Cercanos y con metro/FGC |
|---|---|---|
| Avería sin aviso | Coeficiente de la R1 el 13/05/2024 (dependientes de la R1). Otras líneas: **extrapolado** (se avisa). Dependientes con otra línea: efecto del grupo ese día. | Efecto del grupo el 13/05 |
| Huelga general | Coeficiente por línea del 17/03/2025 | Efecto del grupo el 17/03 |
| Huelga anunciada | Media por línea del 26/03 y el 01/04/2025 | Media del grupo |

Duración > 1 día: no observado. Se da un rango entre «solo el primer día» y «N × primer día».

## Pendiente (se activa solo al añadir los datos)

- **Índice de vulnerabilidad combinado** (dependencia, alternativa, motorización y renta): el rango actual sigue siendo el efecto medio en los días de caos.
- **Vida media de una disrupción** (Montcada 2024, Gavà 2023): ahora se muestra la evidencia cualitativa.
- **Flujos animados** entre municipios y barrios (última prioridad de la propuesta).
