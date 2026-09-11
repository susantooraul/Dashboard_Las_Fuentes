from __future__ import annotations

from datetime import datetime, timedelta
from random import Random

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.measurement import Measurement

SECTIONS = {
    'dashboard': ['Línea 1', 'Línea 2', 'Línea 3', 'Refrigeración', 'Jarabes', 'Auxiliares', 'Pozos', 'Alumbrado', 'TAG', 'PTAR'],
    'subestacion': ['Subestación Principal'],
    'transformadores': ['TR-01', 'TR-02', 'TR-03', 'TR-04', 'TR-05'],
    'linea1': ['Línea 1'],
    'linea2': ['Línea 2'],
    'linea3': ['Línea 3'],
    'lavadoras': ['Lavadoras'],
    'alumbrado': ['Alumbrado'],
    'auxiliares': ['Auxiliares'],
    'transporte': ['Taller Transporte', 'Estación de Gasolina'],
    'tag': ['Bombas Hidro-Const', 'Tratamiento de Aguas', 'Filtro Carbon', 'Bombas Mejoradas'],
    'ptar': ['CCM Tratamiento de Aguas', 'Planta Tratamiento de Aguas', 'Refrigeración', 'Compresor de Aire', 'Cto Interno'],
    'refrigeracion': ['Refrigeración'],
    'pozos': ['Pozos'],
    'jarabes': ['Jarabes'],
}

DEMO_WINDOW_DAYS = 45
MIN_ACCEPTABLE_WINDOW_DAYS = 21
STALE_DATA_TOLERANCE_DAYS = 7


def _dataset_summary(db: Session) -> tuple[int, datetime | None, datetime | None]:
    count, min_ts, max_ts = db.execute(
        select(func.count(Measurement.id), func.min(Measurement.timestamp), func.max(Measurement.timestamp))
    ).one()
    return int(count or 0), min_ts, max_ts


def _needs_refresh(count: int, min_ts: datetime | None, max_ts: datetime | None) -> bool:
    if count == 0 or min_ts is None or max_ts is None:
        return True
    span_days = (max_ts - min_ts).total_seconds() / 86400
    if span_days < MIN_ACCEPTABLE_WINDOW_DAYS:
        return True
    if max_ts < datetime.now() - timedelta(days=STALE_DATA_TOLERANCE_DAYS):
        return True
    return False


def _clear_measurements(db: Session) -> None:
    db.query(Measurement).delete()
    db.commit()


def _seed_measurements(db: Session) -> None:
    rng = Random(42)
    end_date = datetime.now().replace(minute=0, second=0, microsecond=0)
    start_date = end_date - timedelta(days=DEMO_WINDOW_DAYS - 1)
    rows: list[Measurement] = []

    total_hours = DEMO_WINDOW_DAYS * 24
    for offset in range(total_hours):
        ts = start_date + timedelta(hours=offset)
        day_index = offset // 24
        hour = ts.hour
        weekday = ts.weekday()
        weekend_factor = 0.78 if weekday >= 5 else 1.0
        seasonal_factor = 1 + (day_index / max(DEMO_WINDOW_DAYS - 1, 1)) * 0.08
        intraday_factor = 1 + max(0, 1 - ((hour - 14) ** 2) / 49) * 0.35

        for section, systems in SECTIONS.items():
            for idx, system in enumerate(systems, start=1):
                system_factor = 0.58 + idx * 0.08
                base_kw = max(18, 185 * seasonal_factor * intraday_factor * weekend_factor + rng.randint(-15, 18))
                kw = round(base_kw * system_factor, 2)
                kwh = round(kw * (0.92 + rng.random() * 0.14), 2)
                kvarh = round(kwh * (0.12 + rng.random() * 0.16), 2)
                voltage = round(470 + idx * 2.8 + rng.uniform(-3.5, 3.5), 2)
                current = round((kw * 1000) / max(voltage, 1) * 1.3, 2)
                power_factor = round(0.89 + rng.random() * 0.08, 3)
                cost_mxn = round(kwh * 2.85, 2)
                status = 'normal'
                if section == 'linea1' and hour in {8, 9, 10, 18, 19}:
                    status = 'alert'
                elif section == 'subestacion' and hour in {13, 14} and weekday < 5 and rng.random() > 0.65:
                    status = 'warning'

                rows.append(
                    Measurement(
                        section=section,
                        system_name=system,
                        timestamp=ts,
                        kw=kw,
                        kwh=kwh,
                        kvarh=kvarh,
                        voltage=voltage,
                        current=current,
                        power_factor=power_factor,
                        cost_mxn=cost_mxn,
                        status=status,
                    )
                )

    if rows:
        db.add_all(rows)
        db.commit()


def seed_if_empty(db: Session) -> None:
    count, min_ts, max_ts = _dataset_summary(db)
    if _needs_refresh(count, min_ts, max_ts):
        _clear_measurements(db)
        _seed_measurements(db)
