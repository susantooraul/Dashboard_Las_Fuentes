from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from datetime import date, datetime, time, timedelta, timezone
from io import BytesIO
import logging
from time import monotonic
from typing import Any, Iterable
from zoneinfo import ZoneInfo

from openpyxl import Workbook
from openpyxl.cell import WriteOnlyCell
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy import text
from sqlalchemy.exc import OperationalError, SQLAlchemyError

from app.database import SessionLocal
from app.services.insurgentes_config import (
    FLOWS,
    LINES,
    LOCAL_TIMEZONE,
    READINGS_MINUTE_TABLE,
    READINGS_MINUTE_TIMESTAMP_MODE_BY_SENSOR,
    SENSOR_AUDIT_EVIDENCE,
    SOURCE_CONTRACTS,
    TANQUE_BOS_TABLE,
    WATER_ENTRY,
    WELLS,
)
from app.services.insurgentes_reconciliation_service import (
    MAX_TECHNICAL_PERIOD_DELTA_M3,
    OPENING_FIRST_PERIOD,
    OPENING_MISSING,
    OPENING_PREVIOUS,
    assess_interval,
    is_valid_totalizer_boundary,
    reconcile_interval,
)

logger = logging.getLogger(__name__)
LOCAL_ZONE = ZoneInfo(LOCAL_TIMEZONE)
_FULL_EXPORT_CACHE: dict[str, dict[str, Any]] = {}
_SUPPORT_DATA_CACHE: dict[str, dict[str, Any]] = {}
SUPPORT_CACHE_TTL_SECONDS = 5 * 60


class InsurgentesFullHistoryExportError(RuntimeError):
    def __init__(self, message: str, *, status: str = 'sql_error') -> None:
        super().__init__(message)
        self.status = status


def _sensor_catalog() -> dict[int, dict[str, Any]]:
    catalog: dict[int, dict[str, Any]] = {}
    entry_id = int(WATER_ENTRY['primary_sensor_id'])
    catalog[entry_id] = {'sensor_id': entry_id, 'module': 'entrada', 'name': str(WATER_ENTRY['name'])}
    for module, items in (('pozos', WELLS), ('lineas', LINES), ('flujos', FLOWS)):
        for item in items:
            raw_sensor = item.get('sensor_id')
            if raw_sensor in (None, '') or item.get('visible') is False:
                continue
            sensor_id = int(raw_sensor)
            catalog[sensor_id] = {
                'sensor_id': sensor_id,
                'module': module,
                'name': str(item.get('name') or sensor_id),
            }
    return catalog


SENSOR_CATALOG = _sensor_catalog()
SENSOR_IDS = sorted(SENSOR_CATALOG)
RAW_SENSOR_CATALOG = deepcopy(SENSOR_CATALOG)
if 1002 in SENSOR_AUDIT_EVIDENCE and 1002 not in RAW_SENSOR_CATALOG:
    RAW_SENSOR_CATALOG[1002] = {
        'sensor_id': 1002,
        'module': 'auxiliar',
        'name': 'Canal minutal 1002 (legacy_unmapped_pending_review)',
    }
RAW_SENSOR_IDS = sorted(RAW_SENSOR_CATALOG)
LOCAL_SENSOR_IDS = [sid for sid in RAW_SENSOR_IDS if READINGS_MINUTE_TIMESTAMP_MODE_BY_SENSOR.get(sid, 'local') == 'local']
UTC_SENSOR_IDS = [sid for sid in RAW_SENSOR_IDS if READINGS_MINUTE_TIMESTAMP_MODE_BY_SENSOR.get(sid, 'local') == 'utc']


def _timeout_status(exc: Exception) -> str:
    message = str(exc).lower()
    return 'timeout' if any(token in message for token in ('timeout', 'hyt00', 'hyt01', 'hy008', 'query timeout')) else 'sql_error'


def _query_mappings(sql: Any, params: dict[str, Any], *, stage: str) -> list[dict[str, Any]]:
    try:
        with SessionLocal() as session:
            return [dict(row) for row in session.execute(sql, params).mappings().all()]
    except OperationalError as exc:
        status = _timeout_status(exc)
        logger.exception('Insurgentes full history stage failed stage=%s status=%s', stage, status)
        if status == 'timeout':
            raise InsurgentesFullHistoryExportError(f'La etapa {stage} del histórico completo tardó demasiado.', status='timeout') from exc
        raise InsurgentesFullHistoryExportError(f'No fue posible completar la etapa {stage} del histórico completo.', status='sql_error') from exc
    except SQLAlchemyError as exc:
        logger.exception('Insurgentes full history SQL error stage=%s', stage)
        raise InsurgentesFullHistoryExportError(f'No fue posible completar la etapa {stage} del histórico completo.', status='sql_error') from exc


def _local_to_utc_naive(value: datetime) -> datetime:
    return value.replace(tzinfo=LOCAL_ZONE).astimezone(timezone.utc).replace(tzinfo=None)


def _raw_bounds(local_start: datetime, local_end: datetime, mode: str) -> tuple[datetime, datetime]:
    if mode != 'utc':
        return local_start, local_end
    return _local_to_utc_naive(local_start), _local_to_utc_naive(local_end)


def _raw_to_operational(value: datetime | None, mode: str) -> datetime | None:
    if not isinstance(value, datetime):
        return None
    if mode != 'utc':
        return value.replace(tzinfo=None)
    return value.replace(tzinfo=timezone.utc).astimezone(LOCAL_ZONE).replace(tzinfo=None)


def _sosa_raw_bounds(local_start: datetime, local_end: datetime) -> tuple[datetime, datetime]:
    return _local_to_utc_naive(local_start), _local_to_utc_naive(local_end)


def _resolve_complete_range() -> tuple[date, date, datetime, datetime, datetime]:
    now_local = datetime.now(LOCAL_ZONE).replace(tzinfo=None, second=0, microsecond=0)
    candidates: list[datetime] = []

    for mode, sensor_ids in (('local', LOCAL_SENSOR_IDS), ('utc', UTC_SENSOR_IDS)):
        if not sensor_ids:
            continue
        sql = text(f"""
            SELECT MIN(ts_local) AS first_raw_ts
            FROM {READINGS_MINUTE_TABLE}
            WHERE sensor_id IN ({', '.join(str(item) for item in sensor_ids)})
              AND ts_local IS NOT NULL
        """)
        rows = _query_mappings(sql, {}, stage=f'inicio físico {mode}')
        raw_value = rows[0].get('first_raw_ts') if rows else None
        operational = _raw_to_operational(raw_value, mode)
        if operational is not None:
            candidates.append(operational)

    sosa_sql = text(f"""
        SELECT MIN(Time_Stamp) AS first_raw_ts
        FROM {TANQUE_BOS_TABLE}
        WHERE Time_Stamp IS NOT NULL
          AND (sosa_flujo IS NOT NULL OR sosa_total IS NOT NULL)
    """)
    sosa_rows = _query_mappings(sosa_sql, {}, stage='inicio físico SOSA')
    sosa_raw = sosa_rows[0].get('first_raw_ts') if sosa_rows else None
    sosa_operational = _raw_to_operational(sosa_raw, 'utc')
    if sosa_operational is not None:
        candidates.append(sosa_operational)

    if not candidates:
        raise ValueError('No existen registros históricos disponibles para Las Fuentes.')
    first_physical_ts = min(candidates).replace(second=0, microsecond=0)
    local_start = datetime.combine(first_physical_ts.date(), time.min)
    if now_local <= local_start:
        raise ValueError('El histórico todavía no contiene minutos cerrados.')
    return local_start.date(), now_local.date(), local_start, now_local, first_physical_ts


def _date_iter(start: date, end: date):
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def _effective_day_bounds(day_value: date, local_start: datetime, local_end: datetime) -> tuple[datetime, datetime] | None:
    day_start = datetime.combine(day_value, time.min)
    day_end = day_start + timedelta(days=1)
    effective_start = max(day_start, local_start)
    effective_end = min(day_end, local_end)
    if effective_end <= effective_start:
        return None
    return effective_start, effective_end


