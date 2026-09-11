from __future__ import annotations

import json
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import HTTPException, UploadFile

from app.schemas.water import WaterSourceInfo, WaterSourceValidation

ROOT_DIR = Path(__file__).resolve().parents[3]
STORAGE_DIR = ROOT_DIR / 'water_sources'
SOURCES_DIR = STORAGE_DIR / 'sources'
UPLOADS_DIR = STORAGE_DIR / 'uploads'
REGISTRY_PATH = STORAGE_DIR / 'registry.json'


def _ensure_storage() -> None:
    SOURCES_DIR.mkdir(parents=True, exist_ok=True)
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    if not REGISTRY_PATH.exists():
        REGISTRY_PATH.write_text(json.dumps({'active_source_id': None, 'sources': []}, indent=2), encoding='utf-8')


def _utcnow() -> str:
    return datetime.utcnow().isoformat()


def _read_registry() -> dict[str, Any]:
    _ensure_storage()
    try:
        return json.loads(REGISTRY_PATH.read_text(encoding='utf-8'))
    except json.JSONDecodeError:
        return {'active_source_id': None, 'sources': []}


def _write_registry(data: dict[str, Any]) -> None:
    _ensure_storage()
    REGISTRY_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')


def _to_number(value: Any, default: float = 0) -> float:
    if value is None or value == '':
        return default
    if isinstance(value, (int, float)):
        return float(value)
    cleaned = str(value).strip().replace(',', '')
    try:
        return float(cleaned)
    except ValueError:
        return default


def _slug(value: str) -> str:
    text = re.sub(r'[^a-zA-Z0-9_-]+', '-', value.strip().lower()).strip('-')
    return text or f'source-{uuid4().hex[:8]}'


def _metric_from_any(item: Any, index: int, default_unit: str = 'm³') -> dict[str, Any]:
    if isinstance(item, dict):
        return {
            'name': str(item.get('name') or item.get('nombre') or item.get('label') or f'Métrica {index + 1}'),
            'value': _to_number(item.get('value', item.get('valor', item.get('m3', item.get('volume_m3', 0))))),
            'unit': str(item.get('unit') or item.get('unidad') or default_unit),
            'detail': str(item.get('detail') or item.get('detalle') or ''),
        }
    return {'name': f'Métrica {index + 1}', 'value': _to_number(item), 'unit': default_unit, 'detail': ''}


def _normalize_sensor(raw: dict[str, Any], well_id: str | None, index: int) -> dict[str, Any]:
    sid = str(raw.get('id') or raw.get('sensor_id') or raw.get('tag') or f'{well_id or "sensor"}-{index + 1}')
    return {
        'id': sid,
        'name': str(raw.get('name') or raw.get('nombre') or raw.get('tag') or sid),
        'type': str(raw.get('type') or raw.get('tipo') or raw.get('sensor_type') or 'sensor'),
        'unit': str(raw.get('unit') or raw.get('unidad') or ''),
        'value': _to_number(raw.get('value', raw.get('valor', raw.get('actual_value', 0)))),
        'well_id': well_id,
    }


def _normalize_well(raw: dict[str, Any], index: int) -> dict[str, Any]:
    wid = str(raw.get('id') or raw.get('well_id') or raw.get('pozo_id') or f'pozo-{index + 1}')
    name = str(raw.get('name') or raw.get('nombre') or raw.get('well_name') or raw.get('pozo') or f'Pozo {index + 1}')
    sensors = [_normalize_sensor(sensor, wid, sidx) for sidx, sensor in enumerate(raw.get('sensors') or raw.get('sensores') or []) if isinstance(sensor, dict)]
    return {
        'id': wid,
        'name': name,
        'entry_m3': _to_number(raw.get('entry_m3', raw.get('entrada_m3', raw.get('value', raw.get('valor', 0))))),
        'supply_hours': _to_number(raw.get('supply_hours', raw.get('horas_suministro', raw.get('hours', 0)))),
        'active': bool(raw.get('active', raw.get('activo', True))),
        'sensors': sensors,
    }


