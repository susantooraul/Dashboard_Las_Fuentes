from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from datetime import date, datetime, timedelta
from html import escape
from io import BytesIO
from pathlib import Path
from time import monotonic
from typing import Any, Iterable
from zoneinfo import ZoneInfo

from app.services.insurgentes_config import PLANT_NAME, SHIFT_WINDOWS
from app.services.insurgentes_daily_review_service import get_insurgentes_review_period
from app.services.insurgentes_service import get_insurgentes_interval_cut


LOCAL_ZONE = ZoneInfo('America/Mexico_City')

# Caché corto de datasets/exportaciones para no repetir las mismas consultas
# y renderizados cuando el usuario descarga varios formatos del mismo periodo.
_REPORT_DATASET_CACHE: dict[str, dict[str, Any]] = {}
_REPORT_EXPORT_CACHE: dict[str, dict[str, Any]] = {}
_REPORT_CURRENT_TTL_SECONDS = 55
_REPORT_CLOSED_TTL_SECONDS = 30 * 60
_REPORT_EXPORT_CURRENT_TTL_SECONDS = 55
_REPORT_EXPORT_CLOSED_TTL_SECONDS = 60 * 60
_REPORT_CHART_DPI = 130


class ReportDataUnavailableError(RuntimeError):
    """Raised when the operational source cannot build a trustworthy report."""


def _num(value: Any, default: float | None = 0.0) -> float | None:
    if value is None or value == '':
        return default
    try:
        return float(str(value).replace(',', '').strip())
    except (TypeError, ValueError):
        return default


def _parse_date(value: Any = None) -> date:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if value:
        try:
            return datetime.fromisoformat(str(value)[:10]).date()
        except ValueError:
            pass
    return datetime.now(LOCAL_ZONE).date()


def _period_dates(report_date: Any = None, start_date: Any = None, end_date: Any = None) -> tuple[date, date]:
    if report_date:
        selected = _parse_date(report_date)
        return selected, selected
    start = _parse_date(start_date or end_date)
    end = _parse_date(end_date or start_date or start)
    return (start, end) if start <= end else (end, start)


def _report_cache_ttl(period_end: date, *, export: bool = False) -> int:
    today = datetime.now(LOCAL_ZONE).date()
    if period_end >= today:
        return _REPORT_EXPORT_CURRENT_TTL_SECONDS if export else _REPORT_CURRENT_TTL_SECONDS
    return _REPORT_EXPORT_CLOSED_TTL_SECONDS if export else _REPORT_CLOSED_TTL_SECONDS


def _dataset_cache_key(period_start: date, period_end: date, include_history: bool, include_comparatives: bool) -> str:
    return '|'.join([
        'las-fuentes-report-v1',
        period_start.isoformat(),
        period_end.isoformat(),
        'history' if include_history else 'preview',
        'comparatives' if include_comparatives else 'no-comparatives',
    ])


def _dataset_cache_get(key: str) -> dict[str, Any] | None:
    item = _REPORT_DATASET_CACHE.get(key)
    if not item:
        return None
    if monotonic() >= float(item.get('expires_at') or 0):
        _REPORT_DATASET_CACHE.pop(key, None)
        return None
    return deepcopy(item['value'])


def _dataset_cache_set(key: str, value: dict[str, Any], ttl_seconds: int) -> dict[str, Any]:
    if len(_REPORT_DATASET_CACHE) >= 48 and key not in _REPORT_DATASET_CACHE:
        oldest = next(iter(_REPORT_DATASET_CACHE), None)
        if oldest:
            _REPORT_DATASET_CACHE.pop(oldest, None)
    _REPORT_DATASET_CACHE[key] = {
        'expires_at': monotonic() + max(1, int(ttl_seconds)),
        'value': deepcopy(value),
    }
    return value


def _export_cache_key(format_name: str, period_start: date, period_end: date) -> str:
    return f'las-fuentes-report-export-v1|{format_name}|{period_start.isoformat()}|{period_end.isoformat()}'


def _export_cache_get(key: str) -> tuple[bytes, str] | None:
    item = _REPORT_EXPORT_CACHE.get(key)
    if not item:
        return None
    if monotonic() >= float(item.get('expires_at') or 0):
        _REPORT_EXPORT_CACHE.pop(key, None)
        return None
    return bytes(item['content']), str(item['filename'])


def _invalidate_report_caches(period_start: date, period_end: date) -> None:
    start_token = period_start.isoformat()
    end_token = period_end.isoformat()
    for cache in (_REPORT_DATASET_CACHE, _REPORT_EXPORT_CACHE):
        for key in list(cache):
            if start_token in key and end_token in key:
                cache.pop(key, None)


def _export_cache_set(key: str, content: bytes, filename: str, ttl_seconds: int) -> tuple[bytes, str]:
    if len(_REPORT_EXPORT_CACHE) >= 24 and key not in _REPORT_EXPORT_CACHE:
        oldest = next(iter(_REPORT_EXPORT_CACHE), None)
        if oldest:
            _REPORT_EXPORT_CACHE.pop(oldest, None)
    _REPORT_EXPORT_CACHE[key] = {
        'expires_at': monotonic() + max(1, int(ttl_seconds)),
        'content': bytes(content),
        'filename': str(filename),
    }
    return content, filename


def _date_span(start: date, end: date) -> list[date]:
    days: list[date] = []
    current = start
    while current <= end:
        days.append(current)
        current += timedelta(days=1)
    return days


def _report_code(day: date) -> str:
    return f"RHI{day.strftime('%d%m%y')}"


def _period_value(item: dict[str, Any]) -> float | None:
    if str(item.get('period_status') or '').lower() != 'valid':
        return None
    return _num(item.get('period_m3'), None)


def _period_display(item: dict[str, Any]) -> Any:
    value = _period_value(item)
    if value is not None:
        return value
    status = str(item.get('period_status') or '').lower()
    if status == 'dato_en_revision':
        return 'Dato en revisión'
    return 'Sin datos'


def _validation_label(item: dict[str, Any]) -> str:
    daily = str(item.get('daily_validation') or '').strip()
    if daily:
        return daily
    status = str(item.get('period_status') or '').lower()
    if status == 'valid':
        return 'Válida'
    if status in {'dato_en_revision', 'partial', 'parcial', 'validacion_parcial'}:
        return 'Validación parcial'
    return 'No disponible'


def _activity_label(item: dict[str, Any]) -> str:
    daily = str(item.get('daily_activity') or '').strip()
    if daily:
        return daily
    if item.get('active') is True:
        return 'Con actividad'
    if item.get('active') is False:
        return 'Sin actividad'
    return str(item.get('status') or 'Sin datos')


def _communication_label(item: dict[str, Any]) -> str:
    return str(item.get('daily_communication') or item.get('estado_comunicacion') or item.get('communication') or 'Sin datos')


def _clean_period_note(item: dict[str, Any]) -> str:
    status = str(item.get('period_status') or '').lower()
    if status == 'valid':
        return 'Volumen calculado con lecturas válidas del periodo.'
    if status == 'dato_en_revision':
        return str(item.get('period_note') or 'Dato en revisión por comportamiento del totalizador.')
    return 'Volumen del periodo no disponible.'


def _latest_update(items: Iterable[dict[str, Any]]) -> str | None:
    candidates: list[datetime] = []
    for item in items:
        value = item.get('updated') or item.get('ultima_lectura') or item.get('last_update')
        if not value:
            continue
        try:
            parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
            if parsed.tzinfo is not None:
                parsed = parsed.astimezone(LOCAL_ZONE).replace(tzinfo=None)
            candidates.append(parsed)
        except (TypeError, ValueError):
            continue
    if not candidates:
        return None
    return max(candidates).isoformat(timespec='seconds')


def _communication_summary(items: list[dict[str, Any]]) -> str:
    statuses = [_communication_label(item).lower() for item in items]
    if not statuses:
        return 'Sin datos operativos'
    if any('sin comunicación' in status or 'revisar' in status for status in statuses):
        return 'Revisar comunicación'
    if any('atrasada' in status or 'no reciente' in status for status in statuses):
        return 'Lecturas por revisar'
    return 'Operación actualizada'


def _communication_count(items: list[dict[str, Any]]) -> int:
    return sum(1 for item in items if _communication_label(item).lower() not in {'sin datos', 'sin comunicación', 'revisar comunicación'})


def _row_common(item: dict[str, Any]) -> dict[str, Any]:
    active_minutes = _num(
        item.get('tiempo_activo_min') if item.get('tiempo_activo_min') is not None else item.get('active_minutes'),
        None,
    )
    starts = _num(
        item.get('encendidos_periodo') if item.get('encendidos_periodo') is not None else item.get('start_count'),
        None,
    )
    return {
        'id': str(item.get('id') or item.get('sensor_id') or item.get('name') or ''),
        'module_group': item.get('module_group'),
        'equipo': item.get('name') or item.get('nombre') or item.get('id') or 'Elemento',
        'flujo_lps': _num(item.get('flow_lps'), None),
        'totalizador_m3': _num(item.get('totalizador_m3'), None),
        'volumen_periodo_m3': _period_value(item),
        'volumen_display': _period_display(item),
        'volumen_estado': str(item.get('period_status') or 'sin_datos'),
        'volumen_nota': _clean_period_note(item),
        'actividad': _activity_label(item),
        'tiempo_activo_min': active_minutes,
        'active_minutes': active_minutes,
        'encendidos_periodo': int(round(starts)) if starts is not None else None,
        'start_count': int(round(starts)) if starts is not None else None,
        'validacion': _validation_label(item),
        'estado': item.get('status') or 'Sin datos operativos',
        'comunicacion': _communication_label(item),
        'ultima_actualizacion': item.get('updated') or item.get('ultima_lectura'),
    }


