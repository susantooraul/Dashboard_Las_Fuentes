from __future__ import annotations

from copy import deepcopy
from datetime import datetime, date, timedelta
import logging
import re
from time import monotonic
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.database import SessionLocal


logger = logging.getLogger(__name__)

_CACHE_TTL_SECONDS = 10 * 60
_CURRENT_PAYLOAD_TTL_SECONDS = 20
_HISTORY_PAYLOAD_TTL_SECONDS = 10 * 60
_MONTHLY_PAYLOAD_TTL_SECONDS = 30 * 60
_MAX_PAYLOAD_CACHE_ENTRIES = 80
_DASHBOARD_PAYLOAD_CACHE: dict[str, dict[str, Any]] = {}
_SENSOR_CATALOG_CACHE: dict[str, Any] = {'expires_at': 0.0, 'value': None}
_WELL_LOCATIONS_CACHE: dict[str, Any] = {'expires_at': 0.0, 'value': None}
_SP_GET_ENERGY_WATER_WARNED = False
_SQL_WARNING_KEYS: set[str] = set()



def _warn_sql_once(key: str, message: str, exc: SQLAlchemyError) -> None:
    if key not in _SQL_WARNING_KEYS:
        logger.warning('%s: %s', message, exc)
        _SQL_WARNING_KEYS.add(key)
    else:
        logger.debug('%s: %s', message, exc)


def _cache_get(cache: dict[str, Any], label: str) -> Any | None:
    value = cache.get('value')
    if value is None:
        return None
    if monotonic() >= float(cache.get('expires_at') or 0):
        logger.info('water_bos cache expired: %s', label)
        return None
    logger.info('water_bos cache hit: %s', label)
    return deepcopy(value)


def _cache_get_stale(cache: dict[str, Any], label: str) -> Any | None:
    value = cache.get('value')
    if value is None:
        return None
    logger.warning('water_bos using stale cache after SQL error: %s', label)
    return deepcopy(value)


def _cache_set(cache: dict[str, Any], value: Any, label: str) -> Any:
    if not value:
        logger.info('water_bos cache not stored because value is empty: %s', label)
        return value
    cache['value'] = deepcopy(value)
    cache['expires_at'] = monotonic() + _CACHE_TTL_SECONDS
    logger.info('water_bos cache refreshed: %s ttl=%ss', label, _CACHE_TTL_SECONDS)
    return value


def _date_span_days_for_cache(start_date: Any = None, end_date: Any = None) -> int:
    start, end = _date_bounds(start_date, end_date)
    if not start or not end:
        return 0
    return abs((end - start).days) + 1


def _payload_cache_key(
    start_date: Any = None,
    end_date: Any = None,
    period: Any = None,
    include_history: bool = False,
    include_energy_water: bool = False,
    include_period_deltas: bool = False,
    include_optional_catalogs: bool = False,
) -> str:
    start, end = _date_bounds(start_date, end_date)
    return '|'.join([
        str(start or ''),
        str(end or ''),
        str(period or ''),
        'history' if include_history else 'current',
        'energy' if include_energy_water else 'no-energy',
        'deltas' if include_period_deltas else 'no-deltas',
        'catalogs' if include_optional_catalogs else 'no-catalogs',
    ])


def _payload_cache_ttl(start_date: Any = None, end_date: Any = None, period: Any = None, include_history: bool = False, include_period_deltas: bool = False) -> int:
    # Las lecturas actuales del Resumen no deben quedar atrapadas en el TTL
    # largo de históricos, incluso cuando pidan deltas del día actual.
    if not include_history and not start_date and not end_date:
        return _CURRENT_PAYLOAD_TTL_SECONDS
    if not include_history and not include_period_deltas:
        return _CURRENT_PAYLOAD_TTL_SECONDS
    period_text = str(period or '').lower()
    if 'month' in period_text or 'mensual' in period_text or _date_span_days_for_cache(start_date, end_date) > 31:
        return _MONTHLY_PAYLOAD_TTL_SECONDS
    return _HISTORY_PAYLOAD_TTL_SECONDS


def _payload_cache_get(cache_key: str) -> dict[str, Any] | None:
    entry = _DASHBOARD_PAYLOAD_CACHE.get(cache_key)
    if not entry:
        return None
    if monotonic() >= float(entry.get('expires_at') or 0):
        _DASHBOARD_PAYLOAD_CACHE.pop(cache_key, None)
        logger.info('water_bos payload cache expired: %s', cache_key)
        return None
    logger.info('water_bos payload cache hit: %s', cache_key)
    return deepcopy(entry.get('value'))


def _payload_cache_set(cache_key: str, payload: dict[str, Any] | None, ttl_seconds: int) -> dict[str, Any] | None:
    if not payload or payload.get('__sql_error__') or str(payload.get('source_status') or '').lower() == 'sql_error':
        logger.info('water_bos payload cache not stored because payload is empty or sql_error: %s', cache_key)
        return payload
    if len(_DASHBOARD_PAYLOAD_CACHE) >= _MAX_PAYLOAD_CACHE_ENTRIES and cache_key not in _DASHBOARD_PAYLOAD_CACHE:
        oldest_key = min(_DASHBOARD_PAYLOAD_CACHE, key=lambda key: _DASHBOARD_PAYLOAD_CACHE[key].get('expires_at') or 0)
        _DASHBOARD_PAYLOAD_CACHE.pop(oldest_key, None)
    _DASHBOARD_PAYLOAD_CACHE[cache_key] = {
        'expires_at': monotonic() + ttl_seconds,
        'value': deepcopy(payload),
    }
    logger.info('water_bos payload cache stored: %s ttl=%ss', cache_key, ttl_seconds)
    return payload


def _sql_connection_error_payload() -> dict[str, Any]:
    return {'__sql_error__': True, 'source_status': 'sql_error'}


def _log_timing(label: str, started_at: float) -> None:
    elapsed = monotonic() - started_at
    logger.info('water_bos timing %s %.3fs', label, elapsed)


WELL_NAMES = [
    'Est. Banco (Soriana)',
    'Estacionamiento Gerencia',
    'Viveros',
    'Col Riveras',
    'Arroyo',
    'Estacionamiento',
    'Almacén',
    'Estacionamiento',
    'Nave 8',
    'Ciudad',
]

WELL_IDS = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110]
ENERGY_SENSOR_IDS = [1000, 1050, 1100, 1150, 1200, 1250, 1300, 1350, 1400, 1450]
FLOW_OUT_SENSOR_IDS = [1001, 1051, 1101, 1151, 1201, 1251, 1301, 1351, 1401, 1451]
FLOW_IN_SENSOR_IDS = [1002, 1052, 1102, 1152, 1202, 1252, 1302, 1352, 1402, 1452]

# Pozo 8 / Estacionamiento queda fuera del inventario operativo visible.
# No se renumeran los demas pozos: Nave 8 permanece como Pozo 9.
GUADALUPE_EXCLUDED_WELL_NUMBERS = {8}


def _is_operational_well_number(well_number: int | str | None) -> bool:
    try:
        number = int(well_number or 0)
    except (TypeError, ValueError):
        return False
    return number > 0 and number not in GUADALUPE_EXCLUDED_WELL_NUMBERS


def _operational_well_indices() -> list[int]:
    return [
        index for index in range(len(WELL_IDS))
        if _is_operational_well_number(index + 1)
    ]


def _strip_well_prefix(name: str, well_number: int) -> str:
    text = str(name or '').strip()
    if not text:
        return text
    return re.sub(
        rf'^Pozo\s*(?:#|No\.?|Num\.?|Núm\.?)?\s*0*{well_number}\s*[-–—:]?\s*',
        '',
        text,
        flags=re.IGNORECASE,
    ).strip()


def _format_well_display_name(well_number: int, name: str | None = None) -> str:
    clean_name = _strip_well_prefix(str(name or WELL_NAMES[well_number - 1]).strip(), well_number)
    return f'Pozo {well_number}' if not clean_name else f'Pozo {well_number} - {clean_name}'


GUADALUPE_WELL_SENSOR_MAP = [
    {
        'well_id': WELL_IDS[index],
        'well_number': index + 1,
        'name': _format_well_display_name(index + 1, WELL_NAMES[index]),
        'operational_name': WELL_NAMES[index],
        'energy_sensor_id': ENERGY_SENSOR_IDS[index],
        'flow_out_sensor_id': FLOW_OUT_SENSOR_IDS[index],
        'flow_in_sensor_id': FLOW_IN_SENSOR_IDS[index],
    }
    for index in _operational_well_indices()
]

READINGS_MINUTE_TABLE = 'iot.readings_minute'
READINGS_MINUTE_TIMEOUT_SECONDS = 4
READINGS_MINUTE_MAX_INSTANT_VALUE = 100000.0
READINGS_MINUTE_MAX_TOTAL_VALUE = 100000000.0
# Limites defensivos para no dejar que readings_minute reemplace BOS con
# picos/deltas imposibles. Se escalan por rango cuando aplica.
READINGS_MINUTE_MAX_WATER_DELTA_M3_PER_DAY = 100000.0
# Proteccion especifica para el corte diario por pozo. Los totalizadores pueden
# brincar por reseteos/cambios de señal; este limite evita que esos saltos se
# presenten como "Agua bombeada hoy". Ajustar solo con validacion operativa.
MAX_WELL_DAILY_M3 = 5000.0
# Limite operativo visual para flujo instantaneo de pozos Guadalupe.
# Lecturas mayores se tratan como dato no confiable para no encender
# bombas ni deformar graficas con picos falsos. No aplica a flujos, lineas ni tanques.
MAX_WELL_FLOW_LPS = 25.0
READINGS_MINUTE_MAX_ENERGY_DELTA_KWH_PER_DAY = 1000000.0
READINGS_MINUTE_RECOMMENDED_INDEX = 'iot.readings_minute(sensor_id, ts_local) INCLUDE (ts_minute, instant_value, total_value, quality, inserted_at)'

DISTRIBUTION_NAMES = [
    'Agua Cruda',
    'Agua Recuperada',
    'Agua Suave',
    'TTA (Tratada)',
    'Cabezal Principal',
    'Jarabe',
    'BID',
]


FLOW_SENSOR_MAP = [
    {'sensor_id': 3002, 'name': 'Flujo Calderas'},
    {'sensor_id': 3004, 'name': 'Flujo Dura'},
    {'sensor_id': 3006, 'name': 'Flujo CPI'},
    {'sensor_id': 3008, 'name': 'Flujo Jarabes'},
    {'sensor_id': 3010, 'name': 'Flujo Suave'},
    {'sensor_id': 3012, 'name': 'Flujo Recuperada'},
    {'sensor_id': 3014, 'name': 'Flujo Salmuera'},
    {'sensor_id': 3016, 'name': 'Flujo UV'},
    {'sensor_id': 3018, 'name': 'Flujo Filtros'},
]

# Resumen de tratamiento para balance y reportes.
# 3016 se conserva visible como lectura operativa, pero queda excluido de
# los totales definitivos por duplicado temporal/heredado de la salida.
TREATMENT_RAW_INPUT_SENSOR_ID = 3018
TREATMENT_OUTPUT_SENSOR_IDS = (3012, 3014)
TEMPORARY_DUPLICATE_FLOW_SENSOR_IDS = {3016}


# dbo.NIVELES_BOS expone niveles por columna. El dashboard conserva el nombre
# visual "Tanques", pero estas lecturas se tratan internamente como niveles BOS.
# Mantener aqui unicamente columnas observadas en SQL Server para no asumir una
# tabla de tanques distinta a la disponible.
TANK_LEVEL_COLUMNS = [
    {'key': 'nivel_1k', 'name': 'Tanque 1K', 'type': 'Nivel 1K', 'columns': ('Nivel1K',), 'capacity_m3': 1000, 'max_height_m': 6.50},
    {'key': 'nivel_750a', 'name': 'Tanque 750 A', 'type': 'Nivel 750', 'columns': ('Nivel750A',), 'capacity_m3': 750, 'max_height_m': 13.50},
    {'key': 'nivel_750b', 'name': 'Tanque 750 B', 'type': 'Nivel 750', 'columns': ('Nivel750B',), 'capacity_m3': 750, 'max_height_m': 13.50},
    {'key': 'nivel_500', 'name': 'Tanque 500', 'type': 'Nivel 500', 'columns': ('Nivel500',), 'capacity_m3': 500, 'max_height_m': 6.50},
    {'key': 'nivel_750c', 'name': 'Tanque 750 C', 'type': 'Nivel 750', 'columns': ('Nivel750C', 'Nivel750c'), 'capacity_m3': 750, 'max_height_m': 13.50},
    {'key': 'nivel_750d', 'name': 'Tanque 750 D', 'type': 'Nivel 750', 'columns': ('Nivel750D',), 'capacity_m3': 750, 'max_height_m': 13.50},
    {'key': 'nivel_dura', 'name': 'Tanque agua dura', 'type': 'Agua dura', 'columns': ('NivelDura',), 'capacity_m3': 750, 'max_height_m': 2.55},
    {'key': 'nivel_suave', 'name': 'Tanque agua suave', 'type': 'Agua suave', 'columns': ('NivelSuave',), 'capacity_m3': 750, 'max_height_m': 2.90},
    {'key': 'nivel_recuperada', 'name': 'Tanque agua recuperada', 'type': 'Agua recuperada', 'columns': ('NivelRecuperada',), 'capacity_m3': 750, 'max_height_m': 2.50},
    {'key': 'nivel_salmuera', 'name': 'Tanque salmuera', 'type': 'Salmuera', 'columns': ('NivelSalmuera', 'NivelSalmuer'), 'capacity_m3': 750, 'max_height_m': 2.50},
]


def _row_to_dict(row: Any) -> dict[str, Any] | None:
    if row is None:
        return None
    data = dict(row._mapping)
    return {str(k).lower(): v for k, v in data.items()}


def _first(row: dict[str, Any] | None, *names: str, default: Any = None) -> Any:
    if not row:
        return default
    for name in names:
        key = name.lower()
        if key in row and row[key] is not None:
            return row[key]
    return default


def _num(value: Any, default: float = 0.0) -> float:
    if value is None or value == '':
        return default
    try:
        return float(str(value).replace(',', '').strip())
    except (TypeError, ValueError):
        return default


def _amps_from_quality(value: Any) -> float | None:
    """Return well amperage from the ARCA quality column.

    Most well sensors store quality as amps * 100, for example 1260 ->
    12.60 A. Some sensors, including Pozo 03 / Viveros, already store the
    amperage as a decimal value, for example 30.87 -> 30.87 A.

    This conversion is intentionally used only for well records. Lines and
    tanks keep quality as the raw database value and do not expose amps.
    """
    if value is None or value == '':
        return None
    quality = _num(value, 0)
    if quality <= 0:
        return None

    # Mixed source format: encoded integer-like values are amps * 100,
    # decimal amp values are already in amperes.
    amps = quality / 100.0 if quality >= 100 else quality
    return round(amps, 2)


def _iso(value: Any) -> str | None:
    if isinstance(value, datetime):
        return value.isoformat()
    if value:
        return str(value)
    return None


def _coerce_date(value: Any) -> date | None:
    if value is None or value == '':
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    try:
        return datetime.fromisoformat(str(value)[:10]).date()
    except (TypeError, ValueError):
        return None


def _date_bounds(start_date: Any = None, end_date: Any = None) -> tuple[date | None, date | None]:
    start = _coerce_date(start_date)
    end = _coerce_date(end_date)
    if start and end and start > end:
        start, end = end, start
    return start, end


def _coerce_datetime(value: Any) -> datetime | None:
    if value is None or value == '':
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day)
    text_value = str(value).strip().replace('Z', '')
    try:
        return datetime.fromisoformat(text_value)
    except (TypeError, ValueError):
        pass
    for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M', '%Y-%m-%d'):
        try:
            return datetime.strptime(text_value[:len(datetime.now().strftime(fmt))], fmt)
        except (TypeError, ValueError):
            continue
    return None


def _minute_flow_datetime_bounds(
    start_date: Any = None,
    end_date: Any = None,
    start_datetime: Any = None,
    end_datetime: Any = None,
) -> tuple[datetime, datetime, str | None]:
    start_dt = _coerce_datetime(start_datetime)
    end_dt = _coerce_datetime(end_datetime)
    start, end = _date_bounds(start_date, end_date)
    if not start_dt:
        current_start = start or date.today()
        start_dt = datetime(current_start.year, current_start.month, current_start.day)
    if not end_dt:
        current_end = end or start_dt.date()
        end_dt = datetime(current_end.year, current_end.month, current_end.day, 23, 59, 59)
    if end_dt <= start_dt:
        return start_dt, end_dt, 'invalid_range'
    if (end_dt - start_dt) > timedelta(hours=24):
        return start_dt, end_dt, 'range_too_large'
    return start_dt, end_dt, None


def _where_for_dates(start_date: Any = None, end_date: Any = None) -> tuple[str, dict[str, Any]]:
    start, end = _date_bounds(start_date, end_date)
    clauses = []
    params: dict[str, Any] = {}
    if start:
        clauses.append('Time_Stamp >= :start_date')
        params['start_date'] = start.isoformat()
    if end:
        clauses.append('Time_Stamp < DATEADD(day, 1, CAST(:end_date AS date))')
        params['end_date'] = end.isoformat()
    where_sql = f" WHERE {' AND '.join(clauses)}" if clauses else ''
    return where_sql, params


def _timestamp_order_clause(table_name: str, direction: str = 'DESC') -> str:
    direction = 'ASC' if str(direction).upper() == 'ASC' else 'DESC'
    # dbo.NIVELES_BOS stores sub-second/order detail in Time_Stamp_ms.
    # Use it as a tie-breaker so tank/cistern cards always take the newest
    # real level reading available instead of an older row with the same date/hour.
    if str(table_name).lower().endswith('niveles_bos'):
        return f'Time_Stamp {direction}, Time_Stamp_ms {direction}'
    return f'Time_Stamp {direction}'


def _sql_bucket_expression(period: str = 'hourly') -> str:
    normalized = str(period or 'hourly').lower()
    if normalized == 'monthly':
        return 'DATEFROMPARTS(YEAR(Time_Stamp), MONTH(Time_Stamp), 1)'
    if normalized == 'daily':
        return 'CAST(Time_Stamp AS date)'
    if normalized == 'minute':
        return 'DATEADD(minute, DATEDIFF(minute, 0, Time_Stamp), 0)'
    return 'DATEADD(hour, DATEDIFF(hour, 0, Time_Stamp), 0)'


def _latest_row(session, table_name: str, start_date: Any = None, end_date: Any = None) -> dict[str, Any] | None:
    where_sql, params = _where_for_dates(start_date, end_date)
    order_sql = _timestamp_order_clause(table_name, 'DESC')
    result = session.execute(text(f'SELECT TOP 1 * FROM {table_name}{where_sql} ORDER BY {order_sql}'), params)
    return _row_to_dict(result.first())



