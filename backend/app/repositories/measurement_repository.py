from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from types import SimpleNamespace
from typing import Any, List

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.measurement import Measurement

settings = get_settings()

TRANSFORMER_MAP = {
    'transformador1': 'TR-01',
    'transformador2': 'TR-02',
    'transformador3': 'TR-03',
    'transformador4': 'TR-04',
    'transformador5': 'TR-05',
}

PRETTY_NAME_MAP = {
    'TR-01': 'Transformador 1',
    'TR-02': 'Transformador 2',
    'TR-03': 'Transformador 3',
    'TR-04': 'Transformador 4',
    'TR-05': 'Transformador 5',
}


def _to_float(value: Any) -> float:
    if value is None:
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


@dataclass
class MeasurementRecord:
    timestamp: datetime
    section: str
    system_name: str
    kw: float
    kwh: float
    kvarh: float
    voltage: float
    current: float
    power_factor: float
    cost_mxn: float
    status: str


def _pretty_name(name: str) -> str:
    return PRETTY_NAME_MAP.get(name, name)


def _normalize_record_data(item: Any) -> dict[str, Any]:
    return {
        'timestamp': item.timestamp,
        'section': item.section,
        'system_name': _pretty_name(item.system_name),
        'kw': _to_float(item.kw),
        'kwh': _to_float(item.kwh),
        'kvarh': _to_float(item.kvarh),
        'voltage': _to_float(item.voltage),
        'current': _to_float(item.current),
        'power_factor': _to_float(item.power_factor),
        'cost_mxn': _to_float(getattr(item, 'cost_mxn', 0)),
        'status': getattr(item, 'status', None) or 'NORMAL',
    }


def _to_record(item: Any) -> MeasurementRecord:
    return MeasurementRecord(**_normalize_record_data(item))


class MeasurementRepository:
    def __init__(self, db: Session):
        self.db = db

    def fetch_rows(self, section: str, start_dt: datetime | None = None, end_dt: datetime | None = None) -> List[MeasurementRecord]:
        if settings.db_mode.lower() == 'sqlserver' and settings.sqlserver_source_mode.lower() == 'table':
            sql_section = 'subestacion' if section == 'alertas' else section
            return self._fetch_from_sqlserver_table(sql_section, start_dt, end_dt)
        return self._fetch_from_local_table(section, start_dt, end_dt)

    def fetch_transformer_totals(self, start_dt: datetime | None = None, end_dt: datetime | None = None) -> list[dict[str, float | str]]:
        rows = self.fetch_rows('transformadores', start_dt, end_dt)
        totals: dict[str, dict[str, float | str]] = {}
        for row in rows:
            item = totals.setdefault(row.system_name, {'name': row.system_name, 'kwh': 0.0, 'kw': 0.0, 'current': 0.0})
            item['kwh'] = _to_float(item['kwh']) + _to_float(row.kwh)
            item['kw'] = max(_to_float(item['kw']), _to_float(row.kw))
            item['current'] = max(_to_float(item['current']), _to_float(row.current))
        return [
            {
                'name': item['name'],
                'kwh': round(_to_float(item['kwh']), 2),
                'kw': round(_to_float(item['kw']), 2),
                'current': round(_to_float(item['current']), 2),
            }
            for _, item in sorted(totals.items(), key=lambda pair: pair[0])
        ]

    def _fetch_from_local_table(self, section: str, start_dt: datetime | None = None, end_dt: datetime | None = None) -> List[MeasurementRecord]:
        stmt = select(Measurement).order_by(Measurement.timestamp.asc(), Measurement.system_name.asc())
        if section == 'dashboard':
            pass
        elif section in TRANSFORMER_MAP:
            stmt = stmt.where(Measurement.section == 'transformadores', Measurement.system_name == TRANSFORMER_MAP[section])
        else:
            stmt = stmt.where(Measurement.section == section)
        if start_dt:
            stmt = stmt.where(Measurement.timestamp >= start_dt)
        if end_dt:
            stmt = stmt.where(Measurement.timestamp <= end_dt)
        return [_to_record(item) for item in self.db.execute(stmt).scalars().all()]

    def _fetch_from_sqlserver_table(self, section: str, start_dt: datetime | None = None, end_dt: datetime | None = None) -> List[MeasurementRecord]:
        table_name = settings.sqlserver_source_table
        where_parts: list[str] = []
        params: dict[str, object] = {}
        if section == 'dashboard':
            pass
        elif section in TRANSFORMER_MAP:
            where_parts.extend(['[section] = :section', '[system_name] = :system_name'])
            params = {'section': 'transformadores', 'system_name': TRANSFORMER_MAP[section]}
        else:
            where_parts.append('[section] = :section')
            params = {'section': section}
        if start_dt is not None:
            where_parts.append('[timestamp] >= :start_dt')
            params['start_dt'] = start_dt
        if end_dt is not None:
            where_parts.append('[timestamp] <= :end_dt')
            params['end_dt'] = end_dt
        where_clause = f"WHERE {' AND '.join(where_parts)}" if where_parts else ''

        stmt = text(
            f'''
            SELECT
                [timestamp],
                [section],
                [system_name],
                [kw],
                [kwh],
                [kvarh],
                [voltage],
                [current],
                [power_factor],
                ISNULL([cost_mxn], 0) AS cost_mxn,
                ISNULL([status], 'NORMAL') AS status
            FROM {table_name}
            {where_clause}
            ORDER BY [timestamp] ASC, [system_name] ASC
            '''
        )
        result = self.db.execute(stmt, params).mappings().all()
        return [MeasurementRecord(**_normalize_record_data(SimpleNamespace(**row))) for row in result]
