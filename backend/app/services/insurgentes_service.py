from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
import logging
from typing import Any, Iterable
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.database import SessionLocal
from app.services.insurgentes_config import (
    DASHBOARD_TITLE,
    FLOWS,
    LEVELS,
    LINES,
    LINEA_BOS_TABLE,
    LOCAL_TIMESTAMP_TABLES,
    LOCAL_TIMEZONE,
    MAX_TECHNICAL_PERIOD_DELTA_M3,
    NIVELES_BOS_TABLE,
    POZO_BOS_TABLE,
    PLANT_DISPLAY_NAME,
    READINGS_MINUTE_TABLE,
    SHIFT_WINDOWS,
    SHIFT_SAMPLE_CADENCE_MINUTES,
    TANQUE_BOS_TABLE,
    UV,
    UTC_TIMESTAMP_TABLES,
    UV_BOS_TABLE,
    WASHERS,
    WATER_ENTRY,
    WELLS,
)
from app.services.insurgentes_reconciliation_service import (
    QUALITY_NO_DATA,
    QUALITY_PARTIAL,
    QUALITY_REVIEW,
    reconcile_interval,
    readings_minute_operational_ts_sql,
)

logger = logging.getLogger(__name__)
LOCAL_ZONE = ZoneInfo(LOCAL_TIMEZONE)


def _num(value: Any, default: float | None = 0.0) -> float | None:
    if value is None or value == "":
        return default
    try:
        return float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return default


def _row_dict(row: Any) -> dict[str, Any] | None:
    if row is None:
        return None
    return {str(key).lower(): value for key, value in dict(row._mapping).items()}


def _first(row: dict[str, Any] | None, *names: str, default: Any = None) -> Any:
    if not row:
        return default
    for name in names:
        key = name.lower()
        if key in row and row[key] is not None:
            return row[key]
    return default


def _parse_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, time.min)
    if value is None or value == "":
        return None
    raw = str(value).strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        pass
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    return None


def _normalize_timestamp(value: Any, source_table: str) -> datetime | None:
    parsed = _parse_datetime(value)
    if not parsed:
        return None
    if source_table in UTC_TIMESTAMP_TABLES:
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        else:
            parsed = parsed.astimezone(timezone.utc)
        return parsed.astimezone(LOCAL_ZONE).replace(tzinfo=None)
    if source_table in LOCAL_TIMESTAMP_TABLES:
        return parsed.replace(tzinfo=None)
    if parsed.tzinfo is not None:
        return parsed.astimezone(LOCAL_ZONE).replace(tzinfo=None)
    return parsed


def _iso_local(value: Any, source_table: str) -> str | None:
    normalized = _normalize_timestamp(value, source_table)
    return normalized.isoformat(timespec="seconds") if normalized else None


def _date_bounds(start_date: Any = None, end_date: Any = None) -> tuple[datetime, datetime]:
    today = datetime.now(LOCAL_ZONE).date()

    def parse_date(value: Any, fallback: date) -> date:
        if isinstance(value, datetime):
            return value.date()
        if isinstance(value, date):
            return value
        if value:
            try:
                return date.fromisoformat(str(value)[:10])
            except ValueError:
                pass
        return fallback

    start = parse_date(start_date, today)
    end = parse_date(end_date, start)
    if end < start:
        start, end = end, start
    return datetime.combine(start, time.min), datetime.combine(end + timedelta(days=1), time.min)


def _period_name(period: Any, start: datetime, end: datetime) -> str:
    requested = str(period or "").lower().strip()
    if requested in {"minute", "hourly", "daily", "monthly"}:
        return requested
    days = max((end - start).days, 1)
    if days > 62:
        return "monthly"
    if days > 2:
        return "daily"
    return "hourly"


def _bucket(value: datetime, period: str) -> datetime:
    if period == "monthly":
        return datetime(value.year, value.month, 1)
    if period == "daily":
        return datetime(value.year, value.month, value.day)
    if period == "minute":
        return datetime(value.year, value.month, value.day, value.hour, value.minute)
    return datetime(value.year, value.month, value.day, value.hour)


def _latest_row(session, table_name: str) -> dict[str, Any] | None:
    order = "Time_Stamp DESC, Time_Stamp_ms DESC" if table_name.lower().endswith("niveles_bos") else "Time_Stamp DESC"
    result = session.execute(text(f"SELECT TOP 1 * FROM {table_name} ORDER BY {order}"))
    return _row_dict(result.first())


def _query_bounds_for_table(table_name: str, start: datetime, end: datetime) -> tuple[datetime, datetime]:
    if table_name in UTC_TIMESTAMP_TABLES:
        start_utc = start.replace(tzinfo=LOCAL_ZONE).astimezone(timezone.utc).replace(tzinfo=None)
        end_utc = end.replace(tzinfo=LOCAL_ZONE).astimezone(timezone.utc).replace(tzinfo=None)
        return start_utc, end_utc
    return start, end


def _range_rows(session, table_name: str, start: datetime, end: datetime, limit: int = 3000) -> list[dict[str, Any]]:
    query_start, query_end = _query_bounds_for_table(table_name, start, end)
    order = "Time_Stamp ASC, Time_Stamp_ms ASC" if table_name.lower().endswith("niveles_bos") else "Time_Stamp ASC"
    sql = f"""
        SELECT TOP ({max(1, min(limit, 5000))}) *
        FROM {table_name}
        WHERE Time_Stamp >= :start_date AND Time_Stamp < :end_date
        ORDER BY {order}
    """
    return [_row_dict(row) for row in session.execute(text(sql), {"start_date": query_start, "end_date": query_end}).fetchall() if row is not None]


def _range_rows_chunked(
    session,
    table_name: str,
    start: datetime,
    end: datetime,
    *,
    chunk_days: int = 31,
    per_chunk_limit: int = 2000,
) -> list[dict[str, Any]]:
    """Read low-frequency BOS history in bounded chunks without truncating long ranges.

    Niveles y UV tienen una cadencia aproximada de una muestra por hora. El TOP fijo
    de la ruta heredada podía cortar periodos largos; dividir por ventanas mantiene
    consultas pequeñas y conserva todos los registros del rango solicitado.
    """
    rows: list[dict[str, Any]] = []
    cursor = start
    step = timedelta(days=max(int(chunk_days), 1))
    while cursor < end:
        chunk_end = min(cursor + step, end)
        rows.extend(_range_rows(session, table_name, cursor, chunk_end, per_chunk_limit))
        cursor = chunk_end
    return rows


def _bos_value(row: dict[str, Any] | None, prefix: str, index: int, field: str, default: Any = None) -> Any:
    base = f"{prefix}_{index}"
    candidates = [f"{base}_{field}", f"{base}_{field}_value", f"{base}_{field}_val"]
    if field == "instant_value":
        candidates.extend([f"{base}_instant", f"{base}_value", base])
    elif field == "total_value":
        candidates.extend([f"{base}_total", f"{base}_totalizer", f"{base}_accumulated"])
    elif field == "quality":
        candidates.append(f"{base}_quality_code")
    return _first(row, *candidates, default=default)


def _is_sosa_well(config: dict[str, Any]) -> bool:
    return str(config.get("source") or "").lower() == "sosa_tanque" or str(config.get("id") or "") == "sosa-50"


def _reading_sensor_ids(configs: Iterable[dict[str, Any]]) -> list[int]:
    ids: list[int] = []
    for config in configs:
        raw = config.get("sensor_id")
        if raw is None or raw == "":
            continue
        try:
            ids.append(int(raw))
        except (TypeError, ValueError):
            continue
    return ids


def _column_value(row: dict[str, Any] | None, column: str, default: Any = None) -> Any:
    if not row:
        return default
    return _first(row, column, column.lower(), column.upper(), default=default)


def _sosa_normalized_rows(rows: Iterable[dict[str, Any]], source_table: str = TANQUE_BOS_TABLE) -> list[dict[str, Any]]:
    """Return one SOSA sample per local minute, preserving zero as data.

    The production query performs the minute aggregation in SQL. This helper is
    intentionally small and is used by tests and defensive fallbacks with already
    bounded row sets.
    """
    buckets: dict[datetime, list[dict[str, Any]]] = defaultdict(list)
    for row in rows or []:
        timestamp = _normalize_timestamp(_first(row, "time_stamp", "timestamp"), source_table)
        if not timestamp:
            continue
        flow = _num(_column_value(row, "sosa_flujo", None), None)
        total = _num(_column_value(row, "sosa_total", None), None)
        if flow is None and total is None:
            continue
        minute = datetime(timestamp.year, timestamp.month, timestamp.day, timestamp.hour, timestamp.minute)
        buckets[minute].append({"timestamp": timestamp, "instant_value": flow, "total_value": total})

    output: list[dict[str, Any]] = []
    for minute, bucket_rows in sorted(buckets.items()):
        flows = [item["instant_value"] for item in bucket_rows if item.get("instant_value") is not None]
        totals = [item for item in bucket_rows if item.get("total_value") is not None]
        output.append({
            "timestamp": minute,
            "instant_value": round(sum(flows) / len(flows), 4) if flows else None,
            "total_value": totals[-1]["total_value"] if totals else None,
        })
    return output


def _sosa_minute_rows(session, start: datetime, end: datetime, limit: int = 30000) -> list[dict[str, Any]]:
    """Read SOSA history aggregated by unique minute directly in SQL Server."""
    query_start, query_end = _query_bounds_for_table(TANQUE_BOS_TABLE, start, end)
    bounded_limit = max(1, min(int(limit or 30000), 30000))
    sql = f"""
        WITH filtered AS (
            SELECT
                Time_Stamp AS reading_ts,
                DATEADD(minute, DATEDIFF(minute, 0, Time_Stamp), 0) AS minute_ts,
                CAST(sosa_flujo AS float) AS sosa_flujo,
                CAST(sosa_total AS float) AS sosa_total
            FROM {TANQUE_BOS_TABLE}
            WHERE Time_Stamp >= :start_date
              AND Time_Stamp < :end_date
              AND (sosa_flujo IS NOT NULL OR sosa_total IS NOT NULL)
        ), ranked AS (
            SELECT
                minute_ts,
                sosa_flujo,
                sosa_total,
                AVG(sosa_flujo) OVER (PARTITION BY minute_ts) AS avg_sosa_flujo,
                ROW_NUMBER() OVER (PARTITION BY minute_ts ORDER BY reading_ts DESC) AS rn_last
            FROM filtered
        )
        SELECT TOP ({bounded_limit})
            minute_ts AS Time_Stamp,
            avg_sosa_flujo AS sosa_flujo,
            sosa_total
        FROM ranked
        WHERE rn_last = 1
        ORDER BY minute_ts ASC
    """
    try:
        rows = session.execute(text(sql), {"start_date": query_start, "end_date": query_end}).mappings().all()
        return _sosa_normalized_rows([{str(key).lower(): value for key, value in dict(row).items()} for row in rows])
    except SQLAlchemyError as exc:
        logger.warning("Insurgentes SOSA minute source failed error=%s", type(exc).__name__)
        try:
            session.rollback()
        except Exception:
            pass
        return []


def _sosa_previous_totalizer(session, before: datetime) -> float | None:
    """Return the last positive SOSA totalizer strictly before T0 in plant local time.

    SensorsBOS_Tanque stores UTC timestamps, so the query boundary is converted
    before reaching SQL Server. The returned value is only a boundary/context
    value; it is not counted as a sample of the requested period.
    """
    query_before, _ = _query_bounds_for_table(TANQUE_BOS_TABLE, before, before + timedelta(minutes=1))
    sql = f"""
        SELECT TOP (1)
            TRY_CONVERT(float, sosa_total) AS total_value
        FROM {TANQUE_BOS_TABLE}
        WHERE Time_Stamp < :before
          AND TRY_CONVERT(float, sosa_total) > 0
        ORDER BY Time_Stamp DESC
    """
    try:
        row = session.execute(text(sql), {"before": query_before}).mappings().first()
        return _num(row.get("total_value") if row else None, None)
    except SQLAlchemyError as exc:
        logger.warning("Insurgentes SOSA previous totalizer query failed error=%s", type(exc).__name__)
        try:
            session.rollback()
        except Exception:
            pass
        return None