def _range_rows(
    session,
    table_name: str,
    start_date: Any = None,
    end_date: Any = None,
    max_rows: int = 240,
    period: str = 'hourly',
) -> list[dict[str, Any]]:
    """Return BOS rows for graphing, ordered ascending by Time_Stamp.

    For long ranges, return only the first and last row per bucket. The
    downstream builders already aggregate by bucket, so this preserves period
    deltas while avoiding thousands of raw minute/hour rows.
    """
    start, end = _date_bounds(start_date, end_date)
    max_rows = max(1, min(int(max_rows or 240), 2000))
    normalized_period = _normalize_period(period, start_date, end_date)
    days = _date_span_days(start_date, end_date)
    params: dict[str, Any] = {}
    if start or end:
        clauses = []
        if start:
            clauses.append('Time_Stamp >= :start_date')
            params['start_date'] = start.isoformat()
        if end:
            clauses.append('Time_Stamp < DATEADD(day, 1, CAST(:end_date AS date))')
            params['end_date'] = end.isoformat()
        where_sql = f" WHERE {' AND '.join(clauses)}"
        order_asc = _timestamp_order_clause(table_name, 'ASC')
        order_desc = _timestamp_order_clause(table_name, 'DESC')
        if normalized_period == 'minute' or days > 2 or normalized_period in {'daily', 'monthly'}:
            bucket_sql = _sql_bucket_expression(normalized_period)
            sql = f"""
                WITH ranged AS (
                    SELECT *,
                        ROW_NUMBER() OVER (PARTITION BY {bucket_sql} ORDER BY {order_asc}) AS rn_first,
                        ROW_NUMBER() OVER (PARTITION BY {bucket_sql} ORDER BY {order_desc}) AS rn_last
                    FROM {table_name}
                    {where_sql}
                )
                SELECT *
                FROM ranged
                WHERE rn_first = 1 OR rn_last = 1
                ORDER BY {order_asc}
            """
        else:
            sql = f"""
                SELECT *
                FROM {table_name}
                {where_sql}
                ORDER BY {order_asc}
            """
    else:
        sql = f"""
            SELECT * FROM (
                SELECT TOP ({max_rows}) *
                FROM {table_name}
                ORDER BY {_timestamp_order_clause(table_name, 'DESC')}
            ) recent_rows
            ORDER BY {_timestamp_order_clause(table_name, 'ASC')}
        """
    try:
        result = session.execute(text(sql), params)
        rows = [_row_to_dict(row) for row in result.fetchall() if row is not None]
        logger.info('water_bos range rows table=%s rows=%s period=%s days=%s', table_name, len(rows), normalized_period, days)
        if not rows:
            logger.info('water_bos table returned 0 rows for range: %s', table_name)
        return rows
    except SQLAlchemyError as exc:
        _warn_sql_once(f'range:{table_name}', f'water_bos SQL warning reading range table={table_name}', exc)
        return []


def _first_row(session, table_name: str, start_date: Any = None, end_date: Any = None) -> dict[str, Any] | None:
    where_sql, params = _where_for_dates(start_date, end_date)
    order_sql = _timestamp_order_clause(table_name, 'ASC')
    result = session.execute(text(f'SELECT TOP 1 * FROM {table_name}{where_sql} ORDER BY {order_sql}'), params)
    return _row_to_dict(result.first())



def _safe_latest_row(session, table_name: str, start_date: Any = None, end_date: Any = None, error_counter: dict[str, int] | None = None) -> dict[str, Any] | None:
    try:
        row = _latest_row(session, table_name, start_date, end_date)
        logger.info('water_bos latest row table=%s rows=%s', table_name, 1 if row else 0)
        if not row:
            logger.info('water_bos table returned 0 latest rows: %s', table_name)
        return row
    except SQLAlchemyError as exc:
        if error_counter is not None:
            error_counter['count'] = int(error_counter.get('count') or 0) + 1
        _warn_sql_once(f'latest:{table_name}', f'water_bos SQL warning reading latest table={table_name}', exc)
        return None


def _safe_first_row(session, table_name: str, start_date: Any = None, end_date: Any = None, error_counter: dict[str, int] | None = None) -> dict[str, Any] | None:
    try:
        row = _first_row(session, table_name, start_date, end_date)
        logger.info('water_bos first row table=%s rows=%s', table_name, 1 if row else 0)
        if not row:
            logger.info('water_bos table returned 0 first rows: %s', table_name)
        return row
    except SQLAlchemyError as exc:
        if error_counter is not None:
            error_counter['count'] = int(error_counter.get('count') or 0) + 1
        _warn_sql_once(f'first:{table_name}', f'water_bos SQL warning reading first table={table_name}', exc)
        return None


def _level_column_value(row: dict[str, Any] | None, column_names: tuple[str, ...]) -> tuple[str | None, float | None]:
    if not row:
        return None, None
    for column_name in column_names:
        key = column_name.lower()
        if key in row and row[key] is not None:
            return column_name, _num(row[key])
    return None, None


def _level_status(level_value: float | None, fill_pct: float | None = None) -> tuple[str, str]:
    if level_value is None:
        return 'Sin lectura', 'communication'
    pct = _num(fill_pct, 0)
    if pct <= 0:
        return 'Sin nivel', 'warning'
    if pct < 20:
        return 'Nivel muy bajo', 'critical'
    if pct < 40:
        return 'Nivel bajo', 'warning'
    if pct >= 85:
        return 'Nivel alto', 'normal'
    return 'Normal', 'normal'


def _clamped_fill_pct(level_value: float | None, max_height_m: float | None = None) -> float:
    if level_value is None:
        return 0.0
    height = _num(max_height_m, 0)
    if height > 0:
        return round(max(0.0, min(100.0, (_num(level_value) / height) * 100)), 2)
    return max(0.0, min(100.0, _num(level_value)))


def _estimated_volume_m3(level_value: float | None, capacity_m3: float | None, max_height_m: float | None) -> float:
    capacity = _num(capacity_m3, 0)
    fill_pct = _clamped_fill_pct(level_value, max_height_m)
    if capacity <= 0 or level_value is None:
        return 0.0
    return round(capacity * fill_pct / 100.0, 2)


def _tank_level_columns_metadata() -> list[dict[str, Any]]:
    return [
        {
            'key': item['key'],
            'name': item['name'],
            'type': item['type'],
            'columns': list(item['columns']),
            'capacity_m3': item.get('capacity_m3'),
            'max_height_m': item.get('max_height_m'),
        }
        for item in TANK_LEVEL_COLUMNS
    ]