def _level_row(item: dict[str, Any]) -> dict[str, Any]:
    return {
        'id': str(item.get('id') or item.get('column') or item.get('name') or ''),
        'elemento': item.get('name') or item.get('id') or 'Nivel',
        'nivel_m': _num(item.get('level_m') if item.get('level_m') is not None else item.get('height_m'), None),
        'porcentaje': _num(item.get('percentage') if item.get('percentage') is not None else item.get('fill_pct'), None),
        'nivel_minimo_m': _num(item.get('minimum_m'), None),
        'nivel_maximo_m': _num(item.get('maximum_m'), None),
        'estado': item.get('status') or 'Sin datos operativos',
        'comunicacion': _communication_label(item),
        'validacion': _validation_label(item),
        'ultima_actualizacion': item.get('updated') or item.get('ultima_lectura'),
    }


def _uv_row(item: dict[str, Any]) -> dict[str, Any]:
    return {
        'id': str(item.get('id') or item.get('state_field') or item.get('name') or ''),
        'scada_id': item.get('scada_id') or 'TRATAMIENTO',
        'equipo': item.get('name') or item.get('id') or 'Lámpara UV',
        'agel': _num(item.get('agel'), None),
        'uvt': _num(item.get('uvt'), None),
        'power': _num(item.get('power'), None),
        'flow': _num(item.get('flow'), None),
        'dose': _num(item.get('dose'), None),
        'ignition': _num(item.get('ignition') if item.get('ignition') is not None else item.get('state_code'), None),
        'estado_operativo': item.get('state') or item.get('status') or 'Sin lectura',
        'status': _num(item.get('status_reading'), None),
        'comunicacion': _communication_label(item),
        'validacion': 'Válida' if item.get('state') or item.get('status_reading') is not None else 'No disponible',
        'ultima_actualizacion': item.get('updated') or item.get('ultima_lectura'),
    }


def _review_for(
    start: date,
    end: date,
    *,
    include_history: bool = False,
    include_comparisons: bool = True,
) -> dict[str, Any]:
    return get_insurgentes_review_period(
        start_date=start,
        end_date=end,
        include_history=include_history,
        include_comparisons=include_comparisons,
        include_shifts=True,
    )


def _safe_review_for(
    start: date,
    end: date,
    *,
    include_history: bool = False,
    include_comparisons: bool = False,
) -> dict[str, Any] | None:
    try:
        review = get_insurgentes_review_period(
            start_date=start,
            end_date=end,
            include_history=include_history,
            include_comparisons=include_comparisons,
            include_shifts=False,
        )
        payload = review.get('dashboard') or {}
        if payload.get('__sql_error__') or str(payload.get('source_status') or '').lower() == 'error_sql':
            return None
        return review
    except Exception:
        return None


def _extract_module_items(payload: dict[str, Any], module: str) -> list[dict[str, Any]]:
    if module == 'entrada':
        entry = payload.get('water_entry') or {}
        return [dict(entry)] if entry else []
    if module == 'pozos':
        return [dict(item) for item in (payload.get('wells') or payload.get('pozos') or [])]
    if module == 'lineas':
        return [dict(item) for item in (payload.get('production_lines') or [])]
    if module == 'flujos':
        return [dict(item) for item in (payload.get('distribution_flows') or payload.get('flows') or [])]
    if module in {'tam', 'embotellado', 'cisterna'}:
        return [
            dict(item) for item in (payload.get('distribution_flows') or payload.get('flows') or [])
            if str(item.get('module_group') or '') == module
        ]
    if module == 'niveles':
        return [dict(item) for item in (payload.get('tank_inputs') or [])]
    if module == 'uv':
        return [dict(item) for item in (payload.get('uv_lamps') or [])]
    return []


def _comparison_value(item: dict[str, Any], module: str) -> Any:
    if module in {'entrada', 'pozos', 'lineas', 'flujos', 'tam', 'embotellado', 'cisterna'}:
        return _period_display(item)
    if module == 'niveles':
        return _num(item.get('level_m') if item.get('level_m') is not None else item.get('height_m'), None)
    if module == 'uv':
        return item.get('state') or item.get('status') or 'Sin datos'
    return None


def _id_of_item(item: dict[str, Any]) -> str:
    return str(item.get('id') or item.get('sensor_id') or item.get('column') or item.get('state_field') or item.get('name') or '')


def _name_of_item(item: dict[str, Any]) -> str:
    return str(item.get('name') or item.get('nombre') or item.get('id') or 'Elemento')


def _explicit_date_label(value: date) -> str:
    return value.strftime('%d/%m/%Y')


def _explicit_range_label(start: date, end: date) -> str:
    if start == end:
        return _explicit_date_label(start)
    return f'{_explicit_date_label(start)} → {_explicit_date_label(end)}'


def _comparison_period_contract(period_start: date, period_end: date) -> dict[str, Any]:
    week_start = period_end - timedelta(days=period_end.weekday())
    ranges = {
        'seleccionado': (period_start, period_end),
        'ayer': (period_start - timedelta(days=1), period_end - timedelta(days=1)),
        'semana_anterior': (period_start - timedelta(days=7), period_end - timedelta(days=7)),
        'esta_semana': (week_start, period_end),
    }
    titles = {'seleccionado': 'Seleccionado', 'ayer': 'Anterior', 'semana_anterior': 'Semana anterior', 'esta_semana': 'Esta semana'}
    return {
        'headers': {key: f"{titles[key]} · {_explicit_range_label(start, end)}" for key, (start, end) in ranges.items()},
        'periods': {key: {'start_date': start.isoformat(), 'end_date': end.isoformat(), 'label': _explicit_range_label(start, end)} for key, (start, end) in ranges.items()},
    }


def _historical_period_contract(period_start: date, period_end: date) -> dict[str, Any]:
    ranges = {
        'semana_pasada': (period_start - timedelta(days=7), period_end - timedelta(days=7)),
        'hace_dos_semanas': (period_start - timedelta(days=14), period_end - timedelta(days=14)),
        'un_mes_antes': (period_start - timedelta(days=30), period_end - timedelta(days=30)),
        'dos_meses_antes': (period_start - timedelta(days=60), period_end - timedelta(days=60)),
        'tres_meses_antes': (period_start - timedelta(days=90), period_end - timedelta(days=90)),
    }
    titles = {'semana_pasada': 'Semana pasada', 'hace_dos_semanas': 'Hace dos semanas', 'un_mes_antes': 'Un mes antes', 'dos_meses_antes': 'Dos meses antes', 'tres_meses_antes': 'Tres meses antes'}
    return {
        'headers': {key: f"{titles[key]} · {_explicit_range_label(start, end)}" for key, (start, end) in ranges.items()},
        'periods': {key: {'start_date': start.isoformat(), 'end_date': end.isoformat(), 'label': _explicit_range_label(start, end)} for key, (start, end) in ranges.items()},
    }


def _build_comparison_rows(review: dict[str, Any], period_end: date) -> list[dict[str, Any]]:
    current = review.get('dashboard') or {}
    comparisons = review.get('comparisons') or {}
    week_start = period_end - timedelta(days=period_end.weekday())
    week_review = _safe_review_for(week_start, period_end, include_history=False, include_comparisons=False)
    payloads = {
        'seleccionado': current,
        'ayer': (comparisons.get('previous_day') or {}).get('dashboard') or {},
        'semana_anterior': (comparisons.get('previous_week') or {}).get('dashboard') or {},
        'esta_semana': (week_review or {}).get('dashboard') or {},
    }
    rows: list[dict[str, Any]] = []
    for module, label in [('pozos', 'Pozos'), ('tam', 'TAM'), ('embotellado', 'Embotellado'), ('cisterna', 'Cisterna')]:
        base_items = _extract_module_items(current, module)
        for item in base_items:
            item_id = _id_of_item(item)
            row = {'module': label, 'elemento': _name_of_item(item)}
            for key, payload in payloads.items():
                match = None
                for candidate in _extract_module_items(payload, module):
                    if _id_of_item(candidate) == item_id:
                        match = candidate
                        break
                row[key] = _comparison_value(match or {}, module) if match else 'Sin datos'
            # Compatibilidad con consumidores heredados que aún esperan `hoy`.
            row['hoy'] = row['seleccionado']
            rows.append(row)
    return rows