def _normalize_tank(raw: dict[str, Any], index: int) -> dict[str, Any]:
    volume = _to_number(raw.get('volume_m3', raw.get('m3', raw.get('volumen', 0))))
    capacity = _to_number(raw.get('capacity_m3', raw.get('capacidad', 0)))
    fill_pct = _to_number(raw.get('fill_pct', raw.get('llenado', (volume / capacity * 100 if capacity else 0))))
    return {
        'name': str(raw.get('name') or raw.get('nombre') or f'Tanque {index + 1}'),
        'volume_m3': volume,
        'height_m': _to_number(raw.get('height_m', raw.get('metros', raw.get('altura_m', 0)))) ,
        'capacity_m3': capacity,
        'fill_pct': fill_pct,
        'status': str(raw.get('status') or raw.get('estado') or ('Normal' if fill_pct >= 50 else 'Atención')),
    }


def _normalize_payload(data: dict[str, Any]) -> tuple[dict[str, Any], list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    if not isinstance(data, dict):
        return {}, ['El archivo JSON debe contener un objeto raíz.'], []

    wells_raw = data.get('wells') or data.get('pozos') or []
    if not isinstance(wells_raw, list):
        errors.append('El campo wells/pozos debe ser una lista.')
        wells_raw = []

    wells = [_normalize_well(item, idx) for idx, item in enumerate(wells_raw) if isinstance(item, dict)]
    if not wells:
        warnings.append('La fuente no contiene pozos. El dashboard mostrará estado vacío hasta cargar datos.')

    seen = set()
    deduped_wells = []
    for well in wells:
        if well['id'] in seen:
            warnings.append(f"Pozo duplicado omitido: {well['id']}")
            continue
        seen.add(well['id'])
        deduped_wells.append(well)
    wells = deduped_wells

    sensors = []
    for well in wells:
        sensors.extend(well.get('sensors', []))
    for idx, raw in enumerate(data.get('sensors') or data.get('sensores') or []):
        if isinstance(raw, dict):
            sensors.append(_normalize_sensor(raw, raw.get('well_id') or raw.get('pozo_id'), idx))

    consumption_raw = data.get('water_consumption') or data.get('consumos') or []
    if not isinstance(consumption_raw, list):
        warnings.append('water_consumption/consumos no es lista; se ignoró.')
        consumption_raw = []

    tank_raw = data.get('tank_levels') or data.get('tanques') or []
    if not isinstance(tank_raw, list):
        warnings.append('tank_levels/tanques no es lista; se ignoró.')
        tank_raw = []

    def _list_of_dicts(key: str, alias: str) -> list[dict[str, Any]]:
        value = data.get(key) or data.get(alias) or []
        return value if isinstance(value, list) else []

    normalized = {
        'name': str(data.get('name') or data.get('source_name') or data.get('nombre') or 'Fuente de pozos'),
        'description': str(data.get('description') or data.get('descripcion') or ''),
        'wells': wells,
        'sensors': sensors,
        'water_consumption': [_metric_from_any(item, idx) for idx, item in enumerate(consumption_raw)],
        'tank_levels': [_normalize_tank(item, idx) for idx, item in enumerate(tank_raw) if isinstance(item, dict)],
        'hourly_flow': _list_of_dicts('hourly_flow', 'flujo_horario'),
        'filters_vs_treated': _list_of_dicts('filters_vs_treated', 'filtros_vs_tratada'),
        'cip_weekly': _list_of_dicts('cip_weekly', 'cip_semanal'),
        'entry_vs_exit': _list_of_dicts('entry_vs_exit', 'entradas_vs_salidas'),
        'monthly_averages': _list_of_dicts('monthly_averages', 'promedios_mensuales'),
        'daily_indicators': [_metric_from_any(item, idx) for idx, item in enumerate(data.get('daily_indicators') or data.get('indicadores_diarios') or [])],
        'report_modules': data.get('report_modules') or data.get('modulos_reporte') or [],
    }

    return normalized, errors, warnings


def validate_water_source_payload(data: dict[str, Any]) -> WaterSourceValidation:
    normalized, errors, warnings = _normalize_payload(data)
    wells = normalized.get('wells', []) if normalized else []
    sensors = normalized.get('sensors', []) if normalized else []
    return WaterSourceValidation(
        valid=not errors,
        errors=errors,
        warnings=warnings,
        wells_count=len(wells),
        sensors_count=len(sensors),
        normalized_preview={
            'name': normalized.get('name'),
            'description': normalized.get('description'),
            'wells': wells[:3],
        } if normalized else None,
    )


async def read_upload_json(file: UploadFile) -> dict[str, Any]:
    filename = file.filename or ''
    if not filename.lower().endswith('.json'):
        raise HTTPException(status_code=400, detail='Formato no permitido. En v1 solo se aceptan fuentes JSON controladas, no SQL arbitrario.')
    content = await file.read()
    try:
        return json.loads(content.decode('utf-8-sig'))
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail='El JSON debe estar codificado en UTF-8.')
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f'JSON inválido: {exc.msg}')


