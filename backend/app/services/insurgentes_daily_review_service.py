from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from app.services.insurgentes_config import LOCAL_TIMEZONE, PLANT_DISPLAY_NAME
from app.services.insurgentes_service import get_insurgentes_dashboard_payload, get_insurgentes_shift_cuts

MODULE_ORDER = ('entrada', 'pozos', 'lineas', 'flujos', 'niveles', 'uv')


def _parse_date(value: Any = None) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if value:
        return date.fromisoformat(str(value)[:10])
    return datetime.now(ZoneInfo(LOCAL_TIMEZONE)).date()


def _rows(value: Any) -> list[dict[str, Any]]:
    return [dict(item) for item in value or [] if isinstance(item, dict)]


def _module_rows(dashboard: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    entry = dashboard.get('water_entry')
    return {
        'entrada': [dict(entry)] if isinstance(entry, dict) and entry else [],
        'pozos': _rows(dashboard.get('wells') or dashboard.get('pozos')),
        'lineas': _rows(dashboard.get('production_lines')),
        'flujos': _rows(dashboard.get('flows') or dashboard.get('distribution_flows')),
        'niveles': _rows(dashboard.get('tank_inputs')),
        'uv': _rows(dashboard.get('uv_lamps')),
    }


def _lower(value: Any) -> str:
    return str(value or '').strip().lower()


def _number(value: Any) -> float | None:
    if value in (None, ''):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _daily_activity(item: dict[str, Any]) -> str:
    active_minutes = _number(item.get('active_minutes') or item.get('tiempo_activo_min'))
    if active_minutes is not None:
        return 'Con actividad' if active_minutes > 0 else 'Sin actividad'
    period_volume = _number(item.get('period_m3') or item.get('period_delta_m3') or item.get('volume_m3'))
    if period_volume is not None and period_volume > 0:
        return 'Con actividad'
    status = _lower(item.get('status') or item.get('state') or item.get('activity'))
    if any(token in status for token in ('operando', 'encendido', 'activo', 'con actividad')):
        return 'Con actividad'
    if item.get('updated') or item.get('ultima_lectura'):
        return 'Sin actividad'
    return 'Sin datos'


def _validation(item: dict[str, Any]) -> str:
    status = _lower(item.get('quality_status') or item.get('period_status') or item.get('validation') or item.get('validacion'))
    if status in {'review', 'dato_en_revision'} or 'revisi' in status:
        return 'Dato en revisión'
    if status in {'partial', 'cobertura_parcial'} or 'parcial' in status:
        return 'Cobertura parcial'
    if status in {'no_data', 'sin_datos', 'missing'} or 'sin datos' in status:
        return 'Sin datos'
    return 'Validado'


def _communication(item: dict[str, Any]) -> str:
    label = _lower(item.get('estado_comunicacion') or item.get('communication'))
    kind = _lower(item.get('communicationType') or item.get('source_status'))
    if any(token in label for token in ('sin comunicación', 'sin comunicacion', 'sin lectura')):
        return 'Sin comunicación'
    if any(token in kind for token in ('warning', 'critical', 'offline', 'error')):
        return 'Revisar comunicación'
    if item.get('updated') or item.get('ultima_lectura'):
        return 'Actualizado'
    return 'Sin información'


def _decorate_daily_items(dashboard: dict[str, Any]) -> dict[str, Any]:
    """Return a review-specific copy without changing the operational snapshot service."""
    output = deepcopy(dashboard)
    module_map = _module_rows(output)
    for module, items in module_map.items():
        for item in items:
            item['daily_activity'] = _daily_activity(item)
            item['daily_validation'] = _validation(item)
            item['daily_communication'] = _communication(item)
            item['review_module'] = module
    if module_map['entrada']:
        output['water_entry'] = module_map['entrada'][0]
    output['wells'] = module_map['pozos']
    output['pozos'] = module_map['pozos']
    output['production_lines'] = module_map['lineas']
    output['flows'] = module_map['flujos']
    output['distribution_flows'] = module_map['flujos']
    output['tank_inputs'] = module_map['niveles']
    output['uv_lamps'] = module_map['uv']
    return output


def _module_summary(module: str, items: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(items)
    activities = [_daily_activity(item) for item in items]
    validations = [_validation(item) for item in items]
    communications = [_communication(item) for item in items]
    reliable_volumes = []
    for item in items:
        status = _lower(item.get('period_status') or item.get('quality_status'))
        value = _number(item.get('period_m3') or item.get('period_delta_m3') or item.get('volume_m3'))
        if value is not None and status in {'valid', 'validated', 'zero_valid', ''}:
            reliable_volumes.append(value)
    return {
        'module': module,
        'monitored': total,
        'with_activity': sum(1 for value in activities if value == 'Con actividad'),
        'without_activity': sum(1 for value in activities if value == 'Sin actividad'),
        'validated': sum(1 for value in validations if value == 'Validado'),
        'partial': sum(1 for value in validations if value == 'Cobertura parcial'),
        'review': sum(1 for value in validations if value == 'Dato en revisión'),
        'no_data': sum(1 for value in validations if value == 'Sin datos'),
        'communication_ok': sum(1 for value in communications if value == 'Actualizado'),
        'validated_subtotal_m3': round(sum(reliable_volumes), 4) if reliable_volumes else None,
        'coverage_complete': total > 0 and all(value == 'Validado' for value in validations),
    }


def _review_period_slice(start_day: date, end_day: date, *, include_history: bool = False) -> dict[str, Any]:
    if start_day > end_day:
        start_day, end_day = end_day, start_day
    # El snapshot/reconciliacion no depende de la granularidad visual del
    # historico. Para PDF de un solo dia necesitamos una serie intradia real:
    # usar `daily` colapsaba todo el periodo a un unico bucket 00:00.
    # Mantener horario hasta 31 dias produce la misma semantica temporal que
    # el historico operativo por elemento sin disparar el numero de puntos.
    range_days = (end_day - start_day).days + 1
    if include_history:
        history_period = 'hourly' if range_days <= 31 else 'daily'
    else:
        history_period = 'daily' if start_day == end_day else 'hourly'

    dashboard = get_insurgentes_dashboard_payload(
        start_date=start_day.isoformat(),
        end_date=end_day.isoformat(),
        period=history_period,
        include_history=include_history,
        include_period_deltas=True,
    )
    decorated = _decorate_daily_items(dashboard)
    module_map = _module_rows(decorated)
    modules = [_module_summary(module, module_map[module]) for module in MODULE_ORDER]
    return {
        'date': end_day.isoformat(),
        'start_date': start_day.isoformat(),
        'end_date': end_day.isoformat(),
        'dashboard': decorated,
        'modules': modules,
    }


def _review_slice(day: date) -> dict[str, Any]:
    return _review_period_slice(day, day, include_history=False)


def _source_status(*payloads: dict[str, Any]) -> str:
    statuses = [str((payload.get('dashboard') or {}).get('source_status') or '').lower() for payload in payloads]
    if any('error' in value or 'timeout' in value for value in statuses):
        return 'partial'
    return 'operational'


def get_insurgentes_review_period(
    start_date: Any = None,
    end_date: Any = None,
    *,
    include_history: bool = False,
    include_comparisons: bool = True,
    include_shifts: bool = True,
) -> dict[str, Any]:
    """Common review payload for one day or a closed date range.

    Reportes consume this function so preview, PDF, Excel, HTML and email all
    share the same decorated items, module summaries and shift contract as
    Revisión diaria. The underlying hydraulic mathematics remains in the
    common dashboard/reconciliation services; this layer only centralizes the
    review/report contract.
    """
    start_day = _parse_date(start_date or end_date)
    end_day = _parse_date(end_date or start_date or start_day)
    if start_day > end_day:
        start_day, end_day = end_day, start_day

    selected = _review_period_slice(start_day, end_day, include_history=include_history)
    comparisons: dict[str, Any] = {}
    comparison_payloads: list[dict[str, Any]] = []
    if include_comparisons:
        previous = _review_period_slice(start_day - timedelta(days=1), end_day - timedelta(days=1), include_history=False)
        previous_week = _review_period_slice(start_day - timedelta(days=7), end_day - timedelta(days=7), include_history=False)
        comparisons = {
            'previous_day': previous,
            'previous_week': previous_week,
        }
        comparison_payloads = [previous, previous_week]

    shifts = get_insurgentes_shift_cuts(shift_date=end_day.isoformat(), module='all') if include_shifts else {}
    source_status = _source_status(selected, *comparison_payloads)
    updated_at = shifts.get('updated_at') or selected['dashboard'].get('last_update')
    return {
        'plant': PLANT_DISPLAY_NAME,
        'date': end_day.isoformat(),
        'start_date': start_day.isoformat(),
        'end_date': end_day.isoformat(),
        'timezone': LOCAL_TIMEZONE,
        'interval_contract': '[T0,T1)',
        'opening_rule': 'last_valid_reading_before_t0',
        'source_status': source_status,
        'dashboard': selected['dashboard'],
        'modules': selected['modules'],
        'shifts': shifts,
        'comparisons': comparisons,
        'updated_at': updated_at,
    }


def get_insurgentes_daily_review(review_date: Any = None) -> dict[str, Any]:
    selected_day = _parse_date(review_date)
    return get_insurgentes_review_period(
        start_date=selected_day,
        end_date=selected_day,
        include_history=False,
        include_comparisons=True,
    )
