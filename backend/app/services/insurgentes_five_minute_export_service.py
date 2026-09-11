from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from io import BytesIO
import logging
import re
from typing import Any, Literal
from zoneinfo import ZoneInfo

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from sqlalchemy import text
from sqlalchemy.exc import OperationalError, SQLAlchemyError

from app.database import SessionLocal
from app.services.insurgentes_config import FLOWS, LINES, LOCAL_TIMEZONE, READINGS_MINUTE_TABLE, WELLS
from app.services.insurgentes_reconciliation_service import (
    QUALITY_NO_DATA,
    QUALITY_PARTIAL,
    QUALITY_REVIEW,
    readings_minute_operational_ts_sql,
    reconcile_interval,
)

logger = logging.getLogger(__name__)
LOCAL_ZONE = ZoneInfo(LOCAL_TIMEZONE)
Module = Literal['well', 'line', 'flow']
MAX_EXPORT_DAYS = 3
BUCKET_MINUTES = 5
EXPECTED_MINUTE_SAMPLES = BUCKET_MINUTES


def _catalog(configs: list[dict[str, Any]]) -> dict[int, str]:
    result: dict[int, str] = {}
    for item in configs:
        raw = item.get('sensor_id')
        if raw in (None, '') or item.get('visible') is False:
            continue
        result[int(raw)] = str(item.get('name') or item.get('nombre') or raw)
    return result


WELL_SENSORS = _catalog(WELLS)
LINE_SENSORS = _catalog(LINES)
FLOW_SENSORS = _catalog(FLOWS)


class InsurgentesFiveMinuteExportError(RuntimeError):
    def __init__(self, message: str, *, status: str = 'sql_error') -> None:
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class ExportRange:
    start_day: date
    end_day: date
    local_start: datetime
    local_end: datetime

    @property
    def inclusive_days(self) -> int:
        return (self.end_day - self.start_day).days + 1


def _parse_date(value: Any, label: str) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return datetime.fromisoformat(str(value)[:10]).date()
    except (TypeError, ValueError) as exc:
        raise ValueError(f'La fecha {label} no es válida.') from exc