def validate_source_data(data: dict[str, Any]) -> WaterSourceValidation:
    return validate_water_source_payload(data)


def register_source(data: dict[str, Any], file_name: str = '', activate: bool = False) -> WaterSourceInfo:
    validation = validate_water_source_payload(data)
    if not validation.valid:
        raise HTTPException(status_code=400, detail={'errors': validation.errors, 'warnings': validation.warnings})

    normalized, _, warnings = _normalize_payload(data)
    source_id = f"{_slug(normalized['name'])}-{uuid4().hex[:8]}"
    now = _utcnow()
    source_path = SOURCES_DIR / f'{source_id}.json'
    source_path.write_text(json.dumps(normalized, ensure_ascii=False, indent=2), encoding='utf-8')

    registry = _read_registry()
    source_meta = {
        'id': source_id,
        'name': normalized['name'],
        'description': normalized.get('description', ''),
        'status': 'registered' if not warnings else 'registered_with_warnings',
        'created_at': now,
        'updated_at': now,
        'wells_count': validation.wells_count,
        'sensors_count': validation.sensors_count,
        'file_name': file_name,
    }
    registry['sources'].append(source_meta)
    if activate or registry.get('active_source_id') is None:
        registry['active_source_id'] = source_id
    _write_registry(registry)
    return _to_source_info(source_meta, registry.get('active_source_id') == source_id)


async def register_upload(file: UploadFile, activate: bool = False) -> WaterSourceInfo:
    data = await read_upload_json(file)
    _ensure_storage()
    upload_path = UPLOADS_DIR / f'{uuid4().hex}_{Path(file.filename or "water_source.json").name}'
    upload_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    return register_source(data, file_name=file.filename or upload_path.name, activate=activate)


def _to_source_info(meta: dict[str, Any], active: bool) -> WaterSourceInfo:
    return WaterSourceInfo(
        id=meta['id'],
        name=meta.get('name', meta['id']),
        description=meta.get('description', ''),
        status=meta.get('status', 'registered'),
        active=active,
        created_at=datetime.fromisoformat(meta['created_at']),
        updated_at=datetime.fromisoformat(meta['updated_at']),
        wells_count=int(meta.get('wells_count', 0)),
        sensors_count=int(meta.get('sensors_count', 0)),
        file_name=meta.get('file_name', ''),
    )


def list_sources() -> list[WaterSourceInfo]:
    registry = _read_registry()
    active_id = registry.get('active_source_id')
    return [_to_source_info(meta, meta.get('id') == active_id) for meta in registry.get('sources', [])]


def get_active_source_info() -> WaterSourceInfo | None:
    registry = _read_registry()
    active_id = registry.get('active_source_id')
    if not active_id:
        return None
    for meta in registry.get('sources', []):
        if meta.get('id') == active_id:
            return _to_source_info(meta, True)
    return None


def activate_source(source_id: str) -> WaterSourceInfo:
    registry = _read_registry()
    if not any(meta.get('id') == source_id for meta in registry.get('sources', [])):
        raise HTTPException(status_code=404, detail='Fuente de pozos no encontrada')
    registry['active_source_id'] = source_id
    _write_registry(registry)
    source = get_active_source_info()
    if source is None:
        raise HTTPException(status_code=500, detail='No fue posible activar la fuente')
    return source


def load_active_source_payload() -> tuple[dict[str, Any] | None, WaterSourceInfo | None]:
    source = get_active_source_info()
    if source is None:
        return None, None
    source_path = SOURCES_DIR / f'{source.id}.json'
    if not source_path.exists():
        return None, source
    return json.loads(source_path.read_text(encoding='utf-8')), source


def reset_sources_for_tests() -> None:
    if STORAGE_DIR.exists():
        shutil.rmtree(STORAGE_DIR)