def _sosa_operational_status(flow: float | None, has_reading: bool, communication_type: str) -> tuple[str, str, bool]:
    if not has_reading:
        return "Sin datos operativos", "communication", False
    if communication_type == "warning":
        return "Lectura atrasada", "communication", False
    if (flow or 0) > 0:
        return "Operando", "normal", True
    return "Apagado", "idle", False


def _readings_rows(
    session,
    sensor_ids: Iterable[int],
    start: datetime,
    end: datetime,
    period: str,
    limit: int = 20000,
    *,
    include_previous: bool = False,
) -> tuple[list[dict[str, Any]], str]:
    ids = sorted({int(item) for item in sensor_ids})
    if not ids:
        return [], "sin_datos"
    placeholders = ", ".join(f":sensor_{index}" for index in range(len(ids)))
    params: dict[str, Any] = {f"sensor_{index}": sensor_id for index, sensor_id in enumerate(ids)}
    params.update({"start_date": start, "end_date": end})
    operational_ts_sql = readings_minute_operational_ts_sql("reading", ids, start)
    if period == "monthly":
        bucket_sql = "DATEFROMPARTS(YEAR(reading_ts), MONTH(reading_ts), 1)"
    elif period == "daily":
        bucket_sql = "CAST(reading_ts AS date)"
    elif period == "minute":
        bucket_sql = "DATEADD(minute, DATEDIFF(minute, 0, reading_ts), 0)"
    else:
        bucket_sql = "DATEADD(hour, DATEDIFF(hour, 0, reading_ts), 0)"
    sql = f"""
        WITH normalized AS (
            SELECT
                reading.sensor_id,
                {operational_ts_sql} AS reading_ts,
                TRY_CONVERT(float, reading.instant_value) AS instant_value,
                TRY_CONVERT(float, reading.total_value) AS total_value,
                TRY_CONVERT(float, reading.quality) AS quality
            FROM {READINGS_MINUTE_TABLE} AS reading
            WHERE reading.sensor_id IN ({placeholders})
              AND {operational_ts_sql} >= :start_date
              AND {operational_ts_sql} < :end_date
        ), filtered AS (
            SELECT
                sensor_id,
                reading_ts,
                {bucket_sql} AS bucket_ts,
                instant_value,
                total_value,
                quality
            FROM normalized
            WHERE instant_value IS NOT NULL OR total_value IS NOT NULL
        ), ranked AS (
            SELECT
                sensor_id,
                reading_ts,
                bucket_ts,
                instant_value,
                total_value,
                quality,
                AVG(instant_value) OVER (PARTITION BY sensor_id, bucket_ts) AS avg_instant_value,
                ROW_NUMBER() OVER (PARTITION BY sensor_id, bucket_ts ORDER BY reading_ts ASC) AS rn_first,
                ROW_NUMBER() OVER (PARTITION BY sensor_id, bucket_ts ORDER BY reading_ts DESC) AS rn_last
            FROM filtered
        )
        SELECT TOP ({max(1, min(limit, 30000))})
            sensor_id,
            reading_ts AS ts_local,
            bucket_ts AS ts_minute,
            reading_ts AS inserted_at,
            avg_instant_value AS instant_value,
            total_value,
            quality
        FROM ranked
        WHERE rn_first = 1 OR rn_last = 1
        ORDER BY reading_ts ASC
    """
    try:
        rows = session.execute(text(sql), params).mappings().all()
        output = [{str(key).lower(): value for key, value in dict(row).items()} for row in rows]
        if include_previous:
            output.extend(_previous_readings_rows(session, ids, start))
            output.sort(key=lambda row: _parse_datetime(row.get("ts_local") or row.get("ts_minute") or row.get("inserted_at")) or datetime.min)
        return output, ("readings_minute" if output else "sin_datos")
    except SQLAlchemyError as exc:
        message = str(exc).lower()
        status = "timeout" if "timeout" in message or "hy008" in message else "error_sql"
        logger.warning("Insurgentes historical source failed status=%s error=%s", status, type(exc).__name__)
        try:
            session.rollback()
        except Exception:
            pass
        return [], status


def _previous_readings_rows(session, sensor_ids: Iterable[int], before: datetime) -> list[dict[str, Any]]:
    ids = sorted({int(item) for item in sensor_ids})
    if not ids:
        return []
    sensor_values = ", ".join(f"({sensor_id})" for sensor_id in ids)
    operational_ts_sql = readings_minute_operational_ts_sql("reading", ids, before)
    sql = f"""
        WITH requested_sensors AS (
            SELECT sensor_id FROM (VALUES {sensor_values}) AS configured(sensor_id)
        )
        SELECT
            configured.sensor_id,
            prior.reading_ts AS ts_local,
            prior.reading_ts AS ts_minute,
            prior.reading_ts AS inserted_at,
            prior.instant_value,
            prior.total_value,
            prior.quality
        FROM requested_sensors AS configured
        OUTER APPLY (
            SELECT TOP (1)
                {operational_ts_sql} AS reading_ts,
                TRY_CONVERT(float, reading.instant_value) AS instant_value,
                TRY_CONVERT(float, reading.total_value) AS total_value,
                TRY_CONVERT(float, reading.quality) AS quality
            FROM {READINGS_MINUTE_TABLE} AS reading
            WHERE reading.sensor_id = configured.sensor_id
              AND TRY_CONVERT(float, reading.total_value) > 0
              AND {operational_ts_sql} < :before
            ORDER BY {operational_ts_sql} DESC
        ) AS prior
        WHERE prior.reading_ts IS NOT NULL
    """
    rows = session.execute(text(sql), {"before": before}).mappings().all()
    return [{str(key).lower(): value for key, value in dict(row).items()} for row in rows]

def _readings_by_sensor(rows: list[dict[str, Any]]) -> dict[int, list[dict[str, Any]]]:
    grouped: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        try:
            sensor_id = int(row.get("sensor_id"))
        except (TypeError, ValueError):
            continue
        timestamp = _parse_datetime(row.get("ts_local") or row.get("ts_minute") or row.get("inserted_at"))
        if not timestamp:
            continue
        normalized = dict(row)
        normalized["timestamp"] = timestamp.replace(tzinfo=None)
        grouped[sensor_id].append(normalized)
    for values in grouped.values():
        values.sort(key=lambda item: item["timestamp"])
    return grouped