def _floor_five_minutes(value: datetime) -> datetime:
    minute = (value.minute // BUCKET_MINUTES) * BUCKET_MINUTES
    return value.replace(minute=minute, second=0, microsecond=0)


def _export_range(start_date: Any, end_date: Any, *, now: datetime | None = None) -> ExportRange:
    start_day = _parse_date(start_date, 'inicial')
    end_day = _parse_date(end_date, 'final')
    if start_day > end_day:
        raise ValueError('La fecha inicial no puede ser posterior a la fecha final.')
    inclusive_days = (end_day - start_day).days + 1
    if inclusive_days > MAX_EXPORT_DAYS:
        raise ValueError('La exportación de 5 minutos permite un máximo de 3 días calendario.')

    local_start = datetime.combine(start_day, time.min)
    requested_end = datetime.combine(end_day + timedelta(days=1), time.min)
    current = (now or datetime.now(LOCAL_ZONE)).replace(tzinfo=None)
    last_complete_boundary = _floor_five_minutes(current)
    local_end = min(requested_end, last_complete_boundary) if end_day >= current.date() else requested_end
    if local_end <= local_start:
        raise ValueError('El periodo seleccionado todavía no contiene intervalos completos de 5 minutos.')
    return ExportRange(start_day, end_day, local_start, local_end)


def _module_catalog(module: Module) -> dict[int, str]:
    if module == 'well':
        return WELL_SENSORS
    if module == 'line':
        return LINE_SENSORS
    return FLOW_SENSORS


def _validate_module(module: str) -> Module:
    normalized = str(module or '').strip().lower()
    if normalized not in {'well', 'line', 'flow'}:
        raise ValueError('El módulo de exportación debe ser well, line o flow.')
    return normalized  # type: ignore[return-value]


def _sensor_name(module: Module, sensor_id: int) -> str:
    catalog = _module_catalog(module)
    if sensor_id not in catalog:
        visible = {'well': 'pozos', 'line': 'líneas', 'flow': 'flujos'}[module]
        raise ValueError(f'El sensor solicitado no pertenece al contrato confirmado de {visible} en Las Fuentes.')
    return catalog[sensor_id]


def _timeout_status(exc: Exception) -> str:
    message = str(exc).lower()
    return 'timeout' if any(token in message for token in ('timeout', 'hyt00', 'hyt01', 'hy008', 'query timeout')) else 'sql_error'


def _query_readings(sensor_id: int, export_range: ExportRange) -> list[dict[str, Any]]:
    operational_ts_sql = readings_minute_operational_ts_sql('reading', [sensor_id], export_range.local_start)
    query = text(f"""
        WITH period_rows AS (
            SELECT
                {operational_ts_sql} AS reading_ts,
                TRY_CONVERT(float, reading.instant_value) AS instant_value,
                TRY_CONVERT(float, reading.total_value) AS total_value
            FROM {READINGS_MINUTE_TABLE} AS reading
            WHERE reading.sensor_id = :sensor_id
              AND {operational_ts_sql} >= :start_dt
              AND {operational_ts_sql} < :end_dt
        ), prior_row AS (
            SELECT TOP (1)
                {operational_ts_sql} AS reading_ts,
                TRY_CONVERT(float, reading.instant_value) AS instant_value,
                TRY_CONVERT(float, reading.total_value) AS total_value
            FROM {READINGS_MINUTE_TABLE} AS reading
            WHERE reading.sensor_id = :sensor_id
              AND TRY_CONVERT(float, reading.total_value) > 0
              AND {operational_ts_sql} < :start_dt
            ORDER BY {operational_ts_sql} DESC
        )
        SELECT reading_ts, instant_value, total_value FROM prior_row
        UNION ALL
        SELECT reading_ts, instant_value, total_value FROM period_rows
        ORDER BY reading_ts
    """)
    params = {
        'sensor_id': sensor_id,
        'start_dt': export_range.local_start,
        'end_dt': export_range.local_end,
    }
    try:
        with SessionLocal() as session:
            return [dict(row) for row in session.execute(query, params).mappings().all()]
    except OperationalError as exc:
        status = _timeout_status(exc)
        logger.exception('Insurgentes five-minute export query failed status=%s', status)
        if status == 'timeout':
            raise InsurgentesFiveMinuteExportError('La consulta de 5 minutos tardó demasiado.', status='timeout') from exc
        raise InsurgentesFiveMinuteExportError('No fue posible consultar las lecturas de planta.', status='sql_error') from exc
    except SQLAlchemyError as exc:
        logger.exception('Insurgentes five-minute export SQL error')
        raise InsurgentesFiveMinuteExportError('No fue posible consultar las lecturas de planta.', status='sql_error') from exc

def _number(value: Any) -> float | None:
    if value in (None, ''):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed == parsed else None


def _normalized_rows(raw_rows: list[dict[str, Any]], export_range: ExportRange, sensor_id: int | None = None) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for row in raw_rows:
        stamp = row.get('reading_ts')
        if not isinstance(stamp, datetime):
            try:
                stamp = datetime.fromisoformat(str(stamp))
            except (TypeError, ValueError):
                continue
        if stamp.tzinfo is not None:
            stamp = stamp.astimezone(LOCAL_ZONE).replace(tzinfo=None)
        if stamp >= export_range.local_end:
            continue
        result.append({
            'operational_ts': stamp,
            'instant_value': _number(row.get('instant_value')),
            'total_value': _number(row.get('total_value')),
        })
    result.sort(key=lambda item: item['operational_ts'])
    return result


def _bucket_status(*, samples: int, flow_avg: float | None, volume: float | None, reliable: bool, retained: bool, coverage: float) -> str:
    if samples == 0:
        return 'Sin datos'
    if retained and (flow_avg or 0) > 0:
        return 'Totalizador retenido · revisar volumen'
    if volume is not None and reliable:
        if volume == 0 and (flow_avg or 0) == 0:
            return 'Sin volumen'
        return 'Validado' if coverage >= 100 else 'Validado · cobertura parcial'
    if flow_avg == 0:
        return 'Sin volumen'
    return 'En revisión'


def _status_from_reconciliation(result: dict[str, Any]) -> str:
    quality = str(result.get('quality_status') or QUALITY_NO_DATA)
    if quality == QUALITY_NO_DATA:
        return 'Sin datos'
    if quality == QUALITY_REVIEW:
        if result.get('totalizer_retained'):
            return 'Totalizador retenido · revisar volumen'
        return 'En revisión'
    if quality == QUALITY_PARTIAL:
        return 'Cobertura parcial'
    if result.get('volume_m3') == 0:
        return 'Sin volumen'
    return 'Validado'


def _build_five_minute_rows(*, module: Module, sensor_id: int, export_range: ExportRange, raw_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized = _normalized_rows(raw_rows, export_range, sensor_id=sensor_id)
    context_rows = [
        {
            'timestamp': row['operational_ts'],
            'instant_value': row.get('instant_value'),
            'total_value': row.get('total_value'),
        }
        for row in normalized
    ]
    element = _sensor_name(module, sensor_id)
    result: list[dict[str, Any]] = []

    cursor = export_range.local_start
    while cursor < export_range.local_end:
        bucket_end = cursor + timedelta(minutes=BUCKET_MINUTES)
        reconciled = reconcile_interval(
            context_rows,
            cursor,
            bucket_end,
            expected_samples=EXPECTED_MINUTE_SAMPLES,
        )
        result.append({
            'element': element,
            'sensor_id': sensor_id,
            'start_local': cursor,
            'end_local': bucket_end,
            'flow_unit': 'L/s',
            'flow_avg': reconciled.get('flow_avg_lps'),
            'flow_min': reconciled.get('flow_min_lps'),
            'flow_max': reconciled.get('flow_max_lps'),
            'totalizer_open_m3': reconciled.get('totalizer_open_m3'),
            'raw_totalizer_close_m3': reconciled.get('raw_totalizer_close_m3'),
            'effective_totalizer_close_m3': reconciled.get('effective_totalizer_close_m3'),
            'totalizer_close_m3': reconciled.get('totalizer_close_m3'),
            'totalizer_retained': bool(reconciled.get('totalizer_retained')),
            'observed_volume_m3': reconciled.get('observed_volume_m3'),
            'volume_m3': reconciled.get('volume_m3'),
            'samples': int(reconciled.get('samples') or 0),
            'coverage_pct': reconciled.get('coverage_pct'),
            'status': _status_from_reconciliation(reconciled),
            'volume_reliable': bool(reconciled.get('volume_reliable')),
            'opening_source': reconciled.get('opening_source'),
            'boundary_complete': bool(reconciled.get('boundary_complete')),
            'data_status': reconciled.get('data_status'),
            'quality_status': reconciled.get('quality_status'),
            'quality_label': reconciled.get('quality_label'),
            'review_reason': reconciled.get('review_reason'),
            'calculation_source': 'common_reconciled_interval',
        })
        cursor = bucket_end

    return result


def get_insurgentes_five_minute_export_data(*, module: str, sensor_id: int, start_date: Any, end_date: Any) -> dict[str, Any]:
    typed_module = _validate_module(module)
    sensor_id = int(sensor_id)
    name = _sensor_name(typed_module, sensor_id)
    export_range = _export_range(start_date, end_date)
    raw_rows = _query_readings(sensor_id, export_range)
    rows = _build_five_minute_rows(
        module=typed_module,
        sensor_id=sensor_id,
        export_range=export_range,
        raw_rows=raw_rows,
    )
    return {
        'module': typed_module,
        'sensor_id': sensor_id,
        'name': name,
        'flow_unit': 'L/s',
        'unit_status': 'confirmed',
        'start_date': export_range.start_day.isoformat(),
        'end_date': export_range.end_day.isoformat(),
        'time_zone': LOCAL_TIMEZONE,
        'bucket_minutes': BUCKET_MINUTES,
        'rows': rows,
    }


def _safe_filename_token(value: str) -> str:
    token = re.sub(r'[^A-Za-z0-9_-]+', '_', value.strip())
    return token.strip('_') or 'elemento'


def build_insurgentes_five_minute_excel(payload: dict[str, Any]) -> tuple[bytes, str]:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = '5 minutos'

    name = str(payload.get('name') or 'Elemento')
    sensor_id = int(payload.get('sensor_id') or 0)
    start_date = str(payload.get('start_date') or '')
    end_date = str(payload.get('end_date') or '')

    sheet['A1'] = 'ARCA Las Fuentes — Exportación histórica cada 5 minutos'
    sheet['A1'].font = Font(bold=True, size=14)
    sheet.merge_cells('A1:P1')
    metadata = [
        ('A2', 'Elemento'), ('B2', name), ('D2', 'Sensor'), ('E2', sensor_id),
        ('G2', 'Rango local'), ('H2', f'{start_date} a {end_date}'),
        ('K2', 'Zona horaria'), ('L2', str(payload.get('time_zone') or LOCAL_TIMEZONE)),
        ('A3', 'Unidad de flujo'), ('B3', 'L/s'), ('D3', 'Intervalo'), ('E3', '5 minutos'),
        ('G3', 'Alcance'), ('H3', 'Solo el elemento seleccionado'),
    ]
    for address, value in metadata:
        sheet[address] = value

    headers = [
        'Elemento', 'Sensor', 'Inicio local', 'Fin local', 'Unidad flujo',
        'Flujo promedio', 'Flujo mínimo', 'Flujo máximo',
        'Apertura totalizador (m³)', 'Cierre observado (m³)', 'Cierre efectivo (m³)',
        'Retenido', 'Volumen validado (m³)', 'Muestras', 'Cobertura (%)', 'Estado',
    ]
    header_row = 5
    for column, header in enumerate(headers, start=1):
        cell = sheet.cell(row=header_row, column=column, value=header)
        cell.font = Font(bold=True, color='FFFFFF')
        cell.fill = PatternFill(fill_type='solid', fgColor='1F4E78')
        cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)

    rows = list(payload.get('rows') or [])
    for row_index, item in enumerate(rows, start=header_row + 1):
        values = [
            item.get('element'), item.get('sensor_id'), item.get('start_local'), item.get('end_local'),
            item.get('flow_unit'), item.get('flow_avg'), item.get('flow_min'), item.get('flow_max'),
            item.get('totalizer_open_m3'), item.get('raw_totalizer_close_m3'), item.get('effective_totalizer_close_m3'),
            'Sí' if item.get('totalizer_retained') else 'No', item.get('volume_m3'), item.get('samples'),
            item.get('coverage_pct'), item.get('status'),
        ]
        for column, value in enumerate(values, start=1):
            sheet.cell(row=row_index, column=column, value=value)
        sheet.cell(row=row_index, column=3).number_format = 'yyyy-mm-dd hh:mm'
        sheet.cell(row=row_index, column=4).number_format = 'yyyy-mm-dd hh:mm'
        for column in [6, 7, 8, 9, 10, 11, 13]:
            sheet.cell(row=row_index, column=column).number_format = '0.0000'
        sheet.cell(row=row_index, column=15).number_format = '0.0'

    valid_rows = [row for row in rows if row.get('volume_reliable') is True and row.get('volume_m3') is not None]
    first_open = next((row.get('totalizer_open_m3') for row in rows if row.get('totalizer_open_m3') is not None), None)
    last_close = next((row.get('effective_totalizer_close_m3') for row in reversed(rows) if row.get('effective_totalizer_close_m3') is not None), None)
    sum_volume = round(sum(float(row.get('volume_m3') or 0) for row in valid_rows), 4)
    totalizer_delta = round(float(last_close) - float(first_open), 4) if first_open is not None and last_close is not None else None
    difference = round(sum_volume - totalizer_delta, 4) if totalizer_delta is not None else None

    summary = workbook.create_sheet('Conciliación')
    summary['A1'] = 'Conciliación de volumen por intervalos'
    summary['A1'].font = Font(bold=True, size=14)
    summary.merge_cells('A1:D1')
    summary_rows = [
        ('Elemento', name), ('Sensor', sensor_id), ('Rango local', f'{start_date} a {end_date}'),
        ('Método', 'Cada bloque usa la lectura válida anterior al inicio y el cierre efectivo del bloque.'),
        ('Volumen validado sumado en cortes de 5 min (m³)', sum_volume),
        ('Apertura usada en el primer bloque (m³)', first_open),
        ('Cierre efectivo final (m³)', last_close),
        ('Diferencia cierre - apertura (m³)', totalizer_delta),
        ('Diferencia suma 5 min vs delta totalizador (m³)', difference),
        ('Bloques con volumen válido', len(valid_rows)), ('Bloques totales', len(rows)),
    ]
    for row_index, (label, value) in enumerate(summary_rows, start=3):
        summary.cell(row=row_index, column=1, value=label).font = Font(bold=True)
        summary.cell(row=row_index, column=2, value=value)
        if isinstance(value, (int, float)):
            summary.cell(row=row_index, column=2).number_format = '0.0000'
    summary['A15'] = 'Nota'
    summary['A15'].font = Font(bold=True)
    summary['B15'] = 'La conciliación permite comprobar la suma de intervalos contra la variación del totalizador.'
    summary.column_dimensions['A'].width = 48
    summary.column_dimensions['B'].width = 90
    summary.sheet_view.showGridLines = False

    last_row = max(header_row + 1, header_row + len(rows))
    sheet.auto_filter.ref = f'A{header_row}:P{last_row}'
    sheet.freeze_panes = f'A{header_row + 1}'
    widths = [24, 10, 19, 19, 18, 16, 14, 14, 22, 22, 22, 13, 21, 10, 14, 42]
    for index, width in enumerate(widths, start=1):
        sheet.column_dimensions[get_column_letter(index)].width = width
    sheet.sheet_view.showGridLines = False

    buffer = BytesIO()
    workbook.save(buffer)
    filename = f'ARCA_Las_Fuentes_{_safe_filename_token(name)}_5min_{start_date}_{end_date}.xlsx'
    return buffer.getvalue(), filename


def export_insurgentes_five_minute_excel(*, module: str, sensor_id: int, start_date: Any, end_date: Any) -> tuple[bytes, str]:
    payload = get_insurgentes_five_minute_export_data(
        module=module,
        sensor_id=sensor_id,
        start_date=start_date,
        end_date=end_date,
    )
    return build_insurgentes_five_minute_excel(payload)


def _module_label(module: Module) -> str:
    return {'well': 'Pozos', 'line': 'Líneas', 'flow': 'Flujos'}[module]


def _reconciliation_values(rows: list[dict[str, Any]]) -> dict[str, Any]:
    valid_rows = [row for row in rows if row.get('volume_reliable') is True and row.get('volume_m3') is not None]
    first_open = next((row.get('totalizer_open_m3') for row in rows if row.get('totalizer_open_m3') is not None), None)
    last_close = next((row.get('effective_totalizer_close_m3') for row in reversed(rows) if row.get('effective_totalizer_close_m3') is not None), None)
    sum_volume = round(sum(float(row.get('volume_m3') or 0) for row in valid_rows), 4)
    totalizer_delta = round(float(last_close) - float(first_open), 4) if first_open is not None and last_close is not None else None
    difference = round(sum_volume - totalizer_delta, 4) if totalizer_delta is not None else None
    return {
        'sum_volume': sum_volume,
        'first_open': first_open,
        'last_close': last_close,
        'totalizer_delta': totalizer_delta,
        'difference': difference,
        'valid_blocks': len(valid_rows),
        'total_blocks': len(rows),
    }


def _unique_sheet_title(workbook: Workbook, value: str) -> str:
    base = re.sub(r'[\\/*?:\[\]]+', '_', str(value or 'Elemento')).strip()[:31] or 'Elemento'
    existing = {sheet.title for sheet in workbook.worksheets}
    if base not in existing:
        return base
    index = 2
    while True:
        suffix = f' {index}'
        candidate = f'{base[:31-len(suffix)]}{suffix}'
        if candidate not in existing:
            return candidate
        index += 1


def _write_five_minute_payload_sheet(sheet: Any, payload: dict[str, Any]) -> None:
    name = str(payload.get('name') or 'Elemento')
    sensor_id = int(payload.get('sensor_id') or 0)
    start_date = str(payload.get('start_date') or '')
    end_date = str(payload.get('end_date') or '')

    sheet['A1'] = f'ARCA Las Fuentes — {name} — histórico cada 5 minutos'
    sheet['A1'].font = Font(bold=True, size=14)
    sheet.merge_cells('A1:P1')
    metadata = [
        ('A2', 'Elemento'), ('B2', name), ('D2', 'Sensor'), ('E2', sensor_id),
        ('G2', 'Rango local'), ('H2', f'{start_date} a {end_date}'),
        ('K2', 'Zona horaria'), ('L2', str(payload.get('time_zone') or LOCAL_TIMEZONE)),
        ('A3', 'Unidad de flujo'), ('B3', 'L/s'), ('D3', 'Intervalo'), ('E3', '5 minutos'),
    ]
    for address, value in metadata:
        sheet[address] = value

    headers = [
        'Elemento', 'Sensor', 'Inicio local', 'Fin local', 'Unidad flujo',
        'Flujo promedio', 'Flujo mínimo', 'Flujo máximo',
        'Apertura totalizador (m³)', 'Cierre observado (m³)', 'Cierre efectivo (m³)',
        'Retenido', 'Volumen validado (m³)', 'Muestras', 'Cobertura (%)', 'Estado',
    ]
    header_row = 5
    for column, header in enumerate(headers, start=1):
        cell = sheet.cell(row=header_row, column=column, value=header)
        cell.font = Font(bold=True, color='FFFFFF')
        cell.fill = PatternFill(fill_type='solid', fgColor='1F4E78')
        cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)

    rows = list(payload.get('rows') or [])
    for row_index, item in enumerate(rows, start=header_row + 1):
        values = [
            item.get('element'), item.get('sensor_id'), item.get('start_local'), item.get('end_local'),
            item.get('flow_unit'), item.get('flow_avg'), item.get('flow_min'), item.get('flow_max'),
            item.get('totalizer_open_m3'), item.get('raw_totalizer_close_m3'), item.get('effective_totalizer_close_m3'),
            'Sí' if item.get('totalizer_retained') else 'No', item.get('volume_m3'), item.get('samples'),
            item.get('coverage_pct'), item.get('status'),
        ]
        for column, value in enumerate(values, start=1):
            sheet.cell(row=row_index, column=column, value=value)
        sheet.cell(row=row_index, column=3).number_format = 'yyyy-mm-dd hh:mm'
        sheet.cell(row=row_index, column=4).number_format = 'yyyy-mm-dd hh:mm'
        for column in [6, 7, 8, 9, 10, 11, 13]:
            sheet.cell(row=row_index, column=column).number_format = '0.0000'
        sheet.cell(row=row_index, column=15).number_format = '0.0'

    last_row = max(header_row + 1, header_row + len(rows))
    sheet.auto_filter.ref = f'A{header_row}:P{last_row}'
    sheet.freeze_panes = f'A{header_row + 1}'
    widths = [24, 10, 19, 19, 18, 16, 14, 14, 22, 22, 22, 13, 21, 10, 14, 42]
    for index, width in enumerate(widths, start=1):
        sheet.column_dimensions[get_column_letter(index)].width = width
    sheet.sheet_view.showGridLines = False