def _build_historical_rows(period_start: date, period_end: date, current_dashboard: dict[str, Any], review: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    # Los comparativos ampliados siguen disponibles, pero todos pasan por el
    # contrato común de Revisión diaria en vez de consultar el dashboard desde
    # el servicio de Reportes.
    ranges = {
        'semana_pasada': (period_start - timedelta(days=7), period_end - timedelta(days=7)),
        'hace_dos_semanas': (period_start - timedelta(days=14), period_end - timedelta(days=14)),
        'un_mes_antes': (period_start - timedelta(days=30), period_end - timedelta(days=30)),
        'dos_meses_antes': (period_start - timedelta(days=60), period_end - timedelta(days=60)),
        'tres_meses_antes': (period_start - timedelta(days=90), period_end - timedelta(days=90)),
    }
    payloads: dict[str, dict[str, Any]] = {}
    previous_week_payload = (((review or {}).get('comparisons') or {}).get('previous_week') or {}).get('dashboard') or {}
    if previous_week_payload:
        payloads['semana_pasada'] = previous_week_payload
    for key, (start, end) in ranges.items():
        if key in payloads:
            continue
        historical_review = _safe_review_for(start, end, include_history=False, include_comparisons=False)
        payloads[key] = (historical_review or {}).get('dashboard') or {}

    rows: list[dict[str, Any]] = []
    for module, label in [('pozos', 'Pozos'), ('tam', 'TAM'), ('embotellado', 'Embotellado'), ('cisterna', 'Cisterna')]:
        for item in _extract_module_items(current_dashboard, module):
            item_id = _id_of_item(item)
            row = {'module': label, 'elemento': _name_of_item(item)}
            for key, payload in payloads.items():
                match = None
                for candidate in _extract_module_items(payload, module):
                    if _id_of_item(candidate) == item_id:
                        match = candidate
                        break
                row[key] = _comparison_value(match or {}, module) if match else 'Sin datos'
            rows.append(row)
    return rows


def _shift_summary_for_report(review: dict[str, Any]) -> dict[str, Any]:
    shifts = review.get('shifts') or {}
    rows = []
    for shift in shifts.get('shifts') or []:
        row = {
            'turno': shift.get('label'),
            'horario': shift.get('schedule'),
            'estado': shift.get('status_label'),
            'status': shift.get('status'),
        }
        for module_payload in shift.get('modules') or []:
            module = module_payload.get('module')
            summary = module_payload.get('summary') or {}
            row[module] = summary.get('volume_m3') if summary.get('type') == 'volume' else None
            row[f'{module}_actividad'] = summary.get('active_count')
            row[f'{module}_total'] = summary.get('total_count')
            if module == 'flujos':
                flow_items = [dict(item) for item in (module_payload.get('items') or []) if isinstance(item, dict)]
                for group_key in ('tam', 'embotellado', 'cisterna'):
                    values = [
                        _num(item.get('volume_m3'), None) for item in flow_items
                        if str(item.get('module_group') or '') == group_key
                    ]
                    valid = [value for value in values if value is not None]
                    row[group_key] = round(sum(valid), 4) if valid else None
        rows.append(row)
    return {**shifts, 'rows': rows}


def _history_points(rows: list[dict[str, Any]], value_keys: list[str], limit_per_series: int = 120) -> list[dict[str, Any]]:
    """Normalize report chart points without starving later series.

    Historical rows arrive grouped by element. The previous global ``rows[:80]``
    could keep complete data for the first sensors while truncating or entirely
    dropping the last ones. Downsample each element independently so every
    visible series preserves its first/last point and temporal shape.
    """

    def identity(row: dict[str, Any]) -> str:
        return str(
            row.get('id')
            or row.get('sensor_id')
            or row.get('column')
            or row.get('state_field')
            or row.get('name')
            or row.get('nombre')
            or 'Elemento'
        )

    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    order: list[str] = []
    for row in rows or []:
        key = identity(row)
        if key not in grouped:
            order.append(key)
        grouped[key].append(row)

    def evenly_sample(values: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if limit_per_series <= 0 or len(values) <= limit_per_series:
            return values
        if limit_per_series == 1:
            return [values[-1]]
        last = len(values) - 1
        indexes = [round(index * last / (limit_per_series - 1)) for index in range(limit_per_series)]
        # El redondeo puede repetir un indice en listas pequenas; preservar orden.
        seen: set[int] = set()
        unique_indexes: list[int] = []
        for index in indexes:
            if index not in seen:
                seen.add(index)
                unique_indexes.append(index)
        return [values[index] for index in unique_indexes]

    points: list[dict[str, Any]] = []
    for key in order:
        series_rows = sorted(
            grouped[key],
            key=lambda row: str(row.get('timestamp') or row.get('bucket') or ''),
        )
        for row in evenly_sample(series_rows):
            point = {
                'timestamp': row.get('timestamp') or row.get('bucket'),
                'name': row.get('name') or row.get('nombre') or row.get('id'),
                'id': identity(row),
            }
            for value_key in value_keys:
                point[value_key] = _num(row.get(value_key), None)
            points.append(point)
    return points


def build_report_dataset(report_date: Any = None, start_date: Any = None, end_date: Any = None, *, include_history: bool = False, include_comparatives: bool = True, force_refresh: bool = False) -> dict[str, Any]:
    period_start, period_end = _period_dates(report_date, start_date, end_date)
    cache_key = _dataset_cache_key(period_start, period_end, include_history, include_comparatives)
    if force_refresh:
        _invalidate_report_caches(period_start, period_end)
    else:
        cached = _dataset_cache_get(cache_key)
        if cached is not None:
            return cached

    review = _review_for(
        period_start,
        period_end,
        include_history=include_history,
        include_comparisons=include_comparatives,
    )
    payload = review.get('dashboard') or {}

    if payload.get('__sql_error__') or str(payload.get('source_status') or '').lower() == 'error_sql':
        raise ReportDataUnavailableError('No fue posible consultar la información operativa para generar el reporte.')

    entry = dict(payload.get('water_entry') or {})
    wells = [dict(item) for item in (payload.get('wells') or payload.get('pozos') or [])]
    lines = [dict(item) for item in (payload.get('production_lines') or [])]
    flows = [dict(item) for item in (payload.get('distribution_flows') or payload.get('flows') or [])]
    levels = [dict(item) for item in (payload.get('tank_inputs') or [])]
    uv_lamps = [dict(item) for item in (payload.get('uv_lamps') or [])]
    uv_summary = dict(payload.get('uv_summary') or {})

    if not entry:
        raise ReportDataUnavailableError('La llegada principal no tiene información operativa disponible.')

    entry_row = _row_common(entry)
    well_rows = [_row_common(item) for item in wells]
    line_rows = [_row_common(item) for item in lines]
    flow_rows = [_row_common(item) for item in flows]
    tam_rows = [row for row in flow_rows if str(row.get('module_group') or '') == 'tam']
    bottling_rows = [row for row in flow_rows if str(row.get('module_group') or '') == 'embotellado']
    cistern_rows = [row for row in flow_rows if str(row.get('module_group') or '') == 'cisterna']
    level_rows = [_level_row(item) for item in levels]
    lamp_rows = [_uv_row(item) for item in uv_lamps]

    all_items = [entry, *wells, *lines, *flows, *levels, *uv_lamps]
    active_wells = sum(1 for item in wells if bool(item.get('active')))
    active_lines = sum(1 for item in lines if bool(item.get('active')))
    active_flows = sum(1 for item in flows if bool(item.get('active')))
    normal_levels = sum(1 for item in levels if str(item.get('status') or '').lower() == 'normal')
    uv_on = sum(1 for item in uv_lamps if int(_num(item.get('state_code'), -1) or -1) == 2)
    validation_partial = sum(1 for item in [entry, *wells, *lines, *flows] if _validation_label(item) in {'Validación parcial', 'Cobertura parcial', 'Dato en revisión', 'Sin datos'})
    review_modules = {str(item.get('module')): item for item in (review.get('modules') or []) if isinstance(item, dict)}
    hydraulic_summaries = [review_modules.get(key) or {} for key in ('entrada', 'pozos', 'lineas', 'flujos')]
    hydraulic_summaries = [item for item in hydraulic_summaries if int(item.get('monitored') or 0) > 0]
    if hydraulic_summaries and all(bool(item.get('coverage_complete')) for item in hydraulic_summaries):
        period_quality = 'Validado'
    elif any(item.get('validated_subtotal_m3') is not None for item in hydraulic_summaries):
        period_quality = 'Subtotal validado'
    else:
        period_quality = 'Sin volumen validado'

    period_label = period_start.isoformat() if period_start == period_end else f'{period_start.isoformat()} a {period_end.isoformat()}'
    generated_at = datetime.now(LOCAL_ZONE).isoformat(timespec='seconds')
    includes_today = period_start <= datetime.now(LOCAL_ZONE).date() <= period_end

    dataset = {
        'title': 'Reporte Diario de Control Hídrico Las Fuentes',
        'plant': f'Planta {PLANT_NAME}',
        'plant_display': 'PLANTA LAS FUENTES',
        'report_code': _report_code(period_end),
        'date': period_end.isoformat(),
        'start_date': period_start.isoformat(),
        'end_date': period_end.isoformat(),
        'period_label': period_label,
        'generated_at': generated_at,
        'is_partial': includes_today,
        'source_status': review.get('source_status') or payload.get('source_status') or 'sin_datos',
        'source_contract': 'revision_diaria_comun',
        'interval_contract': review.get('interval_contract') or '[T0,T1)',
        'opening_rule': review.get('opening_rule') or 'last_valid_reading_before_t0',
        'summary': {
            'volumen_recibido_m3': entry_row['volumen_periodo_m3'],
            'flujo_actual_lps': entry_row['flujo_lps'],
            'volumen_pozos_m3': round(sum(float(row['volumen_periodo_m3']) for row in well_rows if row.get('volumen_periodo_m3') is not None), 4),
            'pozos_activos': active_wells,
            'pozos_total': len(wells),
            'volumen_lineas_m3': round(sum(float(row['volumen_periodo_m3']) for row in line_rows if row.get('volumen_periodo_m3') is not None), 4),
            'volumen_flujos_m3': round(sum(float(row['volumen_periodo_m3']) for row in flow_rows if row.get('volumen_periodo_m3') is not None), 4),
            'volumen_tam_m3': round(sum(float(row['volumen_periodo_m3']) for row in tam_rows if row.get('volumen_periodo_m3') is not None), 4),
            'volumen_embotellado_m3': round(sum(float(row['volumen_periodo_m3']) for row in bottling_rows if row.get('volumen_periodo_m3') is not None), 4),
            'volumen_cisterna_m3': round(sum(float(row['volumen_periodo_m3']) for row in cistern_rows if row.get('volumen_periodo_m3') is not None), 4),
            'tam_total': len(tam_rows),
            'embotellado_total': len(bottling_rows),
            'cisterna_total': len(cistern_rows),
            'lineas_activas': active_lines,
            'lineas_total': len(lines),
            'flujos_activos': active_flows,
            'flujos_total': len(flows),
            'niveles_actualizados': normal_levels,
            'niveles_total': len(levels),
            'lamparas_uv_encendidas': uv_on,
            'lamparas_uv_total': len(uv_lamps),
            'comunicacion_actualizada': _communication_count(all_items),
            'comunicacion_total': len(all_items),
            'validacion_parcial': validation_partial,
            'calidad_periodo': period_quality,
            'estado_comunicacion': _communication_summary(all_items),
            'ultima_actualizacion': _latest_update(all_items),
        },
        'water_entry': {'title': 'Pozos Corporativos', 'rows': [entry_row]},
        'wells': {'title': 'Pozos', 'rows': well_rows},
        'lines': {'title': 'Líneas', 'rows': line_rows},
        'flows': {'title': 'Medidores de agua', 'rows': flow_rows},
        'flow_groups': {
            'tam': {'title': 'Medidores de TAM', 'rows': tam_rows},
            'embotellado': {'title': 'Medidores de embotellado', 'rows': bottling_rows},
            'cisterna': {'title': 'Medidor de cisterna', 'rows': cistern_rows},
        },
        'levels': {'title': 'Niveles', 'rows': level_rows},
        'uv': {
            'title': 'Lámparas UV',
            'rows': lamp_rows,
            'summary': {
                'uvt': _num(uv_summary.get('uvt'), None),
                'potencia': _num(uv_summary.get('power'), None),
                'flujo': _num(uv_summary.get('flow'), None),
                'dosis': _num(uv_summary.get('dose'), None),
                'comunicacion': uv_summary.get('estado_comunicacion') or 'Sin datos operativos',
                'ultima_actualizacion': uv_summary.get('updated'),
            },
            'system_rows': [
                {'parametro': 'UVT', 'valor': _num(uv_summary.get('uvt'), None), 'unidad': '%'},
                {'parametro': 'Potencia', 'valor': _num(uv_summary.get('power'), None), 'unidad': '%'},
                {'parametro': 'Flujo', 'valor': _num(uv_summary.get('flow'), None), 'unidad': 'm³/h'},
                {'parametro': 'Dosis', 'valor': _num(uv_summary.get('dose'), None), 'unidad': 'mJ/cm²'},
            ],
        },
        'shifts': _shift_summary_for_report(review),
        'comparative': {'rows': _build_comparison_rows(review, period_end) if include_comparatives else [], **_comparison_period_contract(period_start, period_end)},
        'historical_comparative': {'rows': _build_historical_rows(period_start, period_end, payload, review) if include_comparatives else [], **_historical_period_contract(period_start, period_end)},
        'charts': {
            'entry': _history_points(payload.get('entry_flow_history') or [], ['flow_lps', 'totalizador_m3']) if include_history else [],
            'wells': _history_points(payload.get('well_flow_history') or [], ['flow_lps', 'totalizador_m3']) if include_history else [],
            'lines': _history_points(payload.get('production_line_history') or [], ['flow_lps', 'totalizador_m3']) if include_history else [],
            'flows': _history_points(payload.get('flow_history') or [], ['flow_lps', 'totalizador_m3']) if include_history else [],
            'levels': _history_points(payload.get('tank_level_history') or [], ['level_m']) if include_history else [],
            'uv': _history_points(payload.get('uv_history') or [], ['lamp_1_state', 'lamp_2_state', 'uvt', 'power', 'flow', 'dose']) if include_history else [],
        },
        'notes': [
        ],
    }
    return _dataset_cache_set(cache_key, dataset, _report_cache_ttl(period_end))



def _interval_volume_source(item: dict[str, Any]) -> dict[str, Any]:
    reliable = bool(item.get('volume_reliable'))
    quality = str(item.get('quality_status') or '')
    if reliable:
        period_status = 'valid'
    elif quality in {'review', 'partial'}:
        period_status = 'dato_en_revision'
    else:
        period_status = 'sin_datos'
    avg_flow = _num(item.get('avg_flow'), None)
    closing = _num(item.get('closing_m3'), None)
    active = str(item.get('activity') or '').lower() == 'con actividad'
    return {
        'id': item.get('id'),
        'name': item.get('name'),
        'flow_lps': avg_flow,
        'totalizador_m3': closing,
        'period_m3': _num(item.get('volume_m3'), None),
        'period_status': period_status,
        'period_note': item.get('review_reason') or item.get('volume_note') or '',
        'active': active,
        'daily_activity': item.get('activity') or 'Sin datos',
        'daily_validation': item.get('quality_label') or item.get('validation') or 'No disponible',
        'daily_communication': item.get('communication') or 'Sin información',
        'status': 'En operación' if active else ('Detenido' if item.get('has_data') else 'Sin datos'),
        'updated': item.get('updated'),
        'quality_status': quality,
        'opening_source': item.get('opening_source'),
        'boundary_complete': bool(item.get('boundary_complete')),
        'volume_reliable': reliable,
    }


def build_interval_water_report_dataset(start_datetime: Any, end_datetime: Any) -> dict[str, Any]:
    """Build a real 12 h/closed-window report using the common reconciler.

    The returned shape intentionally matches the regular daily report so the
    existing PDF and Excel renderers are reused without a second document
    implementation.
    """
    start = datetime.fromisoformat(str(start_datetime)) if not isinstance(start_datetime, datetime) else start_datetime
    end = datetime.fromisoformat(str(end_datetime)) if not isinstance(end_datetime, datetime) else end_datetime
    if start.tzinfo is not None:
        start = start.astimezone(LOCAL_ZONE).replace(tzinfo=None)
    if end.tzinfo is not None:
        end = end.astimezone(LOCAL_ZONE).replace(tzinfo=None)
    if end <= start:
        raise ValueError('El periodo programado no es válido.')

    cut = get_insurgentes_interval_cut(start, end, module='all')
    modules = {str(item.get('module')): item for item in cut.get('modules') or [] if isinstance(item, dict)}

    def volume_rows(module: str) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for item in (modules.get(module) or {}).get('items') or []:
            source = _interval_volume_source(item)
            # Agua Recuperada/Tratada usa m³/h en su contrato físico. El
            # layout heredado llama a esta columna flujo_lps; no publicar una
            # unidad falsa dentro del reporte programado.
            if module == 'flujos':
                source['flow_lps'] = None
            rows.append(_row_common(source))
        return rows

    entry_rows = volume_rows('entrada')
    if not entry_rows:
        raise ReportDataUnavailableError('La llegada principal no tiene información operativa disponible para el bloque programado.')
    well_rows = volume_rows('pozos')
    line_rows = volume_rows('lineas')
    flow_rows = volume_rows('flujos')

    level_rows = []
    for item in (modules.get('niveles') or {}).get('items') or []:
        level_rows.append({
            'id': str(item.get('id') or ''),
            'elemento': item.get('name') or item.get('id') or 'Nivel',
            'nivel_m': _num(item.get('final_level_m') if item.get('final_level_m') is not None else item.get('avg_level_m'), None),
            'porcentaje': None,
            'nivel_minimo_m': _num(item.get('min_level_m'), None),
            'nivel_maximo_m': _num(item.get('max_level_m'), None),
            'estado': item.get('activity') or 'Sin datos',
            'comunicacion': item.get('communication') or 'Sin información',
            'validacion': item.get('validation') or 'No disponible',
            'ultima_actualizacion': None,
        })

    uv_rows = []
    for item in (modules.get('uv') or {}).get('items') or []:
        final_state = item.get('final_state')
        uv_rows.append({
            'id': str(item.get('id') or ''),
            'equipo': item.get('name') or item.get('id') or 'Lámpara UV',
            'estado_operativo': 'Encendida' if final_state == 2 else ('Sin encendido' if item.get('has_data') else 'Sin lectura'),
            'agel': _num(item.get('avg_agel'), None),
            'status': _num(item.get('avg_status_reading'), None),
            'comunicacion': item.get('communication') or 'Sin información',
            'validacion': item.get('validation') or 'No disponible',
            'ultima_actualizacion': None,
        })
    uv_system = (modules.get('uv') or {}).get('system_summary') or {}

    hydraulic_modules = [modules.get(key) or {} for key in ('entrada', 'pozos', 'lineas', 'flujos')]
    hydraulic_summaries = [item.get('summary') or {} for item in hydraulic_modules if item]
    any_reliable = any(
        any(bool(value.get('volume_reliable')) for value in (module.get('items') or []))
        for module in hydraulic_modules if module
    )
    all_reliable = bool(hydraulic_modules) and all(
        all(bool(value.get('volume_reliable')) for value in (module.get('items') or []))
        for module in hydraulic_modules if module and (module.get('items') or [])
    )
    period_quality = 'Validado' if all_reliable else ('Subtotal validado' if any_reliable else 'Sin volumen validado')

    def total(rows: list[dict[str, Any]]) -> float:
        return round(sum(float(row['volumen_periodo_m3']) for row in rows if row.get('volumen_periodo_m3') is not None), 4)

    def active_count(rows: list[dict[str, Any]]) -> int:
        return sum(1 for row in rows if str(row.get('actividad') or '').lower() == 'con actividad')

    period_label = f"{start.strftime('%Y-%m-%d %H:%M')}–{end.strftime('%Y-%m-%d %H:%M')}"
    entry = entry_rows[0]
    dataset = {
        'title': 'Reporte Programado de Control Hídrico Las Fuentes',
        'plant': f'Planta {PLANT_NAME}',
        'plant_display': 'PLANTA LAS FUENTES',
        'report_code': f"RHI{end.strftime('%d%m%y%H%M')}",
        'date': end.date().isoformat(),
        'start_date': start.date().isoformat(),
        'end_date': end.date().isoformat(),
        'period_label': period_label,
        'file_suffix': f"{start.strftime('%Y-%m-%d-%H%M')}-a-{end.strftime('%Y-%m-%d-%H%M')}",
        'generated_at': datetime.now(LOCAL_ZONE).isoformat(timespec='seconds'),
        'is_partial': False,
        'source_status': 'operational',
        'source_contract': 'intervalo_conciliado_comun',
        'interval_contract': cut.get('interval_contract') or '[T0,T1)',
        'opening_rule': cut.get('opening_rule') or 'last_valid_reading_before_t0',
        'summary': {
            'volumen_recibido_m3': entry.get('volumen_periodo_m3'),
            'flujo_actual_lps': entry.get('flujo_lps'),
            'volumen_pozos_m3': total(well_rows),
            'pozos_activos': active_count(well_rows),
            'pozos_total': len(well_rows),
            'volumen_lineas_m3': total(line_rows),
            'volumen_flujos_m3': total(flow_rows),
            'volumen_tam_m3': total(tam_rows),
            'volumen_embotellado_m3': total(bottling_rows),
            'volumen_cisterna_m3': total(cistern_rows),
            'tam_total': len(tam_rows),
            'embotellado_total': len(bottling_rows),
            'cisterna_total': len(cistern_rows),
            'lineas_activas': active_count(line_rows),
            'lineas_total': len(line_rows),
            'flujos_activos': active_count(flow_rows),
            'flujos_total': len(flow_rows),
            'niveles_actualizados': sum(1 for row in level_rows if row.get('nivel_m') is not None),
            'niveles_total': len(level_rows),
            'lamparas_uv_encendidas': sum(1 for row in uv_rows if row.get('estado_operativo') == 'Encendida'),
            'lamparas_uv_total': len(uv_rows),
            'comunicacion_actualizada': sum(1 for row in [entry, *well_rows, *line_rows, *flow_rows] if str(row.get('comunicacion') or '').lower() == 'actualizado'),
            'comunicacion_total': len([entry, *well_rows, *line_rows, *flow_rows]),
            'validacion_parcial': sum(1 for row in [entry, *well_rows, *line_rows, *flow_rows] if str(row.get('validacion') or '').lower() not in {'validado', 'válida', 'valida'}),
            'calidad_periodo': period_quality,
            'estado_comunicacion': 'Operación actualizada',
            'ultima_actualizacion': cut.get('updated_at'),
        },
        'water_entry': {'title': 'Pozos Corporativos', 'rows': entry_rows},
        'wells': {'title': 'Pozos', 'rows': well_rows},
        'lines': {'title': 'Líneas', 'rows': line_rows},
        'flows': {'title': 'Medidores de agua', 'rows': flow_rows},
        'flow_groups': {
            'tam': {'title': 'Medidores de TAM', 'rows': tam_rows},
            'embotellado': {'title': 'Medidores de embotellado', 'rows': bottling_rows},
            'cisterna': {'title': 'Medidor de cisterna', 'rows': cistern_rows},
        },
        'levels': {'title': 'Niveles', 'rows': level_rows},
        'uv': {
            'title': 'Lámparas UV',
            'rows': uv_rows,
            'summary': {
                'uvt': _num(uv_system.get('avg_uvt'), None),
                'potencia': _num(uv_system.get('avg_power'), None),
                'flujo': _num(uv_system.get('avg_flow'), None),
                'dosis': _num(uv_system.get('avg_dose'), None),
                'comunicacion': uv_system.get('communication') or 'Sin datos operativos',
                'ultima_actualizacion': cut.get('updated_at'),
            },
            'system_rows': [
                {'parametro': 'UVT', 'valor': _num(uv_system.get('avg_uvt'), None), 'unidad': '%'},
                {'parametro': 'Potencia', 'valor': _num(uv_system.get('avg_power'), None), 'unidad': '%'},
                {'parametro': 'Flujo', 'valor': _num(uv_system.get('avg_flow'), None), 'unidad': 'm³/h'},
                {'parametro': 'Dosis', 'valor': _num(uv_system.get('avg_dose'), None), 'unidad': 'mJ/cm²'},
            ],
        },
        'shifts': {
            'rows': [{
                'turno': 'Bloque 12 h',
                'horario': f"{start.strftime('%H:%M')}–{end.strftime('%H:%M')}",
                'entrada': entry.get('volumen_periodo_m3'),
                'pozos': total(well_rows),
                'lineas': total(line_rows),
                'flujos': total(flow_rows),
                'estado': 'Cierre definitivo',
            }]
        },
        'comparative': {'rows': []},
        'historical_comparative': {'rows': []},
        'charts': {'entry': [], 'wells': [], 'lines': [], 'flows': [], 'levels': [], 'uv': []},
        'notes': [
            'Reporte programado de bloque fijo de 12 horas con fronteras [T0,T1).',
            'La apertura usa la última lectura válida anterior a T0 y no cuenta como muestra del periodo.',
            'Datos parciales se envían conservando su etiqueta de calidad; no se convierten en cero.',
        ],
    }
    return dataset

def build_cached_daily_water_report_export(
    format_name: str,
    report_date: Any = None,
    start_date: Any = None,
    end_date: Any = None,
) -> tuple[bytes, str]:
    normalized = str(format_name or '').strip().lower()
    if normalized not in {'pdf', 'excel', 'html'}:
        raise ValueError('Formato de reporte no soportado.')
    period_start, period_end = _period_dates(report_date, start_date, end_date)
    cache_key = _export_cache_key(normalized, period_start, period_end)
    cached = _export_cache_get(cache_key)
    if cached is not None:
        return cached

    # Sólo PDF necesita las series históricas para dibujar gráficas. Excel y
    # HTML usan tablas/resúmenes y evitan esa consulta pesada.
    report = build_report_dataset(
        report_date=report_date,
        start_date=start_date,
        end_date=end_date,
        include_history=(normalized == 'pdf'),
        include_comparatives=True,
    )
    if normalized == 'pdf':
        content, filename = build_daily_water_report_pdf(report)
    elif normalized == 'excel':
        content, filename = build_daily_water_report_excel(report)
    else:
        content, filename = build_daily_water_report_html(report)
    return _export_cache_set(cache_key, content, filename, _report_cache_ttl(period_end, export=True))


def get_daily_water_report(report_date: Any = None, start_date: Any = None, end_date: Any = None, *, force_refresh: bool = False) -> dict[str, Any]:
    return build_report_dataset(
        report_date,
        start_date,
        end_date,
        include_history=False,
        include_comparatives=False,
        force_refresh=force_refresh,
    )


# ---------------------------------------------------------------------------
# PDF institucional
# ---------------------------------------------------------------------------

def _pdf_text(value: Any, default: str = '—') -> str:
    if value is None or value == '':
        return default
    text = str(value)
    for token in ('dbo.', 'SensorsBOS_', 'sensor_id', 'Modbus', 'readings_minute', 'SQL', 'BOS', 'BD'):
        text = text.replace(token, '')
    return ' '.join(text.split()) or default


def _fmt_num(value: Any, decimals: int = 2, suffix: str = '') -> str:
    number = _num(value, None)
    if number is None:
        return '—'
    return f'{number:,.{decimals}f}{suffix}'


def _fmt_any(value: Any, suffix: str = '', decimals: int = 2) -> str:
    number = _num(value, None)
    if isinstance(value, (int, float)) or (number is not None and str(value).strip().replace('.', '', 1).replace('-', '', 1).isdigit()):
        return _fmt_num(value, decimals, suffix)
    return _pdf_text(value)


def _fmt_minutes(value: Any) -> str:
    minutes = _num(value, None)
    if minutes is None:
        return '—'
    minutes = max(int(round(minutes)), 0)
    if minutes < 60:
        return f'{minutes} min'
    hours, remainder = divmod(minutes, 60)
    return f'{hours} h {remainder} min' if remainder else f'{hours} h'


def _fmt_activity_metrics(row: dict[str, Any]) -> str:
    active = _fmt_minutes(row.get('tiempo_activo_min') if row.get('tiempo_activo_min') is not None else row.get('active_minutes'))
    starts = _num(row.get('encendidos_periodo') if row.get('encendidos_periodo') is not None else row.get('start_count'), None)
    if starts is None:
        return active
    return f'{active} · {max(int(round(starts)), 0)} enc.'


def _file_base(report: dict[str, Any]) -> str:
    explicit_suffix = str(report.get('file_suffix') or '').strip()
    if explicit_suffix:
        return f'reporte-control-hidrico-las-fuentes-{explicit_suffix}'
    start = str(report.get('start_date') or report.get('date') or datetime.now(LOCAL_ZONE).date().isoformat())[:10]
    end = str(report.get('end_date') or report.get('date') or start)[:10]
    date_part = start if start == end else f'{start}-a-{end}'
    return f'reporte-diario-control-hidrico-las-fuentes-{date_part}'


def _pdf_filename(report: dict[str, Any]) -> str:
    return f'{_file_base(report)}.pdf'


def _excel_filename(report: dict[str, Any]) -> str:
    return f'{_file_base(report)}.xlsx'


def _html_filename(report: dict[str, Any]) -> str:
    return f'{_file_base(report)}.html'


def _logo_path() -> str | None:
    candidates = [
        Path(__file__).resolve().parents[3] / 'frontend' / 'src' / 'assets' / 'arca-continental-logo.png',
        Path(__file__).resolve().parents[4] / 'frontend' / 'src' / 'assets' / 'arca-continental-logo.png',
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return None


def _pdf_table(rows: list[list[Any]], widths: list[float] | None = None):
    from reportlab.lib import colors
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import Paragraph, Table, TableStyle

    header_style = ParagraphStyle('ReportTableHeader', fontName='Helvetica-Bold', fontSize=6.4, leading=7.6, textColor=colors.HexColor('#334155'))
    body_style = ParagraphStyle('ReportTableBody', fontName='Helvetica', fontSize=6.25, leading=7.3, textColor=colors.HexColor('#111827'))
    formatted_rows = []
    for row_index, row in enumerate(rows):
        style = header_style if row_index == 0 else body_style
        formatted_rows.append([Paragraph(escape(_pdf_text(cell)), style) for cell in row])
    table = Table(formatted_rows, colWidths=widths, repeatRows=1)
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#eaf2f8')),
        ('GRID', (0, 0), (-1, -1), 0.35, colors.HexColor('#d9e1ea')),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 3.5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 3.5),
        ('TOPPADDING', (0, 0), (-1, -1), 3.8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3.8),
    ]))
    return table


