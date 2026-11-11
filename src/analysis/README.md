# Mediana de días comparables · R-MOVE

La referencia principal es la mediana de viajes del mismo día semanal. El Notebook 02 la compara con la media y el último día comparable. Se conservan las exploraciones de movilidad, incidencias y OD originales.

## Regla compartida

- Objetivos: lunes a viernes, sin festivos oficiales de Cataluña, excluyendo julio y agosto por decisión del usuario.
- Controles: mismo día semanal dentro de 42 días; mismas exclusiones de calendario y todas las fechas de inicio de incidencias de la columna `date` del Excel. Nunca incluye el objetivo.
- Predictivo: solo controles anteriores. Retrospectivo: anteriores y posteriores, ±42 días. No se confunden sus resultados.
- Mínimo de tres controles válidos; se muestra sensibilidad a cinco controles y ventanas de 28/42/56 días. Ausencias no imputadas y viajes negativos no válidos.
- La exclusión de julio/agosto no es un calendario completo de vacaciones escolares. Festivos municipales, puentes, episodios sin registrar y duraciones de incidencias no detalladas siguen siendo limitaciones.

El Notebook 02 mantiene las siete OD originales y amplía la evaluación a las veinte del corredor sur (26 OD distintas). Evalúa la mediana, media y último día comparable sobre idénticas fechas y observaciones previas. Las fechas sin incidencia registrada no se consideran etiquetas garantizadas de normalidad. El 21 de mayo permanece en la evaluación si es elegible: no se elimina a posteriori para mejorar métricas y se investiga su cobertura en el 04.

## Comparación de referencias y alcance

La ejecución con los datos disponibles produce 2.704 objetivos OD/día: 26 OD × 104 fechas. WAPE: mediana 7,983 %, media 8,413 % y último comparable 9,043 %. Son referencias predictivas con información anterior al objetivo, no una validación de detección causal.

Los tres métodos se comparan sobre idénticas fechas y controles. Se informa MAE, WAPE, sesgo y cobertura por OD y por mes, además de la sensibilidad a exigir cinco controles. Una ventaja agregada no demuestra superioridad en todas las OD ni significación estadística.

## Resultados de incidencias

El 04 usa observados, mediana, variación, distribución de viajes, número/fechas de controles, sensibilidad y cobertura provincial. Contiene dos casos: 7 de febrero de 2025 (Y25-002, R1/Maresme) y 5 de junio de 2025 (Y25-013, corredor sur). No se atribuyen causalmente diferencias a Rodalies. Las exclusiones temporales conservan todas las fechas conocidas del Excel.

`rmove_cases.py` centraliza ficha documental, comprobación de disponibilidad, sensibilidad, conclusiones numéricas y exportación de cada episodio. Y25-002 describe el fallo de infraestructura/señalización del túnel Barcelona Sants–Plaça de Catalunya, con vía única y frecuencias reducidas en R1/R3/R4/R7; el registro advierte de la coincidencia con otra avería del R2. Se conservan literalmente causa, afectación, horario, fuente y cautelas del Excel.

Para febrero se consultan las veinte OD entre Barcelona, Mataró, Premià de Mar, El Masnou y Arenys de Mar. Los cinco municipios tienen datos: 18 relaciones cumplen los criterios comunes de al menos 300 días observados y media de 100 viajes diarios en 2024, observación del episodio y tres controles. El Masnou ↔ Arenys tiene medias de 89,92 y 97,12 viajes diarios y se presenta en la tabla de exclusiones, sin confundir bajo volumen con ausencia de datos. Las relaciones seleccionadas tienen nueve viernes de referencia.

Febrero: Mataró → Barcelona, 11.646 viajes frente a mediana 11.224 (+3,76 %); Barcelona → Mataró, 12.458 frente a 12.644 (−1,47 %); Barcelona → Arenys, 2.139 frente a 2.325 (−8,00 %). Contexto provincial: +0,34 % de viajes y +0,21 % de registros respecto a viernes comparables. Los resultados no describen un descenso uniforme ni demuestran causalidad.

Campos del JSON, esquema 3:

| Campo | Interpretación |
| --- | --- |
| `viajes_observados` | Viajes agregados de la fecha y OD |
| `mediana_viajes_controles` | Mediana de viajes observados en comparables |
| `variacion_observada_pct` | 100 × (observados / mediana − 1), en % |
| `diferencia_viajes` | Observados − mediana; diferencia descriptiva, sin atribución causal |
| `p25_viajes_controles`, `p75_viajes_controles` | Percentiles descriptivos de viajes, no intervalos de significación |
| `n_controles`, `fechas_controles` | Identidad y número de referencias utilizadas |
| `modo_controles`, `ventana_dias`, `minimo_controles`, `estado` | Criterios y disponibilidad de la comparación |

Una referencia cero, insuficiente o una observación ausente produce un estado explícito y porcentaje nulo, nunca un cero ficticio. `fuera_rango_intercuartil_viajes` es solo descriptivo y no se presenta como alerta validada.

En junio se utilizan 8 controles. Gavà → Viladecans: 2.834 observados, mediana 3.162, variación −10,373 %. Barcelona → Castelldefels: 14.755, mediana 15.787, variación −6,537 %. Los controles cumplen la exclusión de julio y agosto.

## Reproducir

Ejecutar todas las celdas de `02_movilidad_telefonica_analisi_estadistico_mediana.ipynb` y `04_comparación_movilidad_incidencias.ipynb` con el entorno del proyecto, desde la raíz o desde `notebooks/`.

Se necesitan M2.parquet, el Excel existente en `data/raw/rodalies/` y las dependencias instaladas. Todas las referencias se calculan a partir de los viajes observados de los controles.

Se generan en `data/processed/rmove/`:

- `validacion_mediana_2025.csv`: objetivos y referencias predictivas de los tres métodos sencillos.
- `comparacion_referencias_2025.csv`: MAE, WAPE, sesgo y cobertura de mediana, media y último comparable por OD.
- `comparacion_referencias_mensual_2025.csv`: comparación de los tres métodos por mes.
- `incidencia_2025_06_05.json`: veinte OD con el esquema de mediana.
- `controles_2025_06_05.csv`: observaciones usadas para auditar cada referencia.
- `robustez_mediana_2025_06_05.csv` y `sensibilidad_mediana_2025_06_05.csv`: modos y ventanas.

Febrero genera las mismas salidas de incidencia, controles, robustez y sensibilidad con sufijo `2025_02_07`. Ambos casos generan además `disponibilidad_od_FECHA.csv` y `cobertura_provincial_FECHA.csv`. Los JSON añaden ficha del Excel, catálogo municipal, relaciones excluidas, contexto provincial, sensibilidad, conclusiones y evolución temporal de todas las OD analizadas (±21 días). Las series incluyen observaciones reales y valores nulos para ausencias; las referencias por fecha solo aparecen cuando son válidas dentro del calendario acordado.

`data/processed/` está excluido por el `.gitignore` del proyecto; los resultados se regeneran ejecutando los notebooks.

La comparación por OD también se exporta a `reports/statistical_analysis/model_comparison_by_corridor.csv`, con resultados de mediana, media y último comparable sobre las mismas fechas.

```powershell
.venv/Scripts/python.exe -B -m unittest discover -s src/analysis -v
node src/dashboard/verify.cjs
```

Las pruebas cubren calendario, vacaciones en objetivos y controles, exclusiones, ausencia de fuga del objetivo/futuro, referencias insuficientes/cero, fórmulas, ficha del Excel, suficiencia de datos, contexto provincial y series de ambos casos. Los fixtures artificiales son solo casos límite del test y no se exportan al dashboard.
