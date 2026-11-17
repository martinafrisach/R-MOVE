# Observatorio R-MOVE (dashboard v2)

Nueva versión del dashboard, **independiente del dashboard clásico** (`src/dashboard/`, que no se toca).
Implementa la propuesta `claude/propuesta_dashboard_v2.md` con cuatro modos:

1. **El relato** — scrollytelling: mapa coroplético de municipios (límites ICGC, sin teselas) a pantalla completa, con tarjetas que pasan por encima, anotaciones sobre el mapa, leyenda por paso y barra de progreso. Recorrido: un día normal → avería R1 (13/05/2024) → huelga general (17/03/2025) → huelgas anunciadas (redistribución por barrios, M3) → cuánto dura (event study) → quién lo sufre (alternativa en transporte público).
2. **¿Y si…?** — planificador tipo «Google Maps»: mapa a pantalla completa y panel lateral. Se elige el tipo de incidencia (pestañas), la línea, la duración y el origen (buscador o clic en el mapa); el destino es Barcelona. Sin origen: impacto total y municipios más afectados. Con origen: rutas alternativas (Rodalies, bus/FGC, teletrabajo) con tiempo, estado y la recomendada, dibujadas sobre el mapa. Enlazable: `#simulador?tipo=huelga&linea=todas&mun=08307`.
3. **Mi municipio** — portada con mapa y buscador; ficha con posición en el índice (tira de los 62 municipios), «si mañana pasa esto…» (enlaza al planificador), historial en tarjetas de color, cómo llegar a Barcelona (tiempo y frecuencia) y vulnerabilidad social.
4. **Laboratorio** — gráficos con el titular de la conclusión: casos (mapa del día, grupos, líneas, serie con el rango normal, tramos frente a su rango normal), validaciones (placebo y event study), qué lo explica (distancia, grupos y mapa de calor por alternativa) y método y límites.

## Uso

```bash
# 1) Generar el JSON del observatorio (lee los exportados de M2/M3; no recalcula modelos)
python src/dashboard-v2/build_observatorio.py
# 1b) Solo una vez: cartografía del relato (límites ICGC simplificados; requiere shapely y pyproj)
python src/dashboard-v2/build_mapa_base.py
# 2) Servir el repositorio desde la raíz y abrir http://localhost:8000/src/dashboard-v2/
python -m http.server 8000
```

Enlaces directos: `#relato`, `#simulador`, `#municipio/08006`, `#laboratorio`.

## Datos

- Entrada: `data/processed/rmove/resultados/dashboard_resultados.json`, `m2_conectividad_municipios.parquet`, `m2_robustez_conectividad.parquet`, `m2_distancia_vs_alternativa.parquet`.
- Salida: `data/processed/rmove/observatorio/observatorio.json` (el navegador solo lee este fichero y la red de `../dashboard/railway-network.geojson`).
- M3 de las huelgas anunciadas copiado de `m3_hallazgos.md` (constante `M3_ANUNCIADAS` del script).

## Simulador: cómo calcula

Viajes perdidos = viajes de un día normal × coeficiente del escenario (totales sobre los municipios dependientes).

| Escenario | Dependientes | Cercanos y con metro/FGC |
|---|---|---|
| Avería sin aviso | Coeficiente de la R1 el 13/05/2024 (−17,2 %). Otras líneas: **extrapolado** (se avisa). Dependientes con otra línea: efecto del grupo ese día. | Efecto del grupo el 13/05 |
| Huelga general | Coeficiente por línea del 17/03/2025 | Efecto del grupo el 17/03 |
| Huelga anunciada | Media por línea del 26/03 y el 01/04/2025 | Media del grupo |

Duración > 1 día: no observado. Se da un rango entre «solo el primer día» y «N × primer día».

## Pendiente (se activa solo al añadir los datos)

- **Motorización y renta**: crear `data/processed/rmove/observatorio/vulnerabilidad.json` con
  `{"08006": {"motorizacion": 512, "renta": 15800}, ...}` (vehículos/1.000 hab. y €/persona) y volver a ejecutar el script.
  El simulador, Mi municipio y el relato lo muestran automáticamente.
- **Vida media de una disrupción** (Montcada 2024, Gavà 2023): ahora se muestra la evidencia cualitativa.
- **Flujos animados** entre municipios y barrios (última prioridad de la propuesta).
