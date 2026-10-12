from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
import logging
from time import monotonic, perf_counter
from typing import Any, Literal
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.exc import OperationalError, SQLAlchemyError

from app.database import SessionLocal
from app.services.insurgentes_config import (
    FLOWS,
    LINES,
    LOCAL_TIMEZONE,
    READINGS_MINUTE_TABLE,
    TANQUE_BOS_TABLE,
    WELLS,
)
from app.services.insurgentes_reconciliation_service import (
    OPENING_FIRST_PERIOD,
    OPENING_MISSING,
    OPENING_PREVIOUS,
    assess_interval,
    normalize_readings_minute_timestamp,
    readings_minute_operational_ts_sql,
    readings_minute_sql_offset_minutes,
)

logger = logging.getLogger(__name__)
LOCAL_ZONE = ZoneInfo(LOCAL_TIMEZONE)
Aggregation = Literal['minute', 'quarter_hour', 'hourly', 'daily']
Module = Literal['well', 'line', 'flow']

ALLOWED_AGGREGATIONS: set[str] = {'minute', 'quarter_hour', 'hourly', 'daily'}
MAX_RANGE_DAYS = {'minute': 1, 'quarter_hour': 7, 'hourly': 31, 'daily': 366}
_HISTORY_CACHE: dict[str, dict[str, Any]] = {}
_HISTORY_CACHE_TTL_SECONDS = 10 * 60


def _catalog(configs: list[dict[str, Any]]) -> dict[int, str]:
    output: dict[int, str] = {}
    for item in configs:
        raw = item.get('sensor_id')
        if raw in (None, '') or item.get('visible') is False:
            continue
        output[int(raw)] = str(item.get('name') or item.get('nombre') or raw)
    return output


WELL_SENSORS = _catalog(WELLS)
LINE_SENSORS = _catalog(LINES)
FLOW_SENSORS = _catalog(FLOWS)


class InsurgentesHistoryError(RuntimeError):
    def __init__(self, message: str, *, status: str = 'sql_error') -> None:
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class HistoryRange:
    start_day: date
    end_day: date
    local_start: datetime
    local_end: datetime


def _parse_date(value: Any, label: str) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return datetime.fromisoformat(str(value)[:10]).date()
    except (TypeError, ValueError) as exc:
        raise ValueError(f'La fecha {label} no es válida.') from exc


