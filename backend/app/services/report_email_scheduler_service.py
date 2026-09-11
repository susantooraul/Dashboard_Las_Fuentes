from __future__ import annotations

import json
import logging
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, time, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from app.config import get_settings
from app.services.email_service import ensure_smtp_configured, send_email_with_bytes_attachments
from app.services.insurgentes_config import LOCAL_TIMEZONE, PLANT_DISPLAY_NAME
from app.services.water_daily_report_service import (
    build_daily_water_report_excel,
    build_daily_water_report_pdf,
    build_interval_water_report_dataset,
    build_report_dataset,
)

logger = logging.getLogger(__name__)
settings = get_settings()
LOCAL_ZONE = ZoneInfo(LOCAL_TIMEZONE)

MODE_24H = 'previous_calendar_day_24h'
MODE_12H = 'fixed_12h_blocks'
ALLOWED_MODES = {MODE_24H, MODE_12H}
ALLOWED_FORMATS = {'pdf', 'excel'}

_SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS report_email_schedules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    period_mode TEXT NOT NULL,
    formats_json TEXT NOT NULL,
    recipients_json TEXT NOT NULL,
    timezone TEXT NOT NULL,
    send_delay_minutes INTEGER NOT NULL DEFAULT 10,
    created_by_user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS report_email_runs (
    id TEXT PRIMARY KEY,
    schedule_id TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    due_at TEXT NOT NULL,
    status TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    trigger_kind TEXT NOT NULL DEFAULT 'scheduled',
    started_at TEXT NULL,
    finished_at TEXT NULL,
    next_retry_at TEXT NULL,
    error_message TEXT NULL,
    message_id TEXT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(schedule_id, period_start, period_end),
    FOREIGN KEY(schedule_id) REFERENCES report_email_schedules(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_report_email_schedules_enabled ON report_email_schedules(enabled);
CREATE INDEX IF NOT EXISTS idx_report_email_runs_schedule ON report_email_runs(schedule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_email_runs_retry ON report_email_runs(status, next_retry_at);
"""


@dataclass(frozen=True)
class PeriodWindow:
    start: datetime
    end: datetime
    due_at: datetime


class ReportEmailScheduleError(RuntimeError):
    pass


class ReportEmailScheduleNotFound(ReportEmailScheduleError):
    pass


class ReportEmailScheduleForbidden(ReportEmailScheduleError):
    pass


def _now_local() -> datetime:
    return datetime.now(LOCAL_ZONE).replace(tzinfo=None)


def _iso(value: datetime | None) -> str | None:
    return value.isoformat(timespec='seconds') if value else None


def _parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    try:
        parsed = datetime.fromisoformat(str(value))
        if parsed.tzinfo is not None:
            parsed = parsed.astimezone(LOCAL_ZONE).replace(tzinfo=None)
        return parsed
    except (TypeError, ValueError):
        return None


def _database_path() -> Path:
    return settings.auth_database_file


def _ensure_scheduler_schema(connection: sqlite3.Connection) -> None:
    required_tables = {'report_email_schedules', 'report_email_runs'}
    existing_tables = {
        str(row['name'])
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ).fetchall()
    }
    if required_tables.issubset(existing_tables):
        return
    missing = sorted(required_tables - existing_tables)
    logger.warning(
        'report scheduler sqlite schema missing; recreating tables missing=%s',
        ','.join(missing) or 'unknown',
    )
    connection.executescript(_SCHEMA)
    connection.commit()


@contextmanager
def _connect():
    path = _database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=10, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute('PRAGMA foreign_keys = ON')
    connection.execute('PRAGMA busy_timeout = 10000')
    _ensure_scheduler_schema(connection)
    try:
        yield connection
    finally:
        connection.close()


def initialize_report_email_scheduler_storage() -> None:
    with _connect() as connection:
        connection.execute('PRAGMA journal_mode = WAL')
        connection.execute('PRAGMA synchronous = NORMAL')
        connection.executescript(_SCHEMA)
        connection.commit()


def _normalize_formats(values: list[str] | None) -> list[str]:
    output: list[str] = []
    for value in values or []:
        item = str(value).lower().strip()
        if item in ALLOWED_FORMATS and item not in output:
            output.append(item)
    if not output:
        raise ReportEmailScheduleError('Selecciona al menos PDF o Excel.')
    return output


def _normalize_recipients(values: list[str] | None) -> list[str]:
    recipients: list[str] = []
    for value in values or []:
        item = str(value).strip()
        if item and item not in recipients:
            recipients.append(item)
    if not recipients:
        raise ReportEmailScheduleError('Captura al menos un destinatario.')
    if len(recipients) > 20:
        raise ReportEmailScheduleError('Máximo 20 destinatarios por programación.')
    return recipients


def _normalize_mode(value: str) -> str:
    mode = str(value or '').strip()
    if mode not in ALLOWED_MODES:
        raise ReportEmailScheduleError('Periodo programado no válido.')
    return mode


def _normalize_delay(value: Any) -> int:
    try:
        delay = int(value)
    except (TypeError, ValueError) as exc:
        raise ReportEmailScheduleError('El retraso de cierre no es válido.') from exc
    if delay < 1 or delay > 60:
        raise ReportEmailScheduleError('El retraso de cierre debe estar entre 1 y 60 minutos.')
    return delay


def _serialize_schedule(row: sqlite3.Row | dict[str, Any], now: datetime | None = None) -> dict[str, Any]:
    data = dict(row)
    formats = json.loads(data.get('formats_json') or '[]')
    recipients = json.loads(data.get('recipients_json') or '[]')
    schedule = {
        'id': str(data['id']),
        'name': str(data['name']),
        'enabled': bool(data['enabled']),
        'period_mode': str(data['period_mode']),
        'formats': formats,
        'recipients': recipients,
        'timezone': str(data.get('timezone') or LOCAL_TIMEZONE),
        'send_delay_minutes': int(data.get('send_delay_minutes') or 10),
        'created_by_user_id': int(data['created_by_user_id']),
        'created_at': data.get('created_at'),
        'updated_at': data.get('updated_at'),
    }
    schedule['next_run_at'] = _iso(_next_due_for_schedule(schedule, now or _now_local())) if schedule['enabled'] else None
    return schedule


def _get_schedule_raw(schedule_id: str) -> sqlite3.Row:
    with _connect() as connection:
        row = connection.execute('SELECT * FROM report_email_schedules WHERE id = ?', (schedule_id,)).fetchone()
    if not row:
        raise ReportEmailScheduleNotFound('Programación no encontrada.')
    return row


def _assert_access(row: sqlite3.Row, actor: dict[str, Any], *, admin_only: bool = False) -> None:
    role = str(actor.get('role') or '')
    if role == 'admin':
        return
    if admin_only or role != 'operator' or int(row['created_by_user_id']) != int(actor.get('id') or 0):
        raise ReportEmailScheduleForbidden('No cuenta con permisos para modificar esta programación.')


def list_report_email_schedules(actor: dict[str, Any]) -> list[dict[str, Any]]:
    role = str(actor.get('role') or '')
    with _connect() as connection:
        if role == 'admin':
            rows = connection.execute('SELECT * FROM report_email_schedules ORDER BY created_at DESC').fetchall()
        else:
            rows = connection.execute(
                'SELECT * FROM report_email_schedules WHERE created_by_user_id = ? ORDER BY created_at DESC',
                (int(actor.get('id') or 0),),
            ).fetchall()
    return [_serialize_schedule(row) for row in rows]


def create_report_email_schedule(payload: dict[str, Any], actor: dict[str, Any]) -> dict[str, Any]:
    now = _now_local()
    schedule_id = str(uuid.uuid4())
    name = str(payload.get('name') or '').strip()[:120]
    if not name:
        raise ReportEmailScheduleError('Captura un nombre para la programación.')
    mode = _normalize_mode(str(payload.get('period_mode') or ''))
    formats = _normalize_formats(payload.get('formats'))
    recipients = _normalize_recipients(payload.get('recipients'))
    delay = _normalize_delay(payload.get('send_delay_minutes', 10))
    with _connect() as connection:
        connection.execute(
            """
            INSERT INTO report_email_schedules (
                id, name, enabled, period_mode, formats_json, recipients_json,
                timezone, send_delay_minutes, created_by_user_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                schedule_id, name, int(bool(payload.get('enabled', True))), mode,
                json.dumps(formats), json.dumps(recipients), LOCAL_TIMEZONE, delay,
                int(actor.get('id') or 0), _iso(now), _iso(now),
            ),
        )
        row = connection.execute('SELECT * FROM report_email_schedules WHERE id = ?', (schedule_id,)).fetchone()
        connection.commit()
    return _serialize_schedule(row, now)


def update_report_email_schedule(schedule_id: str, payload: dict[str, Any], actor: dict[str, Any]) -> dict[str, Any]:
    current = _get_schedule_raw(schedule_id)
    _assert_access(current, actor)
    fields: list[str] = []
    values: list[Any] = []
    if payload.get('name') is not None:
        name = str(payload['name']).strip()[:120]
        if not name:
            raise ReportEmailScheduleError('El nombre no puede quedar vacío.')
        fields.append('name = ?'); values.append(name)
    if payload.get('period_mode') is not None:
        fields.append('period_mode = ?'); values.append(_normalize_mode(str(payload['period_mode'])))
    if payload.get('formats') is not None:
        fields.append('formats_json = ?'); values.append(json.dumps(_normalize_formats(payload['formats'])))
    if payload.get('recipients') is not None:
        fields.append('recipients_json = ?'); values.append(json.dumps(_normalize_recipients(payload['recipients'])))
    if payload.get('enabled') is not None:
        fields.append('enabled = ?'); values.append(int(bool(payload['enabled'])))
    if payload.get('send_delay_minutes') is not None:
        fields.append('send_delay_minutes = ?'); values.append(_normalize_delay(payload['send_delay_minutes']))
    if not fields:
        return _serialize_schedule(current)
    fields.append('updated_at = ?'); values.append(_iso(_now_local()))
    values.append(schedule_id)
    with _connect() as connection:
        connection.execute(f"UPDATE report_email_schedules SET {', '.join(fields)} WHERE id = ?", tuple(values))
        row = connection.execute('SELECT * FROM report_email_schedules WHERE id = ?', (schedule_id,)).fetchone()
        connection.commit()
    return _serialize_schedule(row)


def delete_report_email_schedule(schedule_id: str, actor: dict[str, Any]) -> None:
    current = _get_schedule_raw(schedule_id)
    _assert_access(current, actor)
    with _connect() as connection:
        connection.execute('DELETE FROM report_email_schedules WHERE id = ?', (schedule_id,))
        connection.commit()


def list_report_email_runs(schedule_id: str, actor: dict[str, Any], limit: int = 20) -> list[dict[str, Any]]:
    current = _get_schedule_raw(schedule_id)
    _assert_access(current, actor)
    with _connect() as connection:
        rows = connection.execute(
            'SELECT * FROM report_email_runs WHERE schedule_id = ? ORDER BY created_at DESC LIMIT ?',
            (schedule_id, max(1, min(int(limit), 100))),
        ).fetchall()
    return [dict(row) for row in rows]


def _period_for_due(mode: str, due_at: datetime, delay_minutes: int) -> PeriodWindow:
    boundary = due_at - timedelta(minutes=delay_minutes)
    if mode == MODE_24H:
        end = datetime.combine(boundary.date(), time.min)
        start = end - timedelta(days=1)
    else:
        end = boundary.replace(minute=0, second=0, microsecond=0)
        start = end - timedelta(hours=12)
    return PeriodWindow(start=start, end=end, due_at=due_at)


def _recent_due_windows(schedule: dict[str, Any], now: datetime, grace_hours: int | None = None) -> list[PeriodWindow]:
    delay = int(schedule.get('send_delay_minutes') or 10)
    mode = str(schedule.get('period_mode'))
    candidates: list[datetime] = []
    if mode == MODE_24H:
        for day_offset in (0, -1):
            day = now.date() + timedelta(days=day_offset)
            candidates.append(datetime.combine(day, time.min) + timedelta(minutes=delay))
    else:
        for day_offset in (0, -1):
            day = now.date() + timedelta(days=day_offset)
            base = datetime.combine(day, time.min)
            candidates.extend([base + timedelta(minutes=delay), base + timedelta(hours=12, minutes=delay)])
    created_at = _parse_dt(schedule.get('created_at')) or datetime.min
    grace_value = settings.report_email_recovery_grace_hours if grace_hours is None else grace_hours
    grace = timedelta(hours=max(1, int(grace_value)))
    windows: list[PeriodWindow] = []
    for due in sorted(set(candidates)):
        if due > now or now - due > grace or due < created_at:
            continue
        windows.append(_period_for_due(mode, due, delay))
    return windows


def _next_due_for_schedule(schedule: dict[str, Any], now: datetime) -> datetime:
    delay = int(schedule.get('send_delay_minutes') or 10)
    mode = str(schedule.get('period_mode'))
    base = datetime.combine(now.date(), time.min)
    if mode == MODE_24H:
        today_due = base + timedelta(minutes=delay)
        return today_due if now < today_due else today_due + timedelta(days=1)
    first = base + timedelta(minutes=delay)
    second = base + timedelta(hours=12, minutes=delay)
    if now < first:
        return first
    if now < second:
        return second
    return first + timedelta(days=1)


def _latest_closed_window(schedule: dict[str, Any], now: datetime) -> PeriodWindow:
    delay = int(schedule.get('send_delay_minutes') or 10)
    mode = str(schedule.get('period_mode'))
    base = datetime.combine(now.date(), time.min)
    if mode == MODE_24H:
        due = base + timedelta(minutes=delay)
        if now < due:
            due -= timedelta(days=1)
    else:
        due_midnight = base + timedelta(minutes=delay)
        due_noon = base + timedelta(hours=12, minutes=delay)
        if now >= due_noon:
            due = due_noon
        elif now >= due_midnight:
            due = due_midnight
        else:
            due = due_noon - timedelta(days=1)
    return _period_for_due(mode, due, delay)


def _claim_run(schedule: dict[str, Any], window: PeriodWindow, *, trigger_kind: str) -> dict[str, Any] | None:
    now = _now_local()
    max_attempts = max(1, int(settings.report_email_max_attempts))
    with _connect() as connection:
        run_id = str(uuid.uuid4())
        connection.execute(
            """
            INSERT OR IGNORE INTO report_email_runs (
                id, schedule_id, period_start, period_end, due_at, status, attempt,
                trigger_kind, started_at, created_at
            ) VALUES (?, ?, ?, ?, ?, 'running', 1, ?, ?, ?)
            """,
            (run_id, schedule['id'], _iso(window.start), _iso(window.end), _iso(window.due_at), trigger_kind, _iso(now), _iso(now)),
        )
        row = connection.execute(
            'SELECT * FROM report_email_runs WHERE schedule_id = ? AND period_start = ? AND period_end = ?',
            (schedule['id'], _iso(window.start), _iso(window.end)),
        ).fetchone()
        if not row:
            return None
        data = dict(row)
        if data['id'] == run_id:
            connection.commit()
            return data
        if data.get('status') == 'failed' and int(data.get('attempt') or 0) < max_attempts:
            next_retry = _parse_dt(data.get('next_retry_at'))
            if next_retry is None or next_retry <= now:
                updated = connection.execute(
                    """
                    UPDATE report_email_runs
                    SET status = 'running', attempt = attempt + 1, started_at = ?, next_retry_at = NULL
                    WHERE id = ? AND status = 'failed' AND attempt < ?
                    """,
                    (_iso(now), data['id'], max_attempts),
                )
                if updated.rowcount:
                    row = connection.execute('SELECT * FROM report_email_runs WHERE id = ?', (data['id'],)).fetchone()
                    connection.commit()
                    return dict(row)
        return None


def _mark_run_success(run_id: str, message_id: str) -> None:
    now = _now_local()
    with _connect() as connection:
        connection.execute(
            "UPDATE report_email_runs SET status = 'sent', finished_at = ?, next_retry_at = NULL, error_message = NULL, message_id = ? WHERE id = ?",
            (_iso(now), message_id, run_id),
        )
        connection.commit()


def _mark_run_failure(run: dict[str, Any], exc: Exception) -> None:
    now = _now_local()
    attempt = int(run.get('attempt') or 1)
    max_attempts = max(1, int(settings.report_email_max_attempts))
    retry_minutes = max(1, int(settings.report_email_retry_minutes))
    next_retry = now + timedelta(minutes=retry_minutes) if attempt < max_attempts else None
    with _connect() as connection:
        connection.execute(
            "UPDATE report_email_runs SET status = 'failed', finished_at = ?, next_retry_at = ?, error_message = ? WHERE id = ?",
            (_iso(now), _iso(next_retry), str(exc)[:1500], run['id']),
        )
        connection.commit()


def _build_attachments(schedule: dict[str, Any], window: PeriodWindow) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    if schedule['period_mode'] == MODE_24H:
        report = build_report_dataset(report_date=window.start.date().isoformat(), include_history=True, include_comparatives=False)
    else:
        report = build_interval_water_report_dataset(window.start, window.end)
    attachments: list[dict[str, Any]] = []
    for format_name in schedule['formats']:
        if format_name == 'pdf':
            content, filename = build_daily_water_report_pdf(report)
            attachments.append({'bytes': content, 'filename': filename, 'maintype': 'application', 'subtype': 'pdf'})
        elif format_name == 'excel':
            content, filename = build_daily_water_report_excel(report)
            attachments.append({'bytes': content, 'filename': filename, 'maintype': 'application', 'subtype': 'vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
    return report, attachments


def _deliver_window(schedule: dict[str, Any], window: PeriodWindow, *, trigger_kind: str) -> dict[str, Any] | None:
    run = _claim_run(schedule, window, trigger_kind=trigger_kind)
    if not run:
        return None
    try:
        ensure_smtp_configured()
        report, attachments = _build_attachments(schedule, window)
        quality = str((report.get('summary') or {}).get('calidad_periodo') or 'Sin volumen validado')
        if schedule['period_mode'] == MODE_24H:
            subject = f"ARCA | {PLANT_DISPLAY_NAME} | Reporte diario | {window.start.strftime('%d/%m/%Y')}"
        else:
            subject = f"ARCA | {PLANT_DISPLAY_NAME} | Reporte 12 h | {window.start.strftime('%d/%m/%Y %H:%M')}–{window.end.strftime('%H:%M')}"
        message = (
            'Reporte automático de Control Hídrico.\n\n'
            f'Planta: {PLANT_DISPLAY_NAME}\n'
            f'Periodo: {report.get("period_label")}\n'
            f'Calidad: {quality}\n\n'
            'Adjuntos:\n' + '\n'.join(f'- {value.upper()}' for value in schedule['formats'])
        )
        result = send_email_with_bytes_attachments(
            to=schedule['recipients'],
            subject=subject,
            message=message,
            attachments=attachments,
        )
        _mark_run_success(run['id'], result.message_id)
        return {'status': 'sent', 'message_id': result.message_id, 'period_start': _iso(window.start), 'period_end': _iso(window.end)}
    except Exception as exc:
        logger.exception('Fallo en correo programado schedule=%s period=%s..%s', schedule['id'], window.start, window.end)
        _mark_run_failure(run, exc)
        raise


def run_schedule_now(schedule_id: str, actor: dict[str, Any]) -> dict[str, Any]:
    row = _get_schedule_raw(schedule_id)
    _assert_access(row, actor)
    schedule = _serialize_schedule(row)
    window = _latest_closed_window(schedule, _now_local())
    result = _deliver_window(schedule, window, trigger_kind='manual')
    if result is None:
        raise ReportEmailScheduleError('Ese periodo ya fue enviado o está actualmente en proceso.')
    return result


def process_due_report_email_schedules(now: datetime | None = None) -> None:
    current = (now or _now_local()).replace(tzinfo=None)
    with _connect() as connection:
        rows = connection.execute('SELECT * FROM report_email_schedules WHERE enabled = 1 ORDER BY created_at').fetchall()
    schedules = {str(row['id']): _serialize_schedule(row, current) for row in rows}

    for schedule in schedules.values():
        for window in _recent_due_windows(schedule, current):
            try:
                _deliver_window(schedule, window, trigger_kind='scheduled')
            except Exception:
                # El detalle queda persistido en report_email_runs. Continuar con los demás schedules.
                continue

    # Los reintentos no dependen de la ventana de gracia de recuperación. Si el
    # primer intento ya fue reclamado a tiempo, sus reintentos deben completar
    # el ciclo configurado aunque el último quede unos minutos fuera de esa gracia.
    max_attempts = max(1, int(settings.report_email_max_attempts))
    with _connect() as connection:
        failed_rows = connection.execute(
            """
            SELECT * FROM report_email_runs
            WHERE status = 'failed' AND attempt < ? AND next_retry_at IS NOT NULL AND next_retry_at <= ?
            ORDER BY next_retry_at
            """,
            (max_attempts, _iso(current)),
        ).fetchall()
    for run_row in failed_rows:
        schedule = schedules.get(str(run_row['schedule_id']))
        if not schedule:
            continue
        start = _parse_dt(run_row['period_start'])
        end = _parse_dt(run_row['period_end'])
        due_at = _parse_dt(run_row['due_at'])
        if not start or not end or not due_at:
            continue
        try:
            _deliver_window(schedule, PeriodWindow(start=start, end=end, due_at=due_at), trigger_kind=str(run_row['trigger_kind'] or 'scheduled'))
        except Exception:
            continue


class ReportEmailSchedulerEngine:
    def __init__(self, interval_seconds: int = 60):
        self.interval_seconds = max(int(interval_seconds), 60)
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        initialize_report_email_scheduler_storage()
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name='arca-report-email-scheduler', daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2)

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                process_due_report_email_schedules()
            except Exception:
                logger.exception('Error general en scheduler de reportes por correo')
            self._stop.wait(self.interval_seconds)


report_email_scheduler_engine = ReportEmailSchedulerEngine(settings.report_email_scheduler_interval_seconds)