def _expected_minutes(day_value: date, local_start: datetime, local_end: datetime) -> int:
    bounds = _effective_day_bounds(day_value, local_start, local_end)
    if bounds is None:
        return 0
    return max(int((bounds[1] - bounds[0]).total_seconds() // 60), 0)


def _safe_float(value: Any) -> float | None:
    try:
        return None if value in (None, '') else float(value)
    except (TypeError, ValueError):
        return None


def _query_iot_day(local_start: datetime, local_end: datetime) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for mode, sensor_ids in (('local', LOCAL_SENSOR_IDS), ('utc', UTC_SENSOR_IDS)):
        if not sensor_ids:
            continue
        raw_start, raw_end = _raw_bounds(local_start, local_end, mode)
        sql = text(f"""
            SELECT
                sensor_id,
                ts_local AS raw_ts,
                inserted_at,
                instant_value,
                total_value,
                quality,
                source
            FROM {READINGS_MINUTE_TABLE}
            WHERE sensor_id IN ({', '.join(str(item) for item in sensor_ids)})
              AND ts_local >= :raw_start
              AND ts_local < :raw_end
            ORDER BY sensor_id, ts_local, inserted_at
        """)
        rows = _query_mappings(sql, {'raw_start': raw_start, 'raw_end': raw_end}, stage=f'lecturas minutales {mode}')
        for row in rows:
            operational = _raw_to_operational(row.get('raw_ts'), mode)
            if operational is None or operational < local_start or operational >= local_end:
                continue
            row['timestamp'] = operational
            row['timestamp_mode'] = mode
            output.append(row)
    output.sort(key=lambda item: (int(item['sensor_id']), item['timestamp'], item.get('inserted_at') or item['timestamp']))
    return output


def _query_sosa_minute_day(local_start: datetime, local_end: datetime) -> list[dict[str, Any]]:
    raw_start, raw_end = _sosa_raw_bounds(local_start, local_end)
    offset_minutes = int((local_start.replace(tzinfo=LOCAL_ZONE).utcoffset() or timedelta(0)).total_seconds() // 60)
    sql = text(f"""
        WITH normalized AS (
            SELECT
                Time_Stamp AS raw_ts,
                DATEADD(minute, :offset_minutes, Time_Stamp) AS operational_ts,
                TRY_CONVERT(float, sosa_flujo) AS flow_value,
                TRY_CONVERT(float, sosa_total) AS total_value
            FROM {TANQUE_BOS_TABLE}
            WHERE Time_Stamp >= :raw_start
              AND Time_Stamp < :raw_end
              AND (sosa_flujo IS NOT NULL OR sosa_total IS NOT NULL)
        ), minute_base AS (
            SELECT
                raw_ts,
                operational_ts,
                DATEADD(minute, DATEDIFF(minute, 0, operational_ts), 0) AS minute_ts,
                flow_value,
                total_value
            FROM normalized
        ), ranked AS (
            SELECT
                raw_ts,
                operational_ts,
                minute_ts,
                AVG(flow_value) OVER (PARTITION BY minute_ts) AS flow_avg,
                total_value,
                ROW_NUMBER() OVER (PARTITION BY minute_ts ORDER BY operational_ts DESC) AS rn
            FROM minute_base
        )
        SELECT raw_ts, minute_ts AS operational_ts, flow_avg, total_value
        FROM ranked
        WHERE rn = 1
        ORDER BY operational_ts
    """)
    rows = _query_mappings(sql, {'offset_minutes': offset_minutes, 'raw_start': raw_start, 'raw_end': raw_end}, stage='SOSA 1 minuto')
    return [
        {
            'timestamp': row.get('operational_ts'),
            'raw_ts': row.get('raw_ts'),
            'instant_value': row.get('flow_avg'),
            'total_value': row.get('total_value'),
            'timestamp_mode': 'utc',
        }
        for row in rows
        if isinstance(row.get('operational_ts'), datetime)
    ]


def _query_sosa_raw_daily(start: datetime, end: datetime) -> dict[str, dict[str, Any]]:
    """Daily SOSA audit in bounded windows.

    The BOS table can contain several samples per minute, so scanning the complete
    history in a single window is expensive. Seven-day chunks keep each SQL sort
    bounded while preserving daily statistics and totalizer transitions.
    """
    output: dict[str, dict[str, Any]] = {}
    cursor = start
    read_chunk = timedelta(days=7)
    while cursor < end:
        chunk_end = min(cursor + read_chunk, end)
        raw_start, raw_end = _sosa_raw_bounds(cursor, chunk_end)
        offset_minutes = int((cursor.replace(tzinfo=LOCAL_ZONE).utcoffset() or timedelta(0)).total_seconds() // 60)
        sql = text(f"""
            WITH normalized AS (
                SELECT
                    DATEADD(minute, :offset_minutes, Time_Stamp) AS operational_ts,
                    CAST(DATEADD(minute, :offset_minutes, Time_Stamp) AS date) AS reading_day,
                    sosa_flujo AS raw_flow,
                    sosa_total AS raw_total,
                    TRY_CONVERT(float, sosa_flujo) AS flow_value,
                    TRY_CONVERT(float, sosa_total) AS total_value
                FROM {TANQUE_BOS_TABLE}
                WHERE Time_Stamp >= :raw_start
                  AND Time_Stamp < :raw_end
                  AND (sosa_flujo IS NOT NULL OR sosa_total IS NOT NULL)
            ), daily AS (
                SELECT
                    reading_day,
                    COUNT_BIG(*) AS rows_observed,
                    COUNT(DISTINCT DATEDIFF(minute, 0, operational_ts)) AS observed_minutes,
                    COUNT(flow_value) AS flow_samples,
                    MIN(operational_ts) AS first_operational_ts,
                    MAX(operational_ts) AS last_operational_ts,
                    SUM(CASE WHEN flow_value = 0 THEN 1 ELSE 0 END) AS zero_flow_rows,
                    SUM(CASE WHEN total_value = 0 THEN 1 ELSE 0 END) AS zero_totalizer_rows,
                    SUM(CASE WHEN raw_flow IS NULL THEN 1 ELSE 0 END) AS null_flow_rows,
                    SUM(CASE WHEN raw_total IS NULL THEN 1 ELSE 0 END) AS null_totalizer_rows,
                    SUM(CASE WHEN raw_flow IS NOT NULL AND flow_value IS NULL THEN 1 ELSE 0 END) AS invalid_flow_rows,
                    SUM(CASE WHEN raw_total IS NOT NULL AND total_value IS NULL THEN 1 ELSE 0 END) AS invalid_totalizer_rows,
                    AVG(flow_value) AS flow_avg,
                    MIN(flow_value) AS flow_min,
                    MAX(flow_value) AS flow_max,
                    MIN(total_value) AS total_min,
                    MAX(total_value) AS total_max
                FROM normalized
                GROUP BY reading_day
            ), positive_ordered AS (
                SELECT
                    reading_day,
                    operational_ts,
                    total_value,
                    LAG(total_value) OVER (PARTITION BY reading_day ORDER BY operational_ts) AS previous_total
                FROM normalized
                WHERE total_value > 0
            ), transitions AS (
                SELECT
                    reading_day,
                    SUM(CASE WHEN previous_total IS NOT NULL AND total_value - previous_total < 0 THEN 1 ELSE 0 END) AS negative_transitions,
                    SUM(CASE WHEN previous_total IS NOT NULL AND total_value - previous_total > :max_delta THEN 1 ELSE 0 END) AS impossible_jumps,
                    MAX(CASE WHEN previous_total IS NOT NULL AND total_value - previous_total >= 0 THEN total_value - previous_total END) AS max_positive_delta,
                    MIN(CASE WHEN previous_total IS NOT NULL THEN total_value - previous_total END) AS min_delta
                FROM positive_ordered
                GROUP BY reading_day
            ), first_positive AS (
                SELECT reading_day, total_value,
                       ROW_NUMBER() OVER (PARTITION BY reading_day ORDER BY operational_ts ASC) AS rn
                FROM normalized
                WHERE total_value > 0
            ), last_positive AS (
                SELECT reading_day, total_value,
                       ROW_NUMBER() OVER (PARTITION BY reading_day ORDER BY operational_ts DESC) AS rn
                FROM normalized
                WHERE total_value > 0
            ), last_raw AS (
                SELECT reading_day, total_value,
                       ROW_NUMBER() OVER (PARTITION BY reading_day ORDER BY operational_ts DESC) AS rn
                FROM normalized
                WHERE total_value IS NOT NULL
            )
            SELECT
                daily.*,
                first_positive.total_value AS first_positive_total_m3,
                last_positive.total_value AS last_positive_total_m3,
                last_raw.total_value AS raw_totalizer_close_m3,
                COALESCE(transitions.negative_transitions, 0) AS negative_transitions,
                COALESCE(transitions.impossible_jumps, 0) AS impossible_jumps,
                transitions.max_positive_delta,
                transitions.min_delta
            FROM daily
            LEFT JOIN first_positive
              ON first_positive.reading_day = daily.reading_day
             AND first_positive.rn = 1
            LEFT JOIN last_positive
              ON last_positive.reading_day = daily.reading_day
             AND last_positive.rn = 1
            LEFT JOIN last_raw
              ON last_raw.reading_day = daily.reading_day
             AND last_raw.rn = 1
            LEFT JOIN transitions
              ON transitions.reading_day = daily.reading_day
            ORDER BY daily.reading_day
        """)
        rows = _query_mappings(
            sql,
            {
                'offset_minutes': offset_minutes,
                'raw_start': raw_start,
                'raw_end': raw_end,
                'max_delta': MAX_TECHNICAL_PERIOD_DELTA_M3,
            },
            stage='resumen crudo SOSA',
        )
        for row in rows:
            output[str(row['reading_day'])] = row
        cursor = chunk_end
    return output


def _query_iot_daily_support(local_start: datetime, local_end: datetime) -> dict[tuple[int, str], dict[str, Any]]:
    """Set-based daily audit in seven-day windows.

    Keeping every SQL sort/window bounded avoids the long single scan that could
    exceed the reverse-proxy/browser wait time on multi-week history exports.
    """
    output: dict[tuple[int, str], dict[str, Any]] = {}
    read_chunk = timedelta(days=7)
    for mode, sensor_ids in (('local', LOCAL_SENSOR_IDS), ('utc', UTC_SENSOR_IDS)):
        if not sensor_ids:
            continue
        operational_expr = 'reading.ts_local' if mode == 'local' else 'DATEADD(minute, :offset_minutes, reading.ts_local)'
        sql = text(f"""
            WITH normalized AS (
                SELECT
                    reading.sensor_id,
                    {operational_expr} AS operational_ts,
                    reading.instant_value AS raw_flow,
                    reading.total_value AS raw_total,
                    TRY_CONVERT(float, reading.instant_value) AS flow_value,
                    TRY_CONVERT(float, reading.total_value) AS total_value
                FROM {READINGS_MINUTE_TABLE} AS reading
                WHERE reading.sensor_id IN ({', '.join(str(item) for item in sensor_ids)})
                  AND reading.ts_local >= :raw_start
                  AND reading.ts_local < :raw_end
            ), base AS (
                SELECT
                    sensor_id,
                    operational_ts,
                    CAST(operational_ts AS date) AS reading_day,
                    DATEADD(minute, DATEDIFF(minute, 0, operational_ts), 0) AS minute_ts,
                    raw_flow,
                    raw_total,
                    flow_value,
                    total_value
                FROM normalized
                WHERE operational_ts >= :local_start
                  AND operational_ts < :local_end
            ), daily AS (
                SELECT
                    sensor_id,
                    reading_day,
                    COUNT_BIG(*) AS rows_observed,
                    COUNT(DISTINCT DATEDIFF(minute, 0, minute_ts)) AS observed_minutes,
                    COUNT(flow_value) AS flow_samples,
                    SUM(CASE WHEN flow_value = 0 THEN 1 ELSE 0 END) AS zero_flow_rows,
                    SUM(CASE WHEN total_value = 0 THEN 1 ELSE 0 END) AS zero_totalizer_rows,
                    SUM(CASE WHEN raw_flow IS NULL THEN 1 ELSE 0 END) AS null_flow_rows,
                    SUM(CASE WHEN raw_total IS NULL THEN 1 ELSE 0 END) AS null_totalizer_rows,
                    SUM(CASE WHEN raw_flow IS NOT NULL AND flow_value IS NULL THEN 1 ELSE 0 END) AS invalid_flow_rows,
                    SUM(CASE WHEN raw_total IS NOT NULL AND total_value IS NULL THEN 1 ELSE 0 END) AS invalid_totalizer_rows,
                    AVG(flow_value) AS flow_avg,
                    MIN(flow_value) AS flow_min,
                    MAX(flow_value) AS flow_max,
                    MIN(total_value) AS total_min,
                    MAX(total_value) AS total_max,
                    MIN(operational_ts) AS first_operational_ts,
                    MAX(operational_ts) AS last_operational_ts
                FROM base
                GROUP BY sensor_id, reading_day
            ), positive_ordered AS (
                SELECT
                    sensor_id,
                    reading_day,
                    operational_ts,
                    total_value,
                    LAG(total_value) OVER (PARTITION BY sensor_id, reading_day ORDER BY operational_ts) AS previous_total
                FROM base
                WHERE total_value > 0
            ), transitions AS (
                SELECT
                    sensor_id,
                    reading_day,
                    SUM(CASE WHEN previous_total IS NOT NULL AND total_value - previous_total < 0 THEN 1 ELSE 0 END) AS negative_transitions,
                    SUM(CASE WHEN previous_total IS NOT NULL AND total_value - previous_total > :max_delta THEN 1 ELSE 0 END) AS impossible_jumps,
                    MAX(CASE WHEN previous_total IS NOT NULL AND total_value - previous_total >= 0 THEN total_value - previous_total END) AS max_positive_delta,
                    MIN(CASE WHEN previous_total IS NOT NULL THEN total_value - previous_total END) AS min_delta
                FROM positive_ordered
                GROUP BY sensor_id, reading_day
            ), first_positive AS (
                SELECT sensor_id, reading_day, total_value,
                       ROW_NUMBER() OVER (PARTITION BY sensor_id, reading_day ORDER BY operational_ts ASC) AS rn
                FROM base
                WHERE total_value > 0
            ), last_positive AS (
                SELECT sensor_id, reading_day, total_value,
                       ROW_NUMBER() OVER (PARTITION BY sensor_id, reading_day ORDER BY operational_ts DESC) AS rn
                FROM base
                WHERE total_value > 0
            ), last_raw AS (
                SELECT sensor_id, reading_day, total_value,
                       ROW_NUMBER() OVER (PARTITION BY sensor_id, reading_day ORDER BY operational_ts DESC) AS rn
                FROM base
                WHERE total_value IS NOT NULL
            )
            SELECT
                daily.*,
                first_positive.total_value AS first_positive_total_m3,
                last_positive.total_value AS last_positive_total_m3,
                last_raw.total_value AS raw_totalizer_close_m3,
                COALESCE(transitions.negative_transitions, 0) AS negative_transitions,
                COALESCE(transitions.impossible_jumps, 0) AS impossible_jumps,
                transitions.max_positive_delta,
                transitions.min_delta
            FROM daily
            LEFT JOIN first_positive
              ON first_positive.sensor_id = daily.sensor_id
             AND first_positive.reading_day = daily.reading_day
             AND first_positive.rn = 1
            LEFT JOIN last_positive
              ON last_positive.sensor_id = daily.sensor_id
             AND last_positive.reading_day = daily.reading_day
             AND last_positive.rn = 1
            LEFT JOIN last_raw
              ON last_raw.sensor_id = daily.sensor_id
             AND last_raw.reading_day = daily.reading_day
             AND last_raw.rn = 1
            LEFT JOIN transitions
              ON transitions.sensor_id = daily.sensor_id
             AND transitions.reading_day = daily.reading_day
            ORDER BY daily.reading_day, daily.sensor_id
        """)
        cursor = local_start
        while cursor < local_end:
            chunk_end = min(cursor + read_chunk, local_end)
            raw_start, raw_end = _raw_bounds(cursor, chunk_end, mode)
            offset_minutes = int((cursor.replace(tzinfo=LOCAL_ZONE).utcoffset() or timedelta(0)).total_seconds() // 60)
            params = {
                'raw_start': raw_start,
                'raw_end': raw_end,
                'local_start': cursor,
                'local_end': chunk_end,
                'offset_minutes': offset_minutes,
                'max_delta': MAX_TECHNICAL_PERIOD_DELTA_M3,
            }
            for row in _query_mappings(sql, params, stage=f'resumen diario set-based {mode}'):
                output[(int(row['sensor_id']), str(row['reading_day']))] = row
            cursor = chunk_end
    return output


def _reconcile_iot_daily(
    daily_map: dict[tuple[int, str], dict[str, Any]],
    start_day: date,
    end_day: date,
    local_start: datetime,
    local_end: datetime,
) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    previous_positive: dict[int, float | None] = {sensor_id: None for sensor_id in SENSOR_IDS}
    for day_value in _date_iter(start_day, end_day):
        expected = _expected_minutes(day_value, local_start, local_end)
        for sensor_id in SENSOR_IDS:
            meta = SENSOR_CATALOG[sensor_id]
            row = daily_map.get((sensor_id, day_value.isoformat())) or {}
            first_positive = _safe_float(row.get('first_positive_total_m3'))
            last_positive = _safe_float(row.get('last_positive_total_m3'))
            prior = previous_positive[sensor_id]
            if prior is not None:
                opening = prior
                opening_source = OPENING_PREVIOUS
            elif first_positive is not None:
                opening = first_positive
                opening_source = OPENING_FIRST_PERIOD
            else:
                opening = None
                opening_source = OPENING_MISSING
            samples = int(row.get('rows_observed') or 0)
            observed = int(row.get('observed_minutes') or 0)
            coverage_pct = _coverage_pct(observed, expected)
            assessed = assess_interval(
                samples=samples,
                flow_samples=int(row.get('flow_samples') or 0),
                flow_avg=_safe_float(row.get('flow_avg')),
                flow_min=_safe_float(row.get('flow_min')),
                flow_max=_safe_float(row.get('flow_max')),
                opening=opening,
                opening_source=opening_source,
                first_period_total=first_positive,
                raw_close=_safe_float(row.get('raw_totalizer_close_m3')),
                effective_close=last_positive,
                negative_transitions=int(row.get('negative_transitions') or 0),
                impossible_jumps=int(row.get('impossible_jumps') or 0),
                coverage_pct=coverage_pct,
                last_sample_ts=row.get('last_operational_ts'),
            )
            output.append({
                'module': meta['module'], 'element': meta['name'], 'sensor': sensor_id,
                'operational_key': str(sensor_id), 'day': day_value.isoformat(), **assessed,
            })
            if last_positive is not None:
                previous_positive[sensor_id] = last_positive
    return output


def _reconcile_sosa_daily(
    daily_map: dict[str, dict[str, Any]],
    start_day: date,
    end_day: date,
    local_start: datetime,
    local_end: datetime,
) -> list[dict[str, Any]]:
    """Reconcile SOSA directly from the daily BOS aggregate.

    This avoids recursively loading the complete Wells module merely to obtain the
    SOSA series during a full-history PDF/Excel export.
    """
    output: list[dict[str, Any]] = []
    previous_positive: float | None = None
    for day_value in _date_iter(start_day, end_day):
        day_key = day_value.isoformat()
        row = daily_map.get(day_key) or {}
        first_positive = _safe_float(row.get('first_positive_total_m3'))
        last_positive = _safe_float(row.get('last_positive_total_m3'))
        if previous_positive is not None:
            opening = previous_positive
            opening_source = OPENING_PREVIOUS
        elif first_positive is not None:
            opening = first_positive
            opening_source = OPENING_FIRST_PERIOD
        else:
            opening = None
            opening_source = OPENING_MISSING
        expected = _expected_minutes(day_value, local_start, local_end)
        observed = int(row.get('observed_minutes') or 0)
        assessed = assess_interval(
            samples=int(row.get('rows_observed') or 0),
            flow_samples=int(row.get('flow_samples') or 0),
            flow_avg=_safe_float(row.get('flow_avg')),
            flow_min=_safe_float(row.get('flow_min')),
            flow_max=_safe_float(row.get('flow_max')),
            opening=opening,
            opening_source=opening_source,
            first_period_total=first_positive,
            raw_close=_safe_float(row.get('raw_totalizer_close_m3')),
            effective_close=last_positive,
            negative_transitions=int(row.get('negative_transitions') or 0),
            impossible_jumps=int(row.get('impossible_jumps') or 0),
            coverage_pct=_coverage_pct(observed, expected),
            last_sample_ts=row.get('last_operational_ts'),
        )
        output.append({
            'module': 'pozos',
            'element': 'SOSA 50%',
            'sensor': None,
            'operational_key': 'sosa-50',
            'day': day_key,
            **assessed,
        })
        if last_positive is not None:
            previous_positive = last_positive
    return output


def _gaps_from_partial_days(
    daily_map: dict[tuple[int, str], dict[str, Any]],
    sosa_daily_map: dict[str, dict[str, Any]],
    start_day: date,
    end_day: date,
    local_start: datetime,
    local_end: datetime,
) -> list[dict[str, Any]]:
    gaps: list[dict[str, Any]] = []
    for day_value in _date_iter(start_day, end_day):
        bounds = _effective_day_bounds(day_value, local_start, local_end)
        if bounds is None:
            continue
        effective_start, effective_end = bounds
        expected = _expected_minutes(day_value, local_start, local_end)
        partial_iot = [
            sid for sid in RAW_SENSOR_IDS
            if int((daily_map.get((sid, day_value.isoformat())) or {}).get('observed_minutes') or 0) < expected
        ]
        grouped: dict[int, list[dict[str, Any]]] = {}
        if partial_iot:
            day_rows = _query_iot_day(effective_start, effective_end)
            grouped = _group_iot_rows(day_rows)
        for sensor_id in partial_iot:
            meta = RAW_SENSOR_CATALOG[sensor_id]
            minute_keys = sorted({_minute_key(row['timestamp']) for row in grouped.get(sensor_id, []) if isinstance(row.get('timestamp'), datetime)})
            _append_minute_gaps(gaps, meta['module'], meta['name'], sensor_id, minute_keys, effective_start, effective_end)
        sosa_observed = int((sosa_daily_map.get(day_value.isoformat()) or {}).get('observed_minutes') or 0)
        if sosa_observed < expected:
            sosa_rows = _query_sosa_minute_day(effective_start, effective_end) if sosa_observed else []
            minute_keys = sorted({_minute_key(row['timestamp']) for row in sosa_rows if isinstance(row.get('timestamp'), datetime)})
            _append_minute_gaps(gaps, 'pozos', 'SOSA 50%', None, minute_keys, effective_start, effective_end)
    return gaps


def _append_minute_gaps(
    gaps: list[dict[str, Any]], module: str, element: str, sensor: int | None,
    minute_keys: list[datetime], start: datetime, end: datetime,
) -> None:
    cursor = start.replace(second=0, microsecond=0)
    for current in minute_keys:
        if current > cursor:
            gaps.append({
                'module': module, 'element': element, 'sensor': sensor,
                'gap_start': cursor, 'gap_end': current,
                'missing_minutes': int((current - cursor).total_seconds() // 60),
                'type': 'hueco_interno',
            })
        cursor = max(cursor, current + timedelta(minutes=1))
    if cursor < end:
        gaps.append({
            'module': module, 'element': element, 'sensor': sensor,
            'gap_start': cursor, 'gap_end': end,
            'missing_minutes': int((end - cursor).total_seconds() // 60),
            'type': 'sin_registros' if not minute_keys else 'fin_intervalo',
        })

def _minute_key(value: datetime) -> datetime:
    return value.replace(second=0, microsecond=0)


def _group_iot_rows(rows: list[dict[str, Any]]) -> dict[int, list[dict[str, Any]]]:
    grouped: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[int(row['sensor_id'])].append(row)
    return grouped


def _raw_stats(rows: list[dict[str, Any]]) -> dict[str, Any]:
    flow_values: list[float] = []
    total_values: list[float] = []
    stats = {
        'rows_observed': len(rows),
        'zero_flow_rows': 0,
        'zero_totalizer_rows': 0,
        'null_flow_rows': 0,
        'null_totalizer_rows': 0,
        'invalid_flow_rows': 0,
        'invalid_totalizer_rows': 0,
        'flow_avg': None,
        'flow_min': None,
        'flow_max': None,
        'total_min': None,
        'total_max': None,
    }
    for row in rows:
        raw_flow = row.get('instant_value')
        raw_total = row.get('total_value')
        flow = _safe_float(raw_flow)
        total = _safe_float(raw_total)
        if raw_flow is None:
            stats['null_flow_rows'] += 1
        elif flow is None:
            stats['invalid_flow_rows'] += 1
        elif flow == 0:
            stats['zero_flow_rows'] += 1
        if raw_total is None:
            stats['null_totalizer_rows'] += 1
        elif total is None:
            stats['invalid_totalizer_rows'] += 1
        elif total == 0:
            stats['zero_totalizer_rows'] += 1
        if flow is not None:
            flow_values.append(flow)
        if total is not None:
            total_values.append(total)
    if flow_values:
        stats['flow_avg'] = sum(flow_values) / len(flow_values)
        stats['flow_min'] = min(flow_values)
        stats['flow_max'] = max(flow_values)
    if total_values:
        stats['total_min'] = min(total_values)
        stats['total_max'] = max(total_values)
    return stats


def _positive_transition_stats(rows: list[dict[str, Any]], opening_row: dict[str, Any] | None = None) -> dict[str, Any]:
    values: list[tuple[datetime, float]] = []
    if opening_row and isinstance(opening_row.get('timestamp'), datetime):
        opening_value = _safe_float(opening_row.get('total_value'))
        if opening_value is not None and opening_value > 0:
            values.append((opening_row['timestamp'], opening_value))
    for row in rows:
        total = _safe_float(row.get('total_value'))
        if total is not None and total > 0 and isinstance(row.get('timestamp'), datetime):
            values.append((row['timestamp'], total))
    values.sort(key=lambda item: item[0])
    negative = 0
    jumps = 0
    max_positive: float | None = None
    min_delta: float | None = None
    for (_, previous), (_, current) in zip(values, values[1:]):
        delta = current - previous
        if min_delta is None or delta < min_delta:
            min_delta = delta
        if delta >= 0 and (max_positive is None or delta > max_positive):
            max_positive = delta
        if delta < 0:
            negative += 1
        elif delta > MAX_TECHNICAL_PERIOD_DELTA_M3:
            jumps += 1
    return {
        'negative_transitions': negative,
        'impossible_jumps': jumps,
        'max_positive_delta': max_positive,
        'min_delta': min_delta,
    }


def _last_valid_boundary(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    candidates = [row for row in rows if is_valid_totalizer_boundary(row.get('total_value'))]
    return candidates[-1] if candidates else None


def _coverage_pct(observed: int, expected: int) -> float:
    if expected <= 0:
        return 0.0
    return round(min(max(observed, 0) / expected * 100.0, 100.0), 2)


def _accumulate_summary(summary: dict[str, Any], rows: list[dict[str, Any]], stats: dict[str, Any]) -> None:
    if rows:
        first_ts = rows[0].get('timestamp')
        last_ts = rows[-1].get('timestamp')
        if summary.get('first_operational_ts') is None or (first_ts and first_ts < summary['first_operational_ts']):
            summary['first_operational_ts'] = first_ts
        if summary.get('last_operational_ts') is None or (last_ts and last_ts > summary['last_operational_ts']):
            summary['last_operational_ts'] = last_ts
    for key in ('rows_observed', 'zero_flow_rows', 'zero_totalizer_rows', 'null_flow_rows', 'null_totalizer_rows', 'invalid_flow_rows', 'invalid_totalizer_rows'):
        summary[key] = int(summary.get(key) or 0) + int(stats.get(key) or 0)
    for low_key in ('flow_min', 'total_min'):
        value = stats.get(low_key)
        if value is not None and (summary.get(low_key) is None or value < summary[low_key]):
            summary[low_key] = value
    for high_key in ('flow_max', 'total_max'):
        value = stats.get(high_key)
        if value is not None and (summary.get(high_key) is None or value > summary[high_key]):
            summary[high_key] = value


def _new_summary() -> dict[str, Any]:
    return {
        'first_operational_ts': None,
        'last_operational_ts': None,
        'rows_observed': 0,
        'zero_flow_rows': 0,
        'zero_totalizer_rows': 0,
        'null_flow_rows': 0,
        'null_totalizer_rows': 0,
        'invalid_flow_rows': 0,
        'invalid_totalizer_rows': 0,
        'flow_min': None,
        'flow_max': None,
        'total_min': None,
        'total_max': None,
    }


def _build_incident(
    *,
    module: str,
    element: str,
    sensor: int | None,
    day: str,
    stats: dict[str, Any],
    transition: dict[str, Any],
    observed: int,
    expected: int,
    reconciliation: dict[str, Any],
) -> dict[str, Any] | None:
    coverage = _coverage_pct(observed, expected)
    issues: list[str] = []
    severity = 'observacion'
    if expected > 0 and observed == 0:
        issues.append('Sin registros')
        severity = 'error'
    elif expected > 0 and coverage < 99.95:
        issues.append('Cobertura parcial')
        severity = 'revision'
    if int(stats.get('zero_totalizer_rows') or 0):
        issues.append(f"Totalizador=0 ({int(stats['zero_totalizer_rows'])})")
    if int(stats.get('null_flow_rows') or 0):
        issues.append(f"Flujo nulo ({int(stats['null_flow_rows'])})")
    if int(stats.get('null_totalizer_rows') or 0):
        issues.append(f"Totalizador nulo ({int(stats['null_totalizer_rows'])})")
    if int(stats.get('invalid_flow_rows') or 0):
        issues.append(f"Flujo inválido ({int(stats['invalid_flow_rows'])})")
        severity = 'error'
    if int(stats.get('invalid_totalizer_rows') or 0):
        issues.append(f"Totalizador inválido ({int(stats['invalid_totalizer_rows'])})")
        severity = 'error'
    if int(transition.get('negative_transitions') or 0):
        issues.append(f"Delta negativo ({int(transition['negative_transitions'])})")
        severity = 'revision'
    if int(transition.get('impossible_jumps') or 0):
        issues.append(f"Salto improbable ({int(transition['impossible_jumps'])})")
        severity = 'revision'
    quality_status = str(reconciliation.get('quality_status') or '')
    quality_label = str(reconciliation.get('quality_label') or '')
    review_reason = str(reconciliation.get('review_reason') or '')
    if quality_status in {'review', 'partial', 'no_data'}:
        issues.append(f"Calidad: {quality_label or quality_status}" + (f" / {review_reason}" if review_reason else ''))
        if quality_status in {'review', 'no_data'}:
            severity = 'revision'
    if not issues:
        return None
    return {
        'module': module,
        'element': element,
        'sensor': sensor,
        'day': day,
        'severity': severity,
        'issues': ' | '.join(issues),
        'observed_minutes': observed,
        'expected_minutes': expected,
        'coverage_pct': coverage,
        'zero_flow_rows': int(stats.get('zero_flow_rows') or 0),
        'zero_totalizer_rows': int(stats.get('zero_totalizer_rows') or 0),
        'null_flow_rows': int(stats.get('null_flow_rows') or 0),
        'null_totalizer_rows': int(stats.get('null_totalizer_rows') or 0),
        'invalid_flow_rows': int(stats.get('invalid_flow_rows') or 0),
        'invalid_totalizer_rows': int(stats.get('invalid_totalizer_rows') or 0),
        'negative_transitions': int(transition.get('negative_transitions') or 0),
        'impossible_jumps': int(transition.get('impossible_jumps') or 0),
        'max_positive_delta': transition.get('max_positive_delta'),
        'min_delta': transition.get('min_delta'),
        'quality_label': quality_label or None,
        'review_reason': review_reason or None,
    }


def _collect_support_data(
    start_day: date,
    end_day: date,
    local_start: datetime,
    local_end: datetime,
    *,
    first_physical_ts: datetime | None = None,
    include_gap_detail: bool = True,
) -> dict[str, Any]:
    cache_key = f'fast-v3|{local_start.isoformat()}|{local_end.isoformat()}|gaps={int(include_gap_detail)}'
    cached = _SUPPORT_DATA_CACHE.get(cache_key)
    if cached and monotonic() < float(cached.get('expires_at') or 0):
        logger.info('Insurgentes full history support cache hit')
        return deepcopy(cached['value'])

    started = monotonic()
    logger.info('Insurgentes full history support scan start %s -> %s', local_start, local_end)
    iot_daily_map = _query_iot_daily_support(local_start, local_end)
    logger.info('Insurgentes full history IOT daily aggregate seconds=%.2f', monotonic() - started)
    sosa_raw_daily_map = _query_sosa_raw_daily(local_start, local_end)
    logger.info('Insurgentes full history SOSA raw aggregate seconds=%.2f', monotonic() - started)

    reconciled = _reconcile_iot_daily(iot_daily_map, start_day, end_day, local_start, local_end)
    sosa_reconciled = _reconcile_sosa_daily(sosa_raw_daily_map, start_day, end_day, local_start, local_end)
    reconciled.extend(sosa_reconciled)
    recon_map = {(str(row.get('sensor')) if row.get('sensor') is not None else 'sosa', str(row.get('day'))): row for row in reconciled}
    logger.info('Insurgentes full history reconciliation seconds=%.2f', monotonic() - started)

    raw_summaries = {sensor_id: _new_summary() for sensor_id in RAW_SENSOR_IDS}
    raw_daily: list[dict[str, Any]] = []
    coverage: list[dict[str, Any]] = []
    incidents: list[dict[str, Any]] = []

    for day_value in _date_iter(start_day, end_day):
        day_key = day_value.isoformat()
        expected = _expected_minutes(day_value, local_start, local_end)
        for sensor_id in RAW_SENSOR_IDS:
            meta = RAW_SENSOR_CATALOG[sensor_id]
            row = iot_daily_map.get((sensor_id, day_key)) or {}
            stats = {
                'rows_observed': int(row.get('rows_observed') or 0),
                'zero_flow_rows': int(row.get('zero_flow_rows') or 0),
                'zero_totalizer_rows': int(row.get('zero_totalizer_rows') or 0),
                'null_flow_rows': int(row.get('null_flow_rows') or 0),
                'null_totalizer_rows': int(row.get('null_totalizer_rows') or 0),
                'invalid_flow_rows': int(row.get('invalid_flow_rows') or 0),
                'invalid_totalizer_rows': int(row.get('invalid_totalizer_rows') or 0),
                'flow_avg': row.get('flow_avg'),
                'flow_min': row.get('flow_min'),
                'flow_max': row.get('flow_max'),
                'total_min': row.get('total_min'),
                'total_max': row.get('total_max'),
            }
            summary = raw_summaries[sensor_id]
            first_ts = row.get('first_operational_ts')
            last_ts = row.get('last_operational_ts')
            if isinstance(first_ts, datetime) and (summary.get('first_operational_ts') is None or first_ts < summary['first_operational_ts']):
                summary['first_operational_ts'] = first_ts
            if isinstance(last_ts, datetime) and (summary.get('last_operational_ts') is None or last_ts > summary['last_operational_ts']):
                summary['last_operational_ts'] = last_ts
            _accumulate_summary(summary, [], stats)
            raw_daily.append({'sensor_id': sensor_id, 'reading_day': day_key, **stats})
            observed = int(row.get('observed_minutes') or 0)
            pct = _coverage_pct(observed, expected)
            coverage.append({
                'module': meta['module'], 'element': meta['name'], 'sensor': sensor_id,
                'day': day_key, 'observed_minutes': observed, 'expected_minutes': expected,
                'coverage_pct': pct,
                'status': 'Sin registros' if observed == 0 else ('Completo' if pct >= 99.95 else 'Cobertura parcial'),
            })
            if sensor_id in SENSOR_CATALOG:
                recon = recon_map.get((str(sensor_id), day_key)) or {
                    'quality_status': 'no_data', 'quality_label': 'Sin datos',
                    'review_reason': None, 'boundary_complete': False, 'volume_m3': None,
                }
            else:
                recon = {
                    'quality_status': 'raw_only', 'quality_label': 'Sólo dato crudo',
                    'review_reason': 'legacy_unmapped', 'boundary_complete': False, 'volume_m3': None,
                }
            transition = {
                'negative_transitions': int(row.get('negative_transitions') or 0),
                'impossible_jumps': int(row.get('impossible_jumps') or 0),
                'max_positive_delta': row.get('max_positive_delta'),
                'min_delta': row.get('min_delta'),
            }
            incident = _build_incident(
                module=meta['module'], element=meta['name'], sensor=sensor_id, day=day_key,
                stats=stats, transition=transition, observed=observed, expected=expected, reconciliation=recon,
            )
            if incident:
                incidents.append(incident)

    sosa_summary = _new_summary()
    normalized_sosa_daily: list[dict[str, Any]] = []
    for day_value in _date_iter(start_day, end_day):
        day_key = day_value.isoformat()
        row = sosa_raw_daily_map.get(day_key) or {}
        stats = {
            'rows_observed': int(row.get('rows_observed') or 0),
            'zero_flow_rows': int(row.get('zero_flow_rows') or 0),
            'zero_totalizer_rows': int(row.get('zero_totalizer_rows') or 0),
            'null_flow_rows': int(row.get('null_flow_rows') or 0),
            'null_totalizer_rows': int(row.get('null_totalizer_rows') or 0),
            'invalid_flow_rows': int(row.get('invalid_flow_rows') or 0),
            'invalid_totalizer_rows': int(row.get('invalid_totalizer_rows') or 0),
            'flow_avg': row.get('flow_avg'),
            'flow_min': row.get('flow_min'),
            'flow_max': row.get('flow_max'),
            'total_min': row.get('total_min'),
            'total_max': row.get('total_max'),
        }
        first_ts = row.get('first_operational_ts')
        last_ts = row.get('last_operational_ts')
        if isinstance(first_ts, datetime) and (sosa_summary.get('first_operational_ts') is None or first_ts < sosa_summary['first_operational_ts']):
            sosa_summary['first_operational_ts'] = first_ts
        if isinstance(last_ts, datetime) and (sosa_summary.get('last_operational_ts') is None or last_ts > sosa_summary['last_operational_ts']):
            sosa_summary['last_operational_ts'] = last_ts
        _accumulate_summary(sosa_summary, [], stats)
        normalized_sosa_daily.append({'reading_day': day_key, **stats})
        expected = _expected_minutes(day_value, local_start, local_end)
        observed = int(row.get('observed_minutes') or 0)
        pct = _coverage_pct(observed, expected)
        coverage.append({
            'module': 'pozos', 'element': 'SOSA 50%', 'sensor': None,
            'day': day_key, 'observed_minutes': observed, 'expected_minutes': expected,
            'coverage_pct': pct,
            'status': 'Sin registros' if observed == 0 else ('Completo' if pct >= 99.95 else 'Cobertura parcial'),
        })
        recon = recon_map.get(('sosa', day_key)) or {
            'quality_status': 'no_data', 'quality_label': 'Sin datos', 'review_reason': None,
            'boundary_complete': False, 'volume_m3': None,
        }
        transition = {
            'negative_transitions': int(recon.get('negative_totalizer_transitions') or 0),
            'impossible_jumps': int(recon.get('impossible_totalizer_jumps') or 0),
            'max_positive_delta': None,
            'min_delta': None,
        }
        incident = _build_incident(
            module='pozos', element='SOSA 50%', sensor=None, day=day_key,
            stats=stats, transition=transition, observed=observed, expected=expected, reconciliation=recon,
        )
        if incident:
            incidents.append(incident)

    gaps = _gaps_from_partial_days(iot_daily_map, sosa_raw_daily_map, start_day, end_day, local_start, local_end) if include_gap_detail else []
    logger.info('Insurgentes full history gap detail seconds=%.2f', monotonic() - started)

    data = {
        'start_day': start_day,
        'end_day': end_day,
        'local_start': local_start,
        'local_end': local_end,
        'first_physical_ts': first_physical_ts,
        'raw_summary': [{'sensor_id': sensor_id, **raw_summaries[sensor_id]} for sensor_id in RAW_SENSOR_IDS],
        'sosa_summary': sosa_summary,
        'raw_daily': raw_daily,
        'sosa_raw_daily': normalized_sosa_daily,
        'coverage': coverage,
        'gaps': sorted(gaps, key=lambda item: (str(item['module']), str(item['element']), item['gap_start'])),
        'reconciled_daily': reconciled,
        'incidents': incidents,
    }
    _SUPPORT_DATA_CACHE[cache_key] = {'expires_at': monotonic() + SUPPORT_CACHE_TTL_SECONDS, 'value': deepcopy(data)}
    logger.info('Insurgentes full history support scan complete seconds=%.2f incidents=%d gaps=%d', monotonic() - started, len(incidents), len(gaps))
    return data

def _cache_key(kind: str, start_day: date, end_day: date) -> str:
    return f'{kind}|{start_day.isoformat()}|{end_day.isoformat()}'


def _cache_get(key: str) -> tuple[bytes, str] | None:
    item = _FULL_EXPORT_CACHE.get(key)
    if not item or monotonic() >= float(item.get('expires_at') or 0):
        _FULL_EXPORT_CACHE.pop(key, None)
        return None
    return bytes(item['content']), str(item['filename'])


def _cache_set(key: str, content: bytes, filename: str, end_day: date) -> tuple[bytes, str]:
    today = datetime.now(LOCAL_ZONE).date()
    ttl = 90 if end_day >= today else 30 * 60
    _FULL_EXPORT_CACHE[key] = {'expires_at': monotonic() + ttl, 'content': bytes(content), 'filename': filename}
    return content, filename


def _header_cells(ws: Any, values: Iterable[Any]) -> list[WriteOnlyCell]:
    cells: list[WriteOnlyCell] = []
    for value in values:
        cell = WriteOnlyCell(ws, value=value)
        cell.font = Font(bold=True, color='FFFFFF')
        cell.fill = PatternFill('solid', fgColor='0B3558')
        cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        cells.append(cell)
    return cells


def _append_header(ws: Any, values: Iterable[Any]) -> None:
    ws.freeze_panes = 'A2'
    ws.append(_header_cells(ws, values))


def _append_rows(ws: Any, rows: Iterable[Iterable[Any]]) -> None:
    for row in rows:
        ws.append(list(row))


def _minute_maps(iot_rows: list[dict[str, Any]], sosa_rows: list[dict[str, Any]]) -> tuple[dict[int, dict[datetime, dict[str, Any]]], dict[datetime, dict[str, Any]]]:
    iot_map: dict[int, dict[datetime, dict[str, Any]]] = defaultdict(dict)
    for row in iot_rows:
        if isinstance(row.get('timestamp'), datetime):
            iot_map[int(row['sensor_id'])][_minute_key(row['timestamp'])] = row
    sosa_map: dict[datetime, dict[str, Any]] = {}
    for row in sosa_rows:
        if isinstance(row.get('timestamp'), datetime):
            sosa_map[_minute_key(row['timestamp'])] = row
    return iot_map, sosa_map


def _write_minute_matrix(wb: Workbook, start_day: date, end_day: date, local_start: datetime, local_end: datetime) -> None:
    ws = wb.create_sheet('Historico crudo 1 min')
    headers = ['Fecha/Hora local']
    for sensor_id in RAW_SENSOR_IDS:
        meta = RAW_SENSOR_CATALOG[sensor_id]
        headers.extend([f"{meta['name']} [{sensor_id}] - Flujo crudo", f"{meta['name']} [{sensor_id}] - Totalizador crudo"])
    headers.extend(['SOSA 50% - Flujo 1m', 'SOSA 50% - Totalizador 1m'])
    _append_header(ws, headers)
    ws.column_dimensions['A'].width = 21
    for idx in range(2, len(headers) + 1):
        ws.column_dimensions[get_column_letter(idx)].width = 20

    for day_value in _date_iter(start_day, end_day):
        bounds = _effective_day_bounds(day_value, local_start, local_end)
        if bounds is None:
            continue
        effective_start, effective_end = bounds
        iot_rows = _query_iot_day(effective_start, effective_end)
        sosa_rows = _query_sosa_minute_day(effective_start, effective_end)
        iot_map, sosa_map = _minute_maps(iot_rows, sosa_rows)
        cursor = effective_start.replace(second=0, microsecond=0)
        while cursor < effective_end:
            output: list[Any] = [cursor]
            for sensor_id in RAW_SENSOR_IDS:
                row = iot_map.get(sensor_id, {}).get(cursor)
                output.extend([row.get('instant_value') if row else None, row.get('total_value') if row else None])
            sosa_row = sosa_map.get(cursor)
            output.extend([sosa_row.get('instant_value') if sosa_row else None, sosa_row.get('total_value') if sosa_row else None])
            ws.append(output)
            cursor += timedelta(minutes=1)


def _build_excel(data: dict[str, Any]) -> bytes:
    started = monotonic()
    wb = Workbook(write_only=True)
    start_day: date = data['start_day']
    end_day: date = data['end_day']
    local_start: datetime = data['local_start']
    local_end: datetime = data['local_end']
    coverage = data['coverage']
    gaps = data['gaps']
    reconciled = data['reconciled_daily']
    incidents = data['incidents']
    raw_summary_map = {int(row['sensor_id']): row for row in data['raw_summary']}

    summary_ws = wb.create_sheet('Resumen')
    _append_header(summary_ws, ['Indicador', 'Valor'])
    coverage_values = [float(row['coverage_pct']) for row in coverage if int(row.get('expected_minutes') or 0) > 0]
    zero_days = sum(1 for row in coverage if int(row.get('expected_minutes') or 0) > 0 and int(row.get('observed_minutes') or 0) == 0)
    review_daily = sum(1 for row in reconciled if str(row.get('quality_status') or '') in {'review', 'partial', 'no_data'})
    _append_rows(summary_ws, [
        ['Planta', 'Las Fuentes'],
        ['Periodo integral', f'{start_day.isoformat()} a {end_day.isoformat()}'],
        ['Primer día incluido desde', local_start],
        ['Primer registro físico real', data.get('first_physical_ts') or local_start],
        ['Corte de generación', local_end],
        ['Zona horaria', LOCAL_TIMEZONE],
        ['Sensores minutales incluidos', len(RAW_SENSOR_IDS)],
        ['Canal 1002', 'Incluido como dato crudo legacy/unmapped; excluido de cálculos operativos'],
        ['SOSA 50%', 'Fuente BOS; se reduce a una muestra operativa por minuto para el detalle'],
        ['Cobertura media observada (%)', round(sum(coverage_values) / len(coverage_values), 2) if coverage_values else None],
        ['Filas sensor/día sin registros', zero_days],
        ['Intervalos diarios parcial/revisión', review_daily],
        ['Incidencias sensor/día', len(incidents)],
        ['Huecos detectados', len(gaps)],
        ['Contrato temporal', '[T0,T1), apertura = última lectura positiva válida < T0'],
        ['Optimización', 'Consulta por día y reloj físico indexable; detalle crudo en matriz 1 fila/minuto'],
    ])

    raw_summary_ws = wb.create_sheet('Resumen crudo')
    _append_header(raw_summary_ws, ['Módulo', 'Elemento', 'Sensor', 'Modo timestamp', 'Primer registro', 'Último registro', 'Filas crudas', 'Flujo=0', 'Totalizador=0', 'Flujo nulo', 'Totalizador nulo', 'Flujo inválido', 'Totalizador inválido', 'Flujo mín', 'Flujo máx', 'Total mín', 'Total máx'])
    for sensor_id in RAW_SENSOR_IDS:
        meta = RAW_SENSOR_CATALOG[sensor_id]
        row = raw_summary_map.get(sensor_id) or {}
        raw_summary_ws.append([meta['module'], meta['name'], sensor_id, READINGS_MINUTE_TIMESTAMP_MODE_BY_SENSOR.get(sensor_id, 'unknown'), row.get('first_operational_ts'), row.get('last_operational_ts'), row.get('rows_observed'), row.get('zero_flow_rows'), row.get('zero_totalizer_rows'), row.get('null_flow_rows'), row.get('null_totalizer_rows'), row.get('invalid_flow_rows'), row.get('invalid_totalizer_rows'), row.get('flow_min'), row.get('flow_max'), row.get('total_min'), row.get('total_max')])
    sosa = data['sosa_summary'] or {}
    raw_summary_ws.append(['pozos', 'SOSA 50%', None, 'utc', sosa.get('first_operational_ts'), sosa.get('last_operational_ts'), sosa.get('rows_observed'), sosa.get('zero_flow_rows'), sosa.get('zero_totalizer_rows'), sosa.get('null_flow_rows'), sosa.get('null_totalizer_rows'), sosa.get('invalid_flow_rows'), sosa.get('invalid_totalizer_rows'), sosa.get('flow_min'), sosa.get('flow_max'), sosa.get('total_min'), sosa.get('total_max')])

    raw_daily_ws = wb.create_sheet('Datos crudos diarios')
    _append_header(raw_daily_ws, ['Módulo', 'Elemento', 'Sensor', 'Día', 'Filas crudas', 'Flujo=0', 'Totalizador=0', 'Flujo nulo', 'Totalizador nulo', 'Flujo inválido', 'Totalizador inválido', 'Flujo prom', 'Flujo mín', 'Flujo máx', 'Total mín', 'Total máx'])
    for row in data['raw_daily']:
        sensor_id = int(row['sensor_id'])
        meta = RAW_SENSOR_CATALOG[sensor_id]
        raw_daily_ws.append([meta['module'], meta['name'], sensor_id, row.get('reading_day'), row.get('rows_observed'), row.get('zero_flow_rows'), row.get('zero_totalizer_rows'), row.get('null_flow_rows'), row.get('null_totalizer_rows'), row.get('invalid_flow_rows'), row.get('invalid_totalizer_rows'), row.get('flow_avg'), row.get('flow_min'), row.get('flow_max'), row.get('total_min'), row.get('total_max')])
    for row in data['sosa_raw_daily']:
        raw_daily_ws.append(['pozos', 'SOSA 50%', None, row.get('reading_day'), row.get('rows_observed'), row.get('zero_flow_rows'), row.get('zero_totalizer_rows'), row.get('null_flow_rows'), row.get('null_totalizer_rows'), row.get('invalid_flow_rows'), row.get('invalid_totalizer_rows'), row.get('flow_avg'), row.get('flow_min'), row.get('flow_max'), row.get('total_min'), row.get('total_max')])

    incidents_ws = wb.create_sheet('Incidencias diarias')
    _append_header(incidents_ws, ['Módulo', 'Elemento', 'Sensor', 'Día', 'Severidad', 'Incidencias', 'Min observados', 'Min esperados', 'Cobertura %', 'Flujo=0', 'Totalizador=0', 'Flujo nulo', 'Totalizador nulo', 'Flujo inválido', 'Totalizador inválido', 'Deltas negativos', 'Saltos improbables', 'Delta positivo máx', 'Delta mín', 'Calidad', 'Motivo revisión'])
    for row in incidents:
        incidents_ws.append([row.get('module'), row.get('element'), row.get('sensor'), row.get('day'), row.get('severity'), row.get('issues'), row.get('observed_minutes'), row.get('expected_minutes'), row.get('coverage_pct'), row.get('zero_flow_rows'), row.get('zero_totalizer_rows'), row.get('null_flow_rows'), row.get('null_totalizer_rows'), row.get('invalid_flow_rows'), row.get('invalid_totalizer_rows'), row.get('negative_transitions'), row.get('impossible_jumps'), row.get('max_positive_delta'), row.get('min_delta'), row.get('quality_label'), row.get('review_reason')])

    daily_ws = wb.create_sheet('Conciliado diario')
    _append_header(daily_ws, ['Módulo', 'Elemento', 'Sensor', 'Clave operativa', 'Día', 'Flujo prom L/s', 'Flujo mín L/s', 'Flujo máx L/s', 'Apertura m3', 'Cierre m3', 'Volumen m3', 'Muestras', 'Cobertura %', 'Fuente apertura', 'Frontera completa', 'Calidad', 'Estado calidad', 'Motivo revisión'])
    for row in reconciled:
        daily_ws.append([row.get('module'), row.get('element'), row.get('sensor'), row.get('operational_key'), row.get('day'), row.get('flow_avg_lps'), row.get('flow_min_lps'), row.get('flow_max_lps'), row.get('totalizer_open_m3'), row.get('effective_totalizer_close_m3') or row.get('totalizer_close_m3'), row.get('volume_m3'), row.get('samples'), row.get('coverage_pct'), row.get('opening_source'), row.get('boundary_complete'), row.get('quality_label'), row.get('quality_status'), row.get('review_reason')])

    coverage_ws = wb.create_sheet('Cobertura diaria')
    _append_header(coverage_ws, ['Módulo', 'Elemento', 'Sensor', 'Día', 'Minutos observados', 'Minutos esperados', 'Cobertura %', 'Estado'])
    for row in coverage:
        coverage_ws.append([row['module'], row['element'], row['sensor'], row['day'], row['observed_minutes'], row['expected_minutes'], row['coverage_pct'], row['status']])

    gaps_ws = wb.create_sheet('Huecos')
    _append_header(gaps_ws, ['Módulo', 'Elemento', 'Sensor', 'Inicio hueco', 'Fin hueco', 'Minutos ausentes', 'Tipo'])
    for row in gaps:
        gaps_ws.append([row['module'], row['element'], row['sensor'], row['gap_start'], row['gap_end'], row['missing_minutes'], row['type']])

    sensors_ws = wb.create_sheet('Sensores')
    _append_header(sensors_ws, ['Módulo', 'Elemento', 'Sensor', 'Rol', 'Modo timestamp', 'Inicio físico conocido', 'Primer flujo != 0', 'Primer totalizador > 0'])
    for sensor_id in RAW_SENSOR_IDS:
        meta = RAW_SENSOR_CATALOG[sensor_id]
        evidence = SENSOR_AUDIT_EVIDENCE.get(sensor_id, {})
        sensors_ws.append([meta['module'], meta['name'], sensor_id, 'operativo' if sensor_id in SENSOR_CATALOG else 'legacy_unmapped_pending_review', READINGS_MINUTE_TIMESTAMP_MODE_BY_SENSOR.get(sensor_id), evidence.get('physical_history_start'), evidence.get('first_nonzero_flow'), evidence.get('first_positive_totalizer')])
    sensors_ws.append(['pozos', 'SOSA 50%', None, 'operativo BOS', 'utc', SOURCE_CONTRACTS['tanque_bos'].get('physical_history_start_local'), None, None])

    notes_ws = wb.create_sheet('Notas de calidad')
    _append_header(notes_ws, ['Regla', 'Descripción'])
    _append_rows(notes_ws, [
        ['Alcance', 'Desde el primer registro físico disponible hasta el momento de generación; no depende del selector del Reporte Diario.'],
        ['Dato crudo', 'Los ceros y valores almacenados se conservan. La celda vacía significa que no existe lectura para ese minuto.'],
        ['Incidencias', 'Días sin registros, cobertura parcial, ceros, nulos, valores inválidos, deltas negativos y saltos improbables se listan por sensor/día.'],
        ['Matriz 1 minuto', 'Una fila representa un minuto de planta; cada sensor ocupa dos columnas (flujo/totalizador), como en el histórico completo de referencia de Zapopan.'],
        ['3002/3004', 'Su timestamp físico minutal se interpreta como UTC y se normaliza a America/Mexico_City antes de colocarlo en la matriz.'],
        ['SOSA 50%', 'La fuente física tiene frecuencia superior a 1 fila/min; se conserva el conteo crudo diario y se presenta una muestra operativa por minuto en la matriz.'],
        ['1002', 'Canal físico legacy incluido para auditoría; no entra en cálculos operativos por no tener mapeo confirmado.'],
        ['Conciliación', 'Se usa la misma función común reconcile_interval con [T0,T1), apertura previa positiva y contrato de calidad.'],
    ])

    _write_minute_matrix(wb, start_day, end_day, local_start, local_end)
    buffer = BytesIO()
    wb.save(buffer)
    logger.info('Insurgentes full history Excel build complete seconds=%.2f bytes=%d', monotonic() - started, buffer.tell())
    return buffer.getvalue()


def _pdf_table(data: list[list[Any]], widths: list[float] | None = None, font_size: float = 7.5) -> Table:
    table = Table(data, colWidths=widths, repeatRows=1, hAlign='LEFT')
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#0B3558')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), font_size),
        ('GRID', (0, 0), (-1, -1), 0.35, colors.HexColor('#B7C9D6')),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    return table


def _build_pdf(data: dict[str, Any]) -> bytes:
    started = monotonic()
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=landscape(A4), leftMargin=12 * mm, rightMargin=12 * mm, topMargin=12 * mm, bottomMargin=12 * mm)
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle('TitleARCA', parent=styles['Title'], fontName='Helvetica-Bold', fontSize=18, leading=22, textColor=colors.HexColor('#0B3558'), alignment=TA_CENTER)
    h2 = ParagraphStyle('H2ARCA', parent=styles['Heading2'], fontName='Helvetica-Bold', fontSize=11, leading=14, textColor=colors.HexColor('#0B3558'), spaceBefore=8, spaceAfter=6)
    normal = ParagraphStyle('NormalARCA', parent=styles['BodyText'], fontSize=8.5, leading=11, textColor=colors.HexColor('#263746'))
    table_text = ParagraphStyle('TableTextARCA', parent=normal, fontSize=6.5, leading=8)
    story: list[Any] = [
        Paragraph('Histórico completo de soporte - Planta Las Fuentes', title_style),
        Spacer(1, 4 * mm),
        Paragraph(f"Periodo integral: {data['start_day'].isoformat()} a {data['end_day'].isoformat()} | Inicio del primer día: {data['local_start']} | Primer registro físico: {data.get('first_physical_ts') or data['local_start']} | Corte: {data['local_end']} | Zona horaria: {LOCAL_TIMEZONE}", normal),
        Paragraph('Este documento resume todos los días desde el primer registro físico. El Excel conserva la matriz cruda minuto a minuto; este PDF concentra cobertura, incidencias, huecos y conciliación.', normal),
    ]

    coverage = data['coverage']
    gaps = data['gaps']
    reconciled = data['reconciled_daily']
    incidents = data['incidents']
    coverage_by_element: dict[tuple[str, str], list[float]] = defaultdict(list)
    zero_days_by_element: dict[tuple[str, str], int] = defaultdict(int)
    incident_count_by_element: dict[tuple[str, str], int] = defaultdict(int)
    for row in coverage:
        key = (str(row['module']), str(row['element']))
        if int(row.get('expected_minutes') or 0) > 0:
            coverage_by_element[key].append(float(row.get('coverage_pct') or 0))
            if int(row.get('observed_minutes') or 0) == 0:
                zero_days_by_element[key] += 1
    for row in incidents:
        incident_count_by_element[(str(row.get('module')), str(row.get('element')))] += 1

    story.append(Paragraph('Resumen de cobertura e incidencias', h2))
    coverage_table = [['Módulo', 'Elemento', 'Cobertura media', 'Días sin registros', 'Días con incidencia', 'Días incompletos']]
    for key in sorted(coverage_by_element):
        values = coverage_by_element[key]
        incomplete_days = sum(
            1 for row in coverage
            if (str(row.get('module')), str(row.get('element'))) == key
            and int(row.get('expected_minutes') or 0) > 0
            and int(row.get('observed_minutes') or 0) < int(row.get('expected_minutes') or 0)
        )
        coverage_table.append([key[0], key[1], f"{sum(values)/len(values):.2f}%" if values else '—', zero_days_by_element.get(key, 0), incident_count_by_element.get(key, 0), incomplete_days])
    story.append(_pdf_table(coverage_table, [24 * mm, 52 * mm, 30 * mm, 29 * mm, 30 * mm, 25 * mm], font_size=7))

    story.append(Paragraph('Incidencias por sensor y día', h2))
    incident_table: list[list[Any]] = [['Día', 'Módulo', 'Elemento', 'Sensor', 'Cobertura', 'Incidencias detectadas']]
    for row in sorted(incidents, key=lambda item: (str(item.get('day')), str(item.get('module')), str(item.get('element')))):
        incident_table.append([row.get('day'), row.get('module'), row.get('element'), row.get('sensor') if row.get('sensor') is not None else 'SOSA', f"{float(row.get('coverage_pct') or 0):.2f}%", Paragraph(str(row.get('issues') or '—'), table_text)])
    if len(incident_table) == 1:
        incident_table.append(['—', '—', 'Sin incidencias detectadas', '—', '—', '—'])
    story.append(_pdf_table(incident_table, [22 * mm, 22 * mm, 43 * mm, 22 * mm, 23 * mm, 108 * mm], font_size=6.3))

    story.append(Paragraph('Resumen hidráulico diario conciliado', h2))
    by_element: dict[tuple[str, str], dict[str, Any]] = {}
    for row in reconciled:
        key = (str(row.get('module')), str(row.get('element')))
        item = by_element.setdefault(key, {'validated_volume': 0.0, 'validated_days': 0, 'review_days': 0})
        volume = _safe_float(row.get('volume_m3'))
        if volume is not None and bool(row.get('boundary_complete')) and str(row.get('quality_status')) not in {'review', 'no_data'}:
            item['validated_volume'] += volume
            item['validated_days'] += 1
        if str(row.get('quality_status')) in {'review', 'partial', 'no_data'}:
            item['review_days'] += 1
    hydraulic_table = [['Módulo', 'Elemento', 'Volumen validado m3', 'Días con volumen', 'Días parcial/revisión']]
    for key, item in sorted(by_element.items()):
        hydraulic_table.append([key[0], key[1], f"{item['validated_volume']:.2f}", item['validated_days'], item['review_days']])
    story.append(_pdf_table(hydraulic_table, [28 * mm, 55 * mm, 38 * mm, 32 * mm, 38 * mm]))

    story.append(Paragraph('Cobertura incompleta principal', h2))
    incomplete_table = [['Día', 'Módulo', 'Elemento', 'Observados', 'Esperados', 'Minutos faltantes']]
    incomplete_rows = [
        row for row in coverage
        if int(row.get('expected_minutes') or 0) > int(row.get('observed_minutes') or 0)
    ]
    incomplete_rows.sort(
        key=lambda item: int(item.get('expected_minutes') or 0) - int(item.get('observed_minutes') or 0),
        reverse=True,
    )
    for row in incomplete_rows[:80]:
        expected = int(row.get('expected_minutes') or 0)
        observed = int(row.get('observed_minutes') or 0)
        incomplete_table.append([
            row.get('day'), row.get('module'), row.get('element'), observed, expected, max(expected - observed, 0),
        ])
    if len(incomplete_table) == 1:
        incomplete_table.append(['—', '—', 'Sin días con cobertura incompleta', 0, 0, 0])
    story.append(_pdf_table(incomplete_table, [24 * mm, 28 * mm, 55 * mm, 28 * mm, 28 * mm, 35 * mm], font_size=7))

    story.append(Paragraph('Reglas de calidad', h2))
    story.append(_pdf_table([
        ['Regla', 'Aplicación'],
        ['Alcance', 'Desde el primer registro físico hasta el momento de generación; independiente del Reporte Diario.'],
        ['Consulta', 'Lectura por día sobre el timestamp físico para permitir uso de índices SQL Server.'],
        ['Crudo', 'Ceros y datos almacenados se conservan; ausencia permanece vacía/0 % cobertura.'],
        ['Conciliación', 'Misma función reconcile_interval y contrato [T0,T1) utilizado por la operación.'],
        ['UTC/local', '3002/3004 y SOSA se convierten a America/Mexico_City antes de agrupar.'],
        ['1002', 'Incluido como evidencia cruda y excluido de cálculos operativos por falta de mapeo confirmado.'],
    ], [38 * mm, 200 * mm], font_size=7.5))

    doc.build(story)
    logger.info('Insurgentes full history PDF build complete seconds=%.2f bytes=%d', monotonic() - started, buffer.tell())
    return buffer.getvalue()


def export_insurgentes_full_history_excel(*, force_refresh: bool = False) -> tuple[bytes, str]:
    start_day, end_day, local_start, local_end, first_physical_ts = _resolve_complete_range()
    key = _cache_key('xlsx-complete-v2', start_day, end_day)
    if not force_refresh:
        cached = _cache_get(key)
        if cached is not None:
            return cached
    started = monotonic()
    data = _collect_support_data(start_day, end_day, local_start, local_end, first_physical_ts=first_physical_ts)
    content = _build_excel(data)
    filename = f'las_fuentes_historico_completo_{start_day.isoformat()}_{end_day.isoformat()}.xlsx'
    logger.info('Insurgentes full history Excel total seconds=%.2f', monotonic() - started)
    return _cache_set(key, content, filename, end_day)


def export_insurgentes_full_history_pdf(*, force_refresh: bool = False) -> tuple[bytes, str]:
    start_day, end_day, local_start, local_end, first_physical_ts = _resolve_complete_range()
    key = _cache_key('pdf-complete-v2', start_day, end_day)
    if not force_refresh:
        cached = _cache_get(key)
        if cached is not None:
            return cached
    started = monotonic()
    data = _collect_support_data(
        start_day, end_day, local_start, local_end,
        first_physical_ts=first_physical_ts, include_gap_detail=False,
    )
    content = _build_pdf(data)
    filename = f'las_fuentes_historico_completo_{start_day.isoformat()}_{end_day.isoformat()}.pdf'
    logger.info('Insurgentes full history PDF total seconds=%.2f', monotonic() - started)
    return _cache_set(key, content, filename, end_day)