def _bar_chart_table(title: str, items: list[tuple[str, Any, str]], width: float):
    # Compatibilidad con llamadas heredadas: ya no se usan barras de texto.
    from reportlab.lib.units import mm

    return _volume_bar_chart_image(title, items, width, 55 * mm)


def _parse_chart_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        if parsed.tzinfo is not None:
            parsed = parsed.astimezone(LOCAL_ZONE).replace(tzinfo=None)
        return parsed
    except (TypeError, ValueError):
        return None


def _chart_flowable_from_matplotlib(fig, width: float, height: float):
    from reportlab.platypus import Image

    image_buffer = BytesIO()
    fig.savefig(image_buffer, format='png', dpi=_REPORT_CHART_DPI, bbox_inches='tight', facecolor='white')
    image_buffer.seek(0)
    return Image(image_buffer, width=width, height=height)


def _line_chart_image(title: str, points: list[dict[str, Any]], value_key: str, y_label: str, width: float, height: float):
    cleaned: list[tuple[datetime, str, float | None]] = []
    for point in points or []:
        timestamp = _parse_chart_datetime(point.get('timestamp'))
        if timestamp is None:
            continue
        name = _pdf_text(point.get('name') or point.get('id') or 'Elemento')
        value = _num(point.get(value_key), None)
        cleaned.append((timestamp, name, value))
    if not cleaned:
        return None

    series: dict[str, list[tuple[datetime, float | None]]] = defaultdict(list)
    for timestamp, name, value in sorted(cleaned, key=lambda item: item[0]):
        series[name].append((timestamp, value))
    if not any(value is not None for values in series.values() for _, value in values):
        return None

    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.dates as mdates
    import matplotlib.pyplot as plt

    palette = ['#0ea5e9', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#06b6d4', '#84cc16', '#f97316']
    fig, ax = plt.subplots(figsize=(7.4, 2.75), dpi=_REPORT_CHART_DPI)
    max_series_points = max((len(values) for values in series.values()), default=0)
    marker = 'o' if max_series_points <= 32 else None
    for index, (name, values) in enumerate(series.items()):
        xs = [timestamp for timestamp, _ in values]
        ys = [float('nan') if value is None else value for _, value in values]
        ax.plot(
            xs,
            ys,
            linewidth=1.7,
            marker=marker,
            markersize=2.2 if marker else 0,
            color=palette[index % len(palette)],
            label=name,
        )

    ax.set_title(title, loc='left', fontsize=9.2, fontweight='bold', color='#1f2937', pad=8)
    ax.set_ylabel(y_label, fontsize=7.5, color='#334155')
    ax.grid(True, axis='y', color='#e5e7eb', linewidth=0.7)
    ax.grid(True, axis='x', color='#eef2f7', linewidth=0.5, alpha=0.75)
    ax.tick_params(axis='both', labelsize=7, colors='#475569')
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['left'].set_color('#cbd5e1')
    ax.spines['bottom'].set_color('#cbd5e1')

    timestamps = [timestamp for values in series.values() for timestamp, _ in values]
    if timestamps:
        first_ts = min(timestamps)
        last_ts = max(timestamps)
        span = last_ts - first_ts
        locator = mdates.AutoDateLocator(minticks=4, maxticks=9)
        ax.xaxis.set_major_locator(locator)
        if span <= timedelta(days=1):
            ax.xaxis.set_major_formatter(mdates.DateFormatter('%H:%M'))
            ax.set_xlabel('Hora', fontsize=7.2, color='#475569')
        else:
            ax.xaxis.set_major_formatter(mdates.DateFormatter('%d/%m\n%H:%M'))
            ax.set_xlabel('Fecha / hora', fontsize=7.2, color='#475569')
        if first_ts != last_ts:
            ax.set_xlim(first_ts, last_ts)
        ax.margins(x=0.01)

    ax.legend(loc='upper center', bbox_to_anchor=(0.5, -0.22), ncol=min(4, max(1, len(series))), fontsize=6.5, frameon=False)
    fig.subplots_adjust(left=0.07, right=0.99, top=0.84, bottom=0.32)
    image = _chart_flowable_from_matplotlib(fig, width, height)
    plt.close(fig)
    return image


def _volume_bar_chart_image(title: str, items: list[tuple[str, Any, str]], width: float, height: float):
    cleaned = [(str(name or 'Elemento'), _num(value, None), suffix or '') for name, value, suffix in items]
    if not cleaned:
        return None

    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt

    names = [_pdf_text(name) for name, _, _ in cleaned]
    values = [0.0 if value is None else max(0.0, float(value)) for _, value, _ in cleaned]
    max_value = max(values, default=0.0)
    row_count = max(1, len(cleaned))
    fig_height = max(1.8, 0.34 * row_count + 0.85)
    fig, ax = plt.subplots(figsize=(7.4, fig_height), dpi=_REPORT_CHART_DPI)
    y_positions = list(range(row_count))
    colors = ['#f59e0b' if index == 0 else '#0ea5e9' for index in range(row_count)]
    for index, (_, value, _) in enumerate(cleaned):
        if value is None:
            colors[index] = '#e5edf4'
    ax.barh(y_positions, values, color=colors, height=0.34)
    ax.set_yticks(y_positions)
    ax.set_yticklabels(names, fontsize=7.2, color='#334155')
    ax.invert_yaxis()
    ax.set_title(title, loc='left', fontsize=9.2, fontweight='bold', color='#1f2937', pad=8)
    ax.set_xlim(0, max(max_value * 1.18, 1.0))
    ax.xaxis.set_visible(False)
    ax.grid(False)
    for spine in ax.spines.values():
        spine.set_visible(False)
    for index, (name, value, suffix) in enumerate(cleaned):
        label = 'Sin datos' if value is None else _fmt_num(value, 2, suffix)
        x = (values[index] if value is not None else 0.0) + max(max_value * 0.02, 0.25)
        ax.text(x, index, label, va='center', ha='left', fontsize=7.1, color='#334155', fontweight='bold' if value is not None else 'normal')
    fig.subplots_adjust(left=0.20, right=0.98, top=0.84, bottom=0.08)
    image = _chart_flowable_from_matplotlib(fig, width, height)
    plt.close(fig)
    return image


def _shift_volume_chart_image(title: str, shift_rows: list[dict[str, Any]], width: float, height: float):
    rows = shift_rows or []
    if not rows:
        return None
    modules = [('pozos', 'Pozos'), ('tam', 'TAM'), ('embotellado', 'Embotellado'), ('cisterna', 'Cisterna')]
    if not any(_num(row.get(module), None) is not None for row in rows for module, _ in modules):
        return None

    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import numpy as np

    labels = [str(row.get('turno') or f'T{index + 1}') for index, row in enumerate(rows)]
    x = np.arange(len(labels))
    width_bar = 0.18
    fig, ax = plt.subplots(figsize=(7.4, 2.35), dpi=_REPORT_CHART_DPI)
    palette = ['#0ea5e9', '#6366f1', '#10b981', '#f59e0b']
    for index, (module, label) in enumerate(modules):
        values = [_num(row.get(module), None) for row in rows]
        plot_values = [float('nan') if value is None else value for value in values]
        ax.bar(x + (index - 1.5) * width_bar, plot_values, width_bar, label=label, color=palette[index])
    ax.set_title(title, loc='left', fontsize=9.2, fontweight='bold', color='#1f2937', pad=8)
    ax.set_ylabel('m³', fontsize=7.5, color='#334155')
    ax.set_xticks(x)
    ax.set_xticklabels(labels, fontsize=7.2)
    ax.grid(True, axis='y', color='#e5e7eb', linewidth=0.7)
    ax.tick_params(axis='y', labelsize=7, colors='#475569')
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['left'].set_color('#cbd5e1')
    ax.spines['bottom'].set_color('#cbd5e1')
    ax.legend(loc='upper center', bbox_to_anchor=(0.5, -0.16), ncol=4, fontsize=6.7, frameon=False)
    fig.subplots_adjust(left=0.07, right=0.99, top=0.84, bottom=0.28)
    image = _chart_flowable_from_matplotlib(fig, width, height)
    plt.close(fig)
    return image

def build_daily_water_report_pdf(report: dict[str, Any]) -> tuple[bytes, str]:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=10 * mm,
        rightMargin=10 * mm,
        topMargin=10 * mm,
        bottomMargin=10 * mm,
        title=_pdf_filename(report).replace('.pdf', ''),
    )
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name='ReportTitle', parent=styles['Heading1'], fontSize=17, leading=20, textColor=colors.HexColor('#111827'), alignment=1, spaceAfter=2))
    styles.add(ParagraphStyle(name='Brand', parent=styles['Normal'], fontName='Helvetica-Bold', fontSize=8.2, leading=10, textColor=colors.HexColor('#d71920'), alignment=1))
    styles.add(ParagraphStyle(name='SmallNote', parent=styles['Normal'], fontSize=7.3, leading=9, textColor=colors.HexColor('#64748b')))
    styles.add(ParagraphStyle(name='Section', parent=styles['Heading2'], fontSize=12.2, leading=15, spaceBefore=6, spaceAfter=5, textColor=colors.HexColor('#111827')))

    story: list[Any] = []
    logo = _logo_path()
    if logo:
        try:
            logo_image = Image(logo, width=34 * mm, height=14 * mm, kind='proportional')
            logo_image.hAlign = 'CENTER'
            story.append(logo_image)
        except Exception:
            pass
    story.append(Paragraph('DASHBOARD ARCA · PLANTA LAS FUENTES', styles['Brand']))
    story.append(Paragraph(_pdf_text(report.get('title'), 'Reporte Diario de Control Hídrico'), styles['ReportTitle']))
    story.append(Paragraph(f"Periodo: {_pdf_text(report.get('period_label'))} &nbsp;&nbsp; · &nbsp;&nbsp; Generado: {_pdf_text(report.get('generated_at'))}", styles['SmallNote']))
    story.append(Spacer(1, 4))
    story.append(_thin_red_rule(doc.width))
    story.append(Spacer(1, 6))

    summary = report.get('summary') or {}
    kpi_headers = ['POZOS', 'TAM', 'EMBOTELLADO', 'CISTERNA', 'POZOS CON ACTIVIDAD', 'MEDIDORES CON ACTIVIDAD', 'COMUNICACIÓN', 'CALIDAD DEL PERIODO']
    kpi_values = [
        _fmt_num(summary.get('volumen_pozos_m3'), 2, ' m³'),
        _fmt_num(summary.get('volumen_tam_m3'), 2, ' m³'),
        _fmt_num(summary.get('volumen_embotellado_m3'), 2, ' m³'),
        _fmt_num(summary.get('volumen_cisterna_m3'), 2, ' m³'),
        f"{summary.get('pozos_activos', 0)}/{summary.get('pozos_total', 0)}",
        f"{summary.get('flujos_activos', 0)}/{summary.get('flujos_total', 0)}",
        f"{summary.get('comunicacion_actualizada', 0)}/{summary.get('comunicacion_total', 0)}",
        str(summary.get('calidad_periodo') or 'Sin datos'),
    ]
    story.append(Paragraph('Resumen ejecutivo', styles['Section']))
    story.append(_kpi_table(kpi_headers, kpi_values, doc.width))

    notes = [str(note) for note in (report.get('notes') or []) if str(note).strip()]
    if notes:
        story.append(Spacer(1, 6))
        story.append(Paragraph('<br/>'.join(escape(note) for note in notes), styles['SmallNote']))

    shifts = report.get('shifts') or {}
    shift_rows = [['Turno', 'Horario', 'Pozos', 'TAM', 'Embotellado', 'Cisterna', 'Estado']]
    for row in shifts.get('rows') or []:
        shift_rows.append([
            row.get('turno'), row.get('horario'), _fmt_any(row.get('pozos'), ' m³'),
            _fmt_any(row.get('tam'), ' m³'), _fmt_any(row.get('embotellado'), ' m³'),
            _fmt_any(row.get('cisterna'), ' m³'), row.get('estado'),
        ])
    if len(shift_rows) > 1:
        story.append(Spacer(1, 8))
        story.append(Paragraph('Cortes por turno', styles['Section']))
        story.append(_pdf_table(shift_rows, [20 * mm, 26 * mm, 24 * mm, 24 * mm, 29 * mm, 24 * mm, 35 * mm]))
        shift_chart = _shift_volume_chart_image('Volumen por turno', shifts.get('rows') or [], doc.width, 55 * mm)
        if shift_chart:
            story.append(Spacer(1, 7))
            story.append(shift_chart)

    comparative_rows = (report.get('comparative') or {}).get('rows') or []
    if comparative_rows:
        story.append(PageBreak())
        story.append(Paragraph('Comparativo del periodo', styles['Section']))
        comparison_headers = (report.get('comparative') or {}).get('headers') or {}
        rows = [['Módulo', 'Elemento', comparison_headers.get('seleccionado') or 'Seleccionado', comparison_headers.get('ayer') or 'Anterior', comparison_headers.get('semana_anterior') or 'Semana anterior', comparison_headers.get('esta_semana') or 'Esta semana']]
        for row in comparative_rows:
            rows.append([row.get('module'), row.get('elemento'), _fmt_any(row.get('hoy'), ' m³'), _fmt_any(row.get('ayer'), ' m³'), _fmt_any(row.get('semana_anterior'), ' m³'), _fmt_any(row.get('esta_semana'), ' m³')])
        story.append(_pdf_table(rows, [23 * mm, 38 * mm, 28 * mm, 28 * mm, 35 * mm, 30 * mm]))

    def section_table(title: str, data_rows: list[dict[str, Any]], element_label: str = 'Elemento') -> None:
        if not data_rows:
            return
        rows = [[element_label, 'Flujo actual', f"Volumen · {_pdf_text(report.get('period_label'))}", 'Totalizador al cierre', 'Actividad', 'Tiempo activo / enc.', 'Comunicación', 'Validación']]
        for row in data_rows:
            rows.append([
                row.get('equipo'), _fmt_num(row.get('flujo_lps'), 2, ' L/s'), _fmt_any(row.get('volumen_display'), ' m³'),
                _fmt_num(row.get('totalizador_m3'), 2, ' m³'), row.get('actividad'), _fmt_activity_metrics(row),
                row.get('comunicacion'), row.get('validacion'),
            ])
        story.append(PageBreak())
        story.append(Paragraph(title, styles['Section']))
        story.append(_pdf_table(rows, [25 * mm, 22 * mm, 31 * mm, 28 * mm, 20 * mm, 27 * mm, 24 * mm, 25 * mm]))
        bars = [(row.get('equipo'), row.get('volumen_periodo_m3'), ' m³') for row in data_rows]
        chart = _volume_bar_chart_image(f'Volumen validado · {title}', bars, doc.width, max(42 * mm, (len(bars) * 7 + 24) * mm)) if bars else None
        if chart:
            story.append(Spacer(1, 8))
            story.append(chart)

    section_table('Pozos', (report.get('wells') or {}).get('rows') or [], 'Pozo')
    flow_groups = report.get('flow_groups') or {}
    section_table('Medidores TAM', (flow_groups.get('tam') or {}).get('rows') or [])
    section_table('Medidores de embotellado', (flow_groups.get('embotellado') or {}).get('rows') or [])
    section_table('Medidor de cisterna', (flow_groups.get('cisterna') or {}).get('rows') or [])

    doc.build(story, onFirstPage=_page_footer, onLaterPages=_page_footer)
    return buffer.getvalue(), _pdf_filename(report)

