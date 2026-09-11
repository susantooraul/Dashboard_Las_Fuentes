from datetime import date, datetime, time

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.demo.catalog import DEFAULT_PLANT_ID, get_allowed_sections
from app.schemas.dashboard import DashboardPayload
from app.services.dashboard_service import get_dashboard_payload

router = APIRouter(prefix='/dashboard', tags=['dashboard'])


def _date_bounds(start_date: date | None, end_date: date | None):
    start_dt = datetime.combine(start_date, time.min) if start_date else None
    end_dt = datetime.combine(end_date, time.max) if end_date else None
    return start_dt, end_dt


@router.get('/{section}', response_model=DashboardPayload)
def read_dashboard_legacy(section: str, start_date: date | None = Query(None), end_date: date | None = Query(None), db: Session = Depends(get_db)):
    if section not in get_allowed_sections(DEFAULT_PLANT_ID):
        raise HTTPException(status_code=404, detail='Sección no encontrada')
    start_dt, end_dt = _date_bounds(start_date, end_date)
    return get_dashboard_payload(db, DEFAULT_PLANT_ID, section, start_dt, end_dt)


@router.get('/plant/{plant_id}/{section}', response_model=DashboardPayload)
def read_dashboard(plant_id: str, section: str, start_date: date | None = Query(None), end_date: date | None = Query(None), db: Session = Depends(get_db)):
    if section not in get_allowed_sections(plant_id):
        raise HTTPException(status_code=404, detail='Sección no encontrada para la planta')
    start_dt, end_dt = _date_bounds(start_date, end_date)
    return get_dashboard_payload(db, plant_id, section, start_dt, end_dt)
