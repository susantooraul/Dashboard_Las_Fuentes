from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Iterable

from sqlalchemy.orm import Session

from app.demo.catalog import get_plant
from app.repositories.measurement_repository import MeasurementRecord, MeasurementRepository
from app.schemas.dashboard import DashboardPayload, DistributionItem, HourlyPoint, KpiCard, TableRow, TransformerItem

BASE_TITLES = {
    'dashboard': ('Dashboard General', 'Monitoreo en tiempo real'),
    'subestacion': ('Subestación Principal', 'Monitoreo maestro de acometida y demanda'),
    'alertas': ('Alertas', 'Configuración de umbrales y visualización'),
    'transformador1': ('Transformador 1', 'Monitoreo dedicado · Principal'),
    'transformador2': ('Transformador 2', 'Monitoreo dedicado · Secundario'),
    'transformador3': ('Transformador 3', 'Monitoreo dedicado · Pico reciente'),
    'transformador4': ('Transformador 4', 'Monitoreo dedicado · Respaldo'),
    'transformador5': ('Transformador 5', 'Monitoreo dedicado · PTAR'),
    'linea1': ('Línea 1', 'Consumo total y calidad de energía'),
    'linea2': ('Línea 2', 'Consumo total y calidad de energía'),
    'linea3': ('Línea 3', 'Consumo total y calidad de energía'),
    'lavadoras': ('Lavadoras', 'Monitoreo energético'),
    'alumbrado': ('Alumbrado', 'Monitoreo energético'),
    'auxiliares': ('Equipos Auxiliares', 'Monitoreo energético'),
    'transporte': ('Transporte', 'Monitoreo energético'),
    'tag': ('TAG', 'Monitoreo energético'),
    'ptar': ('PTAR', 'Monitoreo energético'),
    'refrigeracion': ('Refrigeración', 'Monitoreo energético'),
    'pozos': ('Pozos', 'Monitoreo energético'),
    'jarabes': ('Sala de Jarabes', 'Monitoreo energético'),
}


def _to_float(value) -> float:
    if value is None:
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _plant_label(plant_id: str, section: str) -> str | None:
    plant = get_plant(plant_id)
    for group in plant['menu']:
        for item in group['items']:
            if item['key'] == section:
                return item['label']
    return None


def _sum(rows: Iterable[MeasurementRecord], attr: str) -> float:
    return round(sum(_to_float(getattr(r, attr, 0)) for r in rows), 2)


def _build_cards(rows: list[MeasurementRecord], section: str) -> list[KpiCard]:
    total_kw = f'{_sum(rows, "kw"):.2f}'
    total_kwh = f'{_sum(rows, "kwh"):.2f}'
    avg_pf = f'{(sum(_to_float(r.power_factor) for r in rows) / len(rows)) if rows else 0:.2f}'
    latest_voltage = f'{_to_float(rows[-1].voltage) if rows else 0:.2f}'
    max_current = f'{max((_to_float(r.current) for r in rows), default=0):.2f}'
    latest_status = (rows[-1].status if rows else 'NORMAL').upper()

    if section.startswith('transformador'):
        return [
            KpiCard(label='Energía Acumulada', value=total_kwh, unit='kWh', trend='Histórico del rango', accent='red'),
            KpiCard(label='Potencia Activa', value=f'{max((_to_float(r.kw) for r in rows), default=0):.2f}', unit='kW', trend='Demanda máxima', accent='crimson'),
            KpiCard(label='Corriente Máxima', value=max_current, unit='A', trend='Pico operativo', accent='wine'),
            KpiCard(label='Voltaje', value=latest_voltage, unit='V', trend='Última lectura', accent='brown'),
        ]

    return [
        KpiCard(label='Demanda Total', value=total_kw, unit='kW', trend='Actual', accent='red'),
        KpiCard(label='Energía Hoy', value=total_kwh, unit='kWh', trend='Acumulado diario', accent='crimson'),
        KpiCard(label='Factor de Potencia', value=avg_pf, unit='FP', trend='Promedio', accent='wine'),
        KpiCard(label='Estado', value=latest_status, unit='', trend='Lectura actual', accent='brown'),
    ]


def _build_hourly_data(rows: list[MeasurementRecord]) -> list[HourlyPoint]:
    bucket: dict[str, dict[str, float]] = defaultdict(lambda: {'total': 0.0, 'l1': 0.0, 'l2': 0.0, 'l3': 0.0})
    for row in rows:
        hour = row.timestamp.strftime('%H:00')
        kw = _to_float(row.kw)
        bucket[hour]['total'] += kw
        name = row.system_name.lower()
        if '1' in name or 'a' in name:
            bucket[hour]['l1'] += kw
        elif '2' in name or 'b' in name:
            bucket[hour]['l2'] += kw
        elif '3' in name or 'c' in name:
            bucket[hour]['l3'] += kw
    return [HourlyPoint(hour=h, **{k: round(v, 2) for k, v in vals.items()}) for h, vals in sorted(bucket.items())]


def _build_distribution(rows: list[MeasurementRecord]) -> list[DistributionItem]:
    totals: dict[str, float] = defaultdict(float)
    for row in rows:
        totals[row.system_name] += _to_float(row.kwh)
    return [DistributionItem(name=name, value=round(value, 2)) for name, value in sorted(totals.items(), key=lambda x: x[1], reverse=True)]


def _build_transformers(repo: MeasurementRepository, start_dt: datetime | None = None, end_dt: datetime | None = None) -> list[TransformerItem]:
    return [TransformerItem(**item) for item in repo.fetch_transformer_totals(start_dt, end_dt)]


def get_dashboard_payload(db: Session, plant_id: str, section: str, start_dt: datetime | None = None, end_dt: datetime | None = None) -> DashboardPayload:
    repo = MeasurementRepository(db)
    rows = repo.fetch_rows(section, start_dt, end_dt)
    title, subtitle = BASE_TITLES.get(section, ('Sección', 'Vista base'))
    plant_specific = _plant_label(plant_id, section)
    if plant_specific and section not in {'dashboard', 'subestacion', 'capacidad'}:
        title = plant_specific
    sorted_rows = sorted(rows, key=lambda r: r.timestamp, reverse=True)
    table_rows = [
        TableRow(
            timestamp=row.timestamp,
            section=row.section,
            system_name=row.system_name,
            kw=_to_float(row.kw),
            kwh=_to_float(row.kwh),
            kvarh=_to_float(row.kvarh),
            voltage=_to_float(row.voltage),
            current=_to_float(row.current),
            power_factor=_to_float(row.power_factor),
            status=row.status,
        )
        for row in sorted_rows[:24]
    ]
    return DashboardPayload(
        title=title,
        subtitle=subtitle,
        cards=_build_cards(rows, section),
        hourly_data=_build_hourly_data(rows),
        systems_data=_build_distribution(rows),
        transformer_data=_build_transformers(repo, start_dt, end_dt),
        table_data=table_rows,
        updated_at=max((row.timestamp for row in rows), default=datetime.utcnow()),
    )
