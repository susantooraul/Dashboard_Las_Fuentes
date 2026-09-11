"""Conciliacion temporal y contrato de calidad para Planta Las Fuentes.

Incremental 02.

Este modulo centraliza la semantica [T0, T1), las fronteras de totalizador y
los estados de calidad. No inventa una fecha universal de validez hidraulica:
trabaja sobre las lecturas disponibles y conserva explicito cuando falta una
frontera real anterior al periodo.

Evidencia SQL usada (02/09/2026):
- iot.readings_minute es local para 1001..2014 y UTC para 3002/3004;
- ceros intermedios en 2002/2004/2006/2008/2012 son dropouts del totalizador;
- 1101/1151 contienen un pico positivo aislado de arranque seguido por una
  caida positiva enorme, por lo que las transiciones entre lecturas positivas
  deben auditarse y no solo MAX-MIN.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Iterable
from zoneinfo import ZoneInfo

from app.services.insurgentes_config import (
    LOCAL_TIMEZONE,
    MAX_TECHNICAL_PERIOD_DELTA_M3,
    READINGS_MINUTE_TIMESTAMP_MODE_BY_SENSOR,
)

LOCAL_ZONE = ZoneInfo(LOCAL_TIMEZONE)

QUALITY_VALIDATED = "validated"
QUALITY_VALID_ZERO = "valid_zero"
QUALITY_PARTIAL = "partial"
QUALITY_REVIEW = "review"
QUALITY_NO_DATA = "no_data"

QUALITY_LABELS = {
    QUALITY_VALIDATED: "Validado",
    QUALITY_VALID_ZERO: "Cero válido",
    QUALITY_PARTIAL: "Cobertura parcial",
    QUALITY_REVIEW: "Dato en revisión",
    QUALITY_NO_DATA: "Sin datos",
}

OPENING_PREVIOUS = "previous_valid_reading"
OPENING_FIRST_PERIOD = "first_period_reading"
OPENING_MISSING = "missing_previous_reading"


def _number(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed == parsed else None


def _datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if value in (None, ""):
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def is_valid_totalizer_boundary(value: Any) -> bool:
    """Return whether a totalizer can be used as an analytical boundary.

    For Insurgentes, SQL evidence shows that 0 can be a transient acquisition
    dropout or a pre-commissioning placeholder. Therefore zero is never used as
    opening/closing boundary. This does *not* mean flow=0 is invalid: flow zero
    remains a valid sample and can produce a validated zero-volume interval when
    two trustworthy positive totalizer boundaries exist.
    """
    parsed = _number(value)
    return parsed is not None and parsed > 0


def normalize_readings_minute_timestamp(sensor_id: int, value: Any) -> datetime | None:
    """Normalize a minute-source timestamp to Insurgentes operational local time."""
    stamp = _datetime(value)
    if stamp is None:
        return None
    mode = READINGS_MINUTE_TIMESTAMP_MODE_BY_SENSOR.get(int(sensor_id), "local")
    if stamp.tzinfo is not None:
        if mode == "utc":
            return stamp.astimezone(LOCAL_ZONE).replace(tzinfo=None)
        return stamp.astimezone(LOCAL_ZONE).replace(tzinfo=None)
    if mode == "utc":
        return stamp.replace(tzinfo=timezone.utc).astimezone(LOCAL_ZONE).replace(tzinfo=None)
    return stamp.replace(tzinfo=None)


def readings_minute_sql_offset_minutes(sensor_ids: Iterable[int], reference: datetime) -> int | None:
    """Return one SQL UTC->local offset when all requested sensors share a mode.

    Current operational modules are homogeneous (wells/lines local, flows UTC).
    A mixed set returns None so callers can use a CASE by sensor instead.
    """
    modes = {READINGS_MINUTE_TIMESTAMP_MODE_BY_SENSOR.get(int(item), "local") for item in sensor_ids}
    if modes == {"local"}:
        return 0
    if modes == {"utc"}:
        aware_local = reference.replace(tzinfo=LOCAL_ZONE)
        offset = aware_local.utcoffset() or timedelta(0)
        return int(offset.total_seconds() // 60)
    return None


def readings_minute_operational_ts_sql(alias: str, sensor_ids: Iterable[int], reference: datetime) -> str:
    """Build SQL Server expression that exposes operational local time once.

    The offset is derived from the configured IANA timezone in Python. For a
    mixed sensor set a CASE is used only for the audited UTC channels.
    """
    ids = sorted({int(item) for item in sensor_ids})
    raw = f"COALESCE({alias}.ts_local, {alias}.ts_minute, {alias}.inserted_at)"
    offset = readings_minute_sql_offset_minutes(ids, reference)
    if offset == 0:
        return raw
    if offset is not None:
        return f"DATEADD(minute, {offset}, {raw})"

    utc_ids = [item for item in ids if READINGS_MINUTE_TIMESTAMP_MODE_BY_SENSOR.get(item) == "utc"]
    if not utc_ids:
        return raw
    aware_local = reference.replace(tzinfo=LOCAL_ZONE)
    mixed_offset = int((aware_local.utcoffset() or timedelta(0)).total_seconds() // 60)
    id_sql = ", ".join(str(item) for item in utc_ids)
    return f"CASE WHEN {alias}.sensor_id IN ({id_sql}) THEN DATEADD(minute, {mixed_offset}, {raw}) ELSE {raw} END"


def _flow_stats(period_rows: list[dict[str, Any]]) -> tuple[float | None, float | None, float | None, int]:
    values = [_number(row.get("instant_value")) for row in period_rows]
    valid = [float(value) for value in values if value is not None and value >= 0]
    if not valid:
        return None, None, None, 0
    return sum(valid) / len(valid), min(valid), max(valid), sum(1 for value in valid if value > 0)


def _expected_coverage(samples: int, expected_samples: int | None) -> float | None:
    if expected_samples is None or expected_samples <= 0:
        return None
    return round(min(max(samples, 0) / expected_samples * 100.0, 100.0), 2)


def assess_interval(
    *,
    samples: int,
    flow_samples: int,
    flow_avg: float | None,
    flow_min: float | None,
    flow_max: float | None,
    opening: float | None,
    opening_source: str,
    first_period_total: float | None,
    raw_close: float | None,
    effective_close: float | None,
    negative_transitions: int = 0,
    impossible_jumps: int = 0,
    coverage_pct: float | None = None,
    last_sample_ts: datetime | str | None = None,
) -> dict[str, Any]:
    """Apply the common hydraulic/quality contract to one reconciled interval."""
    has_samples = samples > 0
    boundary_complete = opening_source == OPENING_PREVIOUS and opening is not None and effective_close is not None
    retained = bool(raw_close == 0 and effective_close is not None and effective_close > 0)

    transition_negative = negative_transitions
    transition_jumps = impossible_jumps
    if opening is not None and first_period_total is not None:
        first_delta = first_period_total - opening
        if first_delta < 0:
            transition_negative += 1
        elif first_delta > MAX_TECHNICAL_PERIOD_DELTA_M3:
            transition_jumps += 1

    volume: float | None = None
    observed_volume: float | None = None
    if opening is not None and effective_close is not None:
        delta = effective_close - opening
        if 0 <= delta <= MAX_TECHNICAL_PERIOD_DELTA_M3:
            observed_volume = round(delta, 4)

    review_reason: str | None = None
    if transition_negative > 0:
        review_reason = "negative_totalizer_transition"
    elif transition_jumps > 0:
        review_reason = "impossible_totalizer_jump"
    elif opening is not None and effective_close is not None and observed_volume is None:
        review_reason = "invalid_period_delta"
    elif retained and (flow_avg or 0) > 0:
        review_reason = "totalizer_retained_while_flowing"

    if not has_samples:
        quality_status = QUALITY_NO_DATA
        data_status = "no_data"
    elif review_reason:
        quality_status = QUALITY_REVIEW
        data_status = "totalizer_retained" if review_reason == "totalizer_retained_while_flowing" else "invalid_totalizer"
    elif opening is None or effective_close is None:
        quality_status = QUALITY_REVIEW
        data_status = "missing_totalizer"
        review_reason = "missing_totalizer_boundary"
    elif not boundary_complete:
        quality_status = QUALITY_PARTIAL
        data_status = "partial"
    elif coverage_pct is not None and coverage_pct < 100.0:
        quality_status = QUALITY_PARTIAL
        data_status = "partial"
    elif observed_volume == 0 and (flow_avg or 0) == 0:
        quality_status = QUALITY_VALID_ZERO
        data_status = "zero_consumption"
    else:
        quality_status = QUALITY_VALIDATED
        data_status = "operational"

    volume_reliable = bool(
        boundary_complete
        and observed_volume is not None
        and review_reason is None
    )
    if volume_reliable:
        volume = observed_volume

    return {
        "samples": int(samples),
        "flow_samples": int(flow_samples),
        "coverage_pct": coverage_pct,
        "flow_avg_lps": round(flow_avg, 4) if flow_avg is not None else None,
        "flow_min_lps": round(flow_min, 4) if flow_min is not None else None,
        "flow_max_lps": round(flow_max, 4) if flow_max is not None else None,
        "totalizer_open_m3": round(opening, 4) if opening is not None else None,
        "raw_totalizer_close_m3": round(raw_close, 4) if raw_close is not None else None,
        "totalizer_close_m3": round(effective_close, 4) if effective_close is not None else None,
        "effective_totalizer_close_m3": round(effective_close, 4) if effective_close is not None else None,
        "totalizer_retained": retained,
        "observed_volume_m3": observed_volume,
        "volume_m3": volume,
        "volume_reliable": volume_reliable,
        "opening_source": opening_source,
        "boundary_complete": boundary_complete,
        "data_status": data_status,
        "quality_status": quality_status,
        "quality_label": QUALITY_LABELS[quality_status],
        "review_reason": review_reason,
        "negative_totalizer_transitions": int(transition_negative),
        "impossible_totalizer_jumps": int(transition_jumps),
        "last_sample_ts": last_sample_ts,
    }


def reconcile_interval(
    rows: Iterable[dict[str, Any]],
    t0: datetime,
    t1: datetime,
    *,
    expected_samples: int | None = None,
) -> dict[str, Any]:
    """Reconcile raw/normalized rows using strict semi-open boundaries [T0,T1)."""
    if t1 <= t0:
        raise ValueError("T1 debe ser posterior a T0.")

    normalized: list[dict[str, Any]] = []
    for source in rows:
        stamp = source.get("timestamp")
        if not isinstance(stamp, datetime):
            stamp = _datetime(stamp)
        if stamp is None:
            continue
        if stamp.tzinfo is not None:
            stamp = stamp.astimezone(LOCAL_ZONE).replace(tzinfo=None)
        item = dict(source)
        item["timestamp"] = stamp.replace(tzinfo=None)
        normalized.append(item)
    normalized.sort(key=lambda item: item["timestamp"])

    previous_candidates = [
        row for row in normalized
        if row["timestamp"] < t0 and is_valid_totalizer_boundary(row.get("total_value"))
    ]
    previous = previous_candidates[-1] if previous_candidates else None
    period_rows = [row for row in normalized if t0 <= row["timestamp"] < t1]
    valid_period_totals = [row for row in period_rows if is_valid_totalizer_boundary(row.get("total_value"))]

    if previous is not None:
        opening = _number(previous.get("total_value"))
        opening_source = OPENING_PREVIOUS
    elif valid_period_totals:
        opening = _number(valid_period_totals[0].get("total_value"))
        opening_source = OPENING_FIRST_PERIOD
    else:
        opening = None
        opening_source = OPENING_MISSING

    first_period_total = _number(valid_period_totals[0].get("total_value")) if valid_period_totals else None
    effective_close = _number(valid_period_totals[-1].get("total_value")) if valid_period_totals else None
    raw_total_rows = [row for row in period_rows if _number(row.get("total_value")) is not None]
    raw_close = _number(raw_total_rows[-1].get("total_value")) if raw_total_rows else None

    negative = 0
    jumps = 0
    for left, right in zip(valid_period_totals, valid_period_totals[1:]):
        left_total = _number(left.get("total_value"))
        right_total = _number(right.get("total_value"))
        if left_total is None or right_total is None:
            continue
        delta = right_total - left_total
        if delta < 0:
            negative += 1
        elif delta > MAX_TECHNICAL_PERIOD_DELTA_M3:
            jumps += 1

    flow_avg, flow_min, flow_max, _active = _flow_stats(period_rows)
    flow_samples = sum(1 for row in period_rows if _number(row.get("instant_value")) is not None)
    observed_minutes = {
        row["timestamp"].replace(second=0, microsecond=0)
        for row in period_rows
        if isinstance(row.get("timestamp"), datetime)
    }
    samples = len(observed_minutes)
    coverage = _expected_coverage(samples, expected_samples)
    last_sample = period_rows[-1]["timestamp"] if period_rows else None

    return assess_interval(
        samples=samples,
        flow_samples=flow_samples,
        flow_avg=flow_avg,
        flow_min=flow_min,
        flow_max=flow_max,
        opening=opening,
        opening_source=opening_source,
        first_period_total=first_period_total,
        raw_close=raw_close,
        effective_close=effective_close,
        negative_transitions=negative,
        impossible_jumps=jumps,
        coverage_pct=coverage,
        last_sample_ts=last_sample,
    )