def _activity_metrics_by_sensor(
    session,
    sensor_ids: Iterable[int],
    start: datetime,
    end: datetime,
) -> dict[int, dict[str, Any]]:
    """Calculate observed active minutes and start events without loading minute rows.

    A start event is counted when a positive-flow minute follows a zero/non-positive
    minute, there is no prior observed minute, or the previous observed minute is
    separated by more than one minute. This keeps gaps from being interpreted as
    continuous operation.
    """
    ids = sorted({int(item) for item in sensor_ids if item is not None})
    if not ids or end <= start:
        return {}
    placeholders = ", ".join(f":activity_sensor_{index}" for index in range(len(ids)))
    params: dict[str, Any] = {
        f"activity_sensor_{index}": sensor_id for index, sensor_id in enumerate(ids)
    }
    params.update({"activity_start": start, "activity_query_start": start - timedelta(minutes=2), "activity_end": end})
    timestamp_sql = "COALESCE(ts_local, ts_minute, inserted_at)"
    sql = f"""
        WITH minute_values AS (
            SELECT
                sensor_id,
                DATEADD(minute, DATEDIFF(minute, 0, {timestamp_sql}), 0) AS minute_ts,
                AVG(TRY_CONVERT(float, instant_value)) AS avg_flow
            FROM {READINGS_MINUTE_TABLE}
            WHERE sensor_id IN ({placeholders})
              AND {timestamp_sql} >= :activity_query_start
              AND {timestamp_sql} < :activity_end
              AND instant_value IS NOT NULL
            GROUP BY sensor_id, DATEADD(minute, DATEDIFF(minute, 0, {timestamp_sql}), 0)
        ), sequenced AS (
            SELECT
                sensor_id,
                minute_ts,
                avg_flow,
                LAG(avg_flow) OVER (PARTITION BY sensor_id ORDER BY minute_ts) AS previous_flow,
                LAG(minute_ts) OVER (PARTITION BY sensor_id ORDER BY minute_ts) AS previous_minute
            FROM minute_values
        )
        SELECT
            sensor_id,
            COUNT_BIG(1) AS sampled_minutes,
            SUM(CASE WHEN avg_flow > 0 THEN 1 ELSE 0 END) AS active_minutes,
            SUM(CASE WHEN avg_flow <= 0 THEN 1 ELSE 0 END) AS inactive_minutes,
            SUM(CASE
                WHEN avg_flow > 0
                 AND previous_flow IS NOT NULL
                 AND previous_flow <= 0
                 AND DATEDIFF(minute, previous_minute, minute_ts) = 1
                THEN 1 ELSE 0 END
            ) AS start_count
        FROM sequenced
        WHERE minute_ts >= :activity_start
          AND minute_ts < :activity_end
        GROUP BY sensor_id
    """
    try:
        rows = session.execute(text(sql), params).mappings().all()
    except SQLAlchemyError as exc:
        logger.warning("Insurgentes activity metrics failed error=%s", type(exc).__name__)
        try:
            session.rollback()
        except Exception:
            pass
        return {}

    expected_minutes = max(int((end - start).total_seconds() // 60), 1)
    output: dict[int, dict[str, Any]] = {}
    for row in rows:
        sensor_id = int(row.get("sensor_id"))
        sampled = int(row.get("sampled_minutes") or 0)
        active = int(row.get("active_minutes") or 0)
        starts = int(row.get("start_count") or 0)
        output[sensor_id] = {
            "active_minutes": active,
            "tiempo_activo_min": active,
            "sampled_minutes": sampled,
            "inactive_minutes": int(row.get("inactive_minutes") or 0),
            "start_count": starts,
            "encendidos_periodo": starts,
            "activity_coverage_pct": round(min(sampled / expected_minutes * 100.0, 100.0), 2),
        }
    return output


def _activity_metrics_from_rows(rows: Iterable[dict[str, Any]], start: datetime, end: datetime) -> dict[str, Any]:
    # Consolidar por minuto evita contar varias muestras del mismo minuto como
    # minutos activos distintos. Para los arranques se exige una transición
    # observada 0 -> positivo en minutos consecutivos; los huecos de datos no
    # se interpretan como un encendido real.
    grouped: dict[datetime, list[float]] = defaultdict(list)
    for row in rows or []:
        timestamp = row.get("timestamp")
        if not isinstance(timestamp, datetime) or not (start <= timestamp < end):
            continue
        flow = _num(row.get("instant_value"), None)
        if flow is None:
            continue
        grouped[timestamp.replace(second=0, microsecond=0)].append(flow)

    minute_rows = sorted(
        (minute, sum(values) / len(values))
        for minute, values in grouped.items()
        if values
    )
    active_minutes = sum(1 for _, flow in minute_rows if flow > 0)
    start_count = 0
    previous: tuple[datetime, float] | None = None
    for timestamp, flow in minute_rows:
        if (
            flow > 0
            and previous is not None
            and previous[1] <= 0
            and (timestamp - previous[0]).total_seconds() == 60
        ):
            start_count += 1
        previous = (timestamp, flow)
    expected_minutes = max(int((end - start).total_seconds() // 60), 1)
    sampled = len(minute_rows)
    return {
        "active_minutes": active_minutes,
        "tiempo_activo_min": active_minutes,
        "sampled_minutes": sampled,
        "inactive_minutes": sum(1 for _, flow in minute_rows if flow <= 0),
        "start_count": start_count,
        "encendidos_periodo": start_count,
        "activity_coverage_pct": round(min(sampled / expected_minutes * 100.0, 100.0), 2),
    }


def _apply_activity_metrics(items: Iterable[dict[str, Any]], metrics: dict[int, dict[str, Any]]) -> None:
    for item in items:
        raw_sensor = item.get("sensor_id")
        try:
            sensor_id = int(raw_sensor) if raw_sensor not in (None, "") else None
        except (TypeError, ValueError):
            sensor_id = None
        if sensor_id is not None and sensor_id in metrics:
            item.update(metrics[sensor_id])
        else:
            item.setdefault("active_minutes", None)
            item.setdefault("tiempo_activo_min", None)
            item.setdefault("start_count", None)
            item.setdefault("encendidos_periodo", None)

def _period_delta(rows: list[dict[str, Any]]) -> dict[str, Any]:
    valid: list[tuple[datetime, float]] = []
    for row in rows:
        total = _num(row.get("total_value"), None)
        timestamp = row.get("timestamp")
        if total is None or total <= 0 or not isinstance(timestamp, datetime):
            continue
        valid.append((timestamp, total))
    if len(valid) < 2:
        return {"value": None, "status": "sin_datos", "note": "Sin suficientes lecturas válidas para calcular el periodo."}

    resets = 0
    jumps = 0
    previous = valid[0][1]
    for _, current in valid[1:]:
        increment = current - previous
        if increment < 0:
            resets += 1
        elif increment > MAX_TECHNICAL_PERIOD_DELTA_M3:
            jumps += 1
        previous = current
    if resets:
        return {"value": None, "status": "dato_en_revision", "note": "El totalizador presentó un reinicio dentro del periodo."}
    if jumps:
        return {"value": None, "status": "dato_en_revision", "note": "El totalizador presentó un salto técnico no confiable."}

    delta = valid[-1][1] - valid[0][1]
    if delta < 0 or delta > MAX_TECHNICAL_PERIOD_DELTA_M3:
        return {"value": None, "status": "dato_en_revision", "note": "El volumen del periodo requiere revisión."}
    return {
        "value": round(delta, 4),
        "status": "valid",
        "note": "",
        "first_total": valid[0][1],
        "last_total": valid[-1][1],
        "first_timestamp": valid[0][0].isoformat(timespec="seconds"),
        "last_timestamp": valid[-1][0].isoformat(timespec="seconds"),
    }


def _bos_period_delta(start_row: dict[str, Any] | None, end_row: dict[str, Any] | None, prefix: str, index: int) -> dict[str, Any]:
    first_total = _num(_bos_value(start_row, prefix, index, "total_value", None), None)
    last_total = _num(_bos_value(end_row, prefix, index, "total_value", None), None)
    if first_total is None or last_total is None or first_total <= 0 or last_total <= 0:
        return {"value": None, "status": "sin_datos", "note": "Sin totalizadores válidos en el periodo."}
    delta = last_total - first_total
    if delta < 0:
        return {"value": None, "status": "dato_en_revision", "note": "El totalizador presentó un reinicio dentro del periodo."}
    if delta > MAX_TECHNICAL_PERIOD_DELTA_M3:
        return {"value": None, "status": "dato_en_revision", "note": "El totalizador presentó un salto técnico no confiable."}
    return {"value": round(delta, 4), "status": "valid", "note": "", "first_total": first_total, "last_total": last_total}


def _communication(timestamp: datetime | None, limit_minutes: int, periodic: bool = False) -> tuple[str, str, float | None]:
    if not timestamp:
        return "Sin comunicación", "communication", None
    now = datetime.now(LOCAL_ZONE).replace(tzinfo=None)
    age = max((now - timestamp).total_seconds() / 60.0, 0.0)
    if age <= limit_minutes:
        return ("Actualización periódica" if periodic else "Actualizado"), "normal", round(age, 1)
    return "Revisar comunicación", "warning", round(age, 1)


def _operational_status(flow: float | None, has_reading: bool, configured_idle: bool = False) -> tuple[str, str, bool]:
    if not has_reading:
        return "Sin datos operativos", "communication", False
    if (flow or 0) > 0:
        return "Operando", "normal", True
    if configured_idle:
        return "Configurado / sin actividad reciente", "idle", False
    return "Sin flujo", "idle", False


def _history_rows(sensor_rows: list[dict[str, Any]], period: str, item_id: str, name: str) -> list[dict[str, Any]]:
    grouped: dict[datetime, list[dict[str, Any]]] = defaultdict(list)
    for row in sensor_rows:
        timestamp = row.get("timestamp")
        if isinstance(timestamp, datetime):
            grouped[_bucket(timestamp, period)].append(row)
    output: list[dict[str, Any]] = []
    for bucket, rows in sorted(grouped.items()):
        instants = [_num(row.get("instant_value"), None) for row in rows]
        valid_instants = [value for value in instants if value is not None and value >= 0]
        delta = _period_delta(rows)
        output.append({
            "id": item_id,
            "name": name,
            "bucket": bucket.isoformat(timespec="seconds"),
            "timestamp": bucket.isoformat(timespec="seconds"),
            "flow_lps": round(sum(valid_instants) / len(valid_instants), 4) if valid_instants else None,
            "period_m3": delta.get("value"),
            "period_status": delta.get("status"),
            "totalizador_m3": _num(rows[-1].get("total_value"), None),
            "source_status": "readings_minute",
        })
    return output


def _bos_history_rows(
    rows: list[dict[str, Any]],
    source_table: str,
    prefix: str,
    index: int,
    period: str,
    item_id: str,
    name: str,
) -> list[dict[str, Any]]:
    grouped: dict[datetime, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        timestamp = _normalize_timestamp(_first(row, "time_stamp", "timestamp"), source_table)
        if not timestamp:
            continue
        instant = _num(_bos_value(row, prefix, index, "instant_value", None), None)
        total = _num(_bos_value(row, prefix, index, "total_value", None), None)
        if instant is None and total is None:
            continue
        grouped[_bucket(timestamp, period)].append({
            "timestamp": timestamp,
            "instant_value": instant,
            "total_value": total,
        })
    output: list[dict[str, Any]] = []
    for bucket, bucket_rows in sorted(grouped.items()):
        instants = [item["instant_value"] for item in bucket_rows if item.get("instant_value") is not None and item.get("instant_value") >= 0]
        delta = _period_delta(bucket_rows)
        output.append({
            "id": item_id,
            "name": name,
            "bucket": bucket.isoformat(timespec="seconds"),
            "timestamp": bucket.isoformat(timespec="seconds"),
            "flow_lps": round(sum(instants) / len(instants), 4) if instants else None,
            "period_m3": delta.get("value"),
            "period_status": delta.get("status"),
            "totalizador_m3": bucket_rows[-1].get("total_value"),
            "source_status": "bos_fallback",
        })
    return output


def _build_entry(pozo_row: dict[str, Any] | None, pozo_first: dict[str, Any] | None, readings: dict[int, list[dict[str, Any]]], period: str, bos_rows: list[dict[str, Any]] | None = None) -> tuple[dict[str, Any], list[dict[str, Any]], str]:
    updated = _normalize_timestamp(_first(pozo_row, "time_stamp", "timestamp"), POZO_BOS_TABLE)
    primary = WATER_ENTRY["primary_bos"]
    backup = WATER_ENTRY["backup_bos"]
    primary_flow = _num(_bos_value(pozo_row, primary["prefix"], primary["index"], "instant_value", None), None)
    primary_total = _num(_bos_value(pozo_row, primary["prefix"], primary["index"], "total_value", None), None)
    primary_valid = primary_flow is not None or primary_total is not None
    communication, communication_type, age = _communication(updated, WATER_ENTRY["communication_minutes"])
    primary_fresh = primary_valid and communication_type != "warning"

    source_sensor = WATER_ENTRY["primary_sensor_id"]
    source_role = "principal"
    flow = primary_flow
    total = primary_total
    prefix = primary["prefix"]
    index = primary["index"]
    if not primary_fresh:
        backup_flow = _num(_bos_value(pozo_row, backup["prefix"], backup["index"], "instant_value", None), None)
        backup_total = _num(_bos_value(pozo_row, backup["prefix"], backup["index"], "total_value", None), None)
        if backup_flow is not None or backup_total is not None:
            source_sensor = WATER_ENTRY["backup_sensor_id"]
            source_role = "respaldo"
            flow = backup_flow
            total = backup_total
            prefix = backup["prefix"]
            index = backup["index"]

    period_rows = readings.get(WATER_ENTRY["primary_sensor_id"], [])
    period_source = "readings_minute"
    if len(period_rows) < 2:
        period_rows = readings.get(WATER_ENTRY["backup_sensor_id"], [])
        if period_rows:
            source_sensor = WATER_ENTRY["backup_sensor_id"] if not readings.get(WATER_ENTRY["primary_sensor_id"]) else source_sensor
    period_info = _period_delta(period_rows)
    if period_info["status"] == "sin_datos":
        period_info = _bos_period_delta(pozo_first, pozo_row, prefix, index)
        period_source = "bos_fallback" if period_info["status"] != "sin_datos" else "sin_datos"

    has_reading = flow is not None or total is not None
    status, status_type, active = _operational_status(flow, has_reading)
    item = {
        "id": WATER_ENTRY["id"],
        "name": WATER_ENTRY["name"],
        "nombre": WATER_ENTRY["name"],
        "visible": WATER_ENTRY.get("visible", True),
        "numero": 1,
        "ubicacion": "Referencia técnica interna",
        "flow_lps": flow,
        "flow": flow,
        "flujo_entrada": flow,
        "totalizador_m3": total,
        "period_m3": period_info.get("value"),
        "period_delta_m3": period_info.get("value"),
        "entry_m3": period_info.get("value") or 0,
        "period_status": period_info.get("status"),
        "period_note": period_info.get("note"),
        "period_source": period_source,
        "active": active,
        "status": status,
        "statusType": status_type,
        "estado_comunicacion": communication,
        "communicationType": communication_type,
        "age_minutes": age,
        "updated": updated.isoformat(timespec="seconds") if updated else None,
        "ultima_lectura": updated.isoformat(timespec="seconds") if updated else None,
        "source_role": source_role,
        "sensor_id": source_sensor,
        "source_status": period_source,
    }
    history_source_rows = readings.get(WATER_ENTRY["primary_sensor_id"], []) or readings.get(WATER_ENTRY["backup_sensor_id"], [])
    history = _history_rows(history_source_rows, period, item["id"], item["name"])
    if not history and bos_rows:
        history = _bos_history_rows(bos_rows, POZO_BOS_TABLE, primary["prefix"], primary["index"], period, item["id"], item["name"])
        if not history:
            history = _bos_history_rows(bos_rows, POZO_BOS_TABLE, backup["prefix"], backup["index"], period, item["id"], item["name"])
        if history:
            period_source = "bos_fallback" if period_source == "sin_datos" else period_source
            item["source_status"] = period_source
            item["period_source"] = period_source
    return item, history, period_source


def _build_sosa_well(
    config: dict[str, Any],
    flow_row: dict[str, Any] | None,
    sosa_rows: list[dict[str, Any]],
    period: str,
    previous_totalizer_m3: float | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    source_table = str(config.get("source_table") or TANQUE_BOS_TABLE)
    updated = _normalize_timestamp(_first(flow_row, "time_stamp", "timestamp"), source_table)
    communication, communication_type, age = _communication(updated, int(config.get("communication_minutes") or 5))
    flow = _num(_column_value(flow_row, str(config.get("flow_column") or "sosa_flujo"), None), None)
    total = _num(_column_value(flow_row, str(config.get("total_column") or "sosa_total"), None), None)
    has_reading = flow is not None or total is not None
    period_info = _period_delta(sosa_rows)
    source_status = "sosa_minute_sql" if sosa_rows else "sin_datos"
    status, status_type, active = _sosa_operational_status(flow, has_reading, communication_type)
    item = {
        **config,
        "sensor_id": None,
        "numero": int(config.get("operational_number") or 0),
        "nombre": str(config.get("name") or "SOSA 50%"),
        "ubicacion": "Pozos",
        "kind": "sosa",
        "is_sosa": True,
        "flow_lps": flow,
        "flow": flow,
        "flujo_entrada": flow,
        "flujo_salida": flow,
        "totalizador_m3": total,
        "total_m3": total,
        "totalizador_inicio_dia_m3": previous_totalizer_m3,
        "totalizador_cierre_anterior_m3": previous_totalizer_m3,
        "previous_totalizer_m3": previous_totalizer_m3,
        "previous_totalizer_source": "last_valid_reading_before_t0" if previous_totalizer_m3 is not None else "missing_previous_reading",
        "period_m3": period_info.get("value"),
        "period_delta_m3": period_info.get("value"),
        "entry_m3": period_info.get("value") or 0,
        "period_status": period_info.get("status"),
        "period_note": period_info.get("note"),
        "source_status": source_status,
        "active": active,
        "status": status,
        "statusType": status_type,
        "estado_comunicacion": communication,
        "communicationType": communication_type,
        "age_minutes": age,
        "updated": updated.isoformat(timespec="seconds") if updated else None,
        "ultima_lectura": updated.isoformat(timespec="seconds") if updated else None,
        "exclude_from_balance": True,
    }
    history = _history_rows(sosa_rows, period, str(config.get("id") or "sosa-50"), str(config.get("name") or "SOSA 50%"))
    return item, history


def _build_wells(
    pozo_row: dict[str, Any] | None,
    pozo_first: dict[str, Any] | None,
    readings: dict[int, list[dict[str, Any]]],
    period: str,
    bos_rows: list[dict[str, Any]] | None = None,
    sosa_row: dict[str, Any] | None = None,
    sosa_rows: list[dict[str, Any]] | None = None,
    previous_totalizers: dict[int, float] | None = None,
    sosa_previous_totalizer_m3: float | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    updated = _normalize_timestamp(_first(pozo_row, "time_stamp", "timestamp"), POZO_BOS_TABLE)
    communication, communication_type, age = _communication(updated, WATER_ENTRY["communication_minutes"])
    items: list[dict[str, Any]] = []
    history: list[dict[str, Any]] = []
    for config in WELLS:
        if _is_sosa_well(config):
            item, sensor_history = _build_sosa_well(
                config,
                sosa_row,
                sosa_rows or [],
                period,
                previous_totalizer_m3=sosa_previous_totalizer_m3,
            )
            items.append(item)
            history.extend(sensor_history)
            continue

        index = int(config["bos_index"])
        sensor_id = int(config["sensor_id"])
        prefix = str(config.get("bos_prefix") or "POZO_FLOW_OUT")
        previous_totalizer_m3 = (previous_totalizers or {}).get(sensor_id)
        flow = _num(_bos_value(pozo_row, prefix, index, "instant_value", None), None)
        total = _num(_bos_value(pozo_row, prefix, index, "total_value", None), None)
        period_info = _period_delta(readings.get(sensor_id, []))
        source_status = "readings_minute"
        if period_info["status"] == "sin_datos":
            period_info = _bos_period_delta(pozo_first, pozo_row, prefix, index)
            source_status = "bos_fallback" if period_info["status"] != "sin_datos" else "sin_datos"
        status, status_type, active = _operational_status(flow, flow is not None or total is not None)
        items.append({
            **config,
            "numero": int(config.get("operational_number") or index),
            "nombre": config["name"],
            "ubicacion": "Pozos",
            "flow_lps": flow,
            "flow": flow,
            "flujo_entrada": flow,
            "flujo_salida": flow,
            "totalizador_m3": total,
            "total_m3": total,
            "totalizador_inicio_dia_m3": previous_totalizer_m3,
            "totalizador_cierre_anterior_m3": previous_totalizer_m3,
            "previous_totalizer_m3": previous_totalizer_m3,
            "previous_totalizer_source": "last_valid_reading_before_t0" if previous_totalizer_m3 is not None else "missing_previous_reading",
            "period_m3": period_info.get("value"),
            "period_delta_m3": period_info.get("value"),
            "entry_m3": period_info.get("value") or 0,
            "period_status": period_info.get("status"),
            "period_note": period_info.get("note"),
            "source_status": source_status,
            "active": active,
            "status": status,
            "statusType": status_type,
            "estado_comunicacion": communication,
            "communicationType": communication_type,
            "age_minutes": age,
            "updated": updated.isoformat(timespec="seconds") if updated else None,
            "ultima_lectura": updated.isoformat(timespec="seconds") if updated else None,
            "exclude_from_balance": False,
        })
        sensor_history = _history_rows(readings.get(sensor_id, []), period, config["id"], config["name"])
        if not sensor_history and bos_rows:
            sensor_history = _bos_history_rows(bos_rows, POZO_BOS_TABLE, prefix, index, period, config["id"], config["name"])
            if sensor_history and source_status == "sin_datos":
                source_status = "bos_fallback"
                items[-1]["source_status"] = source_status
        history.extend(sensor_history)
    return items, history

def _build_lines(
    line_row: dict[str, Any] | None,
    line_first: dict[str, Any] | None,
    readings: dict[int, list[dict[str, Any]]],
    period: str,
    bos_rows: list[dict[str, Any]] | None = None,
    previous_totalizers: dict[int, float] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    updated = _normalize_timestamp(_first(line_row, "time_stamp", "timestamp"), LINEA_BOS_TABLE)
    communication, communication_type, age = _communication(updated, 5)
    items: list[dict[str, Any]] = []
    history: list[dict[str, Any]] = []
    for config in LINES:
        index = int(config["bos_index"])
        sensor_id = int(config["sensor_id"])
        previous_totalizer_m3 = (previous_totalizers or {}).get(sensor_id)
        flow = _num(_bos_value(line_row, "LINEA_FLOW_IN", index, "instant_value", None), None)
        total = _num(_bos_value(line_row, "LINEA_FLOW_IN", index, "total_value", None), None)
        period_info = _period_delta(readings.get(sensor_id, []))
        source_status = "readings_minute"
        if period_info["status"] == "sin_datos":
            period_info = _bos_period_delta(line_first, line_row, "LINEA_FLOW_IN", index)
            source_status = "bos_fallback" if period_info["status"] != "sin_datos" else "sin_datos"
        status, status_type, active = _operational_status(flow, flow is not None or total is not None)
        items.append({
            **config,
            "numero": index + 1,
            "nombre": config["name"],
            "ubicacion": "Líneas de producción",
            "flow_lps": flow,
            "flow": flow,
            "totalizador_m3": total,
            "total_m3": total,
            "totalizador_inicio_dia_m3": previous_totalizer_m3,
            "totalizador_cierre_anterior_m3": previous_totalizer_m3,
            "previous_totalizer_m3": previous_totalizer_m3,
            "previous_totalizer_source": "last_valid_reading_before_t0" if previous_totalizer_m3 is not None else "missing_previous_reading",
            "period_m3": period_info.get("value"),
            "period_delta_m3": period_info.get("value"),
            "period_status": period_info.get("status"),
            "period_note": period_info.get("note"),
            "source_status": source_status,
            "active": active,
            "status": status,
            "statusType": status_type,
            "estado_comunicacion": communication,
            "communicationType": communication_type,
            "age_minutes": age,
            "updated": updated.isoformat(timespec="seconds") if updated else None,
            "ultima_lectura": updated.isoformat(timespec="seconds") if updated else None,
        })
        sensor_history = _history_rows(readings.get(sensor_id, []), period, config["id"], config["name"])
        if not sensor_history and bos_rows:
            sensor_history = _bos_history_rows(bos_rows, LINEA_BOS_TABLE, "LINEA_FLOW_IN", index, period, config["id"], config["name"])
            if sensor_history and source_status == "sin_datos":
                source_status = "bos_fallback"
                items[-1]["source_status"] = source_status
        history.extend(sensor_history)
    return items, history


def _build_flows(
    flow_row: dict[str, Any] | None,
    flow_first: dict[str, Any] | None,
    readings: dict[int, list[dict[str, Any]]],
    period: str,
    bos_rows: list[dict[str, Any]] | None = None,
    previous_totalizers: dict[int, float] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    group_locations = {
        "tam": "Medidores de TAM",
        "embotellado": "Medidores de embotellado",
        "cisterna": "Medidor de cisterna",
    }
    updated = _normalize_timestamp(_first(flow_row, "time_stamp", "timestamp"), TANQUE_BOS_TABLE)
    communication, communication_type, age = _communication(updated, 5)
    items: list[dict[str, Any]] = []
    history: list[dict[str, Any]] = []
    for config in FLOWS:
        if not config.get("visible", True):
            continue
        index = int(config["bos_index"])
        sensor_id = int(config["sensor_id"])
        previous_totalizer_m3 = (previous_totalizers or {}).get(sensor_id)
        flow = _num(_bos_value(flow_row, "TANQUE_FLOW_IN", index, "instant_value", None), None)
        total = _num(_bos_value(flow_row, "TANQUE_FLOW_IN", index, "total_value", None), None)
        period_info = _period_delta(readings.get(sensor_id, []))
        source_status = "readings_minute"
        if period_info["status"] == "sin_datos":
            period_info = _bos_period_delta(flow_first, flow_row, "TANQUE_FLOW_IN", index)
            source_status = "bos_fallback" if period_info["status"] != "sin_datos" else "sin_datos"
        configured_idle = config.get("expected_activity") == "configured_without_recent_activity"
        status, status_type, active = _operational_status(flow, flow is not None or total is not None, configured_idle=configured_idle)
        items.append({
            **config,
            "numero": index + 1,
            "nombre": config["name"],
            "ubicacion": group_locations.get(str(config.get("module_group") or ""), "Medidores de agua"),
            "flow_lps": flow,
            "flow": flow,
            "totalizador_m3": total,
            "total_m3": total,
            "totalizador_inicio_dia_m3": previous_totalizer_m3,
            "totalizador_cierre_anterior_m3": previous_totalizer_m3,
            "previous_totalizer_m3": previous_totalizer_m3,
            "previous_totalizer_source": "last_valid_reading_before_t0" if previous_totalizer_m3 is not None else "missing_previous_reading",
            "period_m3": period_info.get("value"),
            "period_delta_m3": period_info.get("value"),
            "period_status": period_info.get("status"),
            "period_note": period_info.get("note"),
            "source_status": source_status,
            "active": active,
            "status": status,
            "statusType": status_type,
            "estado_comunicacion": communication,
            "communicationType": communication_type,
            "age_minutes": age,
            "updated": updated.isoformat(timespec="seconds") if updated else None,
            "ultima_lectura": updated.isoformat(timespec="seconds") if updated else None,
        })
        sensor_history = _history_rows(readings.get(sensor_id, []), period, config["id"], config["name"])
        if not sensor_history and bos_rows:
            sensor_history = _bos_history_rows(bos_rows, TANQUE_BOS_TABLE, "TANQUE_FLOW_IN", index, period, config["id"], config["name"])
            if sensor_history and source_status == "sin_datos":
                source_status = "bos_fallback"
                items[-1]["source_status"] = source_status
        history.extend(sensor_history)
    return items, history


def _level_status(level_m: float | None, minimum_m: float, maximum_m: float, communication_type: str) -> tuple[str, str]:
    if level_m is None or communication_type == "warning":
        return "Sin comunicación", "communication"
    if level_m < minimum_m:
        return "Nivel bajo", "warning"
    if level_m > maximum_m:
        return "Nivel alto / revisar", "critical"
    return "Normal", "normal"


def _build_levels(level_row: dict[str, Any] | None, history_rows: list[dict[str, Any]], period: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    updated = _normalize_timestamp(_first(level_row, "time_stamp", "timestamp"), NIVELES_BOS_TABLE)
    communication, communication_type, age = _communication(updated, 90, periodic=True)
    items: list[dict[str, Any]] = []
    history: list[dict[str, Any]] = []
    for config in LEVELS:
        raw = _num(_first(level_row, config["column"], default=None), None)
        level_m = round(raw * float(config["scale"]), 2) if raw is not None else None
        percentage = round((level_m / float(config["maximum_m"])) * 100, 2) if level_m is not None and config["maximum_m"] else None
        status, status_type = _level_status(level_m, float(config["minimum_m"]), float(config["maximum_m"]), communication_type)
        items.append({
            **config,
            "height_m": level_m,
            "level_m": level_m,
            "fill_pct": percentage,
            "percentage": percentage,
            "status": status,
            "statusType": status_type,
            "estado_comunicacion": communication,
            "communicationType": communication_type,
            "age_minutes": age,
            "updated": updated.isoformat(timespec="seconds") if updated else None,
            "ultima_lectura": updated.isoformat(timespec="seconds") if updated else None,
        })

        grouped: dict[datetime, list[float]] = defaultdict(list)
        for row in history_rows:
            timestamp = _normalize_timestamp(_first(row, "time_stamp", "timestamp"), NIVELES_BOS_TABLE)
            value = _num(_first(row, config["column"], default=None), None)
            if timestamp and value is not None:
                grouped[_bucket(timestamp, period)].append(value * float(config["scale"]))
        for bucket, values in sorted(grouped.items()):
            avg = sum(values) / len(values)
            history.append({
                "id": config["id"],
                "name": config["name"],
                "bucket": bucket.isoformat(timespec="seconds"),
                "timestamp": bucket.isoformat(timespec="seconds"),
                "level_m": round(avg, 3),
                "fill_pct": round((avg / float(config["maximum_m"])) * 100, 2),
            })
    return items, history


def _scaled(row: dict[str, Any] | None, field: str) -> float | None:
    value = _num(_first(row, field, default=None), None)
    if value is None:
        return None
    factor = float(UV.get("field_scale", {}).get(field, 1.0) or 1.0)
    return round(value / factor, 4) if factor != 1.0 else value


def _build_uv(uv_row: dict[str, Any] | None, history_rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any], list[dict[str, Any]]]:
    updated = _normalize_timestamp(_first(uv_row, "time_stamp", "timestamp"), UV_BOS_TABLE)
    communication, communication_type, age = _communication(updated, int(UV["communication_minutes"]), periodic=True)
    shared_uvt = _scaled(uv_row, "UVT")
    shared_power = _scaled(uv_row, "Power")
    shared_flow = _scaled(uv_row, "Flow")
    shared_dose = _scaled(uv_row, "Dosis")
    lamps: list[dict[str, Any]] = []
    for config in UV["lamps"]:
        raw_state = _num(_first(uv_row, config["state_field"], default=None), None)
        state_number = int(raw_state) if raw_state is not None else None
        state = UV["state_map"].get(state_number, "Sin lectura") if state_number is not None else "Sin lectura"
        status_type = "normal" if state_number == 2 else ("warning" if state_number == 1 else ("idle" if state_number == 0 else "communication"))
        if communication_type == "warning":
            status_type = "communication"
        lamps.append({
            **config,
            # Contrato visual confirmado contra SCADA: Ignition muestra el código crudo
            # de Lamp_State (0/1/2) y State muestra su interpretación operativa.
            "ignition": state_number,
            "state_code": state_number,
            "state": state,
            "status": state,
            "statusType": status_type,
            "agel": _scaled(uv_row, config["agel_field"]),
            "uvt": shared_uvt,
            "power": shared_power,
            "flow": shared_flow,
            "dose": shared_dose,
            "status_reading": _scaled(uv_row, config["status_field"]),
            "estado_comunicacion": communication,
            "communicationType": communication_type,
            "age_minutes": age,
            "updated": updated.isoformat(timespec="seconds") if updated else None,
            "ultima_lectura": updated.isoformat(timespec="seconds") if updated else None,
        })

    summary = {
        "uvt": shared_uvt,
        "power": shared_power,
        "flow": shared_flow,
        "dose": shared_dose,
        "updated": updated.isoformat(timespec="seconds") if updated else None,
        "estado_comunicacion": communication,
        "communicationType": communication_type,
    }
    history: list[dict[str, Any]] = []
    for row in history_rows:
        timestamp = _normalize_timestamp(_first(row, "time_stamp", "timestamp"), UV_BOS_TABLE)
        if not timestamp:
            continue
        history.append({
            "timestamp": timestamp.isoformat(timespec="seconds"),
            "bucket": timestamp.isoformat(timespec="seconds"),
            "lamp_1_state": int(_num(_first(row, "Lamp_StateL1", default=-1), -1)),
            "lamp_2_state": int(_num(_first(row, "Lamp_StateL2", default=-1), -1)),
            "uvt": _scaled(row, "UVT"),
            "power": _scaled(row, "Power"),
            "flow": _scaled(row, "Flow"),
            "dose": _scaled(row, "Dosis"),
        })
    return lamps, summary, history


def _card(label: str, value: Any, unit: str, trend: str, accent: str) -> dict[str, Any]:
    return {"label": label, "value": value, "unit": unit, "trend": trend, "accent": accent}


def get_insurgentes_dashboard_payload(
    start_date: Any = None,
    end_date: Any = None,
    period: Any = None,
    include_history: bool = False,
    include_period_deltas: bool = False,
    section: str | None = None,
    **_: Any,
) -> dict[str, Any]:
    start, end = _date_bounds(start_date, end_date)
    normalized_period = _period_name(period, start, end)
    history_scope = str(section or '').strip().lower()
    # Niveles y UV usan tablas BOS propias. Cuando la pantalla sólo solicita uno
    # de esos históricos no tiene sentido recorrer además todos los sensores
    # hidráulicos de iot.readings_minute.
    needs_hydraulic_period = include_period_deltas or (include_history and history_scope not in {'niveles', 'uv'})
    sql_errors: list[str] = []
    readings_status = "not_requested"

    session = SessionLocal()
    try:
        try:
            pozo_row = _latest_row(session, POZO_BOS_TABLE)
            flow_row = _latest_row(session, TANQUE_BOS_TABLE)
            line_row = None
            level_row = None
            uv_row = None
        except SQLAlchemyError as exc:
            logger.error("Insurgentes current data query failed error=%s", type(exc).__name__)
            return {"__sql_error__": True, "source_status": "error_sql"}

        pozo_first = line_first = flow_first = None
        pozo_period_rows: list[dict[str, Any]] = []
        line_period_rows: list[dict[str, Any]] = []
        flow_period_rows: list[dict[str, Any]] = []
        sosa_period_rows: list[dict[str, Any]] = []
        previous_well_totalizers: dict[int, float] = {}
        previous_line_totalizers: dict[int, float] = {}
        previous_flow_totalizers: dict[int, float] = {}
        sosa_previous_totalizer_m3: float | None = None
        readings: dict[int, list[dict[str, Any]]] = {}
        if needs_hydraulic_period:
            raw_readings, readings_status = _readings_rows(
                session,
                [
                    WATER_ENTRY["primary_sensor_id"],
                    WATER_ENTRY["backup_sensor_id"],
                    *_reading_sensor_ids(WELLS),
                    *[item["sensor_id"] for item in LINES],
                    *[item["sensor_id"] for item in FLOWS],
                ],
                start,
                end,
                normalized_period,
            )
            readings = _readings_by_sensor(raw_readings)

            # "Cierre anterior" is a boundary value, not a sample from the
            # current day. Recover the last positive totalizer strictly before
            # T0 so cards and the aggregate KPI share the [T0,T1) contract.
            try:
                previous_sensor_ids = [
                    *_reading_sensor_ids(WELLS),
                    *[int(item["sensor_id"]) for item in LINES],
                    *[int(item["sensor_id"]) for item in FLOWS if item.get("visible", True)],
                ]
                previous_rows = _previous_readings_rows(session, previous_sensor_ids, start)
                previous_by_sensor = _readings_by_sensor(previous_rows)

                well_sensor_ids = set(_reading_sensor_ids(WELLS))
                line_sensor_ids = {int(item["sensor_id"]) for item in LINES}
                flow_sensor_ids = {int(item["sensor_id"]) for item in FLOWS if item.get("visible", True)}
                for sensor_id, rows_for_sensor in previous_by_sensor.items():
                    if not rows_for_sensor:
                        continue
                    value = _num(rows_for_sensor[-1].get("total_value"), None)
                    if value is None or value <= 0:
                        continue
                    numeric_sensor_id = int(sensor_id)
                    if numeric_sensor_id in well_sensor_ids:
                        previous_well_totalizers[numeric_sensor_id] = value
                    if numeric_sensor_id in line_sensor_ids:
                        previous_line_totalizers[numeric_sensor_id] = value
                    if numeric_sensor_id in flow_sensor_ids:
                        previous_flow_totalizers[numeric_sensor_id] = value

            except SQLAlchemyError as exc:
                logger.warning("Insurgentes previous module totalizers query failed error=%s", type(exc).__name__)
                try:
                    session.rollback()
                except Exception:
                    pass

            if readings_status in {"sin_datos", "timeout", "error_sql"}:
                try:
                    pozo_period_rows = _range_rows(session, POZO_BOS_TABLE, start, end, 3000)
                    flow_period_rows = _range_rows(session, TANQUE_BOS_TABLE, start, end, 3000)
                    pozo_first = pozo_period_rows[0] if pozo_period_rows else None
                    flow_first = flow_period_rows[0] if flow_period_rows else None
                except SQLAlchemyError as exc:
                    sql_errors.append(type(exc).__name__)
                    try:
                        session.rollback()
                    except Exception:
                        pass
        expected_sensor_ids = {WATER_ENTRY["primary_sensor_id"], *_reading_sensor_ids(WELLS), *[item["sensor_id"] for item in LINES], *[item["sensor_id"] for item in FLOWS]}
        missing_history_sensor = needs_hydraulic_period and any(len(readings.get(int(sensor_id), [])) < 2 for sensor_id in expected_sensor_ids)
        if needs_hydraulic_period and missing_history_sensor and not pozo_period_rows:
            try:
                pozo_period_rows = _range_rows(session, POZO_BOS_TABLE, start, end, 3000)
                flow_period_rows = _range_rows(session, TANQUE_BOS_TABLE, start, end, 3000)
                pozo_first = pozo_first or (pozo_period_rows[0] if pozo_period_rows else None)
                flow_first = flow_first or (flow_period_rows[0] if flow_period_rows else None)
            except SQLAlchemyError as exc:
                sql_errors.append(type(exc).__name__)
                try:
                    session.rollback()
                except Exception:
                    pass

        if pozo_first is None and include_period_deltas:
            try:
                pozo_period_rows = _range_rows(session, POZO_BOS_TABLE, start, end, 3000)
                pozo_first = pozo_period_rows[0] if pozo_period_rows else None
            except SQLAlchemyError:
                pass
        if flow_first is None and include_period_deltas:
            try:
                flow_period_rows = _range_rows(session, TANQUE_BOS_TABLE, start, end, 3000)
                flow_first = flow_period_rows[0] if flow_period_rows else None
            except SQLAlchemyError:
                pass

        level_history_rows: list[dict[str, Any]] = []
        uv_history_rows: list[dict[str, Any]] = []
        if include_history:
            if history_scope != 'uv':
                try:
                    level_history_rows = _range_rows_chunked(session, NIVELES_BOS_TABLE, start, end)
                except SQLAlchemyError as exc:
                    sql_errors.append(type(exc).__name__)
            if history_scope != 'niveles':
                try:
                    uv_history_rows = _range_rows_chunked(session, UV_BOS_TABLE, start, end)
                except SQLAlchemyError as exc:
                    sql_errors.append(type(exc).__name__)

        entry, entry_history, entry_source = _build_entry(pozo_row, pozo_first, readings, normalized_period, pozo_period_rows)
        wells, well_history = _build_wells(
            pozo_row,
            pozo_first,
            readings,
            normalized_period,
            pozo_period_rows,
            flow_row,
            sosa_period_rows,
            previous_totalizers=previous_well_totalizers,
            sosa_previous_totalizer_m3=sosa_previous_totalizer_m3,
        )
        lines, line_history = _build_lines(
            line_row,
            line_first,
            readings,
            normalized_period,
            line_period_rows,
            previous_totalizers=previous_line_totalizers,
        )
        flows, flow_history = _build_flows(
            flow_row,
            flow_first,
            readings,
            normalized_period,
            flow_period_rows,
            previous_totalizers=previous_flow_totalizers,
        )
        levels, level_history = _build_levels(level_row, level_history_rows, normalized_period)
        uv_lamps, uv_summary, uv_history = _build_uv(uv_row, uv_history_rows)

        # Tiempo activo y conteo de encendidos por minuto observado. Se calcula
        # aparte del histórico agregado para no estimar actividad a partir de
        # promedios horarios/diarios.
        if needs_hydraulic_period:
            now_local = datetime.now(LOCAL_ZONE).replace(tzinfo=None)
            activity_end = min(end, now_local) if start <= now_local < end else end
            if activity_end > start:
                activity_sensor_ids = [
                    WATER_ENTRY["primary_sensor_id"],
                    *_reading_sensor_ids(WELLS),
                    *[item["sensor_id"] for item in LINES],
                    *[item["sensor_id"] for item in FLOWS],
                ]
                activity_metrics = _activity_metrics_by_sensor(session, activity_sensor_ids, start, activity_end)
                _apply_activity_metrics([entry], activity_metrics)
                _apply_activity_metrics(wells, activity_metrics)
                _apply_activity_metrics(lines, activity_metrics)
                _apply_activity_metrics(flows, activity_metrics)
                for item in wells:
                    if item.get("is_sosa"):
                        item.update(_activity_metrics_from_rows(sosa_period_rows, start, activity_end))

        active_wells = sum(1 for item in wells if item.get("active"))
        wells_volume = round(sum(float(item.get("period_m3") or 0) for item in wells if item.get("period_status") == "valid"), 4)
        active_flows = sum(1 for item in flows if item.get("active"))
        tam_flows = [item for item in flows if item.get("module_group") == "tam"]
        bottling_flows = [item for item in flows if item.get("module_group") == "embotellado"]
        cistern_flows = [item for item in flows if item.get("module_group") == "cisterna"]
        updated_candidates = [
            _parse_datetime(entry.get("updated")),
            *[_parse_datetime(item.get("updated")) for item in wells],
            *[_parse_datetime(item.get("updated")) for item in lines],
            *[_parse_datetime(item.get("updated")) for item in flows],
            *[_parse_datetime(item.get("updated")) for item in levels],
            *[_parse_datetime(item.get("updated")) for item in uv_lamps],
        ]
        latest_update = max((value for value in updated_candidates if value), default=None)

        source_status = "bos_current" if readings_status == "not_requested" else readings_status
        if readings_status in {"timeout", "error_sql", "sin_datos"} and any(item.get("source_status") == "bos_fallback" for item in [entry, *wells, *lines, *flows]):
            source_status = "bos_fallback"
        elif readings_status == "readings_minute" and any(item.get("source_status") == "bos_fallback" for item in [entry, *wells, *lines, *flows]):
            source_status = "mixed"
        if sql_errors and source_status not in {"timeout", "error_sql"}:
            source_status = "partial_error_sql"

        cards = [
            _card("Pozos con actividad", f"{active_wells}/{len(wells)}", "pozos", f"Volumen válido del día: {wells_volume:.2f} m³", "cyan"),
            _card("Medidores TAM", f"{sum(1 for item in tam_flows if item.get('active'))}/{len(tam_flows)}", "medidores", "Señales confirmadas de TAM", "blue"),
            _card("Medidores de embotellado", f"{sum(1 for item in bottling_flows if item.get('active'))}/{len(bottling_flows)}", "medidores", "Señales confirmadas de embotellado", "green"),
            _card("Salida de cisterna", f"{sum(1 for item in cistern_flows if item.get('active'))}/{len(cistern_flows)}", "medidor", "Señal confirmada de cisterna", "blue"),
            _card("Medidores con actividad", f"{active_flows}/{len(flows)}", "medidores", "TAM, embotellado y cisterna", "cyan"),
        ]

        return {
            "title": DASHBOARD_TITLE,
            "subtitle": "Monitoreo operativo de agua de Planta Las Fuentes",
            "cards": cards,
            "water_entry_by_well": [{"name": entry["name"], "value": entry.get("period_m3") or 0, "unit": "m³", "detail": entry.get("period_note") or "Volumen del periodo"}],
            "water_consumption": [],
            "tank_levels": [],
            "supply_hours": [],
            "filters_vs_treated": [],
            "cip_weekly": [],
            "entry_vs_exit": [],
            "monthly_averages": [],
            "daily_indicators": [],
            "report_modules": ["Reportes pendientes de validación operativa para Las Fuentes"],
            "hourly_flow": [],
            "wells": wells,
            "pozos": wells,
            "sensors": [],
            "production_lines": lines,
            "tank_inputs": levels,
            "distribution_flows": flows,
            "flows": flows,
            "water_entry": entry,
            "entry_flow_history": entry_history if include_history else [],
            "well_flow_history": well_history if include_history else [],
            "production_line_history": line_history if include_history else [],
            "flow_history": flow_history if include_history else [],
            "tank_level_history": level_history if include_history else [],
            "uv_lamps": uv_lamps,
            "uv_summary": uv_summary,
            "uv_history": uv_history if include_history else [],
            "washers": WASHERS,
            "plant": PLANT_DISPLAY_NAME,
            "aggregation": normalized_period,
            "date_range": {"start_date": start.date().isoformat(), "end_date": (end - timedelta(days=1)).date().isoformat()},
            "source_status": source_status,
            "readings_minute_status": readings_status,
            "fallback_rules": {"current": "Medición operativa", "history": "Histórico con respaldo operativo cuando no hay datos válidos"},
            "updated_at": latest_update or datetime.now(LOCAL_ZONE).replace(tzinfo=None),
            "last_update": latest_update.isoformat(timespec="seconds") if latest_update else None,
        }
    finally:
        session.close()



def _parse_shift_date(value: Any = None) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if value:
        try:
            return date.fromisoformat(str(value)[:10])
        except ValueError:
            pass
    return datetime.now(LOCAL_ZONE).date()


def _shift_time_to_minutes(value: str) -> int:
    raw = str(value or '').strip()
    if raw == '24:00':
        return 24 * 60
    hour, minute = raw.split(':', 1)
    return int(hour) * 60 + int(minute)


def _shift_windows_for_day(day: date) -> list[dict[str, Any]]:
    windows: list[dict[str, Any]] = []
    base = datetime.combine(day, time.min)
    for config in SHIFT_WINDOWS:
        start_minutes = _shift_time_to_minutes(str(config['start']))
        end_minutes = _shift_time_to_minutes(str(config['end']))
        start_dt = base + timedelta(minutes=start_minutes)
        end_dt = base + timedelta(minutes=end_minutes)
        windows.append({
            'id': str(config['id']),
            'label': str(config['label']),
            'start_time': str(config['start']),
            'end_time': str(config['end']),
            'start': start_dt,
            'end': end_dt,
            'display': f"{config['start']}–{config['end']}",
        })
    return windows


def _shift_status(window: dict[str, Any], selected_day: date, now: datetime | None = None) -> dict[str, Any]:
    current = (now or datetime.now(LOCAL_ZONE)).replace(tzinfo=None)
    today = current.date()
    if selected_day < today:
        return {'code': 'closed', 'label': 'Cierre definitivo', 'is_current': False, 'is_future': False}
    if selected_day > today:
        return {'code': 'pending', 'label': 'Pendiente', 'is_current': False, 'is_future': True}
    if current < window['start']:
        return {'code': 'pending', 'label': 'Pendiente', 'is_current': False, 'is_future': True}
    if window['start'] <= current < window['end']:
        return {'code': 'partial', 'label': 'Corte parcial', 'is_current': True, 'is_future': False}
    return {'code': 'closed', 'label': 'Cierre definitivo', 'is_current': False, 'is_future': False}


def classify_insurgentes_shift(value: Any, source_table: str = LINEA_BOS_TABLE) -> str | None:
    """Return the shift id after timezone normalization. Used by tests and shift cuts."""
    timestamp = _normalize_timestamp(value, source_table)
    if not timestamp:
        return None
    minute_of_day = timestamp.hour * 60 + timestamp.minute
    for config in SHIFT_WINDOWS:
        start = _shift_time_to_minutes(str(config['start']))
        end = _shift_time_to_minutes(str(config['end']))
        if start <= minute_of_day < end:
            return str(config['id'])
    return None


def _rows_for_window(rows: list[dict[str, Any]], start: datetime, end: datetime, source_table: str | None = None) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for row in rows:
        timestamp = row.get('timestamp') if isinstance(row.get('timestamp'), datetime) else None
        if not timestamp:
            timestamp = _normalize_timestamp(_first(row, 'time_stamp', 'timestamp', 'ts_local', 'ts_minute', 'inserted_at'), source_table or '')
        if timestamp and start <= timestamp < end:
            next_row = dict(row)
            next_row['timestamp'] = timestamp
            output.append(next_row)
    output.sort(key=lambda item: item['timestamp'])
    return output


def _sample_stats(values: list[float | None]) -> dict[str, Any]:
    valid = [float(value) for value in values if value is not None and value >= 0]
    if not valid:
        return {'avg': None, 'min': None, 'max': None, 'active_samples': 0}
    return {
        'avg': round(sum(valid) / len(valid), 4),
        'min': round(min(valid), 4),
        'max': round(max(valid), 4),
        'active_samples': sum(1 for value in valid if value > 0),
    }


def _expected_minutes_for_window(window: dict[str, Any], status: dict[str, Any], now: datetime | None = None) -> int:
    if status['code'] == 'pending':
        return 0
    end = window['end']
    if status['code'] == 'partial':
        end = min((now or datetime.now(LOCAL_ZONE)).replace(tzinfo=None), window['end'])
    return max(int((end - window['start']).total_seconds() // 60), 1)


def _expected_samples_for_window(module: str, window: dict[str, Any], status: dict[str, Any], now: datetime | None = None) -> int:
    """Expected samples for a shift according to the module source cadence."""
    minutes = _expected_minutes_for_window(window, status, now)
    if minutes <= 0:
        return 0
    cadence = int(SHIFT_SAMPLE_CADENCE_MINUTES.get(module, 1) or 1)
    return max(int((minutes + cadence - 1) // cadence), 1)


def _coverage(samples: int, expected: int) -> float | None:
    if expected <= 0:
        return None
    return round(min(samples / expected * 100.0, 100.0), 2)


def _volume_item_from_rows(
    config: dict[str, Any],
    rows: list[dict[str, Any]],
    unit: str = 'L/s',
    expected_samples: int | None = None,
    *,
    start: datetime | None = None,
    end: datetime | None = None,
) -> dict[str, Any]:
    normalized_rows = [row for row in rows if isinstance(row.get('timestamp'), datetime)]
    normalized_rows.sort(key=lambda item: item['timestamp'])
    if start is None:
        start = normalized_rows[0]['timestamp'] if normalized_rows else datetime.now(LOCAL_ZONE).replace(tzinfo=None)
    if end is None:
        end = (normalized_rows[-1]['timestamp'] + timedelta(minutes=1)) if normalized_rows else start + timedelta(minutes=1)

    reconciled = reconcile_interval(normalized_rows, start, end, expected_samples=expected_samples)
    active_samples = sum(
        1 for row in normalized_rows
        if start <= row['timestamp'] < end and (_num(row.get('instant_value'), None) or 0) > 0
    )
    has_samples = int(reconciled.get('samples') or 0) > 0
    quality_status = str(reconciled.get('quality_status') or QUALITY_NO_DATA)
    if quality_status in {QUALITY_PARTIAL, QUALITY_REVIEW}:
        validation = 'Validación parcial'
    elif quality_status == QUALITY_NO_DATA:
        validation = 'No disponible'
    else:
        validation = 'Válida'
    observed_volume = reconciled.get('observed_volume_m3')
    activity = 'Con actividad' if active_samples > 0 or (observed_volume or 0) > 0 else ('Sin actividad' if has_samples else 'Sin datos')
    volume_status = 'valid' if reconciled.get('volume_reliable') else ('sin_datos' if quality_status == QUALITY_NO_DATA else 'dato_en_revision')
    return {
        'id': str(config.get('id') or config.get('name')),
        'name': str(config.get('name') or config.get('nombre') or config.get('id') or 'Elemento'),
        'type': 'volume',
        'unit': unit,
        'opening_m3': reconciled.get('totalizer_open_m3'),
        'closing_m3': reconciled.get('effective_totalizer_close_m3'),
        'volume_m3': reconciled.get('volume_m3'),
        'observed_volume_m3': observed_volume,
        'volume_reliable': bool(reconciled.get('volume_reliable')),
        'volume_status': volume_status,
        'volume_note': reconciled.get('review_reason') or '',
        'avg_flow': reconciled.get('flow_avg_lps'),
        'min_flow': reconciled.get('flow_min_lps'),
        'max_flow': reconciled.get('flow_max_lps'),
        'samples': int(reconciled.get('samples') or 0),
        'coverage_pct': reconciled.get('coverage_pct'),
        'active_samples': active_samples,
        'activity': activity,
        'communication': 'Actualizado' if has_samples else 'Sin información',
        'validation': validation,
        'has_data': has_samples,
        'opening_source': reconciled.get('opening_source'),
        'boundary_complete': bool(reconciled.get('boundary_complete')),
        'data_status': reconciled.get('data_status'),
        'quality_status': quality_status,
        'quality_label': reconciled.get('quality_label'),
        'totalizer_retained': bool(reconciled.get('totalizer_retained')),
        'review_reason': reconciled.get('review_reason'),
        'negative_totalizer_transitions': int(reconciled.get('negative_totalizer_transitions') or 0),
        'impossible_totalizer_jumps': int(reconciled.get('impossible_totalizer_jumps') or 0),
    }


def _bos_volume_item(
    config: dict[str, Any],
    rows: list[dict[str, Any]],
    table: str,
    prefix: str,
    unit: str = 'L/s',
    expected_samples: int | None = None,
    *,
    start: datetime | None = None,
    end: datetime | None = None,
) -> dict[str, Any]:
    index = int(config.get('bos_index', 0))
    normalized_rows: list[dict[str, Any]] = []
    for row in rows:
        instant = _num(_bos_value(row, prefix, index, 'instant_value', None), None)
        total = _num(_bos_value(row, prefix, index, 'total_value', None), None)
        if instant is None and total is None:
            continue
        timestamp = _normalize_timestamp(_first(row, 'time_stamp', 'timestamp'), table)
        if timestamp:
            normalized_rows.append({'timestamp': timestamp, 'instant_value': instant, 'total_value': total})
    return _volume_item_from_rows(
        config,
        normalized_rows,
        unit=unit,
        expected_samples=expected_samples,
        start=start,
        end=end,
    )

def _level_item_from_rows(config: dict[str, Any], rows: list[dict[str, Any]], expected_samples: int) -> dict[str, Any]:
    values: list[float] = []
    for row in rows:
        raw = _num(_first(row, str(config['column']), default=None), None)
        if raw is not None:
            values.append(raw * float(config.get('scale') or 1.0))
    stats = _sample_stats(values)
    samples = len(values)
    return {
        'id': str(config['id']),
        'name': str(config['name']),
        'type': 'level',
        'initial_level_m': round(values[0], 4) if values else None,
        'final_level_m': round(values[-1], 4) if values else None,
        'avg_level_m': stats['avg'],
        'min_level_m': stats['min'],
        'max_level_m': stats['max'],
        'samples': samples,
        'coverage_pct': _coverage(samples, expected_samples),
        'activity': 'Con lectura' if samples else 'Sin datos',
        'communication': 'Actualizado' if samples else 'Sin información',
        'validation': 'Válida' if samples else 'No disponible',
        'has_data': samples > 0,
    }


def _uv_item_from_rows(config: dict[str, Any], rows: list[dict[str, Any]], expected_samples: int) -> dict[str, Any]:
    states: list[float] = []
    agel_values: list[float] = []
    status_values: list[float] = []
    for row in rows:
        state = _num(_first(row, str(config['state_field']), default=None), None)
        agel = _num(_first(row, str(config['agel_field']), default=None), None)
        status_reading = _num(_first(row, str(config['status_field']), default=None), None)
        if state is not None:
            states.append(state)
        if agel is not None:
            agel_values.append(agel)
        if status_reading is not None:
            status_values.append(status_reading)
    state_stats = _sample_stats(states)
    samples = max(len(states), len(agel_values), len(status_values))
    return {
        'id': str(config['id']),
        'name': str(config['name']),
        'type': 'uv',
        'initial_state': int(states[0]) if states else None,
        'final_state': int(states[-1]) if states else None,
        'avg_state': state_stats['avg'],
        'min_state': state_stats['min'],
        'max_state': state_stats['max'],
        'avg_agel': _sample_stats(agel_values)['avg'],
        'avg_status_reading': _sample_stats(status_values)['avg'],
        'samples': samples,
        'coverage_pct': _coverage(samples, expected_samples),
        'activity': 'Encendida' if any(value == 2 for value in states) else ('Sin encendido' if samples else 'Sin datos'),
        'communication': 'Actualizado' if samples else 'Sin información',
        'validation': 'Válida' if samples else 'No disponible',
        'has_data': samples > 0,
    }


def _uv_system_summary_from_rows(rows: list[dict[str, Any]], expected_samples: int) -> dict[str, Any]:
    fields = UV.get('system_fields', {})
    summary: dict[str, Any] = {'type': 'uv_system'}
    sample_counts: list[int] = []
    for field, meta in fields.items():
        values = [_scaled(row, field) for row in rows]
        valid = [value for value in values if value is not None]
        stats = _sample_stats(valid)
        key = str(meta.get('key') or field).lower()
        summary[f'avg_{key}'] = stats['avg']
        summary[f'min_{key}'] = stats['min']
        summary[f'max_{key}'] = stats['max']
        sample_counts.append(len(valid))
    samples = max(sample_counts) if sample_counts else 0
    summary.update({
        'samples': samples,
        'coverage_pct': _coverage(samples, expected_samples),
        'communication': 'Actualizado' if samples else 'Sin información',
        'validation': 'Válida' if samples else 'No disponible',
        'has_data': samples > 0,
    })
    return summary


def _summarize_shift_items(items: list[dict[str, Any]], module: str) -> dict[str, Any]:
    volume_items = [item for item in items if item.get('type') == 'volume']
    if volume_items:
        volumes = [item.get('volume_m3') for item in volume_items if item.get('volume_m3') is not None]
        return {
            'module': module,
            'type': 'volume',
            'volume_m3': round(sum(float(value) for value in volumes), 4) if volumes else None,
            'active_count': sum(1 for item in volume_items if item.get('activity') == 'Con actividad'),
            'data_count': sum(1 for item in volume_items if item.get('has_data')),
            'total_count': len(volume_items),
            'validation_partial_count': sum(1 for item in volume_items if item.get('quality_status') in {QUALITY_PARTIAL, QUALITY_REVIEW} or item.get('validation') == 'Validación parcial'),
        }
    data_count = sum(1 for item in items if item.get('has_data'))
    return {
        'module': module,
        'type': items[0].get('type') if items else module,
        'volume_m3': None,
        'active_count': sum(1 for item in items if item.get('activity') not in {'Sin datos', 'Sin información'}),
        'data_count': data_count,
        'total_count': len(items),
        'validation_partial_count': sum(1 for item in items if item.get('quality_status') in {QUALITY_PARTIAL, QUALITY_REVIEW} or item.get('validation') == 'Validación parcial'),
    }


def get_insurgentes_shift_cuts(
    shift_date: Any = None,
    module: str | None = None,
    element_id: str | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Build shift cuts using existing normalized volume/timezone helpers."""
    selected_day = _parse_shift_date(shift_date)
    day_start = datetime.combine(selected_day, time.min)
    day_end = day_start + timedelta(days=1)
    selected_module = (module or 'all').lower().strip()
    now_local = (now or datetime.now(LOCAL_ZONE)).replace(tzinfo=None)
    windows = _shift_windows_for_day(selected_day)
    modules = ['entrada', 'pozos', 'lineas', 'flujos', 'niveles', 'uv'] if selected_module in {'', 'all', 'dashboard'} else [selected_module]

    session = SessionLocal()
    try:
        readings_by_module: dict[str, dict[int, list[dict[str, Any]]]] = {}
        bos_rows: dict[str, list[dict[str, Any]]] = {}
        if 'entrada' in modules:
            raw, _ = _readings_rows(session, [WATER_ENTRY['primary_sensor_id'], WATER_ENTRY['backup_sensor_id']], day_start, day_end, 'minute', include_previous=True)
            readings_by_module['entrada'] = _readings_by_sensor(raw)
            bos_rows['entrada'] = _range_rows(session, POZO_BOS_TABLE, day_start - timedelta(days=1), day_end, 5000)
        if 'pozos' in modules:
            raw, _ = _readings_rows(session, _reading_sensor_ids(WELLS), day_start, day_end, 'minute', include_previous=True)
            readings_by_module['pozos'] = _readings_by_sensor(raw)
            bos_rows['pozos'] = _range_rows(session, POZO_BOS_TABLE, day_start - timedelta(days=1), day_end, 5000)
            bos_rows['pozos_sosa'] = _sosa_minute_rows(session, day_start - timedelta(days=1), day_end, 30000)
        if 'lineas' in modules:
            raw, _ = _readings_rows(session, [item['sensor_id'] for item in LINES], day_start, day_end, 'minute', include_previous=True)
            readings_by_module['lineas'] = _readings_by_sensor(raw)
            bos_rows['lineas'] = _range_rows(session, LINEA_BOS_TABLE, day_start - timedelta(days=1), day_end, 5000)
        if 'flujos' in modules:
            raw, _ = _readings_rows(session, [item['sensor_id'] for item in FLOWS if item.get('visible', True)], day_start, day_end, 'minute', include_previous=True)
            readings_by_module['flujos'] = _readings_by_sensor(raw)
            bos_rows['flujos'] = _range_rows(session, TANQUE_BOS_TABLE, day_start - timedelta(days=1), day_end, 5000)
        if 'niveles' in modules:
            bos_rows['niveles'] = _range_rows(session, NIVELES_BOS_TABLE, day_start, day_end, 5000)
        if 'uv' in modules:
            bos_rows['uv'] = _range_rows(session, UV_BOS_TABLE, day_start, day_end, 5000)

        shifts: list[dict[str, Any]] = []
        for window in windows:
            status = _shift_status(window, selected_day, now_local)
            expected = _expected_minutes_for_window(window, status, now_local)
            module_payloads: list[dict[str, Any]] = []
            all_items: list[dict[str, Any]] = []
            for mod in modules:
                items: list[dict[str, Any]] = []
                expected_for_module = _expected_samples_for_window(mod, window, status, now_local)
                if status['code'] == 'pending':
                    configs: list[dict[str, Any]]
                    if mod == 'entrada':
                        configs = [WATER_ENTRY]
                    elif mod == 'pozos':
                        configs = list(WELLS)
                    elif mod == 'lineas':
                        configs = list(LINES)
                    elif mod == 'flujos':
                        configs = [item for item in FLOWS if item.get('visible', True)]
                    elif mod == 'niveles':
                        configs = list(LEVELS)
                    elif mod == 'uv':
                        configs = list(UV['lamps'])
                    else:
                        configs = []
                    for config in configs:
                        if element_id and str(config.get('id')) != str(element_id):
                            continue
                        items.append({'id': str(config.get('id')), 'name': str(config.get('name')), 'type': mod, 'activity': 'Pendiente', 'communication': 'Pendiente', 'validation': 'Pendiente', 'has_data': False})
                elif mod == 'entrada':
                    config = {'id': WATER_ENTRY['id'], 'name': WATER_ENTRY['name'], 'sensor_id': WATER_ENTRY['primary_sensor_id']}
                    if element_id and str(element_id) != WATER_ENTRY['id']:
                        items = []
                    else:
                        rows = readings_by_module.get('entrada', {}).get(WATER_ENTRY['primary_sensor_id'], [])
                        if len([row for row in rows if window['start'] <= row.get('timestamp', datetime.min) < window['end']]) < 1:
                            rows = readings_by_module.get('entrada', {}).get(WATER_ENTRY['backup_sensor_id'], [])
                        item = _volume_item_from_rows(config, rows, expected_samples=expected_for_module, start=window['start'], end=window['end'])
                        if not item.get('has_data'):
                            item = _bos_volume_item({'id': WATER_ENTRY['id'], 'name': WATER_ENTRY['name'], 'bos_index': WATER_ENTRY['primary_bos']['index']}, bos_rows.get('entrada', []), POZO_BOS_TABLE, WATER_ENTRY['primary_bos']['prefix'], expected_samples=expected_for_module, start=window['start'], end=window['end'])
                        items = [item]
                elif mod == 'pozos':
                    for config in WELLS:
                        if element_id and str(config.get('id')) != str(element_id):
                            continue
                        if _is_sosa_well(config):
                            rows = bos_rows.get('pozos_sosa', [])
                            item = _volume_item_from_rows(config, rows, expected_samples=expected_for_module, start=window['start'], end=window['end'])
                            item['exclude_from_balance'] = True
                            item['is_sosa'] = True
                            items.append(item)
                            continue
                        rows = readings_by_module.get('pozos', {}).get(int(config['sensor_id']), [])
                        item = _volume_item_from_rows(config, rows, expected_samples=expected_for_module, start=window['start'], end=window['end'])
                        if not item.get('has_data'):
                            item = _bos_volume_item(config, bos_rows.get('pozos', []), POZO_BOS_TABLE, str(config.get('bos_prefix') or 'POZO_FLOW_OUT'), expected_samples=expected_for_module, start=window['start'], end=window['end'])
                        item['exclude_from_balance'] = False
                        items.append(item)
                elif mod == 'lineas':
                    for config in LINES:
                        if element_id and str(config.get('id')) != str(element_id):
                            continue
                        rows = readings_by_module.get('lineas', {}).get(int(config['sensor_id']), [])
                        item = _volume_item_from_rows(config, rows, expected_samples=expected_for_module, start=window['start'], end=window['end'])
                        if not item.get('has_data'):
                            item = _bos_volume_item(config, bos_rows.get('lineas', []), LINEA_BOS_TABLE, 'LINEA_FLOW_IN', expected_samples=expected_for_module, start=window['start'], end=window['end'])
                        items.append(item)
                elif mod == 'flujos':
                    for config in FLOWS:
                        if not config.get('visible', True):
                            continue
                        if element_id and str(config.get('id')) != str(element_id):
                            continue
                        rows = readings_by_module.get('flujos', {}).get(int(config['sensor_id']), [])
                        item = _volume_item_from_rows(config, rows, unit='m³/h', expected_samples=expected_for_module, start=window['start'], end=window['end'])
                        if not item.get('has_data'):
                            item = _bos_volume_item(config, bos_rows.get('flujos', []), TANQUE_BOS_TABLE, 'TANQUE_FLOW_IN', unit='m³/h', expected_samples=expected_for_module, start=window['start'], end=window['end'])
                        items.append(item)
                elif mod == 'niveles':
                    rows = _rows_for_window(bos_rows.get('niveles', []), window['start'], window['end'], NIVELES_BOS_TABLE)
                    for config in LEVELS:
                        if element_id and str(config.get('id')) != str(element_id):
                            continue
                        items.append(_level_item_from_rows(config, rows, expected_for_module))
                elif mod == 'uv':
                    rows = _rows_for_window(bos_rows.get('uv', []), window['start'], window['end'], UV_BOS_TABLE)
                    for config in UV['lamps']:
                        if element_id and str(config.get('id')) != str(element_id):
                            continue
                        items.append(_uv_item_from_rows(config, rows, expected_for_module))
                summary = _summarize_shift_items(items, mod)
                module_payload = {'module': mod, 'summary': summary, 'items': items}
                if mod == 'uv' and status['code'] != 'pending':
                    module_payload['system_summary'] = _uv_system_summary_from_rows(rows, expected_for_module)
                module_payloads.append(module_payload)
                all_items.extend(items)
            shifts.append({
                'id': window['id'],
                'label': window['label'],
                'schedule': window['display'],
                'start': window['start'].isoformat(timespec='seconds'),
                'end': window['end'].isoformat(timespec='seconds'),
                'status': status['code'],
                'status_label': status['label'],
                'is_current': status['is_current'],
                'is_future': status['is_future'],
                'modules': module_payloads,
                'items': all_items,
            })
        return {
            'plant': PLANT_DISPLAY_NAME,
            'date': selected_day.isoformat(),
            'module': selected_module,
            'element_id': element_id,
            'timezone': LOCAL_TIMEZONE,
            'interval_contract': '[T0,T1)',
            'opening_rule': 'last_valid_reading_before_t0',
            'windows': [{key: value for key, value in window.items() if key not in {'start', 'end'}} for window in windows],
            'shifts': shifts,
            'updated_at': now_local.isoformat(timespec='seconds'),
        }
    finally:
        session.close()


def get_insurgentes_interval_cut(
    start_datetime: Any,
    end_datetime: Any,
    module: str | None = None,
    element_id: str | None = None,
) -> dict[str, Any]:
    """Build one arbitrary closed operational interval using the same reconciler as shifts.

    This is intentionally limited to closed windows and exists so scheduled 12 h
    reports can use the exact [T0,T1) volume/quality contract instead of faking a
    half-day with a full calendar-day report.
    """
    start = _parse_datetime(start_datetime)
    end = _parse_datetime(end_datetime)
    if not start or not end:
        raise ValueError('El periodo programado no contiene fechas válidas.')
    if start.tzinfo is not None:
        start = start.astimezone(LOCAL_ZONE).replace(tzinfo=None)
    if end.tzinfo is not None:
        end = end.astimezone(LOCAL_ZONE).replace(tzinfo=None)
    if end <= start:
        raise ValueError('El cierre del periodo debe ser posterior a la apertura.')

    selected_module = (module or 'all').lower().strip()
    modules = ['entrada', 'pozos', 'lineas', 'flujos', 'niveles', 'uv'] if selected_module in {'', 'all', 'dashboard'} else [selected_module]
    expected_minutes = max(int((end - start).total_seconds() // 60), 1)

    session = SessionLocal()
    try:
        readings_by_module: dict[str, dict[int, list[dict[str, Any]]]] = {}
        bos_rows: dict[str, list[dict[str, Any]]] = {}
        if 'entrada' in modules:
            raw, _ = _readings_rows(session, [WATER_ENTRY['primary_sensor_id'], WATER_ENTRY['backup_sensor_id']], start, end, 'minute', include_previous=True)
            readings_by_module['entrada'] = _readings_by_sensor(raw)
            bos_rows['entrada'] = _range_rows(session, POZO_BOS_TABLE, start - timedelta(days=1), end, 5000)
        if 'pozos' in modules:
            raw, _ = _readings_rows(session, _reading_sensor_ids(WELLS), start, end, 'minute', include_previous=True)
            readings_by_module['pozos'] = _readings_by_sensor(raw)
            bos_rows['pozos'] = _range_rows(session, POZO_BOS_TABLE, start - timedelta(days=1), end, 5000)
            bos_rows['pozos_sosa'] = _sosa_minute_rows(session, start - timedelta(days=1), end, 30000)
        if 'lineas' in modules:
            raw, _ = _readings_rows(session, [item['sensor_id'] for item in LINES], start, end, 'minute', include_previous=True)
            readings_by_module['lineas'] = _readings_by_sensor(raw)
            bos_rows['lineas'] = _range_rows(session, LINEA_BOS_TABLE, start - timedelta(days=1), end, 5000)
        if 'flujos' in modules:
            raw, _ = _readings_rows(session, [item['sensor_id'] for item in FLOWS if item.get('visible', True)], start, end, 'minute', include_previous=True)
            readings_by_module['flujos'] = _readings_by_sensor(raw)
            bos_rows['flujos'] = _range_rows(session, TANQUE_BOS_TABLE, start - timedelta(days=1), end, 5000)
        if 'niveles' in modules:
            bos_rows['niveles'] = _range_rows(session, NIVELES_BOS_TABLE, start, end, 5000)
        if 'uv' in modules:
            bos_rows['uv'] = _range_rows(session, UV_BOS_TABLE, start, end, 5000)

        module_payloads: list[dict[str, Any]] = []
        all_items: list[dict[str, Any]] = []
        for mod in modules:
            cadence = int(SHIFT_SAMPLE_CADENCE_MINUTES.get(mod, 1) or 1)
            expected_for_module = max(int((expected_minutes + cadence - 1) // cadence), 1)
            items: list[dict[str, Any]] = []
            if mod == 'entrada':
                if not element_id or str(element_id) == WATER_ENTRY['id']:
                    config = {'id': WATER_ENTRY['id'], 'name': WATER_ENTRY['name'], 'sensor_id': WATER_ENTRY['primary_sensor_id']}
                    rows = readings_by_module.get('entrada', {}).get(WATER_ENTRY['primary_sensor_id'], [])
                    if len([row for row in rows if start <= row.get('timestamp', datetime.min) < end]) < 1:
                        rows = readings_by_module.get('entrada', {}).get(WATER_ENTRY['backup_sensor_id'], [])
                    item = _volume_item_from_rows(config, rows, expected_samples=expected_for_module, start=start, end=end)
                    if not item.get('has_data'):
                        item = _bos_volume_item({'id': WATER_ENTRY['id'], 'name': WATER_ENTRY['name'], 'bos_index': WATER_ENTRY['primary_bos']['index']}, bos_rows.get('entrada', []), POZO_BOS_TABLE, WATER_ENTRY['primary_bos']['prefix'], expected_samples=expected_for_module, start=start, end=end)
                    items = [item]
            elif mod == 'pozos':
                for config in WELLS:
                    if element_id and str(config.get('id')) != str(element_id):
                        continue
                    if _is_sosa_well(config):
                        item = _volume_item_from_rows(config, bos_rows.get('pozos_sosa', []), expected_samples=expected_for_module, start=start, end=end)
                        item['exclude_from_balance'] = True
                        item['is_sosa'] = True
                    else:
                        rows = readings_by_module.get('pozos', {}).get(int(config['sensor_id']), [])
                        item = _volume_item_from_rows(config, rows, expected_samples=expected_for_module, start=start, end=end)
                        if not item.get('has_data'):
                            item = _bos_volume_item(config, bos_rows.get('pozos', []), POZO_BOS_TABLE, str(config.get('bos_prefix') or 'POZO_FLOW_OUT'), expected_samples=expected_for_module, start=start, end=end)
                        item['exclude_from_balance'] = False
                    items.append(item)
            elif mod == 'lineas':
                for config in LINES:
                    if element_id and str(config.get('id')) != str(element_id):
                        continue
                    rows = readings_by_module.get('lineas', {}).get(int(config['sensor_id']), [])
                    item = _volume_item_from_rows(config, rows, expected_samples=expected_for_module, start=start, end=end)
                    if not item.get('has_data'):
                        item = _bos_volume_item(config, bos_rows.get('lineas', []), LINEA_BOS_TABLE, 'LINEA_FLOW_IN', expected_samples=expected_for_module, start=start, end=end)
                    items.append(item)
            elif mod == 'flujos':
                for config in FLOWS:
                    if not config.get('visible', True):
                        continue
                    if element_id and str(config.get('id')) != str(element_id):
                        continue
                    rows = readings_by_module.get('flujos', {}).get(int(config['sensor_id']), [])
                    item = _volume_item_from_rows(config, rows, unit='m³/h', expected_samples=expected_for_module, start=start, end=end)
                    if not item.get('has_data'):
                        item = _bos_volume_item(config, bos_rows.get('flujos', []), TANQUE_BOS_TABLE, 'TANQUE_FLOW_IN', unit='m³/h', expected_samples=expected_for_module, start=start, end=end)
                    items.append(item)
            elif mod == 'niveles':
                rows = _rows_for_window(bos_rows.get('niveles', []), start, end, NIVELES_BOS_TABLE)
                for config in LEVELS:
                    if element_id and str(config.get('id')) != str(element_id):
                        continue
                    items.append(_level_item_from_rows(config, rows, expected_for_module))
            elif mod == 'uv':
                rows = _rows_for_window(bos_rows.get('uv', []), start, end, UV_BOS_TABLE)
                for config in UV['lamps']:
                    if element_id and str(config.get('id')) != str(element_id):
                        continue
                    items.append(_uv_item_from_rows(config, rows, expected_for_module))

            payload = {'module': mod, 'summary': _summarize_shift_items(items, mod), 'items': items}
            if mod == 'uv':
                payload['system_summary'] = _uv_system_summary_from_rows(rows, expected_for_module)
            module_payloads.append(payload)
            all_items.extend(items)

        return {
            'plant': PLANT_DISPLAY_NAME,
            'start': start.isoformat(timespec='seconds'),
            'end': end.isoformat(timespec='seconds'),
            'timezone': LOCAL_TIMEZONE,
            'interval_contract': '[T0,T1)',
            'opening_rule': 'last_valid_reading_before_t0',
            'module': selected_module,
            'element_id': element_id,
            'modules': module_payloads,
            'items': all_items,
            'updated_at': datetime.now(LOCAL_ZONE).replace(tzinfo=None).isoformat(timespec='seconds'),
        }
    finally:
        session.close()