def _build_tank_level_readings(niveles_row: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not niveles_row:
        return []
    updated = _iso(_first(niveles_row, 'time_stamp', 'timestamp')) or 'Sin lectura reciente'
    readings: list[dict[str, Any]] = []
    for index, item in enumerate(TANK_LEVEL_COLUMNS):
        source_column, level_value = _level_column_value(niveles_row, tuple(item['columns']))
        max_height_m = _num(item.get('max_height_m'), 0)
        capacity_m3 = _num(item.get('capacity_m3'), 0)
        fill_pct = _clamped_fill_pct(level_value, max_height_m)
        volume_m3 = _estimated_volume_m3(level_value, capacity_m3, max_height_m)
        status, status_type = _level_status(level_value, fill_pct)
        readings.append({
            'id': f"nivel-tanque-{index + 1}",
            'name': item['name'],
            'label': item['name'],
            'type': item['type'],
            'source_column': source_column or item['columns'][0],
            'level_key': item['key'],
            # NIVELES_BOS entrega altura/nivel en metros. No tratar este valor
            # como porcentaje; fill_pct se calcula contra max_height_m.
            'level_value': level_value,
            'level_unit': 'm',
            'height_m': _num(level_value),
            'altura_actual_m': _num(level_value),
            'max_height_m': max_height_m,
            'altura_maxima_m': max_height_m,
            'capacity_m3': capacity_m3,
            'volume_m3': volume_m3,
            'fill_pct': fill_pct,
            'volume_source': 'estimated_from_height',
            'status': status,
            'statusType': status_type,
            'active': bool(level_value and level_value > 0),
            'updated': updated,
            'ultima_lectura': updated,
            'source_table': 'dbo.NIVELES_BOS',
            'diagnosis': f"Altura desde dbo.NIVELES_BOS.{source_column or item['columns'][0]}; porcentaje = altura_actual_m / max_height_m * 100.",
        })
    return readings


def _build_tank_level_history(rows: list[dict[str, Any]], period: str = 'hourly') -> list[dict[str, Any]]:
    history: list[dict[str, Any]] = []
    for row in rows:
        timestamp_value = _first(row, 'time_stamp', 'timestamp')
        bucket = _bucket_iso(timestamp_value, period)
        point: dict[str, Any] = {
            'timestamp': _iso(timestamp_value),
            'bucket': bucket,
            'aggregation': period,
        }
        has_value = False
        for item in TANK_LEVEL_COLUMNS:
            _source_column, level_value = _level_column_value(row, tuple(item['columns']))
            if level_value is not None:
                point[item['key']] = level_value
                has_value = True
        if has_value:
            history.append(point)
    return history


def _sp_datetime_bounds(start_date: Any = None, end_date: Any = None) -> tuple[str | None, str | None]:
    start, end = _date_bounds(start_date, end_date)
    if not start and not end:
        today = datetime.utcnow().date()
        start = today
        end = today
    if start and not end:
        end = start
    if end and not start:
        start = end
    return (
        f'{start.isoformat()} 00:00:00' if start else None,
        f'{end.isoformat()} 23:59:59.999999' if end else None,
    )


def _date_span_days(start_date: Any = None, end_date: Any = None) -> int:
    start, end = _date_bounds(start_date, end_date)
    if start and end:
        return abs((end - start).days) + 1
    return 0


def _period_from_bounds(start_date: Any = None, end_date: Any = None) -> str:
    days = _date_span_days(start_date, end_date)
    if days:
        if days <= 2:
            return 'hourly'
        if days > 31:
            return 'monthly'
        return 'daily'
    return 'hourly'


def _normalize_period(period: Any = None, start_date: Any = None, end_date: Any = None) -> str:
    value = str(period or '').strip().lower()
    days = _date_span_days(start_date, end_date)
    if value in {'minute', 'hourly', 'daily', 'monthly'}:
        # Protección para rangos largos: no permitir históricos minuto a minuto
        # fuera de un solo día, ni históricos horarios pesados cuando el rango
        # excede 48 horas.
        if days > 31:
            return 'monthly'
        if value == 'minute' and days > 1:
            return 'hourly' if days <= 2 else 'daily'
        if value == 'hourly' and days > 2:
            return 'daily'
        return value
    return _period_from_bounds(start_date, end_date)


def _set_dbapi_timeout(session, timeout_seconds: int) -> tuple[Any | None, Any | None]:
    try:
        connection = session.connection()
        dbapi_connection = getattr(connection.connection, 'driver_connection', None)
        if dbapi_connection is None:
            dbapi_connection = getattr(connection.connection, 'connection', None)
        if dbapi_connection is not None and hasattr(dbapi_connection, 'timeout'):
            previous_timeout = getattr(dbapi_connection, 'timeout')
            setattr(dbapi_connection, 'timeout', timeout_seconds)
            return dbapi_connection, previous_timeout
    except Exception as exc:  # pragma: no cover - defensive driver-specific fallback
        logger.debug('water_bos could not set DBAPI timeout: %s', exc)
    return None, None


def _restore_dbapi_timeout(dbapi_connection: Any | None, previous_timeout: Any | None) -> None:
    if dbapi_connection is None:
        return
    try:
        setattr(dbapi_connection, 'timeout', previous_timeout)
    except Exception as exc:  # pragma: no cover - defensive driver-specific fallback
        logger.debug('water_bos could not restore DBAPI timeout: %s', exc)


def _readings_sensor_ids() -> list[int]:
    '''Return the explicit Guadalupe well sensors allowed for readings_minute.'''
    sensor_ids: list[int] = []
    for item in GUADALUPE_WELL_SENSOR_MAP:
        sensor_ids.extend([
            int(item['energy_sensor_id']),
            int(item['flow_out_sensor_id']),
            int(item['flow_in_sensor_id']),
        ])
    return sorted(set(sensor_ids))


def _readings_params_for_sensor_ids(sensor_ids: list[int]) -> tuple[str, dict[str, Any]]:
    unique_ids = sorted({int(sensor_id) for sensor_id in sensor_ids if sensor_id})
    params: dict[str, Any] = {f'sid_{index}': sensor_id for index, sensor_id in enumerate(unique_ids)}
    id_list = ', '.join(f':sid_{index}' for index in range(len(unique_ids)))
    return id_list, params


def _readings_date_filter(start_date: Any = None, end_date: Any = None, params: dict[str, Any] | None = None) -> str:
    target_params = params if params is not None else {}
    start, end = _date_bounds(start_date, end_date)
    clauses: list[str] = []
    if start:
        clauses.append('r.ts_local >= :start_date')
        target_params['start_date'] = start.isoformat()
    if end:
        clauses.append('r.ts_local < DATEADD(day, 1, CAST(:end_date AS date))')
        target_params['end_date'] = end.isoformat()
    if not clauses:
        # Protección de rendimiento: nunca abrir readings_minute completo si el
        # endpoint no trae rango. Para lecturas actuales basta revisar reciente.
        clauses.append('r.ts_local >= DATEADD(day, -2, CAST(GETDATE() AS date))')
    return (' AND ' + ' AND '.join(clauses)) if clauses else ''


def _readings_bucket_expression(period: str = 'hourly') -> str:
    normalized = str(period or 'hourly').lower()
    if normalized == 'monthly':
        return 'DATEFROMPARTS(YEAR(r.ts_local), MONTH(r.ts_local), 1)'
    if normalized == 'daily':
        return 'CAST(r.ts_local AS date)'
    if normalized == 'minute':
        return 'DATEADD(minute, DATEDIFF(minute, 0, r.ts_local), 0)'
    return 'DATEADD(hour, DATEDIFF(hour, 0, r.ts_local), 0)'


def _readings_valid_row_filter(require_total: bool = False) -> str:
    total_required = 'AND r.total_value IS NOT NULL' if require_total else ''
    return f'''
        {total_required}
        AND r.ts_local IS NOT NULL
        AND (r.instant_value IS NULL OR ABS(CAST(r.instant_value AS float)) < :max_instant_value)
        AND (r.total_value IS NULL OR (CAST(r.total_value AS float) >= 0 AND CAST(r.total_value AS float) < :max_total_value))
    '''


def _readings_base_params(params: dict[str, Any] | None = None) -> dict[str, Any]:
    target = params if params is not None else {}
    target['max_instant_value'] = READINGS_MINUTE_MAX_INSTANT_VALUE
    target['max_total_value'] = READINGS_MINUTE_MAX_TOTAL_VALUE
    return target


def _readings_delta_limit(kind: str = 'water', start_date: Any = None, end_date: Any = None, period: str | None = None) -> float:
    normalized = str(period or '').lower()
    if normalized == 'hourly':
        days = 1.0 / 24.0
    elif normalized == 'monthly':
        days = 31.0
    elif normalized == 'daily':
        days = 1.0
    else:
        start, end = _date_bounds(start_date, end_date)
        if start and end:
            days = max((end - start).days + 1, 1)
        else:
            days = 1.0
    per_day = READINGS_MINUTE_MAX_ENERGY_DELTA_KWH_PER_DAY if kind == 'energy' else READINGS_MINUTE_MAX_WATER_DELTA_M3_PER_DAY
    return float(per_day) * float(days)


def _readings_valid_delta(
    value: Any,
    kind: str = 'water',
    start_date: Any = None,
    end_date: Any = None,
    period: str | None = None,
) -> bool:
    delta = _num(value, 0)
    if delta <= 0:
        return False
    return delta <= _readings_delta_limit(kind, start_date, end_date, period)



def _well_period_days(start_date: Any = None, end_date: Any = None) -> int:
    start, end = _date_bounds(start_date, end_date)
    if start and end:
        return max((end - start).days + 1, 1)
    return 1


def _well_daily_delta_limit(start_date: Any = None, end_date: Any = None) -> float:
    return float(MAX_WELL_DAILY_M3) * float(_well_period_days(start_date, end_date))


def _well_delta_limit_for_period(
    start_date: Any = None,
    end_date: Any = None,
    period: str | None = None,
) -> float:
    """Limite operativo para validar deltas de totalizador por pozo.

    El dashboard puede usar fallback BOS para historicos. BOS puede traer saltos
    crudos de totalizador, asi que los deltas historicos se validan con el mismo
    tope operativo usado por Bombeado hoy, escalado a la granularidad solicitada.
    """
    normalized = str(period or '').lower()
    if normalized == 'minute':
        days = 1.0 / (24.0 * 60.0)
    elif normalized == 'hourly':
        days = 1.0 / 24.0
    elif normalized == 'daily':
        days = 1.0
    elif normalized == 'monthly':
        days = 31.0
    else:
        days = float(_well_period_days(start_date, end_date))
    return float(MAX_WELL_DAILY_M3) * max(float(days), 1.0 / (24.0 * 60.0))


def _well_period_delta_quality(
    value: Any,
    start_date: Any = None,
    end_date: Any = None,
    period: str | None = None,
) -> tuple[str, float | None, str]:
    parsed = _num(value, float('nan'))
    if parsed != parsed:
        return 'missing', None, 'Medicion no disponible'
    if parsed < 0:
        return 'invalid_delta', None, 'Dato en revision por reinicio de totalizador'
    limit = _well_delta_limit_for_period(start_date, end_date, period)
    if parsed > limit:
        return 'invalid_delta', None, 'Dato en revision por salto de totalizador'
    return 'valid', round(max(parsed, 0.0), 6), ''


def _well_period_display_note(status: str) -> str:
    if status == 'invalid_delta':
        return 'Dato en revision por salto de totalizador'
    if status == 'missing':
        return 'Medicion no disponible'
    return ''


def _well_period_payload_fields(
    value: Any,
    status: str | None,
    note: str | None = '',
    precision: int = 6,
) -> dict[str, Any]:
    """Campos compatibles y de calidad para Bombeado hoy.

    entry_m3/period_m3/period_delta_m3 se mantienen numericos por contrato
    Pydantic. El frontend y reportes usan bombeado_hoy_* como fuente
    principal para distinguir un 0 real de un dato faltante o en revision.
    """
    normalized_status = str(status or 'missing').strip().lower() or 'missing'
    is_valid = normalized_status in {'valid', 'ok'}
    parsed = _num(value, float('nan')) if value is not None else float('nan')
    valid_value = max(parsed, 0.0) if is_valid and parsed == parsed else 0.0
    rounded_value = round(valid_value, precision)
    quality_note = str(note or _well_period_display_note(normalized_status) or '')
    return {
        'entry_m3': rounded_value if is_valid else 0.0,
        'period_m3': rounded_value if is_valid else 0.0,
        'period_delta_m3': rounded_value if is_valid else 0.0,
        'bombeado_hoy_m3': rounded_value if is_valid else None,
        'bombeado_hoy_status': normalized_status,
        'bombeado_hoy_note': '' if is_valid else quality_note,
        'period_available': bool(is_valid),
    }



def _well_flow_quality(value: Any) -> tuple[float, str, str]:
    """Validate instant well flow for Guadalupe operational displays.

    Applies only to wells. Other modules (flows/lines/tanks) keep their own
    ranges because their sensors and expected units differ.
    """
    flow = max(0.0, _num(value, 0.0))
    if flow > MAX_WELL_FLOW_LPS:
        return 0.0, 'invalid_flow', 'Dato en revisión por flujo fuera de rango'
    return flow, 'valid', ''


def _well_flow_payload_fields(prefix: str, value: Any) -> dict[str, Any]:
    flow, status, note = _well_flow_quality(value)
    return {
        prefix: flow,
        f'{prefix}_raw': _num(value, 0.0),
        f'{prefix}_status': status,
        f'{prefix}_note': note,
    }

def _readings_source_log(context: str, status: str, rows: int = 0, valid_rows: int = 0) -> None:
    if status == 'readings_minute':
        logger.info('water_bos readings_minute: using readings_minute for %s, rows=%s valid=%s', context, rows, valid_rows)
    elif status in {'bos_fallback', 'sp_fallback'}:
        logger.info('water_bos readings_minute: %s for %s, rows=%s valid=%s', status, context, rows, valid_rows)
    elif status == 'invalid_deltas':
        logger.info('water_bos readings_minute: invalid deltas for %s, falling back to BOS/SP, rows=%s valid=%s', context, rows, valid_rows)
    else:
        logger.info('water_bos readings_minute: %s for %s, rows=%s valid=%s', status, context, rows, valid_rows)


def _readings_history_is_usable(history: list[dict[str, Any]]) -> bool:
    meaningful = [
        row for row in history or []
        if _num(row.get('flow_lps'), 0) > 0 or _num(row.get('period_m3'), 0) > 0
    ]
    if not meaningful:
        return False
    unique_wells = {str(row.get('well_id') or row.get('numero') or '') for row in meaningful if row.get('well_id') or row.get('numero')}
    return len(meaningful) >= 2 or len(unique_wells) >= 2


def _readings_execute_mappings(session, sql: str, params: dict[str, Any], timeout_seconds: int = READINGS_MINUTE_TIMEOUT_SECONDS) -> list[dict[str, Any]]:
    dbapi_connection, previous_timeout = _set_dbapi_timeout(session, timeout_seconds)
    try:
        rows = session.execute(text(sql), params).mappings().all()
        return [{str(k).lower(): v for k, v in dict(row).items()} for row in rows]
    except SQLAlchemyError as exc:
        _warn_sql_once('readings_minute', 'water_bos SQL warning reading iot.readings_minute; using BOS fallback', exc)
        try:
            session.rollback()
        except Exception as rollback_exc:  # pragma: no cover - defensa ante drivers SQL inestables
            logger.warning('water_bos SQL warning: rollback after readings_minute error failed: %s', rollback_exc)
        return []
    finally:
        _restore_dbapi_timeout(dbapi_connection, previous_timeout)


def _sql_error_status(exc: SQLAlchemyError) -> str:
    message = str(exc).lower()
    if 'timeout' in message or 'time out' in message or 'query timeout' in message or 'hy008' in message:
        return 'timeout'
    return 'readings_minute_error'


def _readings_execute_mappings_with_status(
    session,
    sql: str,
    params: dict[str, Any],
    timeout_seconds: int = READINGS_MINUTE_TIMEOUT_SECONDS,
    context: str = 'readings_minute',
) -> tuple[list[dict[str, Any]], str]:
    dbapi_connection, previous_timeout = _set_dbapi_timeout(session, timeout_seconds)
    try:
        rows = session.execute(text(sql), params).mappings().all()
        return [{str(k).lower(): v for k, v in dict(row).items()} for row in rows], 'ok'
    except SQLAlchemyError as exc:
        status = _sql_error_status(exc)
        logger.warning('water_bos SQL warning reading %s; status=%s: %s', context, status, exc)
        try:
            session.rollback()
        except Exception as rollback_exc:  # pragma: no cover - defensa ante drivers SQL inestables
            logger.warning('water_bos SQL warning: rollback after %s error failed: %s', context, rollback_exc)
        return [], status
    finally:
        _restore_dbapi_timeout(dbapi_connection, previous_timeout)


def _readings_latest_by_sensor(
    session,
    sensor_ids: list[int],
    start_date: Any = None,
    end_date: Any = None,
    timeout_seconds: int = READINGS_MINUTE_TIMEOUT_SECONDS,
) -> dict[int, dict[str, Any]]:
    '''Return one latest valid readings_minute row per requested sensor.'''
    id_list, params = _readings_params_for_sensor_ids(sensor_ids)
    if not id_list:
        return {}
    _readings_base_params(params)
    date_sql = _readings_date_filter(start_date, end_date, params)
    sql = f'''
        WITH latest AS (
            SELECT
                r.sensor_id,
                r.ts_local,
                r.ts_minute,
                CAST(r.instant_value AS float) AS instant_value,
                CAST(r.total_value AS float) AS total_value,
                CAST(r.quality AS float) AS quality,
                r.source,
                ROW_NUMBER() OVER (
                    PARTITION BY r.sensor_id
                    ORDER BY COALESCE(r.ts_local, r.ts_minute, r.inserted_at) DESC
                ) AS rn
            FROM {READINGS_MINUTE_TABLE} r
            WHERE r.sensor_id IN ({id_list})
              AND (r.instant_value IS NOT NULL OR r.total_value IS NOT NULL OR r.quality IS NOT NULL)
              {_readings_valid_row_filter(False)}
              {date_sql}
        )
        SELECT sensor_id, ts_local, ts_minute, instant_value, total_value, quality, source
        FROM latest
        WHERE rn = 1
    '''
    rows = _readings_execute_mappings(session, sql, params, timeout_seconds)
    result: dict[int, dict[str, Any]] = {}
    for row in rows:
        try:
            result[int(row['sensor_id'])] = row
        except (TypeError, ValueError, KeyError):
            continue
    return result


def _readings_period_totals_by_sensor(
    session,
    sensor_ids: list[int],
    start_date: Any = None,
    end_date: Any = None,
    timeout_seconds: int = READINGS_MINUTE_TIMEOUT_SECONDS,
) -> dict[int, dict[str, Any]]:
    '''Return first/last total_value per sensor for a period delta.'''
    id_list, params = _readings_params_for_sensor_ids(sensor_ids)
    if not id_list:
        return {}
    _readings_base_params(params)
    date_sql = _readings_date_filter(start_date, end_date, params)
    sql = f'''
        WITH valid AS (
            SELECT
                r.sensor_id,
                r.ts_local,
                r.ts_minute,
                CAST(r.total_value AS float) AS total_value
            FROM {READINGS_MINUTE_TABLE} r
            WHERE r.sensor_id IN ({id_list})
              {_readings_valid_row_filter(True)}
              {date_sql}
        ), ranked AS (
            SELECT
                sensor_id,
                ts_local,
                ts_minute,
                total_value,
                ROW_NUMBER() OVER (PARTITION BY sensor_id ORDER BY COALESCE(ts_local, ts_minute) ASC) AS rn_first,
                ROW_NUMBER() OVER (PARTITION BY sensor_id ORDER BY COALESCE(ts_local, ts_minute) DESC) AS rn_last
            FROM valid
        )
        SELECT
            sensor_id,
            MAX(CASE WHEN rn_first = 1 THEN total_value END) AS first_total_value,
            MAX(CASE WHEN rn_last = 1 THEN total_value END) AS last_total_value,
            MAX(CASE WHEN rn_first = 1 THEN ts_local END) AS first_ts_local,
            MAX(CASE WHEN rn_last = 1 THEN ts_local END) AS last_ts_local,
            COUNT(*) AS samples
        FROM ranked
        WHERE rn_first = 1 OR rn_last = 1
        GROUP BY sensor_id
    '''
    rows = _readings_execute_mappings(session, sql, params, timeout_seconds)
    result: dict[int, dict[str, Any]] = {}
    for row in rows:
        try:
            sensor_id = int(row['sensor_id'])
        except (TypeError, ValueError, KeyError):
            continue
        first_value = _num(row.get('first_total_value'), 0)
        last_value = _num(row.get('last_total_value'), 0)
        samples = int(_num(row.get('samples'), 0))
        raw_delta = last_value - first_value
        delta = _safe_delta(last_value, first_value)
        if samples < 2:
            continue
        result[sensor_id] = {
            'sensor_id': sensor_id,
            'first_total_value': first_value,
            'last_total_value': last_value,
            'delta': delta,
            'raw_delta': round(raw_delta, 6),
            'first_ts_local': row.get('first_ts_local'),
            'last_ts_local': row.get('last_ts_local'),
            'samples': samples,
            'source': READINGS_MINUTE_TABLE,
        }
    _readings_source_log('period totals by sensor', 'readings_minute' if result else 'sin_datos', len(rows), len(result))
    return result


def _readings_well_periods(session, start_date: Any = None, end_date: Any = None) -> dict[int, dict[str, Any]]:
    '''Build well period water/energy totals from readings_minute with explicit mapping.'''
    totals = _readings_period_totals_by_sensor(session, _readings_sensor_ids(), start_date, end_date)
    if not totals:
        return {}

    summary: dict[int, dict[str, Any]] = {}
    for mapping in GUADALUPE_WELL_SENSOR_MAP:
        well_id = int(mapping['well_id'])
        energy_sensor_id = int(mapping['energy_sensor_id'])
        flow_out_sensor_id = int(mapping['flow_out_sensor_id'])
        flow_in_sensor_id = int(mapping['flow_in_sensor_id'])
        energy = totals.get(energy_sensor_id)
        flow_out = totals.get(flow_out_sensor_id)
        flow_in = totals.get(flow_in_sensor_id)
        flow_totals = [item for item in (flow_out, flow_in) if item]
        valid_flow_candidates: list[dict[str, Any]] = []
        invalid_flow_candidates: list[tuple[dict[str, Any], str]] = []
        for item in flow_totals:
            raw_delta = item.get('raw_delta', item.get('delta'))
            status, validated_delta, note = _well_period_delta_quality(raw_delta, start_date, end_date)
            if status == 'valid':
                candidate = dict(item)
                candidate['validated_delta'] = validated_delta or 0.0
                valid_flow_candidates.append(candidate)
            elif status == 'invalid_delta':
                invalid_flow_candidates.append((item, note))

        water = max(valid_flow_candidates, key=lambda item: _num(item.get('validated_delta'), 0), default=None)
        if energy and not _readings_valid_delta(energy.get('delta'), 'energy', start_date, end_date):
            energy = None

        if water:
            water_sensor_id = int(water.get('sensor_id') or flow_out_sensor_id)
            m3_value = _num(water.get('validated_delta'), 0)
            item = {
                'well_id': well_id,
                'well_number': int(mapping['well_number']),
                'energy_sensor_id': energy_sensor_id,
                'water_sensor_id': water_sensor_id,
                'flow_out_sensor_id': flow_out_sensor_id,
                'flow_in_sensor_id': flow_in_sensor_id,
                'kwh_value': round(_num(energy.get('delta') if energy else 0), 6),
                'm3_value': round(m3_value, 6),
                'bombeado_hoy_m3': round(m3_value, 6),
                'bombeado_hoy_status': 'valid',
                'bombeado_hoy_note': '',
                'energy_total': energy,
                'water_total': water,
                'source': READINGS_MINUTE_TABLE,
                'rows': int(_num(water.get('samples'), 0)),
            }
            kwh = _num(item.get('kwh_value'))
            item['kwh_por_m3'] = round(kwh / m3_value, 4) if m3_value else None
            summary[well_id] = item
            continue

        if invalid_flow_candidates:
            invalid_item, note = max(
                invalid_flow_candidates,
                key=lambda pair: _num(pair[0].get('raw_delta', pair[0].get('delta')), 0),
            )
            water_sensor_id = int(invalid_item.get('sensor_id') or flow_out_sensor_id)
            summary[well_id] = {
                'well_id': well_id,
                'well_number': int(mapping['well_number']),
                'energy_sensor_id': energy_sensor_id,
                'water_sensor_id': water_sensor_id,
                'flow_out_sensor_id': flow_out_sensor_id,
                'flow_in_sensor_id': flow_in_sensor_id,
                'kwh_value': round(_num(energy.get('delta') if energy else 0), 6),
                'm3_value': None,
                'bombeado_hoy_m3': None,
                'bombeado_hoy_status': 'invalid_delta',
                'bombeado_hoy_note': note or _well_period_display_note('invalid_delta'),
                'energy_total': energy,
                'water_total': invalid_item,
                'source': READINGS_MINUTE_TABLE,
                'rows': int(_num(invalid_item.get('samples'), 0)),
                'kwh_por_m3': None,
            }
    valid_count = sum(1 for item in summary.values() if item.get('bombeado_hoy_status') == 'valid')
    status = 'readings_minute' if valid_count else ('invalid_deltas' if summary else 'sin_datos')
    _readings_source_log('well period totals', status, len(totals), valid_count)
    return summary


def _readings_energy_water_rows(
    session,
    period: str = 'daily',
    start_date: Any = None,
    end_date: Any = None,
) -> list[dict[str, Any]]:
    '''Return bucketed water/energy rows for production-vs-energy charts.'''
    sensor_ids = _readings_sensor_ids()
    id_list, params = _readings_params_for_sensor_ids(sensor_ids)
    if not id_list:
        return []
    normalized_period = _normalize_period(period, start_date, end_date)
    _readings_base_params(params)
    date_sql = _readings_date_filter(start_date, end_date, params)
    bucket_sql = _readings_bucket_expression(normalized_period)
    sql = f'''
        WITH valid AS (
            SELECT
                r.sensor_id,
                {bucket_sql} AS bucket,
                CAST(r.total_value AS float) AS total_value,
                COALESCE(r.ts_local, r.ts_minute) AS ts_value
            FROM {READINGS_MINUTE_TABLE} r
            WHERE r.sensor_id IN ({id_list})
              {_readings_valid_row_filter(True)}
              {date_sql}
        ), ranked AS (
            SELECT
                sensor_id,
                bucket,
                total_value,
                ROW_NUMBER() OVER (PARTITION BY sensor_id, bucket ORDER BY ts_value ASC) AS rn_first,
                ROW_NUMBER() OVER (PARTITION BY sensor_id, bucket ORDER BY ts_value DESC) AS rn_last
            FROM valid
        )
        SELECT
            sensor_id,
            bucket,
            MAX(CASE WHEN rn_first = 1 THEN total_value END) AS first_total_value,
            MAX(CASE WHEN rn_last = 1 THEN total_value END) AS last_total_value,
            COUNT(*) AS samples
        FROM ranked
        WHERE rn_first = 1 OR rn_last = 1
        GROUP BY sensor_id, bucket
    '''
    rows = _readings_execute_mappings(session, sql, params, READINGS_MINUTE_TIMEOUT_SECONDS)
    totals_by_key: dict[tuple[int, str], dict[str, Any]] = {}
    for row in rows:
        try:
            sensor_id = int(row['sensor_id'])
            bucket = _iso(row.get('bucket')) or str(row.get('bucket') or '')
        except (TypeError, ValueError, KeyError):
            continue
        first_value = _num(row.get('first_total_value'), 0)
        last_value = _num(row.get('last_total_value'), 0)
        samples = int(_num(row.get('samples'), 0))
        if samples < 2:
            continue
        totals_by_key[(sensor_id, bucket)] = {
            'sensor_id': sensor_id,
            'bucket': bucket,
            'delta': _safe_delta(last_value, first_value),
            'first_total_value': first_value,
            'last_total_value': last_value,
            'samples': samples,
        }

    output: list[dict[str, Any]] = []
    for mapping in GUADALUPE_WELL_SENSOR_MAP:
        well_id = int(mapping['well_id'])
        well_number = int(mapping['well_number'])
        energy_sensor_id = int(mapping['energy_sensor_id'])
        flow_out_sensor_id = int(mapping['flow_out_sensor_id'])
        flow_in_sensor_id = int(mapping['flow_in_sensor_id'])
        buckets = sorted({bucket for sensor_id, bucket in totals_by_key if sensor_id in {energy_sensor_id, flow_out_sensor_id, flow_in_sensor_id}})
        for bucket in buckets:
            energy = totals_by_key.get((energy_sensor_id, bucket), {})
            flow_out = totals_by_key.get((flow_out_sensor_id, bucket), {})
            flow_in = totals_by_key.get((flow_in_sensor_id, bucket), {})
            water = max((flow_out, flow_in), key=lambda item: _num(item.get('delta'), 0), default={})
            m3 = _num(water.get('delta'), 0)
            kwh = _num(energy.get('delta'), 0)
            if not _readings_valid_delta(m3, 'water', period=normalized_period):
                continue
            if kwh and not _readings_valid_delta(kwh, 'energy', period=normalized_period):
                kwh = 0.0
            output.append({
                'well_id': well_id,
                'well_number': well_number,
                'numero': well_number,
                'bucket': bucket,
                'period': bucket,
                'm3_value': round(m3, 6),
                'kwh_value': round(kwh, 6),
                'water_sensor_id': int(water.get('sensor_id') or flow_out_sensor_id),
                'energy_sensor_id': energy_sensor_id,
                'source': READINGS_MINUTE_TABLE,
            })
    _readings_source_log('energy/water rows', 'readings_minute' if output else 'invalid_deltas', len(rows), len(output))
    return output



def _readings_well_minute_flow_history(
    session,
    start_date: Any = None,
    end_date: Any = None,
    start_datetime: Any = None,
    end_datetime: Any = None,
    well_numbers: list[int] | None = None,
    timeout_seconds: int = 15,
) -> tuple[list[dict[str, Any]], str]:
    '''Return lightweight minute-level well flow from readings_minute.

    This function is intentionally separated from the dashboard history flow:
    it only reads instant_value for well flow sensors, does not read totalizers,
    does not read energy sensors, and accepts a bounded range of up to 24 hours.
    '''
    start_dt, end_dt, range_error = _minute_flow_datetime_bounds(
        start_date=start_date,
        end_date=end_date,
        start_datetime=start_datetime,
        end_datetime=end_datetime,
    )
    if range_error:
        logger.info('water_bos minute flow skipped because range is invalid or too large: %s to %s reason=%s', start_dt, end_dt, range_error)
        return [], str(range_error)

    requested_wells = {int(value) for value in (well_numbers or []) if _num(value, 0) > 0}
    mappings = [
        mapping for mapping in GUADALUPE_WELL_SENSOR_MAP
        if not requested_wells or int(mapping['well_number']) in requested_wells
    ]
    sensor_to_well: dict[int, tuple[dict[str, Any], str]] = {}
    sensor_ids: list[int] = []
    for mapping in mappings:
        flow_out_sensor_id = int(mapping['flow_out_sensor_id'])
        flow_in_sensor_id = int(mapping['flow_in_sensor_id'])
        sensor_to_well[flow_out_sensor_id] = (mapping, 'out')
        sensor_to_well[flow_in_sensor_id] = (mapping, 'in')
        sensor_ids.extend([flow_out_sensor_id, flow_in_sensor_id])

    id_list, params = _readings_params_for_sensor_ids(sensor_ids)
    if not id_list:
        return [], 'sin_datos'
    params.update({
        'start_datetime': start_dt.strftime('%Y-%m-%d %H:%M:%S'),
        'end_datetime': end_dt.strftime('%Y-%m-%d %H:%M:%S'),
        'max_instant_value': MAX_WELL_FLOW_LPS,
    })
    sql = f'''
        WITH source_rows AS (
            SELECT
                r.sensor_id,
                TRY_CONVERT(datetime2, r.ts_local) AS ts_local_dt,
                TRY_CONVERT(datetime2, r.ts_minute) AS ts_minute_dt,
                TRY_CAST(r.instant_value AS float) AS instant_value
            FROM {READINGS_MINUTE_TABLE} r
            WHERE r.sensor_id IN ({id_list})
        ),
        valid AS (
            SELECT
                sensor_id,
                COALESCE(ts_local_dt, ts_minute_dt) AS ts_value,
                instant_value
            FROM source_rows
            WHERE COALESCE(ts_local_dt, ts_minute_dt) IS NOT NULL
              AND COALESCE(ts_local_dt, ts_minute_dt) >= TRY_CONVERT(datetime2, :start_datetime)
              AND COALESCE(ts_local_dt, ts_minute_dt) <= TRY_CONVERT(datetime2, :end_datetime)
              AND instant_value IS NOT NULL
              AND ABS(instant_value) <= :max_instant_value
        )
        SELECT
            sensor_id,
            DATEADD(minute, DATEDIFF(minute, 0, ts_value), 0) AS bucket,
            AVG(instant_value) AS flow_lps,
            COUNT(*) AS samples
        FROM valid
        GROUP BY sensor_id, DATEADD(minute, DATEDIFF(minute, 0, ts_value), 0)
        ORDER BY bucket, sensor_id
    '''
    rows, query_status = _readings_execute_mappings_with_status(
        session,
        sql,
        params,
        timeout_seconds,
        context='well minute flow readings_minute',
    )
    if query_status != 'ok':
        _readings_source_log('well minute flow', query_status, len(rows), 0)
        return [], query_status

    by_key: dict[tuple[int, str], dict[str, Any]] = {}
    for row in rows:
        try:
            sensor_id = int(row['sensor_id'])
            bucket = _iso(row.get('bucket')) or str(row.get('bucket') or '')
        except (TypeError, ValueError, KeyError):
            continue
        if not bucket or sensor_id not in sensor_to_well:
            continue
        mapping, direction = sensor_to_well[sensor_id]
        well_number = int(mapping['well_number'])
        item = by_key.setdefault((well_number, bucket), {
            'well_id': str(mapping['well_id']),
            'numero': well_number,
            'well_number': well_number,
            'nombre': mapping.get('name') or f'Pozo {well_number}',
            'name': mapping.get('name') or f'Pozo {well_number}',
            'timestamp': bucket,
            'bucket': bucket,
            'aggregation': 'minute',
            'samples': 0,
            'flow_out_lps': 0.0,
            'flow_in_lps': 0.0,
        })
        flow = max(0.0, _num(row.get('flow_lps'), 0))
        if direction == 'out':
            item['flow_out_lps'] = round(flow, 4)
        else:
            item['flow_in_lps'] = round(flow, 4)
        item['samples'] = int(_num(item.get('samples'), 0) + _num(row.get('samples'), 0))

    history: list[dict[str, Any]] = []
    for item in by_key.values():
        flow_out = _num(item.get('flow_out_lps'), 0)
        flow_in = _num(item.get('flow_in_lps'), 0)
        item['flow_lps'] = round(max(flow_out, flow_in), 4)
        history.append(item)
    history.sort(key=lambda item: (str(item.get('bucket') or ''), int(_num(item.get('numero'), 0))))
    source_status = 'readings_minute' if history else 'sin_datos'
    _readings_source_log('well minute flow', source_status, len(rows), len(history))
    return history, source_status


def get_bos_well_minute_flow_payload(
    start_date: Any = None,
    end_date: Any = None,
    start_datetime: Any = None,
    end_datetime: Any = None,
    well_numbers: list[int] | None = None,
) -> dict[str, Any]:
    '''Lightweight payload for the Resumen minute-flow chart.'''
    start_dt, end_dt, range_error = _minute_flow_datetime_bounds(
        start_date=start_date,
        end_date=end_date,
        start_datetime=start_datetime,
        end_datetime=end_datetime,
    )
    start = start_dt.date()
    end = end_dt.date()

    wells = [
        {
            'well_id': str(mapping['well_id']),
            'numero': int(mapping['well_number']),
            'nombre': mapping.get('name') or f"Pozo {int(mapping['well_number'])}",
            'name': mapping.get('name') or f"Pozo {int(mapping['well_number'])}",
        }
        for mapping in GUADALUPE_WELL_SENSOR_MAP
        if not well_numbers or int(mapping['well_number']) in {int(value) for value in well_numbers if _num(value, 0) > 0}
    ]

    if range_error:
        return {
            'title': 'Flujo minuto a minuto por pozo',
            'source_status': range_error,
            'aggregation': 'minute',
            'date_range': {
                'start_date': start.isoformat(),
                'end_date': end.isoformat(),
                'start_datetime': start_dt.isoformat(),
                'end_datetime': end_dt.isoformat(),
                'period': 'minute',
            },
            'wells': wells,
            'well_flow_history': [],
            'message': 'Selecciona un rango horario válido de máximo 24 horas.',
        }

    source_status = 'sin_datos'
    try:
        with SessionLocal() as session:
            history, source_status = _readings_well_minute_flow_history(
                session,
                start_date=start,
                end_date=end,
                start_datetime=start_dt,
                end_datetime=end_dt,
                well_numbers=well_numbers,
            )
    except SQLAlchemyError as exc:
        source_status = _sql_error_status(exc)
        logger.warning('water_bos SQL warning reading lightweight minute flow; status=%s: %s', source_status, exc)
        history = []

    return {
        'title': 'Flujo minuto a minuto por pozo',
        'source_status': 'readings_minute' if history else source_status,
        'aggregation': 'minute',
        'date_range': {
            'start_date': start.isoformat(),
            'end_date': end.isoformat(),
            'start_datetime': start_dt.isoformat(),
            'end_datetime': end_dt.isoformat(),
            'period': 'minute',
        },
        'wells': wells,
        'well_flow_history': history,
    }


def get_bos_well_totalizer_cutoff_payload(cutoff_date: Any = None) -> dict[str, Any]:
    """Return accumulated well totalizers at the selected daily cutoff.

    This is an accumulated-totalizer view, not pumped volume for the day. It
    reads only total_value from iot.readings_minute for Guadalupe well flow
    sensors and uses the latest valid row found within the selected day.
    """
    target_date = _coerce_date(cutoff_date) or date.today()
    start_dt = datetime(target_date.year, target_date.month, target_date.day)
    end_dt = start_dt + timedelta(days=1)

    sensor_ids: list[int] = []
    for mapping in GUADALUPE_WELL_SENSOR_MAP:
        sensor_ids.extend([
            int(mapping['flow_out_sensor_id']),
            int(mapping['flow_in_sensor_id']),
        ])

    id_list, params = _readings_params_for_sensor_ids(sensor_ids)
    if not id_list:
        return {
            'date': target_date.isoformat(),
            'title': 'Corte de totalizadores de pozos',
            'source_status': 'sin_sensores',
            'source': READINGS_MINUTE_TABLE,
            'totalizador_total_m3': 0.0,
            'wells': [],
        }

    params.update({
        'start_datetime': start_dt.strftime('%Y-%m-%d %H:%M:%S'),
        'end_datetime': end_dt.strftime('%Y-%m-%d %H:%M:%S'),
        'max_total_value': READINGS_MINUTE_MAX_TOTAL_VALUE,
    })
    sql = f'''
        WITH source_rows AS (
            SELECT
                r.sensor_id,
                COALESCE(TRY_CONVERT(datetime2, r.ts_local), TRY_CONVERT(datetime2, r.ts_minute)) AS ts_value,
                TRY_CAST(r.total_value AS float) AS total_value
            FROM {READINGS_MINUTE_TABLE} r
            WHERE r.sensor_id IN ({id_list})
        ),
        valid AS (
            SELECT
                sensor_id,
                ts_value,
                total_value
            FROM source_rows
            WHERE ts_value IS NOT NULL
              AND ts_value >= TRY_CONVERT(datetime2, :start_datetime)
              AND ts_value < TRY_CONVERT(datetime2, :end_datetime)
              AND total_value IS NOT NULL
              AND total_value >= 0
              AND total_value < :max_total_value
        ),
        ranked AS (
            SELECT
                sensor_id,
                ts_value,
                total_value,
                ROW_NUMBER() OVER (
                    PARTITION BY sensor_id
                    ORDER BY ts_value DESC, total_value DESC
                ) AS rn
            FROM valid
        )
        SELECT
            sensor_id,
            ts_value AS timestamp,
            total_value
        FROM ranked
        WHERE rn = 1
        ORDER BY sensor_id
    '''

    rows: list[dict[str, Any]] = []
    source_status = 'sin_datos'
    try:
        with SessionLocal() as session:
            rows, query_status = _readings_execute_mappings_with_status(
                session,
                sql,
                params,
                timeout_seconds=15,
                context='well totalizer cutoff readings_minute',
            )
            source_status = 'readings_minute' if rows else ('sin_datos' if query_status == 'ok' else query_status)
    except SQLAlchemyError as exc:
        source_status = _sql_error_status(exc)
        logger.warning('water_bos SQL warning reading well totalizer cutoff; status=%s: %s', source_status, exc)
        rows = []

    latest_by_sensor: dict[int, dict[str, Any]] = {}
    for row in rows:
        try:
            sensor_id = int(row.get('sensor_id') or 0)
        except (TypeError, ValueError):
            continue
        if sensor_id:
            latest_by_sensor[sensor_id] = row

    wells: list[dict[str, Any]] = []
    totalizador_total = 0.0
    for mapping in GUADALUPE_WELL_SENSOR_MAP:
        well_number = int(mapping['well_number'])
        candidates: list[dict[str, Any]] = []
        for sensor_id in (int(mapping['flow_out_sensor_id']), int(mapping['flow_in_sensor_id'])):
            row = latest_by_sensor.get(sensor_id)
            if row is not None:
                candidates.append({**row, 'sensor_id': sensor_id})

        if candidates:
            selected = max(
                candidates,
                key=lambda row: (
                    _num(row.get('total_value'), 0.0),
                    str(row.get('timestamp') or ''),
                ),
            )
            totalizador = round(max(_num(selected.get('total_value'), 0.0), 0.0), 3)
            totalizador_total += totalizador
            wells.append({
                'well_id': str(mapping['well_id']),
                'numero': well_number,
                'well_number': well_number,
                'nombre': mapping.get('name') or f'Pozo {well_number}',
                'name': mapping.get('name') or f'Pozo {well_number}',
                'operational_name': mapping.get('operational_name') or '',
                'totalizador_m3': totalizador,
                'timestamp': _iso(selected.get('timestamp')) or str(selected.get('timestamp') or ''),
                'status': 'valid',
                'status_label': 'Dato válido',
                'source': READINGS_MINUTE_TABLE,
                'sensor_id': int(selected.get('sensor_id') or 0),
            })
        else:
            wells.append({
                'well_id': str(mapping['well_id']),
                'numero': well_number,
                'well_number': well_number,
                'nombre': mapping.get('name') or f'Pozo {well_number}',
                'name': mapping.get('name') or f'Pozo {well_number}',
                'operational_name': mapping.get('operational_name') or '',
                'totalizador_m3': None,
                'timestamp': None,
                'status': 'missing',
                'status_label': 'Sin dato para el corte',
                'source': READINGS_MINUTE_TABLE,
            })

    return {
        'date': target_date.isoformat(),
        'title': 'Corte de totalizadores de pozos',
        'source_status': source_status,
        'source': READINGS_MINUTE_TABLE,
        'totalizador_total_m3': round(totalizador_total, 3),
        'wells': wells,
    }


def _readings_well_flow_history(
    session,
    period: str = 'hourly',
    start_date: Any = None,
    end_date: Any = None,
) -> list[dict[str, Any]]:
    '''Return bucketed well flow history from readings_minute.'''
    normalized_period = _normalize_period(period, start_date, end_date)
    include_energy_sensors = normalized_period != 'minute'
    if include_energy_sensors:
        sensor_ids = [sid for mapping in GUADALUPE_WELL_SENSOR_MAP for sid in (int(mapping['flow_out_sensor_id']), int(mapping['flow_in_sensor_id']), int(mapping['energy_sensor_id']))]
    else:
        sensor_ids = [sid for mapping in GUADALUPE_WELL_SENSOR_MAP for sid in (int(mapping['flow_out_sensor_id']), int(mapping['flow_in_sensor_id']))]
    id_list, params = _readings_params_for_sensor_ids(sensor_ids)
    if not id_list:
        return []
    _readings_base_params(params)
    date_sql = _readings_date_filter(start_date, end_date, params)
    bucket_sql = _readings_bucket_expression(normalized_period)
    sql = f'''
        WITH valid AS (
            SELECT
                r.sensor_id,
                {bucket_sql} AS bucket,
                COALESCE(r.ts_local, r.ts_minute) AS ts_value,
                CAST(r.instant_value AS float) AS instant_value,
                CAST(r.total_value AS float) AS total_value,
                CAST(r.quality AS float) AS quality
            FROM {READINGS_MINUTE_TABLE} r
            WHERE r.sensor_id IN ({id_list})
              AND (r.instant_value IS NOT NULL OR r.total_value IS NOT NULL OR r.quality IS NOT NULL)
              {_readings_valid_row_filter(False)}
              {date_sql}
        ), aggregated AS (
            SELECT
                sensor_id,
                bucket,
                AVG(instant_value) AS avg_instant_value,
                AVG(quality) AS avg_quality,
                MIN(ts_value) AS min_ts,
                MAX(ts_value) AS max_ts,
                COUNT(*) AS samples
            FROM valid
            GROUP BY sensor_id, bucket
        ), ranked AS (
            SELECT
                sensor_id,
                bucket,
                total_value,
                ROW_NUMBER() OVER (PARTITION BY sensor_id, bucket ORDER BY ts_value ASC) AS rn_first,
                ROW_NUMBER() OVER (PARTITION BY sensor_id, bucket ORDER BY ts_value DESC) AS rn_last
            FROM valid
            WHERE total_value IS NOT NULL
        ), totals AS (
            SELECT
                sensor_id,
                bucket,
                MAX(CASE WHEN rn_first = 1 THEN total_value END) AS first_total_value,
                MAX(CASE WHEN rn_last = 1 THEN total_value END) AS last_total_value
            FROM ranked
            WHERE rn_first = 1 OR rn_last = 1
            GROUP BY sensor_id, bucket
        )
        SELECT
            a.sensor_id,
            a.bucket,
            a.avg_instant_value,
            a.avg_quality,
            a.samples,
            t.first_total_value,
            t.last_total_value
        FROM aggregated a
        LEFT JOIN totals t ON t.sensor_id = a.sensor_id AND t.bucket = a.bucket
    '''
    rows = _readings_execute_mappings(session, sql, params, READINGS_MINUTE_TIMEOUT_SECONDS)
    by_key: dict[tuple[int, str], dict[str, Any]] = {}
    for row in rows:
        try:
            sensor_id = int(row['sensor_id'])
            bucket = _iso(row.get('bucket')) or str(row.get('bucket') or '')
        except (TypeError, ValueError, KeyError):
            continue
        first_value = _num(row.get('first_total_value'), 0)
        last_value = _num(row.get('last_total_value'), 0)
        samples = int(_num(row.get('samples'), 0))
        delta = _safe_delta(last_value, first_value)
        delta_kind = 'energy' if sensor_id in ENERGY_SENSOR_IDS else 'water'
        if delta and not _readings_valid_delta(delta, delta_kind, period=normalized_period):
            delta = 0.0
        flow_lps, flow_status, flow_note = _well_flow_quality(row.get('avg_instant_value')) if sensor_id in FLOW_OUT_SENSOR_IDS or sensor_id in FLOW_IN_SENSOR_IDS else (_num(row.get('avg_instant_value'), 0), 'valid', '')
        by_key[(sensor_id, bucket)] = {
            'sensor_id': sensor_id,
            'bucket': bucket,
            'flow_lps': flow_lps,
            'flow_raw_lps': _num(row.get('avg_instant_value'), 0),
            'flow_status': flow_status,
            'flow_note': flow_note,
            'quality': row.get('avg_quality'),
            'samples': samples,
            'period_m3': delta if samples >= 2 else 0.0,
            'totalizador_m3': last_value,
        }

    history: list[dict[str, Any]] = []
    for mapping in GUADALUPE_WELL_SENSOR_MAP:
        well_id = int(mapping['well_id'])
        well_number = int(mapping['well_number'])
        flow_out_sensor_id = int(mapping['flow_out_sensor_id'])
        flow_in_sensor_id = int(mapping['flow_in_sensor_id'])
        energy_sensor_id = int(mapping['energy_sensor_id'])
        bucket_sensor_ids = {flow_out_sensor_id, flow_in_sensor_id, energy_sensor_id} if include_energy_sensors else {flow_out_sensor_id, flow_in_sensor_id}
        buckets = sorted({bucket for sensor_id, bucket in by_key if sensor_id in bucket_sensor_ids})
        for bucket in buckets:
            out_row = by_key.get((flow_out_sensor_id, bucket), {})
            in_row = by_key.get((flow_in_sensor_id, bucket), {})
            energy_row = by_key.get((energy_sensor_id, bucket), {})
            flow_out = _num(out_row.get('flow_lps'), 0)
            flow_in = _num(in_row.get('flow_lps'), 0)
            flow_status = 'invalid_flow' if max(flow_out, flow_in) <= 0 and any(str(row.get('flow_status') or '') == 'invalid_flow' for row in (out_row, in_row)) else 'valid'
            flow_note = 'Dato en revisión por flujo fuera de rango' if flow_status == 'invalid_flow' else ''
            water = max((out_row, in_row), key=lambda item: _num(item.get('period_m3'), 0), default={})
            energy_delta = _num(energy_row.get('period_m3'), 0)
            quality = energy_row.get('quality')
            amps = _amps_from_quality(quality)
            # No dejar que filas solo con amperaje/quality bloqueen el fallback BOS:
            # para graficas de pozos se requiere flujo o delta de volumen util.
            if not any([flow_out, flow_in, water.get('period_m3')]):
                continue
            if energy_delta and not _readings_valid_delta(energy_delta, 'energy', period=normalized_period):
                energy_delta = 0.0
            samples = max(int(_num(out_row.get('samples'), 0) + _num(in_row.get('samples'), 0)), 1)
            history.append({
                'well_id': str(well_id),
                'numero': well_number,
                'timestamp': bucket,
                'bucket': bucket,
                'aggregation': normalized_period,
                'samples': samples,
                'flow_out_lps': round(flow_out, 4),
                'flow_in_lps': round(flow_in, 4),
                'flow_lps': round(max(flow_out, flow_in), 4),
                'flow_status': flow_status,
                'flow_note': flow_note,
                'flow_out_lps_status': out_row.get('flow_status') or 'valid',
                'flow_in_lps_status': in_row.get('flow_status') or 'valid',
                'amps': amps,
                'amperaje': amps,
                'energy_total_kwh': energy_row.get('totalizador_m3'),
                'energy_delta_kwh': round(energy_delta, 6),
                'totalizador_m3': water.get('totalizador_m3'),
                'period_m3': round(_num(water.get('period_m3'), 0), 6),
                'source_table': READINGS_MINUTE_TABLE,
            })
    _readings_source_log('well history', 'readings_minute' if _readings_history_is_usable(history) else 'invalid_deltas', len(rows), len(history))
    return history if _readings_history_is_usable(history) else []

def _energy_water_rows(
    session,
    period: str = 'daily',
    start_date: Any = None,
    end_date: Any = None,
    well_id: int | None = None,
    sensor_id_1: int | None = None,
    sensor_id_2: int | None = None,
    timeout_seconds: int = 5,
) -> list[dict[str, Any]]:
    start_dt, end_dt = _sp_datetime_bounds(start_date, end_date)
    dbapi_connection, previous_timeout = _set_dbapi_timeout(session, timeout_seconds)
    try:
        sql = text("""
            EXEC iot.sp_get_energy_water
                @period = :period,
                @well_id = :well_id,
                @sensor_id_1 = :sensor_id_1,
                @sensor_id_2 = :sensor_id_2,
                @start_date = :start_date,
                @end_date = :end_date
        """)
        result = session.execute(sql, {
            'period': period,
            'well_id': well_id,
            'sensor_id_1': sensor_id_1,
            'sensor_id_2': sensor_id_2,
            'start_date': start_dt,
            'end_date': end_dt,
        })
        return [{str(k).lower(): v for k, v in dict(row).items()} for row in result.mappings().all()]
    except SQLAlchemyError as exc:
        global _SP_GET_ENERGY_WATER_WARNED
        if not _SP_GET_ENERGY_WATER_WARNED:
            logger.warning('water_bos SQL warning executing iot.sp_get_energy_water: %s', exc)
            _SP_GET_ENERGY_WATER_WARNED = True
        else:
            logger.debug('water_bos repeated iot.sp_get_energy_water warning: %s', exc)
        return []
    finally:
        _restore_dbapi_timeout(dbapi_connection, previous_timeout)

def _energy_water_summary(rows: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    summary: dict[int, dict[str, Any]] = {}
    for row in rows:
        try:
            well_id = int(row.get('well_id'))
        except (TypeError, ValueError):
            continue
        item = summary.setdefault(well_id, {
            'well_id': well_id,
            'kwh_value': 0.0,
            'm3_value': 0.0,
            'energy_sensor_id': None,
            'water_sensor_id': None,
            'last_bucket': None,
            'rows': 0,
        })
        item['kwh_value'] += _num(row.get('kwh_value'))
        item['m3_value'] += _num(row.get('m3_value'))
        item['energy_sensor_id'] = row.get('energy_sensor_id') or item.get('energy_sensor_id')
        item['water_sensor_id'] = row.get('water_sensor_id') or item.get('water_sensor_id')
        bucket = row.get('bucket')
        if bucket is not None:
            item['last_bucket'] = bucket
        item['rows'] += 1
    for item in summary.values():
        m3 = _num(item.get('m3_value'))
        kwh = _num(item.get('kwh_value'))
        item['kwh_por_m3'] = round(kwh / m3, 4) if m3 else None
    return summary

def _positive_int(value: Any) -> int | None:
    if value is None or value == '':
        return None
    try:
        number = int(float(str(value).strip()))
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _resolve_well_energy_filter(
    pozo_row: dict[str, Any] | None,
    well_id: Any = None,
    sensor_id_1: Any = None,
    sensor_id_2: Any = None,
) -> dict[str, Any]:
    requested_well_id = _positive_int(well_id)
    requested_sensor_1 = _positive_int(sensor_id_1)
    requested_sensor_2 = _positive_int(sensor_id_2)
    requested_sensors = {item for item in (requested_sensor_1, requested_sensor_2) if item}

    selected_index: int | None = None
    if requested_well_id in WELL_IDS:
        candidate_index = WELL_IDS.index(requested_well_id)
        if _is_operational_well_number(candidate_index + 1):
            selected_index = candidate_index
    elif requested_well_id and 1 <= requested_well_id <= len(WELL_IDS):
        candidate_index = requested_well_id - 1
        if _is_operational_well_number(requested_well_id):
            selected_index = candidate_index

    if selected_index is None and requested_sensors:
        for index in _operational_well_indices():
            known_sensors = {ENERGY_SENSOR_IDS[index], FLOW_OUT_SENSOR_IDS[index], FLOW_IN_SENSOR_IDS[index]}
            if requested_sensors.intersection(known_sensors):
                selected_index = index
                break

    if selected_index is None:
        return {
            'well_id': requested_well_id,
            'sensor_id_1': requested_sensor_1,
            'sensor_id_2': requested_sensor_2,
            'well_index': None,
            'well_number': None,
            'has_specific_filter': bool(requested_well_id or requested_sensor_1 or requested_sensor_2),
        }

    resolved_well_id = WELL_IDS[selected_index]
    energy_sensor_id = requested_sensor_1 or ENERGY_SENSOR_IDS[selected_index]
    water_sensor_id = requested_sensor_2 or FLOW_OUT_SENSOR_IDS[selected_index]
    flow_in_sensor_id = FLOW_IN_SENSOR_IDS[selected_index]
    return {
        'well_id': resolved_well_id,
        'sensor_id_1': energy_sensor_id,
        'sensor_id_2': water_sensor_id,
        'flow_in_sensor_id': flow_in_sensor_id,
        'well_index': selected_index,
        'well_number': selected_index + 1,
        'has_specific_filter': True,
    }


def _well_energy_sensor_ids(pozo_row: dict[str, Any] | None) -> list[int]:
    """Return explicit Guadalupe energy sensor IDs used by visible well cards."""
    return [int(mapping['energy_sensor_id']) for mapping in GUADALUPE_WELL_SENSOR_MAP]


def _latest_quality_by_sensor(session, sensor_ids: list[int], start_date: Any = None, end_date: Any = None) -> dict[int, float]:
    """Read the latest raw quality directly from iot.readings_minute.

    Uses the optimized readings_minute latest-row helper so amperage precision
    remains available without running an unbounded query.
    """
    latest_rows = _readings_latest_by_sensor(session, sensor_ids, start_date=start_date, end_date=end_date)
    result: dict[int, float] = {}
    for sensor_id, row in latest_rows.items():
        quality = row.get('quality')
        if quality is None:
            continue
        try:
            result[int(sensor_id)] = float(quality)
        except (TypeError, ValueError):
            continue
    return result


def _sensor_catalog(session) -> dict[int, dict[str, Any]]:
    cached = _cache_get(_SENSOR_CATALOG_CACHE, 'iot.sensors')
    if cached is not None:
        return cached

    try:
        rows = session.execute(text('''
            SELECT
                s.sensor_id,
                s.external_code,
                s.name,
                s.location,
                s.active,
                st.code AS sensor_type_code,
                st.description AS sensor_type_description,
                u.symbol AS unit_symbol,
                s.metadata
            FROM iot.sensors s
            LEFT JOIN iot.sensor_types st ON s.sensor_type_id = st.sensor_type_id
            LEFT JOIN iot.units u ON st.default_unit_id = u.unit_id
        ''')).mappings().all()
    except SQLAlchemyError as exc:
        logger.exception('water_bos SQL error reading sensor catalog: %s', exc)
        return _cache_get_stale(_SENSOR_CATALOG_CACHE, 'iot.sensors') or {}

    catalog: dict[int, dict[str, Any]] = {}
    for item in rows:
        try:
            catalog[int(item['sensor_id'])] = dict(item)
        except (TypeError, ValueError, KeyError):
            continue
    logger.info('water_bos SQL connected: iot.sensors rows=%s mapped=%s', len(rows), len(catalog))
    if not rows:
        logger.info('water_bos table returned 0 rows: iot.sensors')
    return _cache_set(_SENSOR_CATALOG_CACHE, catalog, 'iot.sensors')


def _well_locations(session) -> dict[int, dict[str, Any]]:
    cached = _cache_get(_WELL_LOCATIONS_CACHE, 'iot.wells_monitoring')
    if cached is not None:
        return cached

    try:
        rows = session.execute(text('''
            SELECT
                well_id,
                well_name,
                status,
                latitude,
                longitude,
                altitude_masl,
                municipality_state,
                flow_lps_current,
                dynamic_level_m,
                last_update,
                ph_current,
                chlorine_mgL_current
            FROM iot.wells_monitoring
        ''')).mappings().all()
    except SQLAlchemyError as exc:
        logger.exception('water_bos SQL error reading well locations: %s', exc)
        return _cache_get_stale(_WELL_LOCATIONS_CACHE, 'iot.wells_monitoring') or {}

    locations: dict[int, dict[str, Any]] = {}
    for item in rows:
        try:
            locations[int(item['well_id'])] = dict(item)
        except (TypeError, ValueError, KeyError):
            continue
    logger.info('water_bos SQL connected: iot.wells_monitoring rows=%s mapped=%s', len(rows), len(locations))
    if not rows:
        logger.info('water_bos table returned 0 rows: iot.wells_monitoring')
    return _cache_set(_WELL_LOCATIONS_CACHE, locations, 'iot.wells_monitoring')


def _bos_value(row: dict[str, Any] | None, prefix: str, index: int, field: str, default: Any = None) -> Any:
    base = f'{prefix}_{index}'
    candidates = [
        f'{base}_{field}',
        f'{base}_{field}_value',
        f'{base}_{field}_val',
    ]
    if field == 'instant_value':
        candidates.extend([f'{base}_instant', f'{base}_value', base])
    if field == 'total_value':
        candidates.extend([f'{base}_total', f'{base}_totalizer', f'{base}_accumulated'])
    if field == 'sensor_id':
        candidates.extend([f'{base}_id', f'{base}_sensor'])
    if field == 'quality':
        candidates.extend([f'{base}_quality_code'])
    return _first(row, *candidates, default=default)


def _build_sensor(sensor_id: int, catalog: dict[int, dict[str, Any]], role: str, value: float, well_id: str | None = None) -> dict[str, Any]:
    meta = catalog.get(sensor_id, {})
    return {
        'id': str(sensor_id),
        'name': str(meta.get('name') or meta.get('external_code') or role),
        'type': role,
        'unit': str(meta.get('unit_symbol') or ('kWh' if 'ENERGY' in role.upper() else 'L/s')),
        'value': value,
        'well_id': well_id,
    }


def _status_from_values(flow_out: float, flow_in: float, amps: float | None = None) -> tuple[bool, str, str, str, str]:
    flow = max(_num(flow_out, 0), _num(flow_in, 0))
    if flow > 0:
        return True, 'Encendido', 'normal', 'Normal', 'normal'

    # El amperaje se conserva como lectura electrica, pero ya no enciende
    # operativamente un pozo si no hay flujo. Comunicacion y bombeo se reportan
    # por separado para evitar falsos "Encendido".
    if _num(amps, 0) > 0:
        return False, 'Energizado sin flujo', 'warning', 'Normal', 'normal'

    return False, 'Apagado', 'idle', 'Normal', 'normal'


def _build_wells(
    pozo_row: dict[str, Any] | None,
    catalog: dict[int, dict[str, Any]],
    locations: dict[int, dict[str, Any]],
    energy_water: dict[int, dict[str, Any]] | None = None,
    pozo_start_row: dict[str, Any] | None = None,
    has_period: bool = False,
    latest_quality_by_sensor: dict[int, float] | None = None,
    readings_periods: dict[int, dict[str, Any]] | None = None,
    previous_readings_periods: dict[int, dict[str, Any]] | None = None,
    period_start: Any = None,
    period_end: Any = None,
) -> list[dict[str, Any]]:
    wells: list[dict[str, Any]] = []
    for mapping in GUADALUPE_WELL_SENSOR_MAP:
        well_number = int(mapping['well_number'])
        index = well_number - 1
        well_id = int(mapping['well_id'])
        energy_sensor_id = int(mapping['energy_sensor_id'])
        flow_out_sensor_id = int(mapping['flow_out_sensor_id'])
        flow_in_sensor_id = int(mapping['flow_in_sensor_id'])

        energy_total = _num(_bos_value(pozo_row, 'POZO_ENERGY_TOTAL', index, 'total_value', 0))
        energy_instant = _num(_bos_value(pozo_row, 'POZO_ENERGY_TOTAL', index, 'instant_value', 0))
        raw_flow_out = _num(_bos_value(pozo_row, 'POZO_FLOW_OUT', index, 'instant_value', 0))
        raw_flow_in = _num(_bos_value(pozo_row, 'POZO_FLOW_IN', index, 'instant_value', 0))
        flow_out, flow_out_status, flow_out_note = _well_flow_quality(raw_flow_out)
        flow_in, flow_in_status, flow_in_note = _well_flow_quality(raw_flow_in)
        flow_status = 'invalid_flow' if max(flow_out, flow_in) <= 0 and (flow_out_status == 'invalid_flow' or flow_in_status == 'invalid_flow') else 'valid'
        flow_note = 'Dato en revisión por flujo fuera de rango' if flow_status == 'invalid_flow' else ''
        flow_out_total = _num(_bos_value(pozo_row, 'POZO_FLOW_OUT', index, 'total_value', 0))
        flow_in_total = _num(_bos_value(pozo_row, 'POZO_FLOW_IN', index, 'total_value', 0))
        start_energy_total = _num(_bos_value(pozo_start_row, 'POZO_ENERGY_TOTAL', index, 'total_value', energy_total))
        start_flow_out_total = _num(_bos_value(pozo_start_row, 'POZO_FLOW_OUT', index, 'total_value', flow_out_total))
        start_flow_in_total = _num(_bos_value(pozo_start_row, 'POZO_FLOW_IN', index, 'total_value', flow_in_total))
        totalizer_delta_m3 = max(flow_out_total - start_flow_out_total, flow_in_total - start_flow_in_total, 0)
        energy_delta_kwh = max(energy_total - start_energy_total, 0)
        quality_energy = _bos_value(pozo_row, 'POZO_ENERGY_TOTAL', index, 'quality', 0)
        quality_out = _bos_value(pozo_row, 'POZO_FLOW_OUT', index, 'quality', 0)
        quality_in = _bos_value(pozo_row, 'POZO_FLOW_IN', index, 'quality', 0)
        # Amperaje de pozos: tomar primero el quality exacto desde
        # iot.readings_minute para conservar decimales (ej. Pozo 03 = 30.87 A).
        # Si no existe, usar el dato expuesto por dbo.SensorsBOS_Pozo.
        direct_quality = (latest_quality_by_sensor or {}).get(energy_sensor_id)
        amps = (
            _amps_from_quality(direct_quality)
            or _amps_from_quality(quality_energy)
            or _amps_from_quality(quality_out)
            or _amps_from_quality(quality_in)
        )
        active, status, status_type, comm, comm_type = _status_from_values(flow_out, flow_in, amps)
        if flow_status == 'invalid_flow':
            active = False
            status = 'Dato en revisión'
            status_type = 'warning'
            comm = 'Normal'
            comm_type = 'normal'

        location_row = locations.get(well_id, {})
        registered_name = str(location_row.get('well_name') or mapping.get('operational_name') or WELL_NAMES[index]).strip()
        municipality_state = str(location_row.get('municipality_state') or '').strip()
        name = _format_well_display_name(well_number, registered_name)
        # La ubicacion conserva el nombre operativo base; el nombre visible
        # siempre incluye numero de pozo para evitar confundir Estacionamientos.
        location = registered_name
        totalizer = max(flow_out_total, flow_in_total)
        ew = (energy_water or {}).get(well_id, {})
        rm_period = (readings_periods or {}).get(well_id, {})
        previous_rm_period = (previous_readings_periods or {}).get(well_id, {})
        # El periodo se usa solo para graficas/reportes. Nunca usar el totalizador
        # acumulado como si fuera consumo del dia, porque eso genera reportes falsos.
        # Prioridad controlada: readings_minute filtrado -> SP energia/agua validado -> delta BOS validado.
        period_m3: float | None = None
        period_source = 'latest'
        bombeado_hoy_status = 'missing' if has_period else 'not_requested'
        bombeado_hoy_note = _well_period_display_note('missing') if has_period else ''

        rm_status = str(rm_period.get('bombeado_hoy_status') or '').strip().lower() if rm_period else ''
        if rm_period and rm_status == 'valid':
            period_m3 = _num(rm_period.get('m3_value'), 0)
            period_source = READINGS_MINUTE_TABLE
            bombeado_hoy_status = 'valid'
            bombeado_hoy_note = ''
        elif rm_period and rm_status == 'invalid_delta':
            period_source = READINGS_MINUTE_TABLE
            bombeado_hoy_status = 'invalid_delta'
            bombeado_hoy_note = str(rm_period.get('bombeado_hoy_note') or _well_period_display_note('invalid_delta'))
        else:
            ew_status, ew_value, ew_note = _well_period_delta_quality(ew.get('m3_value'), period_start, period_end) if ew else ('missing', None, '')
            if ew and ew_status == 'valid':
                period_m3 = ew_value or 0.0
                period_source = 'iot.sp_get_energy_water'
                bombeado_hoy_status = 'valid'
                bombeado_hoy_note = ''
            else:
                bos_status, bos_value, bos_note = _well_period_delta_quality(totalizer_delta_m3 if has_period else None, period_start, period_end)
                if has_period and bos_status == 'valid':
                    period_m3 = bos_value or 0.0
                    period_source = 'bos_totalizer_delta'
                    bombeado_hoy_status = 'valid'
                    bombeado_hoy_note = ''
                elif has_period and bos_status == 'invalid_delta':
                    period_source = 'bos_totalizer_delta'
                    bombeado_hoy_status = 'invalid_delta'
                    bombeado_hoy_note = bos_note or _well_period_display_note('invalid_delta')
                elif ew and ew_status == 'invalid_delta':
                    period_source = 'iot.sp_get_energy_water'
                    bombeado_hoy_status = 'invalid_delta'
                    bombeado_hoy_note = ew_note or _well_period_display_note('invalid_delta')

        bombeado_ayer_status = 'missing' if has_period else 'not_requested'
        bombeado_ayer_note = _well_period_display_note('missing') if has_period else ''
        bombeado_ayer_m3 = None
        previous_status = str(previous_rm_period.get('bombeado_hoy_status') or '').strip().lower() if previous_rm_period else ''
        if previous_rm_period and previous_status == 'valid':
            bombeado_ayer_m3 = _num(previous_rm_period.get('bombeado_hoy_m3') or previous_rm_period.get('m3_value'), 0)
            bombeado_ayer_status = 'valid'
            bombeado_ayer_note = ''
        elif previous_rm_period and previous_status == 'invalid_delta':
            bombeado_ayer_status = 'invalid_delta'
            bombeado_ayer_note = str(previous_rm_period.get('bombeado_hoy_note') or _well_period_display_note('invalid_delta'))

        period_kwh = _num(rm_period.get('kwh_value'), 0) if rm_period else (_num(ew.get('kwh_value'), 0) if ew else (energy_delta_kwh if has_period else 0))
        period_kwh_m3 = rm_period.get('kwh_por_m3') if rm_period else ew.get('kwh_por_m3')
        if period_kwh_m3 is None and period_m3:
            period_kwh_m3 = round(period_kwh / period_m3, 4) if period_kwh else None
        water_total = rm_period.get('water_total') if rm_period else None
        energy_total_period = rm_period.get('energy_total') if rm_period else None
        first_totalizador_period = _num(water_total.get('first_total_value'), 0) if water_total else (max(start_flow_out_total, start_flow_in_total) if has_period else None)
        last_totalizador_period = _num(water_total.get('last_total_value'), 0) if water_total else totalizer
        first_energy_period = _num(energy_total_period.get('first_total_value'), 0) if energy_total_period else (start_energy_total if has_period else None)
        last_energy_period = _num(energy_total_period.get('last_total_value'), 0) if energy_total_period else energy_total
        sensors = [
            _build_sensor(energy_sensor_id, catalog, 'ENERGY_TOTAL', energy_total or energy_instant, str(well_id)),
            _build_sensor(flow_out_sensor_id, catalog, 'FLOW_OUT', flow_out, str(well_id)),
            _build_sensor(flow_in_sensor_id, catalog, 'FLOW_IN', flow_in, str(well_id)),
        ]
        period_fields = _well_period_payload_fields(period_m3, bombeado_hoy_status, bombeado_hoy_note)
        wells.append({
            'id': f'pozo-{well_number}',
            'well_id': str(well_id),
            'numero': well_number,
            'name': name,
            'nombre': name,
            'ubicacion': location,
            'municipio_estado': municipality_state,
            'entry_m3': period_fields['entry_m3'],
            'supply_hours': 0,
            'active': active,
            'status': status,
            'statusType': status_type,
            'estado_comunicacion': comm,
            'communicationType': comm_type,
            'kwh': period_kwh or energy_total or energy_instant,
            'dailyKwh': period_kwh or energy_total or energy_instant,
            'period_m3': period_fields['period_m3'],
            'bombeado_hoy_m3': period_fields['bombeado_hoy_m3'],
            'bombeado_hoy_status': period_fields['bombeado_hoy_status'],
            'bombeado_hoy_note': period_fields['bombeado_hoy_note'],
            'bombeado_ayer_m3': round(bombeado_ayer_m3, 6) if bombeado_ayer_status == 'valid' and bombeado_ayer_m3 is not None else None,
            'bombeado_ayer_status': bombeado_ayer_status,
            'bombeado_ayer_note': bombeado_ayer_note,
            'period_kwh': period_kwh,
            'period_delta_m3': period_fields['period_delta_m3'],
            'period_delta_kwh': period_kwh if rm_period else (energy_delta_kwh if has_period else 0),
            'period_source': period_source,
            'period_available': period_fields['period_available'],
            'kwh_por_m3': period_kwh_m3,
            'first_totalizador_m3': first_totalizador_period,
            'last_totalizador_m3': last_totalizador_period,
            'totalizador_inicio_dia_m3': first_totalizador_period,
            'totalizador_cierre_anterior_m3': first_totalizador_period,
            'totalizador_actual_m3': last_totalizador_period,
            'first_flow_out_total_m3': start_flow_out_total if has_period else None,
            'last_flow_out_total_m3': flow_out_total,
            'first_flow_in_total_m3': start_flow_in_total if has_period else None,
            'last_flow_in_total_m3': flow_in_total,
            'first_energy_total_kwh': first_energy_period,
            'last_energy_total_kwh': last_energy_period,
            'totalizador_m3': totalizer,
            'flujo_entrada': flow_in,
            'flujo_salida': flow_out,
            'flow': max(flow_out, flow_in),
            'flujo_entrada_raw': raw_flow_in,
            'flujo_salida_raw': raw_flow_out,
            'flow_raw_lps': max(raw_flow_out, raw_flow_in),
            'flujo_entrada_status': flow_in_status,
            'flujo_salida_status': flow_out_status,
            'flow_status': flow_status,
            'flujo_entrada_note': flow_in_note,
            'flujo_salida_note': flow_out_note,
            'flow_note': flow_note,
            'updated': _iso(_first(pozo_row, 'time_stamp', 'timestamp')) or 'Sin lectura reciente',
            'ultima_lectura': _iso(_first(pozo_row, 'time_stamp', 'timestamp')) or 'Sin lectura reciente',
            'latitude': location_row.get('latitude'),
            'longitude': location_row.get('longitude'),
            'dynamic_level_m': location_row.get('dynamic_level_m'),
            'ph_current': location_row.get('ph_current'),
            'chlorine_mgL_current': location_row.get('chlorine_mgL_current'),
            'quality': _num(direct_quality if direct_quality is not None else quality_energy, 0),
            'amps': amps,
            'amperaje': amps,
            'energy_sensor_id': int(_num(rm_period.get('energy_sensor_id') if rm_period else ew.get('energy_sensor_id'), energy_sensor_id)),
            'water_sensor_id': int(_num(rm_period.get('water_sensor_id') if rm_period else ew.get('water_sensor_id'), flow_out_sensor_id)),
            'flow_out_sensor_id': flow_out_sensor_id,
            'flow_in_sensor_id': flow_in_sensor_id,
            'sensors': sensors,
            'energy_water_source': READINGS_MINUTE_TABLE if rm_period else ('iot.sp_get_energy_water' if ew else None),
            'diagnosis': 'Lectura operativa con volumen del periodo desde fuente validada.' if rm_period else ('Lectura operativa con consumo del periodo desde fuente validada.' if ew else 'Lectura actual de planta.'),
        })
    return wells


def _build_tank_inputs(tanque_row: dict[str, Any] | None, catalog: dict[int, dict[str, Any]]) -> list[dict[str, Any]]:
    tank_inputs: list[dict[str, Any]] = []
    for index in range(10):
        sensor_id = int(_num(_bos_value(tanque_row, 'TANQUE_FLOW_IN', index, 'sensor_id', 3001 + index * 2), 3001 + index * 2))
        flow = _num(_bos_value(tanque_row, 'TANQUE_FLOW_IN', index, 'instant_value', 0))
        total = _num(_bos_value(tanque_row, 'TANQUE_FLOW_IN', index, 'total_value', 0))
        quality = _num(_bos_value(tanque_row, 'TANQUE_FLOW_IN', index, 'quality', 0))
        meta = catalog.get(sensor_id, {})
        name = str(meta.get('name') or f'Llegada Tanque {index + 1}')
        tank_inputs.append({
            'id': f'tanque-in-{index + 1}',
            'name': name,
            'label': name,
            'sensor_id': sensor_id,
            'flow_lps': flow,
            'total_m3': total,
            'quality': quality,
            'active': flow > 0,
            'updated': _iso(_first(tanque_row, 'time_stamp', 'timestamp')) or 'Sin lectura reciente',
            'ultima_lectura': _iso(_first(tanque_row, 'time_stamp', 'timestamp')) or 'Sin lectura reciente',
        })
    return tank_inputs


def _build_lines(
    linea_row: dict[str, Any] | None,
    catalog: dict[int, dict[str, Any]],
    linea_start_row: dict[str, Any] | None = None,
    has_period: bool = False,
) -> list[dict[str, Any]]:
    lines: list[dict[str, Any]] = []
    for index in range(10):
        sensor_id = int(_num(_bos_value(linea_row, 'LINEA_FLOW_IN', index, 'sensor_id', 2001 + index * 2), 2001 + index * 2))
        flow = _num(_bos_value(linea_row, 'LINEA_FLOW_IN', index, 'instant_value', 0))
        total = _num(_bos_value(linea_row, 'LINEA_FLOW_IN', index, 'total_value', 0))
        start_total = _num(_bos_value(linea_start_row, 'LINEA_FLOW_IN', index, 'total_value', total))
        period_m3 = max(total - start_total, 0) if has_period else 0
        quality = _num(_bos_value(linea_row, 'LINEA_FLOW_IN', index, 'quality', 0))
        meta = catalog.get(sensor_id, {})
        name = str(meta.get('name') or f'Línea {index + 1}')
        lines.append({
            'id': f'linea-{index + 1}',
            'numero': index + 1,
            'name': f'Línea {index + 1}',
            'nombre': f'Línea {index + 1}',
            'ubicacion': 'Líneas de producción',
            'sensor_name': name,
            'sensor_id': sensor_id,
            'flow_lps': flow,
            'total_m3': total,
            'totalizador_m3': total,
            'period_m3': period_m3,
            'period_delta_m3': period_m3,
            'quality': quality,
            'active': flow > 0,
            'updated': _iso(_first(linea_row, 'time_stamp', 'timestamp')) or 'Sin lectura reciente',
            'ultima_lectura': _iso(_first(linea_row, 'time_stamp', 'timestamp')) or 'Sin lectura reciente',
        })
    return lines





def _flow_status(flow: float | None, has_reading: bool) -> tuple[bool, str, str, str, str]:
    if not has_reading:
        return False, 'Sin datos', 'communication', 'Sin comunicación', 'offline'
    if _num(flow, 0) > 0:
        return True, 'Operando', 'normal', 'En línea', 'online'
    return False, 'Sin flujo', 'idle', 'En línea', 'online'


def _flow_item_metadata(index: int, catalog: dict[int, dict[str, Any]]) -> tuple[int, str, str]:
    item = FLOW_SENSOR_MAP[index]
    sensor_id = int(item['sensor_id'])
    meta = catalog.get(sensor_id, {})
    name = str(item['name'])
    location = str(meta.get('location') or f'Sensor {sensor_id} · dbo.SensorsBOS_Tanque')
    return sensor_id, name, location


def _build_flows(
    tanque_row: dict[str, Any] | None,
    catalog: dict[int, dict[str, Any]],
    tanque_start_row: dict[str, Any] | None = None,
    has_period: bool = False,
) -> list[dict[str, Any]]:
    flows: list[dict[str, Any]] = []
    updated = _iso(_first(tanque_row, 'time_stamp', 'timestamp')) if tanque_row else None
    for index in range(len(FLOW_SENSOR_MAP)):
        sensor_id, name, location = _flow_item_metadata(index, catalog)
        raw_flow = _bos_value(tanque_row, 'TANQUE_FLOW_IN', index, 'instant_value', None)
        raw_total = _bos_value(tanque_row, 'TANQUE_FLOW_IN', index, 'total_value', None)
        raw_quality = _bos_value(tanque_row, 'TANQUE_FLOW_IN', index, 'quality', None)
        has_reading = raw_flow is not None or raw_total is not None
        flow = _num(raw_flow) if raw_flow is not None else None
        total = _num(raw_total) if raw_total is not None else None
        start_total = _num(_bos_value(tanque_start_row, 'TANQUE_FLOW_IN', index, 'total_value', total)) if total is not None else None
        period_m3 = _safe_delta(total, start_total) if has_period and total is not None and start_total is not None else 0
        active, status, status_type, communication, communication_type = _flow_status(flow, has_reading)
        flows.append({
            'id': f'flujo-{index + 1:02d}',
            'numero': index + 1,
            'name': name,
            'nombre': name,
            'ubicacion': location,
            'sensor_id': sensor_id,
            'flow_lps': flow,
            'flujo_lps': flow,
            'flow': flow,
            'total_m3': total,
            'totalizador_m3': total,
            'period_m3': period_m3,
            'period_delta_m3': period_m3,
            'volumen_periodo_m3': period_m3,
            'quality': _num(raw_quality) if raw_quality is not None else None,
            'active': active,
            'status': status,
            'statusType': status_type,
            'estado_comunicacion': communication,
            'communicationType': communication_type,
            'updated': updated or 'Sin datos',
            'ultima_lectura': updated or 'Sin datos',
            'source_table': 'dbo.SensorsBOS_Tanque',
            'source_key': f'TANQUE_FLOW_IN[{index}]',
            'diagnosis': f'Lectura real desde dbo.SensorsBOS_Tanque TANQUE_FLOW_IN[{index}] / sensor_id {sensor_id}.' if has_reading else f'Sin lectura disponible para sensor_id {sensor_id}.',
        })
    return flows



def _parse_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if value is None or value == '':
        return None
    text_value = str(value).replace('Z', '').strip()
    try:
        return datetime.fromisoformat(text_value)
    except ValueError:
        try:
            return datetime.strptime(text_value[:19], '%Y-%m-%d %H:%M:%S')
        except ValueError:
            return None


def _bucket_datetime(value: Any, period: str = 'hourly') -> datetime | None:
    dt_value = _parse_datetime(value)
    if not dt_value:
        return None
    period = str(period or 'hourly').lower()
    if period == 'daily':
        return datetime(dt_value.year, dt_value.month, dt_value.day)
    if period == 'monthly':
        return datetime(dt_value.year, dt_value.month, 1)
    if period == 'minute':
        return datetime(dt_value.year, dt_value.month, dt_value.day, dt_value.hour, dt_value.minute)
    return datetime(dt_value.year, dt_value.month, dt_value.day, dt_value.hour)


def _bucket_iso(value: Any, period: str = 'hourly') -> str:
    bucket = _bucket_datetime(value, period)
    if not bucket:
        return _iso(value) or 'Sin lectura reciente'
    return bucket.isoformat()


def _safe_delta(last_value: float, first_value: float) -> float:
    delta = _num(last_value) - _num(first_value)
    return round(delta, 6) if delta > 0 else 0.0


def _flow_by_sensor(flows: list[dict[str, Any]], sensor_id: Any) -> dict[str, Any] | None:
    """Return the first flow row matching a BOS sensor id.

    Guadalupe keeps flow/treatment readings in the normalized `flows` list built
    from dbo.SensorsBOS_Tanque. This helper is used by balance/report summaries
    and must tolerate missing or malformed sensor ids after partial SQL reads.
    """
    try:
        wanted = int(float(str(sensor_id).strip()))
    except (TypeError, ValueError):
        return None
    for item in flows or []:
        try:
            current = int(float(str(item.get('sensor_id')).strip()))
        except (TypeError, ValueError, AttributeError):
            continue
        if current == wanted:
            return item
    return None


def _flow_name_for_sensor(sensor_id: Any) -> str:
    """Return the configured operational name for a flow/treatment sensor."""
    try:
        wanted = int(float(str(sensor_id).strip()))
    except (TypeError, ValueError):
        return 'Flujo operativo'
    for item in FLOW_SENSOR_MAP:
        if int(item.get('sensor_id') or 0) == wanted:
            return str(item.get('name') or f'Flujo {wanted}')
    return f'Flujo {wanted}'


def _sum_flow_lps(flows: list[dict[str, Any]], sensor_ids: tuple[int, ...] | list[int] | set[int]) -> float:
    """Sum current flow in L/s for the requested BOS flow sensor ids.

    Uses the real normalized values already read from BOS. It does not fabricate
    readings: missing, null or non numeric values are ignored.
    """
    wanted: set[int] = set()
    for sensor_id in sensor_ids or []:
        try:
            wanted.add(int(float(str(sensor_id).strip())))
        except (TypeError, ValueError):
            continue
    if not wanted:
        return 0.0

    total = 0.0
    for item in flows or []:
        try:
            current = int(float(str(item.get('sensor_id')).strip()))
        except (TypeError, ValueError, AttributeError):
            continue
        if current not in wanted:
            continue
        total += _num(item.get('flow_lps', item.get('flujo_lps', item.get('flow'))), 0.0)
    return round(total, 4)


def _sum_flow_period_m3(flows: list[dict[str, Any]], sensor_ids: tuple[int, ...] | list[int] | set[int]) -> float:
    """Sum period volume in m3 for the requested BOS flow sensor ids.

    The value comes from period deltas calculated from BOS totalizers. If a row
    has no period delta, it contributes zero rather than falling back to the
    accumulated totalizer, preserving the report's period-volume calculation.
    """
    wanted: set[int] = set()
    for sensor_id in sensor_ids or []:
        try:
            wanted.add(int(float(str(sensor_id).strip())))
        except (TypeError, ValueError):
            continue
    if not wanted:
        return 0.0

    total = 0.0
    for item in flows or []:
        try:
            current = int(float(str(item.get('sensor_id')).strip()))
        except (TypeError, ValueError, AttributeError):
            continue
        if current not in wanted:
            continue
        total += _num(
            item.get('period_m3', item.get('period_delta_m3', item.get('volumen_periodo_m3'))),
            0.0,
        )
    return round(total, 4)


def _flow_consumption_metric(name: str, value: Any, detail: str = '', unit: str = 'L/s') -> dict[str, Any]:
    """Build a dashboard metric item for Guadalupe flow/balance summaries."""
    return {
        'name': str(name),
        'value': round(_num(value), 4),
        'unit': str(unit or ''),
        'detail': str(detail or ''),
    }


def get_bos_report_period_totals(start_date: Any = None, end_date: Any = None) -> dict[str, Any]:
    """Return period totals for daily water reports from BOS totalizers.

    The daily report needs a stable period delta (first reading vs last reading)
    without depending on the heavier dashboard payload. This function reads the
    same BOS tables used by the dashboard and exposes only the period summary
    consumed by water_daily_report_service.
    """
    sql_errors: dict[str, int] = {'count': 0}
    with SessionLocal() as session:
        readings_periods = _readings_well_periods(session, start_date=start_date, end_date=end_date)
        pozo_first_row = _safe_first_row(session, 'dbo.SensorsBOS_Pozo', start_date, end_date, sql_errors)
        pozo_last_row = _safe_latest_row(session, 'dbo.SensorsBOS_Pozo', start_date, end_date, sql_errors)
        linea_first_row = _safe_first_row(session, 'dbo.SensorsBOS_Linea', start_date, end_date, sql_errors)
        linea_last_row = _safe_latest_row(session, 'dbo.SensorsBOS_Linea', start_date, end_date, sql_errors)

    wells: list[dict[str, Any]] = []
    for index in _operational_well_indices():
        well_number = index + 1
        energy_sensor_id = ENERGY_SENSOR_IDS[index]
        flow_out_sensor_id = FLOW_OUT_SENSOR_IDS[index]
        flow_in_sensor_id = FLOW_IN_SENSOR_IDS[index]

        last_energy_total = _num(_bos_value(pozo_last_row, 'POZO_ENERGY_TOTAL', index, 'total_value', None), 0)
        first_energy_total = _num(_bos_value(pozo_first_row, 'POZO_ENERGY_TOTAL', index, 'total_value', last_energy_total), last_energy_total)
        last_flow_out_total = _num(_bos_value(pozo_last_row, 'POZO_FLOW_OUT', index, 'total_value', None), 0)
        first_flow_out_total = _num(_bos_value(pozo_first_row, 'POZO_FLOW_OUT', index, 'total_value', last_flow_out_total), last_flow_out_total)
        last_flow_in_total = _num(_bos_value(pozo_last_row, 'POZO_FLOW_IN', index, 'total_value', None), 0)
        first_flow_in_total = _num(_bos_value(pozo_first_row, 'POZO_FLOW_IN', index, 'total_value', last_flow_in_total), last_flow_in_total)

        flow_out_delta = _safe_delta(last_flow_out_total, first_flow_out_total)
        flow_in_delta = _safe_delta(last_flow_in_total, first_flow_in_total)
        if flow_in_delta > flow_out_delta:
            water_delta_m3 = flow_in_delta
            first_totalizador_m3 = first_flow_in_total
            last_totalizador_m3 = last_flow_in_total
            water_sensor_id = flow_in_sensor_id
            water_source_column = f'POZO_FLOW_IN_{index}_total_value'
        else:
            water_delta_m3 = flow_out_delta
            first_totalizador_m3 = first_flow_out_total
            last_totalizador_m3 = last_flow_out_total
            water_sensor_id = flow_out_sensor_id
            water_source_column = f'POZO_FLOW_OUT_{index}_total_value'

        kwh_delta = _safe_delta(last_energy_total, first_energy_total)
        has_rows = pozo_first_row is not None and pozo_last_row is not None
        rm_period = readings_periods.get(WELL_IDS[index], {}) if 'readings_periods' in locals() else {}
        water_status = 'missing'
        water_note = _well_period_display_note('missing')
        water_available = False
        if rm_period:
            energy_sensor_id = int(_num(rm_period.get('energy_sensor_id'), energy_sensor_id))
            water_sensor_id = int(_num(rm_period.get('water_sensor_id'), water_sensor_id))
            flow_out_sensor_id = int(_num(rm_period.get('flow_out_sensor_id'), flow_out_sensor_id))
            flow_in_sensor_id = int(_num(rm_period.get('flow_in_sensor_id'), flow_in_sensor_id))
            water_total = rm_period.get('water_total') or {}
            energy_total_period = rm_period.get('energy_total') or {}
            kwh_delta = _num(rm_period.get('kwh_value'), 0)
            first_totalizador_m3 = _num(water_total.get('first_total_value'), first_totalizador_m3)
            last_totalizador_m3 = _num(water_total.get('last_total_value'), last_totalizador_m3)
            first_energy_total = _num(energy_total_period.get('first_total_value'), first_energy_total)
            last_energy_total = _num(energy_total_period.get('last_total_value'), last_energy_total)
            water_source_column = 'iot.readings_minute.total_value'
            has_rows = True
            rm_status = str(rm_period.get('bombeado_hoy_status') or '').lower()
            if rm_status == 'valid':
                water_delta_m3 = _num(rm_period.get('m3_value'), 0)
                water_status = 'valid'
                water_note = ''
                water_available = True
            elif rm_status == 'invalid_delta':
                water_delta_m3 = None
                water_status = 'invalid_delta'
                water_note = str(rm_period.get('bombeado_hoy_note') or _well_period_display_note('invalid_delta'))
            else:
                water_delta_m3 = None
        else:
            bos_status, bos_value, bos_note = _well_period_delta_quality(water_delta_m3 if has_rows else None, start_date, end_date)
            if bos_status == 'valid':
                water_delta_m3 = bos_value or 0.0
                water_status = 'valid'
                water_note = ''
                water_available = True
            elif bos_status == 'invalid_delta':
                water_delta_m3 = None
                water_status = 'invalid_delta'
                water_note = bos_note or _well_period_display_note('invalid_delta')
            else:
                water_delta_m3 = None
        period_fields = _well_period_payload_fields(water_delta_m3, water_status, water_note, precision=2)
        wells.append({
            'numero': well_number,
            'well_id': WELL_IDS[index],
            'name': _format_well_display_name(well_number, WELL_NAMES[index]),
            'nombre': _format_well_display_name(well_number, WELL_NAMES[index]),
            'operational_name': WELL_NAMES[index],
            'energy_sensor_id': energy_sensor_id,
            'water_sensor_id': water_sensor_id,
            'flow_out_sensor_id': flow_out_sensor_id,
            'flow_in_sensor_id': flow_in_sensor_id,
            'water_delta_m3': period_fields['bombeado_hoy_m3'],
            'entry_m3': period_fields['entry_m3'],
            'period_m3': period_fields['period_m3'],
            'period_delta_m3': period_fields['period_delta_m3'],
            'bombeado_hoy_m3': period_fields['bombeado_hoy_m3'],
            'bombeado_hoy_status': period_fields['bombeado_hoy_status'],
            'bombeado_hoy_note': period_fields['bombeado_hoy_note'],
            'water_available': period_fields['period_available'],
            'water_status': period_fields['bombeado_hoy_status'],
            'water_source': READINGS_MINUTE_TABLE if rm_period else 'BOS totalizador',
            'water_source_column': water_source_column,
            'first_totalizador_m3': round(first_totalizador_m3, 2) if has_rows else None,
            'last_totalizador_m3': round(last_totalizador_m3, 2) if has_rows else None,
            'totalizador_inicio_dia_m3': round(first_totalizador_m3, 2) if has_rows else None,
            'totalizador_actual_m3': round(last_totalizador_m3, 2) if has_rows else None,
            'first_flow_out_total_m3': round(first_flow_out_total, 2) if has_rows else None,
            'last_flow_out_total_m3': round(last_flow_out_total, 2) if has_rows else None,
            'first_flow_in_total_m3': round(first_flow_in_total, 2) if has_rows else None,
            'last_flow_in_total_m3': round(last_flow_in_total, 2) if has_rows else None,
            'kwh_delta': round(kwh_delta, 2),
            'kwh_available': bool(has_rows),
            'kwh_source': READINGS_MINUTE_TABLE if rm_period else 'BOS totalizador',
            'first_energy_total_kwh': round(first_energy_total, 2) if has_rows else None,
            'last_energy_total_kwh': round(last_energy_total, 2) if has_rows else None,
        })

    lines: list[dict[str, Any]] = []
    for index in range(10):
        line_number = index + 1
        sensor_id = int(_num(
            _bos_value(linea_last_row, 'LINEA_FLOW_IN', index, 'sensor_id', 2001 + index * 2),
            2001 + index * 2,
        ))
        last_total = _num(_bos_value(linea_last_row, 'LINEA_FLOW_IN', index, 'total_value', None), 0)
        first_total = _num(_bos_value(linea_first_row, 'LINEA_FLOW_IN', index, 'total_value', last_total), last_total)
        period_m3 = _safe_delta(last_total, first_total)
        has_rows = linea_first_row is not None and linea_last_row is not None
        lines.append({
            'numero': line_number,
            'name': f'Línea {line_number}',
            'nombre': f'Línea {line_number}',
            'sensor_id': sensor_id,
            'period_m3': round(period_m3, 2),
            'available': bool(has_rows),
            'status': 'bos_totalizer_delta' if has_rows else 'Sin lectura BOS para el periodo',
            'source_column': f'LINEA_FLOW_IN_{index}_total_value',
            'first_totalizador_m3': round(first_total, 2) if has_rows else None,
            'last_totalizador_m3': round(last_total, 2) if has_rows else None,
        })

    status = 'readings_minute_loaded' if 'readings_periods' in locals() and readings_periods else ('loaded' if int(sql_errors.get('count') or 0) == 0 else 'partial_sql_error')
    if not ('readings_periods' in locals() and readings_periods) and not pozo_first_row and not pozo_last_row and not linea_first_row and not linea_last_row:
        status = 'sql_error' if int(sql_errors.get('count') or 0) else 'empty'
    return {
        'status': status,
        'source': 'iot.readings_minute para pozos con fallback a BOS; lineas desde dbo.SensorsBOS_Linea',
        'start_date': str(start_date) if start_date is not None else None,
        'end_date': str(end_date) if end_date is not None else None,
        'wells': wells,
        'lines': lines,
    }



def _build_flow_history(rows: list[dict[str, Any]], catalog: dict[int, dict[str, Any]], period: str = 'hourly') -> list[dict[str, Any]]:
    """Aggregate independent flow sensors from dbo.SensorsBOS_Tanque."""
    grouped: dict[tuple[int, str], dict[str, Any]] = {}
    for row in rows:
        timestamp_value = _first(row, 'time_stamp', 'timestamp')
        bucket = _bucket_iso(timestamp_value, period)
        if not bucket:
            continue
        for index in range(len(FLOW_SENSOR_MAP)):
            sensor_id, name, location = _flow_item_metadata(index, catalog)
            raw_flow = _bos_value(row, 'TANQUE_FLOW_IN', index, 'instant_value', None)
            raw_total = _bos_value(row, 'TANQUE_FLOW_IN', index, 'total_value', None)
            raw_quality = _bos_value(row, 'TANQUE_FLOW_IN', index, 'quality', None)
            if raw_flow is None and raw_total is None:
                continue
            flow = _num(raw_flow) if raw_flow is not None else 0
            total = _num(raw_total) if raw_total is not None else 0
            key = (sensor_id, bucket)
            item = grouped.setdefault(key, {
                'id': f'flujo-{index + 1:02d}',
                'numero': index + 1,
                'name': name,
                'nombre': name,
                'ubicacion': location,
                'sensor_id': sensor_id,
                'timestamp': bucket,
                'bucket': bucket,
                'aggregation': period,
                'flow_sum': 0.0,
                'samples': 0,
                'first_total_m3': total,
                'last_total_m3': total,
                'quality': _num(raw_quality) if raw_quality is not None else None,
            })
            item['flow_sum'] += flow
            item['samples'] += 1
            item['last_total_m3'] = total
            if raw_quality is not None:
                item['quality'] = _num(raw_quality)

    history: list[dict[str, Any]] = []
    for item in sorted(grouped.values(), key=lambda row: (row['timestamp'], row['numero'])):
        samples = max(int(item.get('samples') or 1), 1)
        period_m3 = _safe_delta(item.get('last_total_m3'), item.get('first_total_m3'))
        history.append({
            'id': item['id'],
            'numero': item['numero'],
            'name': item['name'],
            'nombre': item['nombre'],
            'ubicacion': item['ubicacion'],
            'sensor_id': item['sensor_id'],
            'timestamp': item['timestamp'],
            'bucket': item['bucket'],
            'aggregation': item['aggregation'],
            'samples': samples,
            'flow_lps': round(item['flow_sum'] / samples, 4),
            'flujo_lps': round(item['flow_sum'] / samples, 4),
            'total_m3': item.get('last_total_m3'),
            'totalizador_m3': item.get('last_total_m3'),
            'period_m3': period_m3,
            'volumen_periodo_m3': period_m3,
            'quality': item.get('quality'),
            'source_table': 'dbo.SensorsBOS_Tanque',
        })
    return history



def _build_well_flow_history(
    rows: list[dict[str, Any]],
    period: str = 'hourly',
    well_index: int | None = None,
    start_date: Any = None,
    end_date: Any = None,
) -> list[dict[str, Any]]:
    """Aggregate BOS well history and filter invalid totalizer jumps."""
    grouped: dict[tuple[int, str], dict[str, Any]] = {}
    for row in rows:
        timestamp_value = _first(row, 'time_stamp', 'timestamp')
        bucket = _bucket_iso(timestamp_value, period)
        if not bucket:
            continue
        if well_index is not None and 0 <= well_index < len(WELL_IDS):
            indexes = [well_index] if _is_operational_well_number(well_index + 1) else []
        else:
            indexes = _operational_well_indices()
        for index in indexes:
            well_number = index + 1
            well_id = WELL_IDS[index]
            raw_flow_out = _num(_bos_value(row, 'POZO_FLOW_OUT', index, 'instant_value', 0))
            raw_flow_in = _num(_bos_value(row, 'POZO_FLOW_IN', index, 'instant_value', 0))
            flow_out, flow_out_status, _flow_out_note = _well_flow_quality(raw_flow_out)
            flow_in, flow_in_status, _flow_in_note = _well_flow_quality(raw_flow_in)
            flow_lps = max(flow_out, flow_in)
            flow_status = 'invalid_flow' if flow_lps <= 0 and (flow_out_status == 'invalid_flow' or flow_in_status == 'invalid_flow') else 'valid'
            energy_total = _num(_bos_value(row, 'POZO_ENERGY_TOTAL', index, 'total_value', 0))
            amps = (
                _amps_from_quality(_bos_value(row, 'POZO_ENERGY_TOTAL', index, 'quality', 0))
                or _amps_from_quality(_bos_value(row, 'POZO_FLOW_OUT', index, 'quality', 0))
                or _amps_from_quality(_bos_value(row, 'POZO_FLOW_IN', index, 'quality', 0))
            )
            flow_out_total = _num(_bos_value(row, 'POZO_FLOW_OUT', index, 'total_value', 0))
            flow_in_total = _num(_bos_value(row, 'POZO_FLOW_IN', index, 'total_value', 0))
            totalizador = max(flow_out_total, flow_in_total)
            if not any([flow_out, flow_in, energy_total, flow_out_total, flow_in_total, amps]):
                continue
            key = (well_id, bucket)
            item = grouped.setdefault(key, {
                'well_id': str(well_id),
                'numero': well_number,
                'timestamp': bucket,
                'bucket': bucket,
                'aggregation': period,
                'flow_out_sum': 0.0,
                'flow_in_sum': 0.0,
                'flow_sum': 0.0,
                'flow_invalid_samples': 0,
                'amp_sum': 0.0,
                'amp_samples': 0,
                'samples': 0,
                'first_energy_total_kwh': energy_total,
                'last_energy_total_kwh': energy_total,
                'first_totalizador_m3': totalizador,
                'last_totalizador_m3': totalizador,
            })
            item['flow_out_sum'] += flow_out
            item['flow_in_sum'] += flow_in
            item['flow_sum'] += flow_lps
            if flow_status == 'invalid_flow':
                item['flow_invalid_samples'] += 1
            if amps is not None:
                item['amp_sum'] += amps
                item['amp_samples'] += 1
            item['samples'] += 1
            item['last_energy_total_kwh'] = energy_total
            item['last_totalizador_m3'] = totalizador

    history: list[dict[str, Any]] = []
    for item in sorted(grouped.values(), key=lambda row: (row['timestamp'], row['numero'])):
        samples = max(int(item.get('samples') or 1), 1)
        raw_period_m3 = _safe_delta(item.get('last_totalizador_m3'), item.get('first_totalizador_m3'))
        period_status, validated_period_m3, period_note = _well_period_delta_quality(
            raw_period_m3,
            start_date=start_date,
            end_date=end_date,
            period=period,
        )
        period_m3 = validated_period_m3 if period_status == 'valid' else 0.0
        energy_delta = _safe_delta(item.get('last_energy_total_kwh'), item.get('first_energy_total_kwh'))
        flow_status = 'invalid_flow' if _num(item.get('flow_sum'), 0) <= 0 and int(_num(item.get('flow_invalid_samples'), 0)) > 0 else 'valid'
        flow_note = 'Dato en revisión por flujo fuera de rango' if flow_status == 'invalid_flow' else ''
        history.append({
            'well_id': item['well_id'],
            'numero': item['numero'],
            'timestamp': item['timestamp'],
            'bucket': item['bucket'],
            'aggregation': item['aggregation'],
            'samples': samples,
            'flow_out_lps': round(item['flow_out_sum'] / samples, 4),
            'flow_in_lps': round(item['flow_in_sum'] / samples, 4),
            'flow_lps': round(item['flow_sum'] / samples, 4),
            'flow_status': flow_status,
            'flow_note': flow_note,
            'amps': round(item['amp_sum'] / item['amp_samples'], 2) if item.get('amp_samples') else None,
            'amperaje': round(item['amp_sum'] / item['amp_samples'], 2) if item.get('amp_samples') else None,
            'energy_total_kwh': item.get('last_energy_total_kwh'),
            'energy_delta_kwh': energy_delta,
            'totalizador_m3': item.get('last_totalizador_m3'),
            'period_m3': period_m3,
            'period_delta_m3': period_m3,
            'volumen_periodo_m3': period_m3,
            'period_status': period_status,
            'period_note': period_note,
            'raw_period_m3': raw_period_m3 if period_status != 'valid' else period_m3,
        })
    return history


def _build_line_history(rows: list[dict[str, Any]], catalog: dict[int, dict[str, Any]], period: str = 'hourly') -> list[dict[str, Any]]:
    """Aggregate BOS line history by hour for one day, or by day for multi-day ranges."""
    grouped: dict[tuple[int, str], dict[str, Any]] = {}
    for row in rows:
        timestamp_value = _first(row, 'time_stamp', 'timestamp')
        bucket = _bucket_iso(timestamp_value, period)
        if not bucket:
            continue
        for index in range(10):
            sensor_id = int(_num(_bos_value(row, 'LINEA_FLOW_IN', index, 'sensor_id', 2001 + index * 2), 2001 + index * 2))
            flow = _num(_bos_value(row, 'LINEA_FLOW_IN', index, 'instant_value', 0))
            total = _num(_bos_value(row, 'LINEA_FLOW_IN', index, 'total_value', 0))
            quality = _num(_bos_value(row, 'LINEA_FLOW_IN', index, 'quality', 0))
            if not any([flow, total]):
                continue
            meta = catalog.get(sensor_id, {})
            key = (index + 1, bucket)
            item = grouped.setdefault(key, {
                'id': f'linea-{index + 1}',
                'numero': index + 1,
                'name': f'Línea {index + 1}',
                'nombre': f'Línea {index + 1}',
                'sensor_name': str(meta.get('name') or f'Línea {index + 1}'),
                'sensor_id': sensor_id,
                'timestamp': bucket,
                'bucket': bucket,
                'aggregation': period,
                'flow_sum': 0.0,
                'samples': 0,
                'first_total_m3': total,
                'last_total_m3': total,
                'quality': quality,
            })
            item['flow_sum'] += flow
            item['samples'] += 1
            item['last_total_m3'] = total
            item['quality'] = quality

    history: list[dict[str, Any]] = []
    for item in sorted(grouped.values(), key=lambda row: (row['timestamp'], row['numero'])):
        samples = max(int(item.get('samples') or 1), 1)
        period_m3 = _safe_delta(item.get('last_total_m3'), item.get('first_total_m3'))
        history.append({
            'id': item['id'],
            'numero': item['numero'],
            'name': item['name'],
            'nombre': item['nombre'],
            'sensor_name': item['sensor_name'],
            'sensor_id': item['sensor_id'],
            'timestamp': item['timestamp'],
            'bucket': item['bucket'],
            'aggregation': item['aggregation'],
            'samples': samples,
            'flow_lps': round(item['flow_sum'] / samples, 4),
            'total_m3': item.get('last_total_m3'),
            'period_m3': period_m3,
            'quality': item.get('quality'),
        })
    return history

def _well_period_volume_m3(item: dict[str, Any]) -> float | None:
    # Volumen del dia/periodo: nunca usar totalizador_m3 acumulado.
    status = str(item.get('bombeado_hoy_status') or item.get('water_status') or '').strip().lower()
    if status and status not in {'valid', 'ok'}:
        return None
    for key in ('bombeado_hoy_m3', 'period_m3', 'period_delta_m3', 'entry_m3'):
        value = item.get(key)
        if value is None or value == '':
            continue
        parsed = _num(value, float('nan'))
        if parsed == parsed:
            return max(parsed, 0.0)
    return None


def _cards(wells: list[dict[str, Any]], lines: list[dict[str, Any]], tank_inputs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    active_wells = sum(1 for item in wells if item.get('active'))
    total_flow_out = sum(_num(item.get('flujo_salida')) for item in wells)
    total_flow_in = sum(_num(item.get('flujo_entrada')) for item in wells)
    active_lines = sum(1 for item in lines if item.get('active'))
    active_tank = sum(1 for item in tank_inputs if item.get('active'))
    pumped_today = sum((_well_period_volume_m3(item) or 0.0) for item in wells)
    return [
        {'label': 'Pozos operando', 'value': f'{active_wells}/{len(wells)}', 'unit': 'pozos', 'trend': 'Datos desde monitoreo', 'accent': 'blue'},
        {'label': 'Flujo salida pozos', 'value': f'{total_flow_out:,.2f}', 'unit': 'L/s', 'trend': 'Lectura actual de planta', 'accent': 'cyan'},
        {'label': 'Flujo entrada tanque', 'value': f'{total_flow_in:,.2f}', 'unit': 'L/s', 'trend': 'Lectura actual de planta', 'accent': 'teal'},
        {'label': 'Agua bombeada hoy', 'value': f'{pumped_today:,.2f}', 'unit': 'm³', 'trend': 'Suma de pozos visibles', 'accent': 'blue'},
        {'label': 'Líneas activas', 'value': f'{active_lines}/{len(lines)}', 'unit': 'líneas', 'trend': 'Datos desde monitoreo', 'accent': 'sky'},
        {'label': 'Llegadas a tanque', 'value': f'{active_tank}/{len(tank_inputs)}', 'unit': 'medidores', 'trend': 'Datos desde monitoreo', 'accent': 'indigo'},
    ]


def get_bos_water_dashboard_payload(
    start_date: Any = None,
    end_date: Any = None,
    period: Any = None,
    include_history: bool = False,
    include_energy_water: bool = False,
    include_optional_catalogs: bool = False,
    include_period_deltas: bool = False,
    force_refresh: bool = False,
) -> dict[str, Any] | None:
    start_bound, end_bound = _date_bounds(start_date, end_date)
    # Para el Resumen rapido, include_period_deltas=true debe calcular el corte
    # del dia aunque el frontend no mande fechas. Se usa BOS inicio-dia -> lectura
    # actual, sin activar lecturas pesadas de energia ni totalizadores acumulados.
    period_delta_start = start_bound or (date.today() if include_period_deltas else None)
    period_delta_end = end_bound or period_delta_start
    has_period = bool(period_delta_start and (include_history or include_period_deltas))
    normalized_period = _normalize_period(period, start_date, end_date)
    cache_key = _payload_cache_key(
        start_date,
        end_date,
        normalized_period,
        include_history,
        include_energy_water,
        include_period_deltas,
        include_optional_catalogs,
    )
    if not force_refresh:
        cached_payload = _payload_cache_get(cache_key)
        if cached_payload is not None:
            return cached_payload
    sql_errors = {'count': 0}
    energy_water_rows: list[dict[str, Any]] = []
    energy_water: dict[int, dict[str, Any]] = {}
    readings_periods: dict[int, dict[str, Any]] = {}
    previous_readings_periods: dict[int, dict[str, Any]] = {}
    readings_well_history: list[dict[str, Any]] = []
    readings_minute_status = 'not_requested'
    catalog: dict[int, dict[str, Any]] = {}
    locations: dict[int, dict[str, Any]] = {}
    latest_quality_by_sensor: dict[int, float] = {}
    pozo_start_row = None
    tanque_start_row = None
    linea_start_row = None
    pozo_history_rows: list[dict[str, Any]] = []
    tanque_history_rows: list[dict[str, Any]] = []
    linea_history_rows: list[dict[str, Any]] = []
    niveles_history_rows: list[dict[str, Any]] = []

    try:
        with SessionLocal() as session:
            block_started = monotonic()
            pozo_row = _safe_latest_row(session, 'dbo.SensorsBOS_Pozo', start_date, end_date, sql_errors)
            _log_timing('latest dbo.SensorsBOS_Pozo', block_started)

            block_started = monotonic()
            tanque_row = _safe_latest_row(session, 'dbo.SensorsBOS_Tanque', start_date, end_date, sql_errors)
            _log_timing('latest dbo.SensorsBOS_Tanque', block_started)

            block_started = monotonic()
            linea_row = _safe_latest_row(session, 'dbo.SensorsBOS_Linea', start_date, end_date, sql_errors)
            _log_timing('latest dbo.SensorsBOS_Linea', block_started)

            block_started = monotonic()
            niveles_row = _safe_latest_row(session, 'dbo.NIVELES_BOS', start_date, end_date, sql_errors)
            _log_timing('latest dbo.NIVELES_BOS', block_started)

            if not any([pozo_row, tanque_row, linea_row, niveles_row]):
                if int(sql_errors.get('count') or 0) >= 4:
                    logger.warning('water_bos SQL unavailable: all dashboard latest queries failed for start_date=%s end_date=%s', start_date, end_date)
                    return _sql_connection_error_payload()
                logger.warning('water_bos SQL connected but dashboard tables returned 0 latest rows for start_date=%s end_date=%s', start_date, end_date)
                return None

            if include_optional_catalogs:
                block_started = monotonic()
                catalog = _sensor_catalog(session)
                locations = _well_locations(session)
                latest_quality_by_sensor = _latest_quality_by_sensor(
                    session,
                    _well_energy_sensor_ids(pozo_row),
                    start_date=start_date,
                    end_date=end_date,
                )
                _log_timing('optional catalogs iot.sensors/iot.wells_monitoring/iot.readings_minute', block_started)
            else:
                logger.info('water_bos fast dashboard: optional iot catalogs skipped')

            if has_period:
                block_started = monotonic()
                # El KPI Agua bombeada hoy debe usar la misma logica validada
                # que el Reporte Diario. Aunque la carga rapida no mande
                # start_date/end_date, include_period_deltas=true se interpreta
                # como el corte del dia actual y se consulta readings_minute
                # para deltas de pozos. Solo si readings_minute no trae datos
                # validos se permite fallback BOS. No se activan historicos
                # pesados, energia/agua agregada ni sp_get_energy_water.
                readings_periods = _readings_well_periods(
                    session,
                    start_date=period_delta_start,
                    end_date=period_delta_end,
                )
                previous_period_date = period_delta_start - timedelta(days=1) if period_delta_start else None
                if previous_period_date:
                    previous_readings_periods = _readings_well_periods(
                        session,
                        start_date=previous_period_date,
                        end_date=previous_period_date,
                    )
                readings_minute_status = (
                    'period_loaded'
                    if readings_periods
                    else ('period_bos_daily_delta' if include_period_deltas else 'period_empty_or_unavailable')
                )
                if not readings_periods:
                    _readings_source_log('period totals', 'bos_fallback')
                _log_timing('optional iot.readings_minute period totals', block_started)

                block_started = monotonic()
                pozo_start_row = _safe_first_row(session, 'dbo.SensorsBOS_Pozo', period_delta_start, period_delta_end, sql_errors)
                tanque_start_row = _safe_first_row(session, 'dbo.SensorsBOS_Tanque', period_delta_start, period_delta_end, sql_errors)
                linea_start_row = _safe_first_row(session, 'dbo.SensorsBOS_Linea', period_delta_start, period_delta_end, sql_errors)
                _log_timing('BOS start rows for period fallback deltas', block_started)
            if include_history:
                block_started = monotonic()
                readings_well_history = _readings_well_flow_history(
                    session,
                    period=normalized_period,
                    start_date=start_date,
                    end_date=end_date,
                )
                if readings_well_history:
                    readings_minute_status = 'history_loaded'
                _log_timing('optional iot.readings_minute well history', block_started)

                block_started = monotonic()
                if not readings_well_history:
                    _readings_source_log('well history', 'bos_fallback')
                    pozo_history_rows = _range_rows(session, 'dbo.SensorsBOS_Pozo', start_date, end_date, period=normalized_period)
                tanque_history_rows = _range_rows(session, 'dbo.SensorsBOS_Tanque', start_date, end_date, period=normalized_period)
                linea_history_rows = _range_rows(session, 'dbo.SensorsBOS_Linea', start_date, end_date, period=normalized_period)
                niveles_history_rows = _range_rows(session, 'dbo.NIVELES_BOS', start_date, end_date, period=normalized_period)
                _log_timing('optional BOS history rows/fallbacks', block_started)
            else:
                logger.info('water_bos fast dashboard: BOS historical rows skipped')

            if include_energy_water:
                block_started = monotonic()
                energy_water_rows = _readings_energy_water_rows(
                    session,
                    period=normalized_period,
                    start_date=start_date,
                    end_date=end_date,
                )
                if energy_water_rows:
                    readings_minute_status = 'energy_water_loaded'
                    energy_water = _energy_water_summary(energy_water_rows)
                    _log_timing('optional iot.readings_minute energy/water rows', block_started)
                    logger.info('water_bos SQL connected: iot.readings_minute energy/water rows=%s', len(energy_water_rows))
                else:
                    _log_timing('optional iot.readings_minute energy/water rows empty', block_started)
                    _readings_source_log('energy/water rows', 'sp_fallback')
                    block_started = monotonic()
                    energy_water_rows = _energy_water_rows(
                        session,
                        period=normalized_period,
                        start_date=start_date,
                        end_date=end_date,
                    )
                    _log_timing('optional iot.sp_get_energy_water fallback', block_started)
                    logger.info('water_bos SQL connected: iot.sp_get_energy_water rows=%s', len(energy_water_rows))
                    energy_water = _energy_water_summary(energy_water_rows)
            else:
                logger.warning('water_bos fast dashboard: energy/water historical rows skipped to avoid blocking initial load')
    except SQLAlchemyError as exc:
        logger.exception('water_bos SQL connection/payload error: %s', exc)
        return _sql_connection_error_payload()

    wells = _build_wells(
        pozo_row,
        catalog,
        locations,
        energy_water,
        pozo_start_row=pozo_start_row,
        has_period=has_period,
        latest_quality_by_sensor=latest_quality_by_sensor,
        readings_periods=readings_periods,
        previous_readings_periods=previous_readings_periods,
        period_start=period_delta_start,
        period_end=period_delta_end,
    )
    tank_inputs = _build_tank_inputs(tanque_row, catalog)
    flows = _build_flows(tanque_row, catalog, tanque_start_row=tanque_start_row, has_period=has_period)
    tank_level_readings = _build_tank_level_readings(niveles_row)
    lines = _build_lines(linea_row, catalog, linea_start_row=linea_start_row, has_period=has_period)
    daily_well_total_m3 = round(sum((_well_period_volume_m3(item) or 0.0) for item in wells), 6)
    previous_well_valid_count = sum(1 for item in wells if str(item.get('bombeado_ayer_status') or '').strip().lower() in {'valid', 'ok'})
    previous_well_total_m3 = (
        round(sum(_num(item.get('bombeado_ayer_m3'), 0) for item in wells if str(item.get('bombeado_ayer_status') or '').strip().lower() in {'valid', 'ok'}), 6)
        if previous_well_valid_count
        else None
    )
    normalized_period = _normalize_period(period, start_date, end_date)
    well_flow_history = readings_well_history or _build_well_flow_history(
        pozo_history_rows,
        normalized_period,
        start_date=start_date,
        end_date=end_date,
    )
    flow_history = _build_flow_history(tanque_history_rows, catalog, normalized_period)
    production_line_history = _build_line_history(linea_history_rows, catalog, normalized_period)
    tank_level_history = _build_tank_level_history(niveles_history_rows, normalized_period)
    sensors = [sensor for well in wells for sensor in well.get('sensors', [])]
    water_entry_by_well = [
        {'name': item['nombre'], 'value': _num(item.get('flujo_salida')), 'unit': 'L/s', 'detail': item.get('ubicacion', '')}
        for item in wells
    ]
    treatment_raw_input_lps = _sum_flow_lps(flows, [TREATMENT_RAW_INPUT_SENSOR_ID])
    treatment_output_lps = _sum_flow_lps(flows, TREATMENT_OUTPUT_SENSOR_IDS)
    treatment_duplicate_lps = _sum_flow_lps(flows, TEMPORARY_DUPLICATE_FLOW_SENSOR_IDS)
    treatment_raw_input_m3 = _sum_flow_period_m3(flows, [TREATMENT_RAW_INPUT_SENSOR_ID])
    treatment_output_m3 = _sum_flow_period_m3(flows, TREATMENT_OUTPUT_SENSOR_IDS)
    line_service_sensor_ids = (3002, 3004, 3006, 3008, 3010)
    # Mantener una sola interpretacion por contexto:
    # - Carga actual del dashboard: lecturas instantaneas en L/s.
    # - Reportes/rangos con include_period_deltas/include_history: volumen del periodo
    #   en m3 calculado como diferencia de totalizadores BOS ya cargados.
    balance_uses_period = bool(has_period)
    balance_unit = 'm³' if balance_uses_period else 'L/s'
    balance_basis = 'period_volume' if balance_uses_period else 'current_flow'
    balance_detail = (
        'Volumen del periodo de pozos desde iot.readings_minute; flujos auxiliares con fallback BOS'
        if balance_uses_period and readings_periods else
        ('Volumen del periodo calculado como diferencia de totalizadores BOS' if balance_uses_period else 'Lectura actual instantanea desde BOS')
    )

    def _flow_metric_value(sensor_ids: tuple[int, ...] | list[int] | set[int]) -> float:
        return _sum_flow_period_m3(flows, sensor_ids) if balance_uses_period else _sum_flow_lps(flows, sensor_ids)

    treatment_raw_input_value = treatment_raw_input_m3 if balance_uses_period else treatment_raw_input_lps
    treatment_output_value = treatment_output_m3 if balance_uses_period else treatment_output_lps
    line_service_values = {sensor_id: _flow_metric_value([sensor_id]) for sensor_id in line_service_sensor_ids}

    water_consumption = [
        _flow_consumption_metric(
            'Entrada cruda a tratamiento',
            treatment_raw_input_value,
            f'Sensor 3018 · entrada de agua cruda a tratamiento · {balance_detail}',
            balance_unit,
        ),
        _flow_consumption_metric(
            'Salida tratamiento UV1 + UV2',
            treatment_output_value,
            f'Sensores 3012 + 3014 · 3016 excluido por duplicado temporal · {balance_detail}',
            balance_unit,
        ),
        *[
            _flow_consumption_metric(
                _flow_name_for_sensor(sensor_id),
                line_service_values[sensor_id],
                f'Sensor {sensor_id} · {(_flow_by_sensor(flows, sensor_id) or {}).get("operational_usage") or "flujo operativo"} · {balance_detail}',
                balance_unit,
            )
            for sensor_id in line_service_sensor_ids
        ],
    ]
    if balance_uses_period:
        entry_vs_exit = [
            {'label': 'Pozos', 'entrada': sum((_well_period_volume_m3(item) or 0.0) for item in wells), 'salida': treatment_raw_input_value},
            {'label': 'Tratamiento', 'entrada': treatment_raw_input_value, 'salida': treatment_output_value},
            {'label': 'Líneas', 'entrada': treatment_output_value, 'salida': sum(_num(item.get('period_m3') or item.get('period_delta_m3')) for item in lines)},
        ]
    else:
        entry_vs_exit = [
            {'label': 'Pozos', 'entrada': sum(_num(item.get('flujo_entrada')) for item in wells), 'salida': sum(_num(item.get('flujo_salida')) for item in wells)},
            {'label': 'Tratamiento', 'entrada': treatment_raw_input_lps, 'salida': treatment_output_lps},
            {'label': 'Líneas', 'entrada': treatment_output_lps, 'salida': sum(_num(item.get('flow_lps')) for item in lines)},
        ]
    treatment_flow_summary = {
        'raw_input_sensor_id': TREATMENT_RAW_INPUT_SENSOR_ID,
        'raw_input_lps': treatment_raw_input_lps,
        'raw_input_period_m3': treatment_raw_input_m3,
        'output_sensor_ids': list(TREATMENT_OUTPUT_SENSOR_IDS),
        'output_lps': treatment_output_lps,
        'output_period_m3': treatment_output_m3,
        'temporary_duplicate_sensor_ids': sorted(TEMPORARY_DUPLICATE_FLOW_SENSOR_IDS),
        'temporary_duplicate_lps': treatment_duplicate_lps,
        'temporary_duplicate_period_m3': _sum_flow_period_m3(flows, TEMPORARY_DUPLICATE_FLOW_SENSOR_IDS),
        'balance_basis': balance_basis,
        'balance_unit': balance_unit,
        'period_volume_note': ('Volumen pozos = lectura final - inicial desde iot.readings_minute; fallback BOS si no hay datos.' if balance_uses_period and readings_periods else ('Volumen del periodo = lectura final - lectura inicial del totalizador BOS.' if balance_uses_period else None)),
        'calculation_note': 'Salida de tratamiento = sensor 3012 + sensor 3014. Sensor 3016 queda visible pero excluido de totales definitivos por duplicado temporal.',
    }
    updated = (
        _first(pozo_row, 'time_stamp', 'timestamp')
        or _first(tanque_row, 'time_stamp', 'timestamp')
        or _first(linea_row, 'time_stamp', 'timestamp')
        or _first(niveles_row, 'time_stamp', 'timestamp')
    )
    payload = {
        'title': 'Pozos',
        'subtitle': 'Lectura directa desde monitoreo de planta',
        'summary': {
            'daily_well_total_m3': daily_well_total_m3,
            'previous_well_total_m3': previous_well_total_m3,
            'bombeado_ayer_total_m3': previous_well_total_m3,
            'previous_well_valid_count': previous_well_valid_count,
        },
        'daily_well_total_m3': daily_well_total_m3,
        'previous_well_total_m3': previous_well_total_m3,
        'bombeado_ayer_total_m3': previous_well_total_m3,
        'previous_well_valid_count': previous_well_valid_count,
        'cards': _cards(wells, lines, tank_inputs),
        'water_entry_by_well': water_entry_by_well,
        'water_consumption': water_consumption,
        # Mantener tank_levels legacy vacío para no cambiar la salida de Reportes;
        # Tanques consume las lecturas crudas desde tank_level_readings.
        'tank_levels': [],
        'tank_level_readings': tank_level_readings,
        'tank_level_history': tank_level_history,
        'tank_level_columns': _tank_level_columns_metadata(),
        'supply_hours': [{'name': item['nombre'], 'value': _num(item.get('flow')), 'unit': 'L/s', 'detail': item.get('ubicacion', '')} for item in wells],
        'filters_vs_treated': [],
        'cip_weekly': [],
        'entry_vs_exit': entry_vs_exit,
        'monthly_averages': [],
        'daily_indicators': water_consumption,
        'report_modules': ['Pozos iot.readings_minute/BOS fallback', 'Energía/Agua filtrada por periodo', 'Tanques SQL Server', 'Líneas SQL Server', 'Flujos SQL Server', 'Balance hidráulico SQL Server'],
        'hourly_flow': [],
        'wells': wells,
        'sensors': sensors,
        'production_lines': lines,
        'tank_inputs': tank_inputs,
        'flows': flows,
        'flow_history': flow_history,
        'distribution_flows': water_consumption,
        'treatment_flow_summary': treatment_flow_summary,
        'energy_water_rows': energy_water_rows,
        'historical_status': 'loaded' if include_history else 'not_loaded_initial_fast',
        'energy_water_status': ('readings_minute_loaded' if include_energy_water and energy_water_rows and any(str(row.get('source')) == READINGS_MINUTE_TABLE for row in energy_water_rows) else ('loaded' if include_energy_water and energy_water_rows else ('not_requested_initial_fast' if not include_energy_water else 'empty_or_unavailable'))),
        'readings_minute_status': readings_minute_status,
        'readings_minute_recommended_index': READINGS_MINUTE_RECOMMENDED_INDEX,
        'well_flow_history': well_flow_history,
        'production_line_history': production_line_history,
        'source_status': 'sqlserver_readings_minute' if (readings_periods or readings_well_history or any(str(row.get('source')) == READINGS_MINUTE_TABLE for row in energy_water_rows)) else ('sqlserver_sp' if energy_water_rows else 'sqlserver_bos_fast'),
        'source': None,
        'updated_at': updated or datetime.utcnow(),
        'date_range': {'start_date': str(start_bound or ''), 'end_date': str(end_bound or ''), 'period': normalized_period},
        'aggregation': normalized_period,
    }
    return _payload_cache_set(
        cache_key,
        payload,
        _payload_cache_ttl(start_date, end_date, normalized_period, include_history, include_period_deltas),
    )
