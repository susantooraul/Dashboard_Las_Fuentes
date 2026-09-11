import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile

from app.auth.dependencies import require_roles
from app.database import DatabaseUnavailableError, ensure_database_available
from app.schemas.export import (
    DailyWaterReportEmailRequest,
    ReportEmailScheduleCreateRequest,
    ReportEmailScheduleUpdateRequest,
)
from app.schemas.water import (
    WaterDashboardPayload,
    WaterSourceActivateResponse,
    WaterSourceInfo,
    WaterSourceValidation,
)
from app.services.email_service import (
    EmailDeliveryError,
    EmailNotConfiguredError,
    ensure_smtp_configured,
    send_email_with_bytes_attachment,
    send_email_with_bytes_attachments,
)
from app.services.water_daily_report_service import (
    ReportDataUnavailableError,
    build_cached_daily_water_report_export,
    build_daily_water_report_excel,
    build_daily_water_report_html,
    build_daily_water_report_pdf,
    build_report_dataset,
    get_daily_water_report,
)
from app.services.water_service import WATER_SECTION_META, get_water_dashboard_payload, get_water_report_catalog
from app.services.insurgentes_service import get_insurgentes_shift_cuts
from app.services.insurgentes_daily_review_service import get_insurgentes_daily_review
from app.services.insurgentes_history_service import (
    InsurgentesHistoryError,
    get_insurgentes_water_history,
    get_insurgentes_water_history_module,
)
from app.services.insurgentes_five_minute_export_service import (
    InsurgentesFiveMinuteExportError,
    export_insurgentes_five_minute_excel,
    export_insurgentes_five_minute_module_excel,
)
from app.services.insurgentes_full_history_export_service import (
    InsurgentesFullHistoryExportError,
    export_insurgentes_full_history_excel,
    export_insurgentes_full_history_pdf,
)
from app.services.insurgentes_module_history_export_service import export_insurgentes_module_history_pdf
from app.services.report_email_scheduler_service import (
    ReportEmailScheduleError,
    ReportEmailScheduleForbidden,
    ReportEmailScheduleNotFound,
    create_report_email_schedule,
    delete_report_email_schedule,
    list_report_email_runs,
    list_report_email_schedules,
    run_schedule_now,
    update_report_email_schedule,
)
from app.services.water_source_service import (
    activate_source,
    list_sources,
    read_upload_json,
    register_upload,
    validate_source_data,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix='/water', tags=['water'])


@router.get('/dashboard/{section}', response_model=WaterDashboardPayload)
def read_water_dashboard(
    section: str,
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    period: Optional[str] = Query(None),
    include_history: bool = Query(False),
    include_energy_water: bool = Query(False),
    include_period_deltas: bool = Query(False),
    force_refresh: bool = Query(False),
):
    if section not in WATER_SECTION_META:
        raise HTTPException(status_code=404, detail='Sección operativa no encontrada')
    return get_water_dashboard_payload(
        section,
        start_date=start_date,
        end_date=end_date,
        period=period,
        include_history=include_history,
        include_energy_water=include_energy_water,
        include_period_deltas=include_period_deltas,
        force_refresh=force_refresh,
    )


