from pathlib import Path
import gc

import duckdb
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

#directorios necesarios para la lectura y escritura de los datos
PROJECT_ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = PROJECT_ROOT / "data" / "raw" / "telefonica"
PROCESSED_DIR = PROJECT_ROOT / "data" / "processed" / "telefonica"

DATASETS = {
    "M1": "movilidad_barrios",
    "M2": "movilidad_municipios",
    "M3": "movilidad_mun_barrios",
}

#rangos de meses para los que se espera tener datos
MESES = [str(m) for m in pd.period_range("2023-01", "2025-08", freq="M")]
CHUNK_SIZE = 100_000

#columnas que coinciden entre los tres datasets y columnas específicas de barrios
COLUMNAS_COMUNES = [
    "day", "day_of_week", "month", "origen",
    "municipio_origen", "municipio_origen_name",
    "municipio_destino", "municipio_destino_name", "viajes",
]
COLUMNAS_BARRIOS = [
    "barrio_origen", "barrio_origen_name",
    "barrio_destino", "barrio_destino_name",
]

#leemos todas las columnas geograficas como string para evitar problemas de compatibilidad entre meses
DTYPES = {
    columna: "string"
    for columna in COLUMNAS_COMUNES + COLUMNAS_BARRIOS
    if columna not in ("day", "month", "viajes")
}
DTYPES.update({"month": "Int64", "viajes": "Int64"})

#función para obtener los archivos de un dataset específico
def obtener_archivos(dataset: str) -> list[Path]:
    """Devuelve los 32 archivos de un dataset, en orden cronológico."""
    if dataset not in DATASETS:
        raise ValueError(f"Dataset desconocido: {dataset}")

    archivos = []
    for mes in MESES:
        ruta = RAW_DIR / mes / f"{DATASETS[dataset]}_{mes}_origen.csv"
        if not ruta.is_file():
            raise FileNotFoundError(f"Falta el archivo: {ruta}")
        archivos.append(ruta)
    return archivos


#función para preparar un bloque de datos antes de escribirlo en Parquet
def preparar_bloque(bloque: pd.DataFrame) -> pd.DataFrame:
    """Estandariza los tipos sin alterar los valores de movilidad."""
    bloque["day"] = pd.to_datetime(bloque["day"], errors="raise").astype(
        "datetime64[us]"
    )
    return bloque


#función para consolidar un dataset en un solo archivo Parquet
def consolidar_dataset(dataset: str) -> int:
    """Consolida un dataset en un solo Parquet sin cargar todos los meses."""
    archivos = obtener_archivos(dataset)
    destino = PROCESSED_DIR / f"{dataset}.parquet"
    temporal = PROCESSED_DIR / f"{dataset}.tmp.parquet"
    total = 0
    writer = None
    esquema = None

    print(f"\nConsolidando {dataset}...")
    try:
        for ruta in archivos:
            filas_mes = 0
            lector = pd.read_csv(
                ruta,
                dtype=DTYPES,
                chunksize=CHUNK_SIZE,
                low_memory=False,
            )
            for bloque in lector:
                bloque = preparar_bloque(bloque)
                tabla = pa.Table.from_pandas(bloque, preserve_index=False)

                if writer is None:
                    esquema = tabla.schema
                    writer = pq.ParquetWriter(
                        temporal,
                        esquema,
                        compression="zstd",
                    )
                elif tabla.schema != esquema:
                    tabla = tabla.cast(esquema, safe=True)

                writer.write_table(tabla)
                filas_mes += len(bloque)
                total += len(bloque)

            print(f"  {ruta.parent.name}: {filas_mes:,} filas")
            gc.collect()

        if writer is None:
            raise ValueError(f"No hay registros para {dataset}")
        writer.close()
        writer = None
        temporal.replace(destino)
    except Exception:
        if writer is not None:
            writer.close()
        temporal.unlink(missing_ok=True)
        raise

    print(f"{dataset}: {total:,} registros -> {destino.name}")
    return total

#función para generar un archivo M3 sin duplicados
def generar_m3_sin_duplicados() -> None:
    """Crea una variante para sensibilidad, sin modificar el M3 original."""
    origen = PROCESSED_DIR / "M3.parquet"
    salida = PROCESSED_DIR / "M3_sin_duplicados.parquet"
    temporal = PROCESSED_DIR / "M3_sin_duplicados.tmp.parquet"
    directorio_temporal = PROCESSED_DIR / "_duckdb_temp"
    directorio_temporal.mkdir(parents=True, exist_ok=True)

    print("\nGenerando M3_sin_duplicados.parquet...")
    con = duckdb.connect()
    try:
        con.execute("SET memory_limit = '2GB'")
        temp_sql = directorio_temporal.as_posix().replace("'", "''")
        con.execute(f"SET temp_directory = '{temp_sql}'")

        # COPY y read_parquet reciben rutas: las escapamos correctamente para SQL.
        origen_sql = origen.as_posix().replace("'", "''")
        temporal_sql = temporal.as_posix().replace("'", "''")
        con.execute(
            f"""
            COPY (
                SELECT DISTINCT *
                FROM read_parquet('{origen_sql}')
            ) TO '{temporal_sql}'
            (FORMAT PARQUET, COMPRESSION ZSTD)
            """
        )
        temporal.replace(salida)
    except Exception:
        temporal.unlink(missing_ok=True)
        raise
    finally:
        con.close()



def verificar_resultados():
    """Comprueba los archivos generados y guarda un resumen."""

    print("\nVerificando los archivos Parquet...")

    resultados = []
    con = duckdb.connect()

    try:
        for dataset in ["M1", "M2", "M3", "M3_sin_duplicados"]:

            ruta = PROCESSED_DIR / f"{dataset}.parquet"

            registros, viajes = con.execute(
                "SELECT COUNT(*), SUM(viajes) FROM read_parquet(?)",
                [str(ruta)]
            ).fetchone()

            resultados.append({
                "Dataset": dataset,
                "Registros": registros,
                "Viajes publicados": viajes
            })

    finally:
        con.close()

    resumen = pd.DataFrame(resultados)

    print("\nResumen de resultados:")
    print(resumen.to_string(index=False))

    resumen.to_csv(
        PROCESSED_DIR / "resumen_procesamiento.csv",
        index=False
    )


def main():

    print("R-MOVE: preparación de datos de movilidad")

    if not RAW_DIR.is_dir():
        raise FileNotFoundError(
            f"No existe la carpeta de entrada: {RAW_DIR}"
        )

    # Comprobar los 96 CSV antes de procesarlos
    for dataset in DATASETS:
        obtener_archivos(dataset)

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    # Consolidar los tres datasets
    for dataset in DATASETS:
        consolidar_dataset(dataset)

    # Generar la versión alternativa de M3
    generar_m3_sin_duplicados()

    # Verificar los resultados
    verificar_resultados()

    print("\nProcesamiento completado correctamente.")


if __name__ == "__main__":
    main()