def _floor_datetime(value: datetime, aggregation: Aggregation) -> datetime:
    if aggregation == 'daily':
        return value.replace(hour=0, minute=0, second=0, microsecond=0)
    if aggregation == 'hourly':
        return value.replace(minute=0, second=0, microsecond=0)
    if aggregation == 'minute':
        return value.replace(second=0, microsecond=0)
    minute = (value.minute // 15) * 15
    return value.replace(minute=minute, second=0, microsecond=0)


def _ceil_datetime(value: datetime, aggregation: Aggregation) -> datetime:
    base = _floor_datetime(value, aggregation)
    if aggregation == 'daily':
        return base + timedelta(days=1)
    if aggregation == 'hourly':
        return base + timedelta(hours=1)
    if aggregation == 'minute':
        return base + timedelta(minutes=1)
    return base + timedelta(minutes=15)


def _step(aggregation: Aggregation) -> timedelta:
    if aggregation == 'daily':
        return timedelta(days=1)
    if aggregation == 'hourly':
        return timedelta(hours=1)
    if aggregation == 'minute':
        return timedelta(minutes=1)
    return timedelta(minutes=15)


def _history_range(start_date: Any, end_date: Any, aggregation: Aggregation) -> HistoryRange:
    start_day = _parse_date(start_date, 'inicial')
    end_day = _parse_date(end_date, 'final')
    if start_day > end_day:
        start_day, end_day = end_day, start_day
    inclusive_days = (end_day - start_day).days + 1
    maximum = MAX_RANGE_DAYS[aggregation]
    if inclusive_days > maximum:
        label = {'minute': '1 minuto', 'quarter_hour': '15 minutos', 'hourly': 'por hora', 'daily': 'por día'}[aggregation]
        raise ValueError(f'La agrupación {label} permite un máximo de {maximum} días.')

    local_start = datetime.combine(start_day, time.min)
    requested_end = datetime.combine(end_day + timedelta(days=1), time.min)
    now_local = datetime.now(LOCAL_ZONE).replace(tzinfo=None)
    local_end = min(requested_end, _ceil_datetime(now_local, aggregation)) if end_day >= now_local.date() else requested_end
    if local_end <= local_start:
        local_end = requested_end
    return HistoryRange(start_day, end_day, local_start, local_end)


def _catalog_for_module(module: Module) -> dict[int, str]:
    if module == 'well':
        return WELL_SENSORS
    if module == 'line':
        return LINE_SENSORS
    return FLOW_SENSORS


def _sensor_name(module: Module, sensor_id: int) -> str:
    catalog = _catalog_for_module(module)
    if sensor_id not in catalog:
        visible = {'well': 'pozos', 'line': 'líneas', 'flow': 'flujos'}[module]
        raise ValueError(f'El sensor solicitado no pertenece al contrato confirmado de {visible} en Las Fuentes.')
    return catalog[sensor_id]


def _cache_key(module: Module, sensor_ids: list[int], history_range: HistoryRange, aggregation: Aggregation) -> str:
    return '|'.join([
        'insurgentes-history-v4',
        module,
        ','.join(str(item) for item in sensor_ids),
        history_range.start_day.isoformat(),
        history_range.end_day.isoformat(),
        aggregation,
    ])


def _cache_get(key: str) -> dict[str, Any] | None:
    item = _HISTORY_CACHE.get(key)
    if not item:
        return None
    if monotonic() >= float(item.get('expires_at') or 0):
        _HISTORY_CACHE.pop(key, None)
        return None
    return deepcopy(item['value'])


def _cache_set(key: str, value: dict[str, Any]) -> dict[str, Any]:
    _HISTORY_CACHE[key] = {
        'expires_at': monotonic() + _HISTORY_CACHE_TTL_SECONDS,
        'value': deepcopy(value),
    }
    return value


def _bucket_sql(timestamp_sql: str, aggregation: Aggregation) -> str:
    if aggregation == 'daily':
        return f"DATEADD(day, DATEDIFF(day, 0, {timestamp_sql}), 0)"
    if aggregation == 'hourly':
        return f"DATEADD(hour, DATEDIFF(hour, 0, {timestamp_sql}), 0)"
    if aggregation == 'minute':
        return f"DATEADD(minute, DATEDIFF(minute, 0, {timestamp_sql}), 0)"
    return f"DATEADD(minute, (DATEDIFF(minute, 0, {timestamp_sql}) / 15) * 15, 0)"


def _timeout_status(exc: Exception) -> str:
    message = str(exc).lower()
    return 'timeout' if any(token in message for token in ('timeout', 'hyt00', 'hyt01', 'hy008', 'query timeout')) else 'sql_error'


def _query_buckets_set_based(sensor_ids: list[int], history_range: HistoryRange, aggregation: Aggregation) -> list[dict[str, Any]]:
    """Aggregate long hourly/daily ranges in SQL Server instead of materializing every minute row.

    The query keeps the physical ``ts_local`` range predicate so the plant index can
    still be used, but performs flow/totalizer bucket reduction set-based in SQL.
    Python only carries the last positive totalizer between buckets, preserving the
    same opening semantics used by the existing minute-scan path.
    """
    ids = sorted({int(item) for item in sensor_ids})
    if not ids:
        return []

    offset_minutes = readings_minute_sql_offset_minutes(ids, history_range.local_start)
    if offset_minutes is None:
        return _query_buckets_legacy(ids, history_range, aggregation)

    placeholders = ', '.join(f':sensor_{index}' for index in range(len(ids)))
    sensor_values = ', '.join(f'({sensor_id})' for sensor_id in ids)
    base_params: dict[str, Any] = {f'sensor_{index}': sensor_id for index, sensor_id in enumerate(ids)}
    bucket_sql = _bucket_sql('reading_ts', aggregation)
    operational_ts_sql = f"DATEADD(minute, :offset_minutes, COALESCE(reading.ts_local, reading.ts_minute, reading.inserted_at))"

    sql = text(f"""
        WITH normalized AS (
            SELECT
                reading.sensor_id,
                {operational_ts_sql} AS reading_ts,
                TRY_CONVERT(float, reading.instant_value) AS flow_value,
                TRY_CONVERT(float, reading.total_value) AS total_value
            FROM {READINGS_MINUTE_TABLE} AS reading
            WHERE reading.sensor_id IN ({placeholders})
              AND reading.ts_local >= :raw_start
              AND reading.ts_local < :raw_end
              AND (reading.instant_value IS NOT NULL OR reading.total_value IS NOT NULL)
        ), period_rows AS (
            SELECT sensor_id, reading_ts, flow_value, total_value
            FROM normalized
            WHERE reading_ts >= :local_start
              AND reading_ts < :local_end
        ), bucketed AS (
            SELECT
                sensor_id,
                reading_ts,
                flow_value,
                total_value,
                {bucket_sql} AS bucket_start
            FROM period_rows
        ), aggregates AS (
            SELECT
                sensor_id,
                bucket_start,
                COUNT_BIG(1) AS samples,
                COUNT(flow_value) AS flow_samples,
                AVG(flow_value) AS flow_avg_lps,
                MIN(flow_value) AS flow_min_lps,
                MAX(flow_value) AS flow_max_lps,
                MAX(reading_ts) AS last_sample_ts
            FROM bucketed
            GROUP BY sensor_id, bucket_start
        ), positive_ranked AS (
            SELECT
                sensor_id,
                bucket_start,
                reading_ts,
                total_value,
                LAG(total_value) OVER (PARTITION BY sensor_id, bucket_start ORDER BY reading_ts) AS previous_total_value,
                ROW_NUMBER() OVER (PARTITION BY sensor_id, bucket_start ORDER BY reading_ts ASC) AS rn_first,
                ROW_NUMBER() OVER (PARTITION BY sensor_id, bucket_start ORDER BY reading_ts DESC) AS rn_last
            FROM bucketed
            WHERE total_value > 0
        ), positive_summary AS (
            SELECT
                sensor_id,
                bucket_start,
                MAX(CASE WHEN rn_first = 1 THEN total_value END) AS first_positive_total_m3,
                MAX(CASE WHEN rn_last = 1 THEN total_value END) AS positive_totalizer_close_m3,
                SUM(CASE WHEN previous_total_value IS NOT NULL AND total_value - previous_total_value < 0 THEN 1 ELSE 0 END) AS negative_transitions,
                SUM(CASE WHEN previous_total_value IS NOT NULL AND total_value - previous_total_value > 1000000.0 THEN 1 ELSE 0 END) AS impossible_jumps
            FROM positive_ranked
            GROUP BY sensor_id, bucket_start
        ), raw_ranked AS (
            SELECT
                sensor_id,
                bucket_start,
                total_value,
                ROW_NUMBER() OVER (PARTITION BY sensor_id, bucket_start ORDER BY reading_ts DESC) AS rn_last
            FROM bucketed
            WHERE total_value IS NOT NULL
        ), raw_summary AS (
            SELECT
                sensor_id,
                bucket_start,
                MAX(CASE WHEN rn_last = 1 THEN total_value END) AS raw_totalizer_close_m3
            FROM raw_ranked
            GROUP BY sensor_id, bucket_start
        )
        SELECT
            aggregate.sensor_id,
            aggregate.bucket_start,
            aggregate.samples,
            aggregate.flow_samples,
            aggregate.flow_avg_lps,
            aggregate.flow_min_lps,
            aggregate.flow_max_lps,
            aggregate.last_sample_ts,
            positive.first_positive_total_m3,
            raw_close.raw_totalizer_close_m3,
            positive.positive_totalizer_close_m3,
            COALESCE(positive.negative_transitions, 0) AS negative_transitions,
            COALESCE(positive.impossible_jumps, 0) AS impossible_jumps
        FROM aggregates AS aggregate
        LEFT JOIN positive_summary AS positive
          ON positive.sensor_id = aggregate.sensor_id
         AND positive.bucket_start = aggregate.bucket_start
        LEFT JOIN raw_summary AS raw_close
          ON raw_close.sensor_id = aggregate.sensor_id
         AND raw_close.bucket_start = aggregate.bucket_start
        ORDER BY aggregate.sensor_id, aggregate.bucket_start
    """)
    seed_sql = text(f"""
        WITH requested_sensors AS (
            SELECT sensor_id FROM (VALUES {sensor_values}) AS configured(sensor_id)
        )
        SELECT
            configured.sensor_id,
            prior.total_value
        FROM requested_sensors AS configured
        OUTER APPLY (
            SELECT TOP (1)
                TRY_CONVERT(float, reading.total_value) AS total_value
            FROM {READINGS_MINUTE_TABLE} AS reading
            WHERE reading.sensor_id = configured.sensor_id
              AND reading.ts_local < :raw_start
              AND TRY_CONVERT(float, reading.total_value) > 0
            ORDER BY reading.ts_local DESC
        ) AS prior
        WHERE prior.total_value IS NOT NULL
    """)

    # Keep each SQL request bounded. Long daily ranges no longer transfer minute rows,
    # and hourly ranges are split so one slow remote scan cannot monopolize the request.
    read_chunk = timedelta(days=3 if aggregation == 'hourly' else 7)
    rows: list[dict[str, Any]] = []
    started = perf_counter()
    full_raw_start = history_range.local_start - timedelta(minutes=offset_minutes)

    try:
        with SessionLocal() as session:
            seed_rows = session.execute(seed_sql, {'raw_start': full_raw_start}).mappings().all()
            cursor = history_range.local_start
            while cursor < history_range.local_end:
                chunk_end = min(cursor + read_chunk, history_range.local_end)
                params = dict(base_params)
                params.update({
                    'offset_minutes': offset_minutes,
                    'raw_start': cursor - timedelta(minutes=offset_minutes),
                    'raw_end': chunk_end - timedelta(minutes=offset_minutes),
                    'local_start': cursor,
                    'local_end': chunk_end,
                })
                chunk = session.execute(sql, params).mappings().all()
                rows.extend(dict(row) for row in chunk)
                cursor = chunk_end
    except OperationalError as exc:
        status = _timeout_status(exc)
        logger.exception('Insurgentes set-based history query failed status=%s', status)
        if status == 'timeout':
            raise InsurgentesHistoryError('La consulta histórica tardó demasiado.', status='timeout') from exc
        raise InsurgentesHistoryError('No fue posible consultar el histórico de planta.', status='sql_error') from exc
    except SQLAlchemyError as exc:
        logger.exception('Insurgentes set-based history SQL error')
        raise InsurgentesHistoryError('No fue posible consultar el histórico de planta.', status='sql_error') from exc

    previous_positive: dict[int, float] = {}
    for source in seed_rows:
        try:
            sensor_id = int(source.get('sensor_id'))
            value = float(source.get('total_value'))
        except (TypeError, ValueError):
            continue
        if value > 0:
            previous_positive[sensor_id] = value

    output: list[dict[str, Any]] = []
    for row in sorted(rows, key=lambda item: (int(item.get('sensor_id') or 0), item.get('bucket_start') or datetime.min)):
        sensor_id = int(row.get('sensor_id') or 0)
        row['previous_positive_total_m3'] = previous_positive.get(sensor_id)
        close = _number(row.get('positive_totalizer_close_m3'))
        if close is not None and close > 0:
            previous_positive[sensor_id] = close
        output.append(row)

    logger.info(
        'Insurgentes history set-based scan module_sensors=%s aggregation=%s buckets=%s seconds=%.3f',
        len(ids), aggregation, len(output), perf_counter() - started,
    )
    return output


def _query_buckets(sensor_ids: list[int], history_range: HistoryRange, aggregation: Aggregation) -> list[dict[str, Any]]:
    """Read minute history with an index-friendly physical range and reconcile in Python.

    The previous implementation performed several correlated OUTER APPLY scans for
    every sensor/bucket. On the plant SQL Server that can exceed the ODBC query
    timeout even for a single day. This path follows the proven Zapopan pattern:
    read the physical minute rows in bounded chunks, normalize UTC/local timestamps
    once in Python and derive bucket boundaries/quality from the ordered rows.
    """
    ids = sorted({int(item) for item in sensor_ids})
    if not ids:
        return []

    # Rangos horarios/diarios se reducen directamente en SQL Server para no
    # materializar cada lectura minuto a minuto en Python. Esta ruta compartida
    # aplica tanto al histórico individual como al histórico por módulo.
    if aggregation in {'hourly', 'daily'}:
        return _query_buckets_set_based(ids, history_range, aggregation)

    offset_minutes = readings_minute_sql_offset_minutes(ids, history_range.local_start)
    if offset_minutes is None:
        # Current public modules are homogeneous (wells/lines local, flows UTC).
        # Keep a safe fallback for any future mixed request.
        return _query_buckets_legacy(ids, history_range, aggregation)

    raw_start = history_range.local_start - timedelta(minutes=offset_minutes)
    raw_end = history_range.local_end - timedelta(minutes=offset_minutes)
    sensor_values = ', '.join(f'({sensor_id})' for sensor_id in ids)
    placeholders = ', '.join(f':sensor_{index}' for index in range(len(ids)))
    base_params: dict[str, Any] = {f'sensor_{index}': sensor_id for index, sensor_id in enumerate(ids)}
    read_chunk = timedelta(days=14)
    raw_rows: list[dict[str, Any]] = []
    started = perf_counter()

    period_sql = text(f"""
        SELECT
            reading.sensor_id,
            reading.ts_local,
            reading.ts_minute,
            reading.inserted_at,
            TRY_CONVERT(float, reading.instant_value) AS flow_value,
            TRY_CONVERT(float, reading.total_value) AS total_value
        FROM {READINGS_MINUTE_TABLE} AS reading
        WHERE reading.sensor_id IN ({placeholders})
          AND reading.ts_local >= :raw_start
          AND reading.ts_local < :raw_end
          AND (reading.instant_value IS NOT NULL OR reading.total_value IS NOT NULL)
        ORDER BY reading.sensor_id, reading.ts_local
    """)
    seed_sql = text(f"""
        WITH requested_sensors AS (
            SELECT sensor_id FROM (VALUES {sensor_values}) AS configured(sensor_id)
        )
        SELECT
            configured.sensor_id,
            prior.ts_local,
            prior.ts_minute,
            prior.inserted_at,
            prior.total_value
        FROM requested_sensors AS configured
        OUTER APPLY (
            SELECT TOP (1)
                reading.ts_local,
                reading.ts_minute,
                reading.inserted_at,
                TRY_CONVERT(float, reading.total_value) AS total_value
            FROM {READINGS_MINUTE_TABLE} AS reading
            WHERE reading.sensor_id = configured.sensor_id
              AND reading.ts_local < :raw_start
              AND TRY_CONVERT(float, reading.total_value) > 0
            ORDER BY reading.ts_local DESC
        ) AS prior
        WHERE prior.ts_local IS NOT NULL
    """)

    try:
        with SessionLocal() as session:
            cursor = raw_start
            while cursor < raw_end:
                chunk_end = min(cursor + read_chunk, raw_end)
                params = dict(base_params)
                params.update({'raw_start': cursor, 'raw_end': chunk_end})
                chunk = session.execute(period_sql, params).mappings().all()
                raw_rows.extend(dict(row) for row in chunk)
                cursor = chunk_end
            seed_rows = session.execute(seed_sql, {'raw_start': raw_start}).mappings().all()
    except OperationalError as exc:
        status = _timeout_status(exc)
        logger.exception('Insurgentes fast history query failed status=%s', status)
        if status == 'timeout':
            raise InsurgentesHistoryError('La consulta histórica tardó demasiado.', status='timeout') from exc
        raise InsurgentesHistoryError('No fue posible consultar el histórico de planta.', status='sql_error') from exc
    except SQLAlchemyError as exc:
        logger.exception('Insurgentes fast history SQL error')
        raise InsurgentesHistoryError('No fue posible consultar el histórico de planta.', status='sql_error') from exc

    logger.info(
        'Insurgentes history physical scan module_sensors=%s aggregation=%s rows=%s seconds=%.3f',
        len(ids), aggregation, len(raw_rows), perf_counter() - started,
    )

    previous_positive: dict[int, float] = {}
    for source in seed_rows:
        try:
            sensor_id = int(source.get('sensor_id'))
            value = float(source.get('total_value'))
        except (TypeError, ValueError):
            continue
        if value > 0:
            previous_positive[sensor_id] = value

    grouped: dict[int, dict[datetime, list[dict[str, Any]]]] = {sensor_id: {} for sensor_id in ids}
    for source in raw_rows:
        try:
            sensor_id = int(source.get('sensor_id'))
        except (TypeError, ValueError):
            continue
        stamp_raw = source.get('ts_local') or source.get('ts_minute') or source.get('inserted_at')
        stamp = normalize_readings_minute_timestamp(sensor_id, stamp_raw)
        if stamp is None or stamp < history_range.local_start or stamp >= history_range.local_end:
            continue
        bucket_start = _floor_datetime(stamp, aggregation)
        grouped.setdefault(sensor_id, {}).setdefault(bucket_start, []).append({
            'reading_ts': stamp,
            'flow_value': source.get('flow_value'),
            'total_value': source.get('total_value'),
        })

    output: list[dict[str, Any]] = []
    for sensor_id in ids:
        last_positive = previous_positive.get(sensor_id)
        for bucket_start in sorted(grouped.get(sensor_id, {})):
            bucket_rows = sorted(grouped[sensor_id][bucket_start], key=lambda row: row['reading_ts'])
            flows = [_number(row.get('flow_value')) for row in bucket_rows]
            valid_flows = [value for value in flows if value is not None]
            positive_totals: list[float] = []
            raw_close: float | None = None
            negative_transitions = 0
            impossible_jumps = 0
            previous_inside: float | None = None
            for row in bucket_rows:
                total = _number(row.get('total_value'))
                if total is not None:
                    raw_close = total
                if total is None or total <= 0:
                    continue
                if previous_inside is not None:
                    delta = total - previous_inside
                    if delta < 0:
                        negative_transitions += 1
                    elif delta > 1_000_000.0:
                        impossible_jumps += 1
                positive_totals.append(total)
                previous_inside = total

            first_positive = positive_totals[0] if positive_totals else None
            positive_close = positive_totals[-1] if positive_totals else None
            output.append({
                'sensor_id': sensor_id,
                'bucket_start': bucket_start,
                'samples': len(bucket_rows),
                'flow_samples': len(valid_flows),
                'flow_avg_lps': (sum(valid_flows) / len(valid_flows)) if valid_flows else None,
                'flow_min_lps': min(valid_flows) if valid_flows else None,
                'flow_max_lps': max(valid_flows) if valid_flows else None,
                'last_sample_ts': bucket_rows[-1]['reading_ts'] if bucket_rows else None,
                'previous_positive_total_m3': last_positive,
                'first_positive_total_m3': first_positive,
                'raw_totalizer_close_m3': raw_close,
                'positive_totalizer_close_m3': positive_close,
                'negative_transitions': negative_transitions,
                'impossible_jumps': impossible_jumps,
            })
            if positive_close is not None:
                last_positive = positive_close

    return output


def _query_buckets_legacy(sensor_ids: list[int], history_range: HistoryRange, aggregation: Aggregation) -> list[dict[str, Any]]:
    """Legacy mixed-mode SQL path retained only as a defensive fallback."""
    placeholders = ', '.join(f':sensor_{index}' for index in range(len(sensor_ids)))
    operational_ts_sql = readings_minute_operational_ts_sql('reading', sensor_ids, history_range.local_start)
    seed_ts_sql = readings_minute_operational_ts_sql('seed_reading', sensor_ids, history_range.local_start)
    bucket_sql = _bucket_sql('reading_ts', aggregation)
    sensor_values = ', '.join(f'({int(sensor_id)})' for sensor_id in sensor_ids)
    params: dict[str, Any] = {f'sensor_{index}': sensor_id for index, sensor_id in enumerate(sensor_ids)}
    params.update({'start_dt': history_range.local_start, 'end_dt': history_range.local_end})
    sql = text(f"""
        WITH requested_sensors AS (
            SELECT sensor_id FROM (VALUES {sensor_values}) AS configured(sensor_id)
        ), period_rows AS (
            SELECT reading.sensor_id, {operational_ts_sql} AS reading_ts,
                   TRY_CONVERT(float, reading.instant_value) AS flow_value,
                   TRY_CONVERT(float, reading.total_value) AS total_value
            FROM {READINGS_MINUTE_TABLE} AS reading
            WHERE reading.sensor_id IN ({placeholders})
              AND {operational_ts_sql} >= :start_dt AND {operational_ts_sql} < :end_dt
        ), seed_rows AS (
            SELECT configured.sensor_id, prior.reading_ts, CAST(NULL AS float) AS flow_value, prior.total_value
            FROM requested_sensors AS configured
            OUTER APPLY (
                SELECT TOP (1) {seed_ts_sql} AS reading_ts, TRY_CONVERT(float, seed_reading.total_value) AS total_value
                FROM {READINGS_MINUTE_TABLE} AS seed_reading
                WHERE seed_reading.sensor_id = configured.sensor_id
                  AND TRY_CONVERT(float, seed_reading.total_value) > 0
                  AND {seed_ts_sql} < :start_dt
                ORDER BY {seed_ts_sql} DESC
            ) AS prior
            WHERE prior.reading_ts IS NOT NULL
        ), context_rows AS (
            SELECT sensor_id, reading_ts, flow_value, total_value FROM period_rows
            UNION ALL SELECT sensor_id, reading_ts, flow_value, total_value FROM seed_rows
        ), bucketed AS (
            SELECT sensor_id, reading_ts, flow_value, total_value, {bucket_sql} AS bucket_start FROM period_rows AS reading
        ), aggregates AS (
            SELECT sensor_id, bucket_start, COUNT_BIG(1) AS samples, COUNT(flow_value) AS flow_samples,
                   AVG(flow_value) AS flow_avg_lps, MIN(flow_value) AS flow_min_lps, MAX(flow_value) AS flow_max_lps,
                   MAX(reading_ts) AS last_sample_ts
            FROM bucketed GROUP BY sensor_id, bucket_start
        )
        SELECT aggregate.sensor_id, aggregate.bucket_start, aggregate.samples, aggregate.flow_samples,
               aggregate.flow_avg_lps, aggregate.flow_min_lps, aggregate.flow_max_lps, aggregate.last_sample_ts,
               previous_positive.total_value AS previous_positive_total_m3,
               first_positive.total_value AS first_positive_total_m3,
               raw_closing.total_value AS raw_totalizer_close_m3,
               positive_closing.total_value AS positive_totalizer_close_m3,
               0 AS negative_transitions, 0 AS impossible_jumps
        FROM aggregates AS aggregate
        OUTER APPLY (
            SELECT TOP (1) source.total_value FROM context_rows AS source
            WHERE source.sensor_id = aggregate.sensor_id AND source.reading_ts < aggregate.bucket_start AND source.total_value > 0
            ORDER BY source.reading_ts DESC
        ) AS previous_positive
        OUTER APPLY (
            SELECT TOP (1) source.total_value FROM bucketed AS source
            WHERE source.sensor_id = aggregate.sensor_id AND source.bucket_start = aggregate.bucket_start AND source.total_value > 0
            ORDER BY source.reading_ts ASC
        ) AS first_positive
        OUTER APPLY (
            SELECT TOP (1) source.total_value FROM bucketed AS source
            WHERE source.sensor_id = aggregate.sensor_id AND source.bucket_start = aggregate.bucket_start AND source.total_value IS NOT NULL
            ORDER BY source.reading_ts DESC
        ) AS raw_closing
        OUTER APPLY (
            SELECT TOP (1) source.total_value FROM bucketed AS source
            WHERE source.sensor_id = aggregate.sensor_id AND source.bucket_start = aggregate.bucket_start AND source.total_value > 0
            ORDER BY source.reading_ts DESC
        ) AS positive_closing
        ORDER BY aggregate.sensor_id, aggregate.bucket_start
    """)
    try:
        with SessionLocal() as session:
            rows = session.execute(sql, params).mappings().all()
            return [dict(row) for row in rows]
    except OperationalError as exc:
        status = _timeout_status(exc)
        if status == 'timeout':
            raise InsurgentesHistoryError('La consulta histórica tardó demasiado.', status='timeout') from exc
        raise InsurgentesHistoryError('No fue posible consultar el histórico de planta.', status='sql_error') from exc
    except SQLAlchemyError as exc:
        raise InsurgentesHistoryError('No fue posible consultar el histórico de planta.', status='sql_error') from exc

def _query_sosa_buckets(history_range: HistoryRange, aggregation: Aggregation) -> list[dict[str, Any]]:
    """Read SOSA in bounded windows so long ranges do not monopolize SQL Server.

    SensorsBOS_Tanque stores UTC timestamps and can contain more than one row per
    minute. Each chunk keeps the same minute reduction and reconciliation contract,
    while the seed lookup preserves the opening totalizer for the first bucket.
    """
    aware_local = history_range.local_start.replace(tzinfo=LOCAL_ZONE)
    offset_minutes = int((aware_local.utcoffset() or timedelta(0)).total_seconds() // 60)
    bucket_sql = _bucket_sql('reading_ts', aggregation)
    sql = text(f"""
        WITH normalized AS (
            SELECT
                DATEADD(minute, :offset_minutes, Time_Stamp) AS reading_ts,
                TRY_CONVERT(float, sosa_flujo) AS flow_value,
                TRY_CONVERT(float, sosa_total) AS total_value
            FROM {TANQUE_BOS_TABLE}
            WHERE Time_Stamp >= :raw_start
              AND Time_Stamp < :raw_end
              AND (sosa_flujo IS NOT NULL OR sosa_total IS NOT NULL)
        ), minute_base AS (
            SELECT
                reading_ts,
                DATEADD(minute, DATEDIFF(minute, 0, reading_ts), 0) AS minute_ts,
                flow_value,
                total_value
            FROM normalized
        ), minute_ranked AS (
            SELECT
                reading_ts,
                minute_ts,
                AVG(flow_value) OVER (PARTITION BY minute_ts) AS minute_flow_value,
                total_value,
                ROW_NUMBER() OVER (PARTITION BY minute_ts ORDER BY reading_ts DESC) AS rn_last
            FROM minute_base
        ), period_rows AS (
            SELECT
                minute_ts AS reading_ts,
                minute_flow_value AS flow_value,
                total_value
            FROM minute_ranked
            WHERE rn_last = 1
        ), seed_row AS (
            SELECT TOP (1)
                DATEADD(minute, :offset_minutes, Time_Stamp) AS reading_ts,
                CAST(NULL AS float) AS flow_value,
                TRY_CONVERT(float, sosa_total) AS total_value
            FROM {TANQUE_BOS_TABLE}
            WHERE Time_Stamp < :raw_start
              AND TRY_CONVERT(float, sosa_total) > 0
            ORDER BY Time_Stamp DESC
        ), context_rows AS (
            SELECT reading_ts, flow_value, total_value FROM period_rows
            UNION ALL
            SELECT reading_ts, flow_value, total_value FROM seed_row
        ), bucketed AS (
            SELECT
                reading_ts,
                flow_value,
                total_value,
                {bucket_sql} AS bucket_start
            FROM period_rows
        ), aggregates AS (
            SELECT
                bucket_start,
                COUNT_BIG(1) AS samples,
                COUNT(flow_value) AS flow_samples,
                AVG(flow_value) AS flow_avg_lps,
                MIN(flow_value) AS flow_min_lps,
                MAX(flow_value) AS flow_max_lps,
                MAX(reading_ts) AS last_sample_ts
            FROM bucketed
            GROUP BY bucket_start
        ), positive_bucketed AS (
            SELECT
                bucket_start,
                reading_ts,
                total_value,
                LAG(total_value) OVER (PARTITION BY bucket_start ORDER BY reading_ts) AS previous_total_value
            FROM bucketed
            WHERE total_value > 0
        ), anomalies AS (
            SELECT
                bucket_start,
                SUM(CASE WHEN previous_total_value IS NOT NULL AND total_value - previous_total_value < 0 THEN 1 ELSE 0 END) AS negative_transitions,
                SUM(CASE WHEN previous_total_value IS NOT NULL AND total_value - previous_total_value > 1000000.0 THEN 1 ELSE 0 END) AS impossible_jumps
            FROM positive_bucketed
            GROUP BY bucket_start
        )
        SELECT
            CAST(NULL AS int) AS sensor_id,
            aggregate.bucket_start,
            aggregate.samples,
            aggregate.flow_samples,
            aggregate.flow_avg_lps,
            aggregate.flow_min_lps,
            aggregate.flow_max_lps,
            aggregate.last_sample_ts,
            previous_positive.total_value AS previous_positive_total_m3,
            first_positive.total_value AS first_positive_total_m3,
            raw_closing.total_value AS raw_totalizer_close_m3,
            positive_closing.total_value AS positive_totalizer_close_m3,
            COALESCE(anomaly.negative_transitions, 0) AS negative_transitions,
            COALESCE(anomaly.impossible_jumps, 0) AS impossible_jumps
        FROM aggregates AS aggregate
        LEFT JOIN anomalies AS anomaly
          ON anomaly.bucket_start = aggregate.bucket_start
        OUTER APPLY (
            SELECT TOP (1) source.total_value
            FROM context_rows AS source
            WHERE source.reading_ts < aggregate.bucket_start
              AND source.total_value > 0
            ORDER BY source.reading_ts DESC
        ) AS previous_positive
        OUTER APPLY (
            SELECT TOP (1) source.total_value
            FROM bucketed AS source
            WHERE source.bucket_start = aggregate.bucket_start
              AND source.total_value > 0
            ORDER BY source.reading_ts ASC
        ) AS first_positive
        OUTER APPLY (
            SELECT TOP (1) source.total_value
            FROM bucketed AS source
            WHERE source.bucket_start = aggregate.bucket_start
              AND source.total_value IS NOT NULL
            ORDER BY source.reading_ts DESC
        ) AS raw_closing
        OUTER APPLY (
            SELECT TOP (1) source.total_value
            FROM bucketed AS source
            WHERE source.bucket_start = aggregate.bucket_start
              AND source.total_value > 0
            ORDER BY source.reading_ts DESC
        ) AS positive_closing
        ORDER BY aggregate.bucket_start
    """)

    chunk_days = {'minute': 1, 'quarter_hour': 1, 'hourly': 3, 'daily': 7}[aggregation]
    read_chunk = timedelta(days=chunk_days)
    output: list[dict[str, Any]] = []
    started = perf_counter()
    cursor = history_range.local_start
    try:
        with SessionLocal() as session:
            while cursor < history_range.local_end:
                chunk_end = min(cursor + read_chunk, history_range.local_end)
                raw_start = cursor - timedelta(minutes=offset_minutes)
                raw_end = chunk_end - timedelta(minutes=offset_minutes)
                params = {
                    'offset_minutes': offset_minutes,
                    'raw_start': raw_start,
                    'raw_end': raw_end,
                }
                rows = session.execute(sql, params).mappings().all()
                output.extend(dict(row) for row in rows)
                cursor = chunk_end
    except OperationalError as exc:
        status = _timeout_status(exc)
        logger.exception('Insurgentes SOSA history query failed status=%s', status)
        if status == 'timeout':
            raise InsurgentesHistoryError('La consulta histórica de SOSA tardó demasiado.', status='timeout') from exc
        raise InsurgentesHistoryError('No fue posible consultar el histórico de SOSA.', status='sql_error') from exc
    except SQLAlchemyError as exc:
        logger.exception('Insurgentes SOSA history SQL error')
        raise InsurgentesHistoryError('No fue posible consultar el histórico de SOSA.', status='sql_error') from exc

    logger.info(
        'Insurgentes SOSA history scan aggregation=%s buckets=%s seconds=%.3f',
        aggregation, len(output), perf_counter() - started,
    )
    return sorted(output, key=lambda item: item.get('bucket_start') or datetime.min)

def _number(value: Any) -> float | None:
    if value in (None, ''):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed == parsed else None


def _expected_samples(aggregation: Aggregation) -> int:
    return {'minute': 1, 'quarter_hour': 15, 'hourly': 60, 'daily': 1440}[aggregation]


def _expected_samples_for_bucket(bucket_start: datetime, aggregation: Aggregation, now: datetime | None = None) -> int:
    bucket_end = bucket_start + _step(aggregation)
    current = (now or datetime.now(LOCAL_ZONE)).replace(tzinfo=None, second=0, microsecond=0)
    if bucket_end <= current:
        return _expected_samples(aggregation)
    if bucket_start >= current:
        return 0
    return max(int((current - bucket_start).total_seconds() // 60), 0)


def _row_to_point(row: dict[str, Any], aggregation: Aggregation, *, now: datetime | None = None) -> dict[str, Any]:
    bucket_start = row.get('bucket_start')
    if not isinstance(bucket_start, datetime):
        bucket_start = datetime.fromisoformat(str(bucket_start))
    bucket_end = bucket_start + _step(aggregation)
    flow_avg = _number(row.get('flow_avg_lps'))
    flow_min = _number(row.get('flow_min_lps'))
    flow_max = _number(row.get('flow_max_lps'))
    previous = _number(row.get('previous_positive_total_m3'))
    first_period = _number(row.get('first_positive_total_m3'))
    if previous is not None:
        opening = previous
        opening_source = OPENING_PREVIOUS
    elif first_period is not None:
        opening = first_period
        opening_source = OPENING_FIRST_PERIOD
    else:
        opening = None
        opening_source = OPENING_MISSING

    raw_close = _number(row.get('raw_totalizer_close_m3'))
    positive_close = _number(row.get('positive_totalizer_close_m3'))
    effective_close = positive_close if positive_close is not None else None
    samples = int(row.get('samples') or 0)
    expected = _expected_samples_for_bucket(bucket_start, aggregation, now=now)
    if expected <= 0:
        coverage_pct = 0.0 if samples <= 0 else 100.0
    else:
        coverage_pct = round(min(samples / expected * 100.0, 100.0), 1)

    assessed = assess_interval(
        samples=samples,
        flow_samples=int(row.get('flow_samples') or 0),
        flow_avg=flow_avg,
        flow_min=flow_min,
        flow_max=flow_max,
        opening=opening,
        opening_source=opening_source,
        first_period_total=first_period,
        raw_close=raw_close,
        effective_close=effective_close,
        negative_transitions=int(row.get('negative_transitions') or 0),
        impossible_jumps=int(row.get('impossible_jumps') or 0),
        coverage_pct=coverage_pct,
        last_sample_ts=row.get('last_sample_ts'),
    )
    last_sample = assessed.get('last_sample_ts')
    if isinstance(last_sample, datetime):
        assessed['last_sample_ts'] = last_sample.isoformat(timespec='seconds')
    assessed.update({
        'sensor_id': int(row.get('sensor_id')) if row.get('sensor_id') not in (None, '') else None,
        'bucket_start': bucket_start.isoformat(timespec='seconds'),
        'bucket_end': bucket_end.isoformat(timespec='seconds'),
        'aggregation': aggregation,
        'flow_unit': 'L/s',
        'status': assessed['data_status'],
    })
    return assessed

def _empty_point(sensor_id: int | None, bucket_start: datetime, aggregation: Aggregation) -> dict[str, Any]:
    return {
        'sensor_id': sensor_id,
        'bucket_start': bucket_start.isoformat(timespec='seconds'),
        'bucket_end': (bucket_start + _step(aggregation)).isoformat(timespec='seconds'),
        'aggregation': aggregation,
        'samples': 0,
        'flow_samples': 0,
        'coverage_pct': 0.0,
        'flow_avg_lps': None,
        'flow_min_lps': None,
        'flow_max_lps': None,
        'flow_unit': 'L/s',
        'totalizer_open_m3': None,
        'raw_totalizer_close_m3': None,
        'totalizer_close_m3': None,
        'effective_totalizer_close_m3': None,
        'totalizer_retained': False,
        'volume_m3': None,
        'volume_reliable': False,
        'observed_volume_m3': None,
        'opening_source': OPENING_MISSING,
        'boundary_complete': False,
        'data_status': 'no_data',
        'quality_status': 'no_data',
        'quality_label': 'Sin datos',
        'review_reason': None,
        'negative_totalizer_transitions': 0,
        'impossible_totalizer_jumps': 0,
        'status': 'no_data',
        'last_sample_ts': None,
    }


def _points_for_sensor(sensor_id: int, rows: list[dict[str, Any]], history_range: HistoryRange, aggregation: Aggregation) -> list[dict[str, Any]]:
    by_bucket: dict[datetime, dict[str, Any]] = {}
    for row in rows:
        if int(row.get('sensor_id') or 0) != sensor_id:
            continue
        point = _row_to_point(row, aggregation)
        by_bucket[datetime.fromisoformat(str(point['bucket_start']))] = point
    output: list[dict[str, Any]] = []
    cursor = _floor_datetime(history_range.local_start, aggregation)
    while cursor < history_range.local_end:
        output.append(by_bucket.get(cursor) or _empty_point(sensor_id, cursor, aggregation))
        cursor += _step(aggregation)
    return output


def _series_status(points: list[dict[str, Any]]) -> tuple[str, bool, bool]:
    data_points = [point for point in points if int(point.get('samples') or 0) > 0]
    if not data_points:
        return 'no_data', False, False
    partial = len(data_points) < len(points) or any(str(point.get('quality_status')) in {'partial', 'review'} for point in data_points)
    return ('partial' if partial else 'operational'), True, partial


def _build_series(module: Module, sensor_id: int, rows: list[dict[str, Any]], history_range: HistoryRange, aggregation: Aggregation) -> dict[str, Any]:
    points = _points_for_sensor(sensor_id, rows, history_range, aggregation)
    status, has_data, partial_gaps = _series_status(points)
    return {
        'sensor_id': sensor_id,
        'name': _sensor_name(module, sensor_id),
        'flow_unit': 'L/s',
        'unit_status': 'confirmed',
        'status': status,
        'has_data': has_data,
        'partial_gaps': partial_gaps,
        'points': points,
    }



def _validate_module(module: str) -> Module:
    normalized = str(module or '').strip().lower()
    if normalized not in {'well', 'line', 'flow'}:
        raise ValueError('El módulo histórico debe ser well, line o flow.')
    return normalized  # type: ignore[return-value]


def _validate_aggregation(aggregation: str) -> Aggregation:
    normalized = str(aggregation or '').strip().lower()
    if normalized not in ALLOWED_AGGREGATIONS:
        raise ValueError('La agrupación histórica debe ser minute, quarter_hour, hourly o daily.')
    return normalized  # type: ignore[return-value]


def get_insurgentes_water_history(
    *,
    module: str,
    sensor_id: int,
    start_date: Any,
    end_date: Any,
    aggregation: str,
    force_refresh: bool = False,
) -> dict[str, Any]:
    typed_module = _validate_module(module)
    typed_aggregation = _validate_aggregation(aggregation)
    sensor_id = int(sensor_id)
    _sensor_name(typed_module, sensor_id)
    history_range = _history_range(start_date, end_date, typed_aggregation)
    key = _cache_key(typed_module, [sensor_id], history_range, typed_aggregation)
    if not force_refresh:
        cached = _cache_get(key)
        if cached is not None:
            return cached
    rows = _query_buckets([sensor_id], history_range, typed_aggregation)
    series = _build_series(typed_module, sensor_id, rows, history_range, typed_aggregation)
    payload = {
        'module': typed_module,
        'sensor_id': sensor_id,
        'name': series['name'],
        'start_date': history_range.start_day.isoformat(),
        'end_date': history_range.end_day.isoformat(),
        'aggregation': typed_aggregation,
        'source': READINGS_MINUTE_TABLE,
        'time_zone': LOCAL_TIMEZONE,
        'flow_unit': 'L/s',
        'unit_status': 'confirmed',
        'status': series['status'],
        'has_data': series['has_data'],
        'partial_gaps': series['partial_gaps'],
        'points': series['points'],
    }
    return _cache_set(key, payload)


def get_insurgentes_water_history_module(
    *,
    module: str,
    start_date: Any,
    end_date: Any,
    aggregation: str,
    force_refresh: bool = False,
) -> dict[str, Any]:
    typed_module = _validate_module(module)
    typed_aggregation = _validate_aggregation(aggregation)
    history_range = _history_range(start_date, end_date, typed_aggregation)
    # Preserve the physical/operational order declared by plant configuration.
    # Sensor IDs are not guaranteed to follow visible numbering (Pozo 4=1251, Pozo 5=1201).
    sensor_ids = list(_catalog_for_module(typed_module))
    key = _cache_key(typed_module, sensor_ids, history_range, typed_aggregation)
    if not force_refresh:
        cached = _cache_get(key)
        if cached is not None:
            return cached
    rows = _query_buckets(sensor_ids, history_range, typed_aggregation) if sensor_ids else []
    series = [_build_series(typed_module, sensor_id, rows, history_range, typed_aggregation) for sensor_id in sensor_ids]
    has_data = any(item['has_data'] for item in series)
    partial_gaps = any(item['partial_gaps'] for item in series if item['has_data'])
    payload = {
        'module': typed_module,
        'start_date': history_range.start_day.isoformat(),
        'end_date': history_range.end_day.isoformat(),
        'aggregation': typed_aggregation,
        'source': READINGS_MINUTE_TABLE,
        'source_status': 'common_reconciled',
        'time_zone': LOCAL_TIMEZONE,
        'status': 'no_data' if not has_data else ('partial' if partial_gaps else 'operational'),
        'has_data': has_data,
        'partial_gaps': partial_gaps,
        'series': series,
    }
    return _cache_set(key, payload)