def build_insurgentes_five_minute_module_excel(
    *,
    module: Module,
    payloads: list[dict[str, Any]],
    start_date: str,
    end_date: str,
) -> tuple[bytes, str]:
    if not payloads:
        raise ValueError('Selecciona al menos un elemento con sensor de minuto para exportar.')

    workbook = Workbook()
    summary = workbook.active
    summary.title = 'Resumen'
    module_label = _module_label(module)
    summary['A1'] = f'ARCA Las Fuentes — {module_label} — Excel 5 minutos'
    summary['A1'].font = Font(bold=True, size=14)
    summary.merge_cells('A1:H1')
    summary['A2'] = 'Rango local'
    summary['B2'] = f'{start_date} a {end_date}'
    summary['D2'] = 'Intervalo'
    summary['E2'] = '5 minutos'
    summary['G2'] = 'Elementos'
    summary['H2'] = len(payloads)

    headers = [
        'Elemento', 'Sensor', 'Volumen 5 min sumado (m³)', 'Apertura inicial (m³)',
        'Cierre efectivo final (m³)', 'Delta totalizador (m³)', 'Diferencia (m³)', 'Bloques válidos / totales',
    ]
    for column, header in enumerate(headers, start=1):
        cell = summary.cell(row=4, column=column, value=header)
        cell.font = Font(bold=True, color='FFFFFF')
        cell.fill = PatternFill(fill_type='solid', fgColor='1F4E78')
        cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)

    for row_index, payload in enumerate(payloads, start=5):
        rows = list(payload.get('rows') or [])
        values = _reconciliation_values(rows)
        row = [
            payload.get('name'), payload.get('sensor_id'), values['sum_volume'], values['first_open'],
            values['last_close'], values['totalizer_delta'], values['difference'],
            f"{values['valid_blocks']} / {values['total_blocks']}",
        ]
        for column, value in enumerate(row, start=1):
            summary.cell(row=row_index, column=column, value=value)
        for column in range(3, 8):
            summary.cell(row=row_index, column=column).number_format = '0.0000'

        sheet = workbook.create_sheet(_unique_sheet_title(workbook, str(payload.get('name') or payload.get('sensor_id') or 'Elemento')))
        _write_five_minute_payload_sheet(sheet, payload)

    summary.column_dimensions['A'].width = 28
    summary.column_dimensions['B'].width = 12
    for column in ['C', 'D', 'E', 'F', 'G']:
        summary.column_dimensions[column].width = 24
    summary.column_dimensions['H'].width = 22
    summary.freeze_panes = 'A5'
    summary.sheet_view.showGridLines = False

    note_row = 6 + len(payloads)
    summary.cell(row=note_row, column=1, value='Nota').font = Font(bold=True)
    summary.cell(
        row=note_row,
        column=2,
        value='Cada hoja conserva la misma conciliación de apertura/cierre usada por el histórico individual de 5 minutos.',
    )
    summary.merge_cells(start_row=note_row, start_column=2, end_row=note_row, end_column=8)

    buffer = BytesIO()
    workbook.save(buffer)
    filename = f'ARCA_Las_Fuentes_{_safe_filename_token(module_label)}_5min_{start_date}_{end_date}.xlsx'
    return buffer.getvalue(), filename


def export_insurgentes_five_minute_module_excel(
    *,
    module: str,
    sensor_ids: list[int],
    start_date: Any,
    end_date: Any,
) -> tuple[bytes, str]:
    typed_module = _validate_module(module)
    unique_ids: list[int] = []
    for raw in sensor_ids:
        sensor_id = int(raw)
        if sensor_id not in unique_ids:
            unique_ids.append(sensor_id)
    if not unique_ids:
        raise ValueError('Selecciona al menos un elemento con sensor de minuto para exportar.')
    if len(unique_ids) > 24:
        raise ValueError('La exportación por módulo permite un máximo de 24 elementos por archivo.')

    # Valida una sola vez el rango para devolver el mismo mensaje que la exportación individual.
    export_range = _export_range(start_date, end_date)
    payloads = [
        get_insurgentes_five_minute_export_data(
            module=typed_module,
            sensor_id=sensor_id,
            start_date=export_range.start_day,
            end_date=export_range.end_day,
        )
        for sensor_id in unique_ids
    ]
    return build_insurgentes_five_minute_module_excel(
        module=typed_module,
        payloads=payloads,
        start_date=export_range.start_day.isoformat(),
        end_date=export_range.end_day.isoformat(),
    )