def _thin_red_rule(width: float):
    from reportlab.lib import colors
    from reportlab.platypus import Table, TableStyle
    table = Table([['']], colWidths=[width], rowHeights=[1.8])
    table.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#d71920'))]))
    return table


def _kpi_table(headers: list[str], values: list[str], width: float):
    from reportlab.lib import colors
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import Paragraph, Table, TableStyle
    header_style = ParagraphStyle('KpiHeader', fontName='Helvetica-Bold', fontSize=6.1, leading=7, textColor=colors.HexColor('#64748b'), alignment=1)
    value_style = ParagraphStyle('KpiValue', fontName='Helvetica-Bold', fontSize=9.3, leading=11, textColor=colors.HexColor('#111827'), alignment=1)
    rows = []
    for i in range(0, len(headers), 4):
        rows.append([Paragraph(escape(x), header_style) for x in headers[i:i+4]])
        rows.append([Paragraph(escape(x), value_style) for x in values[i:i+4]])
    table = Table(rows, colWidths=[width / 4] * 4)
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#f8fafc')),
        ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor('#d9e1ea')),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#d9e1ea')),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]))
    return table


def _page_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont('Helvetica', 7)
    canvas.setFillColorRGB(0.45, 0.52, 0.60)
    canvas.drawString(doc.leftMargin, 8, 'Dashboard ARCA · Control hídrico · Planta Las Fuentes')
    canvas.drawRightString(doc.pagesize[0] - doc.rightMargin, 8, f'Página {doc.page}')
    canvas.restoreState()


