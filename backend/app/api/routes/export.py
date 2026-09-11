from datetime import date, datetime, time

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.demo.catalog import DEFAULT_PLANT_ID
from app.services.dashboard_service import get_dashboard_payload
from app.services.export_service import EXCEL_MIME, export_csv, export_excel, export_html, export_pdf, export_png

router = APIRouter(prefix='/export', tags=['export'])

MEDIA_TYPES = {
    'excel': EXCEL_MIME,
    'csv': 'text/csv',
    'html': 'text/html',
    'pdf': 'application/pdf',
    'png': 'image/png',
    'jpg': 'image/png',
}


def _date_bounds(start_date: date | None, end_date: date | None):
    start_dt = datetime.combine(start_date, time.min) if start_date else None
    end_dt = datetime.combine(end_date, time.max) if end_date else None
    return start_dt, end_dt


def _resolve(section: str, format_name: str, db: Session, plant_id: str, start_date: date | None = None, end_date: date | None = None):
    start_dt, end_dt = _date_bounds(start_date, end_date)
    payload = get_dashboard_payload(db, plant_id, section, start_dt, end_dt)
    exporters = {
        'excel': export_excel,
        'csv': export_csv,
        'html': export_html,
        'pdf': export_pdf,
        'png': export_png,
        'jpg': export_png,
    }
    if format_name not in exporters:
        raise HTTPException(status_code=400, detail='Formato no soportado')
    file_path = exporters[format_name](payload)
    return FileResponse(path=file_path, filename=file_path.name, media_type=MEDIA_TYPES[format_name])


@router.get('/{section}/{format_name}')
def export_section_legacy(section: str, format_name: str, start_date: date | None = Query(None), end_date: date | None = Query(None), db: Session = Depends(get_db)):
    return _resolve(section, format_name, db, DEFAULT_PLANT_ID, start_date, end_date)


@router.get('/plant/{plant_id}/{section}/{format_name}')
def export_section(plant_id: str, section: str, format_name: str, start_date: date | None = Query(None), end_date: date | None = Query(None), db: Session = Depends(get_db)):
    return _resolve(section, format_name, db, plant_id, start_date, end_date)
