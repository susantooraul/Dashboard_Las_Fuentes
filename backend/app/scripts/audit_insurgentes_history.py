"""Auditoria de solo lectura del historico hidraulico de Planta Las Fuentes.

Uso desde ``backend``::

    python -m app.scripts.audit_insurgentes_history
    python -m app.scripts.audit_insurgentes_history --days 30

No ejecuta INSERT/UPDATE/DELETE. El objetivo es producir evidencia para llenar
``hydraulic_valid_from``, ``instant_value_trust_from`` y las politicas que
siguen marcadas como pendientes en ``insurgentes_config.py``.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.config import get_settings
from app.services.insurgentes_config import (
    AUXILIARY_MINUTE_CHANNELS,
    LOCAL_TIMEZONE,
    READINGS_MINUTE_SENSOR_IDS,
    READINGS_MINUTE_TABLE,
    READINGS_MINUTE_TIMESTAMP_MODE_BY_SENSOR,
    READINGS_MINUTE_UTC_SENSOR_IDS,
    SOURCE_CONTRACTS,
    iter_hydraulic_elements,
)

LOCAL_ZONE = ZoneInfo(LOCAL_TIMEZONE)


def _utc_to_local_offset_minutes(reference_local: datetime) -> int:
    aware = reference_local.replace(tzinfo=LOCAL_ZONE)
    offset = aware.utcoffset()
    return int(offset.total_seconds() // 60) if offset is not None else 0


def _raw_minute_timestamp_sql(alias: str = "reading") -> str:
    return f"COALESCE({alias}.ts_local, {alias}.ts_minute, {alias}.inserted_at)"


def _operational_minute_timestamp_sql(alias: str = "reading") -> str:
    raw = _raw_minute_timestamp_sql(alias)
    utc_ids = ", ".join(str(int(sensor_id)) for sensor_id in sorted(READINGS_MINUTE_UTC_SENSOR_IDS))
    if not utc_ids:
        return raw
    return (
        f"CASE WHEN {alias}.sensor_id IN ({utc_ids}) "
        f"THEN DATEADD(minute, :audit_utc_to_local_minutes, {raw}) ELSE {raw} END"
    )


def _source_timestamp_to_local(value: Any, timestamp_mode: str | None) -> datetime | None:
    if not isinstance(value, datetime):
        return value if value is None else None
    if timestamp_mode == "utc":
        return value.replace(tzinfo=ZoneInfo("UTC")).astimezone(LOCAL_ZONE).replace(tzinfo=None)
    return value.replace(tzinfo=None)


def _sensor_names() -> dict[int, list[str]]:
    names: dict[int, list[str]] = defaultdict(list)
    for item in iter_hydraulic_elements():
        raw = item.get("sensor_id")
        if raw in (None, ""):
            continue
        sensor_id = int(raw)
        label = f"{item['module']} / {item['name']}"
        if label not in names[sensor_id]:
            names[sensor_id].append(label)
    for item in AUXILIARY_MINUTE_CHANNELS:
        sensor_id = int(item["sensor_id"])
        label = f"auxiliar / {item['name']} ({item['status']})"
        if label not in names[sensor_id]:
            names[sensor_id].append(label)
    return names


def _fmt(value: Any) -> str:
    if value is None:
        return "-"
    if isinstance(value, datetime):
        return value.isoformat(sep=" ", timespec="seconds")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, float):
        return f"{value:.2f}"
    return str(value)


def _print_table(headers: list[str], rows: list[list[Any]]) -> None:
    rendered = [[_fmt(value) for value in row] for row in rows]
    widths = [len(header) for header in headers]
    for row in rendered:
        for index, value in enumerate(row):
            widths[index] = max(widths[index], len(value))
    line = " | ".join(header.ljust(widths[index]) for index, header in enumerate(headers))
    print(line)
    print("-+-".join("-" * width for width in widths))
    for row in rendered:
        print(" | ".join(value.ljust(widths[index]) for index, value in enumerate(row)))


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Auditoria historica Las Fuentes (solo lectura).")
    parser.add_argument("--days", type=int, default=14, help="Ventana de cobertura/deltas a revisar (1-120 dias).")
    return parser.parse_args()


def _readings_summary(session, utc_to_local_minutes: int) -> list[dict[str, Any]]:
    placeholders = ", ".join(f":sensor_{index}" for index, _ in enumerate(READINGS_MINUTE_SENSOR_IDS))
    params = {f"sensor_{index}": sensor_id for index, sensor_id in enumerate(READINGS_MINUTE_SENSOR_IDS)}
    params["audit_utc_to_local_minutes"] = utc_to_local_minutes
    raw_timestamp_sql = _raw_minute_timestamp_sql("reading")
    operational_timestamp_sql = _operational_minute_timestamp_sql("reading")
    query = text(f"""
        SELECT
            reading.sensor_id,
            MIN({raw_timestamp_sql}) AS first_record_raw,
            MAX({raw_timestamp_sql}) AS last_record_raw,
            MIN({operational_timestamp_sql}) AS first_record_operational,
            MAX({operational_timestamp_sql}) AS last_record_operational,
            COUNT_BIG(*) AS row_count,
            MIN(CASE WHEN TRY_CONVERT(float, reading.instant_value) <> 0 THEN {operational_timestamp_sql} END) AS first_nonzero_flow_operational,
            MIN(CASE WHEN TRY_CONVERT(float, reading.total_value) > 0 THEN {operational_timestamp_sql} END) AS first_positive_totalizer_operational,
            SUM(CASE WHEN reading.instant_value IS NULL THEN 1 ELSE 0 END) AS null_flow_rows,
            SUM(CASE WHEN reading.total_value IS NULL THEN 1 ELSE 0 END) AS null_totalizer_rows,
            SUM(CASE WHEN TRY_CONVERT(float, reading.total_value) = 0 THEN 1 ELSE 0 END) AS zero_totalizer_rows,
            MIN(CASE WHEN reading.ts_local IS NOT NULL AND reading.inserted_at IS NOT NULL THEN DATEDIFF(minute, reading.inserted_at, reading.ts_local) END) AS min_inserted_to_local_minutes,
            MAX(CASE WHEN reading.ts_local IS NOT NULL AND reading.inserted_at IS NOT NULL THEN DATEDIFF(minute, reading.inserted_at, reading.ts_local) END) AS max_inserted_to_local_minutes
        FROM {READINGS_MINUTE_TABLE} AS reading
        WHERE reading.sensor_id IN ({placeholders})
        GROUP BY reading.sensor_id
        ORDER BY reading.sensor_id
    """)
    return [dict(row) for row in session.execute(query, params).mappings().all()]


def _coverage_summary(session, start_dt: datetime, end_dt: datetime, utc_to_local_minutes: int) -> list[dict[str, Any]]:
    placeholders = ", ".join(f":sensor_{index}" for index, _ in enumerate(READINGS_MINUTE_SENSOR_IDS))
    params: dict[str, Any] = {f"sensor_{index}": sensor_id for index, sensor_id in enumerate(READINGS_MINUTE_SENSOR_IDS)}
    params.update({"start_dt": start_dt, "end_dt": end_dt, "audit_utc_to_local_minutes": utc_to_local_minutes})
    timestamp_sql = _operational_minute_timestamp_sql("reading")

    # SQL Server no considera equivalentes dos expresiones GROUP BY si SQLAlchemy
    # expande el mismo bind (:audit_utc_to_local_minutes) a parametros posicionales
    # distintos. Normalizamos el timestamp una sola vez y agrupamos la columna ya
    # materializada por el CTE. Esto es especialmente importante para 3002/3004.
    query = text(f"""
        WITH normalized AS (
            SELECT
                reading.sensor_id,
                {timestamp_sql} AS ts_operativo
            FROM {READINGS_MINUTE_TABLE} AS reading
            WHERE reading.sensor_id IN ({placeholders})
        ), minute_rows AS (
            SELECT
                normalized.sensor_id,
                normalized.ts_operativo,
                CAST(normalized.ts_operativo AS date) AS reading_day
            FROM normalized
            WHERE normalized.ts_operativo >= :start_dt
              AND normalized.ts_operativo < :end_dt
        )
        SELECT
            minute_rows.sensor_id,
            minute_rows.reading_day,
            COUNT_BIG(*) AS rows_observed,
            COUNT_BIG(DISTINCT DATEDIFF(
                minute,
                CAST(minute_rows.reading_day AS datetime),
                minute_rows.ts_operativo
            )) AS observed_minutes
        FROM minute_rows
        GROUP BY minute_rows.sensor_id, minute_rows.reading_day
        ORDER BY minute_rows.reading_day, minute_rows.sensor_id
    """)
    return [dict(row) for row in session.execute(query, params).mappings().all()]


def _delta_summary(session, start_dt: datetime, end_dt: datetime, utc_to_local_minutes: int) -> list[dict[str, Any]]:
    placeholders = ", ".join(f":sensor_{index}" for index, _ in enumerate(READINGS_MINUTE_SENSOR_IDS))
    params: dict[str, Any] = {f"sensor_{index}": sensor_id for index, sensor_id in enumerate(READINGS_MINUTE_SENSOR_IDS)}
    params.update({"start_dt": start_dt, "end_dt": end_dt, "audit_utc_to_local_minutes": utc_to_local_minutes})
    timestamp_sql = _operational_minute_timestamp_sql("reading")
    query = text(f"""
        WITH ordered AS (
            SELECT
                reading.sensor_id,
                {timestamp_sql} AS reading_ts,
                TRY_CONVERT(float, reading.total_value) AS total_value,
                LAG(TRY_CONVERT(float, reading.total_value)) OVER (
                    PARTITION BY reading.sensor_id ORDER BY {timestamp_sql}
                ) AS previous_total
            FROM {READINGS_MINUTE_TABLE} AS reading
            WHERE reading.sensor_id IN ({placeholders})
              AND {timestamp_sql} >= :start_dt
              AND {timestamp_sql} < :end_dt
        )
        SELECT
            sensor_id,
            SUM(CASE WHEN total_value IS NOT NULL AND previous_total IS NOT NULL AND total_value < previous_total THEN 1 ELSE 0 END) AS negative_deltas,
            MAX(CASE WHEN total_value IS NOT NULL AND previous_total IS NOT NULL THEN total_value - previous_total END) AS max_positive_delta
        FROM ordered
        GROUP BY sensor_id
        ORDER BY sensor_id
    """)
    return [dict(row) for row in session.execute(query, params).mappings().all()]


def _largest_delta_events(session, start_dt: datetime, end_dt: datetime, utc_to_local_minutes: int) -> list[dict[str, Any]]:
    placeholders = ", ".join(f":event_sensor_{index}" for index, _ in enumerate(READINGS_MINUTE_SENSOR_IDS))
    params: dict[str, Any] = {f"event_sensor_{index}": sensor_id for index, sensor_id in enumerate(READINGS_MINUTE_SENSOR_IDS)}
    params.update({"start_dt": start_dt, "end_dt": end_dt, "audit_utc_to_local_minutes": utc_to_local_minutes})
    timestamp_sql = _operational_minute_timestamp_sql("reading")
    query = text(f"""
        WITH ordered AS (
            SELECT
                reading.sensor_id,
                {timestamp_sql} AS reading_ts,
                TRY_CONVERT(float, reading.total_value) AS total_value,
                LAG({timestamp_sql}) OVER (PARTITION BY reading.sensor_id ORDER BY {timestamp_sql}) AS previous_ts,
                LAG(TRY_CONVERT(float, reading.total_value)) OVER (PARTITION BY reading.sensor_id ORDER BY {timestamp_sql}) AS previous_total
            FROM {READINGS_MINUTE_TABLE} AS reading
            WHERE reading.sensor_id IN ({placeholders})
              AND {timestamp_sql} >= :start_dt
              AND {timestamp_sql} < :end_dt
        ), transitions AS (
            SELECT
                sensor_id, previous_ts, reading_ts, previous_total, total_value,
                total_value - previous_total AS delta
            FROM ordered
            WHERE total_value IS NOT NULL AND previous_total IS NOT NULL AND total_value <> previous_total
        ), ranked AS (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY sensor_id ORDER BY ABS(delta) DESC, reading_ts DESC) AS rn
            FROM transitions
        )
        SELECT sensor_id, previous_ts, reading_ts, previous_total, total_value, delta
        FROM ranked
        WHERE rn <= 3
        ORDER BY sensor_id, rn
    """)
    return [dict(row) for row in session.execute(query, params).mappings().all()]


def _source_table_summary(session) -> list[list[Any]]:
    output: list[list[Any]] = []
    seen: set[str] = set()
    for key, source in SOURCE_CONTRACTS.items():
        table = str(source.get("table") or "")
        timestamp_column = source.get("timestamp_column")
        if not table or not timestamp_column or table.lower() == READINGS_MINUTE_TABLE.lower() or table.lower() in seen:
            continue
        seen.add(table.lower())
        try:
            row = session.execute(text(f"""
                SELECT
                    MIN({timestamp_column}) AS first_record,
                    MAX({timestamp_column}) AS last_record,
                    COUNT_BIG(*) AS row_count
                FROM {table}
            """)).mappings().first()
            first_raw = row.get("first_record") if row else None
            last_raw = row.get("last_record") if row else None
            mode = source.get("timestamp_mode")
            output.append([
                key,
                table,
                mode,
                first_raw,
                _source_timestamp_to_local(first_raw, mode),
                last_raw,
                _source_timestamp_to_local(last_raw, mode),
                row.get("row_count") if row else 0,
                "OK",
            ])
        except SQLAlchemyError as exc:
            output.append([key, table, source.get("timestamp_mode"), None, None, None, None, None, f"ERROR: {type(exc).__name__}"])
    return output


def _expected_minutes_for_day(day: date, now_local: datetime) -> int:
    if day < now_local.date():
        return 1440
    if day > now_local.date():
        return 0
    return max(0, now_local.hour * 60 + now_local.minute)


def main() -> int:
    args = _parse_args()
    days = max(1, min(int(args.days), 120))
    settings = get_settings()
    print(f"Planta: Las Fuentes | timezone: {LOCAL_TIMEZONE}")
    print("Modo auditoria: SOLO LECTURA. No se ejecutan INSERT/UPDATE/DELETE.")
    print(f"DB_MODE detectado: {settings.db_mode}")
    if settings.db_mode.lower() != "sqlserver":
        print("ERROR: esta auditoria requiere DB_MODE=sqlserver para inspeccionar el historico real de planta.")
        return 2

    from app.database import SessionLocal

    now_local = datetime.now(LOCAL_ZONE).replace(tzinfo=None)
    # Para cobertura del dia actual se excluye el minuto que aun esta en curso.
    # Ej. 09:03 -> se evaluan [00:00, 09:03), 543 minutos esperados.
    end_dt = now_local.replace(second=0, microsecond=0)
    start_dt = datetime.combine(now_local.date() - timedelta(days=days - 1), time.min)
    utc_to_local_minutes = _utc_to_local_offset_minutes(now_local)
    names = _sensor_names()

    try:
        with SessionLocal() as session:
            database_name = session.execute(text("SELECT DB_NAME() AS database_name")).mappings().first()
            print(f"Base conectada: {(database_name or {}).get('database_name', '-')}")

            print("\n1) Inicio fisico y primeras lecturas utiles en iot.readings_minute")
            summary = _readings_summary(session, utc_to_local_minutes)
            by_id = {int(row["sensor_id"]): row for row in summary}
            rows: list[list[Any]] = []
            for sensor_id in READINGS_MINUTE_SENSOR_IDS:
                row = by_id.get(int(sensor_id), {})
                rows.append([
                    sensor_id,
                    READINGS_MINUTE_TIMESTAMP_MODE_BY_SENSOR.get(int(sensor_id), "pendiente"),
                    ", ".join(names.get(sensor_id, [])) or "canal auxiliar/no visible",
                    row.get("first_record_raw"),
                    row.get("first_record_operational"),
                    row.get("first_nonzero_flow_operational"),
                    row.get("first_positive_totalizer_operational"),
                    row.get("last_record_operational"),
                    row.get("row_count", 0),
                    row.get("zero_totalizer_rows", 0),
                    f"{_fmt(row.get('min_inserted_to_local_minutes'))}..{_fmt(row.get('max_inserted_to_local_minutes'))}",
                ])
            _print_table(
                ["sensor", "modo ts", "elemento", "primer raw", "primer operativo", "primer flujo != 0", "primer total > 0", "ultimo operativo", "filas", "total=0", "offset inserted->ts min"],
                rows,
            )

            print(f"\n2) Cobertura por minuto - ultimos {days} dias")
            coverage = _coverage_summary(session, start_dt, end_dt, utc_to_local_minutes)
            observed_by_sensor_day: dict[tuple[int, date], int] = {}
            for row in coverage:
                reading_day = row.get("reading_day")
                if isinstance(reading_day, datetime):
                    reading_day = reading_day.date()
                if not isinstance(reading_day, date):
                    continue
                observed_by_sensor_day[(int(row["sensor_id"]), reading_day)] = int(row.get("observed_minutes") or 0)

            coverage_rows: list[list[Any]] = []
            cursor_day = start_dt.date()
            while cursor_day <= now_local.date():
                expected = _expected_minutes_for_day(cursor_day, now_local)
                for sensor_id in READINGS_MINUTE_SENSOR_IDS:
                    observed = observed_by_sensor_day.get((int(sensor_id), cursor_day), 0)
                    pct = round(min(observed / expected * 100.0, 100.0), 1) if expected else 0.0
                    coverage_rows.append([sensor_id, cursor_day, observed, expected, pct])
                cursor_day += timedelta(days=1)
            _print_table(["sensor", "dia", "min observados", "min esperados", "cobertura %"], coverage_rows or [["-", "-", 0, 0, 0]])

            print(f"\n3) Señales de reset/salto - ultimos {days} dias")
            deltas = _delta_summary(session, start_dt, end_dt, utc_to_local_minutes)
            _print_table(
                ["sensor", "deltas negativos", "max delta positivo"],
                [[row.get("sensor_id"), row.get("negative_deltas", 0), row.get("max_positive_delta")] for row in deltas] or [["-", 0, None]],
            )

            print("\n3B) Transiciones de totalizador de mayor magnitud por sensor")
            events = _largest_delta_events(session, start_dt, end_dt, utc_to_local_minutes)
            _print_table(
                ["sensor", "ts anterior", "ts actual", "total anterior", "total actual", "delta"],
                [[row.get("sensor_id"), row.get("previous_ts"), row.get("reading_ts"), row.get("previous_total"), row.get("total_value"), row.get("delta")] for row in events] or [["-", None, None, None, None, None]],
            )

            print("\n4) Rango fisico de fuentes BOS")
            _print_table(
                ["fuente", "tabla", "timestamp", "primer raw", "primer local", "ultimo raw", "ultimo local", "filas", "estado"],
                _source_table_summary(session),
            )
    except SQLAlchemyError as exc:
        print(f"ERROR SQL: {type(exc).__name__}: {exc}")
        return 1

    print("\n5) Pendientes del contrato hidraulico")
    pending_rows: list[list[Any]] = []
    for item in iter_hydraulic_elements():
        contract = item["hydraulic_contract"]
        pending = []
        if contract.get("hydraulic_valid_from") is None:
            pending.append("hydraulic_valid_from")
        if contract.get("instant_value_trust_from") is None:
            pending.append("instant_value_trust_from")
        if contract.get("require_flow_validation") is None:
            pending.append("require_flow_validation")
        if contract.get("totalizer_zero_policy") == "pending_physical_confirmation":
            pending.append("totalizer_zero_policy")
        pending_rows.append([
            item["module"], item["name"], item.get("sensor_id"), contract.get("audit_status"), ", ".join(pending) or "sin pendientes",
        ])
    _print_table(["modulo", "elemento", "sensor", "auditoria", "pendientes"], pending_rows)

    print("\nAuditoria terminada. Este script no modifica la base ni actualiza automaticamente el contrato.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