# ---------------------------------------------------------------------------
# Excel real y HTML
# ---------------------------------------------------------------------------

def build_daily_water_report_excel(report: dict[str, Any]) -> tuple[bytes, str]:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill, Border, Side
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    ws = wb.active
    ws.title = 'Resumen'

    header_fill = PatternFill('solid', fgColor='DDEBF7')
    title_fill = PatternFill('solid', fgColor='C00000')
    white_font = Font(color='FFFFFF', bold=True)
    bold_font = Font(bold=True)
    thin = Side(style='thin', color='D9E1EA')
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    def style_table(sheet, start_row: int, end_row: int, end_col: int) -> None:
        for row in sheet.iter_rows(min_row=start_row, max_row=end_row, min_col=1, max_col=end_col):
            for cell in row:
                cell.border = border
                cell.alignment = Alignment(vertical='center', wrap_text=True)
        for cell in sheet[start_row]:
            cell.fill = header_fill
            cell.font = bold_font
        sheet.freeze_panes = 'A2'
        for col in range(1, end_col + 1):
            sheet.column_dimensions[get_column_letter(col)].width = max(14, min(30, sheet.column_dimensions[get_column_letter(col)].width or 14))

    ws['A1'] = 'DASHBOARD ARCA · PLANTA LAS FUENTES'
    ws['A1'].fill = title_fill
    ws['A1'].font = white_font
    ws.merge_cells('A1:F1')
    ws['A2'] = 'Reporte Diario de Control Hídrico'
    ws['A3'] = f"Periodo: {report.get('period_label')}"
    ws['A4'] = f"Generado: {report.get('generated_at')}"
    ws.append([])
    ws.append(['KPI', 'Valor'])
    summary = report.get('summary') or {}
    for label, value in [
        ('Volumen pozos', summary.get('volumen_pozos_m3')),
        ('Volumen TAM', summary.get('volumen_tam_m3')),
        ('Volumen embotellado', summary.get('volumen_embotellado_m3')),
        ('Volumen cisterna', summary.get('volumen_cisterna_m3')),
        ('Pozos con actividad', f"{summary.get('pozos_activos', 0)}/{summary.get('pozos_total', 0)}"),
        ('Medidores con actividad', f"{summary.get('flujos_activos', 0)}/{summary.get('flujos_total', 0)}"),
        ('Comunicación', f"{summary.get('comunicacion_actualizada', 0)}/{summary.get('comunicacion_total', 0)}"),
        ('Calidad del periodo', summary.get('calidad_periodo')),
    ]:
        ws.append([label, value])
    style_table(ws, 6, ws.max_row, 2)

    def add_sheet(name: str, headers: list[str], rows: list[list[Any]]) -> None:
        sheet = wb.create_sheet(name[:31])
        sheet.append(headers)
        for row in rows:
            sheet.append(row)
        style_table(sheet, 1, max(1, sheet.max_row), len(headers))
        sheet.auto_filter.ref = sheet.dimensions
        for row in sheet.iter_rows(min_row=2):
            for cell in row:
                if isinstance(cell.value, float):
                    cell.number_format = '#,##0.00'

    add_sheet('Cortes por turno', ['Turno', 'Horario', 'Pozos', 'TAM', 'Embotellado', 'Cisterna', 'Estado'], [
        [row.get('turno'), row.get('horario'), row.get('pozos'), row.get('tam'), row.get('embotellado'), row.get('cisterna'), row.get('estado')]
        for row in (report.get('shifts') or {}).get('rows') or []
    ])
    comparison_headers = (report.get('comparative') or {}).get('headers') or {}
    add_sheet('Comparativo', ['Módulo', 'Elemento', comparison_headers.get('seleccionado') or 'Seleccionado', comparison_headers.get('ayer') or 'Anterior', comparison_headers.get('semana_anterior') or 'Semana anterior', comparison_headers.get('esta_semana') or 'Esta semana'], [
        [row.get('module'), row.get('elemento'), row.get('hoy'), row.get('ayer'), row.get('semana_anterior'), row.get('esta_semana')]
        for row in (report.get('comparative') or {}).get('rows') or []
    ])

    period_header = f"Volumen · {report.get('period_label') or ''}"
    element_headers = ['Elemento', 'Flujo actual', period_header, 'Totalizador al cierre', 'Actividad', 'Tiempo activo (min)', 'Encendidos periodo', 'Comunicación', 'Validación', 'Última actualización']
    def rows_of(section: dict[str, Any] | None) -> list[list[Any]]:
        return [
            [row.get('equipo'), row.get('flujo_lps'), row.get('volumen_periodo_m3'), row.get('totalizador_m3'), row.get('actividad'), row.get('tiempo_activo_min'), row.get('encendidos_periodo'), row.get('comunicacion'), row.get('validacion'), row.get('ultima_actualizacion')]
            for row in (section or {}).get('rows') or []
        ]

    add_sheet('Pozos', ['Pozo', *element_headers[1:]], rows_of(report.get('wells')))
    flow_groups = report.get('flow_groups') or {}
    add_sheet('TAM', element_headers, rows_of(flow_groups.get('tam')))
    add_sheet('Embotellado', element_headers, rows_of(flow_groups.get('embotellado')))
    add_sheet('Cisterna', element_headers, rows_of(flow_groups.get('cisterna')))

    output = BytesIO()
    wb.save(output)
    return output.getvalue(), _excel_filename(report)

