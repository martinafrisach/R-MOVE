# Observatorio R-MOVE (dashboard v2)

**Dashboard del proyecto** (sustituye al dashboard clásico, retirado el 19/11/2026). Se publica en GitHub Pages.
Todas las cifras salen del **clustering** del notebook 04 (la regresión se usa como comprobación) y del notebook 05 (M3, barrios).
Implementa la propuesta `claude/propuesta_dashboard_v2.md` con cuatro modos:

1. **El relato** — scrollytelling: mapa coroplético de municipios (límites ICGC, sin teselas) a pantalla completa, con tarjetas que pasan por encima, anotaciones sobre el mapa, leyenda por paso y barra de progreso. Recorrido: un día normal → avería R1 (13/05/2024) → huelga general (17/03/2025) → huelgas anunciadas (redistribución por barrios, M3) → una sola línea (averías de una línea, sección 4.6 del notebook 04) → cuánto dura → quién lo sufre (alternativa en transporte público).
2. **¿Y si…?** — planificador tipo «Google Maps»: mapa a pantalla completa y panel lateral. Se elige el tipo de incidencia (pestañas), la línea, la duración y el origen (buscador o clic en el mapa); el destino es Barcelona. Sin origen: impacto total y municipios más afectados. Con origen: rutas alternativas (Rodalies, bus/FGC, teletrabajo) con tiempo, estado y la recomendada, dibujadas sobre el mapa. Enlazable: `#simulador?tipo=huelga&linea=todas&mun=08307`.
3. **Mi municipio** — portada con mapa y buscador; ficha con posición en el índice (tira de los 62 municipios), «si mañana pasa esto…» (enlaza al planificador), historial en tarjetas de color, cómo llegar a Barcelona (tiempo y frecuencia) y vulnerabilidad social.
4. **Laboratorio** — gráficos con el titular de la conclusión: casos (los 4 días de caos y las averías de una línea: mapa del día, grupos, líneas, serie con el rango normal, tramos frente a su rango normal), validaciones (placebo y cuánto dura), qué lo explica (distancia, grupos y mapa de calor por alternativa) y método y límites.

## Uso

```bash
# 0) Todo de una vez: ejecuta los notebooks 04, 05 y 07, genera el JSON y valida (recomendado)
python scripts/actualizar_dashboard.py
# 1) Solo generar el JSON del observatorio (lee los exportados de M2/M3; no recalcula modelos)
python src/dashboard-v2/build_observatorio.py
# 1b) Solo una vez: cartografía de los mapas (municipios de la provincia de Barcelona y perímetro de Cataluña, ICGC; requiere shapely y pyproj)
python src/dashboard-v2/build_contorno.py
# 2) Servir el repositorio desde la raíz y abrir http://localhost:8000/src/dashboard-v2/
python -m http.server 8000
# 3) Validar y empaquetar para GitHub Pages (lo mismo que hace el workflow)
python src/dashboard-v2/build_pages.py --check
python src/dashboard-v2/build_pages.py
```

Enlaces directos: `#relato`, `#simulador`, `#municipio/08006`, `#laboratorio`.

## Datos

- Entrada: `data/processed/rmove/resultados/dashboard_resultados.json` (notebook 04, celda B.8: resultados del clustering, incluido el efecto según la alternativa en transporte público y las averías de una línea), `data/processed/rmove/resultados/m3_resultados.json` (notebook 05, sección 8: barrios con y sin estación, ida y vuelta, y la incidencia larga de Montcada) y `m2_conectividad_municipios.parquet` (alternativa de cada municipio, GTFS).
- Salida: `data/processed/rmove/observatorio/observatorio.json` (el navegador solo lee este fichero, `municipios_mapa.geojson` y la red de Rodalies `railway-network.geojson` de esta carpeta).
- No hay cifras copiadas a mano: si cambia un notebook, `python scripts/actualizar_dashboard.py` lo propaga todo.
- **Motorización y renta** (notebook 06, opcional): `observatorio/vulnerabilidad.json` (por municipio: turismos por 1.000 hab., renta neta por persona, turismos por hogar, conductores y nivel bajo/medio/alto según los terciles de los dependientes) y `observatorio/vulnerabilidad_resumen.json` (regresión, robustez, efecto por día y terciles). Fuentes: DGT 2023–2025, INE Padrón 2023–2025 e INE ADRH 2023–2024.

## Motorización y renta: dónde aparece

- **Relato**, paso «¿Quién lo sufre?»: barras de los dependientes por terciles de motorización.
- **¿Y si…?**, «Más datos del escenario»: viajes de los dependientes con pocos coches y viajes perdidos.
- **Mi municipio**, «Vulnerabilidad social»: motorización y renta del municipio, su nivel y la lectura.
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