@router.get('/history')
def read_water_history(
    module: str = Query(..., pattern='^(well|line|flow)$'),
    sensor_id: int = Query(..., gt=0),
    start_date: str = Query(...),
    end_date: str = Query(...),
    aggregation: str = Query(..., pattern='^(minute|quarter_hour|hourly|daily)$'),
    force_refresh: bool = Query(False),
):
    try:
        return get_insurgentes_water_history(
            module=module,
            sensor_id=sensor_id,
            start_date=start_date,
            end_date=end_date,
            aggregation=aggregation,
            force_refresh=force_refresh,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except InsurgentesHistoryError as exc:
        raise HTTPException(status_code=504 if exc.status == 'timeout' else 503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception('No fue posible construir el histórico de Las Fuentes: %s', exc)
        raise HTTPException(status_code=500, detail='No fue posible consultar el histórico de planta.') from exc


@router.get('/history/module')
def read_water_history_module(
    module: str = Query(..., pattern='^(well|line|flow)$'),
    start_date: str = Query(...),
    end_date: str = Query(...),
    aggregation: str = Query(..., pattern='^(minute|quarter_hour|hourly|daily)$'),
    force_refresh: bool = Query(False),
):
    try:
        return get_insurgentes_water_history_module(
            module=module,
            start_date=start_date,
            end_date=end_date,
            aggregation=aggregation,
            force_refresh=force_refresh,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except InsurgentesHistoryError as exc:
        raise HTTPException(status_code=504 if exc.status == 'timeout' else 503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception('No fue posible construir el histórico por módulo de Las Fuentes: %s', exc)
        raise HTTPException(status_code=500, detail='No fue posible consultar el histórico por módulo.') from exc


@router.get('/history/module/pdf')
def download_water_history_module_pdf(
    module: str = Query(..., pattern='^(well|line|flow)$'),
    start_date: str = Query(...),
    end_date: str = Query(...),
    aggregation: str = Query(..., pattern='^(minute|quarter_hour|hourly|daily)$'),
    metric: str = Query('flow', pattern='^(flow|totalizer|both)$'),
    totalizer_display: str = Query('delta', pattern='^(delta|absolute)$'),
    selected: str = Query(''),
    force_refresh: bool = Query(False),
):
    selected_ids = [token.strip() for token in selected.split(',') if token.strip()]
    try:
        content, filename = export_insurgentes_module_history_pdf(
            module=module,
            start_date=start_date,
            end_date=end_date,
            aggregation=aggregation,
            metric=metric,
            totalizer_display=totalizer_display,
            selected=selected_ids,
            force_refresh=force_refresh,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except InsurgentesHistoryError as exc:
        raise HTTPException(status_code=504 if exc.status == 'timeout' else 503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception('No fue posible generar el PDF historico por modulo de Las Fuentes: %s', exc)
        raise HTTPException(status_code=500, detail='No fue posible generar el PDF del historico por modulo.') from exc
    return Response(
        content=content,
        media_type='application/pdf',
        headers={'Content-Disposition': f'attachment; filename="{filename}"'},
    )


@router.get('/history/five-minute/excel')
def download_five_minute_history_excel(
    module: str = Query(..., pattern='^(well|line|flow)$'),
    sensor_id: int = Query(..., gt=0),
    start_date: str = Query(...),
    end_date: str = Query(...),
):
    try:
        content, filename = export_insurgentes_five_minute_excel(
            module=module,
            sensor_id=sensor_id,
            start_date=start_date,
            end_date=end_date,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except InsurgentesFiveMinuteExportError as exc:
        raise HTTPException(status_code=504 if exc.status == 'timeout' else 503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception('No fue posible generar el Excel histórico de 5 minutos de Las Fuentes: %s', exc)
        raise HTTPException(status_code=500, detail='No fue posible generar la exportación Excel de 5 minutos.') from exc
    return Response(
        content=content,
        media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers={'Content-Disposition': f'attachment; filename="{filename}"'},
    )


@router.get('/history/five-minute/module/excel')
def download_five_minute_module_history_excel(
    module: str = Query(..., pattern='^(well|line|flow)$'),
    sensor_ids: str = Query(..., min_length=1),
    start_date: str = Query(...),
    end_date: str = Query(...),
):
    try:
        parsed_sensor_ids = [int(token.strip()) for token in sensor_ids.split(',') if token.strip()]
    except ValueError as exc:
        raise HTTPException(status_code=422, detail='Los sensores seleccionados no son válidos.') from exc
    try:
        content, filename = export_insurgentes_five_minute_module_excel(
            module=module,
            sensor_ids=parsed_sensor_ids,
            start_date=start_date,
            end_date=end_date,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except InsurgentesFiveMinuteExportError as exc:
        raise HTTPException(status_code=504 if exc.status == 'timeout' else 503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception('No fue posible generar el Excel 5 minutos por módulo de Las Fuentes: %s', exc)
        raise HTTPException(status_code=500, detail='No fue posible generar el Excel de 5 minutos por módulo.') from exc
    return Response(
        content=content,
        media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers={'Content-Disposition': f'attachment; filename="{filename}"'},
    )


@router.get('/history/full/excel')
def download_full_history_excel(
    force_refresh: bool = Query(False),
):
    try:
        content, filename = export_insurgentes_full_history_excel(
            force_refresh=force_refresh,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except InsurgentesFullHistoryExportError as exc:
        raise HTTPException(status_code=504 if exc.status == 'timeout' else 503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception('No fue posible generar el histórico completo Excel de Las Fuentes: %s', exc)
        raise HTTPException(status_code=500, detail='No fue posible generar el histórico completo Excel.') from exc
    return Response(
        content=content,
        media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers={'Content-Disposition': f'attachment; filename="{filename}"'},
    )


@router.get('/history/full/pdf')
def download_full_history_pdf(
    force_refresh: bool = Query(False),
):
    try:
        content, filename = export_insurgentes_full_history_pdf(
            force_refresh=force_refresh,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except InsurgentesFullHistoryExportError as exc:
        raise HTTPException(status_code=504 if exc.status == 'timeout' else 503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception('No fue posible generar el histórico de soporte PDF de Las Fuentes: %s', exc)
        raise HTTPException(status_code=500, detail='No fue posible generar el histórico de soporte PDF.') from exc
    return Response(
        content=content,
        media_type='application/pdf',
        headers={'Content-Disposition': f'attachment; filename="{filename}"'},
    )


@router.get('/review/daily')
def read_daily_water_review(
    date: Optional[str] = Query(None),
    force_refresh: bool = Query(False),
):
    # El endpoint es la fuente comun de Revisión diaria. force_refresh se
    # conserva en el contrato HTTP; los servicios internos manejan su propia
    # consistencia/caché y no alteran la matemática por este flag.
    _ = force_refresh
    try:
        return get_insurgentes_daily_review(review_date=date)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception('No fue posible construir Revisión diaria de Las Fuentes: %s', exc)
        raise HTTPException(status_code=503, detail='No fue posible construir la revisión diaria de planta.') from exc


@router.get('/shifts')
def read_water_shifts(
    date: Optional[str] = Query(None),
    module: Optional[str] = Query(None),
    element_id: Optional[str] = Query(None),
    force_refresh: bool = Query(False),
):
    # force_refresh se acepta para mantener un contrato uniforme con el frontend;
    # la consulta no cambia resultados ni evita la normalización centralizada.
    _ = force_refresh
    try:
        return get_insurgentes_shift_cuts(shift_date=date, module=module, element_id=element_id)
    except Exception as exc:
        raise HTTPException(status_code=503, detail='No fue posible calcular cortes por turno') from exc


@router.get('/wells/minute-flow')
def read_well_minute_flow(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    start_datetime: Optional[str] = Query(None),
    end_datetime: Optional[str] = Query(None),
    well_numbers: Optional[str] = Query(None),
):
    raise HTTPException(
        status_code=410,
        detail='Esta consulta heredada no está disponible para Planta Las Fuentes.',
    )


@router.get('/wells/totalizer-cutoff')
def read_well_totalizer_cutoff(date: Optional[str] = Query(None)):
    raise HTTPException(
        status_code=410,
        detail='Esta consulta heredada no está disponible para Planta Las Fuentes.',
    )



@router.get('/report-email-schedules')
def read_report_email_schedules(
    actor: dict = Depends(require_roles('admin', 'operator')),
):
    return list_report_email_schedules(actor)


@router.post('/report-email-schedules')
def create_report_email_schedule_route(
    request: ReportEmailScheduleCreateRequest,
    actor: dict = Depends(require_roles('admin', 'operator')),
):
    try:
        return create_report_email_schedule(request.model_dump(mode='json'), actor)
    except ReportEmailScheduleError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.patch('/report-email-schedules/{schedule_id}')
def update_report_email_schedule_route(
    schedule_id: str,
    request: ReportEmailScheduleUpdateRequest,
    actor: dict = Depends(require_roles('admin', 'operator')),
):
    try:
        return update_report_email_schedule(schedule_id, request.model_dump(mode='json', exclude_unset=True), actor)
    except ReportEmailScheduleNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ReportEmailScheduleForbidden as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ReportEmailScheduleError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.delete('/report-email-schedules/{schedule_id}')
def delete_report_email_schedule_route(
    schedule_id: str,
    actor: dict = Depends(require_roles('admin', 'operator')),
):
    try:
        delete_report_email_schedule(schedule_id, actor)
    except ReportEmailScheduleNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ReportEmailScheduleForbidden as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return {'message': 'Programación eliminada correctamente.'}


@router.post('/report-email-schedules/{schedule_id}/run-now')
def run_report_email_schedule_now_route(
    schedule_id: str,
    actor: dict = Depends(require_roles('admin', 'operator')),
):
    try:
        return run_schedule_now(schedule_id, actor)
    except ReportEmailScheduleNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ReportEmailScheduleForbidden as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ReportEmailScheduleError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception('No fue posible ejecutar la programación de correo %s', schedule_id)
        raise HTTPException(status_code=502, detail='No fue posible generar o enviar el reporte programado.') from exc


@router.get('/report-email-schedules/{schedule_id}/runs')
def read_report_email_schedule_runs(
    schedule_id: str,
    limit: int = Query(20, ge=1, le=100),
    actor: dict = Depends(require_roles('admin', 'operator')),
):
    try:
        return list_report_email_runs(schedule_id, actor, limit=limit)
    except ReportEmailScheduleNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ReportEmailScheduleForbidden as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

@router.get('/reports/catalog', response_model=list[str])
def read_water_report_catalog():
    return get_water_report_catalog()


@router.get('/reports/daily/pdf')
def download_daily_water_report_pdf(
    date: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
):
    try:
        pdf_bytes, filename = build_cached_daily_water_report_export('pdf', report_date=date, start_date=start_date, end_date=end_date)
    except ReportDataUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return Response(
        content=pdf_bytes,
        media_type='application/pdf',
        headers={'Content-Disposition': f'attachment; filename="{filename}"'},
    )


@router.get('/reports/daily/excel')
def download_daily_water_report_excel(
    date: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
):
    try:
        excel_bytes, filename = build_cached_daily_water_report_export('excel', report_date=date, start_date=start_date, end_date=end_date)
    except ReportDataUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return Response(
        content=excel_bytes,
        media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers={'Content-Disposition': f'attachment; filename="{filename}"'},
    )


@router.get('/reports/daily/html')
def download_daily_water_report_html(
    date: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
):
    try:
        html_bytes, filename = build_cached_daily_water_report_export('html', report_date=date, start_date=start_date, end_date=end_date)
    except ReportDataUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return Response(
        content=html_bytes,
        media_type='text/html; charset=utf-8',
        headers={'Content-Disposition': f'inline; filename="{filename}"'},
    )


@router.post('/reports/daily/email')
def email_daily_water_report(
    request: DailyWaterReportEmailRequest,
    _current_user: dict = Depends(require_roles('admin', 'operator')),
):
    # Validar primero dependencias externas. No se ejecutan todas las consultas
    # si falta configuración SMTP o la fuente operativa no está disponible.
    try:
        ensure_smtp_configured()
        ensure_database_available(timeout_seconds=3)
    except EmailNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except DatabaseUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    formats = request.formats or ['pdf', 'excel']
    normalized_formats = []
    for value in formats:
        text = str(value).lower().strip()
        if text in {'pdf', 'excel'} and text not in normalized_formats:
            normalized_formats.append(text)
    if not normalized_formats:
        raise HTTPException(status_code=400, detail='Selecciona al menos PDF o Excel para adjuntar.')

    try:
        report = build_report_dataset(
            report_date=request.date,
            start_date=request.start_date,
            end_date=request.end_date,
            include_history=True,
        )
        attachments = []
        if 'pdf' in normalized_formats:
            pdf_bytes, pdf_filename = build_daily_water_report_pdf(report)
            attachments.append({'bytes': pdf_bytes, 'filename': pdf_filename, 'maintype': 'application', 'subtype': 'pdf'})
        if 'excel' in normalized_formats:
            excel_bytes, excel_filename = build_daily_water_report_excel(report)
            attachments.append({'bytes': excel_bytes, 'filename': excel_filename, 'maintype': 'application', 'subtype': 'vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
    except ReportDataUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    report_period = str(report.get('period_label') or report.get('date') or 'periodo consultado')
    subject = request.subject or f'Reporte Diario de Control Hídrico Insurgentes - {report_period}'
    quality = str((report.get('summary') or {}).get('calidad_periodo') or 'Sin datos')
    message = request.message or (
        'Reporte de Control Hídrico Las Fuentes generado desde el dashboard.\n\n'
        f'Periodo: {report_period}\n'
        f'Calidad: {quality}\n'
        f'Adjuntos: {", ".join(value.upper() for value in normalized_formats)}'
    )
    try:
        result = send_email_with_bytes_attachments(
            to=str(request.to),
            cc=[str(item) for item in (request.cc or [])] or None,
            subject=subject,
            message=message,
            attachments=attachments,
        )
    except EmailNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except EmailDeliveryError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {
        'message': result.message,
        'message_id': result.message_id,
        'attachments': [item['filename'] for item in attachments],
    }


@router.get('/reports/daily')
def read_daily_water_report(
    date: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    force_refresh: bool = Query(False),
):
    try:
        return get_daily_water_report(report_date=date, start_date=start_date, end_date=end_date, force_refresh=force_refresh)
    except ReportDataUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get('/sources', response_model=list[WaterSourceInfo])
def read_water_sources():
    return list_sources()


@router.post('/sources/validate', response_model=WaterSourceValidation)
async def validate_water_source(file: UploadFile = File(...)):
    data = await read_upload_json(file)
    return validate_source_data(data)


@router.post('/sources/upload', response_model=WaterSourceInfo)
async def upload_water_source(file: UploadFile = File(...), activate: bool = True):
    return await register_upload(file, activate=activate)


@router.post('/sources/{source_id}/activate', response_model=WaterSourceActivateResponse)
def activate_water_source(source_id: str):
    source = activate_source(source_id)
    return WaterSourceActivateResponse(active_source=source, message='Fuente operativa activada')