def build_daily_water_report_html(report: dict[str, Any]) -> tuple[bytes, str]:
    def fmt(value: Any, suffix: str = '') -> str:
        number = _num(value, None)
        if number is None:
            return escape(_pdf_text(value))
        return escape(f'{number:,.2f}{suffix}')

    def table(title: str, headers: list[str], rows: list[list[Any]]) -> str:
        if not rows:
            return f'<section><h2>{escape(title)}</h2><p>Sin datos disponibles.</p></section>'
        head = ''.join(f'<th>{escape(header)}</th>' for header in headers)
        body = ''.join('<tr>' + ''.join(f'<td>{escape(_pdf_text(cell))}</td>' for cell in row) + '</tr>' for row in rows)
        return f'<section><h2>{escape(title)}</h2><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></section>'

    summary = report.get('summary') or {}
    html = f"""<!doctype html><html lang="es"><head><meta charset="utf-8"/><title>{escape(_file_base(report))}</title><style>
    body{{font-family:Arial,sans-serif;color:#111827;background:#fff;margin:0;padding:24px}}.brand{{text-align:center;color:#d71920;font-weight:800}}h1{{text-align:center}}.rule{{height:3px;background:#d71920;margin:14px 0 20px}}.kpis{{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 0}}.kpi{{border:1px solid #d9e1ea;background:#f8fafc;padding:10px}}.kpi span{{display:block;color:#64748b;font-size:11px;font-weight:700}}.kpi strong{{display:block;margin-top:5px;font-size:18px}}section{{break-inside:avoid;margin:22px 0}}h2{{font-size:18px}}table{{width:100%;border-collapse:collapse;font-size:12px}}th{{background:#eaf2f8}}th,td{{border:1px solid #d9e1ea;padding:6px;vertical-align:middle}}
    </style></head><body><div class="brand">DASHBOARD ARCA · PLANTA LAS FUENTES</div><h1>Reporte Diario de Control Hídrico</h1><p>Periodo: {escape(_pdf_text(report.get('period_label')))} · Generado: {escape(_pdf_text(report.get('generated_at')))}</p><div class="rule"></div><section class="kpis">
    <div class="kpi"><span>Pozos</span><strong>{fmt(summary.get('volumen_pozos_m3'), ' m³')}</strong></div><div class="kpi"><span>TAM</span><strong>{fmt(summary.get('volumen_tam_m3'), ' m³')}</strong></div><div class="kpi"><span>Embotellado</span><strong>{fmt(summary.get('volumen_embotellado_m3'), ' m³')}</strong></div><div class="kpi"><span>Cisterna</span><strong>{fmt(summary.get('volumen_cisterna_m3'), ' m³')}</strong></div></section>
    """
    html += table('Cortes por turno', ['Turno', 'Horario', 'Pozos', 'TAM', 'Embotellado', 'Cisterna', 'Estado'], [[row.get('turno'), row.get('horario'), _fmt_any(row.get('pozos'), ' m³'), _fmt_any(row.get('tam'), ' m³'), _fmt_any(row.get('embotellado'), ' m³'), _fmt_any(row.get('cisterna'), ' m³'), row.get('estado')] for row in (report.get('shifts') or {}).get('rows') or []])
    comparison_headers = (report.get('comparative') or {}).get('headers') or {}
    html += table('Comparativo del periodo', ['Módulo', 'Elemento', comparison_headers.get('seleccionado') or 'Seleccionado', comparison_headers.get('ayer') or 'Anterior', comparison_headers.get('semana_anterior') or 'Semana anterior', comparison_headers.get('esta_semana') or 'Esta semana'], [[row.get('module'), row.get('elemento'), _fmt_any(row.get('hoy'), ' m³'), _fmt_any(row.get('ayer'), ' m³'), _fmt_any(row.get('semana_anterior'), ' m³'), _fmt_any(row.get('esta_semana'), ' m³')] for row in (report.get('comparative') or {}).get('rows') or []])

    period_header = f"Volumen · {_pdf_text(report.get('period_label'))}"
    headers = ['Elemento', 'Flujo actual', period_header, 'Totalizador al cierre', 'Actividad', 'Tiempo activo', 'Encendidos', 'Comunicación', 'Validación']
    def data_rows(section: dict[str, Any] | None) -> list[list[Any]]:
        return [[row.get('equipo'), _fmt_num(row.get('flujo_lps'), 2, ' L/s'), _fmt_any(row.get('volumen_display'), ' m³'), _fmt_num(row.get('totalizador_m3'), 2, ' m³'), row.get('actividad'), _fmt_minutes(row.get('tiempo_activo_min')), row.get('encendidos_periodo') if row.get('encendidos_periodo') is not None else '—', row.get('comunicacion'), row.get('validacion')] for row in (section or {}).get('rows') or []]

    html += table('Pozos', ['Pozo', *headers[1:]], data_rows(report.get('wells')))
    flow_groups = report.get('flow_groups') or {}
    html += table('Medidores TAM', headers, data_rows(flow_groups.get('tam')))
    html += table('Medidores de embotellado', headers, data_rows(flow_groups.get('embotellado')))
    html += table('Medidor de cisterna', headers, data_rows(flow_groups.get('cisterna')))
    html += '</body></html>'
    return html.encode('utf-8'), _html_filename(report)

