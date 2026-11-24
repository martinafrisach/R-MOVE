# src/analysis · funciones de apoyo del notebook 02

Módulos que importa `notebooks/02_movilidad_telefonica_analisi_estadistico_mediana.ipynb`:

| Módulo | Qué aporta |
|---|---|
| `rmove_general.py` | `cargar_catalogo` / `normalizar_catalogo`: lectura y validación del Excel de incidencias; `auditar_fechas`. |
| `rmove_indicators.py` | Referencia de días comparables (mediana, media, último comparable) y métricas: `cargar_relaciones`, `evaluar_mediana`, `metricas_referencia`, `calcular_indicadores`, `MESES_EXCLUIDOS`. |

Regla de la referencia: objetivos de lunes a viernes, sin festivos de Cataluña ni julio/agosto; controles del mismo día semanal dentro de ±42 días, sin fechas con incidencia y con un mínimo de tres controles válidos.

`rmove_general.py` también se puede ejecutar como auditoría independiente con `general_config.json`:

```bash
python -m src.analysis.rmove_general --config src/analysis/general_config.json
```

Test: `python -m unittest src.analysis.test_rmove_general`
